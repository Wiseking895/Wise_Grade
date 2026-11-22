import type { PlatformRepository } from '../../src/platform/repository.js'
import type {
  PlatformAccount,
  PlatformAccountPage,
  PlatformAccountSession,
  PlatformAuditContext,
  PlatformAuditEntry,
  PlatformAuditFilter,
  PlatformAuditPage,
  PlatformDeletedAccount,
  PlatformDeletedAccountPage,
  PlatformManagedAccount,
  PlatformMonitoring,
  PlatformMonitoringBucket,
  PlatformOverview,
  PlatformRestoreResult,
  PlatformSchoolDetail,
  PlatformSchoolFilter,
  PlatformSchoolSummary,
  PlatformSchoolUpdate,
  PlatformSettings,
  PlatformSettingsUpdate,
} from '../../src/platform/types.js'

function emptyBucket(): PlatformMonitoringBucket {
  return { count: 0, schools: [] }
}

function schoolSummary(
  overrides: Partial<PlatformSchoolDetail> = {},
): PlatformSchoolDetail {
  return {
    id: 'school-1',
    name: 'Accra Basic School',
    slug: 'accra-basic-school',
    email: 'office@accra-basic.test',
    phone: '0240000000',
    address: '1 High Street',
    landmark: 'Near the post office',
    timezone: 'Africa/Accra',
    isActive: true,
    logoUrl: null,
    createdAt: '2026-01-05T08:00:00.000Z',
    pupilCount: 120,
    teacherCount: 8,
    classCount: 6,
    currentAcademicYearName: '2025/2026',
    currentTermName: 'Term 1',
    currentTermStatus: 'OPEN',
    outstandingMinor: 1500,
    currency: 'GHS',
    reportsPrepared: 4,
    reportsAwaitingRelease: 1,
    reportsReleased: 2,
    profileComplete: true,
    updatedAt: '2026-02-01T08:00:00.000Z',
    administrators: [],
    teachers: [],
    classes: [],
    academicYears: [],
    payments: [],
    reportBatches: [],
    ...overrides,
  }
}

export interface FakePlatformRepositoryHooks {
  /** Mirrors the production transaction that archives the auth user. */
  onAccountDeleted?: (userId: string, deletedAt: Date) => void | Promise<void>
  /** Mirrors the production transaction that reactivates the auth user. */
  onAccountRestored?: (userId: string) => void | Promise<void>
}

/**
 * In-memory platform repository used by HTTP tests. Values are deliberately
 * distinctive so a test can prove the route returns repository data rather than
 * a hardcoded dashboard figure.
 */
export class FakePlatformRepository implements PlatformRepository {
  constructor(private readonly hooks: FakePlatformRepositoryHooks = {}) {}

  overviewData: PlatformOverview = {
    schools: { total: 3, active: 2, suspended: 1 },
    people: { pupils: 240, teachers: 17, activeUsers: 23 },
    academics: {
      academicYears: 2,
      activeTerms: 2,
      currentTermName: 'Term 2',
      currentAcademicYearName: '2025/2026',
    },
    reports: {
      prepared: 41,
      awaitingApproval: 3,
      approvedAwaitingRelease: 2,
      released: 35,
      onHold: 1,
    },
    payments: {
      awaitingVerification: 4,
      verifiedCount: 9,
      verifiedMinor: 123456,
      outstandingMinor: 654321,
      currency: 'GHS',
    },
    recentActivity: [],
    generatedAt: '2026-03-01T10:00:00.000Z',
  }

  schools: PlatformSchoolDetail[] = [schoolSummary()]

  auditEntries: PlatformAuditEntry[] = [
    {
      id: 'audit-1',
      source: 'AUDIT_LOG',
      action: 'SCHOOL_SUSPENDED',
      entityType: 'School',
      entityId: 'school-1',
      schoolId: 'school-1',
      schoolName: 'Accra Basic School',
      actorUserId: 'platform-1',
      actorName: 'Platform Admin',
      actorEmail: 'platform@example.com',
      metadata: { reason: 'test' },
      ipAddress: '127.0.0.1',
      createdAt: '2026-03-01T09:00:00.000Z',
    },
    {
      id: 'billing-1',
      source: 'BILLING',
      action: 'PAYMENT_VERIFIED',
      entityType: 'Payment',
      entityId: 'payment-1',
      schoolId: 'school-1',
      schoolName: 'Accra Basic School',
      actorUserId: 'platform-1',
      actorName: 'Platform Admin',
      actorEmail: 'platform@example.com',
      metadata: { amountMinor: 5000 },
      ipAddress: '127.0.0.1',
      createdAt: '2026-03-01T08:30:00.000Z',
    },
  ]

  monitoringData: PlatformMonitoring = {
    notSubmitted: { ...emptyBucket(), count: 2, schools: [
      { schoolId: 'school-1', schoolName: 'Accra Basic School', count: 2, detail: 'Draft result entry' },
    ] },
    awaitingReview: emptyBucket(),
    returnedForCorrection: emptyBucket(),
    acceptedAwaitingReports: emptyBucket(),
    reportsAwaitingPayment: emptyBucket(),
    paymentsAwaitingVerification: emptyBucket(),
    reportsAwaitingRelease: emptyBucket(),
    approachingDeadlines: emptyBucket(),
    incompleteEndOfYear: emptyBucket(),
    generatedAt: '2026-03-01T10:00:00.000Z',
  }

  settings: PlatformSettings = {
    supportEmail: 'support@wisegrade.test',
    registrationEnabled: true,
    updatedAt: '2026-02-20T12:00:00.000Z',
    updatedByName: 'Platform Admin',
  }

  account: PlatformAccount = {
    id: 'platform-1',
    email: 'platform@example.com',
    firstName: 'Platform',
    lastName: 'Admin',
    isPlatformAdmin: true,
    isActive: true,
    lastLoginAt: '2026-03-01T07:00:00.000Z',
    createdAt: '2026-01-01T07:00:00.000Z',
    updatedAt: '2026-02-01T07:00:00.000Z',
  }

  sessions: PlatformAccountSession[] = [
    {
      id: 'session-current',
      current: true,
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
      createdAt: '2026-03-01T07:00:00.000Z',
      lastUsedAt: '2026-03-01T09:00:00.000Z',
      expiresAt: '2026-03-02T07:00:00.000Z',
    },
    {
      id: 'session-other',
      current: false,
      ipAddress: '10.0.0.2',
      userAgent: 'other-agent',
      createdAt: '2026-02-28T07:00:00.000Z',
      lastUsedAt: '2026-02-28T09:00:00.000Z',
      expiresAt: '2026-03-01T07:00:00.000Z',
    },
  ]

  readonly recordedAudits: Array<Record<string, unknown>> = []
  passwordHash: string | null = null
  revokeOtherCalls = 0
  registrationEnabled = true

  managedAccounts: PlatformManagedAccount[] = [
    {
      id: 'platform-1',
      firstName: 'Platform',
      lastName: 'Admin',
      email: 'platform@example.com',
      role: 'PLATFORM_SUPER_ADMIN',
      isPlatformAdmin: true,
      isActive: true,
      deletedAt: null,
      schoolId: null,
      schoolName: null,
      lastLoginAt: '2026-03-01T07:00:00.000Z',
      createdAt: '2026-01-01T07:00:00.000Z',
    },
    {
      id: 'teacher-1',
      firstName: 'Ama',
      lastName: 'Mensah',
      email: 'ama@school.test',
      role: 'CLASS_TEACHER',
      isPlatformAdmin: false,
      isActive: true,
      deletedAt: null,
      schoolId: 'school-1',
      schoolName: 'Accra Basic School',
      lastLoginAt: null,
      createdAt: '2026-02-01T07:00:00.000Z',
    },
  ]

  deletedAccounts: PlatformDeletedAccount[] = []
  accountSessionsRevoked = 0

  async overview(): Promise<PlatformOverview> {
    return this.overviewData
  }

  async listSchools(filter: PlatformSchoolFilter): Promise<PlatformSchoolSummary[]> {
    const search = filter.search?.toLowerCase()

    return this.schools.filter((school) => {
      if (filter.status === 'active' && !school.isActive) return false
      if (filter.status === 'suspended' && school.isActive) return false

      if (!search) return true

      return [school.name, school.slug, school.email ?? '']
        .join(' ')
        .toLowerCase()
        .includes(search)
    })
  }

  async getSchool(schoolId: string): Promise<PlatformSchoolDetail | null> {
    return this.schools.find((school) => school.id === schoolId) ?? null
  }

  async getSchoolLogo(): Promise<{ storageKey: string; mimeType: string } | null> {
    return { storageKey: 'logo-key', mimeType: 'image/png' }
  }

  async setSchoolActive(
    _actorUserId: string,
    schoolId: string,
    isActive: boolean,
    audit: PlatformAuditContext,
  ): Promise<PlatformSchoolDetail> {
    const school = this.schools.find((item) => item.id === schoolId)

    if (!school) {
      throw Object.assign(new Error('School not found'), { code: 'NOT_FOUND' })
    }

    school.isActive = isActive
    this.recordedAudits.push({
      action: isActive ? 'SCHOOL_ACTIVATED' : 'SCHOOL_SUSPENDED',
      schoolId,
      ipAddress: audit.ipAddress,
    })

    return school
  }

  async updateSchool(
    _actorUserId: string,
    schoolId: string,
    input: PlatformSchoolUpdate,
    _audit: PlatformAuditContext,
  ): Promise<PlatformSchoolDetail> {
    const school = this.schools.find((item) => item.id === schoolId)

    if (!school) {
      throw Object.assign(new Error('School not found'), { code: 'NOT_FOUND' })
    }

    Object.assign(school, input)
    return school
  }

  async listAudit(filter: PlatformAuditFilter): Promise<PlatformAuditPage> {
    const limit = filter.limit ?? 50
    const offset = filter.offset ?? 0
    const source = filter.source ?? 'all'
    const filtered = this.auditEntries.filter((entry) => {
      if (source !== 'all' && entry.source !== source) return false
      if (filter.search) {
        const needle = filter.search.toLowerCase()
        const haystack = `${entry.action} ${entry.schoolName ?? ''} ${entry.actorEmail ?? ''}`.toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      return true
    })

    return {
      entries: filtered.slice(offset, offset + limit),
      total: filtered.length,
      limit,
      offset,
    }
  }

  async monitoring(): Promise<PlatformMonitoring> {
    return this.monitoringData
  }

  async getSettings(): Promise<PlatformSettings> {
    return this.settings
  }

  async updateSettings(
    _actorUserId: string,
    input: PlatformSettingsUpdate,
    _audit: PlatformAuditContext,
  ): Promise<PlatformSettings> {
    if (input.supportEmail !== undefined) {
      this.settings.supportEmail = input.supportEmail
    }

    if (input.registrationEnabled !== undefined) {
      this.settings.registrationEnabled = input.registrationEnabled
      this.registrationEnabled = input.registrationEnabled
    }

    this.settings.updatedAt = new Date().toISOString()
    this.settings.updatedByName = 'Platform Admin'
    return this.settings
  }

  async listAccounts(filter: {
    search?: string
    role?: string
    status?: string
    limit?: number
    offset?: number
  }): Promise<PlatformAccountPage> {
    const limit = filter.limit ?? 25
    const offset = filter.offset ?? 0
    const search = filter.search?.toLowerCase()
    const filtered = this.managedAccounts.filter((account) => {
      // Archived accounts live only in the Deleted Accounts History. Every
      // other status filter excludes them, matching the Prisma repository.
      if (filter.status === 'deleted') {
        if (!account.deletedAt) {
          return false
        }
      } else {
        if (account.deletedAt) {
          return false
        }
        if (filter.status === 'active' && !account.isActive) {
          return false
        }
        if (filter.status === 'suspended' && account.isActive) {
          return false
        }
      }
      if (filter.role && filter.role !== 'all' && account.role !== filter.role) {
        return false
      }
      if (!search) return true

      return `${account.firstName} ${account.lastName} ${account.email} ${account.schoolName ?? ''}`
        .toLowerCase()
        .includes(search)
    })

    return {
      accounts: filtered.slice(offset, offset + limit),
      total: filtered.length,
      limit,
      offset,
    }
  }

  async setAccountActive(
    actorUserId: string,
    userId: string,
    isActive: boolean,
    reason: string | undefined,
    _audit: PlatformAuditContext,
  ): Promise<PlatformManagedAccount> {
    const account = this.managedAccounts.find((item) => item.id === userId)

    if (!account) {
      throw Object.assign(new Error('Account not found'), { code: 'NOT_FOUND' })
    }

    if (account.deletedAt) {
      throw Object.assign(
        new Error('This account is archived. Restore it before changing its status.'),
        { code: 'ALREADY_DELETED' },
      )
    }

    if (!isActive && userId === actorUserId) {
      throw Object.assign(
        new Error('You cannot suspend your own platform account.'),
        { code: 'SELF_SUSPENSION' },
      )
    }

    if (!isActive && account.isPlatformAdmin) {
      const activeAdmins = this.managedAccounts.filter(
        (item) =>
          item.isPlatformAdmin && item.isActive && item.deletedAt === null,
      )

      if (activeAdmins.length <= 1) {
        throw Object.assign(
          new Error('The last active platform administrator cannot be suspended.'),
          { code: 'LAST_ADMIN' },
        )
      }
    }

    account.isActive = isActive

    if (!isActive) {
      this.accountSessionsRevoked += 1
    }

    this.recordedAudits.push({
      action: isActive ? 'ACCOUNT_ACTIVATED' : 'ACCOUNT_SUSPENDED',
      userId,
      reason: reason ?? null,
    })

    return account
  }

  async deleteAccount(
    actorUserId: string,
    userId: string,
    reason: string,
    confirmEmail: string,
    _audit: PlatformAuditContext,
  ): Promise<PlatformDeletedAccount> {
    const account = this.managedAccounts.find((item) => item.id === userId)

    if (!account) {
      throw Object.assign(new Error('Account not found'), { code: 'NOT_FOUND' })
    }

    if (userId === actorUserId) {
      throw Object.assign(
        new Error('You cannot delete your own platform account.'),
        { code: 'SELF_DELETION' },
      )
    }

    if (account.email.toLowerCase() !== confirmEmail.trim().toLowerCase()) {
      throw Object.assign(
        new Error(
          'The confirmation email does not match the account being deleted.',
        ),
        { code: 'CONFIRMATION_MISMATCH', field: 'confirmEmail' },
      )
    }

    if (account.deletedAt) {
      throw Object.assign(new Error('This account is already archived.'), {
        code: 'ALREADY_DELETED',
      })
    }

    if (account.isPlatformAdmin) {
      const activeAdmins = this.managedAccounts.filter(
        (item) =>
          item.isPlatformAdmin && item.isActive && item.deletedAt === null,
      )

      if (activeAdmins.length <= 1) {
        throw Object.assign(
          new Error('The last active platform administrator cannot be deleted.'),
          { code: 'LAST_ADMIN' },
        )
      }
    }

    const record: PlatformDeletedAccount = {
      id: `deletion-${this.deletedAccounts.length + 1}`,
      userId,
      firstName: account.firstName,
      lastName: account.lastName,
      email: account.email,
      phone: null,
      role: account.role,
      isPlatformAdmin: account.isPlatformAdmin,
      schoolId: account.schoolId,
      schoolName: account.schoolName,
      memberships: account.schoolId
        ? [
            {
              schoolId: account.schoolId,
              schoolName: account.schoolName ?? '',
              role: account.role,
              status: 'SUSPENDED',
            },
          ]
        : [],
      deletedAt: '2026-03-02T10:00:00.000Z',
      deletedByName: 'Platform Admin',
      deletedByEmail: 'platform@example.com',
      reason,
      status: 'ARCHIVED',
      restoredAt: null,
      restoredByName: null,
      restoredByEmail: null,
      restoreReason: null,
    }

    account.deletedAt = record.deletedAt
    account.isActive = false
    this.deletedAccounts.unshift(record)
    this.accountSessionsRevoked += 1
    this.recordedAudits.push({ action: 'ACCOUNT_DELETED', userId, reason })
    await this.hooks.onAccountDeleted?.(
      userId,
      new Date(record.deletedAt),
    )

    return record
  }

  async listDeletedAccounts(filter: {
    search?: string
    status?: string
    limit?: number
    offset?: number
  }): Promise<PlatformDeletedAccountPage> {
    const limit = filter.limit ?? 25
    const offset = filter.offset ?? 0
    const search = filter.search?.toLowerCase()
    const filtered = this.deletedAccounts.filter((record) => {
      if (
        filter.status &&
        filter.status !== 'all' &&
        record.status !== filter.status
      ) {
        return false
      }

      if (!search) return true

      return `${record.firstName} ${record.lastName} ${record.email} ${record.schoolName ?? ''} ${record.reason}`
        .toLowerCase()
        .includes(search)
    })

    return {
      accounts: filtered.slice(offset, offset + limit),
      total: filtered.length,
      limit,
      offset,
    }
  }

  async restoreDeletedAccount(
    _actorUserId: string,
    deletionId: string,
    reason: string | undefined,
    confirmEmail: string,
    _audit: PlatformAuditContext,
  ): Promise<PlatformRestoreResult> {
    const record = this.deletedAccounts.find((item) => item.id === deletionId)

    if (!record) {
      throw Object.assign(new Error('Deletion history not found'), {
        code: 'NOT_FOUND',
      })
    }

    if (record.status !== 'ARCHIVED') {
      throw Object.assign(
        new Error('This account has already been restored.'),
        { code: 'NOT_ARCHIVED' },
      )
    }

    if (record.email.toLowerCase() !== confirmEmail.trim().toLowerCase()) {
      throw Object.assign(
        new Error('The confirmation email does not match the archived account.'),
        { code: 'CONFIRMATION_MISMATCH', field: 'confirmEmail' },
      )
    }

    const conflict = this.managedAccounts.find(
      (account) =>
        account.id !== record.userId &&
        account.email.toLowerCase() === record.email.toLowerCase(),
    )

    if (conflict) {
      throw Object.assign(
        new Error(
          'This email address is currently assigned to another account. Resolve the conflict before restoring.',
        ),
        { code: 'CONFLICT', field: 'email' },
      )
    }

    const account = this.managedAccounts.find(
      (item) => item.id === record.userId,
    )

    if (!account) {
      throw Object.assign(new Error('Account not found'), { code: 'NOT_FOUND' })
    }

    account.deletedAt = null
    account.isActive = true
    record.status = 'RESTORED'
    record.restoredAt = '2026-03-03T10:00:00.000Z'
    record.restoredByName = 'Platform Admin'
    record.restoredByEmail = 'platform@example.com'
    record.restoreReason = reason ?? null
    this.recordedAudits.push({
      action: 'ACCOUNT_RESTORED',
      userId: record.userId,
      reason: reason ?? null,
    })
    await this.hooks.onAccountRestored?.(record.userId)

    return {
      account: record,
      restoredUserId: record.userId,
      membershipsRestored: false,
    }
  }

  async getAccount(userId: string): Promise<PlatformAccount | null> {
    return this.account.id === userId ? this.account : null
  }

  async updateAccountProfile(
    userId: string,
    input: { firstName: string; lastName: string },
  ): Promise<PlatformAccount> {
    if (this.account.id !== userId) {
      throw Object.assign(new Error('Account not found'), { code: 'NOT_FOUND' })
    }

    this.account.firstName = input.firstName
    this.account.lastName = input.lastName
    return this.account
  }

  async updateAccountEmail(userId: string, email: string): Promise<PlatformAccount> {
    if (this.account.id !== userId) {
      throw Object.assign(new Error('Account not found'), { code: 'NOT_FOUND' })
    }

    this.account.email = email
    return this.account
  }

  async updateAccountPassword(
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    if (this.account.id !== userId) {
      throw Object.assign(new Error('Account not found'), { code: 'NOT_FOUND' })
    }

    this.passwordHash = passwordHash
  }

  async listAccountSessions(): Promise<PlatformAccountSession[]> {
    return this.sessions
  }

  async revokeOtherAccountSessions(
    _userId: string,
    currentSessionId: string,
  ): Promise<number> {
    this.revokeOtherCalls += 1
    const before = this.sessions.length
    this.sessions = this.sessions.filter(
      (session) => session.id === currentSessionId,
    )
    return before - this.sessions.length
  }

  async isRegistrationEnabled(): Promise<boolean> {
    return this.registrationEnabled
  }

  async recordAudit(entry: {
    schoolId?: string | null
    actorUserId?: string | null
    action: string
    entityType: string
    entityId?: string | null
    metadata?: Record<string, unknown> | null
    ipAddress?: string | null
    userAgent?: string | null
  }): Promise<void> {
    this.recordedAudits.push(entry)
  }
}
