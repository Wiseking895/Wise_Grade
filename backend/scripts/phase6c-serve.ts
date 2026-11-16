/**
 * Phase 6C browser-QA API launcher.
 *
 * Runs the real Express app against the dedicated TEST_DATABASE_URL on an
 * isolated port so browser tests never touch the development database and do
 * not collide with a normal `npm run dev` process.
 */
import { loadProjectEnvFile } from '../src/config/env-file.js'
import { assertSafeIntegrationTarget } from '../tests/integration/target.js'

loadProjectEnvFile()

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim()

if (!testDatabaseUrl) {
  console.error(
    'PHASE6C SERVE BLOCKED: TEST_DATABASE_URL is not set. No server was started.',
  )
  process.exit(1)
}

assertSafeIntegrationTarget({
  testDatabaseUrl,
  databaseUrl: process.env.DATABASE_URL?.trim(),
  nodeEnv: process.env.NODE_ENV,
})

process.env.DATABASE_URL = testDatabaseUrl
process.env.NODE_ENV = 'test'
process.env.PORT = process.env.PHASE6C_API_PORT ?? '4100'
process.env.CORS_ORIGINS =
  process.env.PHASE6C_FRONTEND_ORIGIN ?? 'http://localhost:5174'
process.env.FRONTEND_URL =
  process.env.PHASE6C_FRONTEND_ORIGIN ?? 'http://localhost:5174'

await import('../src/index.js')
