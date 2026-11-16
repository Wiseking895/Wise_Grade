import { randomUUID } from 'node:crypto'
import { HttpError } from '../../src/errors/http-error.js'
import {
  initialTermLifecycles,
  todayInCalendar,
} from '../../src/calendar/logic.js'
import type { AuditContext } from '../../src/schools/repository.js'
import type {
  AcademicYearPlan,
  CalendarCompletionResult,
  CalendarRepository,
  CalendarTermDatesInput,
  CalendarTermRecord,
  CalendarTransitionInput,
  CalendarTransitionRecord,
  CalendarYearRecord,
  SchoolCalendarRecord,
} from '../../src/calendar/types.js'

export interface FakeCalendarSeed {
  schoolId: string
  schoolName: string
  timezone?: string
  years?: Array<{
    name: string
    startsOn: string
    endsOn: string
    isCurrent?: boolean
    isArchived?: boolean
    terms: Array<{
      name: string
      sequence: number
      startsOn: string
      endsOn: string
      isCurrent?: boolean
      status?: 'PLANNED' | 'OPEN' | 'CLOSED'
      reportsPreparedAt?: Date | null
    }>
  }>
}

export class FakeCalendarRepository implements CalendarRepository {
  readonly schools = new Map<
    string,
    { schoolName: string; timezone: string; years: CalendarYearRecord[] }
  >()

  readonly transitions: CalendarTransitionRecord[] = []
  readonly completionResults = new Map<string, CalendarCompletionResult>()
  readonly activePupils = new Map<string, boolean>()
  readonly finalizedYears: Array<{
    schoolId: string
    yearId: string
    nextYearId: string
    promotedCount: number
  }> = []

  systemActorUserId: string | null = randomUUID()
  promotedCount = 0

  seedSchool(seed: FakeCalendarSeed): void {
    const years: CalendarYearRecord[] = (seed.years ?? []).map((year) => ({
      id: randomUUID(),
      schoolId: seed.schoolId,
      name: year.name,
      startsOn: year.startsOn,
      endsOn: year.endsOn,
      isCurrent: year.isCurrent ?? false,
      isArchived: year.isArchived ?? false,
      archivedAt: year.isArchived ? new Date() : null,
      terms: year.terms.map((term) => ({
        id: randomUUID(),
        schoolId: seed.schoolId,
        academicYearId: '',
        name: term.name,
        sequence: term.sequence,
        startsOn: term.startsOn,
        endsOn: term.endsOn,
        isCurrent: term.isCurrent ?? false,
        status: term.status ?? 'PLANNED',
        openedAt: term.status === 'OPEN' ? new Date() : null,
        closedAt: term.status === 'CLOSED' ? new Date() : null,
        reportsPreparedAt: term.reportsPreparedAt ?? null,
      })),
    }))

    for (const year of years) {
      for (const term of year.terms) {
        term.academicYearId = year.id
      }
    }

    this.schools.set(seed.schoolId, {
      schoolName: seed.schoolName,
      timezone: seed.timezone ?? 'Africa/Accra',
      years,
    })
  }

  seedPlan(
    schoolId: string,
    plan: AcademicYearPlan,
    options: { isCurrent?: boolean; openTermSequence?: number } = {},
  ): CalendarYearRecord {
    const school = this.requireSchool(schoolId)
    const year: CalendarYearRecord = {
      id: randomUUID(),
      schoolId,
      name: plan.name,
      startsOn: plan.startsOn,
      endsOn: plan.endsOn,
      isCurrent: options.isCurrent ?? false,
      isArchived: false,
      archivedAt: null,
      terms: plan.terms.map((term) => ({
        id: randomUUID(),
        schoolId,
        academicYearId: '',
        name: term.name,
        sequence: term.sequence,
        startsOn: term.startsOn,
        endsOn: term.endsOn,
        isCurrent: term.sequence === options.openTermSequence,
        status:
          term.sequence === options.openTermSequence ? 'OPEN' : 'PLANNED',
        openedAt:
          term.sequence === options.openTermSequence ? new Date() : null,
        closedAt: null,
        reportsPreparedAt: null,
      })),
    }

    for (const term of year.terms) {
      term.academicYearId = year.id
    }

    school.years.push(year)
    return year
  }

  findYear(schoolId: string, yearId: string): CalendarYearRecord | undefined {
    return this.schools
      .get(schoolId)
      ?.years.find((year) => year.id === yearId)
  }

  findTerm(schoolId: string, termId: string): CalendarTermRecord | undefined {
    for (const year of this.schools.get(schoolId)?.years ?? []) {
      const term = year.terms.find((item) => item.id === termId)
      if (term) return term
    }

    return undefined
  }

  setCompletion(termId: string, completion: CalendarCompletionResult): void {
    this.completionResults.set(termId, completion)
  }

  setActivePupils(termId: string, value: boolean): void {
    this.activePupils.set(termId, value)
  }

  async listActiveSchoolIds(): Promise<string[]> {
    return [...this.schools.keys()]
  }

  async getSchoolCalendar(
    schoolId: string,
  ): Promise<SchoolCalendarRecord | null> {
    const school = this.schools.get(schoolId)

    if (!school) {
      return null
    }

    return {
      schoolId,
      schoolName: school.schoolName,
      timezone: school.timezone,
      years: school.years.map((year) => ({
        ...year,
        terms: year.terms.map((term) => ({ ...term })),
      })),
    }
  }

  async ensureAcademicYear(
    schoolId: string,
    plan: AcademicYearPlan,
    options: { today?: string } = {},
  ): Promise<boolean> {
    const school = this.requireSchool(schoolId)

    if (school.years.some((year) => year.name === plan.name)) {
      return false
    }

    const today = options.today ?? todayInCalendar(new Date())
    const lifecycles = initialTermLifecycles(plan, today)
    const containsToday = plan.startsOn <= today && today <= plan.endsOn

    if (containsToday) {
      for (const item of school.years) {
        item.isCurrent = false
      }
    }

    const year: CalendarYearRecord = {
      id: randomUUID(),
      schoolId,
      name: plan.name,
      startsOn: plan.startsOn,
      endsOn: plan.endsOn,
      isCurrent: containsToday,
      isArchived: false,
      archivedAt: null,
      terms: plan.terms.map((term, index) => {
        const lifecycle = lifecycles[index]!

        return {
          id: randomUUID(),
          schoolId,
          academicYearId: '',
          name: term.name,
          sequence: term.sequence,
          startsOn: term.startsOn,
          endsOn: term.endsOn,
          isCurrent: lifecycle.isCurrent,
          status: lifecycle.status,
          openedAt: lifecycle.openedAt ? new Date(`${lifecycle.openedAt}T00:00:00.000Z`) : null,
          closedAt: lifecycle.closedAt ? new Date(`${lifecycle.closedAt}T00:00:00.000Z`) : null,
          reportsPreparedAt: lifecycle.reportsPreparedAt
            ? new Date(`${lifecycle.reportsPreparedAt}T00:00:00.000Z`)
            : null,
        }
      }),
    }

    for (const term of year.terms) {
      term.academicYearId = year.id
    }

    school.years.push(year)
    return true
  }

  async openTerm(schoolId: string, termId: string, at: Date): Promise<void> {
    const term = this.requireTerm(schoolId, termId)
    const year = this.requireYearForTerm(schoolId, termId)

    if (term.status === 'CLOSED') {
      throw new HttpError(409, 'A closed term cannot be reopened')
    }

    const atDate = at.toISOString().slice(0, 10)

    if (atDate < term.startsOn) {
      throw new HttpError(409, 'A term cannot be opened before its opening date')
    }

    for (const item of this.schools.get(schoolId)!.years) {
      item.isCurrent = false
      for (const child of item.terms) {
        child.isCurrent = false
      }
    }

    term.status = 'OPEN'
    term.isCurrent = true
    term.openedAt = term.openedAt ?? at
    year.isCurrent = true
  }

  async markReportsPrepared(
    schoolId: string,
    termId: string,
    at: Date,
  ): Promise<void> {
    const term = this.requireTerm(schoolId, termId)
    term.reportsPreparedAt = term.reportsPreparedAt ?? at
  }

  async closeTerm(schoolId: string, termId: string, at: Date): Promise<void> {
    const term = this.requireTerm(schoolId, termId)

    if (term.status !== 'OPEN' && term.status !== 'CLOSED') {
      throw new HttpError(409, 'Only an open term can be closed')
    }

    term.status = 'CLOSED'
    term.isCurrent = false
    term.closedAt = term.closedAt ?? at
  }

  async finalizeYear(
    schoolId: string,
    yearId: string,
    nextPlan: AcademicYearPlan,
    at: Date,
  ): Promise<{ nextYearId: string; promotedCount: number }> {
    const school = this.requireSchool(schoolId)
    const year = school.years.find((item) => item.id === yearId)

    if (!year) {
      throw new HttpError(404, 'Academic year not found')
    }

    let nextYear = school.years.find((item) => item.name === nextPlan.name)

    if (!nextYear) {
      const lifecycles = initialTermLifecycles(
        nextPlan,
        todayInCalendar(at),
      )

      nextYear = {
        id: randomUUID(),
        schoolId,
        name: nextPlan.name,
        startsOn: nextPlan.startsOn,
        endsOn: nextPlan.endsOn,
        isCurrent: false,
        isArchived: false,
        archivedAt: null,
        terms: nextPlan.terms.map((term, index) => {
          const lifecycle = lifecycles[index]!

          return {
            id: randomUUID(),
            schoolId,
            academicYearId: '',
            name: term.name,
            sequence: term.sequence,
            startsOn: term.startsOn,
            endsOn: term.endsOn,
            isCurrent: lifecycle.isCurrent,
            status: lifecycle.status,
            openedAt: lifecycle.openedAt
              ? new Date(`${lifecycle.openedAt}T00:00:00.000Z`)
              : null,
            closedAt: lifecycle.closedAt
              ? new Date(`${lifecycle.closedAt}T00:00:00.000Z`)
              : null,
            reportsPreparedAt: lifecycle.reportsPreparedAt
              ? new Date(`${lifecycle.reportsPreparedAt}T00:00:00.000Z`)
              : null,
          }
        }),
      }

      for (const term of nextYear.terms) {
        term.academicYearId = nextYear.id
      }

      school.years.push(nextYear)
    }

    if (!year.isArchived) {
      year.isArchived = true
      year.archivedAt = at
      year.isCurrent = false
      nextYear.isCurrent = true
    }

    const promotedCount = this.promotedCount
    this.finalizedYears.push({
      schoolId,
      yearId,
      nextYearId: nextYear.id,
      promotedCount,
    })

    return { nextYearId: nextYear.id, promotedCount }
  }

  async updateTermDates(
    schoolId: string,
    termId: string,
    input: CalendarTermDatesInput,
    _audit: AuditContext,
  ): Promise<CalendarTermRecord> {
    const term = this.requireTerm(schoolId, termId)
    term.startsOn = input.startsOn
    term.endsOn = input.endsOn
    return { ...term }
  }

  async completion(
    schoolId: string,
    termId: string,
  ): Promise<CalendarCompletionResult> {
    this.requireTerm(schoolId, termId)

    return (
      this.completionResults.get(termId) ?? {
        complete: true,
        requiredCount: 0,
        acceptedCount: 0,
        missing: [],
      }
    )
  }

  async hasActivePupils(
    schoolId: string,
    termId: string,
  ): Promise<boolean> {
    this.requireTerm(schoolId, termId)
    return this.activePupils.get(termId) ?? false
  }

  async findSystemActorUserId(): Promise<string | null> {
    return this.systemActorUserId
  }

  async recordTransition(input: CalendarTransitionInput): Promise<void> {
    this.transitions.push({
      id: randomUUID(),
      schoolId: input.schoolId,
      academicYearId: input.academicYearId ?? null,
      academicTermId: input.academicTermId ?? null,
      action: input.action,
      status: input.status,
      trigger: input.trigger,
      scheduledFor: input.scheduledFor ?? null,
      startedAt: input.startedAt ?? null,
      completedAt: input.completedAt ?? null,
      message: input.message ?? null,
      metadata: input.metadata ?? null,
      createdAt: new Date(),
    })
  }

  async listTransitions(
    schoolId: string,
    limit: number,
  ): Promise<CalendarTransitionRecord[]> {
    return this.transitions
      .filter((transition) => transition.schoolId === schoolId)
      .slice(-limit)
      .reverse()
  }

  private requireSchool(schoolId: string) {
    const school = this.schools.get(schoolId)

    if (!school) {
      throw new HttpError(404, 'School calendar not found')
    }

    return school
  }

  private requireTerm(schoolId: string, termId: string): CalendarTermRecord {
    const term = this.findTerm(schoolId, termId)

    if (!term) {
      throw new HttpError(404, 'Academic term not found')
    }

    return term
  }

  private requireYearForTerm(
    schoolId: string,
    termId: string,
  ): CalendarYearRecord {
    const year = this.schools
      .get(schoolId)
      ?.years.find((item) => item.terms.some((term) => term.id === termId))

    if (!year) {
      throw new HttpError(404, 'Academic year not found')
    }

    return year
  }
}
