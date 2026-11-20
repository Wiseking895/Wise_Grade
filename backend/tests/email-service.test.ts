import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import {
  readSmtpConfiguration,
  type EmailEnvironment,
  type SmtpConfigurationResult,
} from '../src/email/config.js'
import {
  NoopEmailService,
  TransactionalEmailService,
} from '../src/email/service.js'
import {
  MAX_DELIVERY_ATTEMPTS,
  type EmailOutboxStore,
  type OutboxRecord,
} from '../src/email/outbox.js'
import {
  renderTemplate,
  type EmailDataMap,
  type EmailTemplateName,
} from '../src/email/templates.js'
import type {
  EmailTransport,
  OutgoingEmail,
} from '../src/email/transport.js'
import { TEST_ORIGIN, TEST_PASSWORD } from './helpers/auth-fixtures.js'
import { FakeAuthRepository } from './helpers/fake-auth-repository.js'
import { FakeSchoolRepository } from './helpers/fake-school-repository.js'

const SMTP_SECRET = 'brevo-smtp-key-do-not-log'
const VERIFICATION_TOKEN = 'verification-token-do-not-store'

function validEnvironment(
  overrides: Partial<EmailEnvironment> = {},
): EmailEnvironment {
  return {
    EMAIL_ENABLED: true,
    SMTP_HOST: 'smtp-relay.brevo.com',
    SMTP_PORT: 587,
    SMTP_SECURE: false,
    SMTP_USER: 'smtp-login@example.com',
    SMTP_PASS: SMTP_SECRET,
    EMAIL_FROM_NAME: 'WiseGrade',
    EMAIL_FROM_ADDRESS: 'no-reply@wisegrade.app',
    EMAIL_REPLY_TO: 'wiseempire62@gmail.com',
    ...overrides,
  }
}

function validConfiguration(): SmtpConfigurationResult {
  const result = readSmtpConfiguration(validEnvironment())
  if (!result.ok) throw new Error('Test configuration should be valid')
  return result
}

class MemoryOutboxStore implements EmailOutboxStore {
  readonly rows = new Map<string, OutboxRecord>()
  private readonly byKey = new Map<string, string>()
  private sequence = 0

  async create(input: {
    dedupeKey: string
    recipient: string
    template: string
    payload: Record<string, unknown>
  }): Promise<{ record: OutboxRecord; created: boolean }> {
    const existingId = this.byKey.get(input.dedupeKey)

    if (existingId) {
      const existing = this.rows.get(existingId)
      if (existing) {
        return { record: { ...existing }, created: false }
      }
    }

    this.sequence += 1
    const record: OutboxRecord = {
      id: `outbox-${this.sequence}`,
      dedupeKey: input.dedupeKey,
      recipient: input.recipient,
      template: input.template,
      payload: input.payload,
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: new Date(0),
      lastErrorCode: null,
      sentAt: null,
      createdAt: new Date(),
    }

    this.rows.set(record.id, record)
    this.byKey.set(input.dedupeKey, record.id)
    return { record: { ...record }, created: true }
  }

  async markSent(id: string, sentAt: Date): Promise<void> {
    const record = this.require(id)
    record.status = 'SENT'
    record.sentAt = sentAt
    record.nextAttemptAt = sentAt
    record.lastErrorCode = null
  }

  async claim(
    id: string,
    input: { expectedAttempts: number; now: Date; leaseUntil: Date },
  ): Promise<boolean> {
    const record = this.require(id)

    if (
      record.status !== 'PENDING' ||
      record.attempts !== input.expectedAttempts ||
      record.nextAttemptAt.getTime() > input.now.getTime()
    ) {
      return false
    }

    record.attempts += 1
    record.nextAttemptAt = input.leaseUntil
    return true
  }

  async markFailed(
    id: string,
    input: {
      errorCode: string
      attempts: number
      nextAttemptAt: Date
      permanent: boolean
    },
  ): Promise<void> {
    const record = this.require(id)
    record.status = input.permanent ? 'FAILED' : 'PENDING'
    record.attempts = input.attempts
    record.nextAttemptAt = input.nextAttemptAt
    record.lastErrorCode = input.errorCode
  }

  async findById(id: string): Promise<OutboxRecord | null> {
    const record = this.rows.get(id)
    return record ? { ...record } : null
  }

  async findDue(now: Date, limit: number): Promise<OutboxRecord[]> {
    return [...this.rows.values()]
      .filter(
        (record) =>
          record.status === 'PENDING' &&
          record.attempts < MAX_DELIVERY_ATTEMPTS &&
          record.nextAttemptAt.getTime() <= now.getTime(),
      )
      .sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime())
      .slice(0, limit)
      .map((record) => ({ ...record }))
  }

  get values(): OutboxRecord[] {
    return [...this.rows.values()]
  }

  private require(id: string): OutboxRecord {
    const record = this.rows.get(id)
    if (!record) throw new Error(`Unknown outbox row ${id}`)
    return record
  }
}

class FakeTransport implements EmailTransport {
  readonly messages: OutgoingEmail[] = []
  verifyCalls = 0
  fail: { code: string } | null = null

  async send(message: OutgoingEmail): Promise<{ messageId: string | null }> {
    if (this.fail) {
      throw Object.assign(new Error('Simulated relay rejection'), {
        code: this.fail.code,
      })
    }

    this.messages.push(message)
    return { messageId: `message-${this.messages.length}` }
  }

  async verify(): Promise<void> {
    this.verifyCalls += 1
    if (this.fail) {
      throw Object.assign(new Error('Simulated authentication failure'), {
        code: this.fail.code,
      })
    }
  }
}

function captureLogger() {
  const lines: string[] = []
  const capture = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '))
  }
  return {
    lines,
    logger: { info: capture, warn: capture, error: capture },
  }
}

const sampleData: { [K in EmailTemplateName]: EmailDataMap[K] } = {
  'admin-welcome': {
    firstName: 'Ada',
    schoolName: 'Green Valley Academy',
    verificationUrl: `https://wisegrade.app/verify-email?token=${VERIFICATION_TOKEN}`,
    expiresAt: '20 November 2026 at 10:00 UTC',
    expiryHours: 24,
  },
  'admin-verified': {
    firstName: 'Ada',
    schoolName: 'Green Valley Academy',
    dashboardUrl: 'https://wisegrade.app/dashboard',
  },
  'admin-verification-resend': {
    firstName: 'Ada',
    schoolName: 'Green Valley Academy',
    verificationUrl: `https://wisegrade.app/verify-email?token=${VERIFICATION_TOKEN}`,
    expiresAt: '20 November 2026 at 10:00 UTC',
    expiryHours: 24,
  },
  'email-change-verification': {
    firstName: 'Ama',
    schoolName: 'Green Valley Academy',
    previousEmail: 'ama.old@example.com',
    verificationUrl: `https://wisegrade.app/verify-email?token=${VERIFICATION_TOKEN}`,
    expiresAt: '20 November 2026 at 10:00 UTC',
    expiryHours: 24,
  },
  'teacher-credentials': {
    firstName: 'Ama',
    schoolName: 'Green Valley Academy',
    className: 'Basic 2',
    loginEmail: 'ama@example.com',
    temporaryPassword: 'TemporaryPass123',
    loginUrl: 'https://wisegrade.app/login',
  },
  'teacher-first-login': {
    firstName: 'Ama',
    schoolName: 'Green Valley Academy',
    loginEmail: 'ama@example.com',
    changePasswordUrl: 'https://wisegrade.app/change-password',
  },
  'subject-assignment': {
    firstName: 'Kofi',
    schoolName: 'Green Valley Academy',
    className: 'Basic 2',
    subjectName: 'Mathematics',
    accessCode: 'access-code-plaintext',
    accessCodeUrl: 'https://wisegrade.app/access-code',
    expiresAt: '25 November 2026 at 10:00 UTC',
  },
  'subject-code-replaced': {
    firstName: 'Kofi',
    schoolName: 'Green Valley Academy',
    className: 'Basic 2',
    subjectName: 'Mathematics',
    accessCode: 'replacement-code-plaintext',
    accessCodeUrl: 'https://wisegrade.app/access-code',
    expiresAt: '25 November 2026 at 10:00 UTC',
  },
  'subject-code-expired': {
    firstName: 'Kofi',
    schoolName: 'Green Valley Academy',
    className: 'Basic 2',
    subjectName: 'Mathematics',
    expiredAt: '25 November 2026 at 10:00 UTC',
    accessCodeUrl: 'https://wisegrade.app/access-code',
  },
  'smtp-test': {
    recipientName: 'Ada',
    sentAt: '19 November 2026 at 09:00 UTC',
    smtpHost: 'smtp-relay.brevo.com',
  },
}

describe('SMTP configuration validation', () => {
  it('reports a disabled service without pretending mail was sent', () => {
    const result = readSmtpConfiguration(
      validEnvironment({ EMAIL_ENABLED: false }),
    )
    if (result.ok) throw new Error('Expected a disabled configuration')

    expect(result.enabled).toBe(false)
    expect(result.missing).toEqual([])
    expect(result.problems).toContain('EMAIL_ENABLED is not true')
  })

  it('lists missing variable names and never their values', () => {
    const result = readSmtpConfiguration({
      EMAIL_ENABLED: true,
      SMTP_PORT: 587,
      SMTP_SECURE: false,
      EMAIL_FROM_NAME: 'WiseGrade',
    })
    if (result.ok) throw new Error('Expected an incomplete configuration')

    expect(result.missing).toEqual(
      expect.arrayContaining([
        'SMTP_HOST',
        'SMTP_USER',
        'SMTP_PASS',
        'EMAIL_FROM_ADDRESS',
      ]),
    )
    expect(JSON.stringify(result)).not.toContain(SMTP_SECRET)
  })

  it('rejects invalid sender and reply-to addresses', () => {
    const result = readSmtpConfiguration(
      validEnvironment({
        EMAIL_FROM_ADDRESS: 'not-an-address',
        EMAIL_REPLY_TO: 'also-not-an-address',
      }),
    )
    if (result.ok) throw new Error('Expected invalid addresses')

    expect(result.problems).toEqual(
      expect.arrayContaining([
        'EMAIL_FROM_ADDRESS is not a valid email address',
        'EMAIL_REPLY_TO is not a valid email address',
      ]),
    )
  })

  it('builds a complete transport configuration with a configurable reply-to', () => {
    const result = validConfiguration()
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.config).toMatchObject({
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false,
      fromName: 'WiseGrade',
      fromAddress: 'no-reply@wisegrade.app',
      replyTo: 'wiseempire62@gmail.com',
    })

    // The only secret in the object is the SMTP password.
    expect(result.config.pass).toBe(SMTP_SECRET)
  })
})

describe('transactional email templates', () => {
  it('renders every template with branded responsive HTML and plain text', () => {
    for (const template of Object.keys(sampleData) as EmailTemplateName[]) {
      const rendered = renderTemplate(
        template,
        sampleData[template] as EmailDataMap[EmailTemplateName],
      )

      expect(rendered.subject).toContain('WiseGrade')
      expect(rendered.html).toContain('<!doctype html>')
      expect(rendered.html).toContain('name="viewport"')
      expect(rendered.html).toContain('max-width:600px')
      expect(rendered.text.length).toBeGreaterThan(80)
      expect(rendered.text).toContain('WiseGrade')
      // No template is HTML-only.
      expect(rendered.text).not.toContain('<table')
    }
  })

  it('includes the details each recipient needs', () => {
    const credentials = renderTemplate(
      'teacher-credentials',
      sampleData['teacher-credentials'],
    )
    expect(credentials.text).toContain('Basic 2')
    expect(credentials.text).toContain('ama@example.com')
    expect(credentials.text).toContain('TemporaryPass123')
    expect(credentials.html).toContain('must replace this temporary password')

    const assignment = renderTemplate(
      'subject-assignment',
      sampleData['subject-assignment'],
    )
    expect(assignment.text).toContain('Mathematics')
    expect(assignment.text).toContain('access-code-plaintext')

    const welcome = renderTemplate('admin-welcome', sampleData['admin-welcome'])
    expect(welcome.html).toContain(VERIFICATION_TOKEN)
    expect(welcome.text).toContain(VERIFICATION_TOKEN)
    expect(welcome.text).toContain('24 hours')
  })

  it('escapes recipient-controlled values instead of injecting HTML', () => {
    const rendered = renderTemplate('admin-welcome', {
      ...sampleData['admin-welcome'],
      firstName: '<script>alert(1)</script>',
      schoolName: 'Green & <b>Valley</b>',
    })

    expect(rendered.html).not.toContain('<script>alert(1)</script>')
    expect(rendered.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(rendered.html).toContain('Green &amp; &lt;b&gt;Valley&lt;/b&gt;')
  })
})

describe('TransactionalEmailService delivery and outbox', () => {
  let store: MemoryOutboxStore
  let transport: FakeTransport
  let logger: ReturnType<typeof captureLogger>
  let clock: Date

  beforeEach(() => {
    store = new MemoryOutboxStore()
    transport = new FakeTransport()
    logger = captureLogger()
    clock = new Date('2026-11-19T09:00:00.000Z')
  })

  function service(): TransactionalEmailService {
    return new TransactionalEmailService({
      configuration: validConfiguration(),
      transport,
      store,
      logger: logger.logger,
      now: () => clock,
    })
  }

  it('sends HTML and text with the configured sender and reply-to', async () => {
    const email = service()
    const result = await email.send({
      template: 'admin-verified',
      to: 'admin@example.com',
      dedupeKey: 'admin-verified:1',
      data: sampleData['admin-verified'],
    })

    expect(result.status).toBe('sent')
    expect(transport.messages).toHaveLength(1)
    expect(transport.messages[0]).toMatchObject({
      to: 'admin@example.com',
      fromName: 'WiseGrade',
      fromAddress: 'no-reply@wisegrade.app',
      replyTo: 'wiseempire62@gmail.com',
    })
    expect(transport.messages[0]?.html).toContain('<!doctype html>')
    expect(transport.messages[0]?.text).toContain('Green Valley Academy')

    expect(store.values[0]).toMatchObject({
      status: 'SENT',
      recipient: 'admin@example.com',
    })
  })

  it('deduplicates the same business event instead of sending twice', async () => {
    const email = service()
    const input = {
      template: 'admin-verified' as const,
      to: 'admin@example.com',
      dedupeKey: 'admin-verified:duplicate',
      data: sampleData['admin-verified'],
    }

    const first = await email.send(input)
    const second = await email.send(input)

    expect(first.status).toBe('sent')
    expect(second).toEqual({
      status: 'duplicate',
      id: first.status === 'sent' ? first.id : '',
      sent: true,
    })
    expect(transport.messages).toHaveLength(1)
  })

  it('queues a non-sensitive failure and retries it when due', async () => {
    const email = service()
    transport.fail = { code: 'ETIMEDOUT' }

    const failed = await email.send({
      template: 'admin-verified',
      to: 'admin@example.com',
      dedupeKey: 'admin-verified:retry',
      data: sampleData['admin-verified'],
    })

    expect(failed).toMatchObject({ status: 'queued', errorCode: 'ETIMEDOUT' })
    expect(store.values[0]).toMatchObject({
      status: 'PENDING',
      attempts: 1,
      lastErrorCode: 'ETIMEDOUT',
    })

    // Not due yet.
    const early = await email.processOutbox()
    expect(early).toEqual({ sent: 0, failed: 0, skipped: 0 })

    clock = new Date(clock.getTime() + 2 * 60 * 1000)
    transport.fail = null

    const retried = await email.processOutbox()
    expect(retried).toEqual({ sent: 1, failed: 0, skipped: 0 })
    expect(store.values[0]?.status).toBe('SENT')
    expect(transport.messages).toHaveLength(1)
  })

  it('prevents concurrent cron drains from delivering the same row twice', async () => {
    const failing = service()
    transport.fail = { code: 'ETIMEDOUT' }

    await failing.send({
      template: 'admin-verified',
      to: 'admin@example.com',
      dedupeKey: 'admin-verified:concurrent-drain',
      data: sampleData['admin-verified'],
    })

    clock = new Date(clock.getTime() + 2 * 60 * 1000)
    transport.fail = null

    const firstWorker = service()
    const secondWorker = service()
    const results = await Promise.all([
      firstWorker.processOutbox(),
      secondWorker.processOutbox(),
    ])

    const totals = results.reduce(
      (sum, result) => ({
        sent: sum.sent + result.sent,
        failed: sum.failed + result.failed,
        skipped: sum.skipped + result.skipped,
      }),
      { sent: 0, failed: 0, skipped: 0 },
    )

    expect(totals).toEqual({ sent: 1, failed: 0, skipped: 1 })
    expect(transport.messages).toHaveLength(1)
    expect(store.values[0]?.status).toBe('SENT')
    expect(store.values[0]?.attempts).toBe(2)
  })

  it('never stores a verification token, temporary password or access code', async () => {
    const email = service()
    transport.fail = { code: 'EAUTH' }

    const verification = await email.send({
      template: 'admin-welcome',
      to: 'admin@example.com',
      dedupeKey: 'verify:1',
      data: sampleData['admin-welcome'],
    })
    const credentials = await email.send({
      template: 'teacher-credentials',
      to: 'teacher@example.com',
      dedupeKey: 'credentials:1',
      data: sampleData['teacher-credentials'],
    })
    const code = await email.send({
      template: 'subject-assignment',
      to: 'subject@example.com',
      dedupeKey: 'code:1',
      data: sampleData['subject-assignment'],
    })

    // A sensitive message is not retried with a redacted payload.
    expect(verification).toMatchObject({ status: 'failed', errorCode: 'EAUTH' })
    expect(credentials.status).toBe('failed')
    expect(code.status).toBe('failed')

    const persisted = JSON.stringify(store.values)
    expect(persisted).not.toContain(VERIFICATION_TOKEN)
    expect(persisted).not.toContain('TemporaryPass123')
    expect(persisted).not.toContain('access-code-plaintext')

    for (const row of store.values) {
      expect(row.status).toBe('FAILED')
    }

    const drained = await email.processOutbox()
    expect(drained).toEqual({ sent: 0, failed: 0, skipped: 0 })
    expect(transport.messages).toHaveLength(0)
  })

  it('never logs the SMTP password, token, temporary password or access code', async () => {
    const email = service()
    transport.fail = { code: 'EAUTH' }

    await email.send({
      template: 'admin-welcome',
      to: 'admin@example.com',
      dedupeKey: 'verify:log',
      data: sampleData['admin-welcome'],
    })
    await email.send({
      template: 'teacher-credentials',
      to: 'teacher@example.com',
      dedupeKey: 'credentials:log',
      data: sampleData['teacher-credentials'],
    })
    await email.send({
      template: 'subject-assignment',
      to: 'subject@example.com',
      dedupeKey: 'code:log',
      data: sampleData['subject-assignment'],
    })

    const logs = logger.lines.join('\n')
    expect(logs).not.toContain(SMTP_SECRET)
    expect(logs).not.toContain(VERIFICATION_TOKEN)
    expect(logs).not.toContain('TemporaryPass123')
    expect(logs).not.toContain('access-code-plaintext')
    expect(logs).toContain('EAUTH')
  })

  it('sanitizes connection verification failures', async () => {
    const email = service()

    expect(await email.verifyConnection()).toEqual({
      configured: true,
      ok: true,
    })
    expect(transport.verifyCalls).toBe(1)

    transport.fail = { code: 'EAUTH' }
    const failed = await email.verifyConnection()
    expect(failed).toEqual({
      configured: true,
      ok: false,
      errorCode: 'EAUTH',
    })
    expect(JSON.stringify(failed)).not.toContain(SMTP_SECRET)
  })

  it('reports incomplete configuration without throwing or sending', async () => {
    const email = new TransactionalEmailService({
      configuration: readSmtpConfiguration({
        ...validEnvironment(),
        SMTP_PASS: undefined,
      }),
      transport,
      store,
      logger: logger.logger,
      now: () => clock,
    })

    const result = await email.send({
      template: 'admin-verified',
      to: 'admin@example.com',
      dedupeKey: 'missing:1',
      data: sampleData['admin-verified'],
    })

    expect(result).toMatchObject({
      status: 'not_configured',
      missing: ['SMTP_PASS'],
    })
    expect(transport.messages).toHaveLength(0)
    expect(store.values).toHaveLength(0)

    const connection = await email.verifyConnection()
    expect(connection).toMatchObject({
      configured: false,
      ok: false,
      errorCode: 'SMTP_CONFIGURATION_INCOMPLETE',
    })
  })

  it('keeps the no-op service free of network access', async () => {
    const email = new NoopEmailService()
    const result = await email.send({
      template: 'admin-verified',
      to: 'admin@example.com',
      dedupeKey: 'noop:1',
      data: sampleData['admin-verified'],
    })

    expect(result).toEqual({ status: 'disabled' })
    expect(email.sent).toEqual([
      { template: 'admin-verified', to: 'admin@example.com' },
    ])
    expect(await email.processOutbox()).toEqual({
      sent: 0,
      failed: 0,
      skipped: 0,
    })
  })
})

describe('administrator SMTP test endpoint', () => {
  let auth: FakeAuthRepository
  let schools: FakeSchoolRepository
  let app: ReturnType<typeof createApp>

  function cookie(token: string): string {
    return `gradely_session=${token}`
  }

  beforeEach(() => {
    auth = new FakeAuthRepository()
    schools = new FakeSchoolRepository(auth)
    app = createApp({
      authRepository: auth,
      schoolRepository: schools,
      // NoopEmailService reports a disabled connection, which is enough to
      // prove authorization without touching a network.
    })
  })

  it('rejects a school administrator and an anonymous caller', async () => {
    const schoolAdmin = await auth.createUser({
      email: 'admin@example.com',
      password: TEST_PASSWORD,
    })
    const token = await auth.issueSessionFor(schoolAdmin.id)

    const anonymous = await request(app).post('/api/platform/email/test')
    expect(anonymous.status).toBe(401)

    const forbidden = await request(app)
      .post('/api/platform/email/test')
      .set('Cookie', cookie(token))
      .set('Origin', TEST_ORIGIN)
      .send({})
    expect(forbidden.status).toBe(403)
  })

  it('returns a sanitized failure for a platform administrator', async () => {
    const platform = await auth.createUser({
      email: 'platform@example.com',
      password: TEST_PASSWORD,
      isPlatformAdmin: true,
    })
    const token = await auth.issueSessionFor(platform.id)

    const response = await request(app)
      .post('/api/platform/email/test')
      .set('Cookie', cookie(token))
      .set('Origin', TEST_ORIGIN)
      .send({})

    // The default test service is a no-op, so verification reports disabled.
    expect(response.status).toBe(502)
    expect(response.body.data).toMatchObject({
      connection: 'failed',
      errorCode: 'EMAIL_DISABLED',
    })
    expect(JSON.stringify(response.body)).not.toContain(SMTP_SECRET)
  })

  it('is not accidentally reachable without the platform prefix', async () => {
    const platform = await auth.createUser({
      email: 'platform2@example.com',
      password: TEST_PASSWORD,
      isPlatformAdmin: true,
    })
    const token = await auth.issueSessionFor(platform.id)

    const response = await request(app)
      .post('/api/email/test')
      .set('Cookie', cookie(token))
      .set('Origin', TEST_ORIGIN)
      .send({})

    expect(response.status).toBe(404)
  })
})
