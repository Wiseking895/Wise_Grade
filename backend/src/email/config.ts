import { env } from '../config/env.js'

/**
 * Fully validated SMTP transport settings.
 *
 * `pass` is deliberately the only secret in this object. It is never logged,
 * serialized into an API response or written to the outbox.
 */
export interface SmtpConfiguration {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
  fromName: string
  fromAddress: string
  replyTo: string | null
}

export type SmtpConfigurationResult =
  | { ok: true; enabled: true; config: SmtpConfiguration; missing: [] }
  | {
      ok: false
      enabled: boolean
      config: null
      /** Variable names only. Values are never included. */
      missing: string[]
      /** Human-readable, secret-free reasons. */
      problems: string[]
    }

export interface EmailEnvironment {
  EMAIL_ENABLED: boolean
  SMTP_HOST?: string
  SMTP_PORT: number
  SMTP_SECURE: boolean
  SMTP_USER?: string
  SMTP_PASS?: string
  EMAIL_FROM_NAME: string
  EMAIL_FROM_ADDRESS?: string
  EMAIL_REPLY_TO?: string
}

const SIMPLE_EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/

/**
 * Reads and validates the SMTP configuration without ever exposing values.
 *
 * Returns a disabled result (rather than throwing) when mail is switched off or
 * incomplete, so a missing optional configuration can never stop the API from
 * starting or break an unrelated request.
 */
export function readSmtpConfiguration(
  source: EmailEnvironment = env,
): SmtpConfigurationResult {
  if (!source.EMAIL_ENABLED) {
    return {
      ok: false,
      enabled: false,
      config: null,
      missing: [],
      problems: ['EMAIL_ENABLED is not true'],
    }
  }

  const missing: string[] = []
  const problems: string[] = []

  if (!source.SMTP_HOST) missing.push('SMTP_HOST')
  if (!source.SMTP_USER) missing.push('SMTP_USER')
  if (!source.SMTP_PASS) missing.push('SMTP_PASS')
  if (!source.EMAIL_FROM_ADDRESS) missing.push('EMAIL_FROM_ADDRESS')

  if (!Number.isInteger(source.SMTP_PORT) || source.SMTP_PORT <= 0) {
    problems.push('SMTP_PORT must be a valid port number')
  }

  if (
    source.EMAIL_FROM_ADDRESS &&
    !SIMPLE_EMAIL.test(source.EMAIL_FROM_ADDRESS)
  ) {
    problems.push('EMAIL_FROM_ADDRESS is not a valid email address')
  }

  if (source.EMAIL_REPLY_TO && !SIMPLE_EMAIL.test(source.EMAIL_REPLY_TO)) {
    problems.push('EMAIL_REPLY_TO is not a valid email address')
  }

  if (missing.length > 0 || problems.length > 0) {
    return {
      ok: false,
      enabled: true,
      config: null,
      missing,
      problems,
    }
  }

  return {
    ok: true,
    enabled: true,
    missing: [],
    config: {
      host: source.SMTP_HOST!,
      port: source.SMTP_PORT,
      secure: source.SMTP_SECURE,
      user: source.SMTP_USER!,
      pass: source.SMTP_PASS!,
      fromName: source.EMAIL_FROM_NAME,
      fromAddress: source.EMAIL_FROM_ADDRESS!,
      replyTo: source.EMAIL_REPLY_TO ?? null,
    },
  }
}
