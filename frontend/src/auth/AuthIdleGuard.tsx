import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/use-auth'
import {
  hasInFlightMutations,
  heartbeatRequest,
  subscribeApiBusy,
} from '../lib/api'

/** Warn with 15 seconds remaining. */
export const IDLE_WARNING_MS = 45_000
/** The session is terminated at this point unless activity resumes. */
export const IDLE_LOGOUT_MS = 60_000

const HEARTBEAT_INTERVAL_MS = 20_000

/**
 * Client half of the inactivity timeout.
 *
 * The server is authoritative: every authenticated request records activity and
 * rejects a session after `AUTH_IDLE_TIMEOUT_SECONDS`. This guard gives the user
 * a 15-second warning, resets on genuine input, and keeps the server's idle
 * clock current with a throttled heartbeat. It waits for an in-flight save or
 * upload before signing out, but never extends the session's absolute expiry.
 */
export default function AuthIdleGuard() {
  const { status, logout } = useAuth()
  const [warning, setWarning] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(15)

  const lastActivityRef = useRef(0)
  const lastHeartbeatRef = useRef(0)
  const loggingOutRef = useRef(false)
  const pendingLogoutRef = useRef(false)
  const warningRef = useRef(false)

  const setWarningState = useCallback((next: boolean) => {
    warningRef.current = next
    setWarning(next)
  }, [])

  const signOutForInactivity = useCallback(async () => {
    if (loggingOutRef.current) return

    // An upload or save that already started must not be cut off. Wait for it
    // to finish, then sign out; the pending state does not reset the timer.
    if (hasInFlightMutations()) {
      pendingLogoutRef.current = true
      return
    }

    loggingOutRef.current = true
    pendingLogoutRef.current = false
    setWarningState(false)

    try {
      await logout('idle')
    } finally {
      loggingOutRef.current = false
    }
  }, [logout, setWarningState])

  const recordActivity = useCallback(() => {
    lastActivityRef.current = Date.now()

    if (warningRef.current) {
      setWarningState(false)
    }

    const now = Date.now()

    if (now - lastHeartbeatRef.current >= HEARTBEAT_INTERVAL_MS) {
      lastHeartbeatRef.current = now
      // A heartbeat failure is handled by the global 401/network surfaces; it
      // must never interrupt the user's current action.
      void heartbeatRequest().catch(() => undefined)
    }
  }, [setWarningState])

  // Genuine user input only. API responses and timers never count as activity.
  useEffect(() => {
    if (status !== 'authenticated') return

    const events: Array<keyof WindowEventMap> = [
      'mousemove',
      'mousedown',
      'pointerdown',
      'keydown',
      'touchstart',
      'scroll',
      'wheel',
    ]

    const handler = () => recordActivity()

    for (const event of events) {
      window.addEventListener(event, handler, { passive: true })
    }

    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return

      const elapsed = Date.now() - lastActivityRef.current

      if (elapsed >= IDLE_LOGOUT_MS) {
        void signOutForInactivity()
        return
      }

      // Returning to the tab is activity; a suspended timer in a background
      // tab must not sign out someone who came straight back.
      recordActivity()
    }

    document.addEventListener('visibilitychange', onVisibility)

    // A fresh authenticated state starts a fresh window.
    lastActivityRef.current = Date.now()
    lastHeartbeatRef.current = Date.now()
    const resetWarning = window.setTimeout(() => setWarningState(false), 0)

    return () => {
      window.clearTimeout(resetWarning)
      for (const event of events) {
        window.removeEventListener(event, handler)
      }
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [recordActivity, setWarningState, signOutForInactivity, status])

  // Finish a deferred logout as soon as the save/upload completes.
  useEffect(() => {
    return subscribeApiBusy((busy) => {
      if (!busy && pendingLogoutRef.current) {
        void signOutForInactivity()
      }
    })
  }, [signOutForInactivity])

  useEffect(() => {
    if (status !== 'authenticated') {
      const resetWarning = window.setTimeout(() => setWarningState(false), 0)
      return () => window.clearTimeout(resetWarning)
    }

    const timer = window.setInterval(() => {
      if (loggingOutRef.current) return

      const elapsed = Date.now() - lastActivityRef.current

      if (elapsed >= IDLE_LOGOUT_MS) {
        void signOutForInactivity()
        return
      }

      if (elapsed >= IDLE_WARNING_MS) {
        setWarningState(true)
        setSecondsLeft(
          Math.max(1, Math.ceil((IDLE_LOGOUT_MS - elapsed) / 1000)),
        )
      }
    }, 1000)

    return () => window.clearInterval(timer)
  }, [setWarningState, signOutForInactivity, status])

  if (status !== 'authenticated' || !warning) {
    return null
  }

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label="Session expiring"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-xl flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 shadow-lg sm:flex-row sm:items-center sm:justify-between"
    >
      <p>
        You will be signed out in <strong>{secondsLeft} seconds</strong> because
        there has been no activity.
      </p>
      <button
        type="button"
        className="shrink-0 rounded-xl bg-gradely-navy px-4 py-2 text-sm font-semibold text-white hover:bg-[#123c80]"
        onClick={recordActivity}
      >
        Stay signed in
      </button>
    </div>
  )
}
