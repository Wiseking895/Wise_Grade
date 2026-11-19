import { PrismaPg } from '@prisma/adapter-pg'
import type { Express } from 'express'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { hashPassword } from '../../src/auth/password.js'
import { hashToken } from '../../src/auth/tokens.js'
import { loadEnvFile } from '../../src/config/env-file.js'
import { PrismaClient } from '../../src/generated/prisma/client.js'
import {
  SESSION_COOKIE_NAME,
  SUBJECT_SESSION_COOKIE_NAME,
} from '../../src/lib/cookies.js'
import {
  registrationBody,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from '../helpers/auth-fixtures.js'
import { assertSafeIntegrationTarget } from './target.js'

/**
 * Live PostgreSQL regression suite for school suspension enforcement.
 *
 * It proves, against the real repositories and the real platform status route,
 * that a suspended school loses tenant access immediately for existing and new
 * sessions while Platform Super Admin oversight and unrelated active-school
 * memberships keep working.
 *
 * Safety rules match `postgres.integration.test.ts`: skipped unless
 * TEST_DATABASE_URL is set, refuses production/dev targets, and deletes only
 * the rows this suite created (tracked ids), never truncating anything.
 */

loadEnvFile(
  process.env.GRADELY_ENV_FILE ??
    fileURLToPath(new URL('../../.env', import.meta.url)),
)

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim() || undefined
const configuredDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined
const runIntegration = testDatabaseUrl !== undefined

if (runIntegration) {
  assertSafeIntegrationTarget({
    testDatabaseUrl,
    databaseUrl: configuredDatabaseUrl,
    nodeEnv: process.env.NODE_ENV,
  })
}

describe.skipIf(!runIntegration)('School suspension integration', () => {
  let app: Express
  let prisma: PrismaClient

  const createdSchoolIds: string[] = []
  const createdUserIds: string[] = []
  let counter = 0

  let platformUserId = ''
  let platformCookie = ''

  function nextSuffix(): string {
    counter += 1
    return `${Date.now().toString(36)}-${counter}-${Math.random()
      .toString(36)
      .slice(2, 8)}`
  }

  function trackSchool(id: string | undefined): void {
    if (id) createdSchoolIds.push(id)
  }

  function trackUser(id: string | undefined): void {
    if (id) createdUserIds.push(id)
  }

  async function registerSchool(label: string) {
    const suffix = nextSuffix()
    const email = `susp-${label}-${suffix}@gradely-integration.test`
    const agent = request.agent(app)
    const response = await agent
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(
        registrationBody({
          schoolName: `SUSP ${label} ${suffix}`,
          firstName: 'Suspension',
          lastName: label,
          email,
        }),
      )

    expect(response.status).toBe(201)

    const schoolId = response.body.data.school.id as string
    const userId = response.body.data.user.id as string
    trackSchool(schoolId)
    trackUser(userId)
    await prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date(), emailVerificationRequired: false },
    })

    return { agent, schoolId, userId, email }
  }

  async function login(email: string) {
    const agent = request.agent(app)
    const response = await agent
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email, password: TEST_PASSWORD })

    return { agent, response }
  }

  async function setSchoolActive(schoolId: string, isActive: boolean) {
    return request(app)
      .post(`/api/platform/schools/${schoolId}/status`)
      .set('Cookie', platformCookie)
      .set('Origin', TEST_ORIGIN)
      .send({ isActive })
  }

  async function createSubjectTeacherAccessCode(
    schoolId: string,
    code: string,
    suffix: string,
  ): Promise<void> {
    const schoolClass = await prisma.schoolClass.findFirst({
      where: { schoolId },
      orderBy: { sortOrder: 'asc' },
    })
    expect(schoolClass).not.toBeNull()

    const subject = await prisma.subject.create({
      data: {
        schoolId,
        name: `Mathematics ${suffix}`,
        code: 'MATH',
      },
    })
    await prisma.classSubject.create({
      data: {
        schoolId,
        classId: schoolClass!.id,
        subjectId: subject.id,
      },
    })
    const assignment = await prisma.subjectTeacherAssignment.create({
      data: {
        schoolId,
        classId: schoolClass!.id,
        subjectId: subject.id,
        firstName: 'Subject',
        lastName: 'Teacher',
        email: `subject-${suffix}@gradely-integration.test`,
      },
    })
    await prisma.subjectTeacherInvitation.create({
      data: {
        schoolId,
        classId: schoolClass!.id,
        subjectId: subject.id,
        assignmentId: assignment.id,
        codeHash: hashToken(code),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    })
  }

  function cookieFrom(
    response: request.Response,
    name: string,
  ): string {
    const header = response.headers['set-cookie'] as unknown as
      | string[]
      | undefined
    const match = (header ?? []).find((cookie) =>
      cookie.startsWith(`${name}=`),
    )
    return match ? match.split(';')[0]! : ''
  }

  beforeAll(async () => {
    assertSafeIntegrationTarget({
      testDatabaseUrl: testDatabaseUrl!,
      databaseUrl: configuredDatabaseUrl,
      nodeEnv: process.env.NODE_ENV,
    })

    process.env.DATABASE_URL = testDatabaseUrl

    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: testDatabaseUrl! }),
    })

    const { createApp } = await import('../../src/app.js')
    app = createApp({
      loginRateLimit: { windowMs: 60_000, max: 1_000 },
      passwordResetRateLimit: { windowMs: 60_000, max: 1_000 },
    })

    const suffix = nextSuffix()
    const platformUser = await prisma.user.create({
      data: {
        email: `susp-platform-${suffix}@gradely-integration.test`,
        passwordHash: await hashPassword(TEST_PASSWORD),
        firstName: 'Platform',
        lastName: 'Oversight',
        isPlatformAdmin: true,
        isActive: true,
      },
    })
    platformUserId = platformUser.id
    trackUser(platformUserId)

    const platformLogin = await login(platformUser.email)
    expect(platformLogin.response.status).toBe(200)
    platformCookie = `${SESSION_COOKIE_NAME}=${
      (
        platformLogin.response.headers['set-cookie'] as unknown as string[]
      )
        .find((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`))!
        .split(';')[0]!
        .slice(`${SESSION_COOKIE_NAME}=`.length)
    }`
  }, 30_000)

  afterAll(async () => {
    if (!prisma) return

    try {
      if (createdSchoolIds.length > 0 || createdUserIds.length > 0) {
        await prisma.platformNotification.deleteMany({
          where: {
            OR: [
              { schoolId: { in: createdSchoolIds } },
              { entityId: { in: createdUserIds } },
            ],
          },
        })

        await prisma.auditLog.deleteMany({
          where: {
            OR: [
              { schoolId: { in: createdSchoolIds } },
              { actorUserId: { in: createdUserIds } },
            ],
          },
        })
      }

      if (createdSchoolIds.length > 0) {
        await prisma.school.deleteMany({
          where: { id: { in: createdSchoolIds } },
        })
      }

      if (createdUserIds.length > 0) {
        await prisma.user.deleteMany({
          where: { id: { in: createdUserIds } },
        })
      }
    } finally {
      await prisma.$disconnect()
    }
  }, 30_000)

  it('denies a suspended school to an existing administrator session and to new logins', async () => {
    const school = await registerSchool('admin')

    expect((await school.agent.get(`/api/schools/${school.schoolId}`)).status).toBe(200)
    expect((await school.agent.get(`/api/schools/${school.schoolId}/pupils`)).status).toBe(200)

    const sessionsBefore = await prisma.session.count({
      where: { userId: school.userId },
    })

    const suspended = await setSchoolActive(school.schoolId, false)
    expect(suspended.status).toBe(200)
    expect(suspended.body.data.school.isActive).toBe(false)

    // The existing session loses every school surface immediately.
    const dashboard = await school.agent.get(`/api/schools/${school.schoolId}`)
    expect(dashboard.status).toBe(403)
    expect(dashboard.body.error.message).toBe(
      'You do not have access to this school',
    )
    expect(
      (await school.agent.get(`/api/schools/${school.schoolId}/pupils`)).status,
    ).toBe(403)

    // The account is not disabled and /me reports no usable membership.
    const me = await school.agent.get('/api/auth/me')
    expect(me.status).toBe(200)
    expect(me.body.data.memberships).toEqual([])

    // A fresh login is refused with a generic response and no session.
    const relogin = await login(school.email)
    expect(relogin.response.status).toBe(403)
    expect(relogin.response.body.error.message).toBe('Access denied')
    expect(
      await prisma.session.count({ where: { userId: school.userId } }),
    ).toBe(sessionsBefore)

    // Data is preserved and the action is audited and notified.
    const schoolRow = await prisma.school.findUnique({
      where: { id: school.schoolId },
    })
    expect(schoolRow).not.toBeNull()
    expect(schoolRow?.isActive).toBe(false)
    expect(
      await prisma.schoolMembership.count({
        where: { schoolId: school.schoolId },
      }),
    ).toBe(1)
    expect(
      await prisma.auditLog.count({
        where: { schoolId: school.schoolId, action: 'SCHOOL_SUSPENDED' },
      }),
    ).toBe(1)
    expect(
      await prisma.platformNotification.count({
        where: { schoolId: school.schoolId, type: 'SCHOOL_SUSPENDED' },
      }),
    ).toBe(1)

    // Reactivation restores legitimate access without a new login.
    const reactivated = await setSchoolActive(school.schoolId, true)
    expect(reactivated.status).toBe(200)
    expect((await school.agent.get(`/api/schools/${school.schoolId}`)).status).toBe(200)

    const afterReactivation = await login(school.email)
    expect(afterReactivation.response.status).toBe(200)
    expect(afterReactivation.response.body.data.memberships).toHaveLength(1)
    expect(
      await prisma.auditLog.count({
        where: { schoolId: school.schoolId, action: 'SCHOOL_ACTIVATED' },
      }),
    ).toBe(1)
  }, 60_000)

  it('blocks only the suspended school for a user with two memberships', async () => {
    const schoolA = await registerSchool('multi-a')
    const schoolB = await registerSchool('multi-b')

    await prisma.schoolMembership.create({
      data: {
        schoolId: schoolB.schoolId,
        userId: schoolA.userId,
        role: 'CLASS_TEACHER',
        status: 'ACTIVE',
      },
    })

    const agent = request.agent(app)
    const loginResponse = await agent
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: schoolA.email, password: TEST_PASSWORD })
    expect(loginResponse.status).toBe(200)
    expect(loginResponse.body.data.memberships).toHaveLength(2)

    expect((await agent.get(`/api/schools/${schoolA.schoolId}`)).status).toBe(200)
    expect((await agent.get(`/api/schools/${schoolB.schoolId}`)).status).toBe(200)

    expect((await setSchoolActive(schoolA.schoolId, false)).status).toBe(200)

    expect((await agent.get(`/api/schools/${schoolA.schoolId}`)).status).toBe(403)
    expect((await agent.get(`/api/schools/${schoolB.schoolId}`)).status).toBe(200)

    const me = await agent.get('/api/auth/me')
    expect(me.status).toBe(200)
    expect(me.body.data.memberships).toHaveLength(1)
    expect(me.body.data.memberships[0].schoolId).toBe(schoolB.schoolId)

    const relogin = await login(schoolA.email)
    expect(relogin.response.status).toBe(200)
    expect(relogin.response.body.data.memberships).toHaveLength(1)
    expect(relogin.response.body.data.memberships[0].schoolId).toBe(
      schoolB.schoolId,
    )

    // Reactivating A restores it, while B was never affected.
    expect((await setSchoolActive(schoolA.schoolId, true)).status).toBe(200)
    expect((await agent.get(`/api/schools/${schoolA.schoolId}`)).status).toBe(200)
    expect((await agent.get(`/api/schools/${schoolB.schoolId}`)).status).toBe(200)
  }, 60_000)

  it('invalidates subject-teacher access-code sessions while the school is suspended', async () => {
    const school = await registerSchool('subject')
    const code = `${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}Kmw`
    await createSubjectTeacherAccessCode(school.schoolId, code, nextSuffix())

    const subjectAgent = request.agent(app)
    const entered = await subjectAgent
      .post('/api/auth/subject-teacher/access-code')
      .set('Origin', TEST_ORIGIN)
      .send({ code })
    expect(entered.status).toBe(200)
    const cookie = cookieFrom(entered, SUBJECT_SESSION_COOKIE_NAME)
    expect(cookie).not.toBe('')

    expect(
      (
        await request(app)
          .get('/api/auth/subject-teacher/me')
          .set('Cookie', cookie)
      ).status,
    ).toBe(200)

    expect((await setSchoolActive(school.schoolId, false)).status).toBe(200)

    expect(
      (
        await request(app)
          .get('/api/auth/subject-teacher/me')
          .set('Cookie', cookie)
      ).status,
    ).toBe(401)

    const reentry = await request(app)
      .post('/api/auth/subject-teacher/access-code')
      .set('Origin', TEST_ORIGIN)
      .send({ code })
    expect(reentry.status).toBe(401)

    // Reactivation restores the access-code flow. The session was never
    // revoked (only gated by school status), so the original cookie resumes;
    // independently revoked or expired sessions stay dead.
    expect((await setSchoolActive(school.schoolId, true)).status).toBe(200)
    expect(
      (
        await request(app)
          .get('/api/auth/subject-teacher/me')
          .set('Cookie', cookie)
      ).status,
    ).toBe(200)
  }, 60_000)

  it('keeps platform oversight and does not grant platform admins tenant access', async () => {
    const school = await registerSchool('oversight')
    expect((await setSchoolActive(school.schoolId, false)).status).toBe(200)

    const list = await request(app)
      .get('/api/platform/schools?status=suspended')
      .set('Cookie', platformCookie)
    expect(list.status).toBe(200)
    expect(
      list.body.data.schools.some(
        (item: { id: string }) => item.id === school.schoolId,
      ),
    ).toBe(true)

    const detail = await request(app)
      .get(`/api/platform/schools/${school.schoolId}`)
      .set('Cookie', platformCookie)
    expect(detail.status).toBe(200)
    expect(detail.body.data.school.isActive).toBe(false)

    const tenantAccess = await request(app)
      .get(`/api/schools/${school.schoolId}`)
      .set('Cookie', platformCookie)
    expect(tenantAccess.status).toBe(403)

    const reactivated = await setSchoolActive(school.schoolId, true)
    expect(reactivated.status).toBe(200)
    expect(reactivated.body.data.school.isActive).toBe(true)
  }, 60_000)

  it('leaves unauthenticated and cross-school requests denied', async () => {
    const schoolA = await registerSchool('security-a')
    const schoolB = await registerSchool('security-b')

    expect((await request(app).get(`/api/schools/${schoolA.schoolId}`)).status).toBe(401)
    expect((await schoolA.agent.get(`/api/schools/${schoolB.schoolId}`)).status).toBe(403)

    expect((await setSchoolActive(schoolA.schoolId, false)).status).toBe(200)
    expect(
      (
        await schoolA.agent.get(
          `/api/schools/${schoolA.schoolId}/academic-years`,
        )
      ).status,
    ).toBe(403)
    expect(
      (await schoolA.agent.get(`/api/schools/${schoolA.schoolId}/members`)).status,
    ).toBe(403)
    expect(
      (await schoolA.agent.get(`/api/schools/${schoolB.schoolId}`)).status,
    ).toBe(403)
  }, 60_000)
})
