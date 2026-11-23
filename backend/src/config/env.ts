import { z } from 'zod'
import { loadProjectEnvFile } from './env-file.js'

// Process environment values take precedence over backend/.env.
loadProjectEnvFile()

/**
 * Local Vite origins that are always trusted in development. Vite serves on
 * 5173 and falls forward to 5174 when that port is already taken, so both must
 * work without editing configuration. These are never allowed in production.
 */
const DEV_LOOPBACK_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
] as const

const LOOPBACK_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
])

/**
 * Parses one configured browser origin.
 *
 * Only a scheme, host and optional port are accepted. Wildcards, paths,
 * queries, fragments and embedded credentials are rejected because an origin
 * allow-list that contains them cannot be compared safely with the browser's
 * `Origin` header.
 */
function parseOrigin(value: string, label: string): URL {
  const trimmed = value.trim()

  if (!trimmed) {
    throw new Error(`${label} must not be empty`)
  }

  if (trimmed.includes('*')) {
    throw new Error(
      `${label} must list explicit origins; wildcards are not allowed`,
    )
  }

  let url: URL

  try {
    url = new URL(trimmed)
  } catch {
    throw new Error(
      `${label} must be an absolute origin such as https://app.example.com`,
    )
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${label} must use http or https`)
  }

  if (url.username || url.password) {
    throw new Error(`${label} must not contain credentials`)
  }

  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(
      `${label} must be an origin only, with no path, query or fragment`,
    )
  }

  return url
}

/** Normalizes an origin to the exact value a browser sends in `Origin`. */
export function normalizeOrigin(value: string, label = 'origin'): string {
  return parseOrigin(value, label).origin
}

/**
 * Production origins must be real HTTPS deployments. A localhost origin in a
 * production allow-list would mean the deployed API still trusts a developer
 * machine, so it is rejected loudly instead of silently accepted.
 */
function assertProductionOrigin(value: string, label: string): string {
  const url = parseOrigin(value, label)

  if (url.protocol !== 'https:') {
    throw new Error(`${label} must use https in production`)
  }

  if (LOOPBACK_HOSTNAMES.has(url.hostname.toLowerCase())) {
    throw new Error(
      `${label} must be the deployed frontend origin, not a localhost address`,
    )
  }

  return url.origin
}

export interface OriginConfiguration {
  NODE_ENV: 'development' | 'test' | 'production'
  CORS_ORIGINS?: string
  FRONTEND_URL: string
}

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    CORS_ORIGINS: z.string().trim().min(1).optional(),
    FRONTEND_URL: z.url().default('http://localhost:5173'),
    DATABASE_URL: z.string().trim().min(1).optional(),
    /**
     * Optional direct (non-pooled) Neon connection used only by Prisma
     * migration commands. The application always uses DATABASE_URL, which
     * should point at the pooled endpoint on serverless platforms.
     */
    DIRECT_DATABASE_URL: z.string().trim().min(1).optional(),
    /**
     * Maximum pg pool size per function instance. Serverless platforms should
     * keep this small because Neon already pools connections at the proxy.
     */
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),

    // AUTH_SECRET also derives the AES-256-GCM key that encrypts optional
    // platform-admin MFA secrets at rest. Development may fall back to a
    // non-production key, but production must set it before MFA enrollment.
    AUTH_SECRET: z.string().min(1).optional(),
    AUTH_SESSION_TTL_MINUTES: z.coerce
      .number()
      .int()
      .positive()
      .default(60),
    /**
     * Hard server-side inactivity limit. The frontend warns shortly before it
     * and signs out at the same moment, but this value is authoritative: a
     * request whose session has not been used within this window is rejected
     * even if a client timer was suppressed or a tab was asleep.
     */
    AUTH_IDLE_TIMEOUT_SECONDS: z.coerce
      .number()
      .int()
      .min(5)
      .max(86400)
      .default(60),
    /**
     * Overrides the session cookie SameSite policy. Production defaults to
     * `none` while the web app and API are on different sites. Once the
     * same-origin `/api` arrangement is verified, set `lax` to stop relying on
     * third-party cookies. Local development always defaults to `lax`.
     */
    AUTH_COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).optional(),
    CALENDAR_SCHEDULER_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    CALENDAR_SCHEDULER_INTERVAL_MINUTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(1440)
      .default(60),
    /**
     * Shared secret for the protected scheduled-calendar endpoint. Vercel Cron
     * sends it automatically as `Authorization: Bearer $CRON_SECRET`.
     */
    CRON_SECRET: z.string().min(16).optional(),
    R2_ACCOUNT_ID: z.string().min(1).optional(),
    R2_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    R2_BUCKET_NAME: z.string().min(1).optional(),
    // Reverse geocoding for the optional "detect my location" dashboard
    // indicator. Coordinates are forwarded once per user request and never
    // stored. The default provider is OpenStreetMap Nominatim, which needs no
    // API key but does require an identifying User-Agent. Point
    // REVERSE_GEOCODING_URL at a self-hosted Nominatim instance or another
    // Nominatim-compatible service to avoid the public endpoint.
    REVERSE_GEOCODING_URL: z
      .url()
      .default('https://nominatim.openstreetmap.org/reverse'),
    REVERSE_GEOCODING_API_KEY: z.string().trim().min(1).optional(),
    REVERSE_GEOCODING_USER_AGENT: z.string().trim().min(1).optional(),
    PAYMENT_PROVIDER: z.string().min(1).optional(),
    PAYMENT_SECRET_KEY: z.string().min(1).optional(),
    PAYMENT_WEBHOOK_SECRET: z.string().min(1).optional(),

    // -----------------------------------------------------------------------
    // Transactional email (Brevo SMTP relay)
    // -----------------------------------------------------------------------
    // Every value is optional so the API still starts in environments that do
    // not send mail (local unit tests, preview deployments). When EMAIL_ENABLED
    // is true the email service validates the transport at first use and
    // reports a sanitized configuration error instead of crashing the API.
    SMTP_HOST: z.string().trim().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    SMTP_USER: z.string().trim().min(1).optional(),
    SMTP_PASS: z.string().min(1).optional(),
    EMAIL_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    EMAIL_FROM_NAME: z.string().trim().min(1).default('WiseGrade'),
    EMAIL_FROM_ADDRESS: z.string().trim().min(1).optional(),
    EMAIL_REPLY_TO: z.string().trim().min(1).optional(),
    /**
     * Optional fixed recipient for the administrator-only SMTP test. When it is
     * unset the authenticated platform administrator's own address is used, so
     * the endpoint can never be pointed at an arbitrary recipient.
     */
    EMAIL_TEST_RECIPIENT: z.string().trim().min(1).optional(),
    EMAIL_VERIFICATION_EXPIRY_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(168)
      .default(24),
    SUBJECT_TEACHER_ACCESS_CODE_EXPIRY_DAYS: z.coerce
      .number()
      .int()
      .min(1)
      .max(30)
      .default(7),
    BACKEND_URL: z.url().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== 'production') {
      return
    }

    if (!value.CORS_ORIGINS) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message:
          'CORS_ORIGINS is required in production so the API does not allow every origin.',
      })
    } else {
      for (const [index, raw] of value.CORS_ORIGINS.split(',').entries()) {
        if (!raw.trim()) {
          continue
        }

        try {
          assertProductionOrigin(raw, `CORS_ORIGINS[${index}]`)
        } catch (error) {
          ctx.addIssue({
            code: 'custom',
            path: ['CORS_ORIGINS'],
            message: (error as Error).message,
          })
        }
      }
    }

    try {
      assertProductionOrigin(value.FRONTEND_URL, 'FRONTEND_URL')
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        path: ['FRONTEND_URL'],
        message: (error as Error).message,
      })
    }

    // A production deployment that enables the scheduler but cannot protect
    // its trigger would either never run or run unauthenticated. Fail loudly
    // instead of silently disabling an important production job.
    if (value.CALENDAR_SCHEDULER_ENABLED && !value.CRON_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['CRON_SECRET'],
        message:
          'CRON_SECRET is required in production when CALENDAR_SCHEDULER_ENABLED is true. Set CALENDAR_SCHEDULER_ENABLED=false to disable scheduled calendar runs explicitly.',
      })
    }
  })

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => {
      const field = issue.path.join('.') || 'environment'
      return `- ${field}: ${issue.message}`
    })
    .join('\n')

  throw new Error(`Invalid environment configuration:\n${details}`)
}

export const env = parsed.data

/**
 * Builds the exact origin allow-list used by CORS and the cookie CSRF guard.
 *
 * Development always trusts the local Vite ports (5173 and 5174) plus the
 * configured `FRONTEND_URL`, so running the client on either port works without
 * configuration drift. Production trusts only explicitly configured HTTPS
 * origins and never includes a localhost fallback.
 */
export function getAllowedOriginsFor(
  config: OriginConfiguration,
): string[] {
  const isProduction = config.NODE_ENV === 'production'
  const normalize = (value: string, label: string) =>
    isProduction
      ? assertProductionOrigin(value, label)
      : normalizeOrigin(value, label)

  const origins = (config.CORS_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value, index) => normalize(value, `CORS_ORIGINS[${index}]`))

  origins.push(normalize(config.FRONTEND_URL, 'FRONTEND_URL'))

  if (!isProduction) {
    origins.push(...DEV_LOOPBACK_ORIGINS)
  }

  return [...new Set(origins)]
}

export function getAllowedOrigins(): string[] {
  return getAllowedOriginsFor(env)
}
