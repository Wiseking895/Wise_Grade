import { defineConfig } from 'prisma/config'
import { loadEnvFile, resolveEnvFile } from './src/config/env-file.js'

// Explicit profile selection: .env (local) by default, or
// GRADELY_ENV_FILE=.env.production.local for owner-approved production tooling.
// Duplicate keys fail loudly instead of silently overriding each other.
loadEnvFile(resolveEnvFile())

// Offline Prisma commands (generate, validate, migrate diff) only need a
// syntactically valid URL. This fallback is a localhost-only placeholder, not a
// credential, and cannot connect to a real database.
const fallbackDatabaseUrl =
  'postgresql://placeholder:placeholder@localhost:5432/gradely?schema=public'

const databaseUrl = process.env.DATABASE_URL ?? fallbackDatabaseUrl

// Neon's pooled endpoint is ideal for the application runtime but cannot run
// every migration reliably. When DIRECT_DATABASE_URL is provided, Prisma
// commands (including `migrate deploy`) use the direct endpoint instead.
const directDatabaseUrl = process.env.DIRECT_DATABASE_URL?.trim()
const selectedDatabaseUrl = directDatabaseUrl || databaseUrl

/**
 * The native Schema Engine (used by migrate/status/db pull) has its own Rust
 * TCP stack and defaults to a short connect timeout. Neon suspends idle
 * computes, so the first connection can take several seconds. Node's `pg`
 * driver is unaffected because the application does not use this config.
 *
 * Append the timeout only when the profile does not already set one. This
 * avoids rewriting the URL (and therefore avoids re-encoding credentials).
 */
function withConnectTimeout(url: string): string {
  if (/[?&]connect_timeout=/.test(url)) {
    return url
  }

  return `${url}${url.includes('?') ? '&' : '?'}connect_timeout=30`
}

const resolvedDatabaseUrl = withConnectTimeout(selectedDatabaseUrl)

// Refuse to let database-mutating Prisma commands silently fall back to the
// placeholder. `migrate diff` is intentionally excluded because it is
// read-only and must work without credentials.
const argv = process.argv.join(' ')
const lifecycle = process.env.npm_lifecycle_event ?? ''
const requiresRealDatabase =
  /\bmigrate\s+(deploy|dev|reset|resolve|status)\b/.test(argv) ||
  /\bdb\s+(push|execute|seed)\b/.test(argv) ||
  /^prisma:(migrate:|db:)/.test(lifecycle)

if (
  requiresRealDatabase &&
  !process.env.DATABASE_URL &&
  !directDatabaseUrl
) {
  throw new Error(
    'DATABASE_URL (or DIRECT_DATABASE_URL) is required for Prisma migration/database commands. Copy backend/.env.example to backend/.env and configure a real PostgreSQL connection string. The placeholder URL is never used for migrations.',
  )
}

// Safety net for the local profile mix-up that previously left a production
// URL in backend/.env. Read-only commands (status, db pull, migrate diff) are
// allowed; only commands that can change schema or data require an explicit
// profile when the target is remote.
const mutatingCommand =
  /\bmigrate\s+(deploy|dev|reset|resolve)\b/.test(argv) ||
  /\bdb\s+(push|execute|seed)\b/.test(argv) ||
  /^prisma:(migrate:(deploy|dev|reset|resolve)|db:(push|execute|seed))/.test(
    lifecycle,
  )

const explicitProfile = Boolean(
  process.env.GRADELY_ENV_FILE?.trim() ||
    process.env.GRADELY_ENV_PROFILE?.trim(),
)

const isLocalDatabase = (() => {
  try {
    const host = new URL(selectedDatabaseUrl).hostname.toLowerCase()
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '[::1]'
    )
  } catch {
    return false
  }
})()

if (
  mutatingCommand &&
  !explicitProfile &&
  !isLocalDatabase &&
  process.env.NODE_ENV !== 'production'
) {
  throw new Error(
    'Refusing to run a database-mutating Prisma command against a remote database without an explicit environment profile. Select the intended profile first, for example: $env:GRADELY_ENV_FILE=\'.env.production.local\'',
  )
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: resolvedDatabaseUrl,
  },
})
