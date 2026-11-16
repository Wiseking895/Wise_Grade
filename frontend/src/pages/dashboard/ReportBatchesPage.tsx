import {
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  FileWarning,
  RefreshCw,
  RotateCcw,
  X,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useState,
} from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AccessDenied,
  Badge,
  Button,
  EmptyState,
  ErrorNotice,
  LoadingPanel,
  PageHeader,
  Panel,
  SelectField,
} from '../../components/ui'
import {
  getReportBatch,
  listReportBatches,
  retryReportBatch,
} from '../../reports/api'
import { DraftNotice } from '../../reports/components'
import {
  BATCH_STATUS_LABELS,
  RELEASE_STATUS_SHORT_LABELS,
  batchTone,
  releaseTone,
} from '../../reports/labels'
import type {
  ReportBatch,
  ReportBatchDetail,
} from '../../reports/types'
import { useAcademicTerms } from '../../reports/use-academic-terms'
import { formatDateTime } from '../../lib/format'
import { useSchool } from '../../schools/use-school'

export default function ReportBatchesPage() {
  const { schoolId, isAdmin } = useSchool()
  const {
    options,
    selected,
    selectedTermId,
    setSelectedTermId,
    loading: termsLoading,
    error: termsError,
    reload: reloadTerms,
  } = useAcademicTerms(schoolId)
  const [searchParams, setSearchParams] = useSearchParams()
  const batchId = searchParams.get('batchId') ?? ''

  const [batches, setBatches] = useState<ReportBatch[]>([])
  const [detail, setDetail] = useState<ReportBatchDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const loadBatches = useCallback(async () => {
    if (!schoolId || !isAdmin) return

    try {
      setLoading(true)
      const response = await listReportBatches(schoolId, selected?.termId)
      setBatches(response.batches)
      setError(null)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load report generation batches.',
      )
    } finally {
      setLoading(false)
    }
  }, [isAdmin, schoolId, selected])

  const loadDetail = useCallback(async () => {
    if (!schoolId || !isAdmin || !batchId) {
      setDetail(null)
      return
    }

    try {
      setDetailLoading(true)
      const response = await getReportBatch(schoolId, batchId)
      setDetail(response.batch)
      setError(null)
    } catch (cause) {
      setDetail(null)
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load the report generation batch.',
      )
    } finally {
      setDetailLoading(false)
    }
  }, [batchId, isAdmin, schoolId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadBatches()
  }, [loadBatches])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadDetail()
  }, [loadDetail])

  if (!isAdmin) {
    return (
      <AccessDenied message="Only a school administrator can inspect report generation batches and failures." />
    )
  }

  async function handleRetry() {
    if (!schoolId || !detail) return

    try {
      setRetrying(true)
      setError(null)
      setSuccess(null)
      const response = await retryReportBatch(schoolId, detail.id)
      const generated = response.batches.reduce(
        (sum, batch) => sum + batch.batch.generatedCount,
        0,
      )
      setSuccess(
        `Retry finished. ${generated} report card${generated === 1 ? '' : 's'} generated.`,
      )
      await Promise.all([loadBatches(), loadDetail()])
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not retry failed report generation items.',
      )
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Report generation batches"
        description="Inspect generation history, skipped pupils, failures and immutable versions. A failed pupil never becomes an apparently complete report card."
        actions={
          <>
            <Link
              to="/dashboard/reports/release"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-gradely-text shadow-sm transition-colors hover:bg-gradely-light"
            >
              <FileCheck2 aria-hidden="true" className="size-4" />
              Release control
            </Link>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void loadBatches()
                void loadDetail()
                void reloadTerms()
              }}
              loading={loading || detailLoading || termsLoading}
            >
              <RefreshCw aria-hidden="true" className="size-4" />
              Refresh
            </Button>
          </>
        }
      />

      <DraftNotice description="Batch history is internal. Retrying a failed pupil creates a new version only when the pupil becomes eligible; previous versions are never overwritten. Release state is controlled separately by a platform super administrator." />

      <Panel>
        <SelectField
          label="Academic term"
          value={selectedTermId}
          onChange={(event) => setSelectedTermId(event.target.value)}
          disabled={termsLoading || options.length === 0}
          hint="Batches are listed for the selected term."
        >
          {options.length === 0 ? (
            <option value="">No terms available</option>
          ) : null}
          {options.map((option) => (
            <option key={option.termId} value={option.termId}>
              {option.label}
            </option>
          ))}
        </SelectField>
      </Panel>

      {termsError ? (
        <ErrorNotice message={termsError} onRetry={() => void reloadTerms()} />
      ) : null}
      {error ? (
        <ErrorNotice message={error} onRetry={() => void loadBatches()} />
      ) : null}
      {success ? (
        <div
          role="status"
          className="rounded-2xl border border-gradely-green/30 bg-gradely-green/10 p-4 text-sm font-semibold text-[#137026]"
        >
          {success}
        </div>
      ) : null}

      {loading || termsLoading ? (
        <LoadingPanel label="Loading generation batches…" />
      ) : batches.length === 0 ? (
        <EmptyState
          icon={FileWarning}
          title="No generation batches yet"
          description="Run report generation to create a batch. Generated, skipped and failed pupils are recorded here."
          action={
            <Link
              to="/dashboard/reports/generate"
              className="inline-flex items-center gap-2 rounded-xl bg-gradely-navy px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#123c80]"
            >
              Generate report cards
            </Link>
          }
        />
      ) : (
        <Panel className="overflow-hidden p-0 sm:p-0">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-base font-bold text-gradely-text">
              {batches.length} batch{batches.length === 1 ? '' : 'es'}
            </h2>
            <p className="mt-0.5 text-xs text-gradely-muted">
              Select a batch to inspect failures and versions.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-gradely-muted">
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Started
                  </th>
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Scope
                  </th>
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Generation
                  </th>
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Release
                  </th>
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Generated
                  </th>
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Skipped
                  </th>
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Failed
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <tr
                    key={batch.id}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70"
                  >
                    <td className="px-5 py-3 text-xs whitespace-nowrap text-gradely-muted">
                      {formatDateTime(batch.startedAt ?? batch.createdAt)}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap text-gradely-text">
                      {batch.scope}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <Badge tone={batchTone(batch.status)}>
                        {BATCH_STATUS_LABELS[batch.status]}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <Badge tone={releaseTone(batch.releaseStatus)}>
                        {RELEASE_STATUS_SHORT_LABELS[batch.releaseStatus]}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 font-semibold whitespace-nowrap text-gradely-text">
                      {batch.generatedCount}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap text-gradely-muted">
                      {batch.skippedCount}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap text-gradely-muted">
                      {batch.failedCount}
                    </td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() =>
                          setSearchParams({ batchId: batch.id })
                        }
                        className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-gradely-navy hover:bg-gradely-navy/5"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {detailLoading ? (
        <LoadingPanel label="Loading batch detail…" />
      ) : detail ? (
        <Panel>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-gradely-text">
                Batch {detail.id.slice(0, 8)}
              </h2>
              <p className="mt-1 text-sm text-gradely-muted">
                {detail.academicTermName}
                {detail.className ? ` · ${detail.className}` : ' · All accessible classes'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={batchTone(detail.status)}>
                {BATCH_STATUS_LABELS[detail.status]}
              </Badge>
              <Badge tone={releaseTone(detail.releaseStatus)}>
                {RELEASE_STATUS_SHORT_LABELS[detail.releaseStatus]}
              </Badge>
              <button
                type="button"
                onClick={() => setSearchParams({})}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-gradely-muted hover:bg-slate-100"
              >
                <X aria-hidden="true" className="size-3.5" />
                Close
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            {[
              ['Requested', detail.requestedPupilCount],
              ['Generated', detail.generatedCount],
              ['Skipped', detail.skippedCount],
              ['Failed', detail.failedCount],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-xl border border-slate-200 bg-gradely-light/60 px-4 py-3"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-gradely-muted">
                  {label}
                </p>
                <p className="mt-1 text-xl font-extrabold text-gradely-text">
                  {value}
                </p>
              </div>
            ))}
          </div>

          {detail.fatalError ? (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <AlertTriangle
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0"
              />
              {detail.fatalError}
            </div>
          ) : null}

          {detail.failures.length > 0 ? (
            <div className="mt-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-gradely-text">
                  Failures and skipped pupils
                </h3>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={retrying}
                  onClick={() => void handleRetry()}
                >
                  <RotateCcw aria-hidden="true" className="size-4" />
                  Retry failed pupils
                </Button>
              </div>
              <div className="mt-3 space-y-2">
                {detail.failures.map((failure) => (
                  <div
                    key={failure.id}
                    className="rounded-xl border border-slate-200 p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="warning">{failure.code}</Badge>
                      <span className="text-sm font-semibold text-gradely-text">
                        {failure.pupilName ?? 'Class-level failure'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gradely-muted">
                      {failure.message}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-5 flex items-center gap-2 text-sm text-gradely-muted">
              <CheckCircle2
                aria-hidden="true"
                className="size-4 text-gradely-green"
              />
              No failures recorded for this batch.
            </p>
          )}

          {detail.versions.length > 0 ? (
            <div className="mt-5">
              <h3 className="text-sm font-bold text-gradely-text">
                Versions created by this batch
              </h3>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[520px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-gradely-muted">
                      <th scope="col" className="px-3 py-2 font-semibold">
                        Pupil
                      </th>
                      <th scope="col" className="px-3 py-2 font-semibold">
                        Version
                      </th>
                      <th scope="col" className="px-3 py-2 font-semibold">
                        Generated
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">
                        Preview
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.versions.map((version) => (
                      <tr
                        key={version.id}
                        className="border-b border-slate-100 last:border-0"
                      >
                        <td className="px-3 py-2 font-semibold text-gradely-text">
                          {version.pupilName}
                        </td>
                        <td className="px-3 py-2 text-gradely-muted">
                          v{version.version}
                        </td>
                        <td className="px-3 py-2 text-xs text-gradely-muted">
                          {formatDateTime(version.generatedAt)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Link
                            to={`/dashboard/reports/cards/${version.reportCardId}?version=${version.version}`}
                            className="text-xs font-semibold text-gradely-navy hover:underline"
                          >
                            Open
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </Panel>
      ) : null}
    </div>
  )
}
