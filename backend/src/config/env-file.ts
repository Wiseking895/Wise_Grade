import { resolve } from 'node:path'
import dotenv from 'dotenv'

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
  const result = dotenv.config({ path, override: false, quiet: true })

  return !result.error
}

/**
 * Loads the conventional `backend/.env` resolved from the current working
 * directory. This is the same location dotenv used before, so existing setups
 * keep working.
 */
export function loadProjectEnvFile(): boolean {
  return loadEnvFile(resolve(process.cwd(), '.env'))
}
