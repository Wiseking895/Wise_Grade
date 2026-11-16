import type {
  AcademicYearPlan,
  CalendarAction,
  CalendarTermRecord,
  CalendarYearRecord,
  ReportPreparationStatus,
  SchoolCalendarRecord,
} from './types.js'

/**
 * Wise Grade follows Ghana Mean Time for every calendar decision. Dates are stored
 * as calendar dates (no time component), so date arithmetic is performed in UTC
 * to avoid daylight-saving or host-timezone drift.
 */
export const CALENDAR_TIMEZONE = 'Africa/Accra'

const DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: CALENDAR_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export const TERM_DEFINITIONS = [
  { sequence: 1, name: 'Term 1', startMonth: 9, startDay: 1, endMonth: 12, endDay: 19 },
  { sequence: 2, name: 'Term 2', startMonth: 1, startDay: 6, endMonth: 4, endDay: 3 },
  { sequence: 3, name: 'Term 3', startMonth: 4, startDay: 21, endMonth: 8, endDay: 31 },
] as const

export function todayInCalendar(now: Date = new Date()): string {
  return DATE_FORMATTER.format(now)
}

function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

export function addDays(value: string, days: number): string {
  const date = parseDateOnly(value)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function dateOf(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`
}

/**
 * The Ghanaian academic year starts in September and ends in August of the
 * following calendar year. Term boundaries are centrally configured here so a
 * single change applies to every school.
 */
export function buildAcademicYearPlan(startYear: number): AcademicYearPlan {
  if (!Number.isInteger(startYear) || startYear < 2000 || startYear > 2200) {
    throw new Error('Invalid academic start year')
  }

  const secondYear = startYear + 1

  return {
    name: `${startYear}/${secondYear}`,
    startsOn: dateOf(startYear, 9, 1),
    endsOn: dateOf(secondYear, 8, 31),
    terms: TERM_DEFINITIONS.map((definition) => {
      const startsInSecondYear = definition.sequence !== 1
      const termYear = startsInSecondYear ? secondYear : startYear
      const endYear = definition.sequence === 1 ? startYear : secondYear

      return {
        sequence: definition.sequence,
        name: definition.name,
        startsOn: dateOf(
          termYear,
          definition.startMonth,
          definition.startDay,
        ),
        endsOn: dateOf(endYear, definition.endMonth, definition.endDay),
      }
    }),
  }
}

/** Returns the September start year of the academic year containing a date. */
export function academicStartYearFor(today: string): number {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))

  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new Error('Invalid calendar date')
  }

  return month >= 9 ? year : year - 1
}

export function nextPlanAfter(year: CalendarYearRecord): AcademicYearPlan {
  const parsed = Number(year.name.slice(0, 4))
  const startYear =
    Number.isInteger(parsed) && parsed >= 2000
      ? parsed + 1
      : Number(year.startsOn.slice(0, 4)) + 1

  return buildAcademicYearPlan(startYear)
}

export interface InitialTermLifecycle {
  sequence: number
  status: 'PLANNED' | 'OPEN' | 'CLOSED'
  isCurrent: boolean
  openedAt: string | null
  closedAt: string | null
  reportsPreparedAt: string | null
}

/**
 * Determines the lifecycle state of every term when a calendar is first
 * initialized (registration or the scheduler bootstrapping an existing school).
 *
 * The term containing `today` opens immediately. Earlier terms are recorded as
 * completed history so the scheduler can never re-open Term 1 after a school
 * joins in Term 2 or Term 3. Their report-preparation timestamp is set to the
 * term end because they predate calendar management and have nothing to
 * prepare. Terms that have not started yet remain PLANNED. When `today` falls
 * between terms, no term is current and the next term opens on its own date.
 */
export function initialTermLifecycles(
  plan: AcademicYearPlan,
  today: string,
): InitialTermLifecycle[] {
  const active = plan.terms.find(
    (term) => term.startsOn <= today && today <= term.endsOn,
  )

  return plan.terms.map((term) => {
    if (term.sequence === active?.sequence) {
      return {
        sequence: term.sequence,
        status: 'OPEN',
        isCurrent: true,
        openedAt: today,
        closedAt: null,
        reportsPreparedAt: null,
      }
    }

    if (term.endsOn < today) {
      return {
        sequence: term.sequence,
        status: 'CLOSED',
        isCurrent: false,
        openedAt: term.startsOn,
        closedAt: term.endsOn,
        reportsPreparedAt: term.endsOn,
      }
    }

    return {
      sequence: term.sequence,
      status: 'PLANNED',
      isCurrent: false,
      openedAt: null,
      closedAt: null,
      reportsPreparedAt: null,
    }
  })
}

export function assessmentDeadlineFor(endsOn: string): string {
  return addDays(endsOn, -21)
}

export function examinationPeriodFor(endsOn: string): {
  startsOn: string
  endsOn: string
} {
  return { startsOn: addDays(endsOn, -14), endsOn }
}

export interface CalendarMilestones {
  assessmentDeadline: string
  examinationStartsOn: string
  examinationEndsOn: string
}

/**
 * Resolves a term's milestone dates. Rows created before Phase 2 fall back to
 * the historical derivation, which is exactly what the running system used.
 */
export function effectiveMilestones(term: {
  endsOn: string
  assessmentDeadline: string | null
  examinationStartsOn: string | null
  examinationEndsOn: string | null
}): CalendarMilestones {
  const examination = examinationPeriodFor(term.endsOn)

  return {
    assessmentDeadline:
      term.assessmentDeadline ?? assessmentDeadlineFor(term.endsOn),
    examinationStartsOn:
      term.examinationStartsOn ?? examination.startsOn,
    examinationEndsOn: term.examinationEndsOn ?? examination.endsOn,
  }
}

export interface CalendarValidationIssue {
  field: string
  message: string
}

export interface ValidatableCalendarTerm {
  sequence: number
  name: string
  startsOn: string
  endsOn: string
  assessmentDeadline: string
  examinationStartsOn: string
  examinationEndsOn: string
}

export interface ValidatableCalendar {
  startsOn: string
  endsOn: string
  terms: ValidatableCalendarTerm[]
}

/**
 * Cross-field validation shared by the HTTP schemas, the service and the
 * repository. The repository re-runs it inside the transaction so a concurrent
 * edit cannot bypass the rules.
 */
export function validateCalendarConfiguration(
  input: ValidatableCalendar,
): CalendarValidationIssue[] {
  const issues: CalendarValidationIssue[] = []

  if (input.endsOn <= input.startsOn) {
    issues.push({
      field: 'endsOn',
      message: 'Academic year closing date must be after its opening date',
    })
  }

  if (input.terms.length > 3) {
    issues.push({
      field: 'terms',
      message: 'An academic year can contain at most three terms',
    })
  }

  const sequences = new Set<number>()
  const names = new Set<string>()

  input.terms.forEach((term, index) => {
    const prefix = `terms.${index}`

    if (![1, 2, 3].includes(term.sequence)) {
      issues.push({
        field: `${prefix}.sequence`,
        message: 'Term sequence must be 1, 2 or 3',
      })
    } else if (sequences.has(term.sequence)) {
      issues.push({
        field: `${prefix}.sequence`,
        message: 'Term sequences must be unique within an academic year',
      })
    }
    sequences.add(term.sequence)

    const name = term.name.trim()

    if (name === '') {
      issues.push({
        field: `${prefix}.name`,
        message: 'Term name is required',
      })
    } else if (names.has(name.toLowerCase())) {
      issues.push({
        field: `${prefix}.name`,
        message: 'Term names must be unique within an academic year',
      })
    }
    names.add(name.toLowerCase())

    if (term.endsOn <= term.startsOn) {
      issues.push({
        field: `${prefix}.endsOn`,
        message: 'Term closing date must be after its opening date',
      })
    }

    if (term.startsOn < input.startsOn || term.endsOn > input.endsOn) {
      issues.push({
        field: `${prefix}.startsOn`,
        message: 'Term dates must fall within the academic year',
      })
    }

    if (
      term.assessmentDeadline < term.startsOn ||
      term.assessmentDeadline > term.endsOn
    ) {
      issues.push({
        field: `${prefix}.assessmentDeadline`,
        message: 'Assessment deadline must fall within the term',
      })
    }

    if (term.examinationEndsOn < term.examinationStartsOn) {
      issues.push({
        field: `${prefix}.examinationStartsOn`,
        message:
          'Examination end date must be on or after the examination start date',
      })
    }

    if (
      term.examinationStartsOn < term.startsOn ||
      term.examinationEndsOn > term.endsOn
    ) {
      issues.push({
        field: `${prefix}.examinationStartsOn`,
        message: 'Examination period must fall within the term',
      })
    }
  })

  const ordered = [...input.terms].sort((a, b) =>
    a.startsOn.localeCompare(b.startsOn),
  )

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!
    const current = ordered[index]!

    if (current.startsOn <= previous.endsOn) {
      issues.push({
        field: `terms.${index}.startsOn`,
        message: `Terms cannot overlap: ${previous.name} and ${current.name}`,
      })
    }
  }

  return issues
}

export function reportStatusFor(
  term: CalendarTermRecord,
): ReportPreparationStatus {
  if (term.status === 'CLOSED') {
    return 'CLOSED'
  }

  return term.reportsPreparedAt ? 'PREPARED' : 'NOT_PREPARED'
}

export interface CalendarTransitionDecision {
  action: CalendarAction
  year: CalendarYearRecord
  term: CalendarTermRecord
  reason: string
}

/**
 * Pure transition planner. It only ever returns transitions that are due on the
 * configured calendar date; nothing is opened before its opening date.
 *
 * `attemptedReports` prevents a failing report-generation run from spinning in
 * a tight loop. A term can only close after reports have been prepared and the
 * required result submissions pass the completion check.
 */
export function nextTransition(
  calendar: SchoolCalendarRecord,
  today: string,
  attemptedReports: ReadonlySet<string> = new Set(),
): CalendarTransitionDecision | null {
  const years = [...calendar.years]
    .filter((year) => !year.isArchived)
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn))

  for (const year of years) {
    const terms = [...year.terms].sort((a, b) => a.sequence - b.sequence)

    for (const term of terms) {
      // A term whose dates have not been confirmed by the platform has no
      // official lifecycle yet. It must never be opened, closed or have reports
      // prepared on the strength of provisional dates.
      if (!term.datesConfirmedAt) {
        continue
      }

      if (term.status === 'PLANNED' && today >= term.startsOn) {
        return {
          action: 'OPEN_TERM',
          year,
          term,
          reason: `Term opening date ${term.startsOn} has arrived`,
        }
      }

      if (
        term.reportsPreparedAt === null &&
        today >= term.endsOn &&
        !attemptedReports.has(term.id)
      ) {
        return {
          action: 'PREPARE_REPORTS',
          year,
          term,
          reason: `Term closing date ${term.endsOn} has passed; preparing reports`,
        }
      }

      if (term.status === 'OPEN' && today >= term.endsOn) {
        return {
          action: 'CLOSE_TERM',
          year,
          term,
          reason: `Term closing date ${term.endsOn} has arrived`,
        }
      }

      if (
        term.sequence === 3 &&
        term.status === 'CLOSED' &&
        !year.isArchived &&
        term.reportsPreparedAt !== null &&
        today > year.endsOn
      ) {
        return {
          action: 'FINALIZE_YEAR',
          year,
          term,
          reason: 'Term 3 is complete; promoting pupils and archiving the year',
        }
      }
    }
  }

  return null
}
