import { beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createCalendarService } from '../src/calendar/service.js'
import type {
  CalendarAuditActor,
  CalendarResetInput,
  CalendarTermConfig,
} from '../src/calendar/types.js'
import { FakeCalendarRepository } from './helpers/fake-calendar-repository.js'

const NOW = '2026-11-17T12:00:00.000Z'
const ACTOR: CalendarAuditActor = {
  actorUserId: randomUUID(),
  ipAddress: '10.0.0.4',
  userAgent: 'calendar-reset-test',
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
  datesConfirmed: false,
}

function resetInput(
  overrides: Partial<CalendarResetInput> = {},
): CalendarResetInput {
  return {
    name: '2026/2027',
    startsOn: '2026-09-07',
    endsOn: '2027-03-10',
    terms: [TERM_ONE],
    acknowledgeImpacts: true,
    ...overrides,
  }
}

async function expectStatus(
  promise: Promise<unknown>,
  statusCode: number,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ statusCode })
}

describe('safe calendar reset', () => {
  let calendar: FakeCalendarRepository
  let service: ReturnType<typeof createCalendarService>
  let schoolId: string
  let yearId: string
  let termId: string

  beforeEach(async () => {
    calendar = new FakeCalendarRepository()
    service = createCalendarService({
      repository: calendar,
      now: () => new Date(NOW),
    })
    schoolId = randomUUID()
    calendar.seedSchool({
      schoolId,
      schoolName: 'Accra Basic School',
      years: [],
    })

    const year = await service.createYear(ACTOR, schoolId, {
      name: '2026/2027',
      startsOn: '2026-09-07',
      endsOn: '2027-03-10',
      activate: true,
      terms: [TERM_ONE],
    })
    yearId = year.id
    termId = year.terms[0]!.id

    const term = calendar.findTerm(schoolId, termId)!
    term.status = 'OPEN'
    term.isCurrent = true
    term.openedAt = new Date('2026-09-07T00:00:00.000Z')
    term.reportsPreparedAt = new Date('2026-12-19T00:00:00.000Z')

    await calendar.recordTransition({
      schoolId,
      academicYearId: yearId,
      academicTermId: termId,
      action: 'OPEN_TERM',
      status: 'COMPLETED',
      trigger: 'SCHEDULER',
      startedAt: new Date('2026-09-07T00:00:00.000Z'),
      completedAt: new Date('2026-09-07T00:00:00.000Z'),
      message: 'Term 1 opened',
    })
  })

  it('corrects configuration in place without deleting years, terms or history', async () => {
    const before = calendar.schools.get(schoolId)!.years[0]!

    const result = await service.resetYear(ACTOR, schoolId, yearId, resetInput())

    const after = calendar.schools.get(schoolId)!.years[0]!

    expect(after.id).toBe(before.id)
    expect(after.terms).toHaveLength(1)
    expect(after.terms[0]!.id).toBe(termId)
    // Lifecycle and report history are untouched by a configuration reset.
    expect(after.terms[0]!.status).toBe('OPEN')
    expect(after.terms[0]!.openedAt).toEqual(
      new Date('2026-09-07T00:00:00.000Z'),
    )
    expect(after.terms[0]!.reportsPreparedAt).toEqual(
      new Date('2026-12-19T00:00:00.000Z'),
    )
    expect(calendar.transitions).toHaveLength(1)
    expect(result.changes).toEqual([])

    expect(calendar.audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'CALENDAR_YEAR_RESET',
          audit: expect.objectContaining({ actorUserId: ACTOR.actorUserId }),
        }),
      ]),
    )
  })

  it('applies corrected dates while preserving every dependent record', async () => {
    const result = await service.resetYear(
      ACTOR,
      schoolId,
      yearId,
      resetInput({
        endsOn: '2027-03-12',
        terms: [
          {
            ...TERM_ONE,
            endsOn: '2026-12-20',
            assessmentDeadline: '2026-11-29',
            examinationEndsOn: '2026-12-20',
          },
        ],
      }),
    )

    expect(result.year.endsOn).toBe('2027-03-12')
    expect(result.year.terms[0]).toMatchObject({
      id: termId,
      endsOn: '2026-12-20',
      assessmentDeadline: '2026-11-29',
      examinationEndsOn: '2026-12-20',
      status: 'OPEN',
      reportStatus: 'PREPARED',
    })
    expect(result.changes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Academic year closing changed'),
        expect.stringContaining('Term 1 closing changed'),
        expect.stringContaining('assessment deadline changed'),
      ]),
    )
    expect(calendar.schools.get(schoolId)!.years).toHaveLength(1)
  })

  it('never removes a term that is not part of the reset payload', async () => {
    const second = await service.upsertTerm(
      ACTOR,
      schoolId,
      yearId,
      2,
      TERM_TWO,
    )

    const result = await service.resetYear(ACTOR, schoolId, yearId, resetInput())

    expect(result.year.terms.map((term) => term.id)).toEqual(
      expect.arrayContaining([termId, second.id]),
    )
    expect(
      calendar.schools.get(schoolId)!.years[0]!.terms,
    ).toHaveLength(2)
  })

  it('requires explicit acknowledgement', async () => {
    await expectStatus(
      service.resetYear(
        ACTOR,
        schoolId,
        yearId,
        resetInput({ acknowledgeImpacts: false }),
      ),
      400,
    )

    const after = calendar.schools.get(schoolId)!.years[0]!
    expect(after.terms[0]!.endsOn).toBe('2026-12-18')
  })

  it('rejects an invalid configuration without changing anything', async () => {
    await expectStatus(
      service.resetYear(
        ACTOR,
        schoolId,
        yearId,
        resetInput({
          endsOn: '2026-10-01',
        }),
      ),
      400,
    )

    expect(calendar.schools.get(schoolId)!.years[0]!.endsOn).toBe('2027-03-10')
  })

  it('refuses to reset an archived academic year', async () => {
    await service.deactivateYear(ACTOR, schoolId, yearId)
    await service.archiveYear(ACTOR, schoolId, yearId)

    await expectStatus(
      service.resetYear(ACTOR, schoolId, yearId, resetInput()),
      409,
    )
  })
})

describe('safe academic year archiving', () => {
  let calendar: FakeCalendarRepository
  let service: ReturnType<typeof createCalendarService>
  let schoolId: string
  let yearId: string

  beforeEach(async () => {
    calendar = new FakeCalendarRepository()
    service = createCalendarService({
      repository: calendar,
      now: () => new Date(NOW),
    })
    schoolId = randomUUID()
    calendar.seedSchool({
      schoolId,
      schoolName: 'Accra Basic School',
      years: [],
    })
    const year = await service.createYear(ACTOR, schoolId, {
      name: '2025/2026',
      startsOn: '2025-09-01',
      endsOn: '2026-03-06',
      activate: false,
      terms: [
        {
          ...TERM_ONE,
          startsOn: '2025-09-01',
          endsOn: '2025-12-19',
          assessmentDeadline: '2025-11-28',
          examinationStartsOn: '2025-12-05',
          examinationEndsOn: '2025-12-19',
        },
      ],
    })
    yearId = year.id
  })

  it('archives a completed year but keeps it readable', async () => {
    const archived = await service.archiveYear(ACTOR, schoolId, yearId)

    expect(archived.isArchived).toBe(true)
    expect(archived.isCurrent).toBe(false)
    expect(archived.terms).toHaveLength(1)

    const calendarView = await service.getSchoolCalendar(schoolId)
    expect(calendarView.years.find((year) => year.id === yearId)?.isArchived).toBe(
      true,
    )
    expect(calendar.schools.get(schoolId)!.years).toHaveLength(1)
    expect(calendar.audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'CALENDAR_YEAR_ARCHIVED',
          audit: expect.objectContaining({ actorUserId: ACTOR.actorUserId }),
        }),
      ]),
    )
  })

  it('cannot archive the active current year', async () => {
    const current = await service.createYear(ACTOR, schoolId, {
      name: '2026/2027',
      startsOn: '2026-09-07',
      endsOn: '2027-03-10',
      activate: true,
      terms: [TERM_ONE],
    })

    await expectStatus(
      service.archiveYear(ACTOR, schoolId, current.id),
      409,
    )
  })

  it('deactivation preserves term lifecycle and history', async () => {
    const current = await service.createYear(ACTOR, schoolId, {
      name: '2026/2027',
      startsOn: '2026-09-07',
      endsOn: '2027-03-10',
      activate: true,
      terms: [TERM_ONE],
    })
    const term = calendar.findYear(schoolId, current.id)!.terms[0]!
    term.status = 'CLOSED'
    term.reportsPreparedAt = new Date('2026-12-19T00:00:00.000Z')

    const deactivated = await service.deactivateYear(
      ACTOR,
      schoolId,
      current.id,
    )

    expect(deactivated.isCurrent).toBe(false)
    expect(deactivated.terms[0]!.status).toBe('CLOSED')
    expect(deactivated.terms[0]!.reportsPreparedAt).toEqual(
      new Date('2026-12-19T00:00:00.000Z'),
    )
  })
})
