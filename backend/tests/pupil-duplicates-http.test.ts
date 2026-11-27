import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import {
  academicStartYearFor,
  buildAcademicYearPlan,
  todayInCalendar,
} from '../src/calendar/logic.js'
import {
  registrationBody,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from './helpers/auth-fixtures.js'
import { FakeAuthRepository } from './helpers/fake-auth-repository.js'
import { FakeSchoolRepository } from './helpers/fake-school-repository.js'

interface TestContext {
  app: ReturnType<typeof createApp>
  auth: FakeAuthRepository
  schools: FakeSchoolRepository
  admin: ReturnType<typeof request.agent>
  schoolId: string
  adminUserId: string
}

let currentAuth: FakeAuthRepository

async function registerSchool(
  auth: FakeAuthRepository,
  schools: FakeSchoolRepository,
  app: ReturnType<typeof createApp>,
  overrides: { schoolName: string; email: string },
): Promise<TestContext> {
  const admin = request.agent(app)

  const response = await admin
    .post('/api/auth/register-school')
    .set('Origin', TEST_ORIGIN)
    .send(
      registrationBody({
        schoolName: overrides.schoolName,
        email: overrides.email,
      }),
    )

  expect(response.status).toBe(201)

  const schoolId = response.body.data.school.id as string
  const adminUserId = response.body.data.user.id as string

  schools.seedSchool({
    id: schoolId,
    name: overrides.schoolName,
    slug: response.body.data.school.slug,
    email: overrides.email,
  })
  schools.seedDefaults(schoolId, adminUserId)

  return { app, auth, schools, admin, schoolId, adminUserId }
}

async function login(
  app: ReturnType<typeof createApp>,
  email: string,
  password = TEST_PASSWORD,
) {
  if (password === TEST_PASSWORD) {
    await currentAuth.setPasswordForTesting(email, password)
  }

  const agent = request.agent(app)
  const response = await agent
    .post('/api/auth/login')
    .set('Origin', TEST_ORIGIN)
    .send({ email, password })

  return { agent, response }
}

describe('pupil duplicate HTTP flow', () => {
  let auth: FakeAuthRepository
  let schools: FakeSchoolRepository
  let app: ReturnType<typeof createApp>
  let ctx: TestContext

  beforeEach(async () => {
    auth = new FakeAuthRepository()
    currentAuth = auth
    schools = new FakeSchoolRepository(auth)
    app = createApp({ authRepository: auth, schoolRepository: schools })
    ctx = await registerSchool(auth, schools, app, {
      schoolName: 'Green Valley Academy',
      email: 'admin@greenvalley.test',
    })
  })

  async function registerClassTeacher(
    className: string,
    email: string,
  ): Promise<{
    agent: ReturnType<typeof request.agent>
    membershipId: string
    classId: string
  }> {
    const response = await ctx.admin
      .post(`/api/schools/${ctx.schoolId}/teachers`)
      .set('Origin', TEST_ORIGIN)
      .send({
        firstName: 'Class',
        lastName: 'Teacher',
        email,
        role: 'CLASS_TEACHER',
        className,
      })

    expect(response.status).toBe(201)
    const { agent, response: loginResponse } = await login(app, email)
    expect(loginResponse.status).toBe(200)

    return {
      agent,
      membershipId: response.body.data.teacher.membershipId as string,
      classId: schools.classByName(ctx.schoolId, className).id,
    }
  }

  async function createCurrentYear(): Promise<{
    id: string
    startsOn: string
  }> {
    const plan = buildAcademicYearPlan(
      academicStartYearFor(todayInCalendar()),
    )
    const year = await schools.createAcademicYear(
      ctx.schoolId,
      {
        name: plan.name,
        startsOn: plan.startsOn,
        endsOn: plan.endsOn,
        isCurrent: true,
      },
      { actorUserId: ctx.adminUserId },
    )

    return { id: year.id, startsOn: plan.startsOn }
  }

  async function setupTeacher(className = 'Basic 2') {
    const teacher = await registerClassTeacher(
      className,
      `duplicate-${className.replace(/\s+/g, '-').toLowerCase()}@greenvalley.test`,
    )
    const year = await createCurrentYear()

    async function postPupil(body: Record<string, unknown>) {
      return teacher.agent
        .post(`/api/schools/${ctx.schoolId}/pupils`)
        .set('Origin', TEST_ORIGIN)
        .send({
          lastName: 'Mensah',
          classId: teacher.classId,
          academicYearId: year.id,
          startedOn: year.startsOn,
          ...body,
        })
    }

    return { teacher, year, postPupil }
  }

  it('blocks exact duplicates, reused admissions and same-name registrations', async () => {
    const { postPupil } = await setupTeacher()

    const first = await postPupil({
      firstName: 'Ama',
      admissionNumber: 'DUP-001',
    })
    expect(first.status).toBe(201)

    const sameName = await postPupil({
      firstName: '  ama ',
      admissionNumber: 'DUP-002',
    })
    expect(sameName.status).toBe(409)
    expect(sameName.body.error.code).toBe('PUPIL_DUPLICATE_NAME')
    expect(sameName.body.error.meta).toMatchObject({
      category: 'NAME_CONFLICT',
      requiresConfirmation: true,
      existingPupil: {
        admissionNumber: 'DUP-001',
        currentClassName: 'Basic 2',
        status: 'ACTIVE',
      },
    })

    const exact = await postPupil({
      firstName: 'Ama',
      admissionNumber: 'dup-001',
    })
    expect(exact.status).toBe(409)
    expect(exact.body.error.code).toBe('PUPIL_DUPLICATE_EXACT')

    const admission = await postPupil({
      firstName: 'Kofi',
      admissionNumber: 'DUP-001',
    })
    expect(admission.status).toBe(409)
    expect(admission.body.error.code).toBe('PUPIL_DUPLICATE_ADMISSION')
  })

  it('continues after the caller confirms a different pupil and remembers it', async () => {
    const { teacher, postPupil } = await setupTeacher()

    const first = await postPupil({
      firstName: 'Ama',
      admissionNumber: 'DUP-001',
    })
    expect(first.status).toBe(201)

    const confirmed = await postPupil({
      firstName: 'Ama',
      admissionNumber: 'DUP-002',
      confirmDifferentPupil: true,
      duplicateOfPupilId: first.body.data.pupil.id,
    })
    expect(confirmed.status).toBe(201)

    // A later edit that keeps the same name and admission must not ask again:
    // the different-pupil decision was persisted in the audit trail.
    const update = await teacher.agent
      .patch(
        `/api/schools/${ctx.schoolId}/pupils/${confirmed.body.data.pupil.id}`,
      )
      .set('Origin', TEST_ORIGIN)
      .send({ firstName: 'AMA' })

    expect(update.status).toBe(200)
    expect(update.body.data.pupil.firstName).toBe('AMA')
  })

  it('asks for confirmation when an edit creates a same-name conflict', async () => {
    const { teacher, postPupil } = await setupTeacher()

    const first = await postPupil({
      firstName: 'Ama',
      admissionNumber: 'EDIT-001',
    })
    const second = await postPupil({
      firstName: 'Kofi',
      admissionNumber: 'EDIT-002',
    })
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)

    const conflict = await teacher.agent
      .patch(
        `/api/schools/${ctx.schoolId}/pupils/${second.body.data.pupil.id}`,
      )
      .set('Origin', TEST_ORIGIN)
      .send({ firstName: 'Ama' })

    expect(conflict.status).toBe(409)
    expect(conflict.body.error.code).toBe('PUPIL_DUPLICATE_NAME')
    expect(conflict.body.error.meta.existingPupil.id).toBe(
      first.body.data.pupil.id,
    )

    const confirmed = await teacher.agent
      .patch(
        `/api/schools/${ctx.schoolId}/pupils/${second.body.data.pupil.id}`,
      )
      .set('Origin', TEST_ORIGIN)
      .send({
        firstName: 'Ama',
        confirmDifferentPupil: true,
        duplicateOfPupilId: first.body.data.pupil.id,
      })

    expect(confirmed.status).toBe(200)
    expect(confirmed.body.data.pupil.firstName).toBe('Ama')
  })

  it('keeps duplicate management away from class teachers', async () => {
    const { teacher, postPupil } = await setupTeacher()

    const first = await postPupil({
      firstName: 'Ama',
      admissionNumber: 'AUTH-001',
    })
    await postPupil({
      firstName: 'Ama',
      admissionNumber: 'AUTH-002',
      confirmDifferentPupil: true,
      duplicateOfPupilId: first.body.data.pupil.id,
    })

    const list = await teacher.agent.get(
      `/api/schools/${ctx.schoolId}/pupil-duplicates`,
    )
    expect(list.status).toBe(403)

    const decision = await teacher.agent
      .post(`/api/schools/${ctx.schoolId}/pupil-duplicates/decisions`)
      .set('Origin', TEST_ORIGIN)
      .send({
        primaryPupilId: '11111111-1111-4111-8111-111111111111',
        duplicatePupilId: '22222222-2222-4222-8222-222222222222',
        decision: 'DIFFERENT',
      })
    expect(decision.status).toBe(403)
  })

  it('lets an administrator audit, compare and merge duplicate records', async () => {
    const { postPupil } = await setupTeacher()

    const first = await postPupil({
      firstName: 'Ama',
      admissionNumber: 'MERGE-001',
    })
    const second = await postPupil({
      firstName: 'Ama',
      admissionNumber: 'MERGE-002',
      confirmDifferentPupil: true,
      duplicateOfPupilId: first.body.data.pupil.id,
    })
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)

    const audit = await ctx.admin.get(
      `/api/schools/${ctx.schoolId}/pupil-duplicates`,
    )
    expect(audit.status).toBe(200)
    expect(audit.body.data.groups).toHaveLength(1)
    expect(audit.body.data.groups[0].category).toBe('NAME_CONFLICT')
    expect(audit.body.data.summary.possibleGroups).toBe(1)

    const preview = await ctx.admin
      .post(`/api/schools/${ctx.schoolId}/pupil-duplicates/merge-preview`)
      .set('Origin', TEST_ORIGIN)
      .send({
        primaryPupilId: first.body.data.pupil.id,
        duplicatePupilId: second.body.data.pupil.id,
      })

    expect(preview.status).toBe(200)
    expect(preview.body.data.preview.canMerge).toBe(true)
    expect(preview.body.data.preview.primaryPupil.id).toBe(
      first.body.data.pupil.id,
    )

    const merge = await ctx.admin
      .post(`/api/schools/${ctx.schoolId}/pupil-duplicates/merge`)
      .set('Origin', TEST_ORIGIN)
      .send({
        primaryPupilId: first.body.data.pupil.id,
        duplicatePupilId: second.body.data.pupil.id,
        confirm: true,
        note: 'Confirmed the same pupil.',
      })

    expect(merge.status).toBe(200)
    expect(merge.body.data.archivedPupilId).toBe(
      second.body.data.pupil.id,
    )
    expect(merge.body.data.primaryPupil.id).toBe(first.body.data.pupil.id)

    const archived = await ctx.admin.get(
      `/api/schools/${ctx.schoolId}/pupils/${second.body.data.pupil.id}`,
    )
    expect(archived.status).toBe(200)
    expect(archived.body.data.pupil.status).toBe('ARCHIVED')

    const after = await ctx.admin.get(
      `/api/schools/${ctx.schoolId}/pupil-duplicates`,
    )
    expect(after.body.data.groups[0].resolved).toBe(true)

    expect(
      schools.audits.some(
        (entry) =>
          entry.schoolId === ctx.schoolId && entry.action === 'PUPIL_MERGED',
      ),
    ).toBe(true)
  })

  it('includes archived pupils and records a different-pupil decision', async () => {
    const { teacher, postPupil } = await setupTeacher()

    const first = await postPupil({
      firstName: 'Ama',
      admissionNumber: 'ARCH-001',
    })
    const second = await postPupil({
      firstName: 'Ama',
      admissionNumber: 'ARCH-002',
      confirmDifferentPupil: true,
      duplicateOfPupilId: first.body.data.pupil.id,
    })

    const archived = await teacher.agent
      .post(
        `/api/schools/${ctx.schoolId}/pupils/${second.body.data.pupil.id}/archive`,
      )
      .set('Origin', TEST_ORIGIN)
      .send({})
    expect(archived.status).toBe(200)

    const audit = await ctx.admin.get(
      `/api/schools/${ctx.schoolId}/pupil-duplicates`,
    )
    expect(audit.status).toBe(200)
    expect(audit.body.data.groups).toHaveLength(1)
    expect(
      audit.body.data.groups[0].pupils.map(
        (pupil: { status: string }) => pupil.status,
      ),
    ).toEqual(['ACTIVE', 'ARCHIVED'])

    const decision = await ctx.admin
      .post(`/api/schools/${ctx.schoolId}/pupil-duplicates/decisions`)
      .set('Origin', TEST_ORIGIN)
      .send({
        primaryPupilId: first.body.data.pupil.id,
        duplicatePupilId: second.body.data.pupil.id,
        decision: 'DIFFERENT',
        note: 'Different pupils with the same name.',
      })

    expect(decision.status).toBe(201)

    const after = await ctx.admin.get(
      `/api/schools/${ctx.schoolId}/pupil-duplicates`,
    )
    expect(after.body.data.groups[0].resolved).toBe(true)
    expect(after.body.data.summary.resolvedGroups).toBe(1)
  })

  it('never exposes another school to an administrator or teacher', async () => {
    const other = await registerSchool(auth, schools, app, {
      schoolName: 'Bright World',
      email: 'admin@brightworld.test',
    })

    const { postPupil } = await setupTeacher()
    const first = await postPupil({
      firstName: 'Ama',
      admissionNumber: 'SCOPE-001',
    })
    await postPupil({
      firstName: 'Ama',
      admissionNumber: 'SCOPE-002',
      confirmDifferentPupil: true,
      duplicateOfPupilId: first.body.data.pupil.id,
    })

    const own = await ctx.admin.get(
      `/api/schools/${ctx.schoolId}/pupil-duplicates`,
    )
    expect(own.body.data.groups).toHaveLength(1)

    const otherAudit = await other.admin.get(
      `/api/schools/${other.schoolId}/pupil-duplicates`,
    )
    expect(otherAudit.status).toBe(200)
    expect(otherAudit.body.data.groups).toHaveLength(0)

    const crossSchool = await ctx.admin.get(
      `/api/schools/${other.schoolId}/pupil-duplicates`,
    )
    expect(crossSchool.status).toBe(403)
  })
})
