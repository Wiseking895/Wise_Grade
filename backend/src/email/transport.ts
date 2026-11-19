import nodemailer, { type Transporter } from 'nodemailer'
import type { SmtpConfiguration } from './config.js'

export interface OutgoingEmail {
  to: string
  subject: string
  html: string
  text: string
  fromName: string
  fromAddress: string
  replyTo: string | null
}

export interface EmailTransport {
  send(message: OutgoingEmail): Promise<{ messageId: string | null }>
  /** Authenticates with the relay without sending a message. */
  verify(): Promise<void>
}

/**
 * Maps a Nodemailer/SMTP failure to a short, non-secret code. Raw provider
 * messages can echo configuration values, so they are never persisted or
 * returned to a client.
 */
export function sanitizeSmtpError(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code
    const responseCode = (error as { responseCode?: unknown }).responseCode

    if (typeof code === 'string' && /^[A-Z0-9_]{2,40}$/.test(code)) {
      return code
    }

    if (typeof responseCode === 'number') {
      return `SMTP_${responseCode}`
    }
  }

  return 'SMTP_DELIVERY_FAILED'
}

export function createSmtpTransport(
  config: SmtpConfiguration,
): EmailTransport {
  const transporter: Transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
    // Keep the connection bounded so a hung relay cannot stall an API request.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })

  return {
    async send(message) {
      const result = await transporter.sendMail({
        from: {
          name: message.fromName,
          address: message.fromAddress,
        },
        replyTo: message.replyTo ?? undefined,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      })

      return { messageId: result.messageId ?? null }
    },
    async verify() {
      await transporter.verify()
    },
  }
}
