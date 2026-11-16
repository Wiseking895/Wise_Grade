import type { PlatformRepository } from '../../src/platform/repository.js'
import type {
  PlatformAccount,
  PlatformAccountSession,
  PlatformAuditContext,
  PlatformAuditEntry,
  PlatformAuditFilter,
  PlatformAuditPage,
  PlatformMonitoring,
  PlatformMonitoringBucket,
  PlatformOverview,
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

/**
 * In-memory platform repository used by HTTP tests. Values are deliberately
 * distinctive so a test can prove the route returns repository data rather than
 * a hardcoded dashboard figure.
 */
export class FakePlatformRepository implements PlatformRepository {
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
