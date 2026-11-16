import 'dotenv/config'
import { defineConfig } from 'prisma/config'

// Offline Prisma commands (generate, validate, migrate diff) only need a
// syntactically valid URL. This fallback is a localhost-only placeholder, not a
// credential, and cannot connect to a real database.
const fallbackDatabaseUrl =
  'postgresql://placeholder:placeholder@localhost:5432/gradely?schema=public'

const databaseUrl = process.env.DATABASE_URL ?? fallbackDatabaseUrl

// Refuse to let database-mutating Prisma commands silently fall back to the
// placeholder. `migrate diff` is intentionally excluded because it is
// read-only and must work without credentials.
const argv = process.argv.join(' ')
const lifecycle = process.env.npm_lifecycle_event ?? ''
const requiresRealDatabase =
  /\bmigrate\s+(deploy|dev|reset|resolve|status)\b/.test(argv) ||
  /\bdb\s+(push|execute|seed)\b/.test(argv) ||
  /^prisma:(migrate:|db:)/.test(lifecycle)

if (requiresRealDatabase && !process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required for Prisma migration/database commands. Copy backend/.env.example to backend/.env and configure a real PostgreSQL connection string. The placeholder URL is never used for migrations.',
  )
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: databaseUrl,
  },
})
