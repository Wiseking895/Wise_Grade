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
import { assertSafeIntegrationTarget } from './target.js'

/**
 * Live pupil duplicate integration suite.
 *
 * Covers the paths that need real PostgreSQL semantics: the transaction-scoped
 * advisory lock used for concurrent registrations, the unique admission
 * constraint, merge conflict rollback, and dependent-row transfer with an
 * archived (never deleted) duplicate record.
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

describe.skipIf(!runIntegration)('pupil duplicate integration', () => {
  let app: Express
  let prisma: PrismaClient
  let admin: ReturnType<typeof request.agent>
  let teacherOne: ReturnType<typeof request.agent>
  let teacherTwo: ReturnType<typeof request.agent>

  let schoolId: string
  let yearId: string
  let termId: string
  let basicOneId: string
  let basicTwoId: string

  const createdSchoolIds: string[] = []
  const createdUserIds: string[] = []

  let counter = 0

  function nextSuffix(): string {
    counter += 1
    return `${Date.now().toString(36)}-${counter}-${Math.random()
      .toString(36)
      .slice(2, 8)}`
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

  async function registerClass(
    className: string,
    email: string,
  ): Promise<{
    agent: ReturnType<typeof request.agent>
    classId: string
  }> {
    const response = await admin
      .post(`/api/schools/${schoolId}/classes/register`)
      .set('Origin', TEST_ORIGIN)
      .send({
        className,
        academicYearId: yearId,
        teacher: {
          firstName: 'Class',
          lastName: className.replace(/\s+/g, ''),
          email,
        },
      })

    expect(response.status).toBe(201)
    const registered = data<{
      class: { id: string }
      teacher: { userId: string }
    }>(response)
    createdUserIds.push(registered.teacher.userId)

    await prisma.user.update({
      where: { id: registered.teacher.userId },
      data: {
        passwordHash: await hashPassword(TEST_PASSWORD),
        mustChangePassword: false,
      },
    })

    return {
      agent: await login(email),
      classId: registered.class.id,
    }
  }

  function createPupil(
    agent: ReturnType<typeof request.agent>,
    input: {
      firstName: string
      lastName: string
      admissionNumber: string
      classId: string
      confirmDifferentPupil?: boolean
      duplicateOfPupilId?: string | null
    },
  ) {
    return agent
      .post(`/api/schools/${schoolId}/pupils`)
      .set('Origin', TEST_ORIGIN)
      .send({
        academicYearId: yearId,
        ...input,
      })
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

    const suffix = nextSuffix()
    admin = request.agent(app)
    const registration = await admin
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(
        registrationBody({
          schoolName: `IT duplicates ${suffix}`,
          firstName: 'Duplicate',
          lastName: 'Admin',
          email: `it-duplicates-${suffix}@gradely-integration.test`,
        }),
      )

    expect(registration.status).toBe(201)
    const registrationData = data<{
      school: { id: string }
      user: { id: string }
    }>(registration)
    schoolId = registrationData.school.id
    createdSchoolIds.push(schoolId)
    createdUserIds.push(registrationData.user.id)

    await prisma.user.update({
      where: { id: registrationData.user.id },
      data: { emailVerifiedAt: new Date(), emailVerificationRequired: false },
    })

    const years = await admin.get(`/api/schools/${schoolId}/academic-years`)
    expect(years.status).toBe(200)
    const academicYears = data<{
      academicYears: Array<{
        id: string
        isCurrent: boolean
        terms: Array<{ id: string; sequence: number }>
      }>
    }>(years).academicYears
    const currentYear = academicYears.find((year) => year.isCurrent)
    expect(currentYear).toBeDefined()
    yearId = currentYear!.id
    termId = currentYear!.terms.find((term) => term.sequence === 1)!.id

    const first = await registerClass(
      'Basic 1',
      `it-dup-ct1-${suffix}@gradely-integration.test`,
    )
    const second = await registerClass(
      'Basic 2',
      `it-dup-ct2-${suffix}@gradely-integration.test`,
    )
    teacherOne = first.agent
    teacherTwo = second.agent
    basicOneId = first.classId
    basicTwoId = second.classId
  }, 60_000)

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

  it('serializes concurrent registrations with the same complete name', async () => {
    const [left, right] = await Promise.all([
      createPupil(teacherOne, {
        firstName: 'Race',
        lastName: 'Pupil',
        admissionNumber: `RACE-A-${nextSuffix()}`,
        classId: basicOneId,
      }),
      createPupil(teacherOne, {
        firstName: 'Race',
        lastName: 'Pupil',
        admissionNumber: `RACE-B-${nextSuffix()}`,
        classId: basicOneId,
      }),
    ])

    expect([left.status, right.status].sort()).toEqual([201, 409])

    const conflict = left.status === 409 ? left : right
    expect(conflict.body.error.code).toBe('PUPIL_DUPLICATE_NAME')
    expect(conflict.body.error.meta).toMatchObject({
      category: 'NAME_CONFLICT',
      requiresConfirmation: true,
    })

    const count = await prisma.pupil.count({
      where: { schoolId, firstName: 'Race', lastName: 'Pupil' },
    })
    expect(count).toBe(1)
  }, 30_000)

  it('detects the same name across classes and rolls a conflicted merge back', async () => {
    const primary = await createPupil(teacherOne, {
      firstName: 'Merge',
      lastName: 'Pupil',
      admissionNumber: `MERGE-A-${nextSuffix()}`,
      classId: basicOneId,
    })
    expect(primary.status).toBe(201)
    const primaryId = data<{ pupil: { id: string } }>(primary).pupil.id

    // The same complete name in another class still needs confirmation.
    const unconfirmed = await createPupil(teacherTwo, {
      firstName: 'Merge',
      lastName: 'Pupil',
      admissionNumber: `MERGE-B-${nextSuffix()}`,
      classId: basicTwoId,
    })
    expect(unconfirmed.status).toBe(409)
    expect(unconfirmed.body.error.code).toBe('PUPIL_DUPLICATE_NAME')
    expect(unconfirmed.body.error.meta.existingPupil.id).toBe(primaryId)

    const duplicate = await createPupil(teacherTwo, {
      firstName: 'Merge',
      lastName: 'Pupil',
      admissionNumber: `MERGE-C-${nextSuffix()}`,
      classId: basicTwoId,
      confirmDifferentPupil: true,
      duplicateOfPupilId: primaryId,
    })
    expect(duplicate.status).toBe(201)
    const duplicateId = data<{ pupil: { id: string } }>(duplicate).pupil.id

    // A completed historical enrollment must be transferred safely.
    const duplicateEnrollment = await prisma.pupilEnrollment.findFirstOrThrow({
      where: { schoolId, pupilId: duplicateId },
    })
    await prisma.pupilEnrollment.update({
      where: { id: duplicateEnrollment.id },
      data: { status: 'COMPLETED' },
    })

    // Both records have report input for the same term, which the merge must
    // flag for manual review instead of silently duplicating academic data.
    await prisma.reportInput.create({
      data: {
        schoolId,
        academicYearId: yearId,
        academicTermId: termId,
        classId: basicOneId,
        pupilId: primaryId,
      },
    })
    await prisma.reportInput.create({
      data: {
        schoolId,
        academicYearId: yearId,
        academicTermId: termId,
        classId: basicTwoId,
        pupilId: duplicateId,
      },
    })

    const preview = await admin
      .post(`/api/schools/${schoolId}/pupil-duplicates/merge-preview`)
      .set('Origin', TEST_ORIGIN)
      .send({ primaryPupilId: primaryId, duplicatePupilId: duplicateId })
    expect(preview.status).toBe(200)
    expect(preview.body.data.preview.canMerge).toBe(false)
    expect(
      preview.body.data.preview.conflicts.map(
        (conflict: { area: string }) => conflict.area,
      ),
    ).toContain('REPORT_INPUT')

    const blocked = await admin
      .post(`/api/schools/${schoolId}/pupil-duplicates/merge`)
      .set('Origin', TEST_ORIGIN)
      .send({
        primaryPupilId: primaryId,
        duplicatePupilId: duplicateId,
        confirm: true,
      })
    expect(blocked.status).toBe(409)
    expect(blocked.body.error.code).toBe('PUPIL_MERGE_CONFLICTS')

    // The failed merge rolled back completely.
    const primaryAfterBlock = await prisma.pupil.findUniqueOrThrow({
      where: { id: primaryId },
    })
    const duplicateAfterBlock = await prisma.pupil.findUniqueOrThrow({
      where: { id: duplicateId },
    })
    expect(primaryAfterBlock.status).toBe('ACTIVE')
    expect(duplicateAfterBlock.status).toBe('ACTIVE')
    expect(
      await prisma.pupilEnrollment.findUniqueOrThrow({
        where: { id: duplicateEnrollment.id },
      }),
    ).toMatchObject({ pupilId: duplicateId, status: 'COMPLETED' })
    expect(
      await prisma.auditLog.count({
        where: { schoolId, action: 'PUPIL_MERGED' },
      }),
    ).toBe(0)

    // Resolve the conflict, then merge for real.
    await prisma.reportInput.deleteMany({
      where: { schoolId, pupilId: duplicateId },
    })

    const merged = await admin
      .post(`/api/schools/${schoolId}/pupil-duplicates/merge`)
      .set('Origin', TEST_ORIGIN)
      .send({
        primaryPupilId: primaryId,
        duplicatePupilId: duplicateId,
        confirm: true,
        note: 'Integration test merge.',
      })
    expect(merged.status).toBe(200)
    expect(merged.body.data.archivedPupilId).toBe(duplicateId)

    const retained = await prisma.pupil.findUniqueOrThrow({
      where: { id: primaryId },
    })
    const archived = await prisma.pupil.findUniqueOrThrow({
      where: { id: duplicateId },
    })
    expect(retained.status).toBe('ACTIVE')
    expect(archived.status).toBe('ARCHIVED')
    expect(archived.currentClassId).toBeNull()

    // The historical enrollment moved to the retained pupil and was not
    // duplicated; the report input stays exactly once on the retained pupil.
    expect(
      await prisma.pupilEnrollment.findUniqueOrThrow({
        where: { id: duplicateEnrollment.id },
      }),
    ).toMatchObject({ pupilId: primaryId, status: 'COMPLETED' })
    expect(
      await prisma.pupilEnrollment.count({
        where: { schoolId, pupilId: primaryId },
      }),
    ).toBe(2)
    expect(
      await prisma.reportInput.count({
        where: { schoolId, academicTermId: termId, pupilId: primaryId },
      }),
    ).toBe(1)
    expect(
      await prisma.reportInput.count({
        where: { schoolId, pupilId: duplicateId },
      }),
    ).toBe(0)

    const mergeAudit = await prisma.auditLog.findFirstOrThrow({
      where: { schoolId, action: 'PUPIL_MERGED' },
      orderBy: { createdAt: 'desc' },
    })
    expect(mergeAudit.actorUserId).toBeTruthy()
    expect(mergeAudit.metadata).toMatchObject({
      primaryPupilId: primaryId,
      duplicatePupilId: duplicateId,
      decision: 'MERGED',
    })
    expect(
      await prisma.auditLog.count({
        where: {
          schoolId,
          action: 'PUPIL_ARCHIVED',
          entityId: duplicateId,
        },
      }),
    ).toBe(1)

    const audit = await admin.get(
      `/api/schools/${schoolId}/pupil-duplicates?q=Merge%20Pupil`,
    )
    expect(audit.status).toBe(200)
    const group = audit.body.data.groups.find(
      (item: { nameKey: string }) => item.nameKey === 'merge pupil',
    )
    expect(group).toBeDefined()
    expect(group.resolved).toBe(true)
    expect(
      group.pupils.map((pupil: { id: string }) => pupil.id).sort(),
    ).toEqual([primaryId, duplicateId].sort())
  }, 60_000)

  it('transfers subject scores and report cards, and blocks on subject-score conflicts', async () => {
    const primary = await createPupil(teacherOne, {
      firstName: 'Academic',
      lastName: 'Pupil',
      admissionNumber: `ACAD-A-${nextSuffix()}`,
      classId: basicOneId,
    })
    expect(primary.status).toBe(201)
    const primaryId = data<{ pupil: { id: string } }>(primary).pupil.id

    const duplicate = await createPupil(teacherTwo, {
      firstName: 'Academic',
      lastName: 'Pupil',
      admissionNumber: `ACAD-B-${nextSuffix()}`,
      classId: basicTwoId,
      confirmDifferentPupil: true,
      duplicateOfPupilId: primaryId,
    })
    expect(duplicate.status).toBe(201)
    const duplicateId = data<{ pupil: { id: string } }>(duplicate).pupil.id

    const suffix = nextSuffix()
    const transferSubject = await prisma.subject.create({
      data: { schoolId, name: `IT Transfer ${suffix}`, code: 'ITT' },
    })
    const conflictSubject = await prisma.subject.create({
      data: { schoolId, name: `IT Conflict ${suffix}`, code: 'ITC' },
    })

    // Transfer case: a score that exists only on the duplicate.
    await prisma.pupilSubjectScore.create({
      data: {
        schoolId,
        academicYearId: yearId,
        academicTermId: termId,
        classId: basicTwoId,
        pupilId: duplicateId,
        subjectId: transferSubject.id,
      },
    })
    // Conflict case: both records scored the same subject in the same term.
    await prisma.pupilSubjectScore.create({
      data: {
        schoolId,
        academicYearId: yearId,
        academicTermId: termId,
        classId: basicOneId,
        pupilId: primaryId,
        subjectId: conflictSubject.id,
      },
    })
    await prisma.pupilSubjectScore.create({
      data: {
        schoolId,
        academicYearId: yearId,
        academicTermId: termId,
        classId: basicTwoId,
        pupilId: duplicateId,
        subjectId: conflictSubject.id,
      },
    })
    // Report card: exists only on the duplicate, so it transfers.
    await prisma.reportCard.create({
      data: {
        schoolId,
        academicYearId: yearId,
        academicTermId: termId,
        classId: basicTwoId,
        pupilId: duplicateId,
      },
    })

    const preview = await admin
      .post(`/api/schools/${schoolId}/pupil-duplicates/merge-preview`)
      .set('Origin', TEST_ORIGIN)
      .send({ primaryPupilId: primaryId, duplicatePupilId: duplicateId })
    expect(preview.status).toBe(200)
    expect(preview.body.data.preview.canMerge).toBe(false)
    expect(
      preview.body.data.preview.conflicts.map(
        (conflict: { area: string }) => conflict.area,
      ),
    ).toContain('PUPIL_SUBJECT_SCORE')
    expect(preview.body.data.preview.transferable.subjectScores).toBe(1)
    expect(preview.body.data.preview.transferable.reportCards).toBe(1)

    // Remove the conflicting score, then the merge proceeds.
    await prisma.pupilSubjectScore.deleteMany({
      where: { schoolId, pupilId: duplicateId, subjectId: conflictSubject.id },
    })

    const merged = await admin
      .post(`/api/schools/${schoolId}/pupil-duplicates/merge`)
      .set('Origin', TEST_ORIGIN)
      .send({
        primaryPupilId: primaryId,
        duplicatePupilId: duplicateId,
        confirm: true,
      })
    expect(merged.status).toBe(200)

    const transferredScore = await prisma.pupilSubjectScore.findFirstOrThrow({
      where: { schoolId, subjectId: transferSubject.id },
    })
    expect(transferredScore.pupilId).toBe(primaryId)

    const keptConflictScore = await prisma.pupilSubjectScore.findFirstOrThrow({
      where: { schoolId, subjectId: conflictSubject.id },
    })
    expect(keptConflictScore.pupilId).toBe(primaryId)

    const transferredCard = await prisma.reportCard.findFirstOrThrow({
      where: { schoolId },
    })
    expect(transferredCard.pupilId).toBe(primaryId)

    const archived = await prisma.pupil.findUniqueOrThrow({
      where: { id: duplicateId },
    })
    expect(archived.status).toBe('ARCHIVED')
  }, 60_000)
})
