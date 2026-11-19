import type {
  EmailDispatchResult,
  EmailMessageInput,
  EmailService,
  OutboxRunResult,
  SmtpVerificationResult,
} from '../../src/email/service.js'
import type { EmailTemplateName } from '../../src/email/templates.js'

export interface CapturedEmail<T extends EmailTemplateName = EmailTemplateName> {
  template: T
  to: string
  dedupeKey: string
  data: Record<string, unknown>
}

/**
 * In-memory email double for HTTP tests.
 *
 * Nothing here connects to a network. Tests can inspect exactly what would be
 * sent, including the single-use links and access codes, without those secrets
 * ever appearing in an API response or log.
 */
export class CaptureEmailService implements EmailService {
  readonly messages: CapturedEmail[] = []
  readonly dedupeKeys = new Set<string>()
  failNextSend = false
  /** When set, overrides the default successful dispatch result. */
  nextResult: EmailDispatchResult | null = null
  connection: SmtpVerificationResult = { configured: true, ok: true }
  outbox: OutboxRunResult = { sent: 0, failed: 0, skipped: 0 }

  async send<T extends EmailTemplateName>(
    input: EmailMessageInput<T>,
  ): Promise<EmailDispatchResult> {
    if (this.failNextSend) {
      this.failNextSend = false
      return { status: 'failed', errorCode: 'SMTP_FAILURE' }
    }

    if (this.nextResult) {
      const result = this.nextResult
      this.nextResult = null
      return result
    }

    this.dedupeKeys.add(input.dedupeKey)
    this.messages.push({
      template: input.template,
      to: input.to,
      dedupeKey: input.dedupeKey,
      data: input.data as unknown as Record<string, unknown>,
    })

    return { status: 'sent', id: `capture-${this.messages.length}` }
  }

  async verifyConnection(): Promise<SmtpVerificationResult> {
    return this.connection
  }

  async processOutbox(): Promise<OutboxRunResult> {
    return this.outbox
  }

  /** Most recent message for a template, or undefined. */
  last<T extends EmailTemplateName>(
    template: T,
  ): CapturedEmail<T> | undefined {
    for (let index = this.messages.length - 1; index >= 0; index -= 1) {
      const message = this.messages[index]

      if (message?.template === template) {
        return message as CapturedEmail<T>
      }
    }

    return undefined
  }

  all<T extends EmailTemplateName>(template: T): CapturedEmail<T>[] {
    return this.messages.filter(
      (message): message is CapturedEmail<T> => message.template === template,
    )
  }

  /** Extracts a token from a captured verification link. */
  verificationToken(template: 'admin-welcome' | 'admin-verification-resend'): string {
    const message = this.last(template)

    if (!message) {
      throw new Error(`No ${template} email was captured`)
    }

    const url = String(message.data.verificationUrl)
    const token = new URL(url).searchParams.get('token')

    if (!token) {
      throw new Error('The captured verification email has no token')
    }

    return token
  }
}
