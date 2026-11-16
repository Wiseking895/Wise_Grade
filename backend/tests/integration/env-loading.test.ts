import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const backendRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const vitestBin = resolve(backendRoot, 'node_modules', 'vitest', 'vitest.mjs')
const probeConfig = resolve(
  backendRoot,
  'tests',
  'integration',
  'env-probe.vitest.config.ts',
)

/**
 * Keeps diagnostics useful without ever echoing a database URL or password.
 */
function redactUrls(value: string | null): string {
  return (value ?? '').replace(
    /(?:postgres(?:ql)?|https?):\/\/\S+/gi,
    '[redacted-url]',
  )
}

describe('integration runner environment loading', () => {
  it('loads a temporary .env fixture without overriding process variables', async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), 'gradely-env-'))

    try {
      const envFile = join(tempDirectory, '.env')
      await writeFile(
        envFile,
        [
          'GRADELY_ENV_FIXTURE_ONLY=from-env-file',
          'GRADELY_ENV_FIXTURE_OVERRIDE=from-env-file',
          // Deliberately credential-free and never connected to.
          'TEST_DATABASE_URL=postgresql://127.0.0.1:5432/gradely_env_fixture_test',
          '',
        ].join('\n'),
        'utf8',
      )

      const childEnv: NodeJS.ProcessEnv = { ...process.env }

      // Start from a clean slate for the variables under test so the probe
      // proves where each value came from.
      for (const key of Object.keys(childEnv)) {
        if (
          key === 'DATABASE_URL' ||
          key === 'TEST_DATABASE_URL' ||
          key === 'GRADELY_ENV_FIXTURE_ONLY' ||
          key === 'GRADELY_ENV_FIXTURE_OVERRIDE' ||
          key.startsWith('VITEST')
        ) {
          delete childEnv[key]
        }
      }

      childEnv.GRADELY_ENV_FILE = envFile
      childEnv.GRADELY_ENV_FIXTURE_OVERRIDE = 'from-process'

      const result = spawnSync(
        process.execPath,
        [
          vitestBin,
          'run',
          '--config',
          probeConfig,
          '--reporter=dot',
          '--no-color',
        ],
        {
          cwd: backendRoot,
          env: childEnv,
          encoding: 'utf8',
          timeout: 90_000,
        },
      )

      if (result.error) {
        throw result.error
      }

      if (result.status !== 0) {
        throw new Error(
          [
            `Environment-loading probe failed with status ${result.status}.`,
            redactUrls(result.stdout),
            redactUrls(result.stderr),
          ].join('\n'),
        )
      }

      expect(result.status).toBe(0)
    } finally {
      await rm(tempDirectory, { recursive: true, force: true })
    }
  }, 120_000)
})
