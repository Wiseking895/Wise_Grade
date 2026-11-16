import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { loadEnvFile } from './src/config/env-file.js'

// Load backend/.env before any test module is collected. This is what makes
// TEST_DATABASE_URL reachable by the live integration suite when it is supplied
// through .env rather than exported in the shell.
//
// GRADELY_ENV_FILE exists so the credential-free runner test can point at a
// temporary fixture. Values already present in process.env always win, because
// loadEnvFile passes `override: false` to dotenv.
loadEnvFile(
  process.env.GRADELY_ENV_FILE ??
    fileURLToPath(new URL('./.env', import.meta.url)),
)

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    restoreMocks: true,
    // Report PDF rendering is CPU-heavy. The default 5s timeout is too tight
    // when Vitest runs the full suite across many parallel workers.
    testTimeout: 15_000,
  },
})
