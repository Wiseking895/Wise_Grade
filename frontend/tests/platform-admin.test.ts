import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import { formatMoney } from '../src/platform/format.ts'

function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8')
}

/**
 * Static regression checks for the central Platform Super Admin dashboard.
 *
 * The API tests prove authorization and data behaviour. These checks protect
 * the navigation, routing and read-only guarantees that are easy to regress in
 * a frontend-only change.
 */
describe('platform dashboard navigation', () => {
  it('exposes every required section and logout', async () => {
    const layout = await source('../src/components/PlatformLayout.tsx')

    for (const label of [
      'Overview',
      'Schools',
      'Payments',
      'Report requests',
      'Academic calendar',
      'Academic monitoring',
      'Platform settings',
      'Audit logs',
      'My account',
      'Log out',
    ]) {
      assert.ok(layout.includes(label), `missing navigation label: ${label}`)
    }
  })

  it('does not mislabel billing as schools and terms', async () => {
    const layout = await source('../src/components/PlatformLayout.tsx')

    assert.doesNotMatch(layout, /Schools & terms/)
    assert.doesNotMatch(layout, /to="\/platform\/billing"[^>]*>\s*<Building2/)
  })
})

describe('platform routing', () => {
  it('makes the overview the platform index and registers every page', async () => {
    const app = await source('../src/App.tsx')

    assert.match(app, /<Route index element=\{<PlatformOverviewPage \/>\}/)
    assert.match(app, /path="schools" element=\{<PlatformSchoolsPage \/>\}/)
    assert.match(app, /path="monitoring" element=\{<PlatformMonitoringPage \/>\}/)
    assert.match(app, /path="settings" element=\{<PlatformSettingsPage \/>\}/)
    assert.match(app, /path="audit" element=\{<PlatformAuditPage \/>\}/)
    assert.match(app, /path="account" element=\{<PlatformAccountPage \/>\}/)
    assert.match(app, /path="calendar" element=\{<PlatformCalendarPage \/>\}/)
    assert.doesNotMatch(app, /Navigate to="reports"/)
  })

  it('sends platform administrators to the overview after sign-in', async () => {
    const login = await source('../src/pages/LoginPage.tsx')

    assert.match(login, /isPlatformAdmin \? '\/platform'/)
    assert.doesNotMatch(login, /'\/platform\/billing'/)
  })

  it('guards the platform route with the platform identity, not a school role', async () => {
    const guard = await source('../src/components/ProtectedRoute.tsx')

    assert.match(guard, /!user\?\.isPlatformAdmin/)
    assert.doesNotMatch(guard, /PlatformProtectedRoute[\s\S]*?memberships\.some/)
  })
})

describe('platform dashboard safety', () => {
  it('keeps the audit view read-only', async () => {
    const audit = await source('../src/pages/platform/PlatformAuditPage.tsx')

    assert.match(audit, /read-only by design/)
    assert.doesNotMatch(audit, /Delete/)
    assert.doesNotMatch(audit, /method: 'DELETE'/)
  })

  it('separates school academic acceptance from platform generation', async () => {
    const monitoring = await source(
      '../src/pages/platform/PlatformMonitoringPage.tsx',
    )

    assert.match(monitoring, /School administrators accept results/)
    assert.match(monitoring, /Generate Reports is one audited action/)
    assert.doesNotMatch(monitoring, /Unverified payments block release/)
    assert.doesNotMatch(monitoring, /Reports awaiting payment/)
    assert.doesNotMatch(monitoring, /Payments awaiting verification/)
    assert.doesNotMatch(monitoring, /Academic review/)
    assert.doesNotMatch(monitoring, /\/platform\/assessments/)
  })

  it('renders platform school logos through the authenticated asset URL helper', async () => {
    const schools = await source('../src/pages/platform/PlatformSchoolsPage.tsx')

    assert.match(schools, /apiAssetUrl\(detail\.logoUrl\)/)
  })
})

describe('platform formatting', () => {
  it('formats minor units as currency', () => {
    assert.match(formatMoney(123456, 'GHS'), /1,234\.56/)
  })
})
