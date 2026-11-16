import type { AuditContext } from '../schools/repository.js'

export type CalendarTermStatus = 'PLANNED' | 'OPEN' | 'CLOSED'

export interface CalendarTermPlan {
  sequence: number
  name: string
  startsOn: string
  endsOn: string
}

export interface AcademicYearPlan {
  name: string
  startsOn: string
  endsOn: string
  terms: CalendarTermPlan[]
}

export type CalendarAction =
  | 'OPEN_TERM'
  | 'PREPARE_REPORTS'
  | 'CLOSE_TERM'
  | 'FINALIZE_YEAR'

export type CalendarTransitionStatus =
  | 'COMPLETED'
  | 'BLOCKED'
  | 'FAILED'

export type CalendarTrigger = 'SCHEDULER' | 'PLATFORM' | 'REGISTRATION'

export type ReportPreparationStatus =
  | 'NOT_PREPARED'
  | 'PREPARED'
  | 'CLOSED'

export interface CalendarTermRecord {
  id: string
  schoolId: string
  academicYearId: string
  name: string
  sequence: number
  startsOn: string
  endsOn: string
  isCurrent: boolean
  status: CalendarTermStatus
  openedAt: Date | null
  closedAt: Date | null
  reportsPreparedAt: Date | null
  /** Explicitly configured milestone; null falls back to the derivation. */
  assessmentDeadline: string | null
  examinationStartsOn: string | null
  examinationEndsOn: string | null
  /** Null means the term is still awaiting platform confirmation. */
  datesConfirmedAt: Date | null
}

export interface CalendarYearRecord {
  id: string
  schoolId: string
  name: string
  startsOn: string
  endsOn: string
  isCurrent: boolean
  isArchived: boolean
  archivedAt: Date | null
  terms: CalendarTermRecord[]
}

export interface SchoolCalendarRecord {
  schoolId: string
  schoolName: string
  timezone: string
  years: CalendarYearRecord[]
}

export interface CalendarTermView
  extends Omit<
    CalendarTermRecord,
    'assessmentDeadline' | 'examinationStartsOn' | 'examinationEndsOn'
  > {
  /** Effective values: the stored explicit date or the legacy derivation. */
  assessmentDeadline: string
  examinationStartsOn: string
  examinationEndsOn: string
  datesConfirmed: boolean
  reportStatus: ReportPreparationStatus
}

export interface CalendarYearView extends Omit<CalendarYearRecord, 'terms'> {
  terms: CalendarTermView[]
}

export interface SchoolCalendarView {
  schoolId: string
  schoolName: string
  timezone: string
  serverDate: string
  currentYear: CalendarYearView | null
  currentTerm: CalendarTermView | null
  nextTerm: CalendarTermView | null
  years: CalendarYearView[]
}

export interface CalendarCompletionGap {
  classId: string
  className: string
  subjectId: string
  subjectName: string
}

export interface CalendarCompletionResult {
  complete: boolean
  requiredCount: number
  acceptedCount: number
  missing: CalendarCompletionGap[]
}

export interface CalendarTransitionRecord {
  id: string
  schoolId: string
  academicYearId: string | null
  academicTermId: string | null
  action: string
  status: string
  trigger: string
  scheduledFor: string | null
  startedAt: Date | null
  completedAt: Date | null
  message: string | null
  metadata: unknown
  createdAt: Date
}

export interface CalendarTransitionInput {
  schoolId: string
  academicYearId?: string | null
  academicTermId?: string | null
  action: string
  status: CalendarTransitionStatus
  trigger: CalendarTrigger
  scheduledFor?: string | null
  startedAt?: Date | null
  completedAt?: Date | null
  message?: string | null
  metadata?: unknown
}

export interface CalendarStepResult {
  action: CalendarAction
  yearId: string
  yearName: string
  termId: string
  termName: string
  status: 'COMPLETED' | 'BLOCKED' | 'FAILED'
  message: string
  startedAt: Date
  completedAt: Date | null
  metadata?: unknown
}

export interface CalendarRunResult {
  schoolId: string
  trigger: CalendarTrigger
  runAt: Date
  status: 'UP_TO_DATE' | 'COMPLETED' | 'BLOCKED' | 'FAILED'
  steps: CalendarStepResult[]
  message?: string
}

export interface ReportPreparationRequest {
  schoolId: string
  academicYearId: string
  academicTermId: string
  termName: string
}

export interface ReportPreparationResult {
  prepared: boolean
  batchId?: string | null
  message?: string | null
}

export type PrepareReports = (
  request: ReportPreparationRequest,
) => Promise<ReportPreparationResult>

export interface CalendarTermDatesInput {
  startsOn: string
  endsOn: string
}

// ---------------------------------------------------------------------------
// Platform calendar management (Phase 2)
// ---------------------------------------------------------------------------

/** A complete, validated term configuration supplied by the platform. */
export interface CalendarTermConfig {
  name: string
  sequence: number
  startsOn: string
  endsOn: string
  assessmentDeadline: string
  examinationStartsOn: string
  examinationEndsOn: string
  datesConfirmed: boolean
}

export interface AcademicYearCreateInput {
  name: string
  startsOn: string
  endsOn: string
  activate: boolean
  terms: CalendarTermConfig[]
}

export interface AcademicYearUpdateInput {
  name: string
  startsOn: string
  endsOn: string
}

export interface CalendarTermUpdateInput {
  name: string
  startsOn: string
  endsOn: string
  assessmentDeadline: string
  examinationStartsOn: string
  examinationEndsOn: string
  datesConfirmed: boolean
}

export interface CalendarResetInput extends AcademicYearUpdateInput {
  terms: CalendarTermConfig[]
  acknowledgeImpacts: boolean
}

export interface ActiveSchoolSummary {
  id: string
  name: string
}

export type ApplySchoolAction = 'CREATED' | 'UPDATED'

export interface ApplySchoolResult {
  action: ApplySchoolAction
  yearId: string
  termCount: number
  warnings: string[]
}

export interface CalendarRepository {
  listActiveSchoolIds(): Promise<string[]>
  listActiveSchools(): Promise<ActiveSchoolSummary[]>
  getSchoolCalendar(schoolId: string): Promise<SchoolCalendarRecord | null>

  /**
   * Idempotently creates an academic year and its three configured terms.
   * Returns true when a new year was created, false when it already existed.
   */
  ensureAcademicYear(
    schoolId: string,
    plan: AcademicYearPlan,
    options?: { today?: string },
  ): Promise<boolean>

  createAcademicYear(
    schoolId: string,
    input: AcademicYearCreateInput,
    audit: AuditContext,
  ): Promise<CalendarYearRecord>

  updateAcademicYear(
    schoolId: string,
    yearId: string,
    input: AcademicYearUpdateInput,
    audit: AuditContext,
  ): Promise<CalendarYearRecord>

  upsertTerm(
    schoolId: string,
    yearId: string,
    sequence: number,
    input: CalendarTermUpdateInput,
    audit: AuditContext,
  ): Promise<CalendarTermRecord>

  activateAcademicYear(
    schoolId: string,
    yearId: string,
    at: Date,
    audit: AuditContext,
  ): Promise<CalendarYearRecord>

  deactivateAcademicYear(
    schoolId: string,
    yearId: string,
    audit: AuditContext,
  ): Promise<CalendarYearRecord>

  archiveAcademicYear(
    schoolId: string,
    yearId: string,
    at: Date,
    audit: AuditContext,
  ): Promise<CalendarYearRecord>

  /** In-place correction. Never deletes a year or term. */
  resetAcademicYear(
    schoolId: string,
    yearId: string,
    input: CalendarResetInput,
    at: Date,
    audit: AuditContext,
  ): Promise<{ year: CalendarYearRecord; changes: string[] }>

  /**
   * Applies an approved configuration to one school inside its own transaction.
   * Existing years and terms are updated in place; lifecycle state is preserved.
   */
  applyAcademicYear(
    schoolId: string,
    config: AcademicYearCreateInput,
    at: Date,
    audit: AuditContext,
  ): Promise<ApplySchoolResult>

  openTerm(schoolId: string, termId: string, at: Date): Promise<void>
  markReportsPrepared(
    schoolId: string,
    termId: string,
    at: Date,
  ): Promise<void>
  closeTerm(schoolId: string, termId: string, at: Date): Promise<void>

  finalizeYear(
    schoolId: string,
    yearId: string,
    nextPlan: AcademicYearPlan,
    at: Date,
  ): Promise<{ nextYearId: string; promotedCount: number }>

  updateTermDates(
    schoolId: string,
    termId: string,
    input: CalendarTermDatesInput,
    audit: AuditContext,
  ): Promise<CalendarTermRecord>

  completion(
    schoolId: string,
    termId: string,
  ): Promise<CalendarCompletionResult>

  hasActivePupils(schoolId: string, termId: string): Promise<boolean>

  findSystemActorUserId(): Promise<string | null>

  recordTransition(input: CalendarTransitionInput): Promise<void>
  listTransitions(
    schoolId: string,
    limit: number,
  ): Promise<CalendarTransitionRecord[]>
}
