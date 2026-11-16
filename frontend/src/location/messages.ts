import type { LocationPhase } from './types'

/**
 * Copy for every non-resolved state. Each message keeps the promise that the
 * device timezone remains visible, so the dashboard never appears broken.
 */
export const LOCATION_MESSAGES: Record<
  Exclude<LocationPhase, 'resolved'>,
  string
> = {
  'timezone-only':
    'Only your device timezone is shown. Allow location access to display your city and country.',
  requesting: 'Requesting your current location…',
  denied:
    'Location permission was denied. Your device timezone is still shown. Enable location for this site in your browser, then try again.',
  unsupported:
    'This browser does not support location detection. Only your device timezone is shown.',
  unavailable:
    'Your current location is unavailable. Only your device timezone is shown.',
  'geocode-failed':
    'We could not find a place name for your coordinates. Only your device timezone is shown.',
  'network-error':
    'We could not reach Wise Grade to look up your location. Only your device timezone is shown.',
}

export function locationMessage(phase: LocationPhase): string | null {
  return phase === 'resolved' ? null : LOCATION_MESSAGES[phase]
}
