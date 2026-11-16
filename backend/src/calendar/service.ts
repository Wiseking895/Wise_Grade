import { HttpError } from '../errors/http-error.js'
import type { AuditContext } from '../schools/repository.js'
import {
  academicStartYearFor,
  assessmentDeadlineFor,
  buildAcademicYearPlan,
  examinationPeriodFor,
  nextPlanAfter,
  nextTransition,
  reportStatusFor,
  todayInCalendar,
} from './logic.js'
import type {
  CalendarRepository,
  CalendarRunResult,
  CalendarStepResult,
  CalendarTermDatesInput,
  CalendarTermRecord,
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
}

function toTermView(term: CalendarTermRecord): CalendarTermView {
  const examination = examinationPeriodFor(term.endsOn)

  return {
    ...term,
    assessmentDeadline: assessmentDeadlineFor(term.endsOn),
    examinationStartsOn: examination.startsOn,
    examinationEndsOn: examination.endsOn,
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

  return {
    getSchoolCalendar,
    listSchoolCalendars,
    runSchool,
    runAll,
    updateTermDates,
    closeTermNow,
    listTransitions: (schoolId, limit = 50) =>
      repository.listTransitions(schoolId, limit),
  }
}
