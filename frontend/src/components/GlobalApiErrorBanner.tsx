import { AlertTriangle, RotateCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  hasInFlightMutations,
  subscribeApiBusy,
  subscribeApiFailures,
} from '../lib/api'
import {
  FINAL_RECOVERY_MESSAGE,
  MAX_RECOVERY_ATTEMPTS,
  getRecoveryAttempts,
  requestRecoveryReload,
} from '../lib/recovery'
import { Button } from './ui'

/**
 * One global, dismissible banner for temporary network and server failures.
 *
 * It deliberately does nothing automatically: no reload, no retry storm. A save
 * or upload in progress disables the reload action so the user cannot discard
 * an operation by accident. After three explicit recovery attempts the banner
 * shows the final message and stops offering a reload.
 */
export default function GlobalApiErrorBanner() {
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(hasInFlightMutations)
  const [attempts, setAttempts] = useState(getRecoveryAttempts)

  useEffect(() => {
    return subscribeApiFailures((failure) => {
      // Form and sign-in screens already show their own inline messages.
      if (failure.path.startsWith('/api/auth/')) return
      if (failure.kind === 'network' || failure.kind === 'server') {
        setVisible(true)
        setAttempts(getRecoveryAttempts())
      }
    })
  }, [])

  useEffect(() => {
    return subscribeApiBusy(setBusy)
  }, [])

  if (!visible) return null

  const exhausted = attempts >= MAX_RECOVERY_ATTEMPTS

  function retry() {
    if (!requestRecoveryReload()) {
      setAttempts(MAX_RECOVERY_ATTEMPTS)
    }
  }

  return (
    <div
      role="alert"
      className="fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-3xl flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 shadow-lg sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <p>
          {exhausted
            ? FINAL_RECOVERY_MESSAGE
            : busy
              ? 'Wise Grade is temporarily unavailable. Your save is still in progress, so recovery is paused until it finishes.'
              : 'Wise Grade is having trouble reaching the server. Check your connection, then try again.'}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {!exhausted ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={retry}
            disabled={busy}
          >
            <RotateCw aria-hidden="true" className="size-3.5" />
            Reload
          </Button>
        ) : null}

        <button
          type="button"
          aria-label="Dismiss message"
          className="rounded-lg p-1.5 text-amber-900 hover:bg-amber-100"
          onClick={() => setVisible(false)}
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
    </div>
  )
}
