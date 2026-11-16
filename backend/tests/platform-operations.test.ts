import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import {
  decryptMfaSecret,
  encryptMfaSecret,
  generateTotp,
  hashRecoveryCode,
} from '../src/auth/mfa.js'
import { hashToken } from '../src/auth/tokens.js'
import type { CalendarService } from '../src/calendar/service.js'
import { startCalendarScheduler } from '../src/calendar/scheduler.js'
import { SESSION_COOKIE_NAME } from '../src/lib/cookies.js'
import { detectIssues } from '../src/platform/prisma-operations-repository.js'
import type { PlatformHealthService } from '../src/platform/health.js'
import type {
  PlatformHealth,
  ReconciliationIssue,
} from '../src/platform/operations-types.js'
import {
  createStorageAdapter,
  LocalStorageAdapter,
  MemoryStorageAdapter,
} from '../src/storage/storage.js'
import { exportFileName, toCsv } from '../src/platform/exports.js'
import { TEST_ORIGIN, TEST_PASSWORD, registrationBody } from './helpers/auth-fixtures.js'
import { FakeAuthRepository } from './helpers/fake-auth-repository.js'
import { FakeOperationsRepository } from './helpers/fake-operations-repository.js'
import { FakePlatformRepository } from './helpers/fake-platform-repository.js'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function cookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}`
}

function fakeHealth(): PlatformHealth {
  const checkedAt = '2026-03-01T10:00:00.000Z'

  return {
    status: 'degraded',
    checks: [
      {
        id: 'database',
        label: 'PostgreSQL',
        status: 'ok',
        detail: 'A read-only connectivity query succeeded.',
        checkedAt,
      },
      {
        id: 'storage',
        label: 'Private object storage',
        status: 'not_configured',
        detail: 'Private object storage is not configured.',
        checkedAt,
      },
    ],
    migrations: {
      appliedCount: 18,
      expectedCount: 18,
      latestApplied: '20261114120000_platform_operations',
      latestAppliedAt: checkedAt,
      upToDate: true,
      pending: [],
    },
    scheduler: {
      enabled: true,
      intervalMinutes: 60,
      lastRun: null,
      lastSuccessfulRun: null,
      consecutiveFailures: 0,
    },
    paymentProvider: {
      configured: false,
      provider: null,
      webhookSecretConfigured: false,
      lastWebhookAt: null,
      lastWebhookOutcome: null,
    },
    generatedAt: checkedAt,
  }
}

function issue(
  overrides: Partial<ReconciliationIssue> = {},
): ReconciliationIssue {
  return {
    code: 'MISMATCHED_REFERENCE',
    severity: 'WARNING',
    paymentId: 'payment-1',
    schoolId: 'school-1',
    schoolName: 'Accra Basic School',
    invoiceId: 'invoice-1',
    invoiceNumber: 'WG-2026-0001',
    invoiceSchoolId: 'school-1',
    invoiceTermId: 'term-1',
    paymentReference: 'REF-1',
    providerReference: null,
    source: 'MANUAL',
    method: 'BANK_TRANSFER',
    status: 'PENDING',
    amountMinor: 10000,
    appliedMinor: 0,
    overpaymentMinor: 0,
    invoiceTotalMinor: 10000,
    currency: 'GHS',
    submittedAt: '2026-03-01T09:00:00.000Z',
    verifiedAt: null,
    reconciledAt: null,
    detail: 'Mismatched reference.',
    ...overrides,
  }
}

function reconciliationRow(
  overrides: Partial<Parameters<typeof detectIssues>[0][number]> = {},
) {
  return {
    id: 'payment-1',
    schoolId: 'school-1',
    invoiceId: 'invoice-1',
    source: 'MANUAL',
    method: 'BANK_TRANSFER',
    status: 'PENDING',
    amountMinor: 10000,
    appliedMinor: 0,
    overpaymentMinor: 0,
    currency: 'GHS',
    paymentReference: 'REF-1',
    providerReference: null,
    submittedAt: new Date('2026-03-01T09:00:00.000Z'),
    verifiedAt: null,
    reconciledAt: null,
    school: { name: 'Accra Basic School' },
    invoice: {
      id: 'invoice-1',
      invoiceNumber: 'WG-2026-0001',
      schoolId: 'school-1',
      academicTermId: 'term-1',
      totalMinor: 10000,
      currency: 'GHS',
      status: 'ISSUED',
      academicTerm: {
        startsOn: new Date('2026-01-01T00:00:00.000Z'),
        endsOn: new Date('2026-04-01T00:00:00.000Z'),
        name: 'Term 1',
      },
    },
    ...overrides,
  } as Parameters<typeof detectIssues>[0][number]
}

describe('Platform operations', () => {
  let auth: FakeAuthRepository
  let platform: FakePlatformRepository
  let operations: FakeOperationsRepository
  let storage: MemoryStorageAdapter
  let app: ReturnType<typeof createApp>
  let token: string
  let userId: string

  beforeEach(async () => {
    auth = new FakeAuthRepository()
    platform = new FakePlatformRepository()
    operations = new FakeOperationsRepository()
    storage = new MemoryStorageAdapter()

    const healthService: PlatformHealthService = {
      async check() {
        return fakeHealth()
      },
    }

    app = createApp({
      authRepository: auth,
      platformRepository: platform,
      platformOperationsRepository: operations,
      platformHealthService: healthService,
      reportStorage: storage,
    })

    const platformUser = await auth.createUser({
      email: 'platform@example.com',
      password: TEST_PASSWORD,
      firstName: 'Platform',
      lastName: 'Admin',
      isPlatformAdmin: true,
    })
    userId = platformUser.id
    operations.setSecurity(userId)
    token = await auth.issueSessionFor(userId)
  })

  afterEach(() => {
    delete process.env.PLATFORM_REAUTH_ENFORCED
  })

  function asPlatform(
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    headers: Record<string, string> = {},
  ) {
    const agent = request(app)[method](path).set('Cookie', cookie(token))

    if (method !== 'get') {
      agent.set('Origin', TEST_ORIGIN)
    }

    for (const [key, value] of Object.entries(headers)) {
      agent.set(key, value)
    }

    return agent
  }

  function currentSessionId(): string {
    return auth.sessions.get(hashToken(token))!.id
  }

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------

  it('exposes authenticated, secret-free platform health', async () => {
    const response = await asPlatform('get', '/api/platform/health')

    expect(response.status).toBe(200)
    expect(response.body.data.status).toBe('degraded')
    expect(response.body.data.migrations).toMatchObject({
      appliedCount: 18,
      expectedCount: 18,
      upToDate: true,
    })
    expect(response.body.data.checks[0]).toMatchObject({
      id: 'database',
      status: 'ok',
    })
    expect(JSON.stringify(response.body)).not.toMatch(
      /password|secretKey|accessKey|R2_SECRET|DATABASE_URL/i,
    )
  })

  it('rejects unauthenticated and school users from platform health', async () => {
    const anonymous = await request(app).get('/api/platform/health')
    expect(anonymous.status).toBe(401)
  })

  it('reports storage health without destructive actions', async () => {
    const memory = await new MemoryStorageAdapter().healthCheck()
    const local = await new LocalStorageAdapter(
      join(tmpdir(), `wise-grade-health-${Date.now()}`),
    ).healthCheck()
    const production = await createStorageAdapter({
      nodeEnv: 'production',
    }).healthCheck()

    expect(memory).toMatchObject({ mode: 'memory', ok: true })
    expect(local).toMatchObject({ mode: 'local', ok: true })
    expect(production).toMatchObject({ mode: 'unconfigured', ok: false })
  })

  it('records scheduler runs and raises a failure notification', async () => {
    let resolveSummary: (value: unknown) => void = () => undefined
    const summaryPromise = new Promise<unknown>((resolve) => {
      resolveSummary = resolve
    })

    const stop = startCalendarScheduler({
      service: {
        async runAll() {
          return [
            {
              schoolId: 'school-1',
              trigger: 'SCHEDULER',
              runAt: new Date(),
              status: 'FAILED',
              steps: [],
              message: 'report preparation failed',
            },
          ]
        },
      } as unknown as CalendarService,
      intervalMs: 60 * 60 * 1000,
      runImmediately: true,
      onRun: async (summary) => {
        resolveSummary(summary)
      },
    })

    const summary = (await summaryPromise) as {
      status: string
      failureCount: number
      message: string
    }

    stop()

    expect(summary.status).toBe('FAILED')
    expect(summary.failureCount).toBe(1)
    expect(summary.message).toContain('report preparation failed')
  })

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------

  it('lists, filters, searches and paginates notifications', async () => {
    operations.schoolNames.set('school-1', 'Accra Basic School')

    await operations.createNotification({
      type: 'PAYMENT_SUBMITTED',
      severity: 'INFO',
      title: 'Payment submitted',
      schoolId: 'school-1',
      entityType: 'Payment',
      entityId: 'payment-1',
      link: '/platform/billing',
    })
    await operations.createNotification({
      type: 'PLATFORM_ACCOUNT_LOCKED',
      severity: 'CRITICAL',
      title: 'Platform account locked',
      body: 'Five failed attempts',
      entityType: 'User',
      entityId: userId,
      link: '/platform/security',
    })

    const all = await asPlatform('get', '/api/platform/notifications')
    expect(all.status).toBe(200)
    expect(all.body.data.total).toBe(2)
    expect(all.body.data.unreadCount).toBe(2)

    const critical = await asPlatform(
      'get',
      '/api/platform/notifications?severity=CRITICAL&unreadOnly=true',
    )
    expect(critical.body.data.notifications).toHaveLength(1)
    expect(critical.body.data.notifications[0]).toMatchObject({
      type: 'PLATFORM_ACCOUNT_LOCKED',
      severity: 'CRITICAL',
      link: '/platform/security',
      read: false,
    })

    const searched = await asPlatform(
      'get',
      '/api/platform/notifications?search=payment',
    )
    expect(searched.body.data.notifications).toHaveLength(1)
    expect(searched.body.data.notifications[0].schoolName).toBe(
      'Accra Basic School',
    )

    const paged = await asPlatform(
      'get',
      '/api/platform/notifications?limit=1&offset=1',
    )
    expect(paged.body.data.notifications).toHaveLength(1)
    expect(paged.body.data.total).toBe(2)
  })

  it('marks one notification and then all notifications as read', async () => {
    const first = await operations.createNotification({
      type: 'SCHOOL_REGISTERED',
      severity: 'SUCCESS',
      title: 'School registered',
    })
    await operations.createNotification({
      type: 'PAYMENT_VERIFIED',
      severity: 'SUCCESS',
      title: 'Payment verified',
    })

    const read = await asPlatform(
      'post',
      `/api/platform/notifications/${first!.id}/read`,
    )
    expect(read.status).toBe(200)
    expect(read.body.data.notification.read).toBe(true)
    expect(read.body.data.notification.readAt).toEqual(expect.any(String))

    const count = await asPlatform(
      'get',
      '/api/platform/notifications/unread-count',
    )
    expect(count.body.data.unreadCount).toBe(1)

    const all = await asPlatform('post', '/api/platform/notifications/read-all')
    expect(all.body.data.updated).toBe(1)

    const after = await asPlatform(
      'get',
      '/api/platform/notifications/unread-count',
    )
    expect(after.body.data.unreadCount).toBe(0)
  })

  it('deduplicates notifications on job retries', async () => {
    const input = {
      type: 'REPORT_RELEASED',
      severity: 'SUCCESS' as const,
      title: 'Batch released',
      dedupeKey: 'report-released:batch-1',
    }

    const first = await operations.createNotification(input)
    const second = await operations.createNotification(input)

    expect(first?.id).toBe(second?.id)
    expect(operations.notifications).toHaveLength(1)
  })

  it('returns 404 for an unknown notification', async () => {
    const response = await asPlatform(
      'post',
      '/api/platform/notifications/missing/read',
    )

    expect(response.status).toBe(404)
  })

  // -------------------------------------------------------------------------
  // Security and MFA
  // -------------------------------------------------------------------------

  it('reports security overview, lockout and sessions', async () => {
    operations.setSecurity(userId, {
      mfaEnabled: true,
      mfaEnabledAt: '2026-02-01T10:00:00.000Z',
      recoveryCodeCount: 4,
      failedLoginCount: 2,
      lastFailedLoginAt: '2026-03-01T08:00:00.000Z',
      lastLoginAt: '2026-03-01T09:00:00.000Z',
    })
    operations.failedLogins = 3
    operations.lockedAccounts = 1
    operations.addSecurityEvent(userId, 'LOGIN_SUCCEEDED')
    operations.sessions.push(
      {
        id: currentSessionId(),
        current: false,
        ipAddress: '127.0.0.1',
        userAgent: 'Current browser',
        createdAt: '2026-03-01T08:00:00.000Z',
        lastUsedAt: '2026-03-01T09:00:00.000Z',
        expiresAt: '2026-03-02T08:00:00.000Z',
      },
      {
        id: 'other-session',
        current: false,
        ipAddress: '10.0.0.1',
        userAgent: 'Other browser',
        createdAt: '2026-03-01T07:00:00.000Z',
        lastUsedAt: '2026-03-01T07:30:00.000Z',
        expiresAt: '2026-03-02T07:00:00.000Z',
      },
    )

    const response = await asPlatform('get', '/api/platform/security')

    expect(response.status).toBe(200)
    expect(response.body.data.mfa).toMatchObject({
      enabled: true,
      recoveryCodesRemaining: 4,
      configured: true,
    })
    expect(response.body.data.failedLogins24h).toBe(3)
    expect(response.body.data.lockedAccounts).toBe(1)
    expect(response.body.data.events).toHaveLength(1)
    expect(
      response.body.data.sessions.find(
        (session: { id: string }) => session.id === currentSessionId(),
      ).current,
    ).toBe(true)
    expect(JSON.stringify(response.body)).not.toMatch(
      /encryptedSecret|pendingSecret|recoveryCodeHashes|passwordHash/i,
    )
  })

  it('enrolls MFA, stores only an encrypted secret and issues recovery codes', async () => {
    const enroll = await asPlatform('post', '/api/platform/security/mfa/enroll')
    expect(enroll.status).toBe(200)
    expect(enroll.body.data.secret).toEqual(expect.any(String))
    expect(enroll.body.data.otpauthUri).toContain('otpauth://totp/')

    const secret = enroll.body.data.secret as string
    const stored = operations.mfa.get(userId)
    expect(stored?.pendingSecret).not.toBe(secret)
    expect(stored?.pendingSecret).toMatch(/^v1:/)
    expect(decryptMfaSecret(stored!.pendingSecret!)).toBe(secret)

    const confirm = await asPlatform('post', '/api/platform/security/mfa/confirm')
      .send({ code: generateTotp(secret) })

    expect(confirm.status).toBe(200)
    expect(confirm.body.data.recoveryCodes).toHaveLength(10)
    expect(operations.mfa.get(userId)?.enabled).toBe(true)
    expect(operations.mfa.get(userId)?.secret).toMatch(/^v1:/)

    const overview = await asPlatform('get', '/api/platform/security')
    expect(overview.body.data.mfa).toMatchObject({
      enabled: true,
      recoveryCodesRemaining: 10,
    })
  })

  it('requires a second factor at login and consumes recovery codes once', async () => {
    const secret = 'JBSWY3DPEHPK3PXP'
    const recoveryCodes = ['ABCDE-FGHJK', 'LMNPQ-RSTUV']
    auth.enableMfaFor(
      userId,
      encryptMfaSecret(secret),
      recoveryCodes.map(hashRecoveryCode),
    )

    const missing = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'platform@example.com', password: TEST_PASSWORD })

    expect(missing.status).toBe(401)
    expect(missing.body.error.message).toBe('Authentication code required')

    const invalid = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({
        email: 'platform@example.com',
        password: TEST_PASSWORD,
        mfaCode: '000000',
      })

    expect(invalid.status).toBe(401)

    const valid = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({
        email: 'platform@example.com',
        password: TEST_PASSWORD,
        mfaCode: generateTotp(secret),
      })

    expect(valid.status).toBe(200)

    const recovery = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({
        email: 'platform@example.com',
        password: TEST_PASSWORD,
        mfaCode: recoveryCodes[0],
      })

    expect(recovery.status).toBe(200)

    const reused = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({
        email: 'platform@example.com',
        password: TEST_PASSWORD,
        mfaCode: recoveryCodes[0],
      })

    expect(reused.status).toBe(401)
  })

  it('locks a platform account after five failed attempts and notifies the platform', async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await request(app)
        .post('/api/auth/login')
        .set('Origin', TEST_ORIGIN)
        .send({ email: 'platform@example.com', password: 'wrong-password-123' })

      expect(response.status).toBe(401)
    }

    const locked = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'platform@example.com', password: TEST_PASSWORD })

    expect(locked.status).toBe(423)
    expect(
      operations.notifications.some(
        (notification) => notification.type === 'PLATFORM_ACCOUNT_LOCKED',
      ),
    ).toBe(true)
    expect(auth.auditActions()).toContain('LOGIN_LOCKED')
  })

  it('issues single-use reauthentication grants and enforces sensitive actions', async () => {
    process.env.PLATFORM_REAUTH_ENFORCED = 'true'

    const wrong = await asPlatform('post', '/api/platform/security/reauth').send({
      password: 'wrong-password-123',
      purpose: 'SENSITIVE_ACTION',
    })
    expect(wrong.status).toBe(403)

    const missingHeader = await asPlatform(
      'post',
      '/api/platform/schools/school-1/status',
    ).send({ isActive: false })
    expect(missingHeader.status).toBe(428)

    const grant = await asPlatform('post', '/api/platform/security/reauth').send({
      password: TEST_PASSWORD,
      purpose: 'SENSITIVE_ACTION',
    })
    expect(grant.status).toBe(200)
    expect(grant.body.data.token).toEqual(expect.any(String))

    const changed = await asPlatform(
      'post',
      '/api/platform/schools/school-1/status',
      { 'X-Platform-Reauth': grant.body.data.token },
    ).send({ isActive: false })

    expect(changed.status).toBe(200)
    expect(changed.body.data.school.isActive).toBe(false)

    const reused = await asPlatform(
      'post',
      '/api/platform/schools/school-1/status',
      { 'X-Platform-Reauth': grant.body.data.token },
    ).send({ isActive: true })

    expect(reused.status).toBe(403)
  })

  it('rejects a reauthentication grant issued for a different purpose', async () => {
    process.env.PLATFORM_REAUTH_ENFORCED = 'true'

    const grant = await asPlatform('post', '/api/platform/security/reauth').send({
      password: TEST_PASSWORD,
      purpose: 'DATA_EXPORT',
    })

    const response = await asPlatform(
      'post',
      '/api/platform/schools/school-1/status',
      { 'X-Platform-Reauth': grant.body.data.token },
    ).send({ isActive: false })

    expect(response.status).toBe(403)
  })

  it('requires reauthentication before onboarding a school', async () => {
    process.env.PLATFORM_REAUTH_ENFORCED = 'true'

    const blocked = await asPlatform('post', '/api/platform/schools').send(
      registrationBody(),
    )
    expect(blocked.status).toBe(428)

    const grant = await asPlatform('post', '/api/platform/security/reauth').send({
      password: TEST_PASSWORD,
      purpose: 'SENSITIVE_ACTION',
    })

    const created = await asPlatform('post', '/api/platform/schools', {
      'X-Platform-Reauth': grant.body.data.token,
    }).send(registrationBody())

    expect(created.status).toBe(201)
    expect(created.body.data.administrator.email).toBe('ada@example.com')
    expect(platform.recordedAudits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'SCHOOL_REGISTERED_BY_PLATFORM' }),
      ]),
    )
  })

  // -------------------------------------------------------------------------
  // Exports
  // -------------------------------------------------------------------------

  it('lists export datasets and streams audited, formula-safe CSV', async () => {
    operations.exportRows.set('payments', {
      rows: [
        {
          id: 'payment-1',
          school: '=SUM(A1:A2)',
          invoiceNumber: 'WG-2026-0001',
          status: 'VERIFIED',
          source: 'MANUAL',
          method: 'BANK_TRANSFER',
          amountMinor: 10000,
          appliedMinor: 10000,
          overpaymentMinor: 0,
          currency: 'GHS',
          paymentReference: 'REF-1',
          providerReference: null,
          submittedAt: '2026-03-01T09:00:00.000Z',
          verifiedAt: '2026-03-01T09:05:00.000Z',
          reconciledAt: null,
        },
      ],
      truncated: false,
    })

    const datasets = await asPlatform('get', '/api/platform/exports')
    expect(datasets.status).toBe(200)
    expect(datasets.body.data.datasets.map((item: { id: string }) => item.id)).toEqual([
      'schools',
      'payments',
      'invoices',
      'audit',
      'notifications',
    ])

    const csv = await asPlatform('get', '/api/platform/exports/payments')
    expect(csv.status).toBe(200)
    expect(csv.headers['content-type']).toContain('text/csv')
    expect(csv.headers['cache-control']).toBe('no-store')
    expect(csv.headers['content-disposition']).toContain('attachment;')
    expect(csv.text).toContain("'=SUM(A1:A2)")
    expect(operations.audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'PLATFORM_EXPORT_DOWNLOADED',
          entityType: 'Export',
          entityId: 'payments',
        }),
      ]),
    )
  })

  it('requires reauthentication and rejects unknown export datasets', async () => {
    process.env.PLATFORM_REAUTH_ENFORCED = 'true'

    const blocked = await asPlatform('get', '/api/platform/exports/schools')
    expect(blocked.status).toBe(428)

    const grant = await asPlatform('post', '/api/platform/security/reauth').send({
      password: TEST_PASSWORD,
      purpose: 'DATA_EXPORT',
    })
    const allowed = await asPlatform('get', '/api/platform/exports/schools', {
      'X-Platform-Reauth': grant.body.data.token,
    })
    expect(allowed.status).toBe(200)

    const secondGrant = await asPlatform(
      'post',
      '/api/platform/security/reauth',
    ).send({
      password: TEST_PASSWORD,
      purpose: 'DATA_EXPORT',
    })

    const unknown = await asPlatform('get', '/api/platform/exports/unknown', {
      'X-Platform-Reauth': secondGrant.body.data.token,
    })
    expect(unknown.status).toBe(404)
  })

  it('neutralizes spreadsheet formulas and quotes CSV cells', () => {
    const csv = toCsv(
      ['id', 'name', 'note'],
      [
        { id: '1', name: '=SUM(A1)', note: 'hello, "world"' },
        { id: '2', name: '@cmd', note: 'line\nbreak' },
      ],
    )

    expect(csv).toContain("1,'=SUM(A1),\"hello, \"\"world\"\"\"")
    expect(csv).toContain("2,'@cmd,\"line\nbreak\"")
    expect(exportFileName('payments', new Date('2026-03-01T10:11:12.000Z'))).toBe(
      'wise-grade-payments-2026-03-01T10-11-12-000Z.csv',
    )
  })

  // -------------------------------------------------------------------------
  // Reconciliation
  // -------------------------------------------------------------------------

  it('detects each reconciliation issue class', () => {
    const now = new Date('2026-03-15T00:00:00.000Z')
    const rows = [
      reconciliationRow({
        id: 'payment-a',
        paymentReference: 'SHARED-REF',
        schoolId: 'school-1',
        providerReference: 'PROVIDER-1',
        submittedAt: new Date('2026-03-01T09:00:00.000Z'),
      }),
      reconciliationRow({
        id: 'payment-b',
        paymentReference: 'shared-ref',
        schoolId: 'school-2',
        school: { name: 'Second School' },
        providerReference: 'PROVIDER-1',
        status: 'REJECTED',
        invoice: {
          ...reconciliationRow().invoice,
          id: 'invoice-2',
          invoiceNumber: 'WG-2026-0002',
          schoolId: 'school-2',
        },
        submittedAt: new Date('2026-03-01T09:00:00.000Z'),
      }),
      reconciliationRow({
        id: 'payment-c',
        schoolId: 'school-1',
        status: 'VERIFIED',
        amountMinor: 12000,
        appliedMinor: 9000,
        overpaymentMinor: 1000,
        currency: 'USD',
        reconciledAt: null,
        submittedAt: new Date('2026-04-15T00:00:00.000Z'),
        invoice: {
          ...reconciliationRow().invoice,
          schoolId: 'school-3',
          currency: 'GHS',
          academicTerm: {
            startsOn: new Date('2026-01-01T00:00:00.000Z'),
            endsOn: new Date('2026-03-01T00:00:00.000Z'),
            name: 'Term 1',
          },
        },
      }),
      reconciliationRow({
        id: 'payment-d',
        amountMinor: 10000,
        submittedAt: new Date('2026-03-01T09:05:00.000Z'),
      }),
      reconciliationRow({
        id: 'payment-e',
        status: 'VERIFIED',
        amountMinor: 10000,
        appliedMinor: 10000,
        overpaymentMinor: 0,
        reconciledAt: null,
        submittedAt: new Date('2026-02-01T00:00:00.000Z'),
      }),
    ]

    const codes = new Set(detectIssues(rows, now).map((item) => item.code))

    expect(codes).toEqual(
      new Set([
        'MISMATCHED_REFERENCE',
        'WRONG_SCHOOL',
        'WRONG_TERM',
        'FAILED_VERIFICATION',
        'INCONSISTENT_AMOUNT',
        'OVERPAYMENT',
        'UNRECONCILED_PAYMENT',
        'DUPLICATE_PROVIDER_REFERENCE',
        'REPEATED_SUBMISSION',
      ]),
    )
  })

  it('filters reconciliation issues and audits manual acknowledgements', async () => {
    operations.reconciliationPage = {
      issues: [
        issue(),
        issue({
          paymentId: 'payment-2',
          code: 'OVERPAYMENT',
          severity: 'WARNING',
          detail: 'Overpayment.',
        }),
      ],
      summary: {
        totalPayments: 2,
        verifiedPayments: 1,
        unreconciledVerified: 1,
        totalIssues: 2,
        criticalIssues: 0,
        warningIssues: 2,
        infoIssues: 0,
        issueCounts: { MISMATCHED_REFERENCE: 1, OVERPAYMENT: 1 },
      },
      generatedAt: '2026-03-01T10:00:00.000Z',
    }

    const filtered = await asPlatform(
      'get',
      '/api/platform/reconciliation?code=OVERPAYMENT',
    )
    expect(filtered.status).toBe(200)
    expect(filtered.body.data.issues).toHaveLength(1)
    expect(filtered.body.data.issues[0].paymentId).toBe('payment-2')
    expect(filtered.body.data.summary.totalIssues).toBe(2)

    const acknowledged = await asPlatform(
      'post',
      '/api/platform/reconciliation/payment-1/acknowledge',
    ).send({ note: 'Confirmed with the school' })

    expect(acknowledged.status).toBe(200)
    expect(acknowledged.body.data.payment.reconciledAt).toEqual(
      expect.any(String),
    )
    expect(operations.audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'PLATFORM_PAYMENT_RECONCILED',
          entityType: 'Payment',
          entityId: 'payment-1',
          metadata: { note: 'Confirmed with the school' },
        }),
      ]),
    )

    const missing = await asPlatform(
      'post',
      '/api/platform/reconciliation/missing/acknowledge',
    ).send({ note: null })
    expect(missing.status).toBe(404)
  })

  it('requires reauthentication before acknowledging a payment', async () => {
    process.env.PLATFORM_REAUTH_ENFORCED = 'true'
    operations.reconciliationPage.issues = [issue()]

    const blocked = await asPlatform(
      'post',
      '/api/platform/reconciliation/payment-1/acknowledge',
    ).send({ note: null })
    expect(blocked.status).toBe(428)

    const grant = await asPlatform('post', '/api/platform/security/reauth').send({
      password: TEST_PASSWORD,
      purpose: 'PAYMENT_RECONCILIATION',
    })
    const allowed = await asPlatform(
      'post',
      '/api/platform/reconciliation/payment-1/acknowledge',
      { 'X-Platform-Reauth': grant.body.data.token },
    ).send({ note: null })

    expect(allowed.status).toBe(200)
  })

  it('rejects school administrators from every new platform surface', async () => {
    const schoolUser = await auth.createUser({
      email: 'admin@school.test',
      password: TEST_PASSWORD,
      firstName: 'School',
      lastName: 'Admin',
      isPlatformAdmin: false,
    })
    const schoolToken = await auth.issueSessionFor(schoolUser.id)

    for (const path of [
      '/api/platform/health',
      '/api/platform/notifications',
      '/api/platform/security',
      '/api/platform/exports',
      '/api/platform/reconciliation',
    ]) {
      const response = await request(app)
        .get(path)
        .set('Cookie', cookie(schoolToken))

      expect(response.status).toBe(403)
    }
  })
})
