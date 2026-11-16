import { ShieldAlert, ShieldCheck } from 'lucide-react'
import {
  RELEASE_STATUS_DESCRIPTIONS,
  RELEASE_STATUS_LABELS,
} from './labels'
import type { ReportReleaseStatus } from './types'

export function DraftNotice({
  description = 'Generated report cards are private working copies. They remain watermarked INTERNAL DRAFT — NOT RELEASED and cannot be shared with pupils or parents until a platform administrator releases the batch.',
}: {
  description?: string
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-gradely-gold/40 bg-gradely-gold/10 p-4">
      <ShieldAlert
        aria-hidden="true"
        className="mt-0.5 size-5 shrink-0 text-[#7a5400]"
      />
      <div>
        <p className="text-sm font-extrabold tracking-wide text-[#6b4a00]">
          INTERNAL DRAFT — NOT RELEASED
        </p>
        <p className="mt-1 text-sm leading-relaxed text-[#7a5400]">
          {description}
        </p>
      </div>
    </div>
  )
}

export function ReleaseStatusNotice({
  status,
  reason,
  description,
}: {
  status: ReportReleaseStatus | null | undefined
  reason?: string | null
  description?: string
}) {
  if (!status) {
    return <DraftNotice description={description} />
  }

  const released = status === 'RELEASED'

  return (
    <div
      className={`flex items-start gap-3 rounded-2xl border p-4 ${
        released
          ? 'border-gradely-green/40 bg-gradely-green/10'
          : 'border-gradely-gold/40 bg-gradely-gold/10'
      }`}
    >
      {released ? (
        <ShieldCheck
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-[#137026]"
        />
      ) : (
        <ShieldAlert
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-[#7a5400]"
        />
      )}
      <div>
        <p
          className={`text-sm font-extrabold tracking-wide ${
            released ? 'text-[#137026]' : 'text-[#6b4a00]'
          }`}
        >
          {released
            ? 'RELEASED — PRIVATE SCHOOL ACCESS'
            : `INTERNAL — ${RELEASE_STATUS_LABELS[status].toUpperCase()}`}
        </p>
        <p
          className={`mt-1 text-sm leading-relaxed ${
            released ? 'text-[#137026]' : 'text-[#7a5400]'
          }`}
        >
          {description ?? RELEASE_STATUS_DESCRIPTIONS[status]}
        </p>
        {reason ? (
          <p className="mt-2 rounded-lg bg-white/70 px-3 py-2 text-xs font-semibold text-gradely-text">
            Reason: {reason}
          </p>
        ) : null}
      </div>
    </div>
  )
}
