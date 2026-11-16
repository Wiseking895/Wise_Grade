/**
 * Safety checks for the live PostgreSQL integration target.
 *
 * Kept separate from the test file so they can be exercised without a database
 * and without registering the live suite.
 */

export interface IntegrationTarget {
  testDatabaseUrl: string
  databaseUrl?: string
  nodeEnv?: string
}

export function databaseName(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\//, '')
  } catch {
    return ''
  }
}

/**
 * Throws unless the target is explicitly a non-production test database.
 * Error messages never include the connection string, user, password, or host.
 */
export function assertSafeIntegrationTarget(target: IntegrationTarget): void {
  if (target.nodeEnv === 'production') {
    throw new Error('Refusing to run integration tests with NODE_ENV=production')
  }

  if (target.databaseUrl && target.databaseUrl === target.testDatabaseUrl) {
    throw new Error(
      'TEST_DATABASE_URL must point to a separate database from DATABASE_URL',
    )
  }

  const name = databaseName(target.testDatabaseUrl)

  if (!/test/i.test(name)) {
    throw new Error(
      `Refusing to run: the TEST_DATABASE_URL database name "${name}" does not contain "test". Use a dedicated non-production database.`,
    )
  }
}
