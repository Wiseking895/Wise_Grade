import { MapPin, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Badge, Button, Modal } from './ui'
import { formatPlaceLine, shortPlaceLabel } from '../location/device-time-zone'
import { locationMessage } from '../location/messages'
import { useLocationDetection } from '../location/use-location'

/**
 * Compact, personal location indicator for the school dashboard header.
 *
 * It always shows the device timezone (detected with the browser's
 * internationalization API). A place name appears only after the user grants
 * location permission; coordinates are sent once to our API and never stored.
 * Denied, unsupported and failed states keep the timezone visible.
 */
export default function LocationIndicator() {
  const { timeZone, phase, place, detect } = useLocationDetection()
  const [open, setOpen] = useState(false)

  const placeLine = formatPlaceLine(place)
  const compactPlace = shortPlaceLabel(place)
  const resolved = phase === 'resolved' && place !== null
  const requesting = phase === 'requesting'
  const message = locationMessage(phase)
  const canRetry = phase !== 'unsupported'

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Location and timezone: ${
          placeLine ? `${placeLine}, ` : ''
        }${timeZone}`}
        title={placeLine ? `${placeLine}\n${timeZone}` : timeZone}
        className="flex min-w-0 max-w-[10.5rem] shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-left shadow-sm transition-colors hover:bg-gradely-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gradely-blue/40"
      >
        <MapPin
          aria-hidden="true"
          className="size-4 shrink-0 text-gradely-blue"
        />
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold text-gradely-text">
            {compactPlace ?? 'Detect location'}
          </span>
          <span className="block truncate text-[11px] leading-tight text-gradely-muted">
            {timeZone}
          </span>
        </span>
      </button>

      {typeof document === 'undefined'
        ? null
        : createPortal(
            <Modal
              open={open}
              title="Your location"
              description="Used only to show your local area and time on this dashboard."
              onClose={() => setOpen(false)}
            >
              <div className="space-y-4 text-sm">
                <div className="rounded-xl border border-slate-200 bg-gradely-light/60 p-4">
                  <Badge
                    tone={
                      resolved ? 'success' : requesting ? 'info' : 'neutral'
                    }
                  >
                    {resolved
                      ? 'Location detected automatically'
                      : requesting
                        ? 'Requesting location…'
                        : 'Device timezone detected automatically'}
                  </Badge>

                  {resolved && placeLine ? (
                    <p className="mt-3 text-base font-bold text-gradely-text">
                      {placeLine}
                    </p>
                  ) : null}

                  <dl className="mt-3 space-y-1.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <dt className="text-xs font-semibold text-gradely-muted">
                        {resolved ? 'Detected timezone' : 'Device timezone'}
                      </dt>
                      <dd className="font-semibold break-words text-gradely-text">
                        {timeZone}
                      </dd>
                    </div>
                    {resolved && place?.countryCode ? (
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <dt className="text-xs font-semibold text-gradely-muted">
                          Country code
                        </dt>
                        <dd className="font-semibold text-gradely-text">
                          {place.countryCode}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </div>

                {message ? (
                  <p
                    role={phase === 'requesting' ? 'status' : 'alert'}
                    aria-live="polite"
                    className={`rounded-xl px-3 py-2 text-sm ${
                      phase === 'denied' || phase === 'network-error'
                        ? 'border border-amber-300 bg-amber-50 text-amber-900'
                        : 'text-gradely-muted'
                    }`}
                  >
                    {message}
                  </p>
                ) : null}

                <p className="text-xs leading-relaxed text-gradely-muted">
                  Your browser asks before sharing a location. Coordinates
                  are sent once to Wise Grade for a place-name lookup and are
                  not stored. This indicator never changes academic dates,
                  term deadlines or report dates, which stay on the official
                  school calendar.
                </p>

                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setOpen(false)}
                  >
                    Close
                  </Button>
                  {canRetry ? (
                    <Button
                      type="button"
                      onClick={() => void detect()}
                      loading={requesting}
                    >
                      <RefreshCw aria-hidden="true" className="size-4" />
                      {resolved ? 'Refresh location' : 'Detect my location'}
                    </Button>
                  ) : null}
                </div>
              </div>
            </Modal>,
            document.body,
          )}
    </>
  )
}
