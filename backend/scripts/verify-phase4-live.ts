/**
 * Live Phase 4 verification against the configured development database.
 *
 * Safety:
 * - Refuses to run unless NODE_ENV=development and DATABASE_URL points at the
 *   expected local wise_grade database.
 * - Creates disposable schools/users/records only.
 * - Deletes only the schools and users it created (database cascade handles
 *   their classes, pupils, policies, submissions, scores and audit rows).
 *
 * Run with: npx tsx scripts/verify-phase4-live.ts
 */
import assert from 'node:assert/strict'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { getPrismaClient } from '../src/lib/prisma.js'
import { hashPassword } from '../src/auth/password.js'
import {
  EXAMPLE_GRADE_BANDS,
  EXAMPLE_POLICY_COMPONENTS,
} from '../src/assessment/defaults.js'

const ORIGIN = 'http://localhost:5173'
const PASSWORD = 'verification-password-123'
const suffix = `p4v-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 7)}`

const adminAEmail = `${suffix}.admin-a@gradely.test`
const adminBEmail = `${suffix}.admin-b@gradely.test`
const classTeacherEmail = `${suffix}.ct@gradely.test`
const subjectTeacherEmail = `${suffix}.st@gradely.test`
const platformEmail = `${suffix}.platform@gradely.test`

const createdSchoolIds: string[] = []
const createdUserIds: string[] = []
let failures = 0

function checkTarget(): void {
  const raw = env.DATABASE_URL ?? ''
  const url = new URL(raw)

  assert.equal(env.NODE_ENV, 'development', 'NODE_ENV must be development')
  assert.equal(url.hostname, 'localhost', 'Database host must be localhost')
  assert.equal(url.port, '5432', 'Database port must be 5432')
  assert.equal(
    url.pathname.replace(/^\//, ''),
    'wise_grade',
    'Database must be the intended development database',
  )
}

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS  ${name}`)
  } catch (error) {
    failures += 1
    console.error(`FAIL  ${name}`)
    console.error(error)
  }
}

function expectStatus(
  response: { status: number; body: unknown },
  status: number,
  label: string,
): void {
  assert.equal(
    response.status,
    status,
    `${label}: expected ${status}, received ${response.status} (${JSON.stringify(response.body)})`,
  )
}

type Agent = ReturnType<typeof request.agent>

function body<T>(response: { body: { data?: T } }): T {
  assert.ok(response.body.data, 'Response has no data')
  return response.body.data as T
}

async function main(): Promise<void> {
  checkTarget()

  const prisma = getPrismaClient()
  const app = createApp()

  const connectivity = await prisma.$queryRaw<
    { currentDatabase: string; serverVersion: string }[]
  >`SELECT current_database() AS "currentDatabase", version() AS "serverVersion"`

  assert.equal(connectivity[0]?.currentDatabase, 'wise_grade')
  console.log(
    `PASS  PostgreSQL connectivity (database=${connectivity[0]?.currentDatabase})`,
  )

  try {
    // ------------------------------------------------------------------
    // Fixture creation
    // ------------------------------------------------------------------
    let adminA: Agent
    let adminB: Agent
    let schoolAId = ''
    let schoolBId = ''
    let yearId = ''
    let termId = ''
    let classId = ''
    let englishId = ''
    let mathId = ''
    let classTeacherMembershipId = ''
    const pupilIds: string[] = []
    let schemeId = ''

    await step('register school A and create academic/class/pupil fixtures', async () => {
      adminA = request.agent(app)
      const registration = await adminA
        .post('/api/auth/register-school')
        .set('Origin', ORIGIN)
        .send({
          schoolName: `Gradely Phase 4 ${suffix}`,
          firstName: 'Phase',
          lastName: 'Four',
          email: adminAEmail,
          password: PASSWORD,
        })
      expectStatus(registration, 201, 'register school A')
      const registrationData = body<{
        school: { id: string }
        user: { id: string }
      }>(registration)
      schoolAId = registrationData.school.id
      createdSchoolIds.push(schoolAId)
      createdUserIds.push(registrationData.user.id)

      const year = await adminA
        .post(`/api/schools/${schoolAId}/academic-years`)
        .set('Origin', ORIGIN)
        .send({
          name: '2026/2027',
          startsOn: '2026-09-01',
          endsOn: '2027-07-31',
        })
      expectStatus(year, 201, 'create academic year')
      yearId = body<{ academicYear: { id: string } }>(year).academicYear.id

      const term = await adminA
        .post(`/api/schools/${schoolAId}/academic-years/${yearId}/terms`)
        .set('Origin', ORIGIN)
        .send({
          name: 'Term 1',
          sequence: 1,
          startsOn: '2026-09-01',
          endsOn: '2026-12-15',
        })
      expectStatus(term, 201, 'create academic term')
      termId = body<{ term: { id: string } }>(term).term.id

      const classes = await adminA
        .post(`/api/schools/${schoolAId}/classes/seed-defaults`)
        .set('Origin', ORIGIN)
        .send({})
      expectStatus(classes, 200, 'seed classes')
      const classList = body<{ classes: Array<{ id: string; name: string }> }>(
        classes,
      ).classes
      const basicOne = classList.find((item) => item.name === 'Basic 1')
      assert.ok(basicOne, 'Basic 1 class must exist')
      classId = basicOne.id

      const subjects = await adminA
        .post(`/api/schools/${schoolAId}/subjects/seed-defaults`)
        .set('Origin', ORIGIN)
        .send({})
      expectStatus(subjects, 200, 'seed subjects')
      const subjectList = body<{ subjects: Array<{ id: string; name: string }> }>(
        subjects,
      ).subjects
      const english = subjectList.find((item) => item.name === 'English Language')
      const math = subjectList.find((item) => item.name === 'Mathematics')
      assert.ok(english && math, 'English and Mathematics must exist')
      englishId = english.id
      mathId = math.id

      for (const subjectId of [englishId, mathId]) {
        const assignment = await adminA
          .post(`/api/schools/${schoolAId}/classes/${classId}/subjects`)
          .set('Origin', ORIGIN)
          .send({ subjectId })
        expectStatus(assignment, 201, 'assign subject to class')
      }

      for (let index = 1; index <= 3; index += 1) {
        const pupil = await adminA
          .post(`/api/schools/${schoolAId}/pupils`)
          .set('Origin', ORIGIN)
          .send({
            firstName: `Pupil${index}`,
            lastName: 'Verification',
            admissionNumber: `${suffix}-ADM-${index}`,
            classId,
            academicYearId: yearId,
          })
        expectStatus(pupil, 201, `create pupil ${index}`)
        pupilIds.push(body<{ pupil: { id: string } }>(pupil).pupil.id)
      }
    })

    await step('create grading scheme and 40/60 assessment policy', async () => {
      const scheme = await adminA
        .post(`/api/schools/${schoolAId}/assessments/grading-schemes`)
        .set('Origin', ORIGIN)
        .send({
          academicYearId: yearId,
          academicTermId: termId,
          name: 'Editable example scale',
          description: 'Example only; schools may configure their own bands.',
          bands: EXAMPLE_GRADE_BANDS,
        })
      expectStatus(scheme, 201, 'create grading scheme')
      schemeId = body<{ gradingScheme: { id: string } }>(scheme).gradingScheme.id

      const policy = await adminA
        .post(`/api/schools/${schoolAId}/assessments/policies`)
        .set('Origin', ORIGIN)
        .send({
          academicYearId: yearId,
          academicTermId: termId,
          classId,
          gradingSchemeId: schemeId,
          name: 'Basic 1 40/60 policy',
          description: '40% SBA and 60% examination.',
          components: EXAMPLE_POLICY_COMPONENTS,
        })
      expectStatus(policy, 201, 'create assessment policy')

      const invalid = await adminA
        .post(`/api/schools/${schoolAId}/assessments/policies`)
        .set('Origin', ORIGIN)
        .send({
          academicYearId: yearId,
          academicTermId: termId,
          level: 'BASIC',
          gradingSchemeId: schemeId,
          name: 'Broken weights',
          components: [
            {
              key: 'sba',
              name: 'SBA',
              category: 'SBA',
              maximumScore: '100',
              weightPercent: '40',
            },
            {
              key: 'exam',
              name: 'Exam',
              category: 'EXAM',
              maximumScore: '100',
              weightPercent: '50',
            },
          ],
        })
      expectStatus(invalid, 400, 'reject invalid policy weights')
    })

    let subjectTeacherMembershipId = ''
    await step('create teachers and enforce class/subject teacher permissions', async () => {
      const classTeacher = await adminA
        .post(`/api/schools/${schoolAId}/teachers`)
        .set('Origin', ORIGIN)
        .send({
          firstName: 'Class',
          lastName: 'Teacher',
          email: classTeacherEmail,
          role: 'CLASS_TEACHER',
          initialPassword: PASSWORD,
        })
      expectStatus(classTeacher, 201, 'register class teacher')
      const ct = body<{ teacher: { membershipId: string; userId: string } }>(
        classTeacher,
      ).teacher
      classTeacherMembershipId = ct.membershipId
      createdUserIds.push(ct.userId)

      const subjectTeacher = await adminA
        .post(`/api/schools/${schoolAId}/teachers`)
        .set('Origin', ORIGIN)
        .send({
          firstName: 'Subject',
          lastName: 'Teacher',
          email: subjectTeacherEmail,
          role: 'SUBJECT_TEACHER',
          initialPassword: PASSWORD,
        })
      expectStatus(subjectTeacher, 201, 'register subject teacher')
      const st = body<{ teacher: { membershipId: string; userId: string } }>(
        subjectTeacher,
      ).teacher
      subjectTeacherMembershipId = st.membershipId
      createdUserIds.push(st.userId)

      const classAssignment = await adminA
        .post(`/api/schools/${schoolAId}/classes/${classId}/class-teacher`)
        .set('Origin', ORIGIN)
        .send({ membershipId: classTeacherMembershipId })
      expectStatus(classAssignment, 201, 'assign class teacher')

      const subjectAssignment = await adminA
        .post(
          `/api/schools/${schoolAId}/classes/${classId}/subjects/${mathId}/teacher`,
        )
        .set('Origin', ORIGIN)
        .send({ membershipId: subjectTeacherMembershipId })
      expectStatus(subjectAssignment, 201, 'assign subject teacher')

      const settings = await adminA
        .patch(`/api/schools/${schoolAId}/assessments/settings`)
        .set('Origin', ORIGIN)
        .send({ classTeacherEntryMode: 'EXPLICIT_ONLY' })
      expectStatus(settings, 200, 'set EXPLICIT_ONLY class-teacher mode')

      const permission = await adminA
        .post(
          `/api/schools/${schoolAId}/assessments/class-teacher-permissions`,
        )
        .set('Origin', ORIGIN)
        .send({
          classId,
          subjectId: englishId,
          membershipId: classTeacherMembershipId,
        })
      expectStatus(permission, 201, 'grant class teacher English permission')

      const ctAgent = request.agent(app)
      const login = await ctAgent
        .post('/api/auth/login')
        .set('Origin', ORIGIN)
        .send({ email: classTeacherEmail, password: PASSWORD })
      expectStatus(login, 200, 'class teacher login')

      const ctSubjects = await ctAgent.get(
        `/api/schools/${schoolAId}/assessments/class-subjects`,
      )
      expectStatus(ctSubjects, 200, 'class teacher class-subjects')
      const permitted = body<{
        classSubjects: Array<{ subjectId: string }>
      }>(ctSubjects).classSubjects
      assert.ok(
        permitted.some((item) => item.subjectId === englishId),
        'class teacher should see English',
      )
      assert.ok(
        !permitted.some((item) => item.subjectId === mathId),
        'class teacher must not see Mathematics without permission',
      )

      const denied = await ctAgent
        .get(`/api/schools/${schoolAId}/assessments/score-entry`)
        .query({ academicTermId: termId, classId, subjectId: mathId })
      expectStatus(denied, 403, 'class teacher denied unauthorized subject')

      const stAgent = request.agent(app)
      const stLogin = await stAgent
        .post('/api/auth/login')
        .set('Origin', ORIGIN)
        .send({ email: subjectTeacherEmail, password: PASSWORD })
      expectStatus(stLogin, 200, 'subject teacher login')

      const stAllowed = await stAgent
        .get(`/api/schools/${schoolAId}/assessments/score-entry`)
        .query({ academicTermId: termId, classId, subjectId: mathId })
      expectStatus(stAllowed, 200, 'subject teacher allowed assigned subject')

      const stDenied = await stAgent
        .get(`/api/schools/${schoolAId}/assessments/score-entry`)
        .query({ academicTermId: termId, classId, subjectId: englishId })
      expectStatus(stDenied, 403, 'subject teacher denied unassigned subject')
    })

    let componentIds: Record<string, string> = {}
    let draftVersion = 0

    await step('save draft distinguishes missing from zero and prevents duplicates', async () => {
      const ctAgent = request.agent(app)
      await ctAgent
        .post('/api/auth/login')
        .set('Origin', ORIGIN)
        .send({ email: classTeacherEmail, password: PASSWORD })

      const entry = await ctAgent
        .get(`/api/schools/${schoolAId}/assessments/score-entry`)
        .query({ academicTermId: termId, classId, subjectId: englishId })
      expectStatus(entry, 200, 'read score entry')
      const scoreEntry = body<{
        scoreEntry: {
          policy: {
            components: Array<{ id: string; key: string; name: string }>
          }
          pupils: Array<{ pupilId: string }>
        }
      }>(entry).scoreEntry
      componentIds = Object.fromEntries(
        scoreEntry.policy.components.map((component) => [
          component.key,
          component.id,
        ]),
      )

      const componentId = (key: string): string => {
        const id = componentIds[key]
        assert.ok(id, `component ${key} must exist`)
        return id
      }

      const pupilId = (index: number): string => {
        const id = pupilIds[index]
        assert.ok(id, `pupil ${index} must exist`)
        return id
      }

      const draft = await ctAgent
        .put(`/api/schools/${schoolAId}/assessments/score-entry`)
        .set('Origin', ORIGIN)
        .send({
          academicTermId: termId,
          classId,
          subjectId: englishId,
          expectedVersion: 0,
          pupils: [
            {
              pupilId: pupilId(0),
              scores: [
                { componentId: componentId('class-test'), score: '16' },
                { componentId: componentId('project'), score: '8' },
                { componentId: componentId('homework'), score: '9' },
                { componentId: componentId('examination'), score: null },
              ],
            },
            {
              pupilId: pupilId(1),
              scores: [
                { componentId: componentId('class-test'), score: '0' },
                { componentId: componentId('project'), score: '0' },
                { componentId: componentId('homework'), score: '0' },
                { componentId: componentId('examination'), score: '0' },
              ],
            },
          ],
        })
      expectStatus(draft, 200, 'save partial draft')

      const view = body<{
        scoreEntry: {
          submission: { id: string; version: number; status: string }
          pupils: Array<{
            pupilId: string
            finalScore: number | null
            missingComponentIds: string[]
          }>
        }
      }>(draft).scoreEntry
      draftVersion = view.submission.version
      assert.equal(view.submission.status, 'DRAFT')

      const first = view.pupils.find((pupil) => pupil.pupilId === pupilId(0))
      const second = view.pupils.find((pupil) => pupil.pupilId === pupilId(1))

      assert.equal(first?.finalScore, null, 'missing exam must yield null final')
      assert.deepEqual(first?.missingComponentIds, [componentId('examination')])
      assert.equal(second?.finalScore, 0, 'explicit zero must yield zero final')

      const duplicateCount = await prisma.assessmentScore.count({
        where: {
          schoolId: schoolAId,
          pupilId: pupilId(1),
          componentId: componentId('examination'),
        },
      })
      assert.equal(duplicateCount, 1, 'a component score must be unique')

      await ctAgent
        .put(`/api/schools/${schoolAId}/assessments/score-entry`)
        .set('Origin', ORIGIN)
        .send({
          academicTermId: termId,
          classId,
          subjectId: englishId,
          expectedVersion: draftVersion,
          pupils: [
            {
              pupilId: pupilId(1),
              scores: [
                { componentId: componentId('examination'), score: '1' },
              ],
            },
          ],
        })

      const duplicateAfter = await prisma.assessmentScore.count({
        where: {
          schoolId: schoolAId,
          pupilId: pupilId(1),
          componentId: componentId('examination'),
        },
      })
      assert.equal(duplicateAfter, 1, 'saving again must update, not duplicate')
    })

    await step('submit, lock, return, concurrent correction and accept', async () => {
      const ctAgent = request.agent(app)
      await ctAgent
        .post('/api/auth/login')
        .set('Origin', ORIGIN)
        .send({ email: classTeacherEmail, password: PASSWORD })

      const current = await ctAgent
        .get(`/api/schools/${schoolAId}/assessments/score-entry`)
        .query({ academicTermId: termId, classId, subjectId: englishId })
      expectStatus(current, 200, 'read current draft')
      const currentView = body<{
        scoreEntry: { submission: { version: number } }
      }>(current).scoreEntry
      const componentId = (key: string): string => {
        const id = componentIds[key]
        assert.ok(id)
        return id
      }
      const pupilId = (index: number): string => {
        const id = pupilIds[index]
        assert.ok(id)
        return id
      }

      const submit = await ctAgent
        .post(`/api/schools/${schoolAId}/assessments/score-entry/submit`)
        .set('Origin', ORIGIN)
        .send({
          academicTermId: termId,
          classId,
          subjectId: englishId,
          expectedVersion: currentView.submission.version,
          pupils: [
            {
              pupilId: pupilId(0),
              scores: [
                { componentId: componentId('class-test'), score: '16' },
                { componentId: componentId('project'), score: '8' },
                { componentId: componentId('homework'), score: '9' },
                { componentId: componentId('examination'), score: '70' },
              ],
            },
            {
              pupilId: pupilId(1),
              scores: [
                { componentId: componentId('class-test'), score: '0' },
                { componentId: componentId('project'), score: '0' },
                { componentId: componentId('homework'), score: '0' },
                { componentId: componentId('examination'), score: '0' },
              ],
            },
            {
              pupilId: pupilId(2),
              scores: [
                { componentId: componentId('class-test'), score: '10' },
                { componentId: componentId('project'), score: '5' },
                { componentId: componentId('homework'), score: '5' },
                { componentId: componentId('examination'), score: '50' },
              ],
            },
          ],
        })
      expectStatus(submit, 200, 'submit results')
      const submitted = body<{
        submission: { id: string; status: string; version: number }
      }>(submit).submission
      assert.equal(submitted.status, 'SUBMITTED')

      const lockedEdit = await ctAgent
        .put(`/api/schools/${schoolAId}/assessments/score-entry`)
        .set('Origin', ORIGIN)
        .send({
          academicTermId: termId,
          classId,
          subjectId: englishId,
          expectedVersion: submitted.version,
          pupils: [
            {
              pupilId: pupilId(0),
              scores: [
                { componentId: componentId('examination'), score: '99' },
              ],
            },
          ],
        })
      expectStatus(lockedEdit, 409, 'submitted results are locked')

      const returnResponse = await adminA
        .post(
          `/api/schools/${schoolAId}/assessments/submissions/${submitted.id}/review`,
        )
        .set('Origin', ORIGIN)
        .send({
          decision: 'RETURNED_FOR_CORRECTION',
          comment: 'Please recheck the examination entry.',
          expectedVersion: submitted.version,
        })
      expectStatus(returnResponse, 200, 'return for correction')
      const returned = body<{
        submission: { status: string; version: number }
      }>(returnResponse).submission
      assert.equal(returned.status, 'RETURNED_FOR_CORRECTION')

      const concurrent = await Promise.all([
        ctAgent
          .put(`/api/schools/${schoolAId}/assessments/score-entry`)
          .set('Origin', ORIGIN)
          .send({
            academicTermId: termId,
            classId,
            subjectId: englishId,
            expectedVersion: returned.version,
            pupils: [
              {
                pupilId: pupilId(0),
                scores: [
                  { componentId: componentId('examination'), score: '70' },
                ],
              },
            ],
          }),
        ctAgent
          .put(`/api/schools/${schoolAId}/assessments/score-entry`)
          .set('Origin', ORIGIN)
          .send({
            academicTermId: termId,
            classId,
            subjectId: englishId,
            expectedVersion: returned.version,
            pupils: [
              {
                pupilId: pupilId(0),
                scores: [
                  { componentId: componentId('examination'), score: '71' },
                ],
              },
            ],
          }),
      ])

      const statuses = concurrent.map((response) => response.status).sort()
      assert.deepEqual(
        statuses,
        [200, 409],
        'exactly one concurrent edit should win',
      )

      const afterConcurrent = await ctAgent
        .get(`/api/schools/${schoolAId}/assessments/score-entry`)
        .query({ academicTermId: termId, classId, subjectId: englishId })
      expectStatus(afterConcurrent, 200, 'read corrected sheet')
      const corrected = body<{
        scoreEntry: { submission: { version: number } }
      }>(afterConcurrent).scoreEntry

      const resubmit = await ctAgent
        .post(`/api/schools/${schoolAId}/assessments/score-entry/submit`)
        .set('Origin', ORIGIN)
        .send({
          academicTermId: termId,
          classId,
          subjectId: englishId,
          expectedVersion: corrected.submission.version,
          pupils: [
            {
              pupilId: pupilId(0),
              scores: [
                { componentId: componentId('class-test'), score: '16' },
                { componentId: componentId('project'), score: '8' },
                { componentId: componentId('homework'), score: '9' },
                { componentId: componentId('examination'), score: '70' },
              ],
            },
            {
              pupilId: pupilId(1),
              scores: [
                { componentId: componentId('class-test'), score: '0' },
                { componentId: componentId('project'), score: '0' },
                { componentId: componentId('homework'), score: '0' },
                { componentId: componentId('examination'), score: '0' },
              ],
            },
            {
              pupilId: pupilId(2),
              scores: [
                { componentId: componentId('class-test'), score: '10' },
                { componentId: componentId('project'), score: '5' },
                { componentId: componentId('homework'), score: '5' },
                { componentId: componentId('examination'), score: '50' },
              ],
            },
          ],
        })
      expectStatus(resubmit, 200, 'resubmit corrected results')
      const resubmitted = body<{
        submission: { status: string; version: number }
      }>(resubmit).submission
      assert.equal(resubmitted.status, 'SUBMITTED')

      const accept = await adminA
        .post(
          `/api/schools/${schoolAId}/assessments/submissions/${submitted.id}/review`,
        )
        .set('Origin', ORIGIN)
        .send({
          decision: 'ACCEPTED',
          comment: 'Accepted for school records.',
          expectedVersion: resubmitted.version,
        })
      expectStatus(accept, 200, 'accept results')
      assert.equal(
        body<{ submission: { status: string } }>(accept).submission.status,
        'ACCEPTED',
      )

      const adminEdit = await adminA
        .put(`/api/schools/${schoolAId}/assessments/score-entry`)
        .set('Origin', ORIGIN)
        .send({
          academicTermId: termId,
          classId,
          subjectId: englishId,
          pupils: [
            {
              pupilId: pupilId(0),
              scores: [
                { componentId: componentId('examination'), score: '99' },
              ],
            },
          ],
        })
      expectStatus(adminEdit, 409, 'accepted results are immutable even for admins')

      const history = await adminA.get(
        `/api/schools/${schoolAId}/assessments/submissions/${submitted.id}/history`,
      )
      expectStatus(history, 200, 'read submission history')
      const actions = body<{ history: Array<{ action: string }> }>(
        history,
      ).history.map((entry) => entry.action)
      for (const action of [
        'SCORE_DRAFT_SAVED',
        'RESULT_SUBMITTED',
        'RESULT_RETURNED_FOR_CORRECTION',
        'RESULT_ACCEPTED',
      ]) {
        assert.ok(actions.includes(action), `history must include ${action}`)
      }

      const reviews = await adminA.get(
        `/api/schools/${schoolAId}/assessments/submissions/${submitted.id}/reviews`,
      )
      expectStatus(reviews, 200, 'read reviews')
      assert.ok(
        body<{ reviews: unknown[] }>(reviews).reviews.length >= 2,
        'return and acceptance reviews must be stored',
      )
    })

    await step('historical grading stays consistent after scheme change', async () => {
      const update = await adminA
        .patch(`/api/schools/${schoolAId}/assessments/grading-schemes/${schemeId}`)
        .set('Origin', ORIGIN)
        .send({
          bands: [
            {
              minScore: '75',
              maxScore: '100',
              gradeLabel: 'A1',
              remark: 'Changed after acceptance',
            },
            {
              minScore: '0',
              maxScore: '74.99',
              gradeLabel: 'F9',
              remark: 'Changed after acceptance',
            },
          ],
        })
      expectStatus(update, 200, 'update grading scheme after acceptance')

      const entry = await adminA
        .get(`/api/schools/${schoolAId}/assessments/score-entry`)
        .query({ academicTermId: termId, classId, subjectId: englishId })
      expectStatus(entry, 200, 'read accepted score entry')
      const pupil = body<{
        scoreEntry: {
          pupils: Array<{ pupilId: string; finalScore: number | null; gradeLabel: string | null; gradeRemark: string | null }>
        }
      }>(entry).scoreEntry.pupils.find((item) => item.pupilId === pupilIds[0])

      assert.equal(pupil?.finalScore, 75)
      assert.equal(pupil?.gradeLabel, 'B2', 'accepted grade snapshot must not change')
      assert.equal(pupil?.gradeRemark, 'Very good')
    })

    await step('cross-school and platform administrator access are denied', async () => {
      adminB = request.agent(app)
      const registration = await adminB
        .post('/api/auth/register-school')
        .set('Origin', ORIGIN)
        .send({
          schoolName: `Other Phase 4 ${suffix}`,
          firstName: 'Other',
          lastName: 'Admin',
          email: adminBEmail,
          password: PASSWORD,
        })
      expectStatus(registration, 201, 'register school B')
      const registrationData = body<{
        school: { id: string }
        user: { id: string }
      }>(registration)
      schoolBId = registrationData.school.id
      createdSchoolIds.push(schoolBId)
      createdUserIds.push(registrationData.user.id)

      const crossSchool = await adminB.get(
        `/api/schools/${schoolAId}/assessments/policies`,
      )
      expectStatus(crossSchool, 403, 'cross-school policy read denied')

      const crossSchoolEntry = await adminB
        .get(`/api/schools/${schoolAId}/assessments/score-entry`)
        .query({ academicTermId: termId, classId, subjectId: englishId })
      expectStatus(crossSchoolEntry, 403, 'cross-school score read denied')

      const platform = await prisma.user.create({
        data: {
          email: platformEmail,
          passwordHash: await hashPassword(PASSWORD),
          firstName: 'Platform',
          lastName: 'Admin',
          isPlatformAdmin: true,
        },
      })
      createdUserIds.push(platform.id)

      const platformAgent = request.agent(app)
      const platformLogin = await platformAgent
        .post('/api/auth/login')
        .set('Origin', ORIGIN)
        .send({ email: platformEmail, password: PASSWORD })
      expectStatus(platformLogin, 200, 'platform admin login')

      const platformRead = await platformAgent.get(
        `/api/schools/${schoolAId}/assessments/score-entry`,
      )
      expectStatus(platformRead, 403, 'platform admin has no implicit pupil access')
    })

    await step('audit history records policy, grading and permission actions', async () => {
      const actions = await prisma.resultAuditHistory.findMany({
        where: { schoolId: schoolAId },
        select: { action: true },
      })
      const set = new Set(actions.map((entry) => entry.action))
      for (const action of [
        'GRADING_SCHEME_CREATED',
        'ASSESSMENT_POLICY_CREATED',
        'ASSESSMENT_SETTINGS_UPDATED',
        'CLASS_TEACHER_PERMISSION_GRANTED',
      ]) {
        assert.ok(set.has(action), `audit history must include ${action}`)
      }
    })
  } finally {
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
    await prisma.$disconnect()
  }

  if (failures > 0) {
    console.error(`\n${failures} Phase 4 verification step(s) failed.`)
    process.exitCode = 1
  } else {
    console.log('\nAll Phase 4 live verification steps passed.')
  }
}

await main()
