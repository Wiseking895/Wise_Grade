import { PrismaPg } from '@prisma/adapter-pg'
import type { Express } from 'express'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { hashPassword, verifyPassword } from '../../src/auth/password.js'
import { hashToken } from '../../src/auth/tokens.js'
import { loadEnvFile } from '../../src/config/env-file.js'
import { PrismaClient } from '../../src/generated/prisma/client.js'
import { SESSION_COOKIE_NAME } from '../../src/lib/cookies.js'
import {
  registrationBody,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from '../helpers/auth-fixtures.js'
import {
  assertSafeIntegrationTarget,
  databaseName,
} from './target.js'

/**
 * Live PostgreSQL integration suite.
 *
 * Safety rules:
 * - Skipped entirely unless TEST_DATABASE_URL is set.
 * - Refuses to run in production, against DATABASE_URL itself, or against a
 *   database whose name does not contain "test".
 * - Deletes only rows created by this suite (tracked ids), never truncates.
 *
 * Required setup before running:
 *   1. Create a dedicated test database.
 *   2. Put DATABASE_URL and TEST_DATABASE_URL in backend/.env, or export both
 *      in the shell (shell values take precedence over the file).
 *   3. $env:DATABASE_URL = $env:TEST_DATABASE_URL
 *   4. npm run prisma:migrate:deploy
 *   5. npm run test:integration
 */

// The Vitest config already loads backend/.env. Loading again here keeps the
// suite self-contained and is idempotent; dotenv never overrides process env.
loadEnvFile(
  process.env.GRADELY_ENV_FILE ??
    fileURLToPath(new URL('../../.env', import.meta.url)),
)

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim() || undefined
const configuredDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined

const runIntegration = testDatabaseUrl !== undefined

// The skip decision depends only on presence. A configured but unsafe target
// throws here during collection, so misconfiguration is a loud failure instead
// of being silently skipped.
if (runIntegration) {
  assertSafeIntegrationTarget({
    testDatabaseUrl,
    databaseUrl: configuredDatabaseUrl,
    nodeEnv: process.env.NODE_ENV,
  })
}

describe.skipIf(!runIntegration)('PostgreSQL integration', () => {
  let app: Express
  let prisma: PrismaClient

  const createdSchoolIds: string[] = []
  const createdUserIds: string[] = []
  let counter = 0

  function nextSuffix(): string {
    counter += 1
    return `${Date.now().toString(36)}-${counter}-${Math.random()
      .toString(36)
      .slice(2, 8)}`
  }

  function trackUser(id: string | undefined): void {
    if (id) {
      createdUserIds.push(id)
    }
  }

  function trackSchool(id: string | undefined): void {
    if (id) {
      createdSchoolIds.push(id)
    }
  }

  async function registerSchool(label: string) {
    const suffix = nextSuffix()
    const agent = request.agent(app)
    const response = await agent
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(
        registrationBody({
          schoolName: `IT ${label} ${suffix}`,
          firstName: 'Integration',
          lastName: label,
          email: `it-${label}-${suffix}@gradely-integration.test`,
        }),
      )

    trackUser(response.body?.data?.user?.id)
    trackSchool(response.body?.data?.school?.id)

    const userId = response.body?.data?.user?.id
    if (typeof userId === 'string') {
      await prisma.user.update({
        where: { id: userId },
        data: {
          emailVerifiedAt: new Date(),
          emailVerificationRequired: false,
        },
      })
    }

    return { response, agent, suffix }
  }

  beforeAll(async () => {
    // Re-check immediately before connecting, using the values captured at
    // module load. The target must never be production or the dev database.
    assertSafeIntegrationTarget({
      testDatabaseUrl: testDatabaseUrl!,
      databaseUrl: configuredDatabaseUrl,
      nodeEnv: process.env.NODE_ENV,
    })

    // The application repository reads DATABASE_URL through validated env.
    // Point it at the test database before the app module is imported.
    process.env.DATABASE_URL = testDatabaseUrl

    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: testDatabaseUrl! }),
    })

    const { createApp } = await import('../../src/app.js')
    app = createApp({
      loginRateLimit: { windowMs: 60_000, max: 1_000 },
    })
  }, 30_000)

  afterAll(async () => {
    if (!prisma) {
      return
    }

    try {
      if (createdSchoolIds.length > 0 || createdUserIds.length > 0) {
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

  it('connects through the PostgreSQL adapter', async () => {
    const rows = await prisma.$queryRaw<{ value: number }[]>`
      SELECT 1::int AS value
    `
    expect(rows[0]?.value).toBe(1)

    const databases = await prisma.$queryRaw<{ name: string }[]>`
      SELECT current_database() AS name
    `
    expect(databases[0]?.name).toBe(databaseName(testDatabaseUrl!))
  })

  it('has the initial migration applied', async () => {
    const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name
      FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL
    `

    const names = rows.map((row) => row.migration_name)

    expect(names).toContain('20261104120000_init')
  })

  it('creates school, administrator, membership, and audit atomically', async () => {
    const { response } = await registerSchool('register')
    const body = response.body.data

    expect(response.status).toBe(201)

    const user = await prisma.user.findUnique({
      where: { id: body.user.id },
      include: { memberships: true },
    })

    expect(user).not.toBeNull()
    expect(user?.email).toBe(body.user.email.toLowerCase())
    expect(user?.isPlatformAdmin).toBe(false)
    expect(user?.passwordHash.startsWith('scrypt$')).toBe(true)
    await expect(
      verifyPassword(TEST_PASSWORD, user!.passwordHash),
    ).resolves.toBe(true)

    expect(user?.memberships).toHaveLength(1)
    expect(user?.memberships[0]).toMatchObject({
      schoolId: body.school.id,
      role: 'SCHOOL_ADMIN',
      status: 'ACTIVE',
    })

    const school = await prisma.school.findUnique({
      where: { id: body.school.id },
    })
    expect(school?.name).toBe(body.school.name)

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'SCHOOL_REGISTERED', schoolId: body.school.id },
    })
    expect(audit).not.toBeNull()

    // Registration seeds the standard class structure but never a subject
    // catalogue. Class teachers add their own class subjects later.
    const classes = await prisma.schoolClass.count({
      where: { schoolId: body.school.id },
    })
    expect(classes).toBeGreaterThan(0)

    const subjects = await prisma.subject.count({
      where: { schoolId: body.school.id },
    })
    expect(subjects).toBe(0)

    const classSubjects = await prisma.classSubject.count({
      where: { schoolId: body.school.id },
    })
    expect(classSubjects).toBe(0)
  })

  it('rolls back the whole transaction when the email is already used', async () => {
    const first = await registerSchool('rollback-a')
    const firstBody = first.response.body.data
    const duplicateSchoolName = `IT rollback-b ${nextSuffix()}`

    const duplicate = await request(app)
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(
        registrationBody({
          schoolName: duplicateSchoolName,
          email: firstBody.user.email,
        }),
      )

    expect(duplicate.status).toBe(409)

    const rolledBackSchools = await prisma.school.count({
      where: { name: duplicateSchoolName },
    })

    expect(rolledBackSchools).toBe(0)

    const userCount = await prisma.user.count({
      where: { email: firstBody.user.email },
    })
    expect(userCount).toBe(1)
  })

  it('persists a login session and authenticates /api/auth/me', async () => {
    const { response: registration, suffix } = await registerSchool('login')
    const email = registration.body.data.user.email

    const agent = request.agent(app)
    const login = await agent
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email, password: TEST_PASSWORD })

    expect(login.status).toBe(200)
    trackUser(login.body.data.user.id)

    const cookies = login.headers['set-cookie'] as unknown as string[]
    const sessionCookie = cookies.find((cookie) =>
      cookie.startsWith(`${SESSION_COOKIE_NAME}=`),
    )

    expect(sessionCookie).toBeDefined()

    const rawToken = sessionCookie!
      .split(';')[0]!
      .slice(`${SESSION_COOKIE_NAME}=`.length)

    const storedSession = await prisma.session.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    })

    expect(storedSession).not.toBeNull()
    expect(storedSession?.tokenHash).not.toBe(rawToken)
    expect(storedSession?.tokenHash).toMatch(/^[a-f0-9]{64}$/)
    expect(storedSession?.expiresAt.getTime()).toBeGreaterThan(Date.now())

    const me = await agent.get('/api/auth/me')
    expect(me.status).toBe(200)
    expect(me.body.data.user.email).toBe(email)
    expect(me.body.data.memberships[0].schoolName).toContain(suffix)
  })

  it('enforces school membership and cross-school isolation', async () => {
    const schoolA = await registerSchool('tenant-a')
    const schoolB = await registerSchool('tenant-b')

    const schoolAId = schoolA.response.body.data.school.id
    const schoolBId = schoolB.response.body.data.school.id

    const ownSchool = await schoolA.agent.get(`/api/schools/${schoolAId}`)
    expect(ownSchool.status).toBe(200)
    expect(ownSchool.body.data.membership.role).toBe('SCHOOL_ADMIN')

    const otherSchool = await schoolA.agent.get(`/api/schools/${schoolBId}`)
    expect(otherSchool.status).toBe(403)

    const otherMembers = await schoolA.agent.get(
      `/api/schools/${schoolBId}/members`,
    )
    expect(otherMembers.status).toBe(403)

    const ownMembers = await schoolA.agent.get(
      `/api/schools/${schoolAId}/members`,
    )
    expect(ownMembers.status).toBe(200)
    expect(ownMembers.body.data.members).toHaveLength(1)
    expect(ownMembers.body.data.members[0].email).toBe(
      schoolA.response.body.data.user.email,
    )
  })

  it('revokes the persisted session on logout', async () => {
    const { agent, response } = await registerSchool('logout')
    const userId = response.body.data.user.id

    const logout = await agent
      .post('/api/auth/logout')
      .set('Origin', TEST_ORIGIN)

    expect(logout.status).toBe(200)

    const me = await agent.get('/api/auth/me')
    expect(me.status).toBe(401)

    const sessions = await prisma.session.findMany({ where: { userId } })
    expect(sessions.length).toBeGreaterThan(0)
    expect(sessions.every((session) => session.revokedAt !== null)).toBe(true)
  })

  it('enforces database uniqueness constraints', async () => {
    const { response } = await registerSchool('unique')
    const body = response.body.data
    const userId = body.user.id
    const schoolId = body.school.id

    const passwordHash = await hashPassword(TEST_PASSWORD)

    await expect(
      prisma.user.create({
        data: {
          email: body.user.email,
          passwordHash,
          firstName: 'Duplicate',
          lastName: 'Email',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })

    await expect(
      prisma.school.create({
        data: {
          name: 'Duplicate slug school',
          slug: body.school.slug,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })

    await expect(
      prisma.schoolMembership.create({
        data: { schoolId, userId, role: 'CLASS_TEACHER' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })
})
