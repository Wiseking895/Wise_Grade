import { describe, expect, it } from 'vitest'
import { assertSafeIntegrationTarget, databaseName } from './target.js'

const SAFE_TEST_URL = 'postgresql://127.0.0.1:5432/gradely_integration_test'
const DEVELOPMENT_URL = 'postgresql://127.0.0.1:5432/gradely_development'

describe('integration target safety', () => {
  it('extracts the database name without exposing the connection string', () => {
    expect(databaseName(SAFE_TEST_URL)).toBe('gradely_integration_test')
    expect(databaseName('not-a-url')).toBe('')
  })

  it('accepts a dedicated non-production test database', () => {
    expect(() =>
      assertSafeIntegrationTarget({
        testDatabaseUrl: SAFE_TEST_URL,
        databaseUrl: DEVELOPMENT_URL,
        nodeEnv: 'test',
      }),
    ).not.toThrow()
  })

  it('refuses to run in production', () => {
    expect(() =>
      assertSafeIntegrationTarget({
        testDatabaseUrl: SAFE_TEST_URL,
        databaseUrl: DEVELOPMENT_URL,
        nodeEnv: 'production',
      }),
    ).toThrow(/NODE_ENV=production/)
  })

  it('refuses to reuse DATABASE_URL as the test target', () => {
    expect(() =>
      assertSafeIntegrationTarget({
        testDatabaseUrl: SAFE_TEST_URL,
        databaseUrl: SAFE_TEST_URL,
        nodeEnv: 'test',
      }),
    ).toThrow(/separate database/)
  })

  it('refuses a database name that does not contain "test"', () => {
    expect(() =>
      assertSafeIntegrationTarget({
        testDatabaseUrl: DEVELOPMENT_URL,
        databaseUrl: 'postgresql://127.0.0.1:5432/gradely_other',
        nodeEnv: 'test',
      }),
    ).toThrow(/does not contain "test"/)
  })
})
