/**
 * A place name resolved from coordinates. Every field is optional because
 * reverse geocoding services do not always expose the same administrative
 * levels; a partial result is still useful and is never invented.
 */
export interface ReverseGeocodedLocation {
  city: string | null
  region: string | null
  country: string | null
  countryCode: string | null
  displayName: string | null
}

/**
 * Resolves coordinates into a place name. Implementations must not persist the
 * coordinates or the result. `signal` lets the caller abandon a slow lookup.
 */
export type ReverseGeocoder = (
  latitude: number,
  longitude: number,
  signal?: AbortSignal,
) => Promise<ReverseGeocodedLocation>
