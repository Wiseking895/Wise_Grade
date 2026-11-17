import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'

function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8')
}

/**
 * Static regression checks for the Platform Super Admin academic calendar.
 *
 * Backend tests prove authorization, validation and transaction safety. These
 * checks protect the interface guarantees: confirmation is visible, reset and
 * archive are guarded, distribution is reviewable, and no calendar date is
 * hardcoded in the frontend.
 */
describe('platform academic calendar interface', () => {
  it('exposes year management, terms and distribution controls', async () => {
    const page = await source('../src/pages/platform/PlatformCalendarPage.tsx')

    for (const label of [
      'Create academic year',
      'Edit year dates',
      'Activate',
      'Deactivate',
      'Reset configuration',
      'Archive year',
      'Assessment deadline',
      'Examination period',
      'Preview changes',
      'Apply to',
      'Retry',
      'Distribution summary',
      'Transition history',
    ]) {
      assert.ok(page.includes(label), `missing calendar control: ${label}`)
    }
  })

  it('marks unconfirmed terms as awaiting confirmation', async () => {
    const page = await source('../src/pages/platform/PlatformCalendarPage.tsx')
    const schoolPage = await source('../src/pages/dashboard/CalendarPage.tsx')

    assert.match(page, /Dates awaiting confirmation/i)
    assert.match(page, /Awaiting configuration/i)
    assert.match(page, /Unconfirmed\s+terms display/i)
    assert.match(schoolPage, /Dates awaiting confirmation/i)
    assert.match(schoolPage, /Pending confirmation/i)
  })

  it('requires sensitive reauthentication for reset and archive', async () => {
    const page = await source('../src/pages/platform/PlatformCalendarPage.tsx')
    const api = await source('../src/platform/api.ts')

    assert.match(page, /PLATFORM_REAUTH_PURPOSE\.sensitive/)
    assert.match(page, /ensureReauth\(/)
    assert.match(page, /acknowledgeImpacts/)
    assert.match(page, /This operation is audited and requires reauthentication/i)
    assert.match(api, /X-Platform-Reauth/)
  })

  it('sends management operations to the platform calendar API', async () => {
    const api = await source('../src/platform/api.ts')

    for (const endpoint of [
      '/api/platform/calendar/schools',
      '/years',
      '/terms/',
      '/activate',
      '/deactivate',
      '/reset',
      '/archive',
      '/apply/preview',
      "/apply'",
    ]) {
      assert.ok(api.includes(endpoint), `missing calendar endpoint: ${endpoint}`)
    }
  })

  it('does not hardcode calendar dates in the frontend', async () => {
    const page = await source('../src/pages/platform/PlatformCalendarPage.tsx')
    const schoolPage = await source('../src/pages/dashboard/CalendarPage.tsx')
    const api = await source('../src/platform/api.ts')

    assert.doesNotMatch(page, /\b20\d{2}-\d{2}-\d{2}\b/)
    assert.doesNotMatch(schoolPage, /\b20\d{2}-\d{2}-\d{2}\b/)
    assert.doesNotMatch(api, /\b20\d{2}-\d{2}-\d{2}\b/)
  })

  it('keeps the school calendar read-only', async () => {
    const schoolPage = await source('../src/pages/dashboard/CalendarPage.tsx')

    assert.doesNotMatch(schoolPage, /createPlatformAcademicYear/)
    assert.doesNotMatch(schoolPage, /updatePlatformAcademicYear/)
    assert.doesNotMatch(schoolPage, /resetPlatformAcademicYear/)
    assert.doesNotMatch(schoolPage, /archivePlatformAcademicYear/)
    assert.match(schoolPage, /cannot be edited from the\s+school workspace/i)
  })
})
