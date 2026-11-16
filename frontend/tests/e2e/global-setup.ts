import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Seeds the synthetic Phase 6C fixtures before any browser test runs.
 *
 * The seeder refuses production, the development database and any database
 * whose name does not contain "test", so a mistaken configuration fails closed
 * instead of mutating real data.
 */
export default function globalSetup(): void {
  const here = dirname(fileURLToPath(import.meta.url))
  const backendDir = resolve(here, '../../../backend')

  execFileSync('npm', ['run', 'phase6c:seed'], {
    cwd: backendDir,
    stdio: 'inherit',
    shell: true,
  })
}
