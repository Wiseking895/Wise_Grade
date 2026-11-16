import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { hashToken } from '../src/auth/tokens.js'
import { SESSION_COOKIE_NAME } from '../src/lib/cookies.js'
import { MemoryStorageAdapter } from '../src/storage/storage.js'
import {
  registrationBody,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from './helpers/auth-fixtures.js'
import { FakeAuthRepository } from './helpers/fake-auth-repository.js'
import { FakePlatformRepository } from './helpers/fake-platform-repository.js'
import { FakeSchoolRepository } from './helpers/fake-school-repository.js'

const ACCESS_DENIED = 'You do not have access to this school'

interface RegisteredSchool {
  agent: ReturnType<typeof request.agent>
  schoolId: string
  email: string
  userId: string
}

describe('school suspension enforcement', () => {
  let auth: FakeAuthRepository
  let schools: FakeSchoolRepository
  let platform: FakePlatformRepository
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    auth = new FakeAuthRepository()
    schools = new FakeSchoolRepository(auth)
    platform = new FakePlatformRepository()
    app = createApp({
      authRepository: auth,
      schoolRepository: schools,
      platformRepository: platform,
      reportStorage: new MemoryStorageAdapter(),
      // Keep the in-test rate limiters out of the way; suspension is the
      // behaviour under test, not throttling.
      loginRateLimit: { windowMs: 60_000, max: 1_000 },
      passwordResetRateLimit: { windowMs: 60_000, max: 1_000 },
    })
  })

  async function registerSchool(label: string): Promise<RegisteredSchool> {
    const email = `${label.toLowerCase().replace(/[^a-z0-9]/g, '-')}@example.com`
    const agent = request.agent(app)
    const response = await agent
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(
        registrationBody({
          schoolName: `${label} Academy`,
          email,
        }),
      )

    expect(response.status).toBe(201)

    const schoolId = response.body.data.school.id as string
    const userId = response.body.data.user.id as string

    schools.seedSchool({
      id: schoolId,
      name: `${label} Academy`,
      slug: response.body.data.school.slug as string,
      email,
    })
    schools.seedDefaults(schoolId, userId)

    return { agent, schoolId, email, userId }
  }

  function sessionCookie(token: string): string {
    return `${SESSION_COOKIE_NAME}=${token}`
  }

  async function login(email: string, password = TEST_PASSWORD) {
    const agent = request.agent(app)
    const response = await agent
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email, password })

    return { agent, response }
  }

  async function addClassTeacher(
    school: RegisteredSchool,
    email: string,
  ): Promise<{ agent: ReturnType<typeof request.agent>; membershipId: string }> {
    const created = await school.agent
      .post(`/api/schools/${school.schoolId}/teachers`)
      .set('Origin', TEST_ORIGIN)
      .send({
        firstName: 'Class',
        lastName: 'Teacher',
        email,
        role: 'CLASS_TEACHER',
        initialPassword: TEST_PASSWORD,
        className: 'Basic 3',
      })

    expect(created.status).toBe(201)

    const { agent, response } = await login(email)
    expect(response.status).toBe(200)

    return {
      agent,
      membershipId: created.body.data.teacher.membershipId as string,
    }
  }

  // -------------------------------------------------------------------------
  // School Administrator
  // -------------------------------------------------------------------------
  describe('school administrator', () => {
    it('can use the school while active and is blocked immediately after suspension', async () => {
      const school = await registerSchool('Active School')

      expect((await school.agent.get(`/api/schools/${school.schoolId}`)).status).toBe(200)
      expect(
        (await school.agent.get(`/api/schools/${school.schoolId}/pupils`)).status,
      ).toBe(200)

      auth.setSchoolActive(school.schoolId, false)

      const dashboard = await school.agent.get(`/api/schools/${school.schoolId}`)
      const pupils = await school.agent.get(`/api/schools/${school.schoolId}/pupils`)

      expect(dashboard.status).toBe(403)
      expect(dashboard.body.error.message).toBe(ACCESS_DENIED)
      expect(pupils.status).toBe(403)
      expect(pupils.body.error.message).toBe(ACCESS_DENIED)

      // The denial must not disclose that the school was suspended.
      expect(JSON.stringify(dashboard.body)).not.toMatch(/suspend/i)

      // The existing session is not destroyed: the account is not disabled,
      // but it no longer reports any usable school membership.
      const me = await school.agent.get('/api/auth/me')
      expect(me.status).toBe(200)
      expect(me.body.data.user.email).toBe(school.email)
      expect(me.body.data.memberships).toEqual([])
    })

    it('cannot start a new session while the school is suspended', async () => {
      const school = await registerSchool('Suspended School')
      auth.setSchoolActive(school.schoolId, false)

      const { response } = await login(school.email)

      expect(response.status).toBe(403)
      expect(response.body.error.message).toBe('Access denied')
      expect(response.headers['set-cookie']).toBeUndefined()
      expect(auth.auditActions()).toContain('LOGIN_DENIED')

      // Valid credentials were supplied; suspension must not count as a failed
      // sign-in and must never lock the account.
      expect(auth.getUserSnapshot(school.email)?.failedLoginCount).toBe(0)
      expect(auth.getUserSnapshot(school.email)?.lockedUntil).toBeNull()
    })

    it('regains access after reactivation without a new login', async () => {
      const school = await registerSchool('Reactivated School')
      auth.setSchoolActive(school.schoolId, false)
      expect((await school.agent.get(`/api/schools/${school.schoolId}`)).status).toBe(403)

      auth.setSchoolActive(school.schoolId, true)

      expect((await school.agent.get(`/api/schools/${school.schoolId}`)).status).toBe(200)
      const { response } = await login(school.email)
      expect(response.status).toBe(200)
      expect(response.body.data.memberships).toHaveLength(1)
    })
  })

  // -------------------------------------------------------------------------
  // Class Teacher
  // -------------------------------------------------------------------------
  describe('class teacher', () => {
    it('keeps assigned-class access while active and loses every school surface when suspended', async () => {
      const school = await registerSchool('Class Teacher School')
      const teacher = await addClassTeacher(school, 'class-teacher@example.com')

      expect(
        (await teacher.agent.get(`/api/schools/${school.schoolId}/pupils`)).status,
      ).toBe(200)
      expect(
        (await teacher.agent.get(`/api/schools/${school.schoolId}/classes`)).status,
      ).toBe(200)

      auth.setSchoolActive(school.schoolId, false)

      const paths = [
        `/api/schools/${school.schoolId}`,
        `/api/schools/${school.schoolId}/pupils`,
        `/api/schools/${school.schoolId}/classes`,
        `/api/schools/${school.schoolId}/class-dashboard`,
        `/api/schools/${school.schoolId}/subjects`,
        `/api/schools/${school.schoolId}/assessments/score-entry`,
      ]

      for (const path of paths) {
        const response = await teacher.agent.get(path)
        expect(response.status, path).toBe(403)
        expect(response.body.error.message, path).toBe(ACCESS_DENIED)
      }
    })
  })

  // -------------------------------------------------------------------------
  // Subject Teacher (restricted access-code session)
  // -------------------------------------------------------------------------
  describe('subject teacher access code', () => {
    const code = 'subject-access-code-0123456789abcdef'

    async function enterCode(value: string) {
      const agent = request.agent(app)
      const response = await agent
        .post('/api/auth/subject-teacher/access-code')
        .set('Origin', TEST_ORIGIN)
        .send({ code: value })

      return { agent, response }
    }

    it('accepts a valid code while active and rejects it once the school is suspended', async () => {
      const school = await registerSchool('Subject Teacher School')
      auth.addSubjectTeacherInvitation({
        codeHash: hashToken(code),
        schoolId: school.schoolId,
        className: 'Basic 3',
        subjectName: 'Mathematics',
      })

      const active = await enterCode(code)
      expect(active.response.status).toBe(200)
      expect((await active.agent.get('/api/auth/subject-teacher/me')).status).toBe(200)

      auth.setSchoolActive(school.schoolId, false)

      // The existing restricted session loses access immediately.
      const existingSession = await active.agent.get('/api/auth/subject-teacher/me')
      expect(existingSession.status).toBe(401)

      const existingSchoolAccess = await active.agent.get(
        `/api/schools/${school.schoolId}/classes`,
      )
      expect(existingSchoolAccess.status).toBe(401)

      // A fresh access-code entry is refused too.
      const suspended = await enterCode(code)
      expect(suspended.response.status).toBe(401)
    })

    it('does not affect an assignment in another active school', async () => {
      const suspendedSchool = await registerSchool('Subject School A')
      const activeSchool = await registerSchool('Subject School B')

      auth.addSubjectTeacherInvitation({
        codeHash: hashToken(code),
        schoolId: suspendedSchool.schoolId,
      })
      const otherCode = 'other-subject-access-code-0123456789'
      auth.addSubjectTeacherInvitation({
        codeHash: hashToken(otherCode),
        schoolId: activeSchool.schoolId,
      })

      const other = await enterCode(otherCode)
      expect(other.response.status).toBe(200)

      auth.setSchoolActive(suspendedSchool.schoolId, false)

      // The unrelated school's restricted session still works.
      expect((await other.agent.get('/api/auth/subject-teacher/me')).status).toBe(200)
      const otherAgain = await enterCode(otherCode)
      expect(otherAgain.response.status).toBe(200)

      // A session scoped to the active school cannot reach the suspended one.
      expect(
        (await other.agent.get(`/api/schools/${suspendedSchool.schoolId}/classes`)).status,
      ).toBe(403)
    })
  })

  // -------------------------------------------------------------------------
  // Multiple memberships
  // -------------------------------------------------------------------------
  describe('multiple school memberships', () => {
    it('blocks only the suspended school and keeps the other school usable', async () => {
      const schoolA = await registerSchool('Multi A')
      const schoolB = await registerSchool('Multi B')

      const user = await auth.createUser({
        email: 'multi-membership@example.com',
        password: TEST_PASSWORD,
      })
      await auth.addMembership(user.id, schoolA.schoolId, 'CLASS_TEACHER')
      await auth.addMembership(user.id, schoolB.schoolId, 'CLASS_TEACHER')

      const token = await auth.issueSessionFor(user.id)
      const cookie = sessionCookie(token)

      expect(
        (await request(app).get(`/api/schools/${schoolA.schoolId}`).set('Cookie', cookie)).status,
      ).toBe(200)
      expect(
        (await request(app).get(`/api/schools/${schoolB.schoolId}`).set('Cookie', cookie)).status,
      ).toBe(200)

      auth.setSchoolActive(schoolA.schoolId, false)

      expect(
        (await request(app).get(`/api/schools/${schoolA.schoolId}`).set('Cookie', cookie)).status,
      ).toBe(403)
      expect(
        (await request(app).get(`/api/schools/${schoolB.schoolId}`).set('Cookie', cookie)).status,
      ).toBe(200)

      const me = await request(app).get('/api/auth/me').set('Cookie', cookie)
      expect(me.status).toBe(200)
      expect(me.body.data.memberships).toHaveLength(1)
      expect(me.body.data.memberships[0].schoolId).toBe(schoolB.schoolId)

      // Signing in again is allowed because a usable school remains.
      const relogin = await login('multi-membership@example.com')
      expect(relogin.response.status).toBe(200)
      expect(relogin.response.body.data.memberships).toHaveLength(1)
      expect(relogin.response.body.data.memberships[0].schoolId).toBe(schoolB.schoolId)

      auth.setSchoolActive(schoolA.schoolId, true)

      expect(
        (await request(app).get(`/api/schools/${schoolA.schoolId}`).set('Cookie', cookie)).status,
      ).toBe(200)
      expect(
        (await request(app).get(`/api/schools/${schoolB.schoolId}`).set('Cookie', cookie)).status,
      ).toBe(200)
    })

    it('does not revive an independently revoked session when the school is reactivated', async () => {
      const school = await registerSchool('Revocation School')
      const user = await auth.createUser({
        email: 'revoked-session@example.com',
        password: TEST_PASSWORD,
      })
      await auth.addMembership(user.id, school.schoolId, 'SCHOOL_ADMIN')

      const liveToken = await auth.issueSessionFor(user.id)
      const revokedToken = await auth.issueSessionFor(user.id)
      const revokedSession = [...auth.sessions.values()].find(
        (session) => session.tokenHash === hashToken(revokedToken),
      )
      await auth.revokeSession(revokedSession!.id)

      auth.setSchoolActive(school.schoolId, false)
      auth.setSchoolActive(school.schoolId, true)

      expect(
        (await request(app).get(`/api/schools/${school.schoolId}`).set('Cookie', sessionCookie(liveToken)))
          .status,
      ).toBe(200)
      expect(
        (await request(app).get('/api/auth/me').set('Cookie', sessionCookie(revokedToken))).status,
      ).toBe(401)
    })
  })

  // -------------------------------------------------------------------------
  // Platform Super Admin
  // -------------------------------------------------------------------------
  describe('platform super admin', () => {
    it('is unaffected by school suspension and retains platform oversight', async () => {
      const school = await registerSchool('Platform Oversight')
      const platformUser = await auth.createUser({
        email: 'platform-owner@example.com',
        password: TEST_PASSWORD,
        isPlatformAdmin: true,
      })
      const token = await auth.issueSessionFor(platformUser.id)
      const cookie = sessionCookie(token)

      auth.setSchoolActive(school.schoolId, false)
      const suspendedPlatformSchool = platform.schools[0]!
      suspendedPlatformSchool.isActive = false

      const me = await request(app).get('/api/auth/me').set('Cookie', cookie)
      expect(me.status).toBe(200)
      expect(me.body.data.user.isPlatformAdmin).toBe(true)

      for (const path of [
        '/api/platform/overview',
        '/api/platform/schools',
        '/api/platform/schools?status=suspended',
      ]) {
        const response = await request(app).get(path).set('Cookie', cookie)
        expect(response.status, path).toBe(200)
      }

      const suspendedList = await request(app)
        .get('/api/platform/schools?status=suspended')
        .set('Cookie', cookie)
      expect(suspendedList.body.data.schools).toHaveLength(1)
      expect(suspendedList.body.data.schools[0].id).toBe(suspendedPlatformSchool.id)

      // Platform authority never becomes an implicit school membership.
      const tenantAccess = await request(app)
        .get(`/api/schools/${school.schoolId}`)
        .set('Cookie', cookie)
      expect(tenantAccess.status).toBe(403)
      expect(tenantAccess.body.error.message).toBe(ACCESS_DENIED)

      // Reactivation through the audited platform action still works.
      const reactivated = await request(app)
        .post(`/api/platform/schools/${suspendedPlatformSchool.id}/status`)
        .set('Cookie', cookie)
        .set('Origin', TEST_ORIGIN)
        .send({ isActive: true })
      expect(reactivated.status).toBe(200)
      expect(reactivated.body.data.school.isActive).toBe(true)
      expect(platform.recordedAudits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ action: 'SCHOOL_ACTIVATED' }),
        ]),
      )
    })
  })

  // -------------------------------------------------------------------------
  // Security regressions
  // -------------------------------------------------------------------------
  describe('security regressions', () => {
    it('keeps unauthenticated and cross-school requests denied', async () => {
      const schoolA = await registerSchool('Security A')
      const schoolB = await registerSchool('Security B')

      expect((await request(app).get(`/api/schools/${schoolA.schoolId}`)).status).toBe(401)

      expect((await schoolA.agent.get(`/api/schools/${schoolB.schoolId}`)).status).toBe(403)
      expect(
        (await schoolA.agent.get(`/api/schools/${schoolB.schoolId}/pupils`)).status,
      ).toBe(403)

      // Unknown school ids are indistinguishable from forbidden ones.
      expect(
        (
          await schoolA.agent.get(
            '/api/schools/00000000-0000-0000-0000-000000000000',
          )
        ).status,
      ).toBe(403)
    })

    it('cannot reach a suspended school through an alternative route', async () => {
      const school = await registerSchool('Alternative Route')
      auth.setSchoolActive(school.schoolId, false)

      for (const path of [
        `/api/schools/${school.schoolId}/academic-years`,
        `/api/schools/${school.schoolId}/academic-terms`,
        `/api/schools/${school.schoolId}/members`,
        `/api/schools/${school.schoolId}/class-subject-counts`,
        `/api/schools/${school.schoolId}/profile`,
      ]) {
        const response = await school.agent.get(path)
        expect(response.status, path).toBe(403)
        expect(response.body.error.message, path).toBe(ACCESS_DENIED)
      }
    })
  })
})
