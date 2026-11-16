import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../lib/api'
import { reverseGeocode } from './api'
import { readDeviceTimeZone } from './device-time-zone'
import type { DetectedPlace, LocationPhase } from './types'

/**
 * A cached fix is acceptable here: this indicator shows the user's current
 * area, not a live track. Five minutes avoids repeat prompts and network calls
 * while still reflecting a move between towns.
 */
const GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 10_000,
  maximumAge: 300_000,
}

const TIMEZONE_RECHECK_MS = 60_000

function geolocation(): Geolocation | null {
  if (
    typeof navigator === 'undefined' ||
    !navigator.geolocation ||
    typeof navigator.geolocation.getCurrentPosition !== 'function'
  ) {
    return null
  }

  return navigator.geolocation
}

function getCurrentPosition(geo: Geolocation): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    geo.getCurrentPosition(resolve, reject, GEOLOCATION_OPTIONS)
  })
}

function geolocationErrorCode(error: unknown): number | null {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    return typeof code === 'number' ? code : null
  }

  return null
}

export interface LocationDetection {
  timeZone: string
  phase: LocationPhase
  place: DetectedPlace | null
  /** Requests permission (or a fresh fix) and resolves a place name. */
  detect: () => Promise<void>
}

/**
 * Detects the device timezone on load and, when the user allows it, the current
 * geographic location. Nothing is persisted, no polling happens, and a denied
 * or failed lookup leaves the timezone visible.
 */
export function useLocationDetection(): LocationDetection {
  const [timeZone, setTimeZone] = useState<string>(() => readDeviceTimeZone())
  const [phase, setPhase] = useState<LocationPhase>(() =>
    geolocation() ? 'timezone-only' : 'unsupported',
  )
  const [place, setPlace] = useState<DetectedPlace | null>(null)
  const mounted = useRef(true)
  const latestRequest = useRef(0)

  const refreshTimeZone = useCallback(() => {
    setTimeZone((current) => {
      const next = readDeviceTimeZone()
      return next === current ? current : next
    })
  }, [])

  const detect = useCallback(async () => {
    const geo = geolocation()

    if (!geo) {
      setPhase('unsupported')
      return
    }

    const requestId = latestRequest.current + 1
    latestRequest.current = requestId
    setPhase('requesting')
    setPlace(null)

    try {
      const position = await getCurrentPosition(geo)

      if (!mounted.current || requestId !== latestRequest.current) {
        return
      }

      try {
        const detected = await reverseGeocode(
          position.coords.latitude,
          position.coords.longitude,
        )

        if (!mounted.current || requestId !== latestRequest.current) {
          return
        }

        setPlace(detected)
        setPhase('resolved')
      } catch (cause) {
        if (!mounted.current || requestId !== latestRequest.current) {
          return
        }

        setPhase(
          cause instanceof ApiError && cause.status === 0
            ? 'network-error'
            : 'geocode-failed',
        )
      }
    } catch (cause) {
      if (!mounted.current || requestId !== latestRequest.current) {
        return
      }

      const code = geolocationErrorCode(cause)

      if (code === 1) {
        setPhase('denied')
      } else {
        // Code 2 is POSITION_UNAVAILABLE and code 3 is TIMEOUT; both mean the
        // device could not provide a usable fix right now.
        setPhase('unavailable')
      }
    }
  }, [])

  // If the user has already granted permission, refresh the place once without
  // prompting. The Permissions API is optional, so unsupported browsers simply
  // wait for an explicit request.
  useEffect(() => {
    const permissions = typeof navigator === 'undefined' ? null : navigator.permissions

    if (!permissions?.query) {
      return
    }

    let cancelled = false

    permissions
      .query({ name: 'geolocation' })
      .then((status) => {
        if (!cancelled && status.state === 'granted') {
          void detect()
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [detect])

  // The browser exposes no timezone-change event. Re-reading on focus,
  // visibility and a slow interval keeps the displayed zone current if the
  // device timezone changes while the app remains open.
  useEffect(() => {
    mounted.current = true

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshTimeZone()
      }
    }

    window.addEventListener('focus', refreshTimeZone)
    document.addEventListener('visibilitychange', onVisibilityChange)
    const interval = window.setInterval(refreshTimeZone, TIMEZONE_RECHECK_MS)

    return () => {
      mounted.current = false
      latestRequest.current += 1
      window.removeEventListener('focus', refreshTimeZone)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.clearInterval(interval)
    }
  }, [refreshTimeZone])

  return { timeZone, phase, place, detect }
}
