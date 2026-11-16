import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

function read(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, import.meta.url), 'utf8')
}

describe('platform admin bootstrap safety', () => {
  it('is exposed as an explicit CLI command, not an HTTP endpoint', async () => {
    const packageJson = JSON.parse(await read('../package.json')) as {
      scripts: Record<string, string>
    }

    expect(packageJson.scripts['admin:bootstrap']).toBe(
      'tsx scripts/bootstrap-platform-admin.ts',
    )

    const script = await read('../scripts/bootstrap-platform-admin.ts')

    expect(script).toMatch(/hashPassword\(/)
    expect(script).toMatch(/isPlatformAdmin:\s*true/)
    expect(script).toMatch(/PLATFORM_ADMIN_CONFIRM_DATABASE/)
    expect(script).toMatch(/Type the database name/)
    expect(script).toMatch(/already exists/)
    expect(script).toMatch(/never promotes or overwrites/)
    expect(script).toMatch(/--allow-additional-admin/)
  })

  it('creates no school membership and never promotes an existing user', async () => {
    const script = await read('../scripts/bootstrap-platform-admin.ts')

    expect(script).not.toMatch(/schoolMembership\.create/)
    expect(script).not.toMatch(/membership\.create/)
    expect(script).not.toMatch(/\.user\.update\(/)
  })

  it('is never imported by the API at startup', async () => {
    const app = await read('../src/app.ts')

    expect(app).not.toMatch(/bootstrap-platform-admin/)
    expect(app).not.toMatch(/PLATFORM_ADMIN_PASSWORD/)
    expect(app).not.toMatch(/admin:bootstrap/)
  })

  it('writes an append-only provisioning audit entry', async () => {
    const script = await read('../scripts/bootstrap-platform-admin.ts')

    expect(script).toMatch(/PLATFORM_ADMIN_PROVISIONED/)
    expect(script).toMatch(/tx\.auditLog\.create/)
  })

  it('requires a database confirmation before writing', async () => {
    const script = await read('../scripts/bootstrap-platform-admin.ts')

    expect(script).toContain(
      'Database confirmation did not match. Nothing was written.',
    )
  })
})
