import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileWarning,
  RefreshCw,
  Send,
  Timer,
} from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Badge,
  Button,
  EmptyState,
  ErrorNotice,
  LoadingPanel,
  PageHeader,
  Panel,
} from '../../components/ui'
import { formatDateTime } from '../../lib/format'
import { getPlatformMonitoring } from '../../platform/api'
import type {
  PlatformMonitoring,
  PlatformMonitoringBucket,
} from '../../platform/types'

interface BucketDefinition {
  key: keyof Omit<PlatformMonitoring, 'generatedAt'>
  title: string
  description: string
  icon: ReactNode
  tone: 'neutral' | 'success' | 'warning' | 'info' | 'danger'
}

const BUCKETS: BucketDefinition[] = [
  {
    key: 'notSubmitted',
    title: 'Results not submitted',
    description: 'Draft result entry that the school has not submitted.',
    icon: <ClipboardList aria-hidden="true" className="size-5" />,
    tone: 'warning',
  },
  {
    key: 'awaitingReview',
    title: 'Awaiting school review',
    description: 'Submitted results waiting for the school administrator.',
    icon: <Send aria-hidden="true" className="size-5" />,
    tone: 'info',
  },
  {
    key: 'returnedForCorrection',
    title: 'Returned for correction',
    description: 'Results returned to the teacher for correction.',
    icon: <FileWarning aria-hidden="true" className="size-5" />,
    tone: 'danger',
  },
  {
    key: 'acceptedAwaitingReports',
    title: 'Accepted, awaiting reports',
    description: 'Administrator-accepted results ready for report generation.',
    icon: <CheckCircle2 aria-hidden="true" className="size-5" />,
    tone: 'success',
  },
  {
    key: 'approachingDeadlines',
    title: 'Term deadlines approaching',
    description: 'Open terms closing within the next 14 days.',
    icon: <Timer aria-hidden="true" className="size-5" />,
    tone: 'warning',
  },
  {
    key: 'incompleteEndOfYear',
    title: 'End-of-year work incomplete',
    description: 'Schools with an unfinished assessment or report workflow.',
    icon: <AlertTriangle aria-hidden="true" className="size-5" />,
    tone: 'danger',
  },
]

function bucketToneClass(tone: BucketDefinition['tone']): string {
  switch (tone) {
    case 'success':
      return 'border-gradely-green/25 bg-gradely-green/5'
    case 'warning':
      return 'border-gradely-gold/40 bg-gradely-gold/10'
    case 'info':
      return 'border-gradely-blue/25 bg-gradely-blue/5'
    case 'danger':
      return 'border-red-200 bg-red-50'
    default:
      return 'border-slate-200 bg-white'
  }
}

function BucketCard({
  definition,
  bucket,
}: {
  definition: BucketDefinition
  bucket: PlatformMonitoringBucket
}) {
  return (
    <section
      aria-label={definition.title}
      className={`rounded-2xl border p-4 shadow-sm sm:p-5 ${bucketToneClass(definition.tone)}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-gradely-text">
            {definition.title}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-gradely-muted">
            {definition.description}
          </p>
        </div>
        <span className="text-gradely-blue">{definition.icon}</span>
      </div>

      <p className="mt-3 text-2xl font-extrabold tracking-tight text-gradely-navy">
        {bucket.count}
      </p>
      <p className="text-xs text-gradely-muted">
        {bucket.schools.length} school(s) affected
      </p>

      {bucket.schools.length === 0 ? (
        <p className="mt-3 text-xs text-gradely-muted">Nothing outstanding.</p>
      ) : (
        <ul className="mt-3 space-y-2 text-xs">
          {bucket.schools.slice(0, 6).map((school) => (
            <li
              key={`${definition.key}:${school.schoolId}`}
              className="rounded-lg bg-white/70 px-2.5 py-2"
            >
              <Link
                to="/platform/schools"
                className="font-semibold text-gradely-navy underline decoration-gradely-blue/30 underline-offset-2 hover:text-gradely-blue"
              >
                {school.schoolName}
              </Link>
              <span className="ml-1 text-gradely-muted">· {school.detail}</span>
            </li>
          ))}
          {bucket.schools.length > 6 ? (
            <li className="px-1 text-gradely-muted">
              +{bucket.schools.length - 6} more school(s)
            </li>
          ) : null}
        </ul>
      )}
    </section>
  )
}

export default function PlatformMonitoringPage() {
  const [monitoring, setMonitoring] = useState<PlatformMonitoring | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      setMonitoring(await getPlatformMonitoring())
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load academic monitoring figures.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const totalOutstanding = monitoring
    ? BUCKETS.reduce((sum, item) => sum + monitoring[item.key].count, 0)
    : 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Academic monitoring"
        description="Cross-school view of result entry, school academic review and report readiness. Academic acceptance happens in the school workspace; report generation happens on the platform."
        actions={
          <Button variant="secondary" onClick={() => void load()} loading={loading}>
            <RefreshCw aria-hidden="true" className="size-4" />
            Refresh
          </Button>
        }
      />

      {error ? (
        <ErrorNotice message={error} onRetry={() => void load()} />
      ) : null}

      {loading && !monitoring ? (
        <LoadingPanel label="Loading monitoring figures…" />
      ) : null}

      {monitoring ? (
        <>
          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-gradely-text">
                  {totalOutstanding} outstanding item(s)
                </h2>
                <p className="mt-1 text-sm text-gradely-muted">
                  Calculated {formatDateTime(monitoring.generatedAt)} from live
                  school records.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  to="/platform/reports"
                  className="text-sm font-semibold text-gradely-navy underline decoration-gradely-blue/40 underline-offset-2 hover:text-gradely-blue"
                >
                  Report requests
                </Link>
                <span aria-hidden="true" className="text-gradely-muted">
                  ·
                </span>
                <Link
                  to="/platform/billing"
                  className="text-sm font-semibold text-gradely-navy underline decoration-gradely-blue/40 underline-offset-2 hover:text-gradely-blue"
                >
                  Billing records
                </Link>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge tone="info">
                <Clock aria-hidden="true" className="mr-1 size-3.5" />
                School administrators accept results
              </Badge>
              <Badge tone="success">
                <CheckCircle2 aria-hidden="true" className="mr-1 size-3.5" />
                Generate Reports is one audited action
              </Badge>
            </div>
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {BUCKETS.map((definition) => (
              <BucketCard
                key={definition.key}
                definition={definition}
                bucket={monitoring[definition.key]}
              />
            ))}
          </div>
        </>
      ) : null}

      {!loading && !monitoring && !error ? (
        <EmptyState
          title="No monitoring data"
          description="Monitoring figures will appear once schools begin entering results."
          icon={ClipboardList}
        />
      ) : null}
    </div>
  )
}
