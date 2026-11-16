import {
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorNotice,
  LoadingPanel,
  PageHeader,
  Panel,
  SelectField,
} from '../../components/ui'
import FormField from '../../components/FormField'
import { formatDate, formatDateTime, statusLabel } from '../../lib/format'
import {
  closePlatformTerm,
  getPlatformSchoolCalendar,
  listPlatformCalendars,
  runPlatformCalendarForSchool,
  updatePlatformTermDates,
} from '../../platform/api'
import type {
  PlatformCalendarTransition,
  PlatformSchoolCalendar,
  PlatformSchoolTerm,
} from '../../platform/types'

export default function PlatformCalendarPage() {
  const [calendars, setCalendars] = useState<PlatformSchoolCalendar[]>([])
  const [schoolId, setSchoolId] = useState('')
  const [calendar, setCalendar] = useState<PlatformSchoolCalendar | null>(null)
  const [transitions, setTransitions] = useState<PlatformCalendarTransition[]>([])
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [dateTerm, setDateTerm] = useState<PlatformSchoolTerm | null>(null)
  const [dateValues, setDateValues] = useState({ startsOn: '', endsOn: '' })
  const [dateBusy, setDateBusy] = useState(false)
  const [dateError, setDateError] = useState<string | null>(null)

  const [closeTerm, setCloseTerm] = useState<PlatformSchoolTerm | null>(null)
  const [closeBusy, setCloseBusy] = useState(false)
  const [closeError, setCloseError] = useState<string | null>(null)
  const [runBusy, setRunBusy] = useState(false)

  const loadCalendars = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await listPlatformCalendars()
      setCalendars(response.calendars)
      setSchoolId((current) =>
        response.calendars.some((item) => item.schoolId === current)
          ? current
          : (response.calendars[0]?.schoolId ?? ''),
      )
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not load school calendars.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCalendars()
  }, [loadCalendars])

  const loadDetail = useCallback(async (id: string) => {
    try {
      setDetailLoading(true)
      const response = await getPlatformSchoolCalendar(id)
      setCalendar(response.calendar)
      setTransitions(response.transitions)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not load the calendar.',
      )
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    if (schoolId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadDetail(schoolId)
    }
  }, [schoolId, loadDetail])

  const upcoming = useMemo(
    () => calendar?.years.flatMap((year) => year.terms).filter((term) => term.status === 'PLANNED') ?? [],
    [calendar],
  )

  async function runNow() {
    if (!schoolId) return

    setRunBusy(true)
    setError(null)

    try {
      const response = await runPlatformCalendarForSchool(schoolId)
      setCalendar(response.calendar)
      await loadDetail(schoolId)
      setNotice('Calendar transition run completed.')
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not run the calendar.',
      )
    } finally {
      setRunBusy(false)
    }
  }

  function openDates(term: PlatformSchoolTerm) {
    setDateValues({ startsOn: term.startsOn, endsOn: term.endsOn })
    setDateError(null)
    setDateTerm(term)
  }

  async function saveDates() {
    if (!dateTerm || !schoolId) return

    setDateBusy(true)
    setDateError(null)

    try {
      await updatePlatformTermDates(schoolId, dateTerm.id, dateValues)
      setDateTerm(null)
      setNotice('Term dates corrected and audited.')
      await loadDetail(schoolId)
    } catch (cause) {
      setDateError(
        cause instanceof Error ? cause.message : 'Could not update term dates.',
      )
    } finally {
      setDateBusy(false)
    }
  }

  async function confirmClose() {
    if (!closeTerm || !schoolId) return

    setCloseBusy(true)
    setCloseError(null)

    try {
      await closePlatformTerm(schoolId, closeTerm.id)
      setCloseTerm(null)
      setNotice('Term closed.')
      await loadDetail(schoolId)
    } catch (cause) {
      setCloseError(
        cause instanceof Error
          ? cause.message
          : 'This term cannot close until completion checks pass.',
      )
    } finally {
      setCloseBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Academic calendar"
        description="Wise Grade centrally manages academic years, terms and automatic lifecycle transitions. Schools have read-only access."
        actions={
          <>
            <Button variant="secondary" onClick={() => void loadCalendars()} loading={loading}>
              <RefreshCw aria-hidden="true" className="size-4" />
              Refresh
            </Button>
            <Button onClick={() => void runNow()} loading={runBusy} disabled={!schoolId}>
              <CalendarClock aria-hidden="true" className="size-4" />
              Run transitions
            </Button>
          </>
        }
      />

      {error ? <ErrorNotice message={error} onRetry={() => void loadCalendars()} /> : null}
      {notice ? (
        <div role="status" className="rounded-2xl border border-gradely-green/30 bg-gradely-green/10 p-4 text-sm text-[#137026]">
          {notice}
        </div>
      ) : null}

      {loading ? <LoadingPanel label="Loading calendars…" /> : null}

      {!loading && calendars.length === 0 ? (
        <EmptyState
          title="No school calendars"
          description="Calendars are created automatically when a school registers."
          icon={CalendarDays}
        />
      ) : null}

      {calendars.length > 0 ? (
        <>
          <Panel>
            <div className="sm:max-w-md">
              <SelectField
                label="School"
                value={schoolId}
                onChange={(event) => setSchoolId(event.target.value)}
              >
                {calendars.map((item) => (
                  <option key={item.schoolId} value={item.schoolId}>
                    {item.schoolName}
                  </option>
                ))}
              </SelectField>
            </div>
          </Panel>

          {detailLoading ? <LoadingPanel label="Loading calendar…" /> : null}

          {calendar ? (
            <>
              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs uppercase tracking-wide text-gradely-muted">Server date</p>
                  <p className="mt-1 text-lg font-extrabold text-gradely-navy">
                    {formatDate(calendar.serverDate)}
                  </p>
                  <p className="text-xs text-gradely-muted">{calendar.timezone}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs uppercase tracking-wide text-gradely-muted">Current year</p>
                  <p className="mt-1 text-lg font-extrabold text-gradely-navy">
                    {calendar.currentYear?.name ?? '—'}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs uppercase tracking-wide text-gradely-muted">Current term</p>
                  <p className="mt-1 text-lg font-extrabold text-gradely-navy">
                    {calendar.currentTerm?.name ?? '—'}
                  </p>
                  <p className="text-xs text-gradely-muted">
                    {calendar.currentTerm?.status ?? 'No open term'}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs uppercase tracking-wide text-gradely-muted">Next term</p>
                  <p className="mt-1 text-lg font-extrabold text-gradely-navy">
                    {calendar.nextTerm?.name ?? '—'}
                  </p>
                  <p className="text-xs text-gradely-muted">
                    {calendar.nextTerm ? formatDate(calendar.nextTerm.startsOn) : 'Not scheduled'}
                  </p>
                </div>
              </section>

              <Panel>
                <h2 className="text-base font-bold text-gradely-text">Academic years and terms</h2>
                <p className="mt-1 text-sm text-gradely-muted">
                  Closing a term is blocked until every required result submission is accepted.
                </p>
                <div className="mt-4 space-y-4">
                  {calendar.years.map((year) => (
                    <div key={year.id} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold text-gradely-text">
                          {year.name}{' '}
                          {year.isCurrent ? <Badge tone="info">Current</Badge> : null}
                          {year.isArchived ? <Badge tone="neutral">Archived</Badge> : null}
                        </p>
                        <p className="text-xs text-gradely-muted">
                          {formatDate(year.startsOn)} – {formatDate(year.endsOn)}
                        </p>
                      </div>
                      <div className="mt-2 overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-200 text-xs">
                          <thead>
                            <tr className="text-left uppercase tracking-wide text-gradely-muted">
                              <th className="px-2 py-1.5 font-semibold">Term</th>
                              <th className="px-2 py-1.5 font-semibold">Status</th>
                              <th className="px-2 py-1.5 font-semibold">Dates</th>
                              <th className="px-2 py-1.5 font-semibold">Assessment deadline</th>
                              <th className="px-2 py-1.5 font-semibold">Reports</th>
                              <th className="px-2 py-1.5 font-semibold">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {year.terms.map((term) => (
                              <tr key={term.id}>
                                <td className="px-2 py-2 font-semibold text-gradely-text">
                                  {term.name}
                                  {term.isCurrent ? ' · current' : ''}
                                </td>
                                <td className="px-2 py-2">
                                  <Badge
                                    tone={
                                      term.status === 'OPEN'
                                        ? 'success'
                                        : term.status === 'PLANNED'
                                          ? 'info'
                                          : 'neutral'
                                    }
                                  >
                                    {term.status}
                                  </Badge>
                                </td>
                                <td className="px-2 py-2 text-gradely-muted">
                                  {formatDate(term.startsOn)} – {formatDate(term.endsOn)}
                                </td>
                                <td className="px-2 py-2 text-gradely-muted">
                                  {formatDate(term.assessmentDeadline)}
                                </td>
                                <td className="px-2 py-2 text-gradely-muted">
                                  {statusLabel(term.reportStatus)}
                                </td>
                                <td className="px-2 py-2">
                                  <div className="flex flex-wrap gap-1.5">
                                    <Button size="sm" variant="secondary" onClick={() => openDates(term)}>
                                      Correct dates
                                    </Button>
                                    {term.status === 'OPEN' ? (
                                      <Button
                                        size="sm"
                                        variant="danger"
                                        onClick={() => {
                                          setCloseError(null)
                                          setCloseTerm(term)
                                        }}
                                      >
                                        Close
                                      </Button>
                                    ) : null}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>

              {upcoming.length > 0 ? (
                <Panel>
                  <h2 className="flex items-center gap-2 text-base font-bold text-gradely-text">
                    <CalendarClock aria-hidden="true" className="size-5 text-gradely-blue" />
                    Upcoming transitions
                  </h2>
                  <ul className="mt-3 space-y-2 text-sm text-gradely-muted">
                    {upcoming.map((term) => (
                      <li key={term.id}>
                        <span className="font-semibold text-gradely-text">{term.name}</span>{' '}
                        opens {formatDate(term.startsOn)} · assessment deadline{' '}
                        {formatDate(term.assessmentDeadline)} · closes{' '}
                        {formatDate(term.endsOn)}
                      </li>
                    ))}
                  </ul>
                </Panel>
              ) : null}

              <Panel>
                <h2 className="flex items-center gap-2 text-base font-bold text-gradely-text">
                  <ShieldAlert aria-hidden="true" className="size-5 text-gradely-blue" />
                  Transition history
                </h2>
                {transitions.length === 0 ? (
                  <p className="mt-2 text-sm text-gradely-muted">No transitions recorded.</p>
                ) : (
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200 text-xs">
                      <thead>
                        <tr className="text-left uppercase tracking-wide text-gradely-muted">
                          <th className="px-2 py-1.5 font-semibold">When</th>
                          <th className="px-2 py-1.5 font-semibold">Action</th>
                          <th className="px-2 py-1.5 font-semibold">Status</th>
                          <th className="px-2 py-1.5 font-semibold">Trigger</th>
                          <th className="px-2 py-1.5 font-semibold">Message</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {transitions.map((transition) => (
                          <tr key={transition.id}>
                            <td className="px-2 py-1.5 text-gradely-muted">
                              {formatDateTime(transition.createdAt)}
                            </td>
                            <td className="px-2 py-1.5 font-semibold text-gradely-text">
                              {statusLabel(transition.action)}
                            </td>
                            <td className="px-2 py-1.5 text-gradely-muted">{transition.status}</td>
                            <td className="px-2 py-1.5 text-gradely-muted">{transition.trigger}</td>
                            <td className="px-2 py-1.5 text-gradely-muted">
                              {transition.message ?? '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </>
          ) : null}
        </>
      ) : null}

      {dateTerm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h2 className="text-lg font-bold text-gradely-text">
              Correct {dateTerm.name} dates
            </h2>
            <p className="mt-1 text-sm text-gradely-muted">
              This is an exceptional correction. The change is audited and must
              preserve a valid academic year.
            </p>
            {dateError ? <ErrorNotice message={dateError} /> : null}
            <div className="mt-4 space-y-3">
              <FormField
                label="Opening date"
                type="date"
                value={dateValues.startsOn}
                onChange={(event) =>
                  setDateValues((current) => ({ ...current, startsOn: event.target.value }))
                }
              />
              <FormField
                label="Closing date"
                type="date"
                value={dateValues.endsOn}
                onChange={(event) =>
                  setDateValues((current) => ({ ...current, endsOn: event.target.value }))
                }
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setDateTerm(null)}
                disabled={dateBusy}
              >
                Cancel
              </Button>
              <Button onClick={() => void saveDates()} loading={dateBusy}>
                <CheckCircle2 aria-hidden="true" className="size-4" />
                Save dates
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(closeTerm)}
        title="Close term now"
        description={
          closeTerm
            ? `Closing ${closeTerm.name} runs the completion check. If any required result submission is not accepted, the term will not close.`
            : ''
        }
        confirmLabel="Close term"
        danger
        busy={closeBusy}
        onConfirm={() => void confirmClose()}
        onCancel={() => {
          if (!closeBusy) setCloseTerm(null)
        }}
      />
      {closeError ? <ErrorNotice message={closeError} /> : null}
    </div>
  )
}
