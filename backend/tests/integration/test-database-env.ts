/**
 * Integration-only prelude.
 *
 * `src/config/env.ts` snapshots `process.env.DATABASE_URL` when it is first
 * imported. Import this module before any repository module so the live suites
 * use the dedicated TEST_DATABASE_URL instead of the development database.
 */
const configuredDatabaseUrl = process.env.DATABASE_URL?.trim()
const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim()

if (testDatabaseUrl) {
  process.env.DATABASE_URL = testDatabaseUrl
}

export const integrationEnvironment = {
  testDatabaseUrl,
  configuredDatabaseUrl,
}
