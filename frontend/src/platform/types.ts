export interface PlatformOverview {
  schools: { total: number; active: number; suspended: number }
  people: { pupils: number; teachers: number; activeUsers: number }
  academics: {
    academicYears: number
    activeTerms: number
    currentTermName: string | null
    currentAcademicYearName: string | null
  }
  reports: {
    prepared: number
    awaitingApproval: number
    approvedAwaitingRelease: number
    released: number
    onHold: number
  }
  payments: {
    awaitingVerification: number
    verifiedCount: number
    verifiedMinor: number
    outstandingMinor: number
    currency: string
  }
  recentActivity: PlatformAuditEntry[]
  generatedAt: string
}

export type PlatformSchoolStatusFilter = 'all' | 'active' | 'suspended'

export interface PlatformSchoolSummary {
  id: string
  name: string
  slug: string
  email: string | null
  phone: string | null
  address: string | null
  landmark: string | null
  timezone: string
  isActive: boolean
  logoUrl: string | null
  createdAt: string
  pupilCount: number
  teacherCount: number
  classCount: number
  currentAcademicYearName: string | null
  currentTermName: string | null
  currentTermStatus: string | null
  outstandingMinor: number
  currency: string
  reportsPrepared: number
  reportsAwaitingRelease: number
  reportsReleased: number
}

export interface PlatformSchoolMember {
  userId: string
  firstName: string
  lastName: string
  email: string
  role: string
  status: string
  joinedAt: string
}

export interface PlatformSchoolClass {
  id: string
  name: string
  level: string | null
  pupilCount: number
}

export interface PlatformSchoolTerm {
  id: string
  name: string
  sequence: number
  status: string
  startsOn: string
  endsOn: string
  isCurrent: boolean
}

export interface PlatformSchoolYear {
  id: string
  name: string
  isCurrent: boolean
  startsOn: string
  endsOn: string
  terms: PlatformSchoolTerm[]
}

export interface PlatformSchoolPayment {
  id: string
  invoiceId: string
  invoiceNumber: string
  termName: string
  academicYearName: string
  method: string
  source: string
  status: string
  amountMinor: number
  currency: string
  paymentReference: string
  paidAt: string
  submittedAt: string
  verifiedAt: string | null
  rejectionReason: string | null
}

export interface PlatformSchoolReportBatch {
  id: string
  academicYearName: string
  termName: string
  className: string | null
  generationStatus: string
  releaseStatus: string
  reportCount: number
  submittedAt: string | null
  releasedAt: string | null
}

export interface PlatformSchoolDetail extends PlatformSchoolSummary {
  profileComplete: boolean
  updatedAt: string
  administrators: PlatformSchoolMember[]
  teachers: PlatformSchoolMember[]
  classes: PlatformSchoolClass[]
  academicYears: PlatformSchoolYear[]
  payments: PlatformSchoolPayment[]
  reportBatches: PlatformSchoolReportBatch[]
}

export interface PlatformSchoolUpdate {
  name?: string
  email?: string | null
  phone?: string | null
  address?: string | null
  landmark?: string | null
}

export type PlatformAuditSource = 'AUDIT_LOG' | 'BILLING' | 'CALENDAR'

export interface PlatformAuditEntry {
  id: string
  source: PlatformAuditSource
  action: string
  entityType: string
  entityId: string | null
  schoolId: string | null
  schoolName: string | null
  actorUserId: string | null
  actorName: string | null
  actorEmail: string | null
  metadata: unknown
  ipAddress: string | null
  createdAt: string
}

export interface PlatformAuditPage {
  entries: PlatformAuditEntry[]
  total: number
  limit: number
  offset: number
}

export interface PlatformMonitoringSchool {
  schoolId: string
  schoolName: string
  count: number
  detail: string
}

export interface PlatformMonitoringBucket {
  count: number
  schools: PlatformMonitoringSchool[]
}

export interface PlatformMonitoring {
  notSubmitted: PlatformMonitoringBucket
  awaitingReview: PlatformMonitoringBucket
  returnedForCorrection: PlatformMonitoringBucket
  acceptedAwaitingReports: PlatformMonitoringBucket
  reportsAwaitingPayment: PlatformMonitoringBucket
  paymentsAwaitingVerification: PlatformMonitoringBucket
  reportsAwaitingRelease: PlatformMonitoringBucket
  approachingDeadlines: PlatformMonitoringBucket
  incompleteEndOfYear: PlatformMonitoringBucket
  generatedAt: string
}

export interface PlatformSettings {
  supportEmail: string | null
  registrationEnabled: boolean
  updatedAt: string | null
  updatedByName: string | null
  paymentProvider: string | null
  calendarSchedulerEnabled: boolean
}

export interface PlatformAccount {
  id: string
  email: string
  firstName: string
  lastName: string
  isPlatformAdmin: boolean
  isActive: boolean
  lastLoginAt: string | null
  createdAt: string
  updatedAt: string
}

export type PlatformAccountRole =
  | 'PLATFORM_SUPER_ADMIN'
  | 'SCHOOL_ADMIN'
  | 'CLASS_TEACHER'
  | 'SUBJECT_TEACHER'
  | 'NO_SCHOOL_MEMBERSHIP'

export type PlatformAccountRoleFilter = 'all' | PlatformAccountRole
export type PlatformAccountStatusFilter =
  | 'all'
  | 'active'
  | 'suspended'
  | 'deleted'

export interface PlatformManagedAccount {
  id: string
  firstName: string
  lastName: string
  email: string
  role: PlatformAccountRole
  isPlatformAdmin: boolean
  isActive: boolean
  deletedAt: string | null
  schoolId: string | null
  schoolName: string | null
  lastLoginAt: string | null
  createdAt: string
}

export interface PlatformAccountPage {
  accounts: PlatformManagedAccount[]
  total: number
  limit: number
  offset: number
}

export type PlatformDeletedAccountStatus = 'ARCHIVED' | 'RESTORED'
export type PlatformDeletedAccountStatusFilter =
  | 'all'
  | PlatformDeletedAccountStatus

export interface PlatformDeletedAccount {
  id: string
  userId: string
  firstName: string
  lastName: string
  email: string
  phone: string | null
  role: PlatformAccountRole
  isPlatformAdmin: boolean
  schoolId: string | null
  schoolName: string | null
  memberships: Array<{
    schoolId: string
    schoolName: string
    role: string
    status: string
  }>
  deletedAt: string
  deletedByName: string | null
  deletedByEmail: string | null
  reason: string
  status: PlatformDeletedAccountStatus
  restoredAt: string | null
  restoredByName: string | null
  restoredByEmail: string | null
  restoreReason: string | null
}

export interface PlatformDeletedAccountPage {
  accounts: PlatformDeletedAccount[]
  total: number
  limit: number
  offset: number
}

export interface PlatformRestoreResult {
  account: PlatformDeletedAccount
  restoredUserId: string
  membershipsRestored: false
}


export interface PlatformAccountSession {
  id: string
  current: boolean
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
  lastUsedAt: string
  expiresAt: string
}

export interface PlatformCalendarTerm {
  id: string
  schoolId: string
  name: string
  sequence: number
  startsOn: string
  endsOn: string
  isCurrent: boolean
  status: string
  openedAt: string | null
  closedAt: string | null
  reportsPreparedAt: string | null
  assessmentDeadline: string
  examinationStartsOn: string
  examinationEndsOn: string
  datesConfirmedAt: string | null
  datesConfirmed: boolean
  reportStatus: string
}

export interface PlatformCalendarTermConfig {
  name: string
  sequence: number
  startsOn: string
  endsOn: string
  assessmentDeadline: string
  examinationStartsOn: string
  examinationEndsOn: string
  datesConfirmed: boolean
}

export interface PlatformCalendarTermUpdate
  extends Omit<PlatformCalendarTermConfig, 'sequence'> {
  acknowledgeImpacts?: boolean
}

export interface PlatformAcademicYearCreateInput {
  name: string
  startsOn: string
  endsOn: string
  activate: boolean
  terms: PlatformCalendarTermConfig[]
}

export interface PlatformAcademicYearUpdateInput {
  name: string
  startsOn: string
  endsOn: string
}

export interface PlatformCalendarResetInput
  extends PlatformAcademicYearUpdateInput {
  terms: PlatformCalendarTermConfig[]
  acknowledgeImpacts: boolean
}

export interface PlatformCalendarSchoolSummary {
  id: string
  name: string
}

export interface PlatformCalendarApplyInput {
  sourceSchoolId: string
  yearId: string
  schoolIds?: string[]
}

export interface PlatformCalendarApplySchoolPreview {
  schoolId: string
  schoolName: string
  action: 'CREATE' | 'UPDATE' | 'UNCHANGED'
  termCount: number
  changes: string[]
  warnings: string[]
}

export interface PlatformCalendarApplyPreview {
  sourceSchoolId: string
  sourceSchoolName: string
  yearId: string
  yearName: string
  totalSchools: number
  affectedSchools: number
  schools: PlatformCalendarApplySchoolPreview[]
}

export interface PlatformCalendarApplySchoolResult {
  schoolId: string
  schoolName: string
  status: 'SUCCEEDED' | 'FAILED'
  action?: 'CREATED' | 'UPDATED'
  termCount?: number
  warnings: string[]
  error?: string
}

export interface PlatformCalendarApplyResult {
  sourceSchoolId: string
  sourceSchoolName: string
  yearId: string
  yearName: string
  totalSchools: number
  succeeded: number
  failed: number
  results: PlatformCalendarApplySchoolResult[]
}

export interface PlatformCalendarYear {
  id: string
  schoolId: string
  name: string
  startsOn: string
  endsOn: string
  isCurrent: boolean
  isArchived: boolean
  archivedAt: string | null
  terms: PlatformCalendarTerm[]
}

export interface PlatformSchoolCalendar {
  schoolId: string
  schoolName: string
  timezone: string
  serverDate: string
  currentYear: PlatformCalendarYear | null
  currentTerm: PlatformCalendarTerm | null
  nextTerm: PlatformCalendarTerm | null
  years: PlatformCalendarYear[]
}

export interface PlatformCalendarTransition {
  id: string
  schoolId: string
  academicYearId: string | null
  academicTermId: string | null
  action: string
  status: string
  trigger: string
  scheduledFor: string | null
  startedAt: string | null
  completedAt: string | null
  message: string | null
  metadata: unknown
  createdAt: string
}

// ---------------------------------------------------------------------------
// Platform operations: health, notifications, reconciliation, security
// ---------------------------------------------------------------------------

export type PlatformNotificationSeverity = 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL'

export interface PlatformNotification {
  id: string
  type: string
  severity: PlatformNotificationSeverity
  title: string
  body: string | null
  schoolId: string | null
  schoolName: string | null
  entityType: string | null
  entityId: string | null
  link: string | null
  read: boolean
  readAt: string | null
  metadata: unknown
  createdAt: string
}

export interface PlatformNotificationPage {
  notifications: PlatformNotification[]
  total: number
  unreadCount: number
  limit: number
  offset: number
}

export type HealthStatus =
  | 'ok'
  | 'degraded'
  | 'error'
  | 'not_configured'
  | 'unknown'

export interface HealthCheck {
  id: string
  label: string
  status: HealthStatus
  detail: string
  checkedAt: string
}

export interface SchedulerRunRecord {
  id: string
  trigger: string
  status: string
  startedAt: string
  completedAt: string | null
  durationMs: number | null
  schoolCount: number
  failureCount: number
  message: string | null
}

export interface SchedulerHealth {
  enabled: boolean
  intervalMinutes: number
  lastRun: SchedulerRunRecord | null
  lastSuccessfulRun: SchedulerRunRecord | null
  consecutiveFailures: number
}

export interface MigrationHealth {
  appliedCount: number
  expectedCount: number
  latestApplied: string | null
  latestAppliedAt: string | null
  upToDate: boolean
  pending: string[]
}

export interface PaymentProviderHealth {
  configured: boolean
  provider: string | null
  webhookSecretConfigured: boolean
  lastWebhookAt: string | null
  lastWebhookOutcome: string | null
}

export interface PlatformHealth {
  status: HealthStatus
  checks: HealthCheck[]
  migrations: MigrationHealth
  scheduler: SchedulerHealth
  paymentProvider: PaymentProviderHealth
  generatedAt: string
}

export type ReconciliationIssueCode =
  | 'MISMATCHED_REFERENCE'
  | 'DUPLICATE_PROVIDER_REFERENCE'
  | 'REPEATED_SUBMISSION'
  | 'FAILED_VERIFICATION'
  | 'INCONSISTENT_AMOUNT'
  | 'OVERPAYMENT'
  | 'UNRECONCILED_PAYMENT'
  | 'WRONG_SCHOOL'
  | 'WRONG_TERM'

export type ReconciliationSeverity = 'INFO' | 'WARNING' | 'CRITICAL'

export interface ReconciliationIssue {
  code: ReconciliationIssueCode
  severity: ReconciliationSeverity
  paymentId: string
  schoolId: string
  schoolName: string
  invoiceId: string
  invoiceNumber: string
  invoiceSchoolId: string
  invoiceTermId: string
  paymentReference: string
  providerReference: string | null
  source: string
  method: string
  status: string
  amountMinor: number
  appliedMinor: number
  overpaymentMinor: number
  invoiceTotalMinor: number
  currency: string
  submittedAt: string
  verifiedAt: string | null
  reconciledAt: string | null
  detail: string
}

export interface ReconciliationSummary {
  totalPayments: number
  verifiedPayments: number
  unreconciledVerified: number
  totalIssues: number
  criticalIssues: number
  warningIssues: number
  infoIssues: number
  issueCounts: Partial<Record<ReconciliationIssueCode, number>>
}

export interface ReconciliationPage {
  issues: ReconciliationIssue[]
  summary: ReconciliationSummary
  generatedAt: string
}

export interface PlatformSecurityEvent {
  id: string
  action: string
  entityType: string
  entityId: string | null
  metadata: unknown
  ipAddress: string | null
  createdAt: string
}

export interface PlatformSecurityOverview {
  mfa: {
    enabled: boolean
    enabledAt: string | null
    recoveryCodesRemaining: number
    configured: boolean
    configurationMessage: string | null
  }
  lockout: {
    lockedUntil: string | null
    failedLoginCount: number
    lastFailedLoginAt: string | null
  }
  lastLoginAt: string | null
  failedLogins24h: number
  lockedAccounts: number
  events: PlatformSecurityEvent[]
  sessions: PlatformAccountSession[]
}

export interface ExportDatasetDefinition {
  id: string
  label: string
  description: string
  columns: string[]
}

