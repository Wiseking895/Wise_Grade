import { describe, expect, it } from 'vitest'
import {
  academicStartYearFor,
  assessmentDeadlineFor,
  buildAcademicYearPlan,
  examinationPeriodFor,
  initialTermLifecycles,
  nextPlanAfter,
  nextTransition,
  todayInCalendar,
} from '../src/calendar/logic.js'
import type {
  CalendarTermRecord,
  SchoolCalendarRecord,
} from '../src/calendar/types.js'

const SCHOOL_ID = '00000000-0000-4000-8000-000000000001'

function term(
  overrides: Partial<CalendarTermRecord> &
    Pick<CalendarTermRecord, 'id' | 'sequence' | 'startsOn' | 'endsOn'>,
): CalendarTermRecord {
  return {
    schoolId: SCHOOL_ID,
    academicYearId: 'year-1',
    name: `Term ${overrides.sequence}`,
    isCurrent: false,
    status: 'PLANNED',
    openedAt: null,
    closedAt: null,
    reportsPreparedAt: null,
    ...overrides,
  }
}

function calendar(terms: CalendarTermRecord[]): SchoolCalendarRecord {
  return {
    schoolId: SCHOOL_ID,
    schoolName: 'Accra Basic School',
    timezone: 'Africa/Accra',
    years: [
      {
        id: 'year-1',
        schoolId: SCHOOL_ID,
        name: '2026/2027',
        startsOn: '2026-09-01',
        endsOn: '2027-08-31',
        isCurrent: true,
        isArchived: false,
        archivedAt: null,
        terms,
      },
    ],
  }
}

describe('academic calendar configuration', () => {
  it('uses Africa/Accra when determining today', () => {
    expect(todayInCalendar(new Date('2026-11-09T23:30:00.000Z'))).toBe(
      '2026-11-09',
    )
  })

  it('builds a September-to-August year with three fixed terms', () => {
    const plan = buildAcademicYearPlan(2026)

    expect(plan).toEqual({
      name: '2026/2027',
      startsOn: '2026-09-01',
      endsOn: '2027-08-31',
      terms: [
        {
          sequence: 1,
          name: 'Term 1',
          startsOn: '2026-09-01',
          endsOn: '2026-12-19',
        },
        {
          sequence: 2,
          name: 'Term 2',
          startsOn: '2027-01-06',
          endsOn: '2027-04-03',
        },
        {
          sequence: 3,
          name: 'Term 3',
          startsOn: '2027-04-21',
          endsOn: '2027-08-31',
        },
      ],
    })
  })

  it('maps calendar dates onto the correct academic start year', () => {
    expect(academicStartYearFor('2026-08-31')).toBe(2025)
    expect(academicStartYearFor('2026-09-01')).toBe(2026)
    expect(academicStartYearFor('2027-01-15')).toBe(2026)
  })

  it('derives assessment and examination windows from the term close', () => {
    expect(assessmentDeadlineFor('2026-12-19')).toBe('2026-11-28')
    expect(examinationPeriodFor('2026-12-19')).toEqual({
      startsOn: '2026-12-05',
      endsOn: '2026-12-19',
    })
  })

  it('builds the next year plan from the current year name', () => {
    const plan = buildAcademicYearPlan(2026)
    const next = nextPlanAfter({
      id: 'year-1',
      schoolId: SCHOOL_ID,
      name: plan.name,
      startsOn: plan.startsOn,
      endsOn: plan.endsOn,
      isCurrent: true,
      isArchived: false,
      archivedAt: null,
      terms: [],
    })

    expect(next.name).toBe('2027/2028')
    expect(next.startsOn).toBe('2027-09-01')
  })
})

describe('initial calendar lifecycle', () => {
  it('opens only the term containing today and records earlier terms as history', () => {
    const plan = buildAcademicYearPlan(2026)

    expect(initialTermLifecycles(plan, '2027-01-15')).toEqual([
      {
        sequence: 1,
        status: 'CLOSED',
        isCurrent: false,
        openedAt: '2026-09-01',
        closedAt: '2026-12-19',
        reportsPreparedAt: '2026-12-19',
      },
      {
        sequence: 2,
        status: 'OPEN',
        isCurrent: true,
        openedAt: '2027-01-15',
        closedAt: null,
        reportsPreparedAt: null,
      },
      {
        sequence: 3,
        status: 'PLANNED',
        isCurrent: false,
        openedAt: null,
        closedAt: null,
        reportsPreparedAt: null,
      },
    ])
  })

  it('leaves no term open when initialization falls between terms', () => {
    const plan = buildAcademicYearPlan(2026)
    const lifecycles = initialTermLifecycles(plan, '2026-12-25')

    expect(lifecycles.map((term) => term.status)).toEqual([
      'CLOSED',
      'PLANNED',
      'PLANNED',
    ])
    expect(lifecycles.some((term) => term.isCurrent)).toBe(false)
  })

  it('opens Term 1 on the first day of the academic year', () => {
    const plan = buildAcademicYearPlan(2026)

    expect(initialTermLifecycles(plan, '2026-09-01')[0]).toMatchObject({
      status: 'OPEN',
      isCurrent: true,
      openedAt: '2026-09-01',
    })
  })
})

describe('automatic transition planning', () => {
  it('never opens a term before its configured opening date', () => {
    const record = calendar([
      term({
        id: 'term-1',
        sequence: 1,
        startsOn: '2026-09-01',
        endsOn: '2026-12-19',
      }),
    ])

    expect(nextTransition(record, '2026-08-31')).toBeNull()
    expect(nextTransition(record, '2026-09-01')).toMatchObject({
      action: 'OPEN_TERM',
      term: { id: 'term-1' },
    })
  })

  it('prepares reports at the closing date before closing the term', () => {
    const record = calendar([
      term({
        id: 'term-1',
        sequence: 1,
        startsOn: '2026-09-01',
        endsOn: '2026-12-19',
        status: 'OPEN',
        isCurrent: true,
      }),
    ])

    expect(nextTransition(record, '2026-12-19')).toMatchObject({
      action: 'PREPARE_REPORTS',
    })

    record.years[0]!.terms[0]!.reportsPreparedAt = new Date()

    expect(nextTransition(record, '2026-12-19')).toMatchObject({
      action: 'CLOSE_TERM',
    })
  })

  it('does not loop on a failed report preparation', () => {
    const record = calendar([
      term({
        id: 'term-1',
        sequence: 1,
        startsOn: '2026-09-01',
        endsOn: '2026-12-19',
        status: 'OPEN',
        isCurrent: true,
      }),
    ])

    expect(
      nextTransition(record, '2026-12-19', new Set(['term-1'])),
    ).toMatchObject({ action: 'CLOSE_TERM' })
  })

  it('finalizes the year only after Term 3 has closed and reports exist', () => {
    const record = calendar([
      term({
        id: 'term-3',
        sequence: 3,
        startsOn: '2027-04-21',
        endsOn: '2027-08-31',
        status: 'CLOSED',
      }),
    ])

    expect(nextTransition(record, '2027-09-01')).toMatchObject({
      action: 'PREPARE_REPORTS',
    })

    record.years[0]!.terms[0]!.reportsPreparedAt = new Date()

    expect(nextTransition(record, '2027-09-01')).toMatchObject({
      action: 'FINALIZE_YEAR',
    })
  })

  it('never finalizes or promotes pupils before the academic year ends', () => {
    const record = calendar([
      term({
        id: 'term-3',
        sequence: 3,
        startsOn: '2027-04-21',
        endsOn: '2027-08-31',
        status: 'CLOSED',
        reportsPreparedAt: new Date(),
      }),
    ])

    expect(nextTransition(record, '2027-08-30')).toBeNull()
    expect(nextTransition(record, '2027-08-31')).toBeNull()
    expect(nextTransition(record, '2027-09-01')).toMatchObject({
      action: 'FINALIZE_YEAR',
    })
  })

  it('never returns transitions for an archived historical year', () => {
    const record = calendar([
      term({
        id: 'term-1',
        sequence: 1,
        startsOn: '2026-09-01',
        endsOn: '2026-12-19',
      }),
    ])
    record.years[0]!.isArchived = true
    record.years[0]!.isCurrent = false

    expect(nextTransition(record, '2026-12-20')).toBeNull()
  })
})
