import { apiRequest } from '../lib/api'
import type { DetectedPlace } from './types'

interface ReverseGeocodeResponse {
  location: DetectedPlace
}

/**
 * One lookup per explicit detection (or a previously granted permission). The
 * browser only talks to our authenticated API; provider keys stay server-side.
 */
export function reverseGeocode(
  latitude: number,
  longitude: number,
): Promise<DetectedPlace> {
  const query = new URLSearchParams({
    latitude: latitude.toFixed(6),
    longitude: longitude.toFixed(6),
  })

  return apiRequest<ReverseGeocodeResponse>(
    `/api/location/reverse?${query.toString()}`,
  ).then((response) => response.location)
}
