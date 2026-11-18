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
 * Live Phase 6D integration suite for the automatic Wise Grade standard policy.
 *
 * Skipped entirely unless TEST_DATABASE_URL is set. The suite proves that the
 * standard policy is created lazily and idempotently, that it uses the exact
 * required components and maxima, that grouped SBA calculation matches the
 * documented examples, and that custom policies and accepted historical
 * results are never overwritten.
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

interface PrimaryFixture {
  schoolId: string
  yearId: string
  termId: string
  classId: string
  englishId: string
  mathId: string
  pupilIds: string[]
  earlyClassId: string
  earlyPupilIds: string[]
  standardPolicyId: string
  schemeId: string
  componentIds: Record<string, string>
}

interface PolicyResponse {
  id: string
  name: string
  scopeKey: string
  version: number
  isActive: boolean
  isDefault: boolean
  calculationMode: string
  gradingScheme: {
    id: string
    name: string
    bands: Array<{
      minScore: string
      maxScore: string
      gradeLabel: string
      remark: string
    }>
  }
  components: Array<{
    id: string
    key: string
    name: string
    category: 'SBA' | 'EXAM'
    maximumScore: string
    weightPercent: string
    sortOrder: number
  }>
}

interface ScoreEntryResponse {
  policy: PolicyResponse | null
  earlyYears: boolean
  submission: { id: string; status: string; version: number } | null
  pupils: Array<{
    pupilId: string
    scores: Record<string, string>
    missingComponentIds: string[]
    sbaContribution: number | null
    examContribution: number | null
    finalScore: number | null
    gradeLabel: string | null
    gradeRemark: string | null
  }>
  readiness: { canSubmit: boolean; incompletePupils: number }
}

describe.skipIf(!runIntegration)(
  'Phase 6D automatic standard assessment policy integration',
  () => {
    let app: Express
    let prisma: PrismaClient
    let admin: ReturnType<typeof request.agent>
    let classTeacher: ReturnType<typeof request.agent>
    let earlyTeacher: ReturnType<typeof request.agent>
    let platform: ReturnType<typeof request.agent>
    let primary: PrimaryFixture

    const createdSchoolIds: string[] = []
    const createdUserIds: string[] = []

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

    /**
     * Assessment configuration is system-managed, so the suite reads policies
     * directly from storage instead of the blocked school configuration API.
     */
    async function listPolicies(
      schoolId: string,
      academicYearId: string,
      academicTermId: string,
    ): Promise<PolicyResponse[]> {
      const policies = await prisma.assessmentPolicy.findMany({
        where: { schoolId, academicYearId, academicTermId, isActive: true },
        include: {
          gradingScheme: { include: { bands: true } },
          components: true,
        },
        orderBy: [{ scopeKey: 'asc' }, { version: 'desc' }],
      })

      return policies.map((policy) => ({
        id: policy.id,
        name: policy.name,
        scopeKey: policy.scopeKey,
        version: policy.version,
        isActive: policy.isActive,
        isDefault: policy.isDefault,
        calculationMode: policy.calculationMode,
        gradingScheme: {
          id: policy.gradingScheme.id,
          name: policy.gradingScheme.name,
          bands: policy.gradingScheme.bands
            .sort((left, right) => left.sortOrder - right.sortOrder)
            .map((band) => ({
              minScore: band.minScore.toFixed(2),
              maxScore: band.maxScore.toFixed(2),
              gradeLabel: band.gradeLabel,
              remark: band.remark,
            })),
        },
        components: policy.components
          .sort((left, right) => left.sortOrder - right.sortOrder)
          .map((component) => ({
            id: component.id,
            key: component.key,
            name: component.name,
            category: component.category as 'SBA' | 'EXAM',
            maximumScore: component.maximumScore.toFixed(2),
            weightPercent: component.weightPercent.toFixed(2),
            sortOrder: component.sortOrder,
          })),
      }))
    }

    /**
     * Score entry is the remaining school-user surface that lazily initializes
     * a term's standard policy.
     */
    async function initializeTerm(
      academicTermId: string,
      classId = primary.classId,
      subjectId = primary.englishId,
    ): Promise<ScoreEntryResponse> {
      const agent = classId === primary.earlyClassId ? earlyTeacher : classTeacher
      const response = await agent
        .get(`/api/schools/${primary.schoolId}/assessments/score-entry`)
        .query({ academicTermId, classId, subjectId })
      expect(response.status).toBe(200)
      return data<{ scoreEntry: ScoreEntryResponse }>(response).scoreEntry
    }

    async function termBySequence(sequence: number): Promise<string> {
      const response = await admin.get(
        `/api/schools/${primary.schoolId}/academic-terms`,
      )
      expect(response.status).toBe(200)
      const terms = data<{
        terms: Array<{ id: string; sequence: number }>
      }>(response).terms
      const term = terms.find((item) => item.sequence === sequence)
      expect(term).toBeDefined()
      return term!.id
    }

    function standardScores(
      componentIds: Record<string, string>,
      sba: [string, string, string, string],
      examination: string,
    ) {
      return [
        { componentId: componentIds['individual-test'], score: sba[0] },
        { componentId: componentIds['group-work'], score: sba[1] },
        { componentId: componentIds['class-test'], score: sba[2] },
        { componentId: componentIds.project, score: sba[3] },
        { componentId: componentIds.examination, score: examination },
      ]
    }

    function customComponents() {
      return [
        {
          key: 'class-test',
          name: 'Class test',
          category: 'SBA' as const,
          maximumScore: '20',
          weightPercent: '20',
          sortOrder: 0,
        },
        {
          key: 'project',
          name: 'Project',
          category: 'SBA' as const,
          maximumScore: '10',
          weightPercent: '10',
          sortOrder: 1,
        },
        {
          key: 'homework',
          name: 'Homework',
          category: 'SBA' as const,
          maximumScore: '10',
          weightPercent: '10',
          sortOrder: 2,
        },
        {
          key: 'examination',
          name: 'Examination',
          category: 'EXAM' as const,
          maximumScore: '100',
          weightPercent: '60',
          sortOrder: 3,
        },
      ]
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
      })

      const databases = await prisma.$queryRaw<{ name: string }[]>`
        SELECT current_database() AS name
      `
      expect(databases[0]?.name).toBe(databaseName(testDatabaseUrl!))

      const suffix = nextSuffix()
      admin = request.agent(app)

      const registration = await admin
        .post('/api/auth/register-school')
        .set('Origin', TEST_ORIGIN)
        .send(
          registrationBody({
            schoolName: `IT standard policy ${suffix}`,
            firstName: 'Standard',
            lastName: 'Admin',
            email: `it-standard-${suffix}@gradely-integration.test`,
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

      const years = await admin.get(
        `/api/schools/${schoolId}/academic-years`,
      )
      expect(years.status).toBe(200)
      const academicYears = data<{
        academicYears: Array<{
          id: string
          isCurrent: boolean
          terms: Array<{ id: string; sequence: number }>
        }>
      }>(years).academicYears
      const academicYear = academicYears.find((item) => item.isCurrent)
      expect(academicYear).toBeDefined()
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
      const creche = classList.find((item) => item.name === 'Creche')
      expect(creche).toBeDefined()

      // Registration never seeds a subject catalogue. The legacy seeding
      // endpoint no longer exists.
      const subjects = await admin
        .post(`/api/schools/${schoolId}/subjects/seed-defaults`)
        .set('Origin', TEST_ORIGIN)
        .send({})
      expect(subjects.status).toBe(404)

      const settings = await admin
        .patch(`/api/schools/${schoolId}/assessments/settings`)
        .set('Origin', TEST_ORIGIN)
        .send({ classTeacherEntryMode: 'ALL_CLASS_SUBJECTS' })
      expect(settings.status).toBe(200)

      const classTeacherEmail = `it-standard-ct-${suffix}@gradely-integration.test`
      const earlyTeacherEmail = `it-standard-early-${suffix}@gradely-integration.test`

      const classTeacherResponse = await admin
        .post(`/api/schools/${schoolId}/teachers`)
        .set('Origin', TEST_ORIGIN)
        .send({
          firstName: 'Class',
          lastName: 'Teacher',
          email: classTeacherEmail,
          role: 'CLASS_TEACHER',
          initialPassword: TEST_PASSWORD,
          className: 'Basic 1',
        })
      expect(classTeacherResponse.status).toBe(201)
      trackUser(
        data<{ teacher: { userId: string } }>(classTeacherResponse).teacher
          .userId,
      )

      const earlyTeacherResponse = await admin
        .post(`/api/schools/${schoolId}/teachers`)
        .set('Origin', TEST_ORIGIN)
        .send({
          firstName: 'Early',
          lastName: 'Teacher',
          email: earlyTeacherEmail,
          role: 'CLASS_TEACHER',
          initialPassword: TEST_PASSWORD,
          className: 'Creche',
        })
      expect(earlyTeacherResponse.status).toBe(201)
      trackUser(
        data<{ teacher: { userId: string } }>(earlyTeacherResponse).teacher
          .userId,
      )

      classTeacher = request.agent(app)
      const classTeacherLogin = await classTeacher
        .post('/api/auth/login')
        .set('Origin', TEST_ORIGIN)
        .send({ email: classTeacherEmail, password: TEST_PASSWORD })
      expect(classTeacherLogin.status).toBe(200)

      earlyTeacher = request.agent(app)
      const earlyTeacherLogin = await earlyTeacher
        .post('/api/auth/login')
        .set('Origin', TEST_ORIGIN)
        .send({ email: earlyTeacherEmail, password: TEST_PASSWORD })
      expect(earlyTeacherLogin.status).toBe(200)

      // Class subjects are managed by each assigned class teacher. The first
      // teacher creates the school-level subject records; the second reuses
      // them case-insensitively while adding them to their own class.
      let englishId = ''
      let mathId = ''

      for (const subject of [
        { name: 'English Language', code: 'ENG' },
        { name: 'Mathematics', code: 'MATH' },
      ]) {
        const assignment = await classTeacher
          .post(`/api/schools/${schoolId}/classes/${basicOne!.id}/subjects`)
          .set('Origin', TEST_ORIGIN)
          .send(subject)
        expect(assignment.status).toBe(201)
        const assignedSubjectId = data<{
          assignment: { subjectId: string }
        }>(assignment).assignment.subjectId

        if (subject.name === 'English Language') englishId = assignedSubjectId
        if (subject.name === 'Mathematics') mathId = assignedSubjectId

        const earlyAssignment = await earlyTeacher
          .post(`/api/schools/${schoolId}/classes/${creche!.id}/subjects`)
          .set('Origin', TEST_ORIGIN)
          .send(subject)
        expect(earlyAssignment.status).toBe(201)
        expect(
          data<{ assignment: { subjectId: string } }>(earlyAssignment).assignment
            .subjectId,
        ).toBe(assignedSubjectId)
      }

      const pupilIds: string[] = []

      for (let index = 1; index <= 3; index += 1) {
        const pupil = await classTeacher
          .post(`/api/schools/${schoolId}/pupils`)
          .set('Origin', TEST_ORIGIN)
          .send({
            firstName: `Pupil${index}`,
            lastName: 'Standard',
            admissionNumber: `${suffix}-ADM-${index}`,
            classId: basicOne!.id,
            academicYearId: yearId,
          })
        expect(pupil.status).toBe(201)
        pupilIds.push(data<{ pupil: { id: string } }>(pupil).pupil.id)
      }

      const earlyPupilIds: string[] = []

      for (let index = 1; index <= 4; index += 1) {
        const pupil = await earlyTeacher
          .post(`/api/schools/${schoolId}/pupils`)
          .set('Origin', TEST_ORIGIN)
          .send({
            firstName: `Early${index}`,
            lastName: 'Standard',
            admissionNumber: `${suffix}-EARLY-${index}`,
            classId: creche!.id,
            academicYearId: yearId,
          })
        expect(pupil.status).toBe(201)
        earlyPupilIds.push(data<{ pupil: { id: string } }>(pupil).pupil.id)
      }

      const platformEmail = `it-standard-platform-${suffix}@gradely-integration.test`
      const platformUser = await prisma.user.create({
        data: {
          email: platformEmail,
          passwordHash: await hashPassword(TEST_PASSWORD),
          firstName: 'Platform',
          lastName: 'Reviewer',
          isPlatformAdmin: true,
        },
      })
      trackUser(platformUser.id)
      platform = request.agent(app)
      const platformLogin = await platform
        .post('/api/auth/login')
        .set('Origin', TEST_ORIGIN)
        .send({ email: platformEmail, password: TEST_PASSWORD })
      expect(platformLogin.status).toBe(200)

      primary = {
        schoolId,
        yearId,
        termId,
        classId: basicOne!.id,
        englishId,
        mathId,
        pupilIds,
        earlyClassId: creche!.id,
        earlyPupilIds,
        standardPolicyId: '',
        schemeId: '',
        componentIds: {},
      }
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

    it('creates the standard policy automatically with the exact components', async () => {
      await initializeTerm(primary.termId)

      const policies = await listPolicies(
        primary.schoolId,
        primary.yearId,
        primary.termId,
      )

      const standard = policies.find(
        (policy) => policy.isDefault && policy.isActive,
      )
      expect(standard).toBeDefined()
      expect(standard!.name).toBe('Wise Grade Standard Assessment Policy')
      expect(standard!.scopeKey).toBe('term')
      expect(standard!.calculationMode).toBe('GROUPED_SBA')
      expect(standard!.gradingScheme.name).toBe(
        'Wise Grade Standard Grading Scheme',
      )
      const bands = standard!.gradingScheme.bands
      expect(bands).toHaveLength(9)
      expect(
        Math.min(...bands.map((band) => Number(band.minScore))),
      ).toBe(0)
      expect(
        Math.max(...bands.map((band) => Number(band.maxScore))),
      ).toBe(100)

      expect(
        standard!.components.map((component) => ({
          key: component.key,
          name: component.name,
          category: component.category,
          maximumScore: component.maximumScore,
          weightPercent: component.weightPercent,
        })),
      ).toEqual([
        {
          key: 'individual-test',
          name: 'Individual Test',
          category: 'SBA',
          maximumScore: '15.00',
          weightPercent: '7.50',
        },
        {
          key: 'group-work',
          name: 'Group Work',
          category: 'SBA',
          maximumScore: '15.00',
          weightPercent: '7.50',
        },
        {
          key: 'class-test',
          name: 'Class Test',
          category: 'SBA',
          maximumScore: '15.00',
          weightPercent: '7.50',
        },
        {
          key: 'project',
          name: 'Project',
          category: 'SBA',
          maximumScore: '15.00',
          weightPercent: '7.50',
        },
        {
          key: 'examination',
          name: 'Examination',
          category: 'EXAM',
          maximumScore: '100.00',
          weightPercent: '70.00',
        },
      ])

      primary.standardPolicyId = standard!.id
      primary.schemeId = standard!.gradingScheme.id
      for (const component of standard!.components) {
        primary.componentIds[component.key] = component.id
      }

      // A repeated read is idempotent and does not create another version.
      await initializeTerm(primary.termId)
      const repeated = await listPolicies(
        primary.schoolId,
        primary.yearId,
        primary.termId,
      )
      const activeDefaults = repeated.filter(
        (policy) => policy.isDefault && policy.isActive,
      )
      expect(activeDefaults).toHaveLength(1)
      expect(activeDefaults[0]?.id).toBe(standard!.id)

      expect(
        await prisma.assessmentPolicy.count({
          where: {
            schoolId: primary.schoolId,
            academicTermId: primary.termId,
            isActive: true,
          },
        }),
      ).toBe(1)
    }, 30_000)

    it('initializes concurrently without creating duplicate policies', async () => {
      const termId = await termBySequence(2)

      const responses = await Promise.all(
        Array.from({ length: 6 }, () =>
          classTeacher
            .get(`/api/schools/${primary.schoolId}/assessments/score-entry`)
            .query({
              academicTermId: termId,
              classId: primary.classId,
              subjectId: primary.englishId,
            }),
        ),
      )

      for (const response of responses) {
        expect(response.status).toBe(200)
      }

      const active = await prisma.assessmentPolicy.findMany({
        where: {
          schoolId: primary.schoolId,
          academicTermId: termId,
          isActive: true,
        },
        include: { components: true },
      })

      expect(active).toHaveLength(1)
      expect(active[0]?.isDefault).toBe(true)
      expect(active[0]?.calculationMode).toBe('GROUPED_SBA')
      expect(active[0]?.components).toHaveLength(5)
      expect(
        active[0]?.components
          .sort((left, right) => left.sortOrder - right.sortOrder)
          .map((component) => component.key),
      ).toEqual([
        'individual-test',
        'group-work',
        'class-test',
        'project',
        'examination',
      ])
      // The existing active scheme is reused rather than duplicated.
      expect(active[0]?.gradingSchemeId).toBe(primary.schemeId)
    }, 60_000)

    it('calculates Examples A, B and C through score entry', async () => {
      const entry = await classTeacher
        .get(`/api/schools/${primary.schoolId}/assessments/score-entry`)
        .query({
          academicTermId: primary.termId,
          classId: primary.classId,
          subjectId: primary.englishId,
        })
      expect(entry.status).toBe(200)
      const view = data<{ scoreEntry: ScoreEntryResponse }>(entry).scoreEntry
      expect(view.policy?.isDefault).toBe(true)
      expect(view.policy?.calculationMode).toBe('GROUPED_SBA')

      const componentIds: Record<string, string> = {}
      for (const component of view.policy!.components) {
        componentIds[component.key] = component.id
      }

      const draft = await classTeacher
        .put(`/api/schools/${primary.schoolId}/assessments/score-entry`)
        .set('Origin', TEST_ORIGIN)
        .send({
          academicTermId: primary.termId,
          classId: primary.classId,
          subjectId: primary.englishId,
          expectedVersion: 0,
          pupils: [
            {
              pupilId: primary.pupilIds[0]!,
              scores: standardScores(
                componentIds,
                ['15', '15', '15', '15'],
                '100',
              ),
            },
            {
              pupilId: primary.pupilIds[1]!,
              scores: standardScores(
                componentIds,
                ['12', '10', '8', '15'],
                '75',
              ),
            },
            {
              pupilId: primary.pupilIds[2]!,
              scores: standardScores(
                componentIds,
                ['8', '7', '8', '7'],
                '50',
              ),
            },
          ],
        })
      expect(draft.status).toBe(200)
      const draftView = data<{ scoreEntry: ScoreEntryResponse }>(
        draft,
      ).scoreEntry
      expect(draftView.submission?.status).toBe('DRAFT')

      const byPupil = new Map(
        draftView.pupils.map((pupil) => [pupil.pupilId, pupil]),
      )

      expect(byPupil.get(primary.pupilIds[0]!)).toMatchObject({
        sbaContribution: 30,
        examContribution: 70,
        finalScore: 100,
        gradeLabel: 'A1',
        missingComponentIds: [],
      })
      expect(byPupil.get(primary.pupilIds[1]!)).toMatchObject({
        sbaContribution: 22.5,
        examContribution: 52.5,
        finalScore: 75,
        gradeLabel: 'B2',
        missingComponentIds: [],
      })
      expect(byPupil.get(primary.pupilIds[2]!)).toMatchObject({
        sbaContribution: 15,
        examContribution: 35,
        finalScore: 50,
        gradeLabel: 'D7',
        missingComponentIds: [],
      })

      // Individual SBA component rows are stored raw; the Class Score is only
      // scaled once when contributions are calculated.
      const stored = await prisma.pupilSubjectScore.findUnique({
        where: {
          schoolId_academicTermId_pupilId_subjectId: {
            schoolId: primary.schoolId,
            academicTermId: primary.termId,
            pupilId: primary.pupilIds[1]!,
            subjectId: primary.englishId,
          },
        },
      })
      expect(stored?.policyId).toBe(primary.standardPolicyId)
      expect(Number(stored?.sbaContribution)).toBe(22.5)
      expect(Number(stored?.examContribution)).toBe(52.5)
      expect(Number(stored?.finalScore)).toBe(75)
      expect(stored?.gradeLabel).toBe('B2')
    }, 30_000)

    it('classifies early-years subjects as Gold, Silver and Bronze', async () => {
      const view = await initializeTerm(
        primary.termId,
        primary.earlyClassId,
        primary.englishId,
      )
      expect(view.earlyYears).toBe(true)
      expect(view.policy?.isDefault).toBe(true)

      const componentIds: Record<string, string> = {}
      for (const component of view.policy!.components) {
        componentIds[component.key] = component.id
      }

      const draft = await earlyTeacher
        .put(`/api/schools/${primary.schoolId}/assessments/score-entry`)
        .set('Origin', TEST_ORIGIN)
        .send({
          academicTermId: primary.termId,
          classId: primary.earlyClassId,
          subjectId: primary.englishId,
          expectedVersion: 0,
          pupils: [
            // 48/60 -> 24 + 56 = 80 -> Gold boundary.
            {
              pupilId: primary.earlyPupilIds[0]!,
              scores: standardScores(
                componentIds,
                ['12', '12', '12', '12'],
                '80',
              ),
            },
            // 42/60 -> 21 + 49 = 70 -> Silver.
            {
              pupilId: primary.earlyPupilIds[1]!,
              scores: standardScores(
                componentIds,
                ['10', '11', '10', '11'],
                '70',
              ),
            },
            // 30/60 -> 15 + 35 = 50 -> Bronze.
            {
              pupilId: primary.earlyPupilIds[2]!,
              scores: standardScores(
                componentIds,
                ['8', '7', '8', '7'],
                '50',
              ),
            },
            // 40/60 -> 20 + 35 = 55 -> Silver boundary.
            {
              pupilId: primary.earlyPupilIds[3]!,
              scores: standardScores(
                componentIds,
                ['10', '10', '10', '10'],
                '50',
              ),
            },
          ],
        })
      expect(draft.status).toBe(200)

      const draftView = data<{ scoreEntry: ScoreEntryResponse }>(
        draft,
      ).scoreEntry
      const byPupil = new Map(
        draftView.pupils.map((pupil) => [pupil.pupilId, pupil]),
      )

      expect(byPupil.get(primary.earlyPupilIds[0]!)).toMatchObject({
        sbaContribution: 24,
        examContribution: 56,
        finalScore: 80,
        gradeLabel: 'G',
        gradeRemark: 'Gold',
      })
      expect(byPupil.get(primary.earlyPupilIds[1]!)).toMatchObject({
        sbaContribution: 21,
        examContribution: 49,
        finalScore: 70,
        gradeLabel: 'S',
        gradeRemark: 'Silver',
      })
      expect(byPupil.get(primary.earlyPupilIds[2]!)).toMatchObject({
        sbaContribution: 15,
        examContribution: 35,
        finalScore: 50,
        gradeLabel: 'B',
        gradeRemark: 'Bronze',
      })
      expect(byPupil.get(primary.earlyPupilIds[3]!)).toMatchObject({
        sbaContribution: 20,
        examContribution: 35,
        finalScore: 55,
        gradeLabel: 'S',
        gradeRemark: 'Silver',
      })

      // Missing scores are never classified as Bronze.
      const mathView = await initializeTerm(
        primary.termId,
        primary.earlyClassId,
        primary.mathId,
      )
      const mathComponentIds: Record<string, string> = {}
      for (const component of mathView.policy!.components) {
        mathComponentIds[component.key] = component.id
      }

      const missing = await earlyTeacher
        .put(`/api/schools/${primary.schoolId}/assessments/score-entry`)
        .set('Origin', TEST_ORIGIN)
        .send({
          academicTermId: primary.termId,
          classId: primary.earlyClassId,
          subjectId: primary.mathId,
          expectedVersion: 0,
          pupils: [
            {
              pupilId: primary.earlyPupilIds[0]!,
              scores: [
                {
                  componentId: mathComponentIds['individual-test'],
                  score: '12',
                },
                { componentId: mathComponentIds['group-work'], score: '12' },
                { componentId: mathComponentIds['class-test'], score: '12' },
                { componentId: mathComponentIds.project, score: '12' },
                { componentId: mathComponentIds.examination, score: null },
              ],
            },
          ],
        })
      expect(missing.status).toBe(200)
      const missingPupil = data<{ scoreEntry: ScoreEntryResponse }>(
        missing,
      ).scoreEntry.pupils.find(
        (pupil) => pupil.pupilId === primary.earlyPupilIds[0],
      )
      expect(missingPupil?.finalScore).toBeNull()
      expect(missingPupil?.gradeLabel).toBeNull()
      expect(missingPupil?.gradeRemark).toBeNull()
    }, 30_000)

    it('keeps missing scores distinct from zero and rejects invalid scores', async () => {
      const entry = await classTeacher
        .get(`/api/schools/${primary.schoolId}/assessments/score-entry`)
        .query({
          academicTermId: primary.termId,
          classId: primary.classId,
          subjectId: primary.mathId,
        })
      expect(entry.status).toBe(200)
      const componentIds: Record<string, string> = {}
      for (const component of data<{ scoreEntry: ScoreEntryResponse }>(entry)
        .scoreEntry.policy!.components) {
        componentIds[component.key] = component.id
      }

      const missingExam = await classTeacher
        .put(`/api/schools/${primary.schoolId}/assessments/score-entry`)
        .set('Origin', TEST_ORIGIN)
        .send({
          academicTermId: primary.termId,
          classId: primary.classId,
          subjectId: primary.mathId,
          expectedVersion: 0,
          pupils: [
            {
              pupilId: primary.pupilIds[0]!,
              scores: [
                { componentId: componentIds['individual-test'], score: '12' },
                { componentId: componentIds['group-work'], score: '14' },
                { componentId: componentIds['class-test'], score: '13' },
                { componentId: componentIds.project, score: '15' },
                { componentId: componentIds.examination, score: null },
              ],
            },
            {
              pupilId: primary.pupilIds[1]!,
              scores: standardScores(
                componentIds,
                ['0', '0', '0', '0'],
                '0',
              ),
            },
          ],
        })
      expect(missingExam.status).toBe(200)
      const missingView = data<{ scoreEntry: ScoreEntryResponse }>(
        missingExam,
      ).scoreEntry
      const missingPupil = missingView.pupils.find(
        (pupil) => pupil.pupilId === primary.pupilIds[0],
      )
      const zeroPupil = missingView.pupils.find(
        (pupil) => pupil.pupilId === primary.pupilIds[1],
      )

      expect(missingPupil?.finalScore).toBeNull()
      expect(missingPupil?.missingComponentIds).toEqual([
        componentIds.examination,
      ])
      expect(zeroPupil?.finalScore).toBe(0)
      expect(zeroPupil?.missingComponentIds).toEqual([])
      expect(missingView.readiness.canSubmit).toBe(false)

      const incompleteSubmit = await classTeacher
        .post(
          `/api/schools/${primary.schoolId}/assessments/score-entry/submit`,
        )
        .set('Origin', TEST_ORIGIN)
        .send({
          academicTermId: primary.termId,
          classId: primary.classId,
          subjectId: primary.mathId,
          expectedVersion: missingView.submission!.version,
          pupils: [
            {
              pupilId: primary.pupilIds[0]!,
              scores: [
                { componentId: componentIds['individual-test'], score: '12' },
                { componentId: componentIds['group-work'], score: '14' },
                { componentId: componentIds['class-test'], score: '13' },
                { componentId: componentIds.project, score: '15' },
              ],
            },
            {
              pupilId: primary.pupilIds[1]!,
              scores: standardScores(
                componentIds,
                ['0', '0', '0', '0'],
                '0',
              ),
            },
          ],
        })
      expect(incompleteSubmit.status).toBe(400)
      expect(incompleteSubmit.body.error.message).toContain(
        'every pupil has every required score',
      )

      const overMaximum = await classTeacher
        .put(`/api/schools/${primary.schoolId}/assessments/score-entry`)
        .set('Origin', TEST_ORIGIN)
        .send({
          academicTermId: primary.termId,
          classId: primary.classId,
          subjectId: primary.mathId,
          pupils: [
            {
              pupilId: primary.pupilIds[2]!,
              scores: standardScores(
                componentIds,
                ['16', '10', '8', '7'],
                '50',
              ),
            },
          ],
        })
      expect(overMaximum.status).toBe(400)
      expect(overMaximum.body.error.message).toBe('Score validation failed')
      expect(
        overMaximum.body.error.details.some((issue: { message: string }) =>
          issue.message.includes('cannot exceed'),
        ),
      ).toBe(true)

      const negative = await classTeacher
        .put(`/api/schools/${primary.schoolId}/assessments/score-entry`)
        .set('Origin', TEST_ORIGIN)
        .send({
          academicTermId: primary.termId,
          classId: primary.classId,
          subjectId: primary.mathId,
          pupils: [
            {
              pupilId: primary.pupilIds[2]!,
              scores: standardScores(
                componentIds,
                ['-1', '10', '8', '7'],
                '50',
              ),
            },
          ],
        })
      expect(negative.status).toBe(400)

      // Invalid input is rejected, not clamped, and nothing is persisted for
      // the pupil who was only submitted in the invalid attempts.
      expect(
        await prisma.pupilSubjectScore.count({
          where: {
            schoolId: primary.schoolId,
            academicTermId: primary.termId,
            pupilId: primary.pupilIds[2]!,
            subjectId: primary.mathId,
          },
        }),
      ).toBe(0)
    }, 30_000)

    it('preserves accepted standard results after a custom policy is added', async () => {
      const submitted = await classTeacher
        .post(
          `/api/schools/${primary.schoolId}/assessments/score-entry/submit`,
        )
        .set('Origin', TEST_ORIGIN)
        .send({
          academicTermId: primary.termId,
          classId: primary.classId,
          subjectId: primary.englishId,
          expectedVersion: 1,
          pupils: [
            {
              pupilId: primary.pupilIds[0]!,
              scores: standardScores(
                primary.componentIds,
                ['15', '15', '15', '15'],
                '100',
              ),
            },
            {
              pupilId: primary.pupilIds[1]!,
              scores: standardScores(
                primary.componentIds,
                ['12', '10', '8', '15'],
                '75',
              ),
            },
            {
              pupilId: primary.pupilIds[2]!,
              scores: standardScores(
                primary.componentIds,
                ['8', '7', '8', '7'],
                '50',
              ),
            },
          ],
        })
      expect(submitted.status).toBe(200)
      const submittedData = data<{
        submission: { id: string; status: string; version: number }
      }>(submitted).submission
      expect(submittedData.status).toBe('SUBMITTED')

      const accepted = await admin
        .post(
          `/api/schools/${primary.schoolId}/assessments/submissions/${submittedData.id}/review`,
        )
        .set('Origin', TEST_ORIGIN)
        .send({
          decision: 'ACCEPTED',
          comment: 'Standard results accepted.',
          expectedVersion: submittedData.version,
        })
      expect(accepted.status).toBe(200)
      expect(
        data<{ submission: { status: string } }>(accepted).submission.status,
      ).toBe('ACCEPTED')

      // Add a class-specific custom policy directly in storage. It must not
      // deactivate the term-wide standard policy or recalculate accepted
      // results.
      const custom = await prisma.assessmentPolicy.create({
        data: {
          schoolId: primary.schoolId,
          academicYearId: primary.yearId,
          academicTermId: primary.termId,
          classId: primary.classId,
          gradingSchemeId: primary.schemeId,
          name: 'Basic 1 custom 40/60 policy',
          scopeKey: `class:${primary.classId}`,
          version: 1,
          isActive: true,
          isDefault: false,
          calculationMode: 'COMPONENT_WEIGHTED',
          components: {
            create: customComponents().map((component) => ({
              schoolId: primary.schoolId,
              ...component,
            })),
          },
        },
      })
      expect(custom.isActive).toBe(true)

      const policies = await listPolicies(
        primary.schoolId,
        primary.yearId,
        primary.termId,
      )
      expect(
        policies.some(
          (policy) => policy.id === primary.standardPolicyId && policy.isActive,
        ),
      ).toBe(true)

      const entry = await classTeacher
        .get(`/api/schools/${primary.schoolId}/assessments/score-entry`)
        .query({
          academicTermId: primary.termId,
          classId: primary.classId,
          subjectId: primary.englishId,
        })
      expect(entry.status).toBe(200)
      const view = data<{ scoreEntry: ScoreEntryResponse }>(entry).scoreEntry
      expect(view.submission?.status).toBe('ACCEPTED')
      // The accepted submission keeps the standard policy it was calculated
      // with, even though a class-specific custom policy now exists.
      expect(view.policy?.id).toBe(primary.standardPolicyId)
      expect(view.policy?.calculationMode).toBe('GROUPED_SBA')

      const acceptedPupil = view.pupils.find(
        (pupil) => pupil.pupilId === primary.pupilIds[1],
      )
      expect(acceptedPupil?.sbaContribution).toBe(22.5)
      expect(acceptedPupil?.examContribution).toBe(52.5)
      expect(acceptedPupil?.finalScore).toBe(75)
      expect(acceptedPupil?.gradeLabel).toBe('B2')

      const stored = await prisma.pupilSubjectScore.findUnique({
        where: {
          schoolId_academicTermId_pupilId_subjectId: {
            schoolId: primary.schoolId,
            academicTermId: primary.termId,
            pupilId: primary.pupilIds[1]!,
            subjectId: primary.englishId,
          },
        },
      })
      expect(stored?.policyId).toBe(primary.standardPolicyId)
      expect(Number(stored?.finalScore)).toBe(75)
      expect(stored?.gradeLabel).toBe('B2')
      expect(
        (stored?.policySnapshot as { calculationMode?: string } | null)
          ?.calculationMode,
      ).toBe('GROUPED_SBA')
    }, 60_000)

    it('does not replace a custom policy configured before initialization', async () => {
      const termId = await termBySequence(3)

      const custom = await prisma.assessmentPolicy.create({
        data: {
          schoolId: primary.schoolId,
          academicYearId: primary.yearId,
          academicTermId: termId,
          gradingSchemeId: primary.schemeId,
          name: 'Term 3 custom 40/60 policy',
          scopeKey: 'term',
          version: 1,
          isActive: true,
          isDefault: false,
          calculationMode: 'COMPONENT_WEIGHTED',
          components: {
            create: customComponents().map((component) => ({
              schoolId: primary.schoolId,
              ...component,
            })),
          },
        },
      })
      expect(custom.isActive).toBe(true)

      // Triggering lazy initialization must observe the custom policy and add
      // nothing alongside it.
      await initializeTerm(termId)

      const policies = await listPolicies(
        primary.schoolId,
        primary.yearId,
        termId,
      )
      const active = policies.filter((policy) => policy.isActive)

      expect(active).toHaveLength(1)
      expect(active[0]?.name).toBe('Term 3 custom 40/60 policy')
      expect(active[0]?.isDefault).toBe(false)
      expect(active[0]?.calculationMode).toBe('COMPONENT_WEIGHTED')

      // No standard policy was added alongside the custom one.
      expect(
        await prisma.assessmentPolicy.count({
          where: {
            schoolId: primary.schoolId,
            academicTermId: termId,
            isDefault: true,
          },
        }),
      ).toBe(0)

      // The standard policy for Term 1 remains active and untouched.
      expect(
        await prisma.assessmentPolicy.count({
          where: {
            id: primary.standardPolicyId,
            isActive: true,
            isDefault: true,
            calculationMode: 'GROUPED_SBA',
          },
        }),
      ).toBe(1)
    }, 30_000)
  },
)
