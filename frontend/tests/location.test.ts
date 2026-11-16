import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import {
  formatPlaceLine,
  readDeviceTimeZone,
  shortPlaceLabel,
} from '../src/location/device-time-zone.ts'
import { LOCATION_MESSAGES, locationMessage } from '../src/location/messages.ts'
import type { LocationPhase } from '../src/location/types.ts'

function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8')
}

const KUMASI = {
  city: 'Kumasi',
  region: 'Ashanti Region',
  country: 'Ghana',
  countryCode: 'GH',
  displayName: 'Kumasi, Ashanti Region, Ghana',
}

describe('device timezone detection', () => {
  it('reads the browser internationalization API directly', async () => {
    const module = await source('../src/location/device-time-zone.ts')

    assert.match(
      module,
      /Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/,
    )
    assert.doesNotMatch(module, /Africa\/Accra/)
  })

  it('uses the timezone reported by the device', () => {
    assert.equal(
      readDeviceTimeZone(() => 'America/New_York'),
      'America/New_York',
    )
    assert.equal(
      readDeviceTimeZone(() => '  Asia/Kolkata  '),
      'Asia/Kolkata',
    )
  })

  it('never fabricates a region when the device reports nothing', () => {
    assert.equal(readDeviceTimeZone(() => ''), 'UTC')
    assert.equal(readDeviceTimeZone(() => undefined), 'UTC')
    assert.equal(
      readDeviceTimeZone(() => {
        throw new Error('unsupported')
      }),
      'UTC',
    )
  })
})

describe('detected place formatting', () => {
  it('shows city, region and country from the provider only', () => {
    assert.equal(formatPlaceLine(KUMASI), 'Kumasi, Ashanti Region, Ghana')
    assert.equal(shortPlaceLabel(KUMASI), 'Kumasi')
  })

  it('skips levels the provider did not return', () => {
    assert.equal(
      formatPlaceLine({ ...KUMASI, city: null }),
      'Ashanti Region, Ghana',
    )
    assert.equal(
      formatPlaceLine({ ...KUMASI, city: null, region: null }),
      'Ghana',
    )
    assert.equal(shortPlaceLabel({ ...KUMASI, city: null }), 'Ashanti Region')
  })

  it('never invents a place when nothing was resolved', () => {
    const empty = {
      city: null,
      region: null,
      country: null,
      countryCode: null,
      displayName: null,
    }

    assert.equal(formatPlaceLine(empty), null)
    assert.equal(shortPlaceLabel(empty), null)
    assert.equal(formatPlaceLine(null), null)
    assert.equal(shortPlaceLabel(null), null)
  })
})

describe('location permission and failure copy', () => {
  const phases: LocationPhase[] = [
    'timezone-only',
    'requesting',
    'denied',
    'unsupported',
    'unavailable',
    'geocode-failed',
    'network-error',
  ]

  it('covers every non-resolved state with timezone-safe copy', () => {
    for (const phase of phases) {
      const message = locationMessage(phase)

      assert.ok(message, `missing copy for ${phase}`)
      assert.match(
        message,
        /timezone|location/i,
        `unclear copy for ${phase}`,
      )
    }

    assert.equal(locationMessage('resolved'), null)
    assert.match(LOCATION_MESSAGES.denied, /timezone is still shown/i)
    assert.match(LOCATION_MESSAGES.unsupported, /does not support/i)
    assert.match(LOCATION_MESSAGES['network-error'], /could not reach/i)
    assert.match(LOCATION_MESSAGES['geocode-failed'], /place name/i)
  })
})

describe('dashboard location wiring', () => {
  it('does not hardcode a location in the calendar or school profile', async () => {
    const calendar = await source('../src/pages/dashboard/CalendarPage.tsx')
    const profile = await source(
      '../src/pages/dashboard/SchoolProfilePage.tsx',
    )

    assert.doesNotMatch(calendar, /Africa\/Accra/)
    assert.doesNotMatch(profile, /Africa\/Accra/)
  })

  it('renders the indicator in the dashboard header and keeps the calendar authoritative', async () => {
    const layout = await source('../src/components/DashboardLayout.tsx')
    const indicator = await source(
      '../src/components/LocationIndicator.tsx',
    )
    const calendar = await source('../src/pages/dashboard/CalendarPage.tsx')

    assert.match(layout, /import LocationIndicator from '\.\/LocationIndicator'/)
    assert.match(layout, /<LocationIndicator \/>/)
    assert.match(indicator, /useLocationDetection/)
    assert.match(indicator, /Detect my location/)
    assert.match(indicator, /not stored/)
    assert.match(calendar, /calendar\.timezone/)
    assert.match(calendar, /official academic timezone/i)
  })

  it('sends coordinates only to the authenticated Wise Grade API', async () => {
    const api = await source('../src/location/api.ts')
    const hook = await source('../src/location/use-location.ts')

    assert.match(api, /\/api\/location\/reverse/)
    assert.doesNotMatch(api, /nominatim|openstreetmap|googleapis|mapbox/i)
    assert.doesNotMatch(hook, /localStorage|sessionStorage|indexedDB|watchPosition/i)
    assert.match(hook, /getCurrentPosition/)
    assert.match(hook, /maximumAge/)
  })
})
