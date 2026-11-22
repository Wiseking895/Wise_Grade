import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { SESSION_COOKIE_NAME } from '../src/lib/cookies.js'
import { MemoryStorageAdapter } from '../src/storage/storage.js'
import { TEST_ORIGIN, TEST_PASSWORD } from './helpers/auth-fixtures.js'
import { FakeAuthRepository } from './helpers/fake-auth-repository.js'
import { FakePlatformRepository } from './helpers/fake-platform-repository.js'

function cookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}`
}

describe('Platform Super Admin account deletion and restoration', () => {
  let auth: FakeAuthRepository
  let platform: FakePlatformRepository
  let app: ReturnType<typeof createApp>
  let platformToken: string
  let platformUserId: string
  let teacherId: string
  let teacherToken: string
  let adminId: string
  let adminToken: string

  beforeEach(async () => {
    auth = new FakeAuthRepository()
    platform = new FakePlatformRepository({
      onAccountDeleted: (userId, deletedAt) =>
        auth.markUserDeleted(userId, deletedAt),
      onAccountRestored: (userId) => auth.markUserRestored(userId),
    })

    app = createApp({
      authRepository: auth,
      platformRepository: platform,
      reportStorage: new MemoryStorageAdapter(),
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
    platform.managedAccounts[0]!.id = platformUserId
    platformToken = await auth.issueSessionFor(platformUserId)

    auth.seedSchool({
      id: 'school-1',
      name: 'Accra Basic School',
      slug: 'accra-basic-school',
    })

    const teacher = await auth.createUser({
      email: 'ama@school.test',
      password: TEST_PASSWORD,
      firstName: 'Ama',
      lastName: 'Mensah',
    })
    teacherId = teacher.id
    await auth.addMembership(teacherId, 'school-1', 'CLASS_TEACHER')
    teacherToken = await auth.issueSessionFor(teacherId)
    platform.managedAccounts[1]!.id = teacherId

    const admin = await auth.createUser({
      email: 'admin@school.test',
      password: TEST_PASSWORD,
      firstName: 'School',
      lastName: 'Admin',
    })
    adminId = admin.id
    await auth.addMembership(adminId, 'school-1', 'SCHOOL_ADMIN')
    adminToken = await auth.issueSessionFor(adminId)
    platform.managedAccounts.push({
      id: adminId,
      firstName: 'School',
      lastName: 'Admin',
      email: 'admin@school.test',
      role: 'SCHOOL_ADMIN',
      isPlatformAdmin: false,
      isActive: true,
      deletedAt: null,
      schoolId: 'school-1',
      schoolName: 'Accra Basic School',
      lastLoginAt: null,
      createdAt: '2026-02-01T07:00:00.000Z',
    })
  })

  function asPlatform(
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
  ) {
    const agent = request(app)[method](path).set('Cookie', cookie(platformToken))
    return method === 'get' ? agent : agent.set('Origin', TEST_ORIGIN)
  }

  async function deleteAccount(
    userId: string,
    email: string,
    reason = 'Account no longer required by the school',
  ) {
    return asPlatform('post', `/api/platform/accounts/${userId}/delete`).send({
      reason,
      confirmEmail: email,
    })
  }

  describe('authorization', () => {
    it('rejects unauthenticated callers', async () => {
      const response = await request(app).get('/api/platform/accounts')
      expect(response.status).toBe(401)
    })

    it('denies school administrators every account archive action', async () => {
      const list = await request(app)
        .get('/api/platform/accounts')
        .set('Cookie', cookie(adminToken))
      const history = await request(app)
        .get('/api/platform/accounts/deleted')
        .set('Cookie', cookie(adminToken))
      const remove = await request(app)
        .post(`/api/platform/accounts/${teacherId}/delete`)
        .set('Cookie', cookie(adminToken))
        .set('Origin', TEST_ORIGIN)
        .send({
          reason: 'Trying to delete a teacher',
          confirmEmail: 'ama@school.test',
        })
      const restore = await request(app)
        .post('/api/platform/accounts/deleted/deletion-1/restore')
        .set('Cookie', cookie(adminToken))
        .set('Origin', TEST_ORIGIN)
        .send({ confirmEmail: 'ama@school.test' })

      expect(list.status).toBe(403)
      expect(history.status).toBe(403)
      expect(remove.status).toBe(403)
      expect(restore.status).toBe(403)
    })

    it('denies class teachers every account archive action', async () => {
      const list = await request(app)
        .get('/api/platform/accounts')
        .set('Cookie', cookie(teacherToken))
      const history = await request(app)
        .get('/api/platform/accounts/deleted')
        .set('Cookie', cookie(teacherToken))

      expect(list.status).toBe(403)
      expect(history.status).toBe(403)
    })
  })

  describe('deletion', () => {
    it('requires a reason, a matching email confirmation and blocks self-deletion', async () => {
      const shortReason = await asPlatform(
        'post',
        `/api/platform/accounts/${teacherId}/delete`,
      ).send({ reason: 'no', confirmEmail: 'ama@school.test' })
      const mismatch = await asPlatform(
        'post',
        `/api/platform/accounts/${teacherId}/delete`,
      ).send({
        reason: 'Account no longer required by the school',
        confirmEmail: 'someone-else@school.test',
      })
      const self = await asPlatform(
        'post',
        `/api/platform/accounts/${platformUserId}/delete`,
      ).send({
        reason: 'Attempting to remove my own account',
        confirmEmail: 'platform@example.com',
      })

      expect(shortReason.status).toBe(400)
      expect(mismatch.status).toBe(400)
      expect(mismatch.body.error.code).toBe('confirmation_mismatch')
      expect(mismatch.body.error.details).toEqual([
        {
          field: 'confirmEmail',
          message:
            'The confirmation email does not match the account being deleted.',
        },
      ])
      expect(self.status).toBe(409)
      expect(self.body.error.code).toBe('self_deletion')
    })

    it('archives the account, revokes sessions, blocks login and preserves the record', async () => {
      const response = await deleteAccount(teacherId, 'ama@school.test', 'Resigned')

      expect(response.status).toBe(200)
      expect(response.body.data.account).toMatchObject({
        userId: teacherId,
        firstName: 'Ama',
        lastName: 'Mensah',
        email: 'ama@school.test',
        role: 'CLASS_TEACHER',
        schoolId: 'school-1',
        schoolName: 'Accra Basic School',
        reason: 'Resigned',
        status: 'ARCHIVED',
        deletedByName: 'Platform Admin',
        deletedByEmail: 'platform@example.com',
      })
      expect(response.body.data.account.deletedAt).toBeTruthy()

      // The account row and membership survive; only access is removed.
      const archived = auth.users.get(teacherId)!
      expect(archived.email).toBe('ama@school.test')
      expect(archived.deletedAt).toBeInstanceOf(Date)
      expect(archived.isActive).toBe(false)
      expect(auth.listMembershipsForSchool('school-1')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            userId: teacherId,
            role: 'CLASS_TEACHER',
            status: 'SUSPENDED',
          }),
        ]),
      )

      // Every existing session is invalid and no new one can be issued.
      const existingSession = await request(app)
        .get('/api/auth/me')
        .set('Cookie', cookie(teacherToken))
      expect(existingSession.status).toBe(401)

      const login = await request(app)
        .post('/api/auth/login')
        .set('Origin', TEST_ORIGIN)
        .send({ email: 'ama@school.test', password: TEST_PASSWORD })
      expect(login.status).toBe(401)

      // The archived account is not listed as active/suspended.
      const active = await asPlatform('get', '/api/platform/accounts?status=all')
      expect(
        active.body.data.accounts.map((account: { id: string }) => account.id),
      ).not.toContain(teacherId)

      // The deletion is audited with the acting administrator and reason.
      expect(platform.recordedAudits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'ACCOUNT_DELETED',
            userId: teacherId,
            reason: 'Resigned',
          }),
        ]),
      )
    })

    it('rejects a second archive operation for an already deleted account', async () => {
      await deleteAccount(teacherId, 'ama@school.test')

      const again = await deleteAccount(teacherId, 'ama@school.test')
      const status = await asPlatform(
        'post',
        `/api/platform/accounts/${teacherId}/status`,
      ).send({ isActive: true })

      expect(again.status).toBe(409)
      expect(again.body.error.code).toBe('already_deleted')
      expect(status.status).toBe(409)
      expect(status.body.error.code).toBe('already_deleted')
    })
  })

  describe('deleted accounts history', () => {
    it('keeps an immutable, searchable and paginated record after the account is inactive', async () => {
      await deleteAccount(teacherId, 'ama@school.test', 'Resigned')
      await deleteAccount(adminId, 'admin@school.test', 'School closed the role')

      const all = await asPlatform('get', '/api/platform/accounts/deleted')
      expect(all.status).toBe(200)
      expect(all.body.data.total).toBe(2)
      expect(all.body.data.accounts).toHaveLength(2)

      const record = all.body.data.accounts.find(
        (item: { userId: string }) => item.userId === teacherId,
      )
      expect(record).toMatchObject({
        firstName: 'Ama',
        lastName: 'Mensah',
        email: 'ama@school.test',
        role: 'CLASS_TEACHER',
        schoolName: 'Accra Basic School',
        reason: 'Resigned',
        deletedByName: 'Platform Admin',
        deletedByEmail: 'platform@example.com',
        status: 'ARCHIVED',
      })
      expect(record.memberships).toEqual([
        {
          schoolId: 'school-1',
          schoolName: 'Accra Basic School',
          role: 'CLASS_TEACHER',
          status: 'SUSPENDED',
        },
      ])

      const search = await asPlatform(
        'get',
        '/api/platform/accounts/deleted?search=ama',
      )
      expect(search.body.data.total).toBe(1)
      expect(search.body.data.accounts[0].email).toBe('ama@school.test')

      const restoredOnly = await asPlatform(
        'get',
        '/api/platform/accounts/deleted?status=RESTORED',
      )
      expect(restoredOnly.body.data.total).toBe(0)

      const firstPage = await asPlatform(
        'get',
        '/api/platform/accounts/deleted?limit=1&offset=0',
      )
      const secondPage = await asPlatform(
        'get',
        '/api/platform/accounts/deleted?limit=1&offset=1',
      )
      expect(firstPage.body.data.accounts).toHaveLength(1)
      expect(secondPage.body.data.accounts).toHaveLength(1)
      expect(firstPage.body.data.accounts[0].id).not.toBe(
        secondPage.body.data.accounts[0].id,
      )

      // No dashboard route can remove or rewrite the history.
      const remove = await asPlatform(
        'delete',
        `/api/platform/accounts/deleted/${record.id}`,
      )
      const rewrite = await asPlatform(
        'patch',
        `/api/platform/accounts/deleted/${record.id}`,
      )
      expect(remove.status).toBe(404)
      expect(rewrite.status).toBe(404)

      const stillThere = await asPlatform('get', '/api/platform/accounts/deleted')
      expect(stillThere.body.data.total).toBe(2)
    })
  })

  describe('restoration', () => {
    it('requires confirmation, reports conflicts and never restores sessions or school access', async () => {
      const deleted = await deleteAccount(
        teacherId,
        'ama@school.test',
        'Resigned',
      )
      const deletionId = deleted.body.data.account.id as string

      const mismatch = await asPlatform(
        'post',
        `/api/platform/accounts/deleted/${deletionId}/restore`,
      ).send({ confirmEmail: 'wrong@school.test' })
      expect(mismatch.status).toBe(400)
      expect(mismatch.body.error.code).toBe('confirmation_mismatch')

      // A second account now owns the email address.
      platform.managedAccounts.push({
        id: 'conflict-account',
        firstName: 'New',
        lastName: 'Owner',
        email: 'ama@school.test',
        role: 'CLASS_TEACHER',
        isPlatformAdmin: false,
        isActive: true,
        deletedAt: null,
        schoolId: 'school-1',
        schoolName: 'Accra Basic School',
        lastLoginAt: null,
        createdAt: '2026-03-01T07:00:00.000Z',
      })

      const conflict = await asPlatform(
        'post',
        `/api/platform/accounts/deleted/${deletionId}/restore`,
      ).send({ confirmEmail: 'ama@school.test' })
      expect(conflict.status).toBe(409)
      expect(conflict.body.error.code).toBe('conflict')
      expect(conflict.body.error.details).toEqual([
        {
          field: 'email',
          message:
            'This email address is currently assigned to another account. Resolve the conflict before restoring.',
        },
      ])

      platform.managedAccounts = platform.managedAccounts.filter(
        (account) => account.id !== 'conflict-account',
      )

      const restored = await asPlatform(
        'post',
        `/api/platform/accounts/deleted/${deletionId}/restore`,
      ).send({
        confirmEmail: 'ama@school.test',
        reason: 'Rehired by the school',
      })

      expect(restored.status).toBe(200)
      expect(restored.body.data.membershipsRestored).toBe(false)
      expect(restored.body.data.restoredUserId).toBe(teacherId)
      expect(restored.body.data.account).toMatchObject({
        status: 'RESTORED',
        reason: 'Resigned',
        restoreReason: 'Rehired by the school',
        restoredByName: 'Platform Admin',
        restoredByEmail: 'platform@example.com',
      })

      // The original deletion facts are untouched; only restore fields were added.
      expect(restored.body.data.account.deletedAt).toBe(
        deleted.body.data.account.deletedAt,
      )

      const active = auth.users.get(teacherId)!
      expect(active.deletedAt).toBeNull()
      expect(active.isActive).toBe(true)

      // Memberships remain suspended, so the restored account cannot re-enter
      // the school without an explicit membership decision.
      expect(auth.listMembershipsForSchool('school-1')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            userId: teacherId,
            status: 'SUSPENDED',
          }),
        ]),
      )

      // The old session stays revoked.
      const oldSession = await request(app)
        .get('/api/auth/me')
        .set('Cookie', cookie(teacherToken))
      expect(oldSession.status).toBe(401)

      // A fresh login succeeds but grants no school membership.
      const login = await request(app)
        .post('/api/auth/login')
        .set('Origin', TEST_ORIGIN)
        .send({ email: 'ama@school.test', password: TEST_PASSWORD })
      expect(login.status).toBe(200)
      expect(login.body.data.memberships).toEqual([])

      expect(platform.recordedAudits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'ACCOUNT_RESTORED',
            userId: teacherId,
            reason: 'Rehired by the school',
          }),
        ]),
      )

      const history = await asPlatform('get', '/api/platform/accounts/deleted')
      const record = history.body.data.accounts.find(
        (item: { id: string }) => item.id === deletionId,
      )
      expect(record).toMatchObject({
        status: 'RESTORED',
        reason: 'Resigned',
        restoredByName: 'Platform Admin',
        restoreReason: 'Rehired by the school',
      })
    })

    it('refuses to restore a record that is already restored', async () => {
      const deleted = await deleteAccount(teacherId, 'ama@school.test')
      const deletionId = deleted.body.data.account.id as string

      await asPlatform(
        'post',
        `/api/platform/accounts/deleted/${deletionId}/restore`,
      ).send({ confirmEmail: 'ama@school.test' })

      const again = await asPlatform(
        'post',
        `/api/platform/accounts/deleted/${deletionId}/restore`,
      ).send({ confirmEmail: 'ama@school.test' })

      expect(again.status).toBe(409)
      expect(again.body.error.code).toBe('not_archived')
    })
  })

  describe('existing suspension behaviour', () => {
    it('still suspends and reactivates accounts and audits the change', async () => {
      const suspended = await asPlatform(
        'post',
        `/api/platform/accounts/${teacherId}/status`,
      ).send({ isActive: false, reason: 'Under review' })

      expect(suspended.status).toBe(200)
      expect(suspended.body.data.account.isActive).toBe(false)
      expect(platform.recordedAudits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'ACCOUNT_SUSPENDED',
            userId: teacherId,
            reason: 'Under review',
          }),
        ]),
      )

      const activated = await asPlatform(
        'post',
        `/api/platform/accounts/${teacherId}/status`,
      ).send({ isActive: true })

      expect(activated.status).toBe(200)
      expect(activated.body.data.account.isActive).toBe(true)
      expect(platform.recordedAudits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'ACCOUNT_ACTIVATED',
            userId: teacherId,
          }),
        ]),
      )
    })

    it('still blocks self-suspension', async () => {
      const response = await asPlatform(
        'post',
        `/api/platform/accounts/${platformUserId}/status`,
      ).send({ isActive: false })

      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe('self_suspension')
    })
  })
})
