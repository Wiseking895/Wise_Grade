import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import { PLATFORM_REAUTH_PURPOSE } from '../src/platform/reauth-purpose.ts'

function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8')
}

describe('platform operations navigation and routing', () => {
  it('adds health, notifications, security and exports to navigation', async () => {
    const layout = await source('../src/components/PlatformLayout.tsx')

    for (const label of [
      'Platform health',
      'Notifications',
      'Security & sessions',
      'Data exports',
      'Reconciliation',
    ]) {
      assert.ok(layout.includes(label), `missing navigation label: ${label}`)
    }
  })

  it('registers every new operations route', async () => {
    const app = await source('../src/App.tsx')

    for (const route of [
      'health',
      'notifications',
      'security',
      'exports',
      'reconciliation',
    ]) {
      assert.match(
        app,
        new RegExp(`path="${route}" element=\\{<Platform`),
        `missing route: ${route}`,
      )
    }
  })

  it('wraps the platform layout in the reauthentication provider', async () => {
    const layout = await source('../src/components/PlatformLayout.tsx')

    assert.match(layout, /<PlatformReauthProvider>/)
    assert.match(layout, /<\/PlatformReauthProvider>/)
  })
})

describe('platform reauthentication purposes', () => {
  it('uses stable purpose identifiers shared with the backend', () => {
    assert.deepEqual(PLATFORM_REAUTH_PURPOSE, {
      sensitive: 'SENSITIVE_ACTION',
      export: 'DATA_EXPORT',
      reconciliation: 'PAYMENT_RECONCILIATION',
      security: 'SECURITY_SETTINGS',
      sessionRevoke: 'SESSION_REVOKE',
    })
  })

  it('sends the reauthentication header from sensitive API clients', async () => {
    const platformApi = await source('../src/platform/api.ts')
    const billingApi = await source('../src/billing/api.ts')
    const reportsApi = await source('../src/reports/api.ts')

    assert.match(platformApi, /X-Platform-Reauth/)
    assert.match(billingApi, /X-Platform-Reauth/)
    assert.match(reportsApi, /X-Platform-Reauth/)
  })

  it('confirms identity before sensitive platform actions', async () => {
    for (const path of [
      '../src/pages/platform/PlatformBillingPage.tsx',
      '../src/pages/platform/PlatformReportsPage.tsx',
      '../src/pages/platform/PlatformSchoolsPage.tsx',
      '../src/pages/platform/PlatformSettingsPage.tsx',
      '../src/pages/platform/PlatformExportsPage.tsx',
      '../src/pages/platform/PlatformReconciliationPage.tsx',
      '../src/pages/platform/PlatformSecurityPage.tsx',
    ]) {
      const page = await source(path)
      assert.match(page, /ensureReauth\(/, `missing reauthentication: ${path}`)
    }
  })
})

describe('platform operations privacy and honesty', () => {
  it('never claims email or SMS delivery in the notification inbox', async () => {
    const page = await source(
      '../src/pages/platform/PlatformNotificationsPage.tsx',
    )

    assert.match(page, /Email and SMS delivery is not claimed/)
    assert.doesNotMatch(page, /sent by email/i)
    assert.doesNotMatch(page, /SMS sent/i)
  })

  it('documents that exports are not a backup or restore mechanism', async () => {
    const page = await source('../src/pages/platform/PlatformExportsPage.tsx')

    assert.match(page, /not a backup/i)
    assert.match(page, /audited/i)
    assert.match(page, /excluded/i)
  })

  it('keeps the Wise Grade branding and responsive shell', async () => {
    const layout = await source('../src/components/PlatformLayout.tsx')

    assert.match(layout, /Wise Grade/)
    assert.match(layout, /lg:hidden/)
    assert.match(layout, /max-w-7xl/)
  })
})
