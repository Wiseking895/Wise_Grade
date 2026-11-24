import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { hashToken } from '../src/auth/tokens.js'
import {
  SESSION_COOKIE_NAME,
  SUBJECT_SESSION_COOKIE_NAME,
} from '../src/lib/cookies.js'
import { MemoryStorageAdapter } from '../src/storage/storage.js'
import {
  registrationBody,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from './helpers/auth-fixtures.js'
import { FakeAuthRepository } from './helpers/fake-auth-repository.js'
import { FakePlatformRepository } from './helpers/fake-platform-repository.js'
import { tinyPng } from './helpers/png.js'

function cookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}`
}

describe('Platform Super Admin dashboard HTTP routes', () => {
  let auth: FakeAuthRepository
  let platform: FakePlatformRepository
  let storage: MemoryStorageAdapter
  let app: ReturnType<typeof createApp>
  let platformToken: string
  let platformUserId: string
  let schoolAgent: ReturnType<typeof request.agent>

  beforeEach(async () => {
    auth = new FakeAuthRepository()
    platform = new FakePlatformRepository()
    storage = new MemoryStorageAdapter()

    app = createApp({
      authRepository: auth,
      platformRepository: platform,
      reportStorage: storage,
      registrationGuard: () => platform.isRegistrationEnabled(),
    })

    const platformUser = await auth.createUser({
      email: 'platform@example.com',
      password: TEST_PASSWORD,
      firstName: 'Platform',
      lastName: 'Admin',
      isPlatformAdmin: true,
    })
    platformUserId = platformUser.id
    platform.account.id = platformUserId
    platformToken = await auth.issueSessionFor(platformUserId)

    schoolAgent = request.agent(app)
    await schoolAgent
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(registrationBody())
  })

  function asPlatform(method: 'get' | 'post' | 'patch' | 'delete', path: string) {
    const agent = request(app)[method](path).set('Cookie', cookie(platformToken))
    return method === 'get' ? agent : agent.set('Origin', TEST_ORIGIN)
  }

  describe('authorization', () => {
    it('rejects unauthenticated platform requests', async () => {
      const response = await request(app).get('/api/platform/overview')

      expect(response.status).toBe(401)
    })

    it('rejects a school administrator even though the session is valid', async () => {
      const overview = await schoolAgent.get('/api/platform/overview')
      const schools = await schoolAgent.get('/api/platform/schools')
      const audit = await schoolAgent.get('/api/platform/audit')

      expect(overview.status).toBe(403)
      expect(schools.status).toBe(403)
      expect(audit.status).toBe(403)
    })

    it('rejects a restricted subject-teacher session', async () => {
      const subjectToken = `subject-${Date.now()}`
      auth.subjectSessions.set(hashToken(subjectToken), {
        id: 'subject-session-1',
        tokenHash: hashToken(subjectToken),
        accessCodeId: null,
        assignmentId: 'assignment-1',
        schoolId: 'school-1',
        classId: 'class-1',
        subjectId: 'subject-1',
        className: 'Basic 1',
        subjectName: 'English Language',
        firstName: 'Subject',
        lastName: 'Teacher',
        email: null,
        phone: null,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        revokedAt: null,
        lastUsedAt: new Date(),
      })

      const response = await request(app)
        .get('/api/platform/overview')
        .set('Cookie', `${SUBJECT_SESSION_COOKIE_NAME}=${subjectToken}`)

      expect(response.status).toBe(401)
    })

    it('accepts a platform administrator who has no school membership', async () => {
      const membership = await auth.findUserWithMemberships(platformUserId)

      expect(membership?.memberships).toHaveLength(0)

      const response = await asPlatform('get', '/api/platform/overview')

      expect(response.status).toBe(200)
    })
  })

  describe('overview', () => {
    it('returns the figures calculated from repository records', async () => {
      const response = await asPlatform('get', '/api/platform/overview')

      expect(response.status).toBe(200)
      expect(response.body.data).toMatchObject({
        schools: { total: 3, active: 2, suspended: 1 },
        people: { pupils: 240, teachers: 17, activeUsers: 23 },
        reports: {
          prepared: 41,
          awaitingApproval: 3,
          approvedAwaitingRelease: 2,
          released: 35,
          onHold: 1,
        },
        payments: {
          awaitingVerification: 4,
          verifiedCount: 9,
          verifiedMinor: 123456,
          outstandingMinor: 654321,
          currency: 'GHS',
        },
      })
      expect(response.headers['cache-control']).toBe('no-store')
    })
  })

  describe('schools', () => {
    it('lists and filters schools from the platform repository', async () => {
      const all = await asPlatform('get', '/api/platform/schools')
      expect(all.status).toBe(200)
      expect(all.body.data.schools).toHaveLength(1)

      platform.schools.push({
        ...platform.schools[0]!,
        id: 'school-2',
        name: 'Suspended School',
        slug: 'suspended-school',
        isActive: false,
      })

      const suspended = await asPlatform(
        'get',
        '/api/platform/schools?status=suspended',
      )
      expect(suspended.status).toBe(200)
      expect(suspended.body.data.schools).toHaveLength(1)
      expect(suspended.body.data.schools[0].id).toBe('school-2')

      const search = await asPlatform(
        'get',
        '/api/platform/schools?search=suspended',
      )
      expect(search.body.data.schools).toHaveLength(1)
    })

    it('updates school information and audits the change', async () => {
      const response = await asPlatform(
        'patch',
        '/api/platform/schools/school-1',
      ).send({ name: 'Renamed School', landmark: 'New landmark' })

      expect(response.status).toBe(200)
      expect(response.body.data.school).toMatchObject({
        name: 'Renamed School',
        landmark: 'New landmark',
      })
      expect(platform.schools[0]!.name).toBe('Renamed School')
    })

    it('suspends and reactivates a school through the audited status action', async () => {
      const suspended = await asPlatform(
        'post',
        '/api/platform/schools/school-1/status',
      ).send({ isActive: false })

      expect(suspended.status).toBe(200)
      expect(suspended.body.data.school.isActive).toBe(false)
      expect(platform.recordedAudits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ action: 'SCHOOL_SUSPENDED' }),
        ]),
      )

      const activated = await asPlatform(
        'post',
        '/api/platform/schools/school-1/status',
      ).send({ isActive: true })

      expect(activated.body.data.school.isActive).toBe(true)
    })

    it('streams a private school logo only to platform administrators', async () => {
      const png = tinyPng(4)
      await storage.putObject('logo-key', png, 'image/png')

      const allowed = await asPlatform(
        'get',
        '/api/platform/schools/school-1/logo',
      )
      expect(allowed.status).toBe(200)
      expect(allowed.headers['content-type']).toContain('image/png')
      expect(allowed.headers['cache-control']).toBe('private, max-age=300')
      // The platform dashboard runs on a different origin; a same-origin CORP
      // default would block this authenticated image.
      expect(allowed.headers['cross-origin-resource-policy']).toBe(
        'cross-origin',
      )

      const denied = await schoolAgent.get(
        '/api/platform/schools/school-1/logo',
      )
      expect(denied.status).toBe(403)
    })
  })

  describe('audit log', () => {
    it('returns the unified, read-only audit history with source filters', async () => {
      const all = await asPlatform('get', '/api/platform/audit')
      expect(all.status).toBe(200)
      expect(all.body.data.total).toBe(2)

      const billing = await asPlatform(
        'get',
        '/api/platform/audit?source=BILLING',
      )
      expect(billing.body.data.entries).toHaveLength(1)
      expect(billing.body.data.entries[0].source).toBe('BILLING')
    })

    it('exposes no route to edit or delete an audit entry', async () => {
      const deleted = await asPlatform(
        'delete',
        '/api/platform/audit/audit-1',
      )
      const patched = await asPlatform(
        'patch',
        '/api/platform/audit/audit-1',
      ).send({ action: 'TAMPERED' })

      expect(deleted.status).toBe(404)
      expect(patched.status).toBe(404)
    })
  })

  describe('monitoring', () => {
    it('returns cross-school workflow buckets', async () => {
      const response = await asPlatform('get', '/api/platform/monitoring')

      expect(response.status).toBe(200)
      expect(response.body.data.notSubmitted).toMatchObject({
        count: 2,
        schools: [
          expect.objectContaining({ schoolId: 'school-1', count: 2 }),
        ],
      })
      expect(response.body.data.reportsAwaitingRelease.count).toBe(0)
    })
  })

  describe('settings', () => {
    it('returns and updates the allow-listed operational settings', async () => {
      const initial = await asPlatform('get', '/api/platform/settings')
      expect(initial.status).toBe(200)
      expect(initial.body.data.supportEmail).toBe('support@wisegrade.test')

      const updated = await asPlatform('patch', '/api/platform/settings').send({
        supportEmail: 'help@wisegrade.test',
        registrationEnabled: false,
      })

      expect(updated.status).toBe(200)
      expect(updated.body.data).toMatchObject({
        supportEmail: 'help@wisegrade.test',
        registrationEnabled: false,
      })
    })

    it('enforces the registration switch on the public registration endpoint', async () => {
      platform.registrationEnabled = false

      const closed = await request(app)
        .post('/api/auth/register-school')
        .set('Origin', TEST_ORIGIN)
        .send(
          registrationBody({
            schoolName: 'Closed Registration School',
            email: 'closed@example.com',
          }),
        )

      expect(closed.status).toBe(403)
      expect(closed.body.error.message).toContain('closed')

      platform.registrationEnabled = true

      const open = await request(app)
        .post('/api/auth/register-school')
        .set('Origin', TEST_ORIGIN)
        .send(
          registrationBody({
            schoolName: 'Open Registration School',
            email: 'open@example.com',
          }),
        )

      expect(open.status).toBe(201)
    })
  })

  describe('my account', () => {
    it('returns the platform account and updates the profile', async () => {
      const initial = await asPlatform('get', '/api/platform/account')
      expect(initial.status).toBe(200)
      expect(initial.body.data.account.email).toBe('platform@example.com')

      const updated = await asPlatform('patch', '/api/platform/account').send({
        firstName: 'Grace',
        lastName: 'Hopper',
      })

      expect(updated.status).toBe(200)
      expect(updated.body.data.account).toMatchObject({
        firstName: 'Grace',
        lastName: 'Hopper',
      })
    })

    it('requires the current password to change the sign-in email', async () => {
      const wrong = await asPlatform(
        'post',
        '/api/platform/account/email',
      ).send({ email: 'new-platform@example.com', currentPassword: 'wrong-password' })

      expect(wrong.status).toBe(403)

      const correct = await asPlatform(
        'post',
        '/api/platform/account/email',
      ).send({
        email: 'new-platform@example.com',
        currentPassword: TEST_PASSWORD,
      })

      expect(correct.status).toBe(200)
      expect(correct.body.data.account.email).toBe('new-platform@example.com')
      expect(platform.revokeOtherCalls).toBeGreaterThan(0)
    })

    it('requires the current password to change the password and revokes other sessions', async () => {
      const wrong = await asPlatform(
        'post',
        '/api/platform/account/password',
      ).send({
        currentPassword: 'wrong-password',
        newPassword: 'BrandNewPassw0rd!',
      })

      expect(wrong.status).toBe(403)

      const correct = await asPlatform(
        'post',
        '/api/platform/account/password',
      ).send({
        currentPassword: TEST_PASSWORD,
        newPassword: 'BrandNewPassw0rd!',
      })

      expect(correct.status).toBe(200)
      expect(platform.passwordHash).not.toBeNull()
      expect(platform.passwordHash).not.toBe(TEST_PASSWORD)
      expect(platform.revokeOtherCalls).toBeGreaterThan(0)
    })

    it('lists sessions and revokes every other session', async () => {
      const sessions = await asPlatform(
        'get',
        '/api/platform/account/sessions',
      )
      expect(sessions.status).toBe(200)
      expect(sessions.body.data.sessions).toHaveLength(2)

      const revoked = await asPlatform(
        'post',
        '/api/platform/account/sessions/revoke-others',
      )
      expect(revoked.status).toBe(200)
      expect(revoked.body.data.revoked).toBe(2)
      expect(platform.sessions).toHaveLength(0)
    })
  })
})
