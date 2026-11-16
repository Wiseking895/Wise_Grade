import {
  Activity,
  Building2,
  CalendarDays,
  FileCheck2,
  GraduationCap,
  ReceiptText,
  RefreshCw,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Button,
  ErrorNotice,
  LoadingPanel,
  PageHeader,
  Panel,
} from '../../components/ui'
import { formatDateTime, statusLabel } from '../../lib/format'
import { getPlatformOverview } from '../../platform/api'
import { SourceBadge, StatCard } from '../../platform/components'
import { formatMoney } from '../../platform/format'
import type { PlatformOverview } from '../../platform/types'

export default function PlatformOverviewPage() {
  const [overview, setOverview] = useState<PlatformOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      setOverview(await getPlatformOverview())
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load platform overview.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform overview"
        description="Live figures calculated from Wise Grade records across every school."
        actions={
          <Button variant="secondary" onClick={() => void load()} loading={loading}>
            <RefreshCw aria-hidden="true" className="size-4" />
            Refresh
          </Button>
        }
      />

      {error ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}

      {loading && !overview ? <LoadingPanel label="Loading platform figures…" /> : null}

      {overview ? (
        <>
          <section aria-label="School figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard
              label="Registered schools"
              value={overview.schools.total}
              hint={`${overview.schools.active} active · ${overview.schools.suspended} suspended`}
              icon={<Building2 aria-hidden="true" className="size-5" />}
            />
            <StatCard
              label="Registered pupils"
              value={overview.people.pupils}
              hint="Active pupils across all schools"
              icon={<GraduationCap aria-hidden="true" className="size-5" />}
            />
            <StatCard
              label="Registered teachers"
              value={overview.people.teachers}
              hint={`${overview.people.activeUsers} active platform users`}
              icon={<Users aria-hidden="true" className="size-5" />}
            />
            <StatCard
              label="Academic years"
              value={overview.academics.academicYears}
              hint={
                overview.academics.currentTermName
                  ? `${overview.academics.activeTerms} open terms · current: ${overview.academics.currentTermName}`
                  : `${overview.academics.activeTerms} open terms`
              }
              icon={<CalendarDays aria-hidden="true" className="size-5" />}
            />
            <StatCard
              label="Reports prepared"
              value={overview.reports.prepared}
              hint={`${overview.reports.awaitingApproval} awaiting platform approval`}
              icon={<FileCheck2 aria-hidden="true" className="size-5" />}
            />
            <StatCard
              label="Reports released"
              value={overview.reports.released}
              hint={`${overview.reports.approvedAwaitingRelease} approved awaiting release · ${overview.reports.onHold} on hold`}
              tone="success"
              icon={<FileCheck2 aria-hidden="true" className="size-5" />}
            />
            <StatCard
              label="Payments awaiting verification"
              value={overview.payments.awaitingVerification}
              hint="Submitted payments that have not been verified"
              tone={overview.payments.awaitingVerification > 0 ? 'warning' : 'neutral'}
              icon={<ReceiptText aria-hidden="true" className="size-5" />}
            />
            <StatCard
              label="Verified payments"
              value={formatMoney(
                overview.payments.verifiedMinor,
                overview.payments.currency,
              )}
              hint={`${overview.payments.verifiedCount} verified payment record(s)`}
              tone="success"
              icon={<ReceiptText aria-hidden="true" className="size-5" />}
            />
            <StatCard
              label="Outstanding school payments"
              value={formatMoney(
                overview.payments.outstandingMinor,
                overview.payments.currency,
              )}
              hint="Issued and partially paid invoices"
              tone={overview.payments.outstandingMinor > 0 ? 'warning' : 'neutral'}
              icon={<ReceiptText aria-hidden="true" className="size-5" />}
            />
          </section>

          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-gradely-text">
                  Recent platform activity
                </h2>
                <p className="mt-1 text-sm text-gradely-muted">
                  Append-only audit events from platform, billing and calendar
                  sources.
                </p>
              </div>
              <Link
                to="/platform/audit"
                className="text-sm font-semibold text-gradely-navy underline decoration-gradely-blue/40 underline-offset-2 hover:text-gradely-blue"
              >
                View all audit logs
              </Link>
            </div>

            {overview.recentActivity.length === 0 ? (
              <p className="mt-4 text-sm text-gradely-muted">
                No platform activity has been recorded yet.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-gradely-muted">
                      <th className="px-3 py-2 font-semibold">When</th>
                      <th className="px-3 py-2 font-semibold">Source</th>
                      <th className="px-3 py-2 font-semibold">Action</th>
                      <th className="px-3 py-2 font-semibold">School</th>
                      <th className="px-3 py-2 font-semibold">Actor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {overview.recentActivity.map((entry) => (
                      <tr key={`${entry.source}:${entry.id}`}>
                        <td className="whitespace-nowrap px-3 py-2.5 text-gradely-muted">
                          {formatDateTime(entry.createdAt)}
                        </td>
                        <td className="px-3 py-2.5">
                          <SourceBadge source={entry.source} />
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-gradely-text">
                          {statusLabel(entry.action)}
                        </td>
                        <td className="px-3 py-2.5 text-gradely-muted">
                          {entry.schoolName ?? 'Platform'}
                        </td>
                        <td className="px-3 py-2.5 text-gradely-muted">
                          {entry.actorName ?? entry.actorEmail ?? 'System'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel className="bg-gradely-light">
            <div className="flex items-start gap-3">
              <Activity aria-hidden="true" className="mt-0.5 size-5 text-gradely-blue" />
              <div>
                <h2 className="text-base font-bold text-gradely-text">
                  Calculated {formatDateTime(overview.generatedAt)}
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-gradely-muted">
                  Every figure above is queried from PostgreSQL at request time.
                  Report release remains separate from academic acceptance and
                  payment verification.
                </p>
              </div>
            </div>
          </Panel>
        </>
      ) : null}
    </div>
  )
}
