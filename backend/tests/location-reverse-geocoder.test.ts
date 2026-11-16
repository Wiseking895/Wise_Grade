import { describe, expect, it } from 'vitest'
import {
  createReverseGeocoder,
  mapNominatimResponse,
} from '../src/location/reverse-geocoder.js'

describe('Nominatim response mapping', () => {
  it('maps city, state and country plus the display name', () => {
    const location = mapNominatimResponse({
      display_name: 'Kumasi, Ashanti Region, Ghana',
      address: {
        city: 'Kumasi',
        state: 'Ashanti Region',
        country: 'Ghana',
        country_code: 'gh',
      },
    })

    expect(location).toEqual({
      city: 'Kumasi',
      region: 'Ashanti Region',
      country: 'Ghana',
      countryCode: 'GH',
      displayName: 'Kumasi, Ashanti Region, Ghana',
    })
  })

  it('falls back to town/village and county where a city is not exposed', () => {
    const location = mapNominatimResponse({
      address: {
        town: 'Obuasi',
        county: 'Obuasi Municipal',
        country: 'Ghana',
        country_code: 'GH',
      },
    })

    expect(location?.city).toBe('Obuasi')
    expect(location?.region).toBe('Obuasi Municipal')
  })

  it('never invents a place when the provider returns no address', () => {
    expect(mapNominatimResponse({})).toBeNull()
    expect(mapNominatimResponse(null)).toBeNull()
    expect(mapNominatimResponse({ address: { country_code: 'gh' } })).toBeNull()
  })

  it('trims blank values instead of displaying empty strings', () => {
    const location = mapNominatimResponse({
      address: { city: '  ', state: ' Greater Accra ', country: 'Ghana' },
    })

    expect(location?.city).toBeNull()
    expect(location?.region).toBe('Greater Accra')
  })
})

describe('reverse geocoder transport', () => {
  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }

  it('requests the configured endpoint with an identifying user agent', async () => {
    let requested: URL | null = null
    let headers: Headers | null = null
    const geocoder = createReverseGeocoder({
      url: 'https://geo.example.test/reverse',
      apiKey: 'server-only-key',
      userAgent: 'WiseGrade-Test/1.0 (https://example.test)',
      fetchImpl: (async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        requested = new URL(String(input))
        headers = new Headers(init?.headers)
        return jsonResponse({
          address: { city: 'Kumasi', country: 'Ghana', country_code: 'gh' },
        })
      }) as typeof fetch,
    })

    const result = await geocoder(6.6885, -1.6244)

    expect(result.city).toBe('Kumasi')
    expect(requested!.searchParams.get('lat')).toBe('6.688500')
    expect(requested!.searchParams.get('lon')).toBe('-1.624400')
    expect(requested!.searchParams.get('format')).toBe('jsonv2')
    expect(requested!.searchParams.get('key')).toBe('server-only-key')
    expect(headers!.get('user-agent')).toBe(
      'WiseGrade-Test/1.0 (https://example.test)',
    )
  })

  it('turns provider failures into a generic 502 without leaking details', async () => {
    const geocoder = createReverseGeocoder({
      url: 'https://geo.example.test/reverse',
      userAgent: 'WiseGrade-Test/1.0',
      fetchImpl: (async () =>
        jsonResponse({ error: 'provider secret detail' }, 500)) as typeof fetch,
    })

    await expect(geocoder(6.6885, -1.6244)).rejects.toMatchObject({
      statusCode: 502,
      message: 'Reverse geocoding service is unavailable',
    })
  })

  it('turns network errors and invalid payloads into a 502', async () => {
    const networkFailure = createReverseGeocoder({
      url: 'https://geo.example.test/reverse',
      userAgent: 'WiseGrade-Test/1.0',
      fetchImpl: (async () => {
        throw new TypeError('fetch failed')
      }) as typeof fetch,
    })
    const emptyPayload = createReverseGeocoder({
      url: 'https://geo.example.test/reverse',
      userAgent: 'WiseGrade-Test/1.0',
      fetchImpl: (async () => jsonResponse({})) as typeof fetch,
    })

    await expect(networkFailure(6.6885, -1.6244)).rejects.toMatchObject({
      statusCode: 502,
    })
    await expect(emptyPayload(6.6885, -1.6244)).rejects.toMatchObject({
      statusCode: 502,
    })
  })
})
