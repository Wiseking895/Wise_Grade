import {
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  FileCheck2,
  GraduationCap,
  Info,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  Badge,
  ErrorNotice,
  LoadingPanel,
  PageHeader,
  Panel,
} from '../../components/ui'
import { formatDate, statusLabel } from '../../lib/format'
import { getSchoolCalendar } from '../../schools/api'
import type {
  AcademicTermStatus,
  CalendarTerm,
  ReportPreparationStatus,
  SchoolCalendar,
} from '../../schools/types'
import { useSchool } from '../../schools/use-school'

const TERM_STATUS_TONE: Record<
  AcademicTermStatus,
  'neutral' | 'success' | 'info'
> = {
  PLANNED: 'neutral',
  OPEN: 'success',
  CLOSED: 'info',
}

const REPORT_STATUS_TONE: Record<
  ReportPreparationStatus,
  'neutral' | 'success' | 'info'
> = {
  NOT_PREPARED: 'neutral',
  PREPARED: 'success',
  CLOSED: 'info',
}

function DateItem({
  label,
  value,
}: {
  label: string
  value: string | null | undefined
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-gradely-light p-4">
      <p className="text-xs font-semibold tracking-wide whitespace-nowrap text-gradely-muted uppercase">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold whitespace-nowrap text-gradely-text">
        {formatDate(value)}
      </p>
    </div>
  )
}

function TermSummary({ term }: { term: CalendarTerm }) {
  const confirmed = term.datesConfirmed

  return (
    <div
      className={`rounded-2xl border p-5 shadow-sm ${
        confirmed
          ? 'border-slate-200 bg-white'
          : 'border-amber-300 bg-amber-50/60'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-gradely-navy">{term.name}</h3>
          <p className="mt-1 text-sm whitespace-nowrap text-gradely-muted">
            {formatDate(term.startsOn)} – {formatDate(term.endsOn)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {confirmed ? (
            <Badge tone={TERM_STATUS_TONE[term.status]}>
              {statusLabel(term.status)}
            </Badge>
          ) : (
            <Badge tone="warning">Dates awaiting confirmation</Badge>
          )}
          <Badge tone={REPORT_STATUS_TONE[term.reportStatus]}>
            Reports: {statusLabel(term.reportStatus)}
          </Badge>
        </div>
      </div>

      {!confirmed ? (
        <p className="mt-4 rounded-xl border border-amber-300 bg-white p-3 text-sm text-amber-900">
          The Platform Super Admin has not confirmed this term’s dates yet.
          The dates shown are provisional and no term transition, assessment
          deadline or examination period is official until confirmation.
        </p>
      ) : null}

      <dl className="mt-4 space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <dt className="text-xs font-semibold whitespace-nowrap text-gradely-muted">
            Assessment deadline
          </dt>
          <dd className="text-sm font-semibold whitespace-nowrap text-gradely-text">
            {confirmed ? formatDate(term.assessmentDeadline) : 'Pending confirmation'}
          </dd>
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <dt className="text-xs font-semibold whitespace-nowrap text-gradely-muted">
            Examination period
          </dt>
          <dd className="text-sm font-semibold whitespace-nowrap text-gradely-text">
            {confirmed
              ? `${formatDate(term.examinationStartsOn)} – ${formatDate(term.examinationEndsOn)}`
              : 'Pending confirmation'}
          </dd>
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <dt className="text-xs font-semibold whitespace-nowrap text-gradely-muted">
            Reports prepared
          </dt>
          <dd className="text-sm font-semibold whitespace-nowrap text-gradely-text">
            {term.reportsPreparedAt
              ? formatDate(term.reportsPreparedAt)
              : 'Not yet prepared'}
          </dd>
        </div>
      </dl>
    </div>
  )
}

export default function CalendarPage() {
  const { schoolId } = useSchool()
  const [calendar, setCalendar] = useState<SchoolCalendar | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!schoolId) return

    try {
      const response = await getSchoolCalendar(schoolId)
      setError(null)
      setCalendar(response.calendar)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load the academic calendar.',
      )
    } finally {
      setLoading(false)
    }
  }, [schoolId])

  useEffect(() => {
    // Data fetching is the intended external-system synchronisation here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const currentTerm = calendar?.currentTerm ?? null
  const nextTerm = calendar?.nextTerm ?? null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Academic calendar"
        actions={
          calendar ? (
            <span title="Official academic calendar timezone">
              <Badge tone="info">{calendar.timezone}</Badge>
            </span>
          ) : undefined
        }
      />

      {error ? (
        <ErrorNotice
          message={error}
          onRetry={() => {
            setLoading(true)
            setError(null)
            void load()
          }}
        />
      ) : null}
      {loading ? <LoadingPanel label="Loading academic calendar…" /> : null}

      {!loading && calendar ? (
        <>
          <div className="rounded-2xl border border-gradely-blue/20 bg-gradely-blue/5 p-4 text-sm leading-relaxed text-gradely-navy">
            <div className="flex items-start gap-3">
              <Info
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-gradely-blue"
              />
              <div>
                <p className="font-semibold">Centrally managed</p>
                <p className="mt-1 text-gradely-muted">
                  The Platform Super Admin configures academic years, terms,
                  assessment deadlines and examination periods. Terms open and
                  close on the official Ghana calendar, and reports are prepared
                  before a term closes. Calendar dates cannot be edited from the
                  school workspace.
                </p>
                <p className="mt-1 text-gradely-muted">
                  All dates use the official academic timezone ({calendar.timezone}),
                  not the location or timezone detected for your device.
                </p>
                <p className="mt-2 text-xs font-semibold text-gradely-muted">
                  Calendar date: {formatDate(calendar.serverDate)}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Panel className="lg:col-span-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-gradely-text">
                    Current academic period
                  </h2>
                  <p className="mt-1 text-sm text-gradely-muted">
                    The current year and term are used by enrollment and
                    assessment workflows.
                  </p>
                </div>
                <span className="rounded-xl bg-gradely-gold/15 p-2">
                  <CalendarDays
                    aria-hidden="true"
                    className="size-5 text-[#7a5400]"
                  />
                </span>
              </div>

              {calendar.currentYear ? (
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-gradely-light p-4">
                    <p className="text-xs font-semibold tracking-wide text-gradely-muted uppercase">
                      Academic year
                    </p>
                    <p className="mt-1 text-base font-bold text-gradely-navy">
                      {calendar.currentYear.name}
                    </p>
                    <p className="mt-1 text-xs text-gradely-muted">
                      {formatDate(calendar.currentYear.startsOn)} –{' '}
                      {formatDate(calendar.currentYear.endsOn)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-gradely-light p-4">
                    <p className="text-xs font-semibold tracking-wide text-gradely-muted uppercase">
                      Current term
                    </p>
                    <p className="mt-1 text-base font-bold text-gradely-navy">
                      {currentTerm?.name ?? 'No term is open'}
                    </p>
                    <p className="mt-1 text-xs text-gradely-muted">
                      {currentTerm
                        ? `${formatDate(currentTerm.startsOn)} – ${formatDate(currentTerm.endsOn)}`
                        : 'The next term opens automatically on its configured date.'}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="mt-5 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-gradely-muted">
                  No academic year is active yet. Wise Grade will initialise the
                  calendar automatically.
                </p>
              )}

              {currentTerm ? (
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <DateItem
                    label="Assessment deadline"
                    value={currentTerm.assessmentDeadline}
                  />
                  <DateItem
                    label="Examination period starts"
                    value={currentTerm.examinationStartsOn}
                  />
                  <DateItem
                    label="Examination period ends"
                    value={currentTerm.examinationEndsOn}
                  />
                  <div className="rounded-xl border border-slate-200 bg-gradely-light p-4">
                    <p className="text-xs font-semibold tracking-wide text-gradely-muted uppercase">
                      Reports
                    </p>
                    <div className="mt-1">
                      <Badge tone={REPORT_STATUS_TONE[currentTerm.reportStatus]}>
                        {statusLabel(currentTerm.reportStatus)}
                      </Badge>
                    </div>
                  </div>
                </div>
              ) : null}
            </Panel>

            <Panel>
              <div className="flex items-start gap-3">
                <span className="rounded-xl bg-gradely-blue/10 p-2.5">
                  <CalendarClock
                    aria-hidden="true"
                    className="size-5 text-gradely-blue"
                  />
                </span>
                <div>
                  <h2 className="text-base font-bold text-gradely-text">
                    Next term
                  </h2>
                  <p className="mt-1 text-sm text-gradely-muted">
                    The next scheduled period in the academic year.
                  </p>
                </div>
              </div>

              {nextTerm ? (
                <div className="mt-4 space-y-3">
                  <p className="text-lg font-bold text-gradely-navy">
                    {nextTerm.name}
                  </p>
                  <p className="text-sm text-gradely-muted">
                    Opens {formatDate(nextTerm.startsOn)} and closes{' '}
                    {formatDate(nextTerm.endsOn)}.
                  </p>
                  <Badge tone={TERM_STATUS_TONE[nextTerm.status]}>
                    {statusLabel(nextTerm.status)}
                  </Badge>
                </div>
              ) : (
                <p className="mt-4 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-gradely-muted">
                  No upcoming term is scheduled.
                </p>
              )}

              {currentTerm ? (
                <div className="mt-5 border-t border-slate-200 pt-4">
                  <p className="text-xs font-semibold tracking-wide text-gradely-muted uppercase">
                    Report preparation
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <FileCheck2
                      aria-hidden="true"
                      className="size-4 text-gradely-muted"
                    />
                    <p className="text-sm font-semibold text-gradely-text">
                      {currentTerm.reportsPreparedAt
                        ? `Prepared ${formatDate(currentTerm.reportsPreparedAt)}`
                        : 'Reports are prepared automatically at term end.'}
                    </p>
                  </div>
                </div>
              ) : null}
            </Panel>
          </div>

          <Panel>
            <div className="flex items-start gap-3">
              <span className="rounded-xl bg-gradely-gold/15 p-2.5">
                <GraduationCap
                  aria-hidden="true"
                  className="size-5 text-[#7a5400]"
                />
              </span>
              <div>
                <h2 className="text-base font-bold text-gradely-text">
                  Academic years and terms
                </h2>
                <p className="mt-1 text-sm text-gradely-muted">
                  Current and previous academic years are kept for your
                  records. Completed years are archived automatically.
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {calendar.years.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-gradely-muted">
                  No academic years have been recorded yet.
                </p>
              ) : (
                calendar.years.map((year) => (
                  <div
                    key={year.id}
                    className="rounded-2xl border border-slate-200 p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-bold text-gradely-navy">
                        {year.name}
                      </h3>
                      {year.isCurrent ? (
                        <Badge tone="success">Current year</Badge>
                      ) : null}
                      {year.isArchived ? (
                        <Badge tone="info">Archived</Badge>
                      ) : null}
                      <span className="text-xs whitespace-nowrap text-gradely-muted">
                        {formatDate(year.startsOn)} – {formatDate(year.endsOn)}
                      </span>
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {year.terms.map((term) => (
                        <TermSummary key={term.id} term={term} />
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Panel>

          <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-gradely-muted">
            <CalendarCheck
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-gradely-navy"
            />
            <p>
              Assessment deadlines and examination periods are configured
              independently by the Platform Super Admin and shown exactly as
              approved. Report generation is a separate platform action and is
              not gated by payment.
            </p>
          </div>
        </>
      ) : null}
    </div>
  )
}
