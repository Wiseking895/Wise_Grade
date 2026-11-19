import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import dotenv from 'dotenv'

const KEY_PATTERN = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/

/**
 * Refuses to load a file that repeats a variable name.
 *
 * dotenv silently lets the last duplicate win, which previously meant a single
 * `.env` containing both local and production database URLs could connect a
 * developer machine to production. Failing loudly keeps the active profile
 * unambiguous. Values are never included in the error.
 */
function assertNoDuplicateKeys(path: string): void {
  let content: string

  try {
    content = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }

    // Let dotenv report other read failures in its usual way.
    return
  }

  const seen = new Map<string, number>()
  const duplicates = new Set<string>()

  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const match = line.match(KEY_PATTERN)

    if (!match?.[1]) {
      continue
    }

    const key = match[1]

    if (seen.has(key)) {
      duplicates.add(key)
    } else {
      seen.set(key, index + 1)
    }
  }

  if (duplicates.size > 0) {
    throw new Error(
      `Duplicate environment variable${duplicates.size === 1 ? '' : 's'} in ${basename(
        path,
      )}: ${[...duplicates].sort().join(', ')}. ` +
        'Use separate profile files (for example .env for local development and ' +
        '.env.production.local for production tooling) instead of repeating keys.',
    )
  }
}

/**
 * Loads KEY=VALUE pairs from an env file into `process.env`.
 *
 * `override: false` is deliberate: variables that already exist in the process
 * environment (shell, CI, container) always win over the file. This keeps local
 * `.env` files from silently replacing explicitly supplied configuration.
 *
 * Returns true when the file was read, false when it is missing or unreadable.
 * A missing file is normal (offline commands and credential-free test runs must
 * keep working), so callers should not treat false as an error.
 */
export function loadEnvFile(path: string): boolean {
  assertNoDuplicateKeys(path)

  const result = dotenv.config({ path, override: false, quiet: true })

  return !result.error
}

/**
 * Resolves which profile file to load.
 *
 * Priority:
 *   1. `GRADELY_ENV_FILE` - an explicit path, used for production tooling.
 *   2. `GRADELY_ENV_PROFILE` - selects `.env.<profile>.local`.
 *   3. `.env` - the local development profile.
 *
 * Vercel does not use any of these files; it injects variables directly.
 */
export function resolveEnvFile(): string {
  const explicit = process.env.GRADELY_ENV_FILE?.trim()

  if (explicit) {
    return resolve(process.cwd(), explicit)
  }

  const profile = process.env.GRADELY_ENV_PROFILE?.trim()

  if (profile) {
    if (!/^[A-Za-z0-9-]+$/.test(profile)) {
      throw new Error(
        'GRADELY_ENV_PROFILE may only contain letters, numbers and hyphens',
      )
    }

    return resolve(process.cwd(), `.env.${profile}.local`)
  }

  return resolve(process.cwd(), '.env')
}

/**
 * Loads the selected profile file. Defaults to `backend/.env` (local
 * development), never the production profile.
 */
export function loadProjectEnvFile(): boolean {
  return loadEnvFile(resolveEnvFile())
}
