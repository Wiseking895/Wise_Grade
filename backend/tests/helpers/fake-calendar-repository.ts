import { randomUUID } from 'node:crypto'
import { HttpError } from '../../src/errors/http-error.js'
import {
  assessmentDeadlineFor,
  examinationPeriodFor,
  initialTermLifecycles,
  todayInCalendar,
  validateCalendarConfiguration,
} from '../../src/calendar/logic.js'
import type { AuditContext } from '../../src/schools/repository.js'
import type {
  AcademicYearCreateInput,
  AcademicYearPlan,
  AcademicYearUpdateInput,
  ActiveSchoolSummary,
  ApplySchoolResult,
  CalendarCompletionResult,
  CalendarRepository,
  CalendarResetInput,
  CalendarTermConfig,
  CalendarTermDatesInput,
  CalendarTermRecord,
  CalendarTermUpdateInput,
  CalendarTransitionInput,
  CalendarTransitionRecord,
  CalendarYearRecord,
  SchoolCalendarRecord,
} from '../../src/calendar/types.js'

export interface FakeCalendarTermSeed {
  name: string
  sequence: number
  startsOn: string
  endsOn: string
  isCurrent?: boolean
  status?: 'PLANNED' | 'OPEN' | 'CLOSED'
  reportsPreparedAt?: Date | null
  assessmentDeadline?: string | null
  examinationStartsOn?: string | null
  examinationEndsOn?: string | null
  datesConfirmed?: boolean
}

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
    terms: FakeCalendarTermSeed[]
  }>
}

export interface FakeCalendarAuditEntry {
  schoolId: string
  action: string
  entityType: 'AcademicYear' | 'AcademicTerm'
  entityId: string | null
  metadata: Record<string, unknown>
  audit: AuditContext
}

interface FakeTermLifecycle {
  status: 'PLANNED' | 'OPEN' | 'CLOSED'
  isCurrent: boolean
  openedAt: Date | null
  closedAt: Date | null
}

function milestonesFor(term: {
  endsOn: string
  assessmentDeadline?: string | null
  examinationStartsOn?: string | null
  examinationEndsOn?: string | null
}): {
  assessmentDeadline: string
  examinationStartsOn: string
  examinationEndsOn: string
} {
  return {
    assessmentDeadline:
      term.assessmentDeadline ?? assessmentDeadlineFor(term.endsOn),
    examinationStartsOn:
      term.examinationStartsOn ??
      examinationPeriodFor(term.endsOn).startsOn,
    examinationEndsOn: term.examinationEndsOn ?? term.endsOn,
  }
}

function termConfigFromRecord(term: CalendarTermRecord): CalendarTermConfig {
  return {
    name: term.name,
    sequence: term.sequence,
    startsOn: term.startsOn,
    endsOn: term.endsOn,
    ...milestonesFor(term),
    datesConfirmed: term.datesConfirmedAt !== null,
  }
}

function plannedLifecycle(): FakeTermLifecycle {
  return {
    status: 'PLANNED',
    isCurrent: false,
    openedAt: null,
    closedAt: null,
  }
}

export class FakeCalendarRepository implements CalendarRepository {
  readonly schools = new Map<
    string,
    { schoolName: string; timezone: string; years: CalendarYearRecord[] }
  >()

  readonly transitions: CalendarTransitionRecord[] = []
  readonly completionResults = new Map<string, CalendarCompletionResult>()
  readonly activePupils = new Map<string, boolean>()
  readonly audits: FakeCalendarAuditEntry[] = []
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
      terms: year.terms.map((term) => {
        const milestones = milestonesFor(term)

        return {
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
          ...milestones,
          datesConfirmedAt:
            term.datesConfirmed === false ? null : new Date(),
        }
      }),
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
        ...milestonesFor(term),
        datesConfirmedAt: new Date(),
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

  async listActiveSchools(): Promise<ActiveSchoolSummary[]> {
    return [...this.schools.entries()]
      .map(([id, school]) => ({ id, name: school.schoolName }))
      .sort((a, b) => a.name.localeCompare(b.name))
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
          openedAt: lifecycle.openedAt
            ? new Date(`${lifecycle.openedAt}T00:00:00.000Z`)
            : null,
          closedAt: lifecycle.closedAt
            ? new Date(`${lifecycle.closedAt}T00:00:00.000Z`)
            : null,
          reportsPreparedAt: lifecycle.reportsPreparedAt
            ? new Date(`${lifecycle.reportsPreparedAt}T00:00:00.000Z`)
            : null,
          ...milestonesFor(term),
          datesConfirmedAt: new Date(),
        }
      }),
    }

    for (const term of year.terms) {
      term.academicYearId = year.id
    }

    school.years.push(year)
    return true
  }

  async createAcademicYear(
    schoolId: string,
    input: AcademicYearCreateInput,
    audit: AuditContext,
  ): Promise<CalendarYearRecord> {
    const school = this.requireSchool(schoolId)
    this.validate(input)

    if (school.years.some((year) => year.name === input.name)) {
      throw new HttpError(
        409,
        `Academic year ${input.name} already exists for this school`,
      )
    }

    const today = todayInCalendar(new Date())

    if (input.activate) {
      for (const year of school.years) {
        year.isCurrent = false
        for (const term of year.terms) {
          term.isCurrent = false
        }
      }
    }

    const year: CalendarYearRecord = {
      id: randomUUID(),
      schoolId,
      name: input.name,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      isCurrent: input.activate,
      isArchived: false,
      archivedAt: null,
      terms: input.terms.map((term) => {
        const lifecycle = input.activate
          ? lifecycleFor(term, today, term.datesConfirmed)
          : plannedLifecycle()

        return this.newTerm(schoolId, '', term, lifecycle)
      }),
    }

    for (const term of year.terms) {
      term.academicYearId = year.id
    }

    school.years.push(year)
    this.recordAudit(schoolId, 'CALENDAR_YEAR_CREATED', 'AcademicYear', year.id, audit)

    return { ...year, terms: year.terms.map((term) => ({ ...term })) }
  }

  async updateAcademicYear(
    schoolId: string,
    yearId: string,
    input: AcademicYearUpdateInput,
    audit: AuditContext,
  ): Promise<CalendarYearRecord> {
    const year = this.requireYear(schoolId, yearId)

    if (year.isArchived) {
      throw new HttpError(
        409,
        'Archived academic years cannot be edited; create a new year instead',
      )
    }

    const school = this.requireSchool(schoolId)

    if (
      school.years.some(
        (item) => item.name === input.name && item.id !== yearId,
      )
    ) {
      throw new HttpError(
        409,
        `Academic year ${input.name} already exists for this school`,
      )
    }

    this.validate({
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      terms: year.terms.map(termConfigFromRecord),
    })

    year.name = input.name
    year.startsOn = input.startsOn
    year.endsOn = input.endsOn
    this.recordAudit(schoolId, 'CALENDAR_YEAR_UPDATED', 'AcademicYear', yearId, audit)

    return { ...year, terms: year.terms.map((term) => ({ ...term })) }
  }

  async upsertTerm(
    schoolId: string,
    yearId: string,
    sequence: number,
    input: CalendarTermUpdateInput,
    audit: AuditContext,
  ): Promise<CalendarTermRecord> {
    const year = this.requireYear(schoolId, yearId)

    if (year.isArchived) {
      throw new HttpError(
        409,
        'Terms of an archived academic year cannot be edited',
      )
    }

    const existing = year.terms.find((term) => term.sequence === sequence)

    if (
      existing &&
      existing.status !== 'PLANNED' &&
      (existing.startsOn !== input.startsOn ||
        existing.endsOn !== input.endsOn) &&
      input.acknowledgeImpacts !== true
    ) {
      throw new HttpError(
        409,
        `${existing.name} is already ${existing.status.toLowerCase()}. Correcting its dates can trigger an immediate scheduler transition; confirm that you understand the impact.`,
      )
    }

    if (
      existing &&
      existing.datesConfirmedAt !== null &&
      !input.datesConfirmed &&
      existing.status !== 'PLANNED'
    ) {
      throw new HttpError(
        409,
        'An opened or closed term cannot be returned to awaiting confirmation',
      )
    }

    const config: CalendarTermConfig = {
      name: input.name,
      sequence,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      assessmentDeadline: input.assessmentDeadline,
      examinationStartsOn: input.examinationStartsOn,
      examinationEndsOn: input.examinationEndsOn,
      datesConfirmed: input.datesConfirmed,
    }

    this.validate({
      startsOn: year.startsOn,
      endsOn: year.endsOn,
      terms: [
        ...year.terms
          .filter((term) => term.sequence !== sequence)
          .map(termConfigFromRecord),
        config,
      ],
    })

    const term = existing
      ? Object.assign(existing, {
          name: config.name,
          startsOn: config.startsOn,
          endsOn: config.endsOn,
          assessmentDeadline: config.assessmentDeadline,
          examinationStartsOn: config.examinationStartsOn,
          examinationEndsOn: config.examinationEndsOn,
          datesConfirmedAt: config.datesConfirmed ? new Date() : null,
        })
      : (() => {
          const created = this.newTerm(
            schoolId,
            yearId,
            config,
            plannedLifecycle(),
          )
          year.terms.push(created)
          return created
        })()

    this.recordAudit(
      schoolId,
      existing ? 'CALENDAR_TERM_UPDATED' : 'CALENDAR_TERM_CREATED',
      'AcademicTerm',
      term.id,
      audit,
    )

    return { ...term }
  }

  async activateAcademicYear(
    schoolId: string,
    yearId: string,
    _at: Date,
    audit: AuditContext,
  ): Promise<CalendarYearRecord> {
    const year = this.requireYear(schoolId, yearId)

    if (year.isArchived) {
      throw new HttpError(409, 'An archived academic year cannot be activated')
    }

    const school = this.requireSchool(schoolId)

    for (const item of school.years) {
      item.isCurrent = false
      for (const term of item.terms) {
        term.isCurrent = false
      }
    }

    year.isCurrent = true
    this.recordAudit(schoolId, 'CALENDAR_YEAR_ACTIVATED', 'AcademicYear', yearId, audit)

    return { ...year, terms: year.terms.map((term) => ({ ...term })) }
  }

  async deactivateAcademicYear(
    schoolId: string,
    yearId: string,
    audit: AuditContext,
  ): Promise<CalendarYearRecord> {
    const year = this.requireYear(schoolId, yearId)

    year.isCurrent = false
    for (const term of year.terms) {
      term.isCurrent = false
    }
    this.recordAudit(schoolId, 'CALENDAR_YEAR_DEACTIVATED', 'AcademicYear', yearId, audit)

    return { ...year, terms: year.terms.map((term) => ({ ...term })) }
  }

  async archiveAcademicYear(
    schoolId: string,
    yearId: string,
    at: Date,
    audit: AuditContext,
  ): Promise<CalendarYearRecord> {
    const year = this.requireYear(schoolId, yearId)

    if (year.isCurrent) {
      throw new HttpError(
        409,
        'Deactivate the current academic year before archiving it',
      )
    }

    year.isArchived = true
    year.archivedAt = year.archivedAt ?? at
    year.isCurrent = false
    this.recordAudit(schoolId, 'CALENDAR_YEAR_ARCHIVED', 'AcademicYear', yearId, audit)

    return { ...year, terms: year.terms.map((term) => ({ ...term })) }
  }

  async resetAcademicYear(
    schoolId: string,
    yearId: string,
    input: CalendarResetInput,
    _at: Date,
    audit: AuditContext,
  ): Promise<{ year: CalendarYearRecord; changes: string[] }> {
    if (!input.acknowledgeImpacts) {
      throw new HttpError(
        400,
        'Resetting calendar configuration requires explicit acknowledgement',
      )
    }

    const year = this.requireYear(schoolId, yearId)

    if (year.isArchived) {
      throw new HttpError(
        409,
        'Archived academic years are read-only and cannot be reset',
      )
    }

    const beforeBySequence = new Map(
      year.terms.map((term) => [term.sequence, termConfigFromRecord(term)]),
    )
    const beforeName = year.name
    const beforeStartsOn = year.startsOn
    const beforeEndsOn = year.endsOn
    const remaining = new Map(
      year.terms.map((term) => [term.sequence, term] as const),
    )

    for (const config of input.terms) {
      remaining.delete(config.sequence)
    }

    this.validate({
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      terms: [
        ...input.terms,
        ...Array.from(remaining.values()).map(termConfigFromRecord),
      ],
    })

    year.name = input.name
    year.startsOn = input.startsOn
    year.endsOn = input.endsOn

    for (const config of input.terms) {
      const existing = year.terms.find(
        (term) => term.sequence === config.sequence,
      )

      if (existing) {
        Object.assign(existing, {
          name: config.name,
          startsOn: config.startsOn,
          endsOn: config.endsOn,
          assessmentDeadline: config.assessmentDeadline,
          examinationStartsOn: config.examinationStartsOn,
          examinationEndsOn: config.examinationEndsOn,
          datesConfirmedAt: config.datesConfirmed ? new Date() : null,
        })
      } else {
        year.terms.push(
          this.newTerm(schoolId, yearId, config, plannedLifecycle()),
        )
      }
    }

    const changes: string[] = []

    if (beforeName !== year.name) {
      changes.push(`Academic year renamed from ${beforeName} to ${year.name}`)
    }
    if (beforeStartsOn !== year.startsOn) {
      changes.push(
        `Academic year opening changed from ${beforeStartsOn} to ${year.startsOn}`,
      )
    }
    if (beforeEndsOn !== year.endsOn) {
      changes.push(
        `Academic year closing changed from ${beforeEndsOn} to ${year.endsOn}`,
      )
    }

    for (const config of input.terms) {
      const previous = beforeBySequence.get(config.sequence)

      if (!previous) {
        changes.push(`${config.name} created`)
        continue
      }

      if (previous.name !== config.name) {
        changes.push(`${previous.name} renamed to ${config.name}`)
      }
      if (previous.startsOn !== config.startsOn) {
        changes.push(
          `${config.name} opening changed from ${previous.startsOn} to ${config.startsOn}`,
        )
      }
      if (previous.endsOn !== config.endsOn) {
        changes.push(
          `${config.name} closing changed from ${previous.endsOn} to ${config.endsOn}`,
        )
      }
      if (previous.assessmentDeadline !== config.assessmentDeadline) {
        changes.push(
          `${config.name} assessment deadline changed from ${previous.assessmentDeadline} to ${config.assessmentDeadline}`,
        )
      }
      if (previous.examinationStartsOn !== config.examinationStartsOn) {
        changes.push(
          `${config.name} examination start changed from ${previous.examinationStartsOn} to ${config.examinationStartsOn}`,
        )
      }
      if (previous.examinationEndsOn !== config.examinationEndsOn) {
        changes.push(
          `${config.name} examination end changed from ${previous.examinationEndsOn} to ${config.examinationEndsOn}`,
        )
      }
      if (previous.datesConfirmed !== config.datesConfirmed) {
        changes.push(
          `${config.name} marked ${config.datesConfirmed ? 'confirmed' : 'awaiting confirmation'}`,
        )
      }
    }

    this.recordAudit(schoolId, 'CALENDAR_YEAR_RESET', 'AcademicYear', yearId, audit)

    return {
      year: { ...year, terms: year.terms.map((term) => ({ ...term })) },
      changes,
    }
  }

  async applyAcademicYear(
    schoolId: string,
    config: AcademicYearCreateInput,
    at: Date,
    audit: AuditContext,
  ): Promise<ApplySchoolResult> {
    const school = this.requireSchool(schoolId)
    this.validate(config)

    const existing = school.years.find((year) => year.name === config.name)
    const today = todayInCalendar(at)

    if (!existing) {
      const containsToday =
        config.startsOn <= today && today <= config.endsOn

      if (containsToday) {
        for (const year of school.years) {
          year.isCurrent = false
          for (const term of year.terms) {
            term.isCurrent = false
          }
        }
      }

      const created: CalendarYearRecord = {
        id: randomUUID(),
        schoolId,
        name: config.name,
        startsOn: config.startsOn,
        endsOn: config.endsOn,
        isCurrent: containsToday,
        isArchived: false,
        archivedAt: null,
        terms: config.terms.map((term) =>
          this.newTerm(
            schoolId,
            '',
            term,
            containsToday
              ? lifecycleFor(term, today, term.datesConfirmed)
              : plannedLifecycle(),
          ),
        ),
      }

      for (const term of created.terms) {
        term.academicYearId = created.id
      }

      school.years.push(created)
      this.recordAudit(
        schoolId,
        'CALENDAR_APPLIED_TO_SCHOOL',
        'AcademicYear',
        created.id,
        audit,
      )

      return {
        action: 'CREATED',
        yearId: created.id,
        termCount: created.terms.length,
        warnings: [],
      }
    }

    const warnings: string[] = []

    if (existing.isArchived) {
      warnings.push(
        'The academic year is archived; its configuration was corrected in place and remains read-only history.',
      )
    }

    const configBySequence = new Map(
      config.terms.map((term) => [term.sequence, term]),
    )

    this.validate({
      startsOn: config.startsOn,
      endsOn: config.endsOn,
      terms: [
        ...config.terms,
        ...existing.terms
          .filter((term) => !configBySequence.has(term.sequence))
          .map(termConfigFromRecord),
      ],
    })

    existing.startsOn = config.startsOn
    existing.endsOn = config.endsOn

    for (const termConfig of config.terms) {
      const current = existing.terms.find(
        (term) => term.sequence === termConfig.sequence,
      )

      if (!current) {
        existing.terms.push(
          this.newTerm(schoolId, existing.id, termConfig, plannedLifecycle()),
        )
        continue
      }

      if (
        current.status !== 'PLANNED' &&
        (current.startsOn !== termConfig.startsOn ||
          current.endsOn !== termConfig.endsOn)
      ) {
        warnings.push(
          `${current.name} is already ${current.status.toLowerCase()}; its dates were corrected without changing its lifecycle or reports.`,
        )
      }

      Object.assign(current, {
        name: termConfig.name,
        startsOn: termConfig.startsOn,
        endsOn: termConfig.endsOn,
        assessmentDeadline: termConfig.assessmentDeadline,
        examinationStartsOn: termConfig.examinationStartsOn,
        examinationEndsOn: termConfig.examinationEndsOn,
        datesConfirmedAt: termConfig.datesConfirmed ? new Date() : null,
      })
    }

    this.recordAudit(
      schoolId,
      'CALENDAR_APPLIED_TO_SCHOOL',
      'AcademicYear',
      existing.id,
      audit,
    )

    return {
      action: 'UPDATED',
      yearId: existing.id,
      termCount: config.terms.length,
      warnings,
    }
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
            ...milestonesFor(term),
            datesConfirmedAt: new Date(),
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

  private newTerm(
    schoolId: string,
    yearId: string,
    config: CalendarTermConfig,
    lifecycle: FakeTermLifecycle,
  ): CalendarTermRecord {
    return {
      id: randomUUID(),
      schoolId,
      academicYearId: yearId,
      name: config.name,
      sequence: config.sequence,
      startsOn: config.startsOn,
      endsOn: config.endsOn,
      isCurrent: lifecycle.isCurrent,
      status: lifecycle.status,
      openedAt: lifecycle.openedAt,
      closedAt: lifecycle.closedAt,
      reportsPreparedAt: null,
      assessmentDeadline: config.assessmentDeadline,
      examinationStartsOn: config.examinationStartsOn,
      examinationEndsOn: config.examinationEndsOn,
      datesConfirmedAt: config.datesConfirmed ? new Date() : null,
    }
  }

  private validate(input: {
    startsOn: string
    endsOn: string
    terms: CalendarTermConfig[]
  }): void {
    const issues = validateCalendarConfiguration(input)

    if (issues.length > 0) {
      throw new HttpError(400, 'Validation failed', issues)
    }
  }

  private recordAudit(
    schoolId: string,
    action: string,
    entityType: 'AcademicYear' | 'AcademicTerm',
    entityId: string | null,
    audit: AuditContext,
  ): void {
    this.audits.push({
      schoolId,
      action,
      entityType,
      entityId,
      metadata: { source: 'PLATFORM' },
      audit,
    })
  }

  private requireSchool(schoolId: string) {
    const school = this.schools.get(schoolId)

    if (!school) {
      throw new HttpError(404, 'School calendar not found')
    }

    return school
  }

  private requireYear(schoolId: string, yearId: string): CalendarYearRecord {
    const year = this.findYear(schoolId, yearId)

    if (!year) {
      throw new HttpError(404, 'Academic year not found')
    }

    return year
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

function lifecycleFor(
  term: CalendarTermConfig,
  today: string,
  confirmed: boolean,
): FakeTermLifecycle {
  if (!confirmed) {
    return plannedLifecycle()
  }

  if (term.startsOn <= today && today <= term.endsOn) {
    return {
      status: 'OPEN',
      isCurrent: true,
      openedAt: new Date(),
      closedAt: null,
    }
  }

  if (term.endsOn < today) {
    return {
      status: 'CLOSED',
      isCurrent: false,
      openedAt: new Date(`${term.startsOn}T00:00:00.000Z`),
      closedAt: new Date(`${term.endsOn}T00:00:00.000Z`),
    }
  }

  return plannedLifecycle()
}
