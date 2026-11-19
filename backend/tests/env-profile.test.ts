import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  loadEnvFile,
  resolveEnvFile,
} from '../src/config/env-file.js'

const createdDirs: string[] = []
const touchedKeys = new Set<string>()

function fixture(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'gradely-env-'))
  createdDirs.push(dir)
  const path = join(dir, '.env')
  writeFileSync(path, content, 'utf8')
  return path
}

function remember(key: string): void {
  touchedKeys.add(key)
}

afterEach(() => {
  for (const key of touchedKeys) {
    delete process.env[key]
  }
  touchedKeys.clear()

  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }

  delete process.env.GRADELY_ENV_FILE
  delete process.env.GRADELY_ENV_PROFILE
})

describe('environment profile loading', () => {
  it('rejects duplicate keys instead of silently overriding them', () => {
    const path = fixture(
      [
        'GRADELY_TEST_DUPLICATE=local-value',
        'GRADELY_TEST_DUPLICATE=production-value',
      ].join('\n'),
    )
    remember('GRADELY_TEST_DUPLICATE')

    expect(() => loadEnvFile(path)).toThrow(/Duplicate environment variable/)
    expect(() => loadEnvFile(path)).toThrow(/GRADELY_TEST_DUPLICATE/)
    // Values never appear in the error.
    expect(() => loadEnvFile(path)).not.toThrow(/local-value|production-value/)
  })

  it('loads a valid file and keeps an existing process value', () => {
    const path = fixture('GRADELY_TEST_VALUE=from-file')
    remember('GRADELY_TEST_VALUE')
    process.env.GRADELY_TEST_VALUE = 'from-process'

    expect(loadEnvFile(path)).toBe(true)
    expect(process.env.GRADELY_TEST_VALUE).toBe('from-process')
  })

  it('defaults to .env and honours explicit profile selection', () => {
    delete process.env.GRADELY_ENV_FILE
    delete process.env.GRADELY_ENV_PROFILE
    expect(basename(resolveEnvFile())).toBe('.env')

    process.env.GRADELY_ENV_PROFILE = 'production'
    expect(basename(resolveEnvFile())).toBe('.env.production.local')

    process.env.GRADELY_ENV_FILE = '.env.production.local'
    expect(basename(resolveEnvFile())).toBe('.env.production.local')
  })

  it('rejects unsafe profile names and returns false for a missing file', () => {
    process.env.GRADELY_ENV_PROFILE = '../secrets'
    expect(() => resolveEnvFile()).toThrow(/letters, numbers and hyphens/)

    delete process.env.GRADELY_ENV_PROFILE
    expect(loadEnvFile(join(tmpdir(), 'gradely-missing-env-file'))).toBe(false)
  })
})
