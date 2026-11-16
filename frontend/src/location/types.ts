/** A place name resolved from the user's coordinates by the backend. */
export interface DetectedPlace {
  city: string | null
  region: string | null
  country: string | null
  countryCode: string | null
  displayName: string | null
}

/**
 * The location indicator never blocks the dashboard. Every state below still
 * shows the automatically detected device timezone.
 */
export type LocationPhase =
  | 'timezone-only'
  | 'requesting'
  | 'resolved'
  | 'denied'
  | 'unsupported'
  | 'unavailable'
  | 'geocode-failed'
  | 'network-error'
