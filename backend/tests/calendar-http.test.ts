import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { buildAcademicYearPlan } from '../src/calendar/logic.js'
import { createCalendarService } from '../src/calendar/service.js'
import type { PrepareReports } from '../src/calendar/types.js'
import {
  registrationBody,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from './helpers/auth-fixtures.js'
import { FakeAuthRepository } from './helpers/fake-auth-repository.js'
import {
  FakeCalendarRepository,
  type FakeCalendarSeed,
} from './helpers/fake-calendar-repository.js'
import { FakeSchoolRepository } from './helpers/fake-school-repository.js'

const REFERENCE_NOW = '2026-11-09T12:00:00.000Z'
const PLAN = buildAcademicYearPlan(2026)

interface Setup {
  app: ReturnType<typeof createApp>
  auth: FakeAuthRepository
  calendar: FakeCalendarRepository
  admin: ReturnType<typeof request.agent>
  schoolId: string
  adminUserId: string
}

async function setup(
  options: {
    nowIso?: string
    prepareReports?: PrepareReports
  } = {},
): Promise<Setup> {
  const auth = new FakeAuthRepository()
  const schools = new FakeSchoolRepository(auth)
  const calendar = new FakeCalendarRepository()
  const nowIso = options.nowIso ?? REFERENCE_NOW
  const service = createCalendarService({
    repository: calendar,
    prepareReports: options.prepareReports,
    now: () => new Date(nowIso),
  })
  const app = createApp({
    authRepository: auth,
    schoolRepository: schools,
    calendarService: service,
  })
  const admin = request.agent(app)
  const response = await admin
    .post('/api/auth/register-school')
    .set('Origin', TEST_ORIGIN)
    .send(
      registrationBody({
        schoolName: 'Accra Basic School',
        email: 'admin@accra-basic.test',
      }),
    )

  expect(response.status).toBe(201)
  const schoolId = response.body.data.school.id as string
  const adminUserId = response.body.data.user.id as string

  schools.seedSchool({
    id: schoolId,
    name: 'Accra Basic School',
    slug: response.body.data.school.slug,
    email: 'admin@accra-basic.test',
  })
  schools.seedDefaults(schoolId, adminUserId)

  return { app, auth, calendar, admin, schoolId, adminUserId }
}

async function createPlatformAgent(
  setupResult: Setup,
): Promise<ReturnType<typeof request.agent>> {
  await setupResult.auth.createUser({
    email: 'platform@gradely.test',
    password: TEST_PASSWORD,
    firstName: 'Platform',
    lastName: 'Admin',
    isPlatformAdmin: true,
  })

  const agent = request.agent(setupResult.app)
  const response = await agent
    .post('/api/auth/login')
    .set('Origin', TEST_ORIGIN)
    .send({ email: 'platform@gradely.test', password: TEST_PASSWORD })

  expect(response.status).toBe(200)
  return agent
}

function seedCurrentYear(
  calendar: FakeCalendarRepository,
  schoolId: string,
  terms: NonNullable<FakeCalendarSeed['years']>[number]['terms'],
  overrides: { name?: string; startsOn?: string; endsOn?: string } = {},
): void {
  calendar.seedSchool({
    schoolId,
    schoolName: 'Accra Basic School',
    years: [
      {
        name: overrides.name ?? PLAN.name,
        startsOn: overrides.startsOn ?? PLAN.startsOn,
        endsOn: overrides.endsOn ?? PLAN.endsOn,
        isCurrent: true,
        terms,
      },
    ],
  })
}

describe('automatic academic calendar HTTP surface', () => {
  let ctx: Setup

  beforeEach(async () => {
    ctx = await setup()
  })

  it('shows administrators and teachers the current calendar read-only', async () => {
    seedCurrentYear(ctx.calendar, ctx.schoolId, [
      {
        name: 'Term 1',
        sequence: 1,
        startsOn: '2026-09-01',
        endsOn: '2026-12-19',
        status: 'OPEN',
        isCurrent: true,
      },
      {
        name: 'Term 2',
        sequence: 2,
        startsOn: '2027-01-06',
        endsOn: '2027-04-03',
      },
      {
        name: 'Term 3',
        sequence: 3,
        startsOn: '2027-04-21',
        endsOn: '2027-08-31',
      },
    ])

    const adminRead = await ctx.admin.get(
      `/api/schools/${ctx.schoolId}/calendar`,
    )
    expect(adminRead.status).toBe(200)
    expect(adminRead.body.data.calendar).toMatchObject({
      schoolId: ctx.schoolId,
      timezone: 'Africa/Accra',
      currentYear: { name: PLAN.name },
      currentTerm: {
        name: 'Term 1',
        status: 'OPEN',
        assessmentDeadline: '2026-11-28',
        examinationStartsOn: '2026-12-05',
        examinationEndsOn: '2026-12-19',
        reportStatus: 'NOT_PREPARED',
      },
    })

    const teacherUser = await ctx.auth.createUser({
      email: 'teacher@accra-basic.test',
      password: TEST_PASSWORD,
    })
    await ctx.auth.addMembership(
      teacherUser.id,
      ctx.schoolId,
      'CLASS_TEACHER',
    )

    const teacher = request.agent(ctx.app)
    const login = await teacher
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'teacher@accra-basic.test', password: TEST_PASSWORD })
    expect(login.status).toBe(200)

    const teacherRead = await teacher.get(
      `/api/schools/${ctx.schoolId}/calendar`,
    )
    expect(teacherRead.status).toBe(200)
    expect(teacherRead.body.data.calendar.currentTerm.name).toBe('Term 1')
  })

  it('denies calendar read access to non-members', async () => {
    await ctx.auth.createUser({
      email: 'outsider@example.test',
      password: TEST_PASSWORD,
    })
    const outsider = request.agent(ctx.app)
    await outsider
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'outsider@example.test', password: TEST_PASSWORD })

    const response = await outsider.get(
      `/api/schools/${ctx.schoolId}/calendar`,
    )
    expect(response.status).toBe(403)
  })
})

describe('platform calendar transitions', () => {
  it('opens a due term without opening it early', async () => {
    const ctx = await setup()
    seedCurrentYear(ctx.calendar, ctx.schoolId, [
      {
        name: 'Term 1',
        sequence: 1,
        startsOn: '2026-09-01',
        endsOn: '2026-12-19',
      },
      {
        name: 'Term 2',
        sequence: 2,
        startsOn: '2027-01-06',
        endsOn: '2027-04-03',
      },
      {
        name: 'Term 3',
        sequence: 3,
        startsOn: '2027-04-21',
        endsOn: '2027-08-31',
      },
    ])
    const platform = await createPlatformAgent(ctx)

    const run = await platform
      .post(`/api/platform/calendar/${ctx.schoolId}/run`)
      .set('Origin', TEST_ORIGIN)
      .send({})

    expect(run.status).toBe(200)
    expect(run.body.data.result.status).toBe('COMPLETED')
    expect(run.body.data.result.steps[0]).toMatchObject({
      action: 'OPEN_TERM',
      termName: 'Term 1',
    })

    const term = [...ctx.calendar.schools.get(ctx.schoolId)!.years[0]!.terms][0]!
    expect(term.status).toBe('OPEN')
    expect(term.isCurrent).toBe(true)

    const secondRun = await platform
      .post(`/api/platform/calendar/${ctx.schoolId}/run`)
      .set('Origin', TEST_ORIGIN)
      .send({})
    expect(secondRun.body.data.result.status).toBe('UP_TO_DATE')

    const years = ctx.calendar.schools.get(ctx.schoolId)!.years
    expect(years.filter((year) => year.name === PLAN.name)).toHaveLength(1)
  })

  it('bootstraps a missing calendar and opens the term containing today', async () => {
    const ctx = await setup({ nowIso: '2027-01-15T12:00:00.000Z' })
    ctx.calendar.seedSchool({
      schoolId: ctx.schoolId,
      schoolName: 'Accra Basic School',
      years: [],
    })
    const platform = await createPlatformAgent(ctx)

    const first = await platform
      .post(`/api/platform/calendar/${ctx.schoolId}/run`)
      .set('Origin', TEST_ORIGIN)
      .send({})

    expect(first.status).toBe(200)
    expect(ctx.calendar.transitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'CREATE_ACADEMIC_YEAR' }),
      ]),
    )

    const school = ctx.calendar.schools.get(ctx.schoolId)!
    const year = school.years.find((item) => item.name === '2026/2027')!
    expect(year).toBeDefined()
    expect(year.terms.map((term) => term.status)).toEqual([
      'CLOSED',
      'OPEN',
      'PLANNED',
    ])
    expect(year.terms.filter((term) => term.isCurrent)).toHaveLength(1)
    expect(year.terms[1]!.isCurrent).toBe(true)

    // A second run must not reopen Term 1 or create a duplicate year.
    const second = await platform
      .post(`/api/platform/calendar/${ctx.schoolId}/run`)
      .set('Origin', TEST_ORIGIN)
      .send({})

    expect(second.status).toBe(200)
    expect(second.body.data.result.status).toBe('UP_TO_DATE')
    expect(
      school.years.filter((item) => item.name === '2026/2027'),
    ).toHaveLength(1)
    expect(school.years).toHaveLength(1)
  })

  it('never closes a term while required results are incomplete', async () => {
    const ctx = await setup()
    seedCurrentYear(ctx.calendar, ctx.schoolId, [
      {
        name: 'Term 1',
        sequence: 1,
        startsOn: '2026-09-01',
        endsOn: '2026-11-08',
        status: 'OPEN',
        isCurrent: true,
      },
    ])
    const termId = ctx.calendar.schools.get(ctx.schoolId)!.years[0]!.terms[0]!.id
    ctx.calendar.setCompletion(termId, {
      complete: false,
      requiredCount: 2,
      acceptedCount: 1,
      missing: [
        {
          classId: 'class-1',
          className: 'Basic 1',
          subjectId: 'subject-1',
          subjectName: 'English Language',
        },
      ],
    })
    const platform = await createPlatformAgent(ctx)

    const run = await platform
      .post(`/api/platform/calendar/${ctx.schoolId}/run`)
      .set('Origin', TEST_ORIGIN)
      .send({})

    expect(run.status).toBe(200)
    expect(run.body.data.result.status).toBe('BLOCKED')
    expect(run.body.data.result.steps.at(-1)).toMatchObject({
      action: 'CLOSE_TERM',
      status: 'BLOCKED',
    })

    const term = ctx.calendar.findTerm(ctx.schoolId, termId)!
    expect(term.status).toBe('OPEN')
    expect(ctx.calendar.transitions.at(-1)).toMatchObject({
      action: 'CLOSE_TERM',
      status: 'BLOCKED',
    })
  })

  it('closes a term only after reports are prepared and results are complete', async () => {
    const ctx = await setup()
    seedCurrentYear(ctx.calendar, ctx.schoolId, [
      {
        name: 'Term 1',
        sequence: 1,
        startsOn: '2026-09-01',
        endsOn: '2026-11-08',
        status: 'OPEN',
        isCurrent: true,
      },
    ])
    const platform = await createPlatformAgent(ctx)

    const run = await platform
      .post(`/api/platform/calendar/${ctx.schoolId}/run`)
      .set('Origin', TEST_ORIGIN)
      .send({})

    expect(run.status).toBe(200)
    expect(run.body.data.result.status).toBe('COMPLETED')

    const term = ctx.calendar.schools.get(ctx.schoolId)!.years[0]!.terms[0]!
    expect(term.status).toBe('CLOSED')
    expect(term.reportsPreparedAt).toBeInstanceOf(Date)
    expect(term.closedAt).toBeInstanceOf(Date)
  })

  it('recovers a failed report preparation on the next run', async () => {
    let attempts = 0
    const prepareReports: PrepareReports = async () => {
      attempts += 1

      if (attempts === 1) {
        return { prepared: false, message: 'Report service unavailable' }
      }

      return { prepared: true, batchId: 'batch-1' }
    }

    const ctx = await setup({ prepareReports })
    seedCurrentYear(ctx.calendar, ctx.schoolId, [
      {
        name: 'Term 1',
        sequence: 1,
        startsOn: '2026-09-01',
        endsOn: '2026-11-08',
        status: 'OPEN',
        isCurrent: true,
      },
    ])
    const termId = ctx.calendar.schools.get(ctx.schoolId)!.years[0]!.terms[0]!.id
    ctx.calendar.setActivePupils(termId, true)
    const platform = await createPlatformAgent(ctx)

    const first = await platform
      .post(`/api/platform/calendar/${ctx.schoolId}/run`)
      .set('Origin', TEST_ORIGIN)
      .send({})

    expect(first.status).toBe(200)
    expect(first.body.data.result.status).toBe('FAILED')
    expect(first.body.data.result.steps[0]).toMatchObject({
      action: 'PREPARE_REPORTS',
      status: 'FAILED',
    })

    const second = await platform
      .post(`/api/platform/calendar/${ctx.schoolId}/run`)
      .set('Origin', TEST_ORIGIN)
      .send({})

    expect(second.status).toBe(200)
    expect(second.body.data.result.status).toBe('COMPLETED')
    expect(ctx.calendar.findTerm(ctx.schoolId, termId)!.reportsPreparedAt).toBeInstanceOf(
      Date,
    )
    expect(attempts).toBe(2)
  })

  it('promotes pupils, archives history and initializes the next year after Term 3', async () => {
    const ctx = await setup({ nowIso: '2027-09-01T12:00:00.000Z' })
    seedCurrentYear(
      ctx.calendar,
      ctx.schoolId,
      [
        {
          name: 'Term 1',
          sequence: 1,
          startsOn: '2026-09-01',
          endsOn: '2026-12-19',
          status: 'CLOSED',
        },
        {
          name: 'Term 2',
          sequence: 2,
          startsOn: '2027-01-06',
          endsOn: '2027-04-03',
          status: 'CLOSED',
        },
        {
          name: 'Term 3',
          sequence: 3,
          startsOn: '2027-04-21',
          endsOn: '2027-08-31',
          status: 'CLOSED',
          reportsPreparedAt: new Date('2027-09-01T00:00:00.000Z'),
        },
      ],
    )
    ctx.calendar.promotedCount = 7
    const platform = await createPlatformAgent(ctx)

    const run = await platform
      .post(`/api/platform/calendar/${ctx.schoolId}/run`)
      .set('Origin', TEST_ORIGIN)
      .send({})

    expect(run.status).toBe(200)
    expect(run.body.data.result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'FINALIZE_YEAR',
          status: 'COMPLETED',
          message: expect.stringContaining('Promoted 7 pupil(s)'),
        }),
      ]),
    )

    const years = ctx.calendar.schools.get(ctx.schoolId)!.years
    const oldYear = years.find((year) => year.name === PLAN.name)!
    const nextYear = years.find((year) => year.name === '2027/2028')!

    expect(oldYear.isArchived).toBe(true)
    expect(oldYear.archivedAt).toBeInstanceOf(Date)
    expect(oldYear.terms).toHaveLength(3)
    expect(nextYear).toBeDefined()
    expect(nextYear.terms).toHaveLength(3)
    expect(ctx.calendar.finalizedYears).toHaveLength(1)
  })

  it('allows only platform administrators to run transitions or correct dates', async () => {
    const ctx = await setup()
    seedCurrentYear(ctx.calendar, ctx.schoolId, [
      {
        name: 'Term 1',
        sequence: 1,
        startsOn: '2026-09-01',
        endsOn: '2026-12-19',
      },
    ])
    const termId = ctx.calendar.schools.get(ctx.schoolId)!.years[0]!.terms[0]!.id

    const deniedRun = await ctx.admin
      .post(`/api/platform/calendar/${ctx.schoolId}/run`)
      .set('Origin', TEST_ORIGIN)
      .send({})
    expect(deniedRun.status).toBe(403)

    const deniedCorrection = await ctx.admin
      .post(`/api/platform/calendar/${ctx.schoolId}/terms/${termId}/dates`)
      .set('Origin', TEST_ORIGIN)
      .send({ startsOn: '2026-09-02', endsOn: '2026-12-18' })
    expect(deniedCorrection.status).toBe(403)

    const platform = await createPlatformAgent(ctx)
    const correction = await platform
      .post(`/api/platform/calendar/${ctx.schoolId}/terms/${termId}/dates`)
      .set('Origin', TEST_ORIGIN)
      .send({ startsOn: '2026-09-02', endsOn: '2026-12-18' })

    expect(correction.status).toBe(200)
    expect(correction.body.data.term).toMatchObject({
      startsOn: '2026-09-02',
      endsOn: '2026-12-18',
    })
  })

  it('keeps the platform close endpoint completion-checked', async () => {
    const ctx = await setup()
    seedCurrentYear(ctx.calendar, ctx.schoolId, [
      {
        name: 'Term 1',
        sequence: 1,
        startsOn: '2026-09-01',
        endsOn: '2026-12-19',
        status: 'OPEN',
        isCurrent: true,
      },
    ])
    const termId = ctx.calendar.schools.get(ctx.schoolId)!.years[0]!.terms[0]!.id
    ctx.calendar.setCompletion(termId, {
      complete: false,
      requiredCount: 1,
      acceptedCount: 0,
      missing: [
        {
          classId: 'class-1',
          className: 'Basic 1',
          subjectId: 'subject-1',
          subjectName: 'Mathematics',
        },
      ],
    })
    const platform = await createPlatformAgent(ctx)

    const response = await platform
      .post(`/api/platform/calendar/${ctx.schoolId}/terms/${termId}/close`)
      .set('Origin', TEST_ORIGIN)
      .send({})

    expect(response.status).toBe(409)
    expect(response.body.error.details.completion.missing).toHaveLength(1)
    expect(ctx.calendar.findTerm(ctx.schoolId, termId)!.status).toBe('OPEN')
  })
})
