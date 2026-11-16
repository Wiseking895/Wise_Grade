import {
  AlertTriangle,
  CheckCircle2,
  Database,
  HardDrive,
  HeartPulse,
  RefreshCw,
  ServerCog,
  Timer,
  Wallet,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  Badge,
  Button,
  ErrorNotice,
  LoadingPanel,
  PageHeader,
  Panel,
} from '../../components/ui'
import { formatDateTime } from '../../lib/format'
import { getPlatformHealth } from '../../platform/api'
import { StatCard } from '../../platform/components'
import type {
  HealthCheck,
  HealthStatus,
  PlatformHealth,
} from '../../platform/types'

const STATUS_LABELS: Record<HealthStatus, string> = {
  ok: 'Operational',
  degraded: 'Degraded',
  error: 'Error',
  not_configured: 'Not configured',
  unknown: 'Unknown',
}

function statusTone(
  status: HealthStatus,
): 'success' | 'warning' | 'info' | 'neutral' {
  if (status === 'ok') return 'success'
  if (status === 'error') return 'warning'
  if (status === 'degraded' || status === 'not_configured') return 'warning'
  return 'neutral'
}

function CheckIcon({ status }: { status: HealthStatus }) {
  if (status === 'ok') {
    return <CheckCircle2 aria-hidden="true" className="size-5 text-[#137026]" />
  }

  if (status === 'error') {
    return <XCircle aria-hidden="true" className="size-5 text-red-600" />
  }

  return <AlertTriangle aria-hidden="true" className="size-5 text-[#7a5400]" />
}

function checkIcon(id: string) {
  if (id === 'database' || id === 'prisma' || id === 'migrations') {
    return <Database aria-hidden="true" className="size-4" />
  }

  if (id === 'storage') {
    return <HardDrive aria-hidden="true" className="size-4" />
  }

  if (id === 'scheduler') {
    return <Timer aria-hidden="true" className="size-4" />
  }

  return <Wallet aria-hidden="true" className="size-4" />
}

function CheckRow({ check }: { check: HealthCheck }) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
      <span className="mt-0.5">
        <CheckIcon status={check.status} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-gradely-muted">{checkIcon(check.id)}</span>
          <p className="font-semibold text-gradely-text">{check.label}</p>
          <Badge tone={statusTone(check.status)}>
            {STATUS_LABELS[check.status]}
          </Badge>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-gradely-muted">
          {check.detail}
        </p>
      </div>
    </li>
  )
}

export default function PlatformHealthPage() {
  const [health, setHealth] = useState<PlatformHealth | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      setHealth(await getPlatformHealth())
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load platform health.',
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
        title="Platform health"
        description="Live, non-destructive checks against the database, Prisma client, migrations, private storage, the academic scheduler and payment integrations. No secrets or object keys are exposed."
        actions={
          <Button variant="secondary" onClick={() => void load()} loading={loading}>
            <RefreshCw aria-hidden="true" className="size-4" />
            Run checks
          </Button>
        }
      />

      {error ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}
      {loading && !health ? (
        <LoadingPanel label="Running platform health checks…" />
      ) : null}

      {health ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Overall status"
              value={STATUS_LABELS[health.status]}
              tone={
                health.status === 'ok'
                  ? 'success'
                  : health.status === 'error'
                    ? 'warning'
                    : 'info'
              }
              hint={`Checked ${formatDateTime(health.generatedAt)}`}
              icon={<HeartPulse aria-hidden="true" className="size-5" />}
            />
            <StatCard
              label="Migrations"
              value={`${health.migrations.appliedCount}/${health.migrations.expectedCount}`}
              tone={health.migrations.upToDate ? 'success' : 'warning'}
              hint={
                health.migrations.upToDate
                  ? 'All migration files are applied'
                  : `${health.migrations.pending.length} pending migration file(s)`
              }
              icon={<Database aria-hidden="true" className="size-5" />}
            />
            <StatCard
              label="Scheduler"
              value={
                health.scheduler.enabled
                  ? `${health.scheduler.consecutiveFailures} failure(s)`
                  : 'Disabled'
              }
              tone={
                !health.scheduler.enabled
                  ? 'info'
                  : health.scheduler.consecutiveFailures > 0
                    ? 'warning'
                    : 'success'
              }
              hint={
                health.scheduler.lastRun
                  ? `Last run ${formatDateTime(health.scheduler.lastRun.startedAt)}`
                  : 'No run recorded yet'
              }
              icon={<Timer aria-hidden="true" className="size-5" />}
            />
            <StatCard
              label="Payment provider"
              value={health.paymentProvider.configured ? 'Configured' : 'Manual only'}
              tone={health.paymentProvider.configured ? 'success' : 'info'}
              hint={
                health.paymentProvider.lastWebhookAt
                  ? `Last webhook ${formatDateTime(health.paymentProvider.lastWebhookAt)}`
                  : 'No webhook received'
              }
              icon={<Wallet aria-hidden="true" className="size-5" />}
            />
          </div>

          <Panel>
            <h2 className="flex items-center gap-2 text-base font-bold text-gradely-text">
              <ServerCog aria-hidden="true" className="size-5 text-gradely-blue" />
              Health checks
            </h2>
            <ul className="mt-4 space-y-2">
              {health.checks.map((check) => (
                <CheckRow key={check.id} check={check} />
              ))}
            </ul>
          </Panel>

          <div className="grid gap-6 xl:grid-cols-2">
            <Panel>
              <h2 className="text-base font-bold text-gradely-text">
                Migration status
              </h2>
              <dl className="mt-4 space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-gradely-muted">Latest applied</dt>
                  <dd className="text-right font-semibold text-gradely-text">
                    {health.migrations.latestApplied ?? 'None recorded'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-gradely-muted">Applied at</dt>
                  <dd className="text-right font-semibold text-gradely-text">
                    {health.migrations.latestAppliedAt
                      ? formatDateTime(health.migrations.latestAppliedAt)
                      : 'Unknown'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-gradely-muted">Pending files</dt>
                  <dd className="text-right font-semibold text-gradely-text">
                    {health.migrations.pending.length}
                  </dd>
                </div>
              </dl>
              {health.migrations.pending.length > 0 ? (
                <ul className="mt-3 space-y-1 text-xs text-gradely-muted">
                  {health.migrations.pending.map((migration) => (
                    <li key={migration} className="rounded-lg bg-gradely-light px-2 py-1">
                      {migration}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Panel>

            <Panel>
              <h2 className="text-base font-bold text-gradely-text">
                Scheduler history
              </h2>
              <dl className="mt-4 space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-gradely-muted">Interval</dt>
                  <dd className="text-right font-semibold text-gradely-text">
                    Every {health.scheduler.intervalMinutes} minute(s)
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-gradely-muted">Last successful run</dt>
                  <dd className="text-right font-semibold text-gradely-text">
                    {health.scheduler.lastSuccessfulRun
                      ? formatDateTime(health.scheduler.lastSuccessfulRun.startedAt)
                      : 'None recorded'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-gradely-muted">Last status</dt>
                  <dd className="text-right font-semibold text-gradely-text">
                    {health.scheduler.lastRun?.status ?? 'Unknown'}
                  </dd>
                </div>
              </dl>
              {health.scheduler.lastRun?.message ? (
                <p className="mt-3 rounded-xl bg-gradely-light p-3 text-xs text-gradely-muted">
                  {health.scheduler.lastRun.message}
                </p>
              ) : null}
            </Panel>
          </div>
        </>
      ) : null}
    </div>
  )
}
