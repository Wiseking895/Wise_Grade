import type {
  AuditEntry,
  CreateReauthGrantInput,
  PlatformOperationsRepository,
  SchedulerRunInput,
} from '../../src/platform/operations-repository.js'
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
  ReconciliationIssue,
  ReconciliationPage,
  SchedulerRunRecord,
  UserSecurityRecord,
} from '../../src/platform/operations-types.js'

function emptySummary() {
  return {
    totalPayments: 0,
    verifiedPayments: 0,
    unreconciledVerified: 0,
    totalIssues: 0,
    criticalIssues: 0,
    warningIssues: 0,
    infoIssues: 0,
    issueCounts: {},
  }
}

export class FakeOperationsRepository implements PlatformOperationsRepository {
  readonly notifications: PlatformNotificationRecord[] = []
  readonly schoolNames = new Map<string, string>()
  readonly audits: AuditEntry[] = []
  readonly schedulerRuns: SchedulerRunRecord[] = []
  readonly security = new Map<string, UserSecurityRecord>()
  readonly mfa = new Map<
    string,
    {
      enabled: boolean
      secret: string | null
      pendingSecret: string | null
      recoveryCodeHashes: string[]
    }
  >()
  readonly grants = new Map<
    string,
    { userId: string; purpose: string; expiresAt: Date; used: boolean }
  >()
  readonly sessions: PlatformSessionRecord[] = []
  readonly events: PlatformSecurityEvent[] = []
  readonly eventOwners = new Map<string, string>()
  readonly exportRows = new Map<ExportDatasetId, ExportDatasetResult>()

  reconciliationPage: ReconciliationPage = {
    issues: [],
    summary: emptySummary(),
    generatedAt: new Date().toISOString(),
  }

  failedLogins = 0
  lockedAccounts = 0

  private notificationSequence = 0
  private schedulerSequence = 0
  private eventSequence = 0
  private dedupe = new Map<string, string>()

  async createNotification(
    input: PlatformNotificationInput,
  ): Promise<PlatformNotificationRecord | null> {
    if (input.dedupeKey) {
      const existingId = this.dedupe.get(input.dedupeKey)

      if (existingId) {
        return (
          this.notifications.find((item) => item.id === existingId) ?? null
        )
      }
    }

    const id = `notification-${++this.notificationSequence}`
    const record: PlatformNotificationRecord = {
      id,
      type: input.type,
      severity: input.severity ?? 'INFO',
      title: input.title,
      body: input.body ?? null,
      schoolId: input.schoolId ?? null,
      schoolName: input.schoolId
        ? (this.schoolNames.get(input.schoolId) ?? null)
        : null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      link: input.link ?? null,
      read: false,
      readAt: null,
      metadata: input.metadata ?? null,
      createdAt: new Date().toISOString(),
    }

    this.notifications.unshift(record)

    if (input.dedupeKey) {
      this.dedupe.set(input.dedupeKey, id)
    }

    return record
  }

  async listNotifications(
    filter: PlatformNotificationFilter,
  ): Promise<PlatformNotificationPage> {
    const limit = Math.min(Math.max(filter.limit ?? 25, 1), 100)
    const offset = Math.max(filter.offset ?? 0, 0)
    const search = filter.search?.toLowerCase()

    const filtered = this.notifications.filter((notification) => {
      if (filter.unreadOnly && notification.read) return false
      if (filter.severity && notification.severity !== filter.severity) {
        return false
      }
      if (filter.type && notification.type !== filter.type) return false
      if (filter.schoolId && notification.schoolId !== filter.schoolId) {
        return false
      }
      if (search) {
        const haystack = `${notification.title} ${notification.body ?? ''}`
        if (!haystack.toLowerCase().includes(search)) return false
      }
      return true
    })

    return {
      notifications: filtered.slice(offset, offset + limit),
      total: filtered.length,
      unreadCount: this.notifications.filter((item) => !item.read).length,
      limit,
      offset,
    }
  }

  async markNotificationRead(
    notificationId: string,
    _userId: string,
  ): Promise<PlatformNotificationRecord | null> {
    const notification = this.notifications.find(
      (item) => item.id === notificationId,
    )

    if (!notification) return null

    if (!notification.read) {
      notification.read = true
      notification.readAt = new Date().toISOString()
    }

    return notification
  }

  async markAllNotificationsRead(_userId: string): Promise<number> {
    let updated = 0

    for (const notification of this.notifications) {
      if (!notification.read) {
        notification.read = true
        notification.readAt = new Date().toISOString()
        updated += 1
      }
    }

    return updated
  }

  async unreadNotificationCount(): Promise<number> {
    return this.notifications.filter((item) => !item.read).length
  }

  async recordSchedulerRun(input: SchedulerRunInput): Promise<void> {
    this.schedulerRuns.unshift({
      id: `scheduler-${++this.schedulerSequence}`,
      trigger: input.trigger ?? 'SCHEDULER',
      status: input.status,
      startedAt: input.startedAt.toISOString(),
      completedAt: input.completedAt?.toISOString() ?? null,
      durationMs: input.durationMs ?? null,
      schoolCount: input.schoolCount ?? 0,
      failureCount: input.failureCount ?? 0,
      message: input.message ?? null,
    })
  }

  async listSchedulerRuns(limit: number): Promise<SchedulerRunRecord[]> {
    return this.schedulerRuns.slice(0, Math.min(Math.max(limit, 1), 50))
  }

  async lastSuccessfulSchedulerRun(): Promise<SchedulerRunRecord | null> {
    return (
      this.schedulerRuns.find((run) => run.status === 'COMPLETED') ?? null
    )
  }

  async reconciliation(): Promise<ReconciliationPage> {
    return this.reconciliationPage
  }

  async acknowledgePayment(
    paymentId: string,
    input: AcknowledgePaymentInput,
    actorUserId: string,
    audit: { ipAddress?: string | null; userAgent?: string | null },
  ): Promise<ReconciliationIssue> {
    const issue = this.reconciliationPage.issues.find(
      (item) => item.paymentId === paymentId,
    )

    if (!issue) {
      throw Object.assign(new Error('Payment not found'), { code: 'NOT_FOUND' })
    }

    issue.reconciledAt = new Date().toISOString()
    await this.recordAudit({
      actorUserId,
      action: 'PLATFORM_PAYMENT_RECONCILED',
      entityType: 'Payment',
      entityId: paymentId,
      metadata: { note: input.note ?? null },
      ipAddress: audit.ipAddress ?? null,
      userAgent: audit.userAgent ?? null,
    })

    return issue
  }

  async findUserSecurity(userId: string): Promise<UserSecurityRecord | null> {
    return this.security.get(userId) ?? null
  }

  async getMfaSecrets(userId: string) {
    return this.mfa.get(userId) ?? null
  }

  async setMfaPendingSecret(
    userId: string,
    encryptedSecret: string | null,
  ): Promise<void> {
    const current = this.mfa.get(userId) ?? {
      enabled: false,
      secret: null,
      pendingSecret: null,
      recoveryCodeHashes: [],
    }

    this.mfa.set(userId, { ...current, pendingSecret: encryptedSecret })
  }

  async enableMfa(
    userId: string,
    encryptedSecret: string,
    recoveryCodeHashes: string[],
    enabledAt: Date,
  ): Promise<void> {
    this.mfa.set(userId, {
      enabled: true,
      secret: encryptedSecret,
      pendingSecret: null,
      recoveryCodeHashes: [...recoveryCodeHashes],
    })

    const security = this.security.get(userId)
    if (security) {
      security.mfaEnabled = true
      security.mfaEnabledAt = enabledAt.toISOString()
      security.recoveryCodeCount = recoveryCodeHashes.length
    }
  }

  async disableMfa(userId: string): Promise<void> {
    this.mfa.set(userId, {
      enabled: false,
      secret: null,
      pendingSecret: null,
      recoveryCodeHashes: [],
    })

    const security = this.security.get(userId)
    if (security) {
      security.mfaEnabled = false
      security.mfaEnabledAt = null
      security.recoveryCodeCount = 0
    }
  }

  async updateRecoveryCodes(
    userId: string,
    hashes: string[],
  ): Promise<void> {
    const current = this.mfa.get(userId)
    if (current) {
      current.recoveryCodeHashes = [...hashes]
    }

    const security = this.security.get(userId)
    if (security) {
      security.recoveryCodeCount = hashes.length
    }
  }

  async consumeRecoveryCode(
    userId: string,
    codeHash: string,
  ): Promise<boolean> {
    const current = this.mfa.get(userId)
    if (!current) return false

    const index = current.recoveryCodeHashes.indexOf(codeHash)
    if (index === -1) return false

    current.recoveryCodeHashes.splice(index, 1)
    return true
  }

  async createReauthGrant(input: CreateReauthGrantInput): Promise<void> {
    this.grants.set(input.tokenHash, {
      userId: input.userId,
      purpose: input.purpose,
      expiresAt: input.expiresAt,
      used: false,
    })
  }

  async consumeReauthGrant(input: {
    userId: string
    tokenHash: string
    purpose: string
    now: Date
  }): Promise<boolean> {
    const grant = this.grants.get(input.tokenHash)

    if (
      !grant ||
      grant.used ||
      grant.userId !== input.userId ||
      grant.purpose !== input.purpose ||
      grant.expiresAt.getTime() <= input.now.getTime()
    ) {
      return false
    }

    grant.used = true
    return true
  }

  async listSessions(_userId: string): Promise<PlatformSessionRecord[]> {
    return this.sessions
  }

  async revokeSession(
    _userId: string,
    sessionId: string,
  ): Promise<boolean> {
    const index = this.sessions.findIndex((session) => session.id === sessionId)

    if (index === -1) return false

    this.sessions.splice(index, 1)
    return true
  }

  async listSecurityEvents(
    userId: string,
    limit: number,
  ): Promise<PlatformSecurityEvent[]> {
    return this.events
      .filter((event) => this.eventOwners.get(event.id) === userId)
      .slice(0, limit)
  }

  async countFailedLoginsSince(
    _userId: string,
    _since: Date,
  ): Promise<number> {
    return this.failedLogins
  }

  async countLockedAccounts(_now: Date): Promise<number> {
    return this.lockedAccounts
  }

  async exportDataset(
    dataset: ExportDatasetId,
  ): Promise<ExportDatasetResult> {
    return (
      this.exportRows.get(dataset) ?? { rows: [], truncated: false }
    )
  }

  async recordAudit(entry: AuditEntry): Promise<void> {
    this.audits.push(entry)
  }

  /** Test helper: preload a security record for a platform user. */
  setSecurity(userId: string, overrides: Partial<UserSecurityRecord> = {}): void {
    this.security.set(userId, {
      userId,
      email: 'platform@example.com',
      mfaEnabled: false,
      mfaEnabledAt: null,
      pendingMfa: false,
      recoveryCodeCount: 0,
      lockedUntil: null,
      failedLoginCount: 0,
      lastFailedLoginAt: null,
      lastLoginAt: null,
      ...overrides,
    })
  }

  /** Test helper: add a security event owned by a user. */
  addSecurityEvent(
    userId: string,
    action: string,
    overrides: Partial<PlatformSecurityEvent> = {},
  ): PlatformSecurityEvent {
    const event: PlatformSecurityEvent = {
      id: `event-${++this.eventSequence}`,
      action,
      entityType: 'User',
      entityId: userId,
      metadata: null,
      ipAddress: null,
      createdAt: new Date().toISOString(),
      ...overrides,
    }

    this.events.unshift(event)
    this.eventOwners.set(event.id, userId)
    return event
  }
}
