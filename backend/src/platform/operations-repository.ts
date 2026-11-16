import type {
  AcknowledgePaymentInput,
  ExportDatasetId,
  ExportDatasetResult,
  PlatformNotificationFilter,
  PlatformNotificationInput,
  PlatformNotificationPage,
  PlatformNotificationRecord,
  PlatformSecurityEvent,
  PlatformSessionRecord,
  ReconciliationPage,
  ReconciliationIssue,
  SchedulerRunRecord,
  UserSecurityRecord,
} from './operations-types.js'

export interface SchedulerRunInput {
  trigger?: string
  status: string
  startedAt: Date
  completedAt?: Date | null
  durationMs?: number | null
  schoolCount?: number
  failureCount?: number
  message?: string | null
  metadata?: Record<string, unknown> | null
}

export interface CreateReauthGrantInput {
  userId: string
  tokenHash: string
  purpose: string
  expiresAt: Date
}

export interface AuditEntry {
  schoolId?: string | null
  actorUserId?: string | null
  action: string
  entityType: string
  entityId?: string | null
  metadata?: Record<string, unknown> | null
  ipAddress?: string | null
  userAgent?: string | null
}

/**
 * Persistence boundary for Phase 2 platform operations. It is deliberately
 * separate from `PlatformRepository` so existing overview/schools/audit fakes
 * do not need to grow every operational method.
 */
export interface PlatformOperationsRepository {
  // Notifications -----------------------------------------------------------
  createNotification(
    input: PlatformNotificationInput,
  ): Promise<PlatformNotificationRecord | null>

  listNotifications(
    filter: PlatformNotificationFilter,
  ): Promise<PlatformNotificationPage>

  markNotificationRead(
    notificationId: string,
    userId: string,
  ): Promise<PlatformNotificationRecord | null>

  markAllNotificationsRead(userId: string): Promise<number>

  unreadNotificationCount(): Promise<number>

  // Scheduler ---------------------------------------------------------------
  recordSchedulerRun(input: SchedulerRunInput): Promise<void>
  listSchedulerRuns(limit: number): Promise<SchedulerRunRecord[]>
  lastSuccessfulSchedulerRun(): Promise<SchedulerRunRecord | null>

  // Reconciliation ----------------------------------------------------------
  reconciliation(): Promise<ReconciliationPage>
  acknowledgePayment(
    paymentId: string,
    input: AcknowledgePaymentInput,
    actorUserId: string,
    audit: { ipAddress?: string | null; userAgent?: string | null },
  ): Promise<ReconciliationIssue>

  // Security ----------------------------------------------------------------
  findUserSecurity(userId: string): Promise<UserSecurityRecord | null>
  /** Internal-only secrets used to verify MFA; never serialized to a client. */
  getMfaSecrets(userId: string): Promise<{
    enabled: boolean
    secret: string | null
    pendingSecret: string | null
    recoveryCodeHashes: string[]
  } | null>
  setMfaPendingSecret(userId: string, encryptedSecret: string | null): Promise<void>
  enableMfa(
    userId: string,
    encryptedSecret: string,
    recoveryCodeHashes: string[],
    enabledAt: Date,
  ): Promise<void>
  disableMfa(userId: string): Promise<void>
  updateRecoveryCodes(userId: string, hashes: string[]): Promise<void>
  consumeRecoveryCode(userId: string, codeHash: string): Promise<boolean>
  createReauthGrant(input: CreateReauthGrantInput): Promise<void>
  consumeReauthGrant(input: {
    userId: string
    tokenHash: string
    purpose: string
    now: Date
  }): Promise<boolean>
  listSessions(userId: string): Promise<PlatformSessionRecord[]>
  revokeSession(userId: string, sessionId: string): Promise<boolean>
  listSecurityEvents(userId: string, limit: number): Promise<PlatformSecurityEvent[]>
  countFailedLoginsSince(userId: string, since: Date): Promise<number>
  countLockedAccounts(now: Date): Promise<number>

  // Exports -----------------------------------------------------------------
  exportDataset(
    dataset: ExportDatasetId,
    options?: { limit?: number },
  ): Promise<ExportDatasetResult>

  // Audit -------------------------------------------------------------------
  recordAudit(entry: AuditEntry): Promise<void>
}

export type { PlatformSessionRecord }
