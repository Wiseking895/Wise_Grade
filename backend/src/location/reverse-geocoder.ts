import { env } from '../config/env.js'
import { HttpError } from '../errors/http-error.js'
import type {
  ReverseGeocodedLocation,
  ReverseGeocoder,
} from './types.js'

interface NominatimAddress {
  city?: unknown
  town?: unknown
  village?: unknown
  municipality?: unknown
  suburb?: unknown
  county?: unknown
  state?: unknown
  region?: unknown
  country?: unknown
  country_code?: unknown
}

interface NominatimResponse {
  address?: NominatimAddress
  display_name?: unknown
}

export interface ReverseGeocoderOptions {
  /** Nominatim-compatible reverse endpoint. */
  url: string
  /** Optional provider key appended as `key`; never sent to the browser. */
  apiKey?: string
  /**
   * Identifying User-Agent. OpenStreetMap's usage policy requires one that
   * names the application and gives a way to contact the operator.
   */
  userAgent: string
  timeoutMs?: number
  /** Injectable transport for deterministic tests. */
  fetchImpl?: typeof fetch
}

const DEFAULT_TIMEOUT_MS = 5_000

function text(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const candidate = text(value)

    if (candidate) {
      return candidate
    }
  }

  return null
}

/**
 * Maps a Nominatim response onto the small, provider-neutral shape the API
 * returns. City/town/village are treated as equivalent because the service
 * picks different keys for different settlement sizes.
 */
export function mapNominatimResponse(
  payload: unknown,
): ReverseGeocodedLocation | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const response = payload as NominatimResponse
  const address =
    response.address && typeof response.address === 'object'
      ? response.address
      : {}
  const countryCode = text(address.country_code)

  const location: ReverseGeocodedLocation = {
    city: firstText(
      address.city,
      address.town,
      address.village,
      address.municipality,
      address.suburb,
    ),
    region: firstText(address.state, address.region, address.county),
    country: text(address.country),
    countryCode: countryCode ? countryCode.toUpperCase() : null,
    displayName: text(response.display_name),
  }

  if (
    !location.city &&
    !location.region &&
    !location.country &&
    !location.displayName
  ) {
    return null
  }

  return location
}

/**
 * Builds a reverse geocoder for a Nominatim-compatible endpoint. This is the
 * only place coordinates leave the server: one request per explicit user
 * action, with no persistence and no background tracking.
 */
export function createReverseGeocoder(
  options: ReverseGeocoderOptions,
): ReverseGeocoder {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return async function reverseGeocode(latitude, longitude, signal) {
    let url: URL

    try {
      url = new URL(options.url)
    } catch {
      throw new HttpError(
        502,
        'Reverse geocoding is not configured correctly',
      )
    }

    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('lat', latitude.toFixed(6))
    url.searchParams.set('lon', longitude.toFixed(6))
    url.searchParams.set('zoom', '10')
    url.searchParams.set('addressdetails', '1')

    if (options.apiKey) {
      url.searchParams.set('key', options.apiKey)
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const abortFromCaller = () => controller.abort()

    if (signal) {
      if (signal.aborted) {
        controller.abort()
      } else {
        signal.addEventListener('abort', abortFromCaller, { once: true })
      }
    }

    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Accept-Language': 'en',
          'User-Agent': options.userAgent,
        },
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new HttpError(502, 'Reverse geocoding service is unavailable')
      }

      const payload = (await response.json()) as unknown
      const location = mapNominatimResponse(payload)

      if (!location) {
        throw new HttpError(
          502,
          'Could not resolve a place name for these coordinates',
        )
      }

      return location
    } catch (error) {
      if (error instanceof HttpError) {
        throw error
      }

      throw new HttpError(502, 'Reverse geocoding service is unavailable')
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abortFromCaller)
    }
  }
}

/** The deployment's configured provider. No key is ever exposed to clients. */
export function reverseGeocoderFromEnvironment(): ReverseGeocoder {
  return createReverseGeocoder({
    url: env.REVERSE_GEOCODING_URL,
    apiKey: env.REVERSE_GEOCODING_API_KEY,
    userAgent:
      env.REVERSE_GEOCODING_USER_AGENT ??
      `WiseGrade-LocationLookup/1.0 (${env.FRONTEND_URL})`,
  })
}
