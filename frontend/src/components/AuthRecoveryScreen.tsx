import { AlertTriangle, RefreshCw, RotateCw } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../components/ui'
import {
  FINAL_RECOVERY_MESSAGE,
  MAX_RECOVERY_ATTEMPTS,
  getRecoveryAttempts,
  recordRecoveryAttempt,
  requestRecoveryReload,
} from '../lib/recovery'

/**
 * A single recovery surface for authentication and application-load failures.
 *
 * It never reloads on its own. Retry re-resolves authentication; Reload asks
 * the browser to start over. Both are explicit, both count toward the same
 * three-attempt budget, and after the third failure only the final message is
 * shown.
 */
export default function AuthRecoveryScreen({
  message = 'We could not load your account. This is usually a temporary connection problem.',
  onRetry,
}: {
  message?: string
  onRetry?: () => Promise<void> | void
}) {
  const [attempts, setAttempts] = useState(getRecoveryAttempts)
  const [busy, setBusy] = useState(false)
  const exhausted = attempts >= MAX_RECOVERY_ATTEMPTS

  async function retry() {
    if (busy || exhausted) return

    setBusy(true)
    setAttempts(recordRecoveryAttempt())

    try {
      await onRetry?.()
    } finally {
      setBusy(false)
    }
  }

  function reload() {
    if (exhausted) return

    if (!requestRecoveryReload()) {
      setAttempts(MAX_RECOVERY_ATTEMPTS)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradely-light px-5 py-10">
      <section
        role="alert"
        aria-live="polite"
        className="w-full max-w-xl rounded-2xl border border-slate-200 bg-gradely-white p-7 shadow-sm"
      >
        <span className="inline-flex rounded-2xl bg-amber-50 p-3">
          <AlertTriangle
            aria-hidden="true"
            className="size-6 text-amber-700"
          />
        </span>

        <h1 className="mt-4 text-xl font-bold text-gradely-navy">
          {exhausted ? 'We could not load your account' : 'Something went wrong'}
        </h1>

        <p className="mt-3 text-sm leading-relaxed text-gradely-text">
          {exhausted ? FINAL_RECOVERY_MESSAGE : message}
        </p>

        {!exhausted ? (
          <p className="mt-2 text-xs text-gradely-muted">
            Attempt {attempts + 1} of {MAX_RECOVERY_ATTEMPTS}. Your data has not
            been changed.
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          {!exhausted && onRetry ? (
            <Button onClick={() => void retry()} loading={busy}>
              <RefreshCw aria-hidden="true" className="size-4" />
              Try again
            </Button>
          ) : null}

          {!exhausted ? (
            <Button variant="secondary" onClick={reload} disabled={busy}>
              <RotateCw aria-hidden="true" className="size-4" />
              Reload page
            </Button>
          ) : null}

          {exhausted ? (
            <Button variant="secondary" onClick={() => window.location.assign('/')}>
              Return to start
            </Button>
          ) : null}
        </div>

        <p className="mt-5 text-xs leading-relaxed text-gradely-muted">
          If the problem continues, wait a few minutes and open Wise Grade again.
        </p>
      </section>
    </main>
  )
}
