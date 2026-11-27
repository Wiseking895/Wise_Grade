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

interface Context {
  app: ReturnType<typeof createApp>
  auth: FakeAuthRepository
  schools: FakeSchoolRepository
  admin: ReturnType<typeof request.agent>
  schoolId: string
  adminUserId: string
}

async function registerSchool(
  auth: FakeAuthRepository,
  schools: FakeSchoolRepository,
  app: ReturnType<typeof createApp>,
  overrides: { schoolName: string; email: string },
): Promise<Context> {
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

describe('school session settings', () => {
  let auth: FakeAuthRepository
  let schools: FakeSchoolRepository
  let app: ReturnType<typeof createApp>
  let ctx: Context

  beforeEach(async () => {
    auth = new FakeAuthRepository()
    schools = new FakeSchoolRepository(auth)
    app = createApp({ authRepository: auth, schoolRepository: schools })
    ctx = await registerSchool(auth, schools, app, {
      schoolName: 'Session Academy',
      email: 'admin@session.test',
    })
  })

  async function patch(
    agent: ReturnType<typeof request.agent>,
    schoolId: string,
    body: Record<string, unknown>,
  ) {
    return agent
      .patch(`/api/schools/${schoolId}/session-settings`)
      .set('Origin', TEST_ORIGIN)
      .send(body)
  }

  it('starts with no configured dates and lets the administrator set them', async () => {
    const before = await ctx.admin.get(
      `/api/schools/${ctx.schoolId}/session-settings`,
    )
    expect(before.status).toBe(200)
    expect(before.body.data.settings.closingDate).toBeNull()

    const updated = await patch(ctx.admin, ctx.schoolId, {
      reopeningDate: '2026-09-07',
      closingDate: '2026-12-18',
    })
    expect(updated.status).toBe(200)
    expect(updated.body.data.settings).toMatchObject({
      schoolId: ctx.schoolId,
      reopeningDate: '2026-09-07',
      closingDate: '2026-12-18',
    })

    const after = await ctx.admin.get(
      `/api/schools/${ctx.schoolId}/session-settings`,
    )
    expect(after.body.data.settings.reopeningDate).toBe('2026-09-07')
    expect(after.body.data.settings.closingDate).toBe('2026-12-18')

    expect(schools.auditActions()).toContain('SCHOOL_SESSION_UPDATED')
  })

  it('rejects a closing date that is not later than the reopening date', async () => {
    const same = await patch(ctx.admin, ctx.schoolId, {
      reopeningDate: '2026-12-18',
      closingDate: '2026-12-18',
    })
    expect(same.status).toBe(400)

    const reversed = await patch(ctx.admin, ctx.schoolId, {
      reopeningDate: '2026-12-18',
      closingDate: '2026-09-07',
    })
    expect(reversed.status).toBe(400)
  })

  it('keeps class teachers and other schools from editing the dates', async () => {
    const classTeacher = await ctx.admin
      .post(`/api/schools/${ctx.schoolId}/classes/register`)
      .set('Origin', TEST_ORIGIN)
      .send({
        className: 'Basic 2',
        teacher: {
          firstName: 'Class',
          lastName: 'Teacher',
          email: 'ct@session.test',
        },
      })
    expect(classTeacher.status).toBe(201)
    await auth.setPasswordForTesting('ct@session.test', TEST_PASSWORD)

    const teacherAgent = request.agent(app)
    const login = await teacherAgent
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'ct@session.test', password: TEST_PASSWORD })
    expect(login.status).toBe(200)

    const teacherUpdate = await patch(teacherAgent, ctx.schoolId, {
      reopeningDate: '2026-09-07',
      closingDate: '2026-12-18',
    })
    expect(teacherUpdate.status).toBe(403)

    // A second school's administrator cannot touch this school's dates.
    const other = await registerSchool(auth, schools, app, {
      schoolName: 'Other Academy',
      email: 'admin@other.test',
    })
    const crossSchool = await patch(other.admin, ctx.schoolId, {
      reopeningDate: '2026-09-07',
      closingDate: '2026-12-18',
    })
    expect(crossSchool.status).toBe(403)
  })

  it('rejects invalid date formats', async () => {
    const invalid = await patch(ctx.admin, ctx.schoolId, {
      reopeningDate: 'not-a-date',
      closingDate: '2026-12-18',
    })
    expect(invalid.status).toBe(400)
  })
})
