import { PrismaPg } from '@prisma/adapter-pg'
import type { Express } from 'express'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { hashPassword } from '../../src/auth/password.js'
import { loadEnvFile } from '../../src/config/env-file.js'
import { PrismaClient } from '../../src/generated/prisma/client.js'
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
 * Live Phase 4 assessment/results integration suite.
 *
 * Skipped entirely unless TEST_DATABASE_URL is set. The same safety guards as
 * the Phase 2/3 PostgreSQL suite apply: never production, never DATABASE_URL,
 * and the database name must contain "test".
 *
 * The suite exercises the real HTTP API and Prisma persistence for policy
 * configuration, grading schemes, teacher permissions, drafts, locking,
 * correction, concurrency, audit history and historical grading snapshots.
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

interface Fixture {
  schoolId: string
  yearId: string
  termId: string
  classId: string
  englishId: string
  mathId: string
  pupilIds: string[]
  schemeId: string
  classTeacherEmail: string
  subjectTeacherEmail: string
  classTeacherMembershipId: string
  subjectTeacherAccessCode: string
}

describe.skipIf(!runIntegration)('Phase 4 assessment integration', () => {
  let app: Express
  let prisma: PrismaClient
  let admin: ReturnType<typeof request.agent>
  let fixture: Fixture

  const createdSchoolIds: string[] = []
  const createdUserIds: string[] = []
  const componentIds: Record<string, string> = {}

  let counter = 0

  function nextSuffix(): string {
    counter += 1
    return `${Date.now().toString(36)}-${counter}-${Math.random()
      .toString(36)
      .slice(2, 8)}`
  }

  function trackSchool(id: unknown): void {
    if (typeof id === 'string') {
      createdSchoolIds.push(id)
    }
  }

  function trackUser(id: unknown): void {
    if (typeof id === 'string') {
      createdUserIds.push(id)
    }
  }

  function data<T>(response: { body: { data?: T } }): T {
    expect(response.body.data).toBeDefined()
    return response.body.data as T
  }

  async function login(email: string) {
    const agent = request.agent(app)
    const response = await agent
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email, password: TEST_PASSWORD })
    expect(response.status).toBe(200)
    return agent
  }

  /** Opens a restricted subject session with a reusable teacher access code. */
  async function enterAccessCode(code: string) {
    const agent = request.agent(app)
    const response = await agent
      .post('/api/auth/subject-teacher/access-code')
      .set('Origin', TEST_ORIGIN)
      .send({ code })
    expect(response.status).toBe(200)
    return agent
  }

  let platformAgent: ReturnType<typeof request.agent> | null = null

  /**
   * Academic review is platform-only. The platform administrator holds no
   * school membership, so the review is recorded against the platform user.
   */
  async function ensurePlatformAgent() {
    if (platformAgent) {
      return platformAgent
    }

    const email = `it-platform-${nextSuffix()}@gradely-integration.test`
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(TEST_PASSWORD),
        firstName: 'Platform',
        lastName: 'Reviewer',
        isPlatformAdmin: true,
      },
    })
    trackUser(user.id)
    platformAgent = await login(email)
    return platformAgent
  }

  /**
   * Assessment policies and grading schemes are system-managed, so the suite
   * seeds the custom 40/60 policy directly instead of calling the blocked
   * school configuration endpoints.
   */
  async function seedClassPolicy() {
    const scheme = await prisma.gradingScheme.create({
      data: {
        schoolId: fixture.schoolId,
        academicYearId: fixture.yearId,
        academicTermId: fixture.termId,
        name: 'Integration example scale',
        isActive: true,
        bands: {
          create: [
            {
              schoolId: fixture.schoolId,
              minScore: '80.00',
              maxScore: '100.00',
              gradeLabel: 'A1',
              remark: 'Excellent',
              sortOrder: 0,
            },
            {
              schoolId: fixture.schoolId,
              minScore: '75.00',
              maxScore: '79.99',
              gradeLabel: 'B2',
              remark: 'Very good',
              sortOrder: 1,
            },
            {
              schoolId: fixture.schoolId,
              minScore: '70.00',
              maxScore: '74.99',
              gradeLabel: 'B3',
              remark: 'Good',
              sortOrder: 2,
            },
            {
              schoolId: fixture.schoolId,
              minScore: '0.00',
              maxScore: '69.99',
              gradeLabel: 'F9',
              remark: 'Needs support',
              sortOrder: 3,
            },
          ],
        },
      },
    })

    fixture.schemeId = scheme.id

    const components = [
      {
        key: 'class-test',
        name: 'Class test',
        category: 'SBA' as const,
        maximumScore: '20.00',
        weightPercent: '20.00',
        sortOrder: 0,
      },
      {
        key: 'project',
        name: 'Project',
        category: 'SBA' as const,
        maximumScore: '10.00',
        weightPercent: '10.00',
        sortOrder: 1,
      },
      {
        key: 'homework',
        name: 'Homework',
        category: 'SBA' as const,
        maximumScore: '10.00',
        weightPercent: '10.00',
        sortOrder: 2,
      },
      {
        key: 'examination',
        name: 'Examination',
        category: 'EXAM' as const,
        maximumScore: '100.00',
        weightPercent: '60.00',
        sortOrder: 3,
      },
    ]

    const createPolicy = (version: number, name: string) =>
      prisma.assessmentPolicy.create({
        data: {
          schoolId: fixture.schoolId,
          academicYearId: fixture.yearId,
          academicTermId: fixture.termId,
          classId: fixture.classId,
          gradingSchemeId: scheme.id,
          name,
          scopeKey: `class:${fixture.classId}`,
          version,
          isActive: true,
          isDefault: false,
          calculationMode: 'COMPONENT_WEIGHTED',
          components: {
            create: components.map((component) => ({
              schoolId: fixture.schoolId,
              ...component,
            })),
          },
        },
        include: { components: true },
      })

    const first = await createPolicy(1, 'Basic 1 40/60 policy')

    for (const component of first.components) {
      componentIds[component.key] = component.id
    }

    // Create a second version exactly as the old API did, then leave only v2
    // active so score entry resolves the active version's component ids.
    await prisma.assessmentPolicy.update({
      where: { id: first.id },
      data: { isActive: false },
    })

    const replacement = await createPolicy(2, 'Basic 1 40/60 policy v2')

    for (const component of replacement.components) {
      componentIds[component.key] = component.id
    }

    return { scheme, first, replacement }
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
      registrationRateLimit: { windowMs: 60_000, max: 1_000 },
      passwordResetRateLimit: { windowMs: 60_000, max: 1_000 },
    })

    const databases = await prisma.$queryRaw<{ name: string }[]>`
      SELECT current_database() AS name
    `
    expect(databases[0]?.name).toBe(databaseName(testDatabaseUrl!))
  }, 30_000)

  afterAll(async () => {
    if (!prisma) {
      return
    }

    try {
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

  it('creates the school, calendar, class, subjects and pupil roster', async () => {
    const suffix = nextSuffix()
    admin = request.agent(app)

    const registration = await admin
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(
        registrationBody({
          schoolName: `IT assessment ${suffix}`,
          firstName: 'Assessment',
          lastName: 'Admin',
          email: `it-assessment-${suffix}@gradely-integration.test`,
        }),
      )

    expect(registration.status).toBe(201)
    const registrationData = data<{
      school: { id: string }
      user: { id: string }
    }>(registration)
    const schoolId = registrationData.school.id
    trackSchool(schoolId)
    trackUser(registrationData.user.id)
    await prisma.user.update({
      where: { id: registrationData.user.id },
      data: { emailVerifiedAt: new Date(), emailVerificationRequired: false },
    })
    // Subject-teacher access codes require a configured, still-open session.
    await prisma.school.update({
      where: { id: schoolId },
      data: {
        reopeningDate: new Date('2020-01-01T00:00:00.000Z'),
        closingDate: new Date('2099-12-31T00:00:00.000Z'),
      },
    })

    const years = await admin.get(
      `/api/schools/${schoolId}/academic-years`,
    )
    expect(years.status).toBe(200)
    const academicYears = data<{
      academicYears: Array<{
        id: string
        isCurrent: boolean
        terms: Array<{ id: string; sequence: number; isCurrent: boolean }>
      }>
    }>(years).academicYears
    const academicYear = academicYears.find((item) => item.isCurrent)
    expect(academicYear).toBeDefined()
    expect(academicYear!.terms.map((item) => item.sequence)).toEqual([
      1, 2, 3,
    ])
    expect(academicYear!.terms.filter((item) => item.isCurrent)).toHaveLength(1)
    const yearId = academicYear!.id
    const termId = academicYear!.terms.find(
      (item) => item.sequence === 1,
    )!.id

    const classes = await admin
      .post(`/api/schools/${schoolId}/classes/seed-defaults`)
      .set('Origin', TEST_ORIGIN)
      .send({})
    expect(classes.status).toBe(200)
    const classList = data<{ classes: Array<{ id: string; name: string }> }>(
      classes,
    ).classes
    const basicOne = classList.find((item) => item.name === 'Basic 1')
    expect(basicOne).toBeDefined()

    const subjects = await admin
      .post(`/api/schools/${schoolId}/subjects/seed-defaults`)
      .set('Origin', TEST_ORIGIN)
      .send({})
    expect(subjects.status).toBe(404)

    const classTeacherEmail = `it-ct-${suffix}@gradely-integration.test`
    const subjectTeacherEmail = `it-st-${suffix}@gradely-integration.test`

    // The administrator registers the class and its class teacher together.
    // Subjects, pupils and subject teachers are registered later by the class
    // teacher.
    const classTeacher = await admin
      .post(`/api/schools/${schoolId}/classes/register`)
      .set('Origin', TEST_ORIGIN)
      .send({
        className: 'Basic 1',
        teacher: {
          firstName: 'Class',
          lastName: 'Teacher',
          email: classTeacherEmail,
        },
      })
    expect(classTeacher.status).toBe(201)
    const registered = data<{
      class: { id: string }
      teacher: { membershipId: string; userId: string }
    }>(classTeacher)
    expect(registered.class.id).toBe(basicOne!.id)
    trackUser(registered.teacher.userId)
    await prisma.user.update({
      where: { id: registered.teacher.userId },
      data: {
        passwordHash: await hashPassword(TEST_PASSWORD),
        mustChangePassword: false,
      },
    })

    fixture = {
      schoolId,
      yearId,
      termId,
      classId: basicOne!.id,
      englishId: '',
      mathId: '',
      pupilIds: [],
      schemeId: '',
      classTeacherEmail,
      subjectTeacherEmail,
      classTeacherMembershipId: registered.teacher.membershipId,
      subjectTeacherAccessCode: '',
    }

    const ctAgent = await login(classTeacherEmail)

    // Subjects exist only because the class teacher deliberately adds them to
    // their own class. No default catalogue is created by registration.
    const english = await ctAgent
      .post(`/api/schools/${schoolId}/classes/${basicOne!.id}/subjects`)
      .set('Origin', TEST_ORIGIN)
      .send({ name: 'English Language', code: 'ENG' })
    expect(english.status).toBe(201)
    const englishId = data<{
      assignment: { subjectId: string }
    }>(english).assignment.subjectId

    const math = await ctAgent
      .post(`/api/schools/${schoolId}/classes/${basicOne!.id}/subjects`)
      .set('Origin', TEST_ORIGIN)
      .send({ name: 'Mathematics', code: 'MATH' })
    expect(math.status).toBe(201)
    const mathId = data<{ assignment: { subjectId: string } }>(
      math,
    ).assignment.subjectId

    fixture.englishId = englishId
    fixture.mathId = mathId

    // Class subjects are managed by the assigned class teacher, not the
    // school administrator.
    for (const subjectId of [englishId, mathId]) {
      const assignment = await ctAgent
        .post(`/api/schools/${schoolId}/classes/${basicOne!.id}/subjects`)
        .set('Origin', TEST_ORIGIN)
        .send({ subjectId })
      expect([200, 201]).toContain(assignment.status)
    }

    // The class teacher registers the subject teacher by details and receives
    // a reusable access code for them. No User, Membership or password is
    // created.
    const assigned = await ctAgent
      .post(
        `/api/schools/${schoolId}/classes/${basicOne!.id}/subjects/${mathId}/teacher`,
      )
      .set('Origin', TEST_ORIGIN)
      .send({
        teacher: {
          firstName: 'Subject',
          lastName: 'Teacher',
          email: subjectTeacherEmail,
        },
      })
    expect(assigned.status).toBe(201)
    const assignedData = data<{
      assignment: { id: string; membershipId: string | null; userId: string | null }
      invitation: { code: string }
    }>(assigned)
    expect(assignedData.assignment.membershipId).toBeNull()
    expect(assignedData.assignment.userId).toBeNull()

    fixture.subjectTeacherAccessCode = assignedData.invitation.code

    const pupilIds: string[] = []

    for (let index = 1; index <= 3; index += 1) {
      const pupil = await ctAgent
        .post(`/api/schools/${schoolId}/pupils`)
        .set('Origin', TEST_ORIGIN)
        .send({
          firstName: `Pupil${index}`,
          lastName: 'Assessment',
          admissionNumber: `${suffix}-ADM-${index}`,
          classId: basicOne!.id,
          academicYearId: yearId,
        })
      expect(pupil.status).toBe(201)
      pupilIds.push(data<{ pupil: { id: string } }>(pupil).pupil.id)
    }

    fixture.pupilIds = pupilIds
  }, 30_000)

  it('registers class subjects and assigns an eligible subject teacher transactionally', async () => {
    const suffix = nextSuffix()
    const email = `it-ct-subjects-${suffix}@gradely-integration.test`
    const response = await admin
      .post(`/api/schools/${fixture.schoolId}/classes/register`)
      .set('Origin', TEST_ORIGIN)
      .send({
        className: 'Basic 3',
        teacher: {
          firstName: 'Subject',
          lastName: 'Registrar',
          email,
        },
      })
    expect(response.status).toBe(201)
    const registered = data<{
      class: { id: string }
      teacher: { userId: string }
    }>(response)
    trackUser(registered.teacher.userId)
    // Fixture marks the teacher's first-login rotation as already complete so
    // this test can focus on subject registration. Forced rotation is covered
    // by dedicated route tests.
    await prisma.user.update({
      where: { id: registered.teacher.userId },
      data: {
        passwordHash: await hashPassword(TEST_PASSWORD),
        mustChangePassword: false,
      },
    })

    const ctAgent = await login(email)
    const frenchName = `Integration French ${suffix}`

    // The class teacher registers subjects and may optionally attach the
    // subject teacher's details in the same request.
    const english = await ctAgent
      .post(
        `/api/schools/${fixture.schoolId}/classes/${registered.class.id}/subjects`,
      )
      .set('Origin', TEST_ORIGIN)
      .send({
        subjectId: fixture.englishId,
        subjectTeacher: {
          firstName: 'Assigned',
          lastName: 'Teacher',
          email: `it-st-subjects-${suffix}@gradely-integration.test`,
        },
      })
    expect(english.status).toBe(201)
    const englishData = data<{
      subjectTeacherAssignment: {
        subjectId: string
        membershipId: string | null
        userId: string | null
      } | null
      invitation: { code: string; subjectId: string } | null
    }>(english)
    expect(englishData.subjectTeacherAssignment?.subjectId).toBe(
      fixture.englishId,
    )
    expect(englishData.invitation?.code).toBeTruthy()
    expect(englishData.subjectTeacherAssignment?.membershipId).toBeNull()
    expect(englishData.subjectTeacherAssignment?.userId).toBeNull()

    const french = await ctAgent
      .post(
        `/api/schools/${fixture.schoolId}/classes/${registered.class.id}/subjects`,
      )
      .set('Origin', TEST_ORIGIN)
      .send({ name: frenchName, code: 'INT-FR' })
    expect(french.status).toBe(201)

    const classSubjects = await prisma.classSubject.findMany({
      where: { schoolId: fixture.schoolId, classId: registered.class.id },
      include: { subject: { select: { name: true } } },
    })
    expect(classSubjects.map((item) => item.subject.name)).toEqual(
      expect.arrayContaining(['English Language', frenchName]),
    )

    const assignments = await prisma.subjectTeacherAssignment.findMany({
      where: {
        schoolId: fixture.schoolId,
        classId: registered.class.id,
        endedAt: null,
      },
    })
    expect(assignments).toHaveLength(1)
    expect(assignments[0]?.subjectId).toBe(fixture.englishId)

    // Retrying with the same subject name reuses the catalogue subject and
    // does not create a duplicate.
    const retryEmail = `it-ct-subjects-retry-${suffix}@gradely-integration.test`
    const retry = await admin
      .post(`/api/schools/${fixture.schoolId}/classes/register`)
      .set('Origin', TEST_ORIGIN)
      .send({
        className: 'Basic 4',
        teacher: {
          firstName: 'Retry',
          lastName: 'Registrar',
          email: retryEmail,
        },
      })
    expect(retry.status).toBe(201)
    const retryRegistered = data<{
      class: { id: string }
      teacher: { userId: string }
    }>(retry)
    trackUser(retryRegistered.teacher.userId)
    await prisma.user.update({
      where: { id: retryRegistered.teacher.userId },
      data: {
        passwordHash: await hashPassword(TEST_PASSWORD),
        mustChangePassword: false,
      },
    })

    const retryAgent = await login(retryEmail)
    const retrySubject = await retryAgent
      .post(
        `/api/schools/${fixture.schoolId}/classes/${retryRegistered.class.id}/subjects`,
      )
      .set('Origin', TEST_ORIGIN)
      .send({ name: `integration french ${suffix}` })
    expect(retrySubject.status).toBe(201)

    const frenchSubjects = await prisma.subject.findMany({
      where: {
        schoolId: fixture.schoolId,
        name: { equals: frenchName, mode: 'insensitive' },
      },
    })
    expect(frenchSubjects).toHaveLength(1)
  }, 30_000)

  it('issues reusable subject-teacher access codes with revoke, reissue and expiry', async () => {
    const suffix = nextSuffix()
    const classTeacherEmail = `it-invite-ct-${suffix}@gradely-integration.test`
    const subjectTeacherEmail = `it-invite-st-${suffix}@gradely-integration.test`

    const registration = await admin
      .post(`/api/schools/${fixture.schoolId}/classes/register`)
      .set('Origin', TEST_ORIGIN)
      .send({
        className: 'JHS 1',
        teacher: {
          firstName: 'Invite',
          lastName: 'Class',
          email: classTeacherEmail,
        },
      })
    expect(registration.status).toBe(201)
    const registered = data<{
      class: { id: string }
      teacher: { userId: string }
    }>(registration)
    trackUser(registered.teacher.userId)
    await prisma.user.update({
      where: { id: registered.teacher.userId },
      data: {
        passwordHash: await hashPassword(TEST_PASSWORD),
        mustChangePassword: false,
      },
    })

    const ctAgent = await login(classTeacherEmail)

    const created = await ctAgent
      .post(
        `/api/schools/${fixture.schoolId}/classes/${registered.class.id}/subjects`,
      )
      .set('Origin', TEST_ORIGIN)
      .send({
        subjectId: fixture.englishId,
        subjectTeacher: {
          firstName: 'Invite',
          lastName: 'Subject',
          email: subjectTeacherEmail,
        },
      })
    expect(created.status).toBe(201)
    const createdData = data<{
      invitation: { id: string; code: string; status: string }
      subjectTeacherAssignment: {
        id: string
        membershipId: string | null
        userId: string | null
      }
    }>(created)
    expect(createdData.subjectTeacherAssignment.membershipId).toBeNull()
    expect(createdData.subjectTeacherAssignment.userId).toBeNull()
    expect(createdData.invitation.status).toBe('PENDING')
    const firstInvitationId = createdData.invitation.id
    const firstCode = createdData.invitation.code

    // Only a hash of the code is persisted; the plaintext is never stored.
    const storedCode = await prisma.subjectTeacherInvitation.findUniqueOrThrow({
      where: { id: firstInvitationId },
    })
    expect(storedCode.codeHash).not.toBe(firstCode)
    expect(storedCode.codeHash).toMatch(/^[a-f0-9]{64}$/)
    expect(storedCode.assignmentId).toBe(
      createdData.subjectTeacherAssignment.id,
    )

    // The list never re-exposes a plaintext code.
    const listed = await ctAgent.get(
      `/api/schools/${fixture.schoolId}/classes/${registered.class.id}/subject-teacher-invitations`,
    )
    expect(listed.status).toBe(200)
    const listedInvitation = data<{
      invitations: Array<{ id: string; status: string; assignmentId: string | null }>
    }>(listed).invitations.find((item) => item.id === firstInvitationId)
    expect(listedInvitation?.status).toBe('PENDING')
    expect(listedInvitation?.assignmentId).toBe(
      createdData.subjectTeacherAssignment.id,
    )
    expect(JSON.stringify(listed.body.data)).not.toContain('"code"')

    // An unknown code is rejected without revealing why.
    const invalid = await request(app)
      .post('/api/auth/subject-teacher/access-code')
      .set('Origin', TEST_ORIGIN)
      .send({ code: '9999Qqq' })
    expect(invalid.status).toBe(401)

    // Reissuing invalidates the previous code.
    const reissued = await ctAgent
      .post(
        `/api/schools/${fixture.schoolId}/classes/${registered.class.id}/subject-teacher-invitations/${firstInvitationId}/reissue`,
      )
      .set('Origin', TEST_ORIGIN)
      .send({})
    expect(reissued.status).toBe(201)
    const reissuedData = data<{
      invitation: { id: string; code: string; reissuedFromId: string | null }
    }>(reissued)
    expect(reissuedData.invitation.code).not.toBe(firstCode)
    expect(reissuedData.invitation.reissuedFromId).toBe(firstInvitationId)

    const staleCode = await request(app)
      .post('/api/auth/subject-teacher/access-code')
      .set('Origin', TEST_ORIGIN)
      .send({ code: firstCode })
    expect(staleCode.status).toBe(401)

    // Revoking a code makes it unusable.
    const revoked = await ctAgent
      .delete(
        `/api/schools/${fixture.schoolId}/classes/${registered.class.id}/subject-teacher-invitations/${reissuedData.invitation.id}`,
      )
      .set('Origin', TEST_ORIGIN)
    expect(revoked.status).toBe(200)

    const revokedEntry = await request(app)
      .post('/api/auth/subject-teacher/access-code')
      .set('Origin', TEST_ORIGIN)
      .send({ code: reissuedData.invitation.code })
    expect(revokedEntry.status).toBe(401)

    // A revoked code can be reissued, but a code whose school session has
    // closed cannot be used: expiry follows the school's closing date.
    const afterRevoke = await ctAgent
      .post(
        `/api/schools/${fixture.schoolId}/classes/${registered.class.id}/subject-teacher-invitations/${reissuedData.invitation.id}/reissue`,
      )
      .set('Origin', TEST_ORIGIN)
      .send({})
    expect(afterRevoke.status).toBe(201)
    const afterRevokeData = data<{
      invitation: { id: string; code: string }
    }>(afterRevoke)

    // Bringing the school closing date forward ends the session immediately.
    await prisma.school.update({
      where: { id: fixture.schoolId },
      data: { closingDate: new Date('2020-01-01T00:00:00.000Z') },
    })

    const expiredEntry = await request(app)
      .post('/api/auth/subject-teacher/access-code')
      .set('Origin', TEST_ORIGIN)
      .send({ code: afterRevokeData.invitation.code })
    expect(expiredEntry.status).toBe(401)

    // Restoring the closing date lets the same non-revoked code work again.
    await prisma.school.update({
      where: { id: fixture.schoolId },
      data: { closingDate: new Date('2099-12-31T00:00:00.000Z') },
    })

    // Reissuing the code produces a working reusable code.
    const finalReissue = await ctAgent
      .post(
        `/api/schools/${fixture.schoolId}/classes/${registered.class.id}/subject-teacher-invitations/${afterRevokeData.invitation.id}/reissue`,
      )
      .set('Origin', TEST_ORIGIN)
      .send({})
    expect(finalReissue.status).toBe(201)
    const finalData = data<{ invitation: { id: string; code: string } }>(
      finalReissue,
    )

    const firstEntry = await request(app)
      .post('/api/auth/subject-teacher/access-code')
      .set('Origin', TEST_ORIGIN)
      .send({ code: finalData.invitation.code })
    expect(firstEntry.status).toBe(200)
    expect(firstEntry.body.data.subjectSession).toMatchObject({
      schoolId: fixture.schoolId,
      classId: registered.class.id,
      subjectId: fixture.englishId,
      teacher: expect.objectContaining({ email: subjectTeacherEmail }),
    })

    // The code is reusable until it is revoked or regenerated.
    const reusedEntry = await request(app)
      .post('/api/auth/subject-teacher/access-code')
      .set('Origin', TEST_ORIGIN)
      .send({ code: finalData.invitation.code })
    expect(reusedEntry.status).toBe(200)

    // The restricted session is a separate identity. It can be re-read from its
    // own endpoint and is never recognised as a normal account session.
    const sessionAgent = await enterAccessCode(finalData.invitation.code)
    const me = await sessionAgent.get('/api/auth/subject-teacher/me')
    expect(me.status).toBe(200)
    expect(me.body.data.subjectSession).toMatchObject({
      classId: registered.class.id,
      subjectId: fixture.englishId,
      teacher: expect.objectContaining({ email: subjectTeacherEmail }),
    })
    expect((await sessionAgent.get('/api/auth/me')).status).toBe(401)

    // Signing out ends only that session; the reusable code still works.
    const signedOut = await sessionAgent
      .post('/api/auth/subject-teacher/logout')
      .set('Origin', TEST_ORIGIN)
      .send({})
    expect(signedOut.status).toBe(200)
    expect(
      (await sessionAgent.get('/api/auth/subject-teacher/me')).status,
    ).toBe(401)

    const afterLogoutAgent = await enterAccessCode(finalData.invitation.code)
    expect(
      (await afterLogoutAgent.get('/api/auth/subject-teacher/me')).status,
    ).toBe(200)

    // Regenerating invalidates the old code and every session it opened.
    const regenerate = await ctAgent
      .post(
        `/api/schools/${fixture.schoolId}/classes/${registered.class.id}/subject-teacher-invitations/${finalData.invitation.id}/reissue`,
      )
      .set('Origin', TEST_ORIGIN)
      .send({})
    expect(regenerate.status).toBe(201)
    const regenerated = data<{ invitation: { id: string; code: string } }>(
      regenerate,
    )
    expect(regenerated.invitation.code).not.toBe(finalData.invitation.code)

    // Regeneration also ends sessions opened with the superseded code.
    const oldSessionAfterRegenerate = await afterLogoutAgent.get(
      `/api/schools/${fixture.schoolId}/class-dashboard`,
    )
    expect(oldSessionAfterRegenerate.status).toBe(401)

    const oldCodeEntry = await request(app)
      .post('/api/auth/subject-teacher/access-code')
      .set('Origin', TEST_ORIGIN)
      .send({ code: finalData.invitation.code })
    expect(oldCodeEntry.status).toBe(401)

    const regeneratedAgent = await enterAccessCode(
      regenerated.invitation.code,
    )

    const revokeRegenerated = await ctAgent
      .delete(
        `/api/schools/${fixture.schoolId}/classes/${registered.class.id}/subject-teacher-invitations/${regenerated.invitation.id}`,
      )
      .set('Origin', TEST_ORIGIN)
    expect(revokeRegenerated.status).toBe(200)

    // Revocation ends the already-open session and rejects the code.
    const afterRevokeDashboard = await regeneratedAgent.get(
      `/api/schools/${fixture.schoolId}/class-dashboard`,
    )
    expect(afterRevokeDashboard.status).toBe(401)

    const afterRevokeEntry = await request(app)
      .post('/api/auth/subject-teacher/access-code')
      .set('Origin', TEST_ORIGIN)
      .send({ code: regenerated.invitation.code })
    expect(afterRevokeEntry.status).toBe(401)

    // Only the owning class teacher can manage this class's invitations.
    const platform = await ensurePlatformAgent()
    const denied = await platform.get(
      `/api/schools/${fixture.schoolId}/classes/${registered.class.id}/subject-teacher-invitations`,
    )
    expect(denied.status).toBe(403)
  }, 30_000)

  it('serialises concurrent class-teacher registration for the same class', async () => {
    const suffix = nextSuffix()
    const firstEmail = `it-ct-concurrent-a-${suffix}@gradely-integration.test`
    const secondEmail = `it-ct-concurrent-b-${suffix}@gradely-integration.test`

    const [first, second] = await Promise.all([
      admin
        .post(`/api/schools/${fixture.schoolId}/classes/register`)
        .set('Origin', TEST_ORIGIN)
        .send({
          className: 'Basic 2',
          teacher: {
            firstName: 'Concurrent',
            lastName: 'First',
            email: firstEmail,
            },
        }),
      admin
        .post(`/api/schools/${fixture.schoolId}/classes/register`)
        .set('Origin', TEST_ORIGIN)
        .send({
          className: 'Basic 2',
          teacher: {
            firstName: 'Concurrent',
            lastName: 'Second',
            email: secondEmail,
            },
        }),
    ])

    expect([first.status, second.status].sort()).toEqual([201, 409])

    const cls = await prisma.schoolClass.findFirst({
      where: { schoolId: fixture.schoolId, name: 'Basic 2' },
      select: { id: true },
    })
    expect(cls).not.toBeNull()

    const assignments = await prisma.classTeacherAssignment.count({
      where: {
        schoolId: fixture.schoolId,
        classId: cls!.id,
        endedAt: null,
      },
    })
    expect(assignments).toBe(1)

    // The failed transaction must not leave a teacher account behind.
    const users = await prisma.user.findMany({
      where: { email: { in: [firstEmail, secondEmail] } },
      select: { id: true },
    })
    expect(users).toHaveLength(1)
    users.forEach((user) => trackUser(user.id))
  }, 30_000)

  it('blocks school users from assessment policy and grading scheme configuration', async () => {
    const schoolId = fixture.schoolId
    const schemePath = `/api/schools/${schoolId}/assessments/grading-schemes`
    const policyPath = `/api/schools/${schoolId}/assessments/policies`
    const dummyId = '00000000-0000-0000-0000-000000000000'

    const requests = [
      admin.get(schemePath),
      admin.post(schemePath).set('Origin', TEST_ORIGIN).send({}),
      admin.patch(`${schemePath}/${dummyId}`).set('Origin', TEST_ORIGIN).send({}),
      admin.post(`${schemePath}/${dummyId}/activate`).set('Origin', TEST_ORIGIN).send({}),
      admin.get(policyPath),
      admin.post(policyPath).set('Origin', TEST_ORIGIN).send({}),
      admin.patch(`${policyPath}/${dummyId}`).set('Origin', TEST_ORIGIN).send({}),
      admin.post(`${policyPath}/${dummyId}/activate`).set('Origin', TEST_ORIGIN).send({}),
    ]

    for (const response of await Promise.all(requests)) {
      expect(response.status).toBe(403)
      expect(response.body.error.message).toContain('system-managed')
    }
  })

  it('seeds a versioned 40/60 class policy and resolves it for score entry', async () => {
    const { first, replacement } = await seedClassPolicy()

    expect(first.version).toBe(1)
    expect(
      first.components.reduce(
        (total, component) => total + Number(component.weightPercent),
        0,
      ),
    ).toBe(100)

    const active = await prisma.assessmentPolicy.findMany({
      where: { schoolId: fixture.schoolId, academicTermId: fixture.termId, isActive: true },
      select: { id: true, version: true, scopeKey: true },
    })
    expect(active).toHaveLength(1)
    expect(active[0]?.id).toBe(replacement.id)
    expect(active[0]?.version).toBe(2)
    expect(active[0]?.scopeKey).toBe(`class:${fixture.classId}`)

    const permission = await admin
      .post(
        `/api/schools/${fixture.schoolId}/assessments/class-teacher-permissions`,
      )
      .set('Origin', TEST_ORIGIN)
      .send({
        classId: fixture.classId,
        subjectId: fixture.englishId,
        membershipId: fixture.classTeacherMembershipId,
      })
    expect(permission.status).toBe(201)

    const entryAgent = await login(fixture.classTeacherEmail)
    const entry = await entryAgent
      .get(`/api/schools/${fixture.schoolId}/assessments/score-entry`)
      .query({
        academicTermId: fixture.termId,
        classId: fixture.classId,
        subjectId: fixture.englishId,
      })
    expect(entry.status).toBe(200)
    const resolved = data<{
      scoreEntry: {
        policy: {
          id: string
          name: string
          calculationMode: string
          components: Array<{ key: string; weightPercent: string }>
        }
        earlyYears: boolean
      }
    }>(entry).scoreEntry
    expect(resolved.policy.id).toBe(replacement.id)
    expect(resolved.policy.name).toBe('Basic 1 40/60 policy v2')
    expect(resolved.policy.calculationMode).toBe('COMPONENT_WEIGHTED')
    expect(resolved.earlyYears).toBe(false)
  })

  it('enforces class-teacher and subject-teacher authorization', async () => {
    const ctAgent = await login(fixture.classTeacherEmail)

    // The class teacher sees every subject in their class. A subject owned by
    // an active subject teacher is read-only for the class teacher.
    const classSubjects = await ctAgent.get(
      `/api/schools/${fixture.schoolId}/assessments/class-subjects`,
    )
    expect(classSubjects.status).toBe(200)
    const classSubjectList = data<{
      classSubjects: Array<{
        subjectId: string
        readOnly: boolean
        canEnterScores: boolean
        subjectTeacherName: string | null
      }>
    }>(classSubjects).classSubjects
    const english = classSubjectList.find(
      (item) => item.subjectId === fixture.englishId,
    )
    const math = classSubjectList.find(
      (item) => item.subjectId === fixture.mathId,
    )
    expect(english).toBeDefined()
    expect(english?.readOnly).toBe(false)
    expect(english?.canEnterScores).toBe(true)
    expect(math).toBeDefined()
    expect(math?.readOnly).toBe(true)
    expect(math?.canEnterScores).toBe(false)
    expect(math?.subjectTeacherName).toBe('Subject Teacher')

    // A subject-teacher-owned sheet is visible but read-only for the class
    // teacher.
    const mathView = await ctAgent
      .get(`/api/schools/${fixture.schoolId}/assessments/score-entry`)
      .query({
        academicTermId: fixture.termId,
        classId: fixture.classId,
        subjectId: fixture.mathId,
      })
    expect(mathView.status).toBe(200)
    const mathEntry = data<{
      scoreEntry: { readOnly: boolean; subjectTeacherName: string | null }
    }>(mathView).scoreEntry
    expect(mathEntry.readOnly).toBe(true)
    expect(mathEntry.subjectTeacherName).toBe('Subject Teacher')

    // A single-class class teacher cannot widen the request with a class id.
    // The backend replaces the supplied id with the authoritative assignment.
    const manipulated = await ctAgent
      .get(`/api/schools/${fixture.schoolId}/assessments/score-entry`)
      .query({
        academicTermId: fixture.termId,
        classId: '00000000-0000-4000-8000-000000000000',
        subjectId: fixture.englishId,
      })
    expect(manipulated.status).toBe(200)
    const manipulatedEntry = data<{
      scoreEntry: { classId: string; subjectId: string }
    }>(manipulated).scoreEntry
    expect(manipulatedEntry.classId).toBe(fixture.classId)
    expect(manipulatedEntry.subjectId).toBe(fixture.englishId)

    // The class teacher cannot overwrite the subject teacher's scores.
    const mathWrite = await ctAgent
      .put(`/api/schools/${fixture.schoolId}/assessments/score-entry`)
      .set('Origin', TEST_ORIGIN)
      .send({
        academicTermId: fixture.termId,
        classId: fixture.classId,
        subjectId: fixture.mathId,
        expectedVersion: 0,
        pupils: [
          {
            pupilId: fixture.pupilIds[0]!,
            scores: [
              { componentId: componentIds['class-test'], score: '10' },
            ],
          },
        ],
      })
    expect(mathWrite.status).toBe(403)

    const stAgent = await enterAccessCode(fixture.subjectTeacherAccessCode)

    // A restricted subject session only sees its own class subject.
    const stDashboard = await stAgent.get(
      `/api/schools/${fixture.schoolId}/class-dashboard`,
    )
    expect(stDashboard.status).toBe(200)
    const stClasses = data<{
      classes: Array<{
        subjects: Array<{ subjectId: string }>
      }>
    }>(stDashboard).classes
    expect(stClasses).toHaveLength(1)
    expect(stClasses[0]?.subjects.map((item) => item.subjectId)).toEqual([
      fixture.mathId,
    ])

    // The restricted session can read the class workspace it owns, but a
    // changed class id in the URL is rejected rather than widening access.
    const stSubjects = await stAgent.get(
      `/api/schools/${fixture.schoolId}/classes/${fixture.classId}/subjects`,
    )
    expect(stSubjects.status).toBe(200)
    expect(
      data<{ subjects: Array<{ subjectId: string }> }>(stSubjects).subjects.map(
        (item) => item.subjectId,
      ),
    ).toEqual([fixture.mathId])

    const stAssignments = await stAgent.get(
      `/api/schools/${fixture.schoolId}/classes/${fixture.classId}/subject-teacher-assignments`,
    )
    expect(stAssignments.status).toBe(200)

    const stOtherClass = await stAgent.get(
      `/api/schools/${fixture.schoolId}/classes/00000000-0000-4000-8000-000000000000/subjects`,
    )
    expect(stOtherClass.status).toBe(403)

    // The session cannot reach unrelated school resources.
    const stPupils = await stAgent.get(
      `/api/schools/${fixture.schoolId}/pupils`,
    )
    expect(stPupils.status).toBe(403)

    const stSettings = await stAgent.get(
      `/api/schools/${fixture.schoolId}/assessments/settings`,
    )
    expect(stSettings.status).toBe(403)

    const allowed = await stAgent
      .get(`/api/schools/${fixture.schoolId}/assessments/score-entry`)
      .query({
        academicTermId: fixture.termId,
        classId: fixture.classId,
        subjectId: fixture.mathId,
      })
    expect(allowed.status).toBe(200)
    const stEntry = data<{
      scoreEntry: { readOnly: boolean; classId: string }
    }>(allowed).scoreEntry
    expect(stEntry.readOnly).toBe(false)
    expect(stEntry.classId).toBe(fixture.classId)

    // A manipulated class id is replaced with the authoritative assignment.
    const manipulatedClass = await stAgent
      .get(`/api/schools/${fixture.schoolId}/assessments/score-entry`)
      .query({
        academicTermId: fixture.termId,
        classId: '00000000-0000-4000-8000-000000000000',
        subjectId: fixture.mathId,
      })
    expect(manipulatedClass.status).toBe(200)
    expect(data<{ scoreEntry: { classId: string } }>(manipulatedClass).scoreEntry.classId).toBe(
      fixture.classId,
    )

    const stDenied = await stAgent
      .get(`/api/schools/${fixture.schoolId}/assessments/score-entry`)
      .query({
        academicTermId: fixture.termId,
        classId: fixture.classId,
        subjectId: fixture.englishId,
      })
    expect(stDenied.status).toBe(403)
  }, 30_000)

  it('replaces a subject teacher without leaking access or losing historical scores', async () => {
    const suffix = nextSuffix()
    const replacementEmail = `it-st-replacement-${suffix}@gradely-integration.test`
    const firstPupil = fixture.pupilIds[0]!

    // The current subject teacher saves a draft for Mathematics using a
    // restricted subject session opened with their reusable access code.
    const originalAgent = await enterAccessCode(
      fixture.subjectTeacherAccessCode,
    )
    const savedDraft = await originalAgent
      .put(`/api/schools/${fixture.schoolId}/assessments/score-entry`)
      .set('Origin', TEST_ORIGIN)
      .send({
        academicTermId: fixture.termId,
        classId: fixture.classId,
        subjectId: fixture.mathId,
        expectedVersion: 0,
        pupils: [
          {
            pupilId: firstPupil,
            scores: [
              { componentId: componentIds['class-test'], score: '12' },
              { componentId: componentIds.examination, score: '48' },
            ],
          },
        ],
      })
    expect(savedDraft.status, JSON.stringify(savedDraft.body)).toBe(200)

    const previous = await prisma.subjectTeacherAssignment.findFirstOrThrow({
      where: {
        schoolId: fixture.schoolId,
        classId: fixture.classId,
        subjectId: fixture.mathId,
        endedAt: null,
      },
    })

    // The subject session's draft is attributed to its assignment, not to a
    // membership account, so attribution survives replacement.
    const draftSubmission = await prisma.resultSubmission.findUniqueOrThrow({
      where: {
        schoolId_academicTermId_classId_subjectId: {
          schoolId: fixture.schoolId,
          academicTermId: fixture.termId,
          classId: fixture.classId,
          subjectId: fixture.mathId,
        },
      },
    })
    expect(draftSubmission.createdByMembershipId).toBeNull()
    expect(draftSubmission.createdByAssignmentId).toBe(previous.id)

    // The class teacher replaces the subject teacher by entering new teacher
    // details. The replacement receives a fresh reusable access code and no
    // account is created.
    const ctAgent = await login(fixture.classTeacherEmail)
    const replaced = await ctAgent
      .post(
        `/api/schools/${fixture.schoolId}/classes/${fixture.classId}/subjects/${fixture.mathId}/teacher`,
      )
      .set('Origin', TEST_ORIGIN)
      .send({
        teacher: {
          firstName: 'Replacement',
          lastName: 'Teacher',
          email: replacementEmail,
        },
      })
    expect(replaced.status).toBe(201)
    const replacedData = data<{
      assignment: { id: string; membershipId: string | null; userId: string | null }
      invitation: { code: string; status: string }
    }>(replaced)
    expect(replacedData.assignment.id).not.toBe(previous.id)
    expect(replacedData.assignment.membershipId).toBeNull()
    expect(replacedData.assignment.userId).toBeNull()
    expect(replacedData.invitation.code).toBeTruthy()
    expect(replacedData.invitation.status).toBe('PENDING')

    // The old assignment row is closed rather than deleted, and the new one is
    // the only active assignment for the class-subject.
    const history = await prisma.subjectTeacherAssignment.findMany({
      where: {
        schoolId: fixture.schoolId,
        classId: fixture.classId,
        subjectId: fixture.mathId,
      },
    })
    expect(history.find((item) => item.id === previous.id)?.endedAt).not.toBeNull()
    expect(
      history.find((item) => item.id === replacedData.assignment.id)?.endedAt,
    ).toBeNull()

    // The replacement audit action records the before/after teacher identity.
    const replacementAudit = await prisma.auditLog.findFirst({
      where: {
        schoolId: fixture.schoolId,
        action: 'SUBJECT_TEACHER_REPLACED',
        entityId: previous.id,
      },
    })
    expect(replacementAudit).not.toBeNull()

    // Scores entered before the replacement remain stored.
    expect(
      await prisma.assessmentScore.count({
        where: {
          schoolId: fixture.schoolId,
          classId: fixture.classId,
          subjectId: fixture.mathId,
          pupilId: firstPupil,
        },
      }),
    ).toBeGreaterThan(0)

    // The previous teacher loses access immediately because the assignment is
    // no longer active, even though the code was never explicitly revoked.
    const originalDenied = await originalAgent
      .get(`/api/schools/${fixture.schoolId}/assessments/score-entry`)
      .query({
        academicTermId: fixture.termId,
        classId: fixture.classId,
        subjectId: fixture.mathId,
      })
    expect(originalDenied.status).toBe(401)

    // The replacement has no User account, so password login is impossible.
    const beforeAccessCode = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: replacementEmail, password: TEST_PASSWORD })
    expect(beforeAccessCode.status).toBe(401)

    // While the replacement is active, the class teacher's view is read-only
    // and writes are rejected by the backend.
    const ctView = await ctAgent
      .get(`/api/schools/${fixture.schoolId}/assessments/score-entry`)
      .query({
        academicTermId: fixture.termId,
        classId: fixture.classId,
        subjectId: fixture.mathId,
      })
    expect(ctView.status).toBe(200)
    const ctViewEntry = data<{
      scoreEntry: { readOnly: boolean; subjectTeacherName: string | null }
    }>(ctView).scoreEntry
    expect(ctViewEntry.readOnly).toBe(true)
    expect(ctViewEntry.subjectTeacherName).toBe('Replacement Teacher')

    const ctWrite = await ctAgent
      .put(`/api/schools/${fixture.schoolId}/assessments/score-entry`)
      .set('Origin', TEST_ORIGIN)
      .send({
        academicTermId: fixture.termId,
        classId: fixture.classId,
        subjectId: fixture.mathId,
        expectedVersion: 0,
        pupils: [
          {
            pupilId: firstPupil,
            scores: [{ componentId: componentIds.examination, score: '99' }],
          },
        ],
      })
    expect(ctWrite.status).toBe(403)

    // Entering the replacement's access code grants access to the assigned
    // subject only, and the historical scores are visible in the register.
    const replacementAgent = await enterAccessCode(
      replacedData.invitation.code,
    )
    const replacementView = await replacementAgent
      .get(`/api/schools/${fixture.schoolId}/assessments/score-entry`)
      .query({
        academicTermId: fixture.termId,
        classId: fixture.classId,
        subjectId: fixture.mathId,
      })
    expect(replacementView.status).toBe(200)
    const replacementEntry = data<{
      scoreEntry: {
        readOnly: boolean
        pupils: Array<{ pupilId: string; scores: Record<string, string> }>
      }
    }>(replacementView).scoreEntry
    expect(replacementEntry.readOnly).toBe(false)
    expect(
      replacementEntry.pupils.find((pupil) => pupil.pupilId === firstPupil)
        ?.scores[componentIds['class-test']!],
    ).toBe('12.00')
    expect(
      replacementEntry.pupils.find((pupil) => pupil.pupilId === firstPupil)
        ?.scores[componentIds.examination!],
    ).toBe('48.00')

    // The replacement still cannot reach a subject they were not assigned.
    const replacementDenied = await replacementAgent
      .get(`/api/schools/${fixture.schoolId}/assessments/score-entry`)
      .query({
        academicTermId: fixture.termId,
        classId: fixture.classId,
        subjectId: fixture.englishId,
      })
    expect(replacementDenied.status).toBe(403)
  }, 30_000)

  it('saves a draft that distinguishes missing from zero and avoids duplicates', async () => {
    const ctAgent = await login(fixture.classTeacherEmail)

    const entry = await ctAgent
      .get(`/api/schools/${fixture.schoolId}/assessments/score-entry`)
      .query({
        academicTermId: fixture.termId,
        classId: fixture.classId,
        subjectId: fixture.englishId,
      })
    expect(entry.status).toBe(200)

    const firstPupil = fixture.pupilIds[0]!
    const secondPupil = fixture.pupilIds[1]!

    const draft = await ctAgent
      .put(`/api/schools/${fixture.schoolId}/assessments/score-entry`)
      .set('Origin', TEST_ORIGIN)
      .send({
        academicTermId: fixture.termId,
        classId: fixture.classId,
        subjectId: fixture.englishId,
        expectedVersion: 0,
        pupils: [
          {
            pupilId: firstPupil,
            scores: [
              { componentId: componentIds['class-test'], score: '16' },
              { componentId: componentIds.project, score: '8' },
              { componentId: componentIds.homework, score: '9' },
              { componentId: componentIds.examination, score: null },
            ],
          },
          {
            pupilId: secondPupil,
            scores: [
              { componentId: componentIds['class-test'], score: '0' },
              { componentId: componentIds.project, score: '0' },
              { componentId: componentIds.homework, score: '0' },
              { componentId: componentIds.examination, score: '0' },
            ],
          },
        ],
      })
    expect(draft.status).toBe(200)

    const view = data<{
      scoreEntry: {
        submission: { id: string; status: string; version: number }
        pupils: Array<{
          pupilId: string
          finalScore: number | null
          missingComponentIds: string[]
        }>
      }
    }>(draft).scoreEntry

    expect(view.submission.status).toBe('DRAFT')
    expect(view.submission.version).toBe(1)

    const missing = view.pupils.find((pupil) => pupil.pupilId === firstPupil)
    const zero = view.pupils.find((pupil) => pupil.pupilId === secondPupil)

    expect(missing?.finalScore).toBeNull()
    expect(missing?.missingComponentIds).toEqual([componentIds.examination])
    expect(zero?.finalScore).toBe(0)
    expect(zero?.missingComponentIds).toEqual([])

    expect(
      await prisma.assessmentScore.count({
        where: {
          schoolId: fixture.schoolId,
          pupilId: secondPupil,
          componentId: componentIds.examination,
        },
      }),
    ).toBe(1)

    const resave = await ctAgent
      .put(`/api/schools/${fixture.schoolId}/assessments/score-entry`)
      .set('Origin', TEST_ORIGIN)
      .send({
        academicTermId: fixture.termId,
        classId: fixture.classId,
        subjectId: fixture.englishId,
        expectedVersion: view.submission.version,
        pupils: [
          {
            pupilId: secondPupil,
            scores: [{ componentId: componentIds.examination, score: '1' }],
          },
        ],
      })
    expect(resave.status).toBe(200)

    expect(
      await prisma.assessmentScore.count({
        where: {
          schoolId: fixture.schoolId,
          pupilId: secondPupil,
          componentId: componentIds.examination,
        },
      }),
    ).toBe(1)
  }, 30_000)

  it('submits, locks, returns, resolves concurrency and accepts', async () => {
    const ctAgent = await login(fixture.classTeacherEmail)

    const current = await ctAgent
      .get(`/api/schools/${fixture.schoolId}/assessments/score-entry`)
      .query({
        academicTermId: fixture.termId,
        classId: fixture.classId,
        subjectId: fixture.englishId,
      })
    expect(current.status).toBe(200)
    const currentVersion = data<{
      scoreEntry: { submission: { version: number } }
    }>(current).scoreEntry.submission.version

    const allScores = (pupilIndex: number, examScore: string) => ({
      pupilId: fixture.pupilIds[pupilIndex]!,
      scores: [
        {
          componentId: componentIds['class-test'],
          score: pupilIndex === 1 ? '0' : pupilIndex === 2 ? '10' : '16',
        },
        {
          componentId: componentIds.project,
          score: pupilIndex === 1 ? '0' : pupilIndex === 2 ? '5' : '8',
        },
        {
          componentId: componentIds.homework,
          score: pupilIndex === 1 ? '0' : pupilIndex === 2 ? '5' : '9',
        },
        { componentId: componentIds.examination, score: examScore },
      ],
    })

    const draftSave = await ctAgent
      .put(`/api/schools/${fixture.schoolId}/assessments/score-entry`)
      .set('Origin', TEST_ORIGIN)
      .send({
        academicTermId: fixture.termId,
        classId: fixture.classId,
        subjectId: fixture.englishId,
        expectedVersion: currentVersion,
        pupils: [
          allScores(0, '70'),
          allScores(1, '0'),
          allScores(2, '50'),
        ],
      })
    expect(draftSave.status).toBe(200)
    const draftEntry = data<{
      scoreEntry: {
        submission: { version: number }
        pupils: Array<{
          pupilId: string
          finalScore: number | null
          subjectPosition: number | null
          subjectPositionStatus: string
        }>
      }
    }>(draftSave).scoreEntry
    const draftByPupil = new Map(
      draftEntry.pupils.map((pupil) => [pupil.pupilId, pupil]),
    )

    // A complete saved draft already exposes provisional positions.
    expect(
      draftEntry.pupils.every(
        (pupil) =>
          pupil.finalScore !== null &&
          pupil.subjectPosition !== null &&
          pupil.subjectPositionStatus === 'PROVISIONAL',
      ),
    ).toBe(true)
    expect(draftByPupil.get(fixture.pupilIds[0]!)?.subjectPosition).toBe(1)
    expect(draftByPupil.get(fixture.pupilIds[1]!)?.subjectPosition).toBe(3)
    expect(draftByPupil.get(fixture.pupilIds[2]!)?.subjectPosition).toBe(2)

    // A saved score change immediately recalculates provisional positions.
    const editedSave = await ctAgent
      .put(`/api/schools/${fixture.schoolId}/assessments/score-entry`)
      .set('Origin', TEST_ORIGIN)
      .send({
        academicTermId: fixture.termId,
        classId: fixture.classId,
        subjectId: fixture.englishId,
        expectedVersion: draftEntry.submission.version,
        pupils: [
          allScores(0, '70'),
          allScores(1, '0'),
          allScores(2, '100'),
        ],
      })
    expect(editedSave.status).toBe(200)
    const editedEntry = data<{
      scoreEntry: {
        submission: { version: number }
        pupils: Array<{ pupilId: string; subjectPosition: number | null }>
      }
    }>(editedSave).scoreEntry
    const editedByPupil = new Map(
      editedEntry.pupils.map((pupil) => [pupil.pupilId, pupil]),
    )

    expect(editedByPupil.get(fixture.pupilIds[2]!)?.subjectPosition).toBe(1)
    expect(editedByPupil.get(fixture.pupilIds[0]!)?.subjectPosition).toBe(2)
    expect(editedByPupil.get(fixture.pupilIds[1]!)?.subjectPosition).toBe(3)

    const restoredSave = await ctAgent
      .put(`/api/schools/${fixture.schoolId}/assessments/score-entry`)
      .set('Origin', TEST_ORIGIN)
      .send({
        academicTermId: fixture.termId,
        classId: fixture.classId,
        subjectId: fixture.englishId,
        expectedVersion: editedEntry.submission.version,
        pupils: [
          allScores(0, '70'),
          allScores(1, '0'),
          allScores(2, '50'),
        ],
      })
    expect(restoredSave.status).toBe(200)
    const restoredEntry = data<{
      scoreEntry: { submission: { version: number } }
    }>(restoredSave).scoreEntry

    const submit = await ctAgent
      .post(`/api/schools/${fixture.schoolId}/assessments/score-entry/submit`)
      .set('Origin', TEST_ORIGIN)
      .send({
        academicTermId: fixture.termId,
        classId: fixture.classId,
        subjectId: fixture.englishId,
        expectedVersion: restoredEntry.submission.version,
        pupils: [
          allScores(0, '70'),
          allScores(1, '0'),
          allScores(2, '50'),
        ],
      })
    expect(submit.status).toBe(200)
    const submitted = data<{
      submission: { id: string; status: string; version: number }
    }>(submit).submission
    expect(submitted.status).toBe('SUBMITTED')

    // Provisional positions remain visible after submission.
    const pending = await ctAgent
      .get(`/api/schools/${fixture.schoolId}/assessments/score-entry`)
      .query({
        academicTermId: fixture.termId,
        classId: fixture.classId,
        subjectId: fixture.englishId,
      })
    expect(pending.status).toBe(200)
    const pendingPupils = data<{
      scoreEntry: {
        pupils: Array<{
          pupilId: string
          finalScore: number | null
          subjectPosition: number | null
          subjectPositionStatus: string
        }>
      }
    }>(pending).scoreEntry.pupils
    const pendingByPupil = new Map(
      pendingPupils.map((pupil) => [pupil.pupilId, pupil]),
    )

    expect(pendingPupils).toHaveLength(3)
    expect(
      pendingPupils.every(
        (pupil) =>
          pupil.finalScore !== null &&
          pupil.subjectPosition !== null &&
          pupil.subjectPositionStatus === 'PROVISIONAL',
      ),
    ).toBe(true)
    expect(pendingByPupil.get(fixture.pupilIds[0]!)?.subjectPosition).toBe(1)
    expect(pendingByPupil.get(fixture.pupilIds[1]!)?.subjectPosition).toBe(3)
    expect(pendingByPupil.get(fixture.pupilIds[2]!)?.subjectPosition).toBe(2)

    const locked = await ctAgent
      .put(`/api/schools/${fixture.schoolId}/assessments/score-entry`)
      .set('Origin', TEST_ORIGIN)
      .send({
        academicTermId: fixture.termId,
        classId: fixture.classId,
        subjectId: fixture.englishId,
        expectedVersion: submitted.version,
        pupils: [
          {
            pupilId: fixture.pupilIds[0]!,
            scores: [{ componentId: componentIds.examination, score: '99' }],
          },
        ],
      })
    expect(locked.status).toBe(409)

    const platform = await ensurePlatformAgent()
    const refused = await platform
      .post(
        `/api/platform/assessments/schools/${fixture.schoolId}/submissions/${submitted.id}/review`,
      )
      .set('Origin', TEST_ORIGIN)
      .send({
        decision: 'RETURNED_FOR_CORRECTION',
        comment: 'Platform review is not allowed.',
        expectedVersion: submitted.version,
      })
    expect(refused.status).toBe(403)

    const teacherRefused = await ctAgent
      .post(
        `/api/schools/${fixture.schoolId}/assessments/submissions/${submitted.id}/review`,
      )
      .set('Origin', TEST_ORIGIN)
      .send({
        decision: 'ACCEPTED',
        expectedVersion: submitted.version,
      })
    expect(teacherRefused.status).toBe(403)

    const returned = await admin
      .post(
        `/api/schools/${fixture.schoolId}/assessments/submissions/${submitted.id}/review`,
      )
      .set('Origin', TEST_ORIGIN)
      .send({
        decision: 'RETURNED_FOR_CORRECTION',
        comment: 'Please recheck the examination entry.',
        expectedVersion: submitted.version,
      })
    expect(returned.status).toBe(200)
    const returnedData = data<{
      submission: { status: string; version: number }
    }>(returned).submission
    expect(returnedData.status).toBe('RETURNED_FOR_CORRECTION')

    const concurrent = await Promise.all([
      ctAgent
        .put(`/api/schools/${fixture.schoolId}/assessments/score-entry`)
        .set('Origin', TEST_ORIGIN)
        .send({
          academicTermId: fixture.termId,
          classId: fixture.classId,
          subjectId: fixture.englishId,
          expectedVersion: returnedData.version,
          pupils: [
            {
              pupilId: fixture.pupilIds[0]!,
              scores: [
                { componentId: componentIds.examination, score: '70' },
              ],
            },
          ],
        }),
      ctAgent
        .put(`/api/schools/${fixture.schoolId}/assessments/score-entry`)
        .set('Origin', TEST_ORIGIN)
        .send({
          academicTermId: fixture.termId,
          classId: fixture.classId,
          subjectId: fixture.englishId,
          expectedVersion: returnedData.version,
          pupils: [
            {
              pupilId: fixture.pupilIds[0]!,
              scores: [
                { componentId: componentIds.examination, score: '71' },
              ],
            },
          ],
        }),
    ])

    expect(concurrent.map((response) => response.status).sort()).toEqual([
      200, 409,
    ])

    const corrected = await ctAgent
      .get(`/api/schools/${fixture.schoolId}/assessments/score-entry`)
      .query({
        academicTermId: fixture.termId,
        classId: fixture.classId,
        subjectId: fixture.englishId,
      })
    const correctedVersion = data<{
      scoreEntry: { submission: { version: number } }
    }>(corrected).scoreEntry.submission.version

    const resubmit = await ctAgent
      .post(`/api/schools/${fixture.schoolId}/assessments/score-entry/submit`)
      .set('Origin', TEST_ORIGIN)
      .send({
        academicTermId: fixture.termId,
        classId: fixture.classId,
        subjectId: fixture.englishId,
        expectedVersion: correctedVersion,
        pupils: [
          allScores(0, '70'),
          allScores(1, '0'),
          allScores(2, '50'),
        ],
      })
    expect(resubmit.status).toBe(200)
    const resubmitted = data<{
      submission: { status: string; version: number }
    }>(resubmit).submission
    expect(resubmitted.status).toBe('SUBMITTED')

    const accepted = await admin
      .post(
        `/api/schools/${fixture.schoolId}/assessments/submissions/${submitted.id}/review`,
      )
      .set('Origin', TEST_ORIGIN)
      .send({
        decision: 'ACCEPTED',
        comment: 'Accepted for school records.',
        expectedVersion: resubmitted.version,
      })
    expect(accepted.status).toBe(200)
    expect(
      data<{ submission: { status: string } }>(accepted).submission.status,
    ).toBe('ACCEPTED')

    // Acceptance finalizes the same backend ranking the register displays.
    const finalized = await ctAgent
      .get(`/api/schools/${fixture.schoolId}/assessments/score-entry`)
      .query({
        academicTermId: fixture.termId,
        classId: fixture.classId,
        subjectId: fixture.englishId,
      })
    expect(finalized.status).toBe(200)
    const finalizedPupils = data<{
      scoreEntry: {
        pupils: Array<{
          pupilId: string
          subjectPosition: number | null
          subjectPositionStatus: string
        }>
      }
    }>(finalized).scoreEntry.pupils
    const finalizedByPupil = new Map(
      finalizedPupils.map((pupil) => [pupil.pupilId, pupil]),
    )

    expect(
      finalizedPupils.every(
        (pupil) =>
          pupil.subjectPosition !== null &&
          pupil.subjectPositionStatus === 'FINAL',
      ),
    ).toBe(true)
    expect(finalizedByPupil.get(fixture.pupilIds[0]!)?.subjectPosition).toBe(1)
    expect(finalizedByPupil.get(fixture.pupilIds[1]!)?.subjectPosition).toBe(3)
    expect(finalizedByPupil.get(fixture.pupilIds[2]!)?.subjectPosition).toBe(2)

    const adminEdit = await admin
      .put(`/api/schools/${fixture.schoolId}/assessments/score-entry`)
      .set('Origin', TEST_ORIGIN)
      .send({
        academicTermId: fixture.termId,
        classId: fixture.classId,
        subjectId: fixture.englishId,
        pupils: [
          {
            pupilId: fixture.pupilIds[0]!,
            scores: [{ componentId: componentIds.examination, score: '99' }],
          },
        ],
      })
    expect(adminEdit.status).toBe(403)

    const history = await platform.get(
      `/api/platform/assessments/schools/${fixture.schoolId}/submissions/${submitted.id}/history`,
    )
    expect(history.status).toBe(200)
    const actions = data<{ history: Array<{ action: string }> }>(
      history,
    ).history.map((entry) => entry.action)

    for (const action of [
      'SCORE_DRAFT_SAVED',
      'RESULT_SUBMITTED',
      'RESULT_RETURNED_FOR_CORRECTION',
      'RESULT_ACCEPTED',
    ]) {
      expect(actions).toContain(action)
    }

    const reviews = await platform.get(
      `/api/platform/assessments/schools/${fixture.schoolId}/submissions/${submitted.id}/reviews`,
    )
    expect(reviews.status).toBe(200)
    expect(data<{ reviews: unknown[] }>(reviews).reviews.length).toBeGreaterThanOrEqual(2)
  }, 60_000)

  it('exposes finalized subject positions only after acceptance', async () => {
    const entryAgent = await login(fixture.classTeacherEmail)

    const accepted = await entryAgent
      .get(`/api/schools/${fixture.schoolId}/assessments/score-entry`)
      .query({
        academicTermId: fixture.termId,
        classId: fixture.classId,
        subjectId: fixture.englishId,
      })
    expect(accepted.status).toBe(200)

    const acceptedPupils = data<{
      scoreEntry: {
        pupils: Array<{
          pupilId: string
          finalScore: number | null
          subjectPosition: number | null
          subjectPositionStatus: string
        }>
      }
    }>(accepted).scoreEntry.pupils
    const byPupil = new Map(
      acceptedPupils.map((pupil) => [pupil.pupilId, pupil]),
    )

    // Accepted English scores are 75, 0 and 50: 1st, 3rd and 2nd.
    expect(byPupil.get(fixture.pupilIds[0]!)?.subjectPosition).toBe(1)
    expect(byPupil.get(fixture.pupilIds[1]!)?.subjectPosition).toBe(3)
    expect(byPupil.get(fixture.pupilIds[2]!)?.subjectPosition).toBe(2)
    expect(
      acceptedPupils.every(
        (pupil) => pupil.subjectPositionStatus === 'FINAL',
      ),
    ).toBe(true)

    // Mathematics still has only an incomplete draft, so no position is
    // finalized and the rows are reported as incomplete rather than ranked.
    const draft = await entryAgent
      .get(`/api/schools/${fixture.schoolId}/assessments/score-entry`)
      .query({
        academicTermId: fixture.termId,
        classId: fixture.classId,
        subjectId: fixture.mathId,
      })
    expect(draft.status).toBe(200)
    expect(
      data<{
        scoreEntry: {
          pupils: Array<{
            subjectPosition: number | null
            subjectPositionStatus: string
          }>
        }
      }>(draft).scoreEntry.pupils.every(
        (pupil) =>
          pupil.subjectPosition === null &&
          pupil.subjectPositionStatus === 'INCOMPLETE',
      ),
    ).toBe(true)
  }, 30_000)

  it('keeps accepted grades stable after the grading scheme changes', async () => {
    // The scheme is system-managed through the API, so mutate it directly in
    // storage to prove accepted results keep their recorded snapshots.
    await prisma.gradeBand.deleteMany({
      where: { gradingSchemeId: fixture.schemeId },
    })
    await prisma.gradeBand.createMany({
      data: [
        {
          schoolId: fixture.schoolId,
          gradingSchemeId: fixture.schemeId,
          minScore: '75.00',
          maxScore: '100.00',
          gradeLabel: 'A1',
          remark: 'Changed after acceptance',
          sortOrder: 0,
        },
        {
          schoolId: fixture.schoolId,
          gradingSchemeId: fixture.schemeId,
          minScore: '0.00',
          maxScore: '74.99',
          gradeLabel: 'F9',
          remark: 'Changed after acceptance',
          sortOrder: 1,
        },
      ],
    })

    const entryAgent = await login(fixture.classTeacherEmail)
    const entry = await entryAgent
      .get(`/api/schools/${fixture.schoolId}/assessments/score-entry`)
      .query({
        academicTermId: fixture.termId,
        classId: fixture.classId,
        subjectId: fixture.englishId,
      })
    expect(entry.status).toBe(200)

    const pupil = data<{
      scoreEntry: {
        pupils: Array<{
          pupilId: string
          finalScore: number | null
          gradeLabel: string | null
          gradeRemark: string | null
        }>
      }
    }>(entry).scoreEntry.pupils.find(
      (item) => item.pupilId === fixture.pupilIds[0],
    )

    expect(pupil?.finalScore).toBe(75)
    expect(pupil?.gradeLabel).toBe('B2')
    expect(pupil?.gradeRemark).toBe('Very good')
  }, 30_000)

  it('denies cross-school and platform-administrator pupil access', async () => {
    const suffix = nextSuffix()
    const otherAdmin = request.agent(app)
    const registration = await otherAdmin
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(
        registrationBody({
          schoolName: `IT other assessment ${suffix}`,
          firstName: 'Other',
          lastName: 'Admin',
          email: `it-other-${suffix}@gradely-integration.test`,
        }),
      )
    expect(registration.status).toBe(201)
    const otherData = data<{ school: { id: string }; user: { id: string } }>(
      registration,
    )
    trackSchool(otherData.school.id)
    trackUser(otherData.user.id)
    await prisma.user.update({
      where: { id: otherData.user.id },
      data: { emailVerifiedAt: new Date(), emailVerificationRequired: false },
    })

    const crossSchool = await otherAdmin.get(
      `/api/schools/${fixture.schoolId}/assessments/policies`,
    )
    expect(crossSchool.status).toBe(403)

    const crossSchoolEntry = await otherAdmin
      .get(`/api/schools/${fixture.schoolId}/assessments/score-entry`)
      .query({
        academicTermId: fixture.termId,
        classId: fixture.classId,
        subjectId: fixture.englishId,
      })
    expect(crossSchoolEntry.status).toBe(403)

    const platformEmail = `it-platform-${suffix}@gradely-integration.test`
    const platform = await prisma.user.create({
      data: {
        email: platformEmail,
        passwordHash: await hashPassword(TEST_PASSWORD),
        firstName: 'Platform',
        lastName: 'Admin',
        isPlatformAdmin: true,
      },
    })
    trackUser(platform.id)

    const platformAgent = await login(platformEmail)
    const platformRead = await platformAgent.get(
      `/api/schools/${fixture.schoolId}/assessments/score-entry`,
    )
    expect(platformRead.status).toBe(403)
  }, 30_000)

  it('records workflow actions in the audit history', async () => {
    const entries = await prisma.resultAuditHistory.findMany({
      where: { schoolId: fixture.schoolId },
      select: { action: true },
    })
    const actions = new Set(entries.map((entry) => entry.action))

    for (const action of [
      'SCORE_DRAFT_SAVED',
      'RESULT_SUBMITTED',
      'RESULT_RETURNED_FOR_CORRECTION',
      'RESULT_ACCEPTED',
    ]) {
      expect(actions.has(action)).toBe(true)
    }

    // Configuration is system-managed, so no configuration audit actions
    // should be produced by school users.
    for (const action of [
      'GRADING_SCHEME_CREATED',
      'ASSESSMENT_POLICY_CREATED',
      'ASSESSMENT_POLICY_ACTIVATED',
    ]) {
      expect(actions.has(action)).toBe(false)
    }
  })
})
