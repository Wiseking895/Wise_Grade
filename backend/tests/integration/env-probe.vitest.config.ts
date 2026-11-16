import baseConfig from '../../vitest.config.js'

/**
 * Credential-free probe config.
 *
 * Importing the real Vitest config above runs its `loadEnvFile` side effect, so
 * this config proves the integration runner itself reads GRADELY_ENV_FILE.
 * Collection is narrowed to the probe so no live suite or database is touched.
 */
export default {
  ...baseConfig,
  test: {
    ...(baseConfig.test ?? {}),
    include: ['tests/integration/env-loading.probe.ts'],
  },
}
