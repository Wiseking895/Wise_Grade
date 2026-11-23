/**
 * Bounded recovery for browser, network and server failures.
 *
 * The counter lives in `sessionStorage` so a reload cannot be used to retry
 * forever within the same tab. It is cleared only after the application has
 * actually resolved authentication and rendered a route, never merely because
 * the HTML document finished downloading.
 */

const ATTEMPTS_KEY = 'gradely.recoveryAttempts'
export const MAX_RECOVERY_ATTEMPTS = 3

export const FINAL_RECOVERY_MESSAGE =
  "We're having difficulty loading your account right now. Please try again later or return to this page after some time."

export function getRecoveryAttempts(): number {
  try {
    const raw = window.sessionStorage.getItem(ATTEMPTS_KEY)
    const parsed = raw === null ? 0 : Number(raw)

    return Number.isInteger(parsed) && parsed > 0
      ? Math.min(parsed, MAX_RECOVERY_ATTEMPTS)
      : 0
  } catch {
    return 0
  }
}

export function recordRecoveryAttempt(): number {
  const next = Math.min(getRecoveryAttempts() + 1, MAX_RECOVERY_ATTEMPTS)

  try {
    window.sessionStorage.setItem(ATTEMPTS_KEY, String(next))
  } catch {
    // Storage can be unavailable in private modes; the in-memory value still
    // bounds this page's own retry UI.
  }

  return next
}

export function clearRecoveryAttempts(): void {
  try {
    window.sessionStorage.removeItem(ATTEMPTS_KEY)
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

export function recoveryExhausted(): boolean {
  return getRecoveryAttempts() >= MAX_RECOVERY_ATTEMPTS
}

/**
 * Explicit, user-initiated reload. It records one recovery attempt first and
 * refuses to reload after the third consecutive failure; callers show the final
 * message instead so no automatic or user-driven loop is possible.
 */
export function requestRecoveryReload(): boolean {
  const attempts = recordRecoveryAttempt()

  if (attempts >= MAX_RECOVERY_ATTEMPTS) {
    return false
  }

  window.location.reload()
  return true
}
