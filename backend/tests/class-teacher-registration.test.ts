import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import {
  registrationBody,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from './helpers/auth-fixtures.js'
import { FakeAuthRepository } from './helpers/fake-auth-repository.js'
import { FakeSchoolRepository } from './helpers/fake-school-repository.js'

/**
 * HTTP coverage for the corrected class-teacher workflow:
 * `POST /api/schools/:schoolId/classes/register`.
 *
 * The route, validation middleware and error handler are real. Only the
 * persistence layer is the in-memory repository used by every HTTP test, so
 * these tests exercise the same request parsing every deployed request uses.
 */

const TEACHER_PASSWORD = 'InitialPass123'

const SCHOOL_NAME = 'Green Valley Academy'
const ADMIN_EMAIL = 'admin@greenvalley.test'

interface TestContext {
  app: ReturnType<typeof createApp>
  auth: FakeAuthRepository
  schools: FakeSchoolRepository
  admin: ReturnType<typeof request.agent>
  schoolId: string
  adminUserId: string
}

function teacherPayload(overrides: Record<string, unknown> = {}) {
  return {
    firstName: 'Ama',
    lastName: 'Mensah',
    email: 'ama.mensah@greenvalley.test',
    phone: null,
    ...overrides,
  }
}

function registrationPayload(overrides: Record<string, unknown> = {}) {
  return {
    className: 'Basic 1',
    level: null,
    academicYearId: null,
    teacher: teacherPayload(),
    ...overrides,
  }
}

function fieldPaths(body: unknown): string[] {
  const details = (body as { error?: { details?: unknown } })?.error?.details

  return Array.isArray(details)
    ? details.map((detail) => String((detail as { field?: unknown }).field))
    : []
}

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
  schools.setSessionDates(schoolId, '2020-01-01', '2999-12-31')

  return { app, auth, schools, admin, schoolId, adminUserId }
}

async function login(
  app: ReturnType<typeof createApp>,
  email: string,
  password = TEST_PASSWORD,
) {
  const agent = request.agent(app)
  const response = await agent
    .post('/api/auth/login')
    .set('Origin', TEST_ORIGIN)
    .send({ email, password })

  return { agent, response }
}

describe('class-teacher registration', () => {
  let ctx: TestContext

  beforeEach(async () => {
    const auth = new FakeAuthRepository()
    const schools = new FakeSchoolRepository(auth)
    const app = createApp({ authRepository: auth, schoolRepository: schools })

    ctx = await registerSchool(auth, schools, app, {
      schoolName: SCHOOL_NAME,
      email: ADMIN_EMAIL,
    })
  })

  function register(
    body: unknown = registrationPayload(),
    agent: ReturnType<typeof request.agent> = ctx.admin,
  ) {
    return agent
      .post(`/api/schools/${ctx.schoolId}/classes/register`)
      .set('Origin', TEST_ORIGIN)
      .send(body as object)
  }

  it('registers the class and its class teacher in one request', async () => {
    const response = await register()

    expect(response.status).toBe(201)
    expect(response.body.data.class).toMatchObject({
      schoolId: ctx.schoolId,
      name: 'Basic 1',
    })
    expect(response.body.data.teacher).toMatchObject({
      schoolId: ctx.schoolId,
      email: 'ama.mensah@greenvalley.test',
      firstName: 'Ama',
      lastName: 'Mensah',
      role: 'CLASS_TEACHER',
      status: 'ACTIVE',
    })
    expect(response.body.data.assignment).toMatchObject({
      className: 'Basic 1',
      endedAt: null,
      membershipId: response.body.data.teacher.membershipId,
    })

    const assignments = await ctx.schools.listTeacherAssignments(ctx.schoolId)
    expect(assignments.classTeachers).toEqual([
      expect.objectContaining({
        className: 'Basic 1',
        email: 'ama.mensah@greenvalley.test',
        endedAt: null,
      }),
    ])
  })

  it('normalizes a padded email and a locally formatted mobile number', async () => {
    const response = await register(
      registrationPayload({
        teacher: teacherPayload({
          email: ' Ama.Mensah@GreenValley.test ',
          phone: '+233 (0)24 000 0000',
        }),
      }),
    )

    expect(response.status).toBe(201)
    expect(response.body.data.teacher).toMatchObject({
      email: 'ama.mensah@greenvalley.test',
      phone: '+233240000000',
    })

    // The same normalized values are what the teacher signs in with. The
    // server generated the onboarding password, so the suite gives the account
    // a known test password before checking the normalized login email.
    await ctx.auth.setPasswordForTesting(
      'ama.mensah@greenvalley.test',
      TEACHER_PASSWORD,
    )
    const { response: loginResponse } = await login(
      ctx.app,
      ' AMA.MENSAH@greenvalley.test ',
      TEACHER_PASSWORD,
    )
    expect(loginResponse.status).toBe(200)
  })

  it('returns field-level errors when required registration fields are missing', async () => {
    const response = await register({})

    expect(response.status).toBe(400)
    expect(response.body.error.message).toBe('Validation failed')
    expect(fieldPaths(response.body)).toEqual(
      expect.arrayContaining(['className', 'teacher']),
    )
  })

  it('names every missing teacher field without leaking a password', async () => {
    const response = await register({ className: 'Basic 1', teacher: {} })

    expect(response.status).toBe(400)
    expect(fieldPaths(response.body)).toEqual(
      expect.arrayContaining([
        'teacher.firstName',
        'teacher.lastName',
        'teacher.email',
      ]),
    )

    const body = JSON.stringify(response.body)
    expect(body).not.toMatch(/at\s+\w+\s+\(|node_modules|prisma|select\s/i)
    expect(body).not.toMatch(/password/i)
  })

  it('rejects an invalid academic year identifier before any lookup', async () => {
    const response = await register(
      registrationPayload({ academicYearId: 'not-a-uuid' }),
    )

    expect(response.status).toBe(400)
    expect(fieldPaths(response.body)).toEqual(['academicYearId'])
    expect(response.body.error.details[0].message).toMatch(/valid identifier/i)
  })

  it('refuses an academic year that belongs to another school', async () => {
    const other = await registerSchool(ctx.auth, ctx.schools, ctx.app, {
      schoolName: 'Riverside School',
      email: 'admin@riverside.test',
    })
    const otherYear = await ctx.schools.createAcademicYear(
      other.schoolId,
      {
        name: '2026/2027',
        startsOn: '2026-09-01',
        endsOn: '2027-07-31',
        isCurrent: true,
      },
      { actorUserId: other.adminUserId },
    )

    const response = await register(
      registrationPayload({ academicYearId: otherYear.id }),
    )

    expect(response.status).toBe(404)
    expect(response.body.error.message).toBe('Academic year not found')
  })

  it('requires an authenticated school administrator', async () => {
    const anonymous = await request(ctx.app)
      .post(`/api/schools/${ctx.schoolId}/classes/register`)
      .set('Origin', TEST_ORIGIN)
      .send(registrationPayload())

    expect(anonymous.status).toBe(401)

    // A class teacher cannot register another class teacher.
    await register()
    await ctx.auth.setPasswordForTesting(
      'ama.mensah@greenvalley.test',
      TEACHER_PASSWORD,
    )
    const { agent } = await login(
      ctx.app,
      'ama.mensah@greenvalley.test',
      TEACHER_PASSWORD,
    )
    const asTeacher = await register(registrationPayload({ className: 'Basic 2' }), agent)

    expect(asTeacher.status).toBe(403)

    // Neither can an administrator of a different school.
    const other = await registerSchool(ctx.auth, ctx.schools, ctx.app, {
      schoolName: 'Riverside School',
      email: 'admin@riverside.test',
    })
    const crossTenant = await ctx.admin
      .post(`/api/schools/${other.schoolId}/classes/register`)
      .set('Origin', TEST_ORIGIN)
      .send(registrationPayload())

    expect(crossTenant.status).toBe(403)
  })

  it('keeps one active class teacher per class', async () => {
    expect((await register()).status).toBe(201)

    const duplicate = await register(
      registrationPayload({
        teacher: teacherPayload({
          firstName: 'Kofi',
          lastName: 'Boateng',
          email: 'kofi.boateng@greenvalley.test',
        }),
      }),
    )

    expect(duplicate.status).toBe(409)
    expect(duplicate.body.error.message).toBe(
      'This class already has an active class teacher',
    )
  })

  it('reuses one class-teacher membership and ends the previous assignment', async () => {
    const first = await register()
    expect(first.status).toBe(201)

    const second = await register(registrationPayload({ className: 'Basic 2' }))

    expect(second.status).toBe(201)
    expect(second.body.data.teacher.membershipId).toBe(
      first.body.data.teacher.membershipId,
    )

    const assignments = await ctx.schools.listTeacherAssignments(ctx.schoolId)
    expect(assignments.classTeachers).toEqual([
      expect.objectContaining({ className: 'Basic 2', endedAt: null }),
    ])

    const basicOne = ctx.schools.classByName(ctx.schoolId, 'Basic 1')
    const reopened = await register(
      registrationPayload({ className: 'Basic 1' }),
    )
    expect(reopened.status).toBe(201)
    expect(reopened.body.data.assignment.className).toBe('Basic 1')
    expect(basicOne.id).toBe(reopened.body.data.class.id)
  })

  it('refuses to register an existing member with a different role', async () => {
    const user = await ctx.auth.createUser({
      email: 'existing-admin@greenvalley.test',
      password: TEST_PASSWORD,
    })
    await ctx.auth.addMembership(user.id, ctx.schoolId, 'SCHOOL_ADMIN')

    const response = await register(
      registrationPayload({
        teacher: teacherPayload({ email: 'existing-admin@greenvalley.test' }),
      }),
    )

    expect(response.status).toBe(409)
    expect(response.body.error.message).toBe(
      'This person already has a different role in this school',
    )
  })

  it('applies the same normalization to the single-teacher endpoint', async () => {
    const response = await ctx.admin
      .post(`/api/schools/${ctx.schoolId}/teachers`)
      .set('Origin', TEST_ORIGIN)
      .send({
        firstName: 'Yaa',
        lastName: 'Asante',
        email: ' Yaa.Asante@GreenValley.test ',
        phone: '+233 (0)20 000 0000',
        role: 'CLASS_TEACHER',
        className: 'Basic 3',
      })

    expect(response.status).toBe(201)
    expect(response.body.data.teacher).toMatchObject({
      email: 'yaa.asante@greenvalley.test',
      phone: '+233200000000',
      role: 'CLASS_TEACHER',
    })
  })

  it('only accepts class teachers on the single-teacher endpoint', async () => {
    const response = await ctx.admin
      .post(`/api/schools/${ctx.schoolId}/teachers`)
      .set('Origin', TEST_ORIGIN)
      .send({
        firstName: 'Yaa',
        lastName: 'Asante',
        email: 'yaa.asante@greenvalley.test',
        role: 'SUBJECT_TEACHER',
        className: 'Basic 3',
      })

    expect(response.status).toBe(400)
    expect(fieldPaths(response.body)).toEqual(['role'])
  })

  it('registers a subject teacher with normalized details for the assigned class', async () => {
    const registration = await register()
    expect(registration.status).toBe(201)

    const classId = registration.body.data.class.id as string
    await ctx.auth.setPasswordForTesting(
      'ama.mensah@greenvalley.test',
      TEACHER_PASSWORD,
    )
    const { agent } = await login(
      ctx.app,
      'ama.mensah@greenvalley.test',
      TEACHER_PASSWORD,
    )

    const response = await agent
      .post(`/api/schools/${ctx.schoolId}/classes/${classId}/subjects`)
      .set('Origin', TEST_ORIGIN)
      .send({
        name: 'Mathematics',
        subjectTeacher: {
          firstName: ' Kofi ',
          lastName: 'Boateng',
          email: ' Kofi.Boateng@GreenValley.test ',
          phone: '+233 (0)55 000 0000',
        },
      })

    expect(response.status).toBe(201)
    expect(response.body.data.subjectTeacherAssignment).toMatchObject({
      classId,
      firstName: 'Kofi',
      lastName: 'Boateng',
      email: 'kofi.boateng@greenvalley.test',
      phone: '+233550000000',
      endedAt: null,
    })
  })
})
