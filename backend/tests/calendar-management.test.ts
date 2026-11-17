import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createApp } from '../src/app.js'
import { createCalendarService } from '../src/calendar/service.js'
import type {
  AcademicYearCreateInput,
  CalendarAuditActor,
  CalendarTermConfig,
} from '../src/calendar/types.js'
import {
  registrationBody,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from './helpers/auth-fixtures.js'
import { FakeAuthRepository } from './helpers/fake-auth-repository.js'
import { FakeCalendarRepository } from './helpers/fake-calendar-repository.js'
import { FakeSchoolRepository } from './helpers/fake-school-repository.js'

const NOW = '2026-11-17T12:00:00.000Z'
const ACTOR: CalendarAuditActor = {
  actorUserId: randomUUID(),
  ipAddress: '127.0.0.1',
  userAgent: 'calendar-management-test',
}

const TERM_ONE: CalendarTermConfig = {
  name: 'Term 1',
  sequence: 1,
  startsOn: '2026-09-07',
  endsOn: '2026-12-18',
  assessmentDeadline: '2026-11-27',
  examinationStartsOn: '2026-12-04',
  examinationEndsOn: '2026-12-18',
  datesConfirmed: true,
}

const TERM_TWO: CalendarTermConfig = {
  name: 'Term 2',
  sequence: 2,
  startsOn: '2027-01-11',
  endsOn: '2027-03-10',
  assessmentDeadline: '2027-02-19',
  examinationStartsOn: '2027-02-26',
  examinationEndsOn: '2027-03-10',
  datesConfirmed: true,
}

function yearConfig(
  overrides: Partial<AcademicYearCreateInput> = {},
): AcademicYearCreateInput {
  return {
    name: '2026/2027',
    startsOn: '2026-09-07',
    endsOn: '2027-03-10',
    activate: false,
    terms: [TERM_ONE],
    ...overrides,
  }
}

function serviceFor(calendar: FakeCalendarRepository) {
  return createCalendarService({
    repository: calendar,
    now: () => new Date(NOW),
  })
}

function seedSchool(
  calendar: FakeCalendarRepository,
  id: string,
  name: string,
  options: {
    years?: Parameters<FakeCalendarRepository['seedSchool']>[0]['years']
  } = {},
): void {
  calendar.seedSchool({
    schoolId: id,
    schoolName: name,
    years: options.years ?? [],
  })
}

async function expectHttpError(
  promise: Promise<unknown>,
  status: number,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ statusCode: status })
}

describe('platform academic year management', () => {
  let calendar: FakeCalendarRepository
  let service: ReturnType<typeof createCalendarService>
  let schoolId: string

  beforeEach(() => {
    calendar = new FakeCalendarRepository()
    service = serviceFor(calendar)
    schoolId = randomUUID()
    seedSchool(calendar, schoolId, 'Accra Basic School')
  })

  it('creates an academic year with a confirmed term and audits it', async () => {
    const year = await service.createYear(ACTOR, schoolId, yearConfig())

    expect(year.name).toBe('2026/2027')
    expect(year.isCurrent).toBe(false)
    expect(year.terms).toHaveLength(1)
    expect(year.terms[0]).toMatchObject({
      name: 'Term 1',
      startsOn: '2026-09-07',
      endsOn: '2026-12-18',
      assessmentDeadline: '2026-11-27',
      examinationStartsOn: '2026-12-04',
      examinationEndsOn: '2026-12-18',
      datesConfirmed: true,
      status: 'PLANNED',
      reportStatus: 'NOT_PREPARED',
    })
    expect(calendar.audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          schoolId,
          action: 'CALENDAR_YEAR_CREATED',
          audit: expect.objectContaining({ actorUserId: ACTOR.actorUserId }),
        }),
      ]),
    )
  })

  it('leaves Terms 2 and 3 unconfigured until an administrator supplies them', async () => {
    const year = await service.createYear(ACTOR, schoolId, yearConfig())

    expect(year.terms.map((term) => term.sequence)).toEqual([1])
    expect(year.terms.filter((term) => term.datesConfirmed)).toHaveLength(1)
  })

  it('creates an unconfirmed term without treating it as configured', async () => {
    const year = await service.createYear(ACTOR, schoolId, {
      ...yearConfig(),
      activate: true,
      terms: [],
    })

    const term = await service.upsertTerm(ACTOR, schoolId, year.id, 2, {
      ...TERM_TWO,
      datesConfirmed: false,
    })

    expect(term.datesConfirmed).toBe(false)
    expect(term.datesConfirmedAt).toBeNull()
    expect(term.status).toBe('PLANNED')

    // The scheduler must ignore a term whose dates are not confirmed even when
    // its provisional start date has already passed.
    const run = await service.runSchool(schoolId)
    expect(run.status).toBe('UP_TO_DATE')
    expect(term.status).toBe('PLANNED')
  })

  it('rejects duplicate academic years', async () => {
    await service.createYear(ACTOR, schoolId, yearConfig())

    await expectHttpError(
      service.createYear(ACTOR, schoolId, yearConfig()),
      409,
    )
  })

  it('enforces exactly one current academic year transactionally', async () => {
    const first = await service.createYear(ACTOR, schoolId, {
      ...yearConfig(),
      activate: true,
    })

    const second = await service.createYear(ACTOR, schoolId, {
      ...yearConfig({ name: '2027/2028' }),
      startsOn: '2027-09-06',
      endsOn: '2028-03-09',
      terms: [],
      activate: true,
    })

    const years = calendar.schools.get(schoolId)!.years
    expect(years.filter((year) => year.isCurrent).map((year) => year.id)).toEqual([
      second.id,
    ])
    expect(
      years.find((year) => year.id === first.id)?.isCurrent,
    ).toBe(false)
  })

  it('edits academic year dates and rejects invalid ranges', async () => {
    const year = await service.createYear(ACTOR, schoolId, yearConfig())

    const updated = await service.updateYear(ACTOR, schoolId, year.id, {
      name: '2026/2027',
      startsOn: '2026-09-07',
      endsOn: '2027-03-12',
    })
    expect(updated.endsOn).toBe('2027-03-12')

    await expectHttpError(
      service.updateYear(ACTOR, schoolId, year.id, {
        name: '2026/2027',
        startsOn: '2027-03-12',
        endsOn: '2026-09-07',
      }),
      400,
    )
  })

  it('rejects terms outside the academic year and overlapping terms', async () => {
    await expectHttpError(
      service.createYear(
        ACTOR,
        schoolId,
        yearConfig({
          terms: [
            {
              ...TERM_ONE,
              startsOn: '2026-08-01',
            },
          ],
        }),
      ),
      400,
    )

    const year = await service.createYear(ACTOR, schoolId, yearConfig())

    await expectHttpError(
      service.upsertTerm(ACTOR, schoolId, year.id, 2, {
        ...TERM_TWO,
        startsOn: '2026-11-01',
        endsOn: '2027-03-10',
        assessmentDeadline: '2026-12-01',
        examinationStartsOn: '2026-12-05',
      }),
      400,
    )
  })

  it('rejects examination periods that end before they start', async () => {
    await expectHttpError(
      service.createYear(
        ACTOR,
        schoolId,
        yearConfig({
          terms: [
            {
              ...TERM_ONE,
              examinationStartsOn: '2026-12-10',
              examinationEndsOn: '2026-12-04',
            },
          ],
        }),
      ),
      400,
    )
  })

  it('requires acknowledgement before correcting an already-open term', async () => {
    const year = await service.createYear(ACTOR, schoolId, {
      ...yearConfig(),
      activate: true,
    })
    const termId = year.terms[0]!.id
    const seeded = calendar.findTerm(schoolId, termId)!
    seeded.status = 'OPEN'
    seeded.datesConfirmedAt = new Date()

    await expectHttpError(
      service.upsertTerm(ACTOR, schoolId, year.id, 1, {
        ...TERM_ONE,
        endsOn: '2026-12-20',
      }),
      409,
    )

    const corrected = await service.upsertTerm(ACTOR, schoolId, year.id, 1, {
      ...TERM_ONE,
      endsOn: '2026-12-20',
      acknowledgeImpacts: true,
    })

    expect(corrected.endsOn).toBe('2026-12-20')
    expect(corrected.status).toBe('OPEN')
    expect(corrected.reportsPreparedAt).toBeNull()
  })

  it('activates, deactivates and archives a year without deleting anything', async () => {
    const year = await service.createYear(ACTOR, schoolId, yearConfig())

    const activated = await service.activateYear(ACTOR, schoolId, year.id)
    expect(activated.isCurrent).toBe(true)

    const deactivated = await service.deactivateYear(ACTOR, schoolId, year.id)
    expect(deactivated.isCurrent).toBe(false)

    const archived = await service.archiveYear(ACTOR, schoolId, year.id)
    expect(archived.isArchived).toBe(true)
    expect(archived.archivedAt).not.toBeNull()
    expect(calendar.schools.get(schoolId)!.years).toHaveLength(1)
    expect(calendar.audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'CALENDAR_YEAR_ACTIVATED' }),
        expect.objectContaining({ action: 'CALENDAR_YEAR_DEACTIVATED' }),
        expect.objectContaining({ action: 'CALENDAR_YEAR_ARCHIVED' }),
      ]),
    )
  })

  it('prevents archiving the active current academic year', async () => {
    const year = await service.createYear(ACTOR, schoolId, {
      ...yearConfig(),
      activate: true,
    })

    await expectHttpError(
      service.archiveYear(ACTOR, schoolId, year.id),
      409,
    )
  })

  it('prevents editing an archived academic year', async () => {
    const year = await service.createYear(ACTOR, schoolId, yearConfig())
    await service.archiveYear(ACTOR, schoolId, year.id)

    await expectHttpError(
      service.updateYear(ACTOR, schoolId, year.id, {
        name: '2026/2027',
        startsOn: '2026-09-07',
        endsOn: '2027-03-11',
      }),
      409,
    )
  })
})

describe('central calendar distribution', () => {
  let calendar: FakeCalendarRepository
  let service: ReturnType<typeof createCalendarService>
  let sourceId: string
  let createTargetId: string
  let updateTargetId: string
  let failedTargetId: string
  let sourceYearId: string

  beforeEach(async () => {
    calendar = new FakeCalendarRepository()
    service = serviceFor(calendar)
    sourceId = randomUUID()
    createTargetId = randomUUID()
    updateTargetId = randomUUID()
    failedTargetId = randomUUID()

    seedSchool(calendar, sourceId, 'Accra Basic School')
    seedSchool(calendar, createTargetId, 'Kumasi Preparatory')
    seedSchool(calendar, updateTargetId, 'Tamale Academy')
    seedSchool(calendar, failedTargetId, 'Cape Coast Model')

    const year = await service.createYear(ACTOR, sourceId, yearConfig())
    sourceYearId = year.id

    // Existing target: same year with a known Term 1 id and report history.
    seedSchool(calendar, updateTargetId, 'Tamale Academy', {
      years: [
        {
          name: '2026/2027',
          startsOn: '2026-09-01',
          endsOn: '2027-03-10',
          terms: [
            {
              name: 'Term 1',
              sequence: 1,
              startsOn: '2026-09-01',
              endsOn: '2026-12-18',
              reportsPreparedAt: new Date('2026-12-19T00:00:00.000Z'),
            },
          ],
        },
      ],
    })

    // Failing target: an extra term that overlaps the incoming Term 1 makes the
    // merged calendar invalid, so this school alone must fail.
    seedSchool(calendar, failedTargetId, 'Cape Coast Model', {
      years: [
        {
          name: '2026/2027',
          startsOn: '2026-09-01',
          endsOn: '2027-03-10',
          terms: [
            {
              name: 'Term 9',
              sequence: 2,
              startsOn: '2026-10-01',
              endsOn: '2026-11-30',
            },
          ],
        },
      ],
    })
  })

  it('previews the number of schools that will change', async () => {
    const preview = await service.previewApply(ACTOR, sourceId, sourceYearId)

    expect(preview.totalSchools).toBe(4)
    expect(preview.affectedSchools).toBe(3)
    expect(
      preview.schools.find((school) => school.schoolId === sourceId)?.action,
    ).toBe('UNCHANGED')
    expect(
      preview.schools.find((school) => school.schoolId === createTargetId)?.action,
    ).toBe('CREATE')
    expect(
      preview.schools.find((school) => school.schoolId === updateTargetId)?.action,
    ).toBe('UPDATE')
  })

  it('applies independently per school and reports partial failures', async () => {
    const result = await service.applyCalendar(ACTOR, sourceId, sourceYearId)

    expect(result.totalSchools).toBe(4)
    expect(result.succeeded).toBe(3)
    expect(result.failed).toBe(1)
    expect(
      result.results.find((item) => item.schoolId === sourceId)?.status,
    ).toBe('SUCCEEDED')
    expect(
      result.results.find((item) => item.schoolId === createTargetId),
    ).toMatchObject({ status: 'SUCCEEDED', action: 'CREATED' })
    expect(
      result.results.find((item) => item.schoolId === updateTargetId),
    ).toMatchObject({ status: 'SUCCEEDED', action: 'UPDATED' })
    expect(
      result.results.find((item) => item.schoolId === failedTargetId)?.status,
    ).toBe('FAILED')

    // The failing school did not create or update its calendar.
    expect(
      calendar.schools
        .get(failedTargetId)!
        .years.find((year) => year.name === '2026/2027')!
        .terms.map((term) => term.name),
    ).toEqual(['Term 9'])

    // Auditing is per successful school only.
    expect(
      calendar.audits.filter(
        (entry) =>
          entry.action === 'CALENDAR_APPLIED_TO_SCHOOL' &&
          entry.schoolId === createTargetId,
      ),
    ).toHaveLength(1)
    expect(
      calendar.audits.filter(
        (entry) =>
          entry.action === 'CALENDAR_APPLIED_TO_SCHOOL' &&
          entry.schoolId === failedTargetId,
      ),
    ).toHaveLength(0)
  })

  it('updates an existing year in place, preserving its term identity and reports', async () => {
    const before = calendar.schools
      .get(updateTargetId)!
      .years.find((year) => year.name === '2026/2027')!
    const termId = before.terms[0]!.id

    await service.applyCalendar(ACTOR, sourceId, sourceYearId, [updateTargetId])

    const after = calendar.schools
      .get(updateTargetId)!
      .years.find((year) => year.name === '2026/2027')!

    expect(after.id).toBe(before.id)
    expect(after.terms[0]!.id).toBe(termId)
    expect(after.terms[0]!.startsOn).toBe(TERM_ONE.startsOn)
    expect(after.terms[0]!.assessmentDeadline).toBe(
      TERM_ONE.assessmentDeadline,
    )
    expect(after.terms[0]!.reportsPreparedAt).toEqual(
      new Date('2026-12-19T00:00:00.000Z'),
    )
  })

  it('retries only the failed schools and reports the failure again honestly', async () => {
    const first = await service.applyCalendar(ACTOR, sourceId, sourceYearId)
    const failed = first.results
      .filter((item) => item.status === 'FAILED')
      .map((item) => item.schoolId)

    expect(failed).toEqual([failedTargetId])

    const retry = await service.applyCalendar(
      ACTOR,
      sourceId,
      sourceYearId,
      failed,
    )

    expect(retry.totalSchools).toBe(1)
    expect(retry.failed).toBe(1)
    expect(retry.results[0]!.schoolId).toBe(failedTargetId)
  })

  it('rejects unknown or inactive target schools', async () => {
    await expectHttpError(
      service.previewApply(ACTOR, sourceId, sourceYearId, [randomUUID()]),
      400,
    )
  })
})

describe('calendar management HTTP authorization', () => {
  interface Setup {
    app: ReturnType<typeof createApp>
    auth: FakeAuthRepository
    calendar: FakeCalendarRepository
    admin: ReturnType<typeof request.agent>
    schoolId: string
    adminUserId: string
  }

  async function setup(): Promise<Setup> {
    const auth = new FakeAuthRepository()
    const schools = new FakeSchoolRepository(auth)
    const calendar = new FakeCalendarRepository()
    const service = serviceFor(calendar)
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
    calendar.seedSchool({
      schoolId,
      schoolName: 'Accra Basic School',
      years: [],
    })

    return { app, auth, calendar, admin, schoolId, adminUserId }
  }

  async function platformAgent(ctx: Setup) {
    await ctx.auth.createUser({
      email: 'platform@gradely.test',
      password: TEST_PASSWORD,
      firstName: 'Platform',
      lastName: 'Admin',
      isPlatformAdmin: true,
    })
    const agent = request.agent(ctx.app)
    const login = await agent
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'platform@gradely.test', password: TEST_PASSWORD })
    expect(login.status).toBe(200)
    return agent
  }

  let ctx: Setup

  beforeEach(async () => {
    ctx = await setup()
  })

  afterEach(() => {
    delete process.env.PLATFORM_REAUTH_ENFORCED
  })

  it('denies school administrators and teachers write access', async () => {
    const denied = await ctx.admin
      .post(`/api/platform/calendar/${ctx.schoolId}/years`)
      .set('Origin', TEST_ORIGIN)
      .send({
        name: '2027/2028',
        startsOn: '2027-09-06',
        endsOn: '2028-03-09',
        activate: false,
        terms: [],
      })
    expect(denied.status).toBe(403)

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
    await teacher
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'teacher@accra-basic.test', password: TEST_PASSWORD })

    const teacherDenied = await teacher
      .post(`/api/platform/calendar/${ctx.schoolId}/years`)
      .set('Origin', TEST_ORIGIN)
      .send({
        name: '2027/2028',
        startsOn: '2027-09-06',
        endsOn: '2028-03-09',
        activate: false,
        terms: [],
      })
    expect(teacherDenied.status).toBe(403)
  })

  it('allows a Platform Super Admin to create, edit and distribute a calendar', async () => {
    const platform = await platformAgent(ctx)

    const created = await platform
      .post(`/api/platform/calendar/${ctx.schoolId}/years`)
      .set('Origin', TEST_ORIGIN)
      .send(yearConfig())
    expect(created.status).toBe(201)
    expect(created.body.data.year.name).toBe('2026/2027')

    const yearId = created.body.data.year.id as string
    const updated = await platform
      .put(`/api/platform/calendar/${ctx.schoolId}/years/${yearId}`)
      .set('Origin', TEST_ORIGIN)
      .send({
        name: '2026/2027',
        startsOn: '2026-09-07',
        endsOn: '2027-03-12',
      })
    expect(updated.status).toBe(200)

    const term = await platform
      .put(
        `/api/platform/calendar/${ctx.schoolId}/years/${yearId}/terms/1`,
      )
      .set('Origin', TEST_ORIGIN)
      .send({
        name: TERM_ONE.name,
        startsOn: TERM_ONE.startsOn,
        endsOn: TERM_ONE.endsOn,
        assessmentDeadline: TERM_ONE.assessmentDeadline,
        examinationStartsOn: TERM_ONE.examinationStartsOn,
        examinationEndsOn: TERM_ONE.examinationEndsOn,
        datesConfirmed: TERM_ONE.datesConfirmed,
        acknowledgeImpacts: false,
      })
    expect(term.status).toBe(200)
    expect(term.body.data.term.datesConfirmed).toBe(true)

    const preview = await platform
      .post('/api/platform/calendar/apply/preview')
      .set('Origin', TEST_ORIGIN)
      .send({ sourceSchoolId: ctx.schoolId, yearId })
    expect(preview.status).toBe(200)
    expect(preview.body.data.preview.totalSchools).toBeGreaterThan(0)

    const applied = await platform
      .post('/api/platform/calendar/apply')
      .set('Origin', TEST_ORIGIN)
      .send({ sourceSchoolId: ctx.schoolId, yearId })
    expect(applied.status).toBe(200)
    expect(applied.body.data.result.failed).toBe(0)
  })

  it('requires sensitive reauthentication to reset or archive', async () => {
    const platform = await platformAgent(ctx)
    const created = await platform
      .post(`/api/platform/calendar/${ctx.schoolId}/years`)
      .set('Origin', TEST_ORIGIN)
      .send(yearConfig())
    const yearId = created.body.data.year.id as string

    process.env.PLATFORM_REAUTH_ENFORCED = 'true'

    const resetBlocked = await platform
      .post(`/api/platform/calendar/${ctx.schoolId}/years/${yearId}/reset`)
      .set('Origin', TEST_ORIGIN)
      .send({
        name: '2026/2027',
        startsOn: '2026-09-07',
        endsOn: '2027-03-10',
        terms: [TERM_ONE],
        acknowledgeImpacts: true,
      })
    expect(resetBlocked.status).toBe(428)

    const archiveBlocked = await platform
      .post(`/api/platform/calendar/${ctx.schoolId}/years/${yearId}/archive`)
      .set('Origin', TEST_ORIGIN)
      .send({})
    expect(archiveBlocked.status).toBe(428)
  })
})
