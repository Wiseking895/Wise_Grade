import { Check, CloudOff, Loader2 } from 'lucide-react'
import type { AutoSaveSnapshot } from '../lib/use-auto-save'

interface AutoSaveIndicatorProps extends AutoSaveSnapshot {
  onRetry?: () => void
  /** Hide the quiet "Saved" state when another notice already covers it. */
  hideSaved?: boolean
}

function timeLabel(value: Date | null): string {
  if (!value) return ''

  return value.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * The single, calm status line used by every auto-saved screen. It never shows
 * a password or payload, only whether the current edits are safe.
 */
export default function AutoSaveIndicator({
  status,
  error,
  lastSavedAt,
  hasPendingChanges,
  onRetry,
  hideSaved = false,
}: AutoSaveIndicatorProps) {
  if (status === 'error') {
    return (
      <p
        role="alert"
        className="flex flex-wrap items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800"
      >
        <CloudOff aria-hidden="true" className="size-4 shrink-0" />
        <span>{error ?? 'Could not save your changes.'} Your edits are still here.</span>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg border border-red-300 bg-white px-2 py-1 font-semibold text-red-800 hover:bg-red-100"
          >
            Retry
          </button>
        ) : null}
      </p>
    )
  }

  if (status === 'saving') {
    return (
      <p
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 text-xs font-medium text-gradely-muted"
      >
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        Saving…
      </p>
    )
  }

  if (status === 'pending' || hasPendingChanges) {
    return (
      <p
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 text-xs font-medium text-gradely-muted"
      >
        <span
          aria-hidden="true"
          className="size-2 rounded-full bg-amber-500"
        />
        Unsaved changes
      </p>
    )
  }

  if (status === 'saved' && !hideSaved) {
    return (
      <p
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 text-xs font-medium text-emerald-700"
      >
        <Check aria-hidden="true" className="size-4" />
        Saved{lastSavedAt ? ` at ${timeLabel(lastSavedAt)}` : ''}
      </p>
    )
  }

  return null
}
