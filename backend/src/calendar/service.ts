import { HttpError } from '../errors/http-error.js'
import type { AuditContext } from '../schools/repository.js'
import {
  academicStartYearFor,
  buildAcademicYearPlan,
  effectiveMilestones,
  nextPlanAfter,
  nextTransition,
  reportStatusFor,
  todayInCalendar,
} from './logic.js'
import type {
  AcademicYearCreateInput,
  AcademicYearUpdateInput,
  ActiveSchoolSummary,
  CalendarApplyPreview,
  CalendarApplyResult,
  CalendarApplySchoolPreview,
  CalendarApplySchoolResult,
  CalendarAuditActor,
  CalendarRepository,
  CalendarResetInput,
  CalendarRunResult,
  CalendarStepResult,
  CalendarTermConfig,
  CalendarTermDatesInput,
  CalendarTermRecord,
  CalendarTermUpdateInput,
  CalendarTermView,
  CalendarYearRecord,
  CalendarYearView,
  PrepareReports,
  SchoolCalendarRecord,
  SchoolCalendarView,
} from './types.js'

export interface CalendarServiceOptions {
  repository: CalendarRepository
  prepareReports?: PrepareReports
  now?: () => Date
  logger?: (message: string) => void
}

export interface CalendarService {
  getSchoolCalendar(schoolId: string): Promise<SchoolCalendarView>
  listSchoolCalendars(): Promise<SchoolCalendarView[]>
  listEligibleSchools(): Promise<ActiveSchoolSummary[]>
  runSchool(
    schoolId: string,
    trigger?: 'SCHEDULER' | 'PLATFORM',
  ): Promise<CalendarRunResult>
  runAll(): Promise<CalendarRunResult[]>
  updateTermDates(
    actorUserId: string,
    schoolId: string,
    termId: string,
    input: CalendarTermDatesInput,
  ): Promise<CalendarTermView>
  closeTermNow(
    actorUserId: string,
    schoolId: string,
    termId: string,
  ): Promise<{
    closed: boolean
    term: CalendarTermView
    completion: import('./types.js').CalendarCompletionResult
  }>
  listTransitions(
    schoolId: string,
    limit?: number,
  ): Promise<import('./types.js').CalendarTransitionRecord[]>

  createYear(
    actor: CalendarAuditActor,
    schoolId: string,
    input: AcademicYearCreateInput,
  ): Promise<CalendarYearView>
  updateYear(
    actor: CalendarAuditActor,
    schoolId: string,
    yearId: string,
    input: AcademicYearUpdateInput,
  ): Promise<CalendarYearView>
  upsertTerm(
    actor: CalendarAuditActor,
    schoolId: string,
    yearId: string,
    sequence: number,
    input: CalendarTermUpdateInput,
  ): Promise<CalendarTermView>
  activateYear(
    actor: CalendarAuditActor,
    schoolId: string,
    yearId: string,
  ): Promise<CalendarYearView>
  deactivateYear(
    actor: CalendarAuditActor,
    schoolId: string,
    yearId: string,
  ): Promise<CalendarYearView>
  archiveYear(
    actor: CalendarAuditActor,
    schoolId: string,
    yearId: string,
  ): Promise<CalendarYearView>
  resetYear(
    actor: CalendarAuditActor,
    schoolId: string,
    yearId: string,
    input: CalendarResetInput,
  ): Promise<{ year: CalendarYearView; changes: string[] }>
  previewApply(
    actor: CalendarAuditActor,
    sourceSchoolId: string,
    yearId: string,
    schoolIds?: string[],
  ): Promise<CalendarApplyPreview>
  applyCalendar(
    actor: CalendarAuditActor,
    sourceSchoolId: string,
    yearId: string,
    schoolIds?: string[],
  ): Promise<CalendarApplyResult>
}

function toTermView(term: CalendarTermRecord): CalendarTermView {
  const milestones = effectiveMilestones(term)

  return {
    ...term,
    ...milestones,
    datesConfirmed: term.datesConfirmedAt !== null,
    reportStatus: reportStatusFor(term),
  }
}

function toYearView(year: CalendarYearRecord): CalendarYearView {
  return { ...year, terms: year.terms.map(toTermView) }
}

export function buildCalendarView(
  record: SchoolCalendarRecord,
  serverDate: string,
): SchoolCalendarView {
  const years = record.years.map(toYearView)
  const currentYear =
    years.find((year) => year.isCurrent) ??
    years.find(
      (year) =>
        !year.isArchived &&
        year.startsOn <= serverDate &&
        serverDate <= year.endsOn,
    ) ??
    null

  const currentTerm =
    currentYear?.terms.find((term) => term.isCurrent) ??
    currentYear?.terms.find((term) => term.status === 'OPEN') ??
    null

  const nextTerm =
    years
      .filter((year) => !year.isArchived)
      .flatMap((year) => year.terms)
      .filter(
        (term) =>
          term.datesConfirmed &&
          term.status === 'PLANNED' &&
          term.startsOn > serverDate &&
          term.id !== currentTerm?.id,
      )
      .sort((a, b) => a.startsOn.localeCompare(b.startsOn))[0] ?? null

  return {
    schoolId: record.schoolId,
    schoolName: record.schoolName,
    timezone: record.timezone,
    serverDate,
    currentYear,
    currentTerm,
    nextTerm,
    years,
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message.slice(0, 1000)
  }

  return 'Calendar transition failed'
}

export function createCalendarService(
  options: CalendarServiceOptions,
): CalendarService {
  const repository = options.repository
  const prepareReports = options.prepareReports
  const now = options.now ?? (() => new Date())
  const logger = options.logger ?? (() => undefined)

  async function loadCalendar(schoolId: string): Promise<SchoolCalendarRecord> {
    const calendar = await repository.getSchoolCalendar(schoolId)

    if (!calendar) {
      throw new HttpError(404, 'School calendar not found')
    }

    return calendar
  }

  function recordTransition(
    input: Parameters<CalendarRepository['recordTransition']>[0],
  ) {
    return repository.recordTransition(input)
  }

  async function recordStep(
    schoolId: string,
    trigger: 'SCHEDULER' | 'PLATFORM',
    step: CalendarStepResult,
    yearId: string | null,
    termId: string | null,
    scheduledFor: string | null,
    metadata?: unknown,
  ): Promise<void> {
    await recordTransition({
      schoolId,
      academicYearId: yearId,
      academicTermId: termId,
      action: step.action,
      status: step.status,
      trigger,
      scheduledFor,
      startedAt: step.startedAt,
      completedAt: step.completedAt,
      message: step.message,
      metadata,
    })
  }

  async function ensureCurrentYear(
    schoolId: string,
    calendar: SchoolCalendarRecord,
    today: string,
    trigger: 'SCHEDULER' | 'PLATFORM',
  ): Promise<SchoolCalendarRecord> {
    const containing = calendar.years.find(
      (year) =>
        !year.isArchived &&
        year.startsOn <= today &&
        today <= year.endsOn,
    )

    if (containing) {
      return calendar
    }

    const plan = buildAcademicYearPlan(academicStartYearFor(today))
    const created = await repository.ensureAcademicYear(schoolId, plan, {
      today,
    })

    if (created) {
      await recordTransition({
        schoolId,
        action: 'CREATE_ACADEMIC_YEAR',
        status: 'COMPLETED',
        trigger,
        scheduledFor: plan.startsOn,
        startedAt: now(),
        completedAt: now(),
        message: `Initialized ${plan.name} with Term 1, Term 2 and Term 3`,
        metadata: { year: plan.name },
      })
      logger(`[calendar] initialized ${plan.name} for school ${schoolId}`)
    }

    return loadCalendar(schoolId)
  }

  async function getSchoolCalendar(
    schoolId: string,
  ): Promise<SchoolCalendarView> {
    const calendar = await loadCalendar(schoolId)
    return buildCalendarView(calendar, todayInCalendar(now()))
  }

  async function listSchoolCalendars(): Promise<SchoolCalendarView[]> {
    const schoolIds = await repository.listActiveSchoolIds()
    const serverDate = todayInCalendar(now())
    const calendars: SchoolCalendarView[] = []

    for (const schoolId of schoolIds) {
      const calendar = await repository.getSchoolCalendar(schoolId)

      if (calendar) {
        calendars.push(buildCalendarView(calendar, serverDate))
      }
    }

    return calendars
  }

  async function runSchool(
    schoolId: string,
    trigger: 'SCHEDULER' | 'PLATFORM' = 'SCHEDULER',
  ): Promise<CalendarRunResult> {
    const startedAt = now()
    const today = todayInCalendar(startedAt)
    let calendar = await loadCalendar(schoolId)

    calendar = await ensureCurrentYear(schoolId, calendar, today, trigger)

    const attemptedReports = new Set<string>()
    const steps: CalendarStepResult[] = []

    for (let guard = 0; guard < 40; guard += 1) {
      const decision = nextTransition(calendar, today, attemptedReports)

      if (!decision) {
        break
      }

      const stepStartedAt = now()
      const step: CalendarStepResult = {
        action: decision.action,
        yearId: decision.year.id,
        yearName: decision.year.name,
        termId: decision.term.id,
        termName: decision.term.name,
        status: 'COMPLETED',
        message: decision.reason,
        startedAt: stepStartedAt,
        completedAt: null,
      }

      try {
        switch (decision.action) {
          case 'OPEN_TERM': {
            await repository.openTerm(schoolId, decision.term.id, stepStartedAt)
            step.message = `${decision.term.name} opened for ${decision.year.name}`
            break
          }

          case 'PREPARE_REPORTS': {
            attemptedReports.add(decision.term.id)

            if (!(await repository.hasActivePupils(schoolId, decision.term.id))) {
              await repository.markReportsPrepared(
                schoolId,
                decision.term.id,
                stepStartedAt,
              )
              step.message = 'No active pupils; nothing to prepare'
              break
            }

            if (!prepareReports) {
              step.status = 'FAILED'
              step.message = 'Report preparation is not configured'
              step.completedAt = now()
              steps.push(step)
              await recordStep(
                schoolId,
                trigger,
                step,
                decision.year.id,
                decision.term.id,
                decision.term.endsOn,
              )

              return {
                schoolId,
                trigger,
                runAt: startedAt,
                status: 'FAILED',
                steps,
                message: step.message,
              }
            }

            const result = await prepareReports({
              schoolId,
              academicYearId: decision.year.id,
              academicTermId: decision.term.id,
              termName: decision.term.name,
            })

            if (!result.prepared) {
              step.status = 'FAILED'
              step.message =
                result.message ?? 'Report preparation did not complete'
              step.completedAt = now()
              steps.push(step)
              await recordStep(
                schoolId,
                trigger,
                step,
                decision.year.id,
                decision.term.id,
                decision.term.endsOn,
              )

              return {
                schoolId,
                trigger,
                runAt: startedAt,
                status: 'FAILED',
                steps,
                message: step.message,
              }
            }

            await repository.markReportsPrepared(
              schoolId,
              decision.term.id,
              stepStartedAt,
            )
            step.message = result.batchId
              ? `Reports prepared in batch ${result.batchId}`
              : 'Reports prepared'
            break
          }

          case 'CLOSE_TERM': {
            const completion = await repository.completion(
              schoolId,
              decision.term.id,
            )

            if (!completion.complete) {
              step.status = 'BLOCKED'
              step.message = `${decision.term.name} cannot close: ${completion.missing.length} required result submission(s) are not accepted`
              step.completedAt = now()
              steps.push(step)
              await recordStep(
                schoolId,
                trigger,
                step,
                decision.year.id,
                decision.term.id,
                decision.term.endsOn,
                {
                  requiredCount: completion.requiredCount,
                  acceptedCount: completion.acceptedCount,
                  missing: completion.missing,
                },
              )

              return {
                schoolId,
                trigger,
                runAt: startedAt,
                status: 'BLOCKED',
                steps,
                message: step.message,
              }
            }

            await repository.closeTerm(
              schoolId,
              decision.term.id,
              stepStartedAt,
            )
            step.message = `${decision.term.name} closed after completion checks`
            break
          }

          case 'FINALIZE_YEAR': {
            const result = await repository.finalizeYear(
              schoolId,
              decision.year.id,
              nextPlanAfter(decision.year),
              stepStartedAt,
            )
            step.message = `Promoted ${result.promotedCount} pupil(s) and archived ${decision.year.name}`
            step.metadata = result
            break
          }
        }

        step.completedAt = now()
        steps.push(step)
        await recordStep(
          schoolId,
          trigger,
          step,
          decision.year.id,
          decision.term.id,
          decision.term.endsOn,
          step.metadata,
        )
        calendar = await loadCalendar(schoolId)
      } catch (error) {
        const message = errorMessage(error)
        step.status = 'FAILED'
        step.message = message
        step.completedAt = now()
        steps.push(step)

        try {
          await recordStep(
            schoolId,
            trigger,
            step,
            decision.year.id,
            decision.term.id,
            decision.term.endsOn,
          )
        } catch (recordError) {
          logger(
            `[calendar] could not record failed transition for ${schoolId}: ${errorMessage(recordError)}`,
          )
        }

        logger(`[calendar] transition failed for ${schoolId}: ${message}`)

        return {
          schoolId,
          trigger,
          runAt: startedAt,
          status: 'FAILED',
          steps,
          message,
        }
      }
    }

    return {
      schoolId,
      trigger,
      runAt: startedAt,
      status: steps.length > 0 ? 'COMPLETED' : 'UP_TO_DATE',
      steps,
    }
  }

  async function runAll(): Promise<CalendarRunResult[]> {
    const schoolIds = await repository.listActiveSchoolIds()
    const results: CalendarRunResult[] = []

    for (const schoolId of schoolIds) {
      try {
        results.push(await runSchool(schoolId, 'SCHEDULER'))
      } catch (error) {
        const message = errorMessage(error)
        logger(`[calendar] school run failed for ${schoolId}: ${message}`)
        results.push({
          schoolId,
          trigger: 'SCHEDULER',
          runAt: now(),
          status: 'FAILED',
          steps: [],
          message,
        })
      }
    }

    return results
  }

  async function updateTermDates(
    actorUserId: string,
    schoolId: string,
    termId: string,
    input: CalendarTermDatesInput,
  ): Promise<CalendarTermView> {
    const audit: AuditContext = {
      actorUserId,
      ipAddress: null,
      userAgent: 'platform-calendar',
    }

    const term = await repository.updateTermDates(
      schoolId,
      termId,
      input,
      audit,
    )

    await recordTransition({
      schoolId,
      academicYearId: term.academicYearId,
      academicTermId: term.id,
      action: 'TERM_DATES_CORRECTED',
      status: 'COMPLETED',
      trigger: 'PLATFORM',
      scheduledFor: term.startsOn,
      startedAt: now(),
      completedAt: now(),
      message: `${term.name} dates corrected to ${term.startsOn} – ${term.endsOn}`,
      metadata: {
        actorUserId,
        startsOn: term.startsOn,
        endsOn: term.endsOn,
      },
    })

    return toTermView(term)
  }

  async function closeTermNow(
    actorUserId: string,
    schoolId: string,
    termId: string,
  ) {
    const calendar = await loadCalendar(schoolId)
    const year = calendar.years.find((item) =>
      item.terms.some((term) => term.id === termId),
    )
    const term = year?.terms.find((item) => item.id === termId)

    if (!year || !term) {
      throw new HttpError(404, 'Academic term not found')
    }

    if (term.status !== 'OPEN') {
      throw new HttpError(409, 'Only an open term can be closed')
    }

    const completion = await repository.completion(schoolId, termId)

    if (!completion.complete) {
      await recordTransition({
        schoolId,
        academicYearId: year.id,
        academicTermId: term.id,
        action: 'CLOSE_TERM',
        status: 'BLOCKED',
        trigger: 'PLATFORM',
        scheduledFor: term.endsOn,
        startedAt: now(),
        completedAt: now(),
        message: `${term.name} cannot close: required results are incomplete`,
        metadata: {
          actorUserId,
          requiredCount: completion.requiredCount,
          acceptedCount: completion.acceptedCount,
          missing: completion.missing,
        },
      })

      return { closed: false, term: toTermView(term), completion }
    }

    await repository.closeTerm(schoolId, termId, now())
    await recordTransition({
      schoolId,
      academicYearId: year.id,
      academicTermId: term.id,
      action: 'CLOSE_TERM',
      status: 'COMPLETED',
      trigger: 'PLATFORM',
      scheduledFor: term.endsOn,
      startedAt: now(),
      completedAt: now(),
      message: `${term.name} closed by platform administrator`,
      metadata: { actorUserId },
    })

    const updatedCalendar = await loadCalendar(schoolId)
    const updatedYear = updatedCalendar.years.find((item) => item.id === year.id)
    const updatedTerm = updatedYear?.terms.find((item) => item.id === termId)

    if (!updatedTerm) {
      throw new HttpError(404, 'Academic term not found after closing')
    }

    return { closed: true, term: toTermView(updatedTerm), completion }
  }

  function auditFrom(actor: CalendarAuditActor): AuditContext {
    return {
      actorUserId: actor.actorUserId,
      ipAddress: actor.ipAddress ?? null,
      userAgent: actor.userAgent ?? 'platform-calendar',
    }
  }

  function termConfigFromRecord(term: CalendarTermRecord): CalendarTermConfig {
    return {
      name: term.name,
      sequence: term.sequence,
      startsOn: term.startsOn,
      endsOn: term.endsOn,
      ...effectiveMilestones(term),
      datesConfirmed: term.datesConfirmedAt !== null,
    }
  }

  function configForYear(
    calendar: SchoolCalendarRecord,
    yearId: string,
  ): { year: CalendarYearRecord; config: AcademicYearCreateInput } {
    const year = calendar.years.find((item) => item.id === yearId)

    if (!year) {
      throw new HttpError(404, 'Academic year not found')
    }

    return {
      year,
      config: {
        name: year.name,
        startsOn: year.startsOn,
        endsOn: year.endsOn,
        activate: year.isCurrent,
        terms: year.terms.map(termConfigFromRecord),
      },
    }
  }

  async function resolveTargets(
    schoolIds?: string[],
  ): Promise<ActiveSchoolSummary[]> {
    const eligible = await repository.listActiveSchools()

    if (!schoolIds || schoolIds.length === 0) {
      return eligible
    }

    const byId = new Map(eligible.map((school) => [school.id, school]))
    const missing = schoolIds.filter((id) => !byId.has(id))

    if (missing.length > 0) {
      throw new HttpError(
        400,
        'One or more selected schools are not eligible for calendar distribution',
        missing.map((id) => ({ field: 'schoolIds', message: id })),
      )
    }

    const unique = Array.from(new Set(schoolIds))

    return unique.map((id) => byId.get(id)!)
  }

  function previewSchool(
    school: ActiveSchoolSummary,
    calendar: SchoolCalendarRecord | null,
    config: AcademicYearCreateInput,
  ): CalendarApplySchoolPreview {
    const base = {
      schoolId: school.id,
      schoolName: school.name,
      termCount: config.terms.length,
    }

    if (!calendar) {
      return {
        ...base,
        action: 'CREATE',
        changes: [
          `${config.name} will be created with ${config.terms.length} configured term(s)`,
        ],
        warnings: [],
      }
    }

    const existing = calendar.years.find((year) => year.name === config.name)

    if (!existing) {
      return {
        ...base,
        action: 'CREATE',
        changes: [
          `${config.name} will be created with ${config.terms.length} configured term(s)`,
        ],
        warnings: [],
      }
    }

    const changes: string[] = []
    const warnings: string[] = []

    if (existing.isArchived) {
      warnings.push(
        `${config.name} is archived in this school; it remains read-only history.`,
      )
    }

    if (existing.startsOn !== config.startsOn) {
      changes.push(
        `Academic year opening: ${existing.startsOn} → ${config.startsOn}`,
      )
    }
    if (existing.endsOn !== config.endsOn) {
      changes.push(
        `Academic year closing: ${existing.endsOn} → ${config.endsOn}`,
      )
    }

    const termBySequence = new Map(
      existing.terms.map((term) => [term.sequence, term]),
    )
    let termChanges = 0

    for (const termConfig of config.terms) {
      const current = termBySequence.get(termConfig.sequence)

      if (!current) {
        changes.push(`${termConfig.name} will be created`)
        termChanges += 1
        continue
      }

      termBySequence.delete(termConfig.sequence)
      const milestones = effectiveMilestones(current)

      if (current.name !== termConfig.name) {
        changes.push(`${current.name} renamed to ${termConfig.name}`)
        termChanges += 1
      }
      if (current.startsOn !== termConfig.startsOn) {
        changes.push(
          `${termConfig.name} opening: ${current.startsOn} → ${termConfig.startsOn}`,
        )
        termChanges += 1
      }
      if (current.endsOn !== termConfig.endsOn) {
        changes.push(
          `${termConfig.name} closing: ${current.endsOn} → ${termConfig.endsOn}`,
        )
        termChanges += 1
      }
      if (milestones.assessmentDeadline !== termConfig.assessmentDeadline) {
        changes.push(
          `${termConfig.name} assessment deadline: ${milestones.assessmentDeadline} → ${termConfig.assessmentDeadline}`,
        )
        termChanges += 1
      }
      if (milestones.examinationStartsOn !== termConfig.examinationStartsOn) {
        changes.push(
          `${termConfig.name} examination start: ${milestones.examinationStartsOn} → ${termConfig.examinationStartsOn}`,
        )
        termChanges += 1
      }
      if (milestones.examinationEndsOn !== termConfig.examinationEndsOn) {
        changes.push(
          `${termConfig.name} examination end: ${milestones.examinationEndsOn} → ${termConfig.examinationEndsOn}`,
        )
        termChanges += 1
      }

      const currentConfirmed = current.datesConfirmedAt !== null

      if (currentConfirmed !== termConfig.datesConfirmed) {
        changes.push(
          `${termConfig.name} will be marked ${termConfig.datesConfirmed ? 'confirmed' : 'awaiting confirmation'}`,
        )
        termChanges += 1
      }
    }

    for (const preserved of termBySequence.values()) {
      warnings.push(
        `${preserved.name} is not part of the distributed calendar and will be preserved unchanged.`,
      )
    }

    const hasYearChanges =
      existing.startsOn !== config.startsOn ||
      existing.endsOn !== config.endsOn

    return {
      ...base,
      action: hasYearChanges || termChanges > 0 ? 'UPDATE' : 'UNCHANGED',
      changes,
      warnings,
    }
  }

  async function createYear(
    actor: CalendarAuditActor,
    schoolId: string,
    input: AcademicYearCreateInput,
  ): Promise<CalendarYearView> {
    const year = await repository.createAcademicYear(
      schoolId,
      input,
      auditFrom(actor),
    )

    return toYearView(year)
  }

  async function updateYear(
    actor: CalendarAuditActor,
    schoolId: string,
    yearId: string,
    input: AcademicYearUpdateInput,
  ): Promise<CalendarYearView> {
    const year = await repository.updateAcademicYear(
      schoolId,
      yearId,
      input,
      auditFrom(actor),
    )

    return toYearView(year)
  }

  async function upsertTerm(
    actor: CalendarAuditActor,
    schoolId: string,
    yearId: string,
    sequence: number,
    input: CalendarTermUpdateInput,
  ): Promise<CalendarTermView> {
    const term = await repository.upsertTerm(
      schoolId,
      yearId,
      sequence,
      input,
      auditFrom(actor),
    )

    return toTermView(term)
  }

  async function activateYear(
    actor: CalendarAuditActor,
    schoolId: string,
    yearId: string,
  ): Promise<CalendarYearView> {
    const year = await repository.activateAcademicYear(
      schoolId,
      yearId,
      now(),
      auditFrom(actor),
    )

    return toYearView(year)
  }

  async function deactivateYear(
    actor: CalendarAuditActor,
    schoolId: string,
    yearId: string,
  ): Promise<CalendarYearView> {
    const year = await repository.deactivateAcademicYear(
      schoolId,
      yearId,
      auditFrom(actor),
    )

    return toYearView(year)
  }

  async function archiveYear(
    actor: CalendarAuditActor,
    schoolId: string,
    yearId: string,
  ): Promise<CalendarYearView> {
    const year = await repository.archiveAcademicYear(
      schoolId,
      yearId,
      now(),
      auditFrom(actor),
    )

    return toYearView(year)
  }

  async function resetYear(
    actor: CalendarAuditActor,
    schoolId: string,
    yearId: string,
    input: CalendarResetInput,
  ): Promise<{ year: CalendarYearView; changes: string[] }> {
    const result = await repository.resetAcademicYear(
      schoolId,
      yearId,
      input,
      now(),
      auditFrom(actor),
    )

    return { year: toYearView(result.year), changes: result.changes }
  }

  async function previewApply(
    _actor: CalendarAuditActor,
    sourceSchoolId: string,
    yearId: string,
    schoolIds?: string[],
  ): Promise<CalendarApplyPreview> {
    const source = await loadCalendar(sourceSchoolId)
    const { config } = configForYear(source, yearId)
    const targets = await resolveTargets(schoolIds)
    const schools: CalendarApplySchoolPreview[] = []

    for (const school of targets) {
      const calendar = await repository.getSchoolCalendar(school.id)
      schools.push(previewSchool(school, calendar, config))
    }

    return {
      sourceSchoolId,
      sourceSchoolName: source.schoolName,
      yearId,
      yearName: config.name,
      totalSchools: schools.length,
      affectedSchools: schools.filter((school) => school.action !== 'UNCHANGED')
        .length,
      schools,
    }
  }

  async function applyCalendar(
    actor: CalendarAuditActor,
    sourceSchoolId: string,
    yearId: string,
    schoolIds?: string[],
  ): Promise<CalendarApplyResult> {
    const source = await loadCalendar(sourceSchoolId)
    const { config } = configForYear(source, yearId)
    const targets = await resolveTargets(schoolIds)
    const applyAt = now()
    const audit = auditFrom(actor)
    const results: CalendarApplySchoolResult[] = []

    for (const school of targets) {
      try {
        // Each school is its own transaction. A failure is captured per school
        // and never hides the success or failure of another school.
        const applied = await repository.applyAcademicYear(
          school.id,
          config,
          applyAt,
          audit,
        )

        results.push({
          schoolId: school.id,
          schoolName: school.name,
          status: 'SUCCEEDED',
          action: applied.action,
          termCount: applied.termCount,
          warnings: applied.warnings,
        })
      } catch (error) {
        const message = errorMessage(error)
        logger(
          `[calendar] distribution to school ${school.id} failed: ${message}`,
        )
        results.push({
          schoolId: school.id,
          schoolName: school.name,
          status: 'FAILED',
          warnings: [],
          error: message,
        })
      }
    }

    return {
      sourceSchoolId,
      sourceSchoolName: source.schoolName,
      yearId,
      yearName: config.name,
      totalSchools: results.length,
      succeeded: results.filter((result) => result.status === 'SUCCEEDED').length,
      failed: results.filter((result) => result.status === 'FAILED').length,
      results,
    }
  }

  return {
    getSchoolCalendar,
    listSchoolCalendars,
    listEligibleSchools: () => repository.listActiveSchools(),
    runSchool,
    runAll,
    updateTermDates,
    closeTermNow,
    listTransitions: (schoolId, limit = 50) =>
      repository.listTransitions(schoolId, limit),
    createYear,
    updateYear,
    upsertTerm,
    activateYear,
    deactivateYear,
    archiveYear,
    resetYear,
    previewApply,
    applyCalendar,
  }
}
