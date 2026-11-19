import { env } from '../config/env.js'
import {
  readSmtpConfiguration,
  type SmtpConfigurationResult,
} from './config.js'
import {
  createPrismaEmailOutboxStore,
  MAX_DELIVERY_ATTEMPTS,
  type EmailOutboxStore,
  type OutboxRecord,
} from './outbox.js'
import {
  renderTemplate,
  type EmailDataMap,
  type EmailTemplateName,
} from './templates.js'
import {
  createSmtpTransport,
  sanitizeSmtpError,
  type EmailTransport,
} from './transport.js'

export interface EmailMessageInput<T extends EmailTemplateName> {
  template: T
  to: string
  data: EmailDataMap[T]
  /** Stable key for the business event, e.g. `verify-email:<tokenId>`. */
  dedupeKey: string
}

export type EmailDispatchResult =
  | { status: 'sent'; id: string }
  | { status: 'queued'; id: string; errorCode: string }
  | { status: 'duplicate'; id: string; sent: boolean }
  | { status: 'disabled' }
  | { status: 'not_configured'; missing: string[]; problems: string[] }
  | { status: 'failed'; errorCode: string }

export interface SmtpVerificationResult {
  configured: boolean
  ok: boolean
  /** Sanitized code only; never a raw provider message. */
  errorCode?: string
  missing?: string[]
  problems?: string[]
}

export interface OutboxRunResult {
  sent: number
  failed: number
  skipped: number
}

/**
 * The abstraction every feature depends on. `NoopEmailService` implements it
 * for credential-free tests, and `TransactionalEmailService` is the production
 * implementation backed by SMTP and the persisted outbox.
 */
export interface EmailService {
  send<T extends EmailTemplateName>(
    input: EmailMessageInput<T>,
  ): Promise<EmailDispatchResult>
  verifyConnection(): Promise<SmtpVerificationResult>
  processOutbox(limit?: number): Promise<OutboxRunResult>
}

const MAX_ATTEMPTS = MAX_DELIVERY_ATTEMPTS
const OUTBOX_BATCH_SIZE = 25
const SEND_TIMEOUT_MS = 20_000
/**
 * How long a worker owns a row before another instance may retry it if the
 * process dies mid-delivery. Must exceed the SMTP timeout, and is replaced by
 * the normal backoff timestamp after a recorded failure.
 */
const CLAIM_LEASE_MS = SEND_TIMEOUT_MS + 60_000

/**
 * Templates whose payload contains a bearer secret: a verification token,
 * temporary password or reusable access code.
 *
 * Their plaintext must never be written to the outbox. They are sent inline
 * once; if the relay fails, the row is marked FAILED and the business flow
 * offers a fresh resend/reissue instead of retrying the same secret.
 */
const SENSITIVE_TEMPLATES: ReadonlySet<EmailTemplateName> = new Set([
  'admin-welcome',
  'admin-verification-resend',
  'teacher-credentials',
  'subject-assignment',
  'subject-code-replaced',
])

const REDACTED = '[redacted]'

/** Removes bearer secrets before a payload is persisted for deduplication. */
function redactPayload(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const payload = { ...data }

  if ('verificationUrl' in payload) payload.verificationUrl = REDACTED
  if ('temporaryPassword' in payload) payload.temporaryPassword = REDACTED
  if ('accessCode' in payload) payload.accessCode = REDACTED

  return payload
}

const RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
]

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error('Email operation timed out'), { code: 'ETIMEDOUT' }))
    }, ms)

    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export interface TransactionalEmailServiceOptions {
  configuration?: SmtpConfigurationResult
  transport?: EmailTransport
  store?: EmailOutboxStore
  logger?: Pick<Console, 'info' | 'warn' | 'error'>
  now?: () => Date
}

/**
 * SMTP delivery with a durable, deduplicated outbox.
 *
 * A send always persists the intention first, then attempts delivery inline so
 * the common case needs no scheduler. Failures leave a PENDING row with an
 * exponential retry time that the internal outbox endpoint (or the local
 * interval worker) can drain later. Nothing in this class logs a credential,
 * token or access code.
 */
export class TransactionalEmailService implements EmailService {
  private readonly configuration: SmtpConfigurationResult
  private readonly store: EmailOutboxStore
  private readonly transport: EmailTransport | null
  private readonly logger: Pick<Console, 'info' | 'warn' | 'error'>
  private readonly now: () => Date
  private readonly inFlight = new Set<string>()

  constructor(options: TransactionalEmailServiceOptions = {}) {
    this.configuration =
      options.configuration ?? readSmtpConfiguration(env)
    this.store = options.store ?? createPrismaEmailOutboxStore()
    this.transport =
      options.transport ??
      (this.configuration.ok
        ? createSmtpTransport(this.configuration.config)
        : null)
    this.logger = options.logger ?? console
    this.now = options.now ?? (() => new Date())

    if (this.configuration.enabled && !this.configuration.ok) {
      this.logger.warn(
        `[gradely-email] SMTP is not fully configured (missing: ${
          this.configuration.missing.join(', ') || 'none'
        }; ${this.configuration.problems.join('; ') || 'no further detail'}). ` +
          'Transactional email will be skipped, not queued.',
      )
    }
  }

  async send<T extends EmailTemplateName>(
    input: EmailMessageInput<T>,
  ): Promise<EmailDispatchResult> {
    if (!this.configuration.ok) {
      if (this.configuration.enabled) {
        return {
          status: 'not_configured',
          missing: this.configuration.missing,
          problems: this.configuration.problems,
        }
      }

      return { status: 'disabled' }
    }

    let rendered

    try {
      rendered = renderTemplate(input.template, input.data)
    } catch {
      this.logger.error(
        `[gradely-email] template render failed template=${input.template}`,
      )
      return { status: 'failed', errorCode: 'TEMPLATE_RENDER_FAILED' }
    }

    let existing: OutboxRecord

    const sensitive = SENSITIVE_TEMPLATES.has(input.template)

    try {
      const result = await this.store.create({
        dedupeKey: input.dedupeKey,
        recipient: input.to,
        template: input.template,
        // Never persist a verification token, temporary password or access
        // code. A sensitive row exists only to deduplicate the business event;
        // it is never retried with a redacted payload.
        payload: sensitive
          ? redactPayload(input.data as unknown as Record<string, unknown>)
          : (input.data as unknown as Record<string, unknown>),
      })

      existing = result.record

      if (!result.created) {
        if (existing.status === 'SENT') {
          return { status: 'duplicate', id: existing.id, sent: true }
        }

        if (existing.status === 'FAILED') {
          return { status: 'duplicate', id: existing.id, sent: false }
        }
      }
    } catch (error) {
      this.logger.error(
        `[gradely-email] outbox write failed template=${input.template} code=${sanitizeSmtpError(error)}`,
      )
      return { status: 'failed', errorCode: 'OUTBOX_WRITE_FAILED' }
    }

    if (this.inFlight.has(existing.id)) {
      return { status: 'queued', id: existing.id, errorCode: 'IN_FLIGHT' }
    }

    const attempt = existing.attempts + 1
    const claimNow = this.now()
    let claimed: boolean

    try {
      claimed = await this.store.claim(existing.id, {
        expectedAttempts: existing.attempts,
        now: claimNow,
        leaseUntil: new Date(claimNow.getTime() + CLAIM_LEASE_MS),
      })
    } catch (error) {
      this.logger.error(
        `[gradely-email] outbox claim failed outbox=${existing.id} code=${sanitizeSmtpError(error)}`,
      )
      return { status: 'failed', errorCode: 'OUTBOX_CLAIM_FAILED' }
    }

    // Another instance already owns this business event, or a previous failure
    // is still inside its backoff window.
    if (!claimed) {
      return { status: 'queued', id: existing.id, errorCode: 'IN_FLIGHT' }
    }

    this.inFlight.add(existing.id)

    try {
      const outcome = await this.deliver(
        existing.id,
        {
          to: existing.recipient,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        },
        { permanentOnFailure: sensitive, attempt },
      )

      return outcome
    } finally {
      this.inFlight.delete(existing.id)
    }
  }

  private async deliver(
    id: string,
    message: { to: string; subject: string; html: string; text: string },
    options: { permanentOnFailure?: boolean; attempt: number },
  ): Promise<EmailDispatchResult> {
    if (!this.configuration.ok || !this.transport) {
      return { status: 'failed', errorCode: 'SMTP_NOT_CONFIGURED' }
    }

    try {
      await withTimeout(
        this.transport.send({
          ...message,
          fromName: this.configuration.config.fromName,
          fromAddress: this.configuration.config.fromAddress,
          replyTo: this.configuration.config.replyTo,
        }),
        SEND_TIMEOUT_MS,
      )

      try {
        await this.store.markSent(id, this.now())
      } catch (error) {
        // The message was accepted by the relay. A failed status update can at
        // worst cause a retry, which is safer than losing the notification.
        this.logger.error(
          `[gradely-email] sent but could not record status outbox=${id} code=${sanitizeSmtpError(error)}`,
        )
      }

      this.logger.info(`[gradely-email] sent outbox=${id}`)
      return { status: 'sent', id }
    } catch (error) {
      const errorCode = sanitizeSmtpError(error)
      const attempts = options.attempt
      const permanent =
        options.permanentOnFailure === true || attempts >= MAX_ATTEMPTS

      try {
        await this.store.markFailed(id, {
          errorCode,
          attempts,
          nextAttemptAt: new Date(
            this.now().getTime() +
              (RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)] ??
                RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]!),
          ),
          permanent,
        })
      } catch (markError) {
        this.logger.error(
          `[gradely-email] could not record failure outbox=${id} code=${sanitizeSmtpError(markError)}`,
        )
      }

      this.logger.warn(
        `[gradely-email] delivery failed outbox=${id} code=${errorCode} attempt=${attempts}`,
      )

      return permanent
        ? { status: 'failed', errorCode }
        : { status: 'queued', id, errorCode }
    }
  }

  async processOutbox(limit = OUTBOX_BATCH_SIZE): Promise<OutboxRunResult> {
    const summary: OutboxRunResult = { sent: 0, failed: 0, skipped: 0 }

    if (!this.configuration.ok || !this.transport) {
      return summary
    }

    let due: OutboxRecord[]

    try {
      due = await this.store.findDue(this.now(), limit)
    } catch (error) {
      this.logger.error(
        `[gradely-email] outbox read failed code=${sanitizeSmtpError(error)}`,
      )
      return summary
    }

    for (const record of due) {
      if (this.inFlight.has(record.id)) {
        summary.skipped += 1
        continue
      }

      const template = record.template as EmailTemplateName

      // A sensitive payload is redacted at rest and must never be retried,
      // because the plaintext token/password/code is intentionally not stored.
      if (SENSITIVE_TEMPLATES.has(template)) {
        await this.store
          .markFailed(record.id, {
            errorCode: 'SENSITIVE_PAYLOAD_NOT_RETRYABLE',
            attempts: MAX_ATTEMPTS,
            nextAttemptAt: this.now(),
            permanent: true,
          })
          .catch(() => undefined)
        summary.failed += 1
        continue
      }

      const attempt = record.attempts + 1

      if (attempt > MAX_ATTEMPTS) {
        await this.store
          .markFailed(record.id, {
            errorCode: record.lastErrorCode ?? 'RETRY_LIMIT_REACHED',
            attempts: MAX_ATTEMPTS,
            nextAttemptAt: this.now(),
            permanent: true,
          })
          .catch(() => undefined)
        summary.failed += 1
        continue
      }

      const claimNow = this.now()
      let claimed: boolean

      try {
        // Compare-and-set lease: concurrent cron invocations or an inline send
        // cannot deliver the same row. If the process dies, the lease expires
        // and a later run retries it (at-least-once delivery).
        claimed = await this.store.claim(record.id, {
          expectedAttempts: record.attempts,
          now: claimNow,
          leaseUntil: new Date(claimNow.getTime() + CLAIM_LEASE_MS),
        })
      } catch (error) {
        this.logger.error(
          `[gradely-email] outbox claim failed outbox=${record.id} code=${sanitizeSmtpError(error)}`,
        )
        summary.skipped += 1
        continue
      }

      if (!claimed) {
        summary.skipped += 1
        continue
      }

      let rendered

      try {
        rendered = renderTemplate(
          template,
          record.payload as unknown as EmailDataMap[EmailTemplateName],
        )
      } catch {
        await this.store
          .markFailed(record.id, {
            errorCode: 'TEMPLATE_RENDER_FAILED',
            attempts: attempt,
            nextAttemptAt: this.now(),
            permanent: true,
          })
          .catch(() => undefined)
        summary.failed += 1
        continue
      }

      this.inFlight.add(record.id)

      try {
        const result = await this.deliver(
          record.id,
          {
            to: record.recipient,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
          },
          { attempt },
        )

        if (result.status === 'sent') {
          summary.sent += 1
        } else if (result.status === 'failed') {
          summary.failed += 1
        } else {
          summary.skipped += 1
        }
      } finally {
        this.inFlight.delete(record.id)
      }
    }

    return summary
  }

  async verifyConnection(): Promise<SmtpVerificationResult> {
    if (!this.configuration.ok) {
      return {
        configured: false,
        ok: false,
        errorCode: this.configuration.enabled
          ? 'SMTP_CONFIGURATION_INCOMPLETE'
          : 'EMAIL_DISABLED',
        missing: this.configuration.missing,
        problems: this.configuration.problems,
      }
    }

    if (!this.transport) {
      return { configured: false, ok: false, errorCode: 'SMTP_NOT_CONFIGURED' }
    }

    try {
      await withTimeout(this.transport.verify(), SEND_TIMEOUT_MS)
      return { configured: true, ok: true }
    } catch (error) {
      return {
        configured: true,
        ok: false,
        errorCode: sanitizeSmtpError(error),
      }
    }
  }
}

/** Used by tests and by environments where transactional email is disabled. */
export class NoopEmailService implements EmailService {
  readonly sent: Array<{ template: string; to: string }> = []

  async send<T extends EmailTemplateName>(
    _input: EmailMessageInput<T>,
  ): Promise<EmailDispatchResult> {
    this.sent.push({ template: _input.template, to: _input.to })
    return { status: 'disabled' }
  }

  async verifyConnection(): Promise<SmtpVerificationResult> {
    return { configured: false, ok: false, errorCode: 'EMAIL_DISABLED' }
  }

  async processOutbox(): Promise<OutboxRunResult> {
    return { sent: 0, failed: 0, skipped: 0 }
  }
}
