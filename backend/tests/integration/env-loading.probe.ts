import { describe, expect, it } from 'vitest'

/**
 * Executed only by the credential-free probe config in
 * `env-probe.vitest.config.ts`, which imports the real integration runner
 * config. Never connects to a database.
 */
describe('integration runner environment loading', () => {
  it('loads a variable supplied only by the env file', () => {
    expect(process.env.GRADELY_ENV_FIXTURE_ONLY).toBe('from-env-file')
  })

  it('keeps an explicitly supplied process environment value', () => {
    expect(process.env.GRADELY_ENV_FIXTURE_OVERRIDE).toBe('from-process')
  })

  it('makes TEST_DATABASE_URL available to the integration suite', () => {
    expect(process.env.TEST_DATABASE_URL).toBeTruthy()
  })
})
