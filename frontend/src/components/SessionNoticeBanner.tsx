import { Info, X } from 'lucide-react'
import { useAuth } from '../auth/use-auth'

/**
 * Controlled notice for a session that ended because it expired or was idle.
 * It replaces repeated logout prompts: the user sees one explanation and can
 * dismiss it before signing in again.
 */
export default function SessionNoticeBanner() {
  const { sessionNotice, dismissSessionNotice } = useAuth()

  if (!sessionNotice) return null

  return (
    <div
      role="status"
      className="border-b border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950"
    >
      <div className="mx-auto flex max-w-6xl items-start justify-between gap-3">
        <p className="flex items-start gap-2">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {sessionNotice}
        </p>
        <button
          type="button"
          aria-label="Dismiss session notice"
          className="rounded-lg p-1 hover:bg-sky-100"
          onClick={dismissSessionNotice}
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
    </div>
  )
}
