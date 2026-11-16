/**
 * Types for Phase 2 platform operations: notifications, health, payment
 * reconciliation, account security and privacy-minimized exports.
 *
 * These types never carry credentials, MFA secrets, password hashes or object
 * storage keys. Anything returned here is safe to serialize to the authenticated
 * platform administrator.
 */

export type PlatformNotificationSeverity =
  | 'INFO'
  | 'SUCCESS'
  | 'WARNING'
  | 'CRITICAL'

export interface PlatformNotificationInput {
  type: string
  severity?: PlatformNotificationSeverity
  title: string
  body?: string | null
  schoolId?: string | null
  entityType?: string | null
  entityId?: string | null
  link?: string | null
  /** Unique when present so a retried job cannot create duplicates. */
  dedupeKey?: string | null
  metadata?: Record<string, unknown> | null
}

export interface PlatformNotificationRecord {
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

export interface PlatformNotificationFilter {
  unreadOnly?: boolean
  severity?: PlatformNotificationSeverity
  type?: string
  schoolId?: string
  search?: string
  limit?: number
  offset?: number
}

export interface PlatformNotificationPage {
  notifications: PlatformNotificationRecord[]
  total: number
  unreadCount: number
  limit: number
  offset: number
}

// ---------------------------------------------------------------------------
// Platform health
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Payment reconciliation
// ---------------------------------------------------------------------------

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

export interface AcknowledgePaymentInput {
  note?: string | null
}

// ---------------------------------------------------------------------------
// Account security
// ---------------------------------------------------------------------------

export interface UserSecurityRecord {
  userId: string
  email: string
  mfaEnabled: boolean
  mfaEnabledAt: string | null
  pendingMfa: boolean
  recoveryCodeCount: number
  lockedUntil: string | null
  failedLoginCount: number
  lastFailedLoginAt: string | null
  lastLoginAt: string | null
}

export interface PlatformSessionRecord {
  id: string
  current: boolean
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
  lastUsedAt: string
  expiresAt: string
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
}

export interface PlatformReauthGrant {
  token: string
  purpose: string
  expiresAt: string
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export type ExportDatasetId =
  | 'schools'
  | 'payments'
  | 'invoices'
  | 'audit'
  | 'notifications'

export interface ExportDatasetDefinition {
  id: ExportDatasetId
  label: string
  description: string
  columns: string[]
}

export interface ExportDatasetResult {
  rows: Array<Record<string, string | number | boolean | null>>
  truncated: boolean
}
