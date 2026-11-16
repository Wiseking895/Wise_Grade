import type { DetectedPlace } from './types'

/**
 * Reads the browser's own timezone. This is the only source used for the
 * personal timezone display; there is deliberately no hardcoded fallback
 * region. An unusual engine that cannot report a zone shows `UTC`.
 */
export function readDeviceTimeZone(
  readZone: () => string | undefined = () =>
    Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  try {
    const timeZone = readZone()?.trim()

    return timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * "Kumasi, Ashanti Region, Ghana" — only the parts the provider actually
 * returned. Missing levels are skipped, never filled with guessed values.
 */
export function formatPlaceLine(place: DetectedPlace | null): string | null {
  if (!place) {
    return null
  }

  const parts = [place.city, place.region, place.country]
    .map((part) => part?.trim() ?? '')
    .filter((part) => part !== '')

  if (parts.length > 0) {
    return parts.join(', ')
  }

  return place.displayName?.trim() || null
}

/** The most specific available place name, for compact spaces. */
export function shortPlaceLabel(place: DetectedPlace | null): string | null {
  if (!place) {
    return null
  }

  return (
    place.city?.trim() ||
    place.region?.trim() ||
    place.country?.trim() ||
    place.displayName?.trim() ||
    null
  )
}
