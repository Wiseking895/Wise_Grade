import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileCheck2,
  FileText,
  Layers,
  RefreshCw,
  Send,
  ShieldCheck,
  Undo2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
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
import { formatDateTime } from '../../lib/format'
import {
  listReleaseBatches,
  submitReleaseBatch,
} from '../../reports/api'
import { ReleaseStatusNotice } from '../../reports/components'
import {
  BATCH_STATUS_LABELS,
  RELEASE_STATUS_LABELS,
  RELEASE_STATUS_SHORT_LABELS,
  batchTone,
  releaseTone,
} from '../../reports/labels'
import {
  countReleaseBatches,
  isResubmission,
  schoolCanSubmit,
} from '../../reports/release-logic'
import type { ReportReleaseBatchSummary } from '../../reports/types'
import { useAcademicTerms } from '../../reports/use-academic-terms'
import { useSchool } from '../../schools/use-school'

function StatCard({
  label,
  value,
  hint,
}: {
  label: string
  value: number
  hint?: string
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold tracking-wide text-gradely-muted uppercase">
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-extrabold tracking-tight text-gradely-navy">
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-gradely-muted">{hint}</p> : null}
    </div>
  )
}

export default function ReportReleasePage() {
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

  const [batches, setBatches] = useState<ReportReleaseBatchSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [submittingId, setSubmittingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!schoolId || !isAdmin) return

    try {
      setLoading(true)
      const response = await listReleaseBatches(schoolId, selected?.termId)
      setBatches(response.batches)
      setError(null)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load report release batches.',
      )
    } finally {
      setLoading(false)
    }
  }, [isAdmin, schoolId, selected])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const counts = useMemo(() => countReleaseBatches(batches), [batches])

  if (!isAdmin) {
    return (
      <AccessDenied message="Only a school administrator can submit report batches for platform review and release." />
    )
  }

  async function handleSubmit(batch: ReportReleaseBatchSummary) {
    if (!schoolId) return

    try {
      setSubmittingId(batch.id)
      setError(null)
      setNotice(null)
      await submitReleaseBatch(schoolId, batch.id)
      setNotice(
        isResubmission(batch.releaseStatus)
          ? 'Corrected batch resubmitted for platform review.'
          : 'Batch submitted for platform review. It is not released until a platform administrator explicitly releases it.',
      )
      await load()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not submit this batch for platform review.',
      )
    } finally {
      setSubmittingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Report release"
        description="Submit completed, paid and eligible report batches for platform review. Approval alone does not grant access: only an explicit platform release action makes the private PDFs available to the school."
        actions={
          <>
            <Link
              to="/dashboard/reports/batches"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-gradely-text shadow-sm transition-colors hover:bg-gradely-light"
            >
              <Layers aria-hidden="true" className="size-4" />
              Generation batches
            </Link>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void load()
                void reloadTerms()
              }}
              loading={loading || termsLoading}
            >
              <RefreshCw aria-hidden="true" className="size-4" />
              Refresh
            </Button>
          </>
        }
      />

      <ReleaseStatusNotice status="GENERATED" />

      <Panel>
        <SelectField
          label="Academic term"
          value={selectedTermId}
          onChange={(event) => setSelectedTermId(event.target.value)}
          disabled={termsLoading || options.length === 0}
          hint="Only batches generated for the selected term are shown."
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Batches in term" value={counts.total} />
        <StatCard
          label="Ready to submit"
          value={counts.generated + counts.returned}
          hint="Generated or returned batches"
        />
        <StatCard
          label="In platform review"
          value={counts.pendingReview}
          hint="Awaiting a super administrator"
        />
        <StatCard
          label="Released"
          value={counts.released}
          hint="Private PDFs now accessible"
        />
      </div>

      {termsError ? (
        <ErrorNotice message={termsError} onRetry={() => void reloadTerms()} />
      ) : null}
      {error ? (
        <ErrorNotice message={error} onRetry={() => void load()} />
      ) : null}
      {notice ? (
        <div
          role="status"
          className="rounded-2xl border border-gradely-green/30 bg-gradely-green/10 p-4 text-sm font-semibold text-[#137026]"
        >
          {notice}
        </div>
      ) : null}

      {loading || termsLoading ? (
        <LoadingPanel label="Loading release batches…" />
      ) : batches.length === 0 ? (
        <EmptyState
          icon={FileCheck2}
          title="No report batches for this term"
          description="Generate report cards first. Completed batches appear here with their release state and eligibility checks."
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
        <div className="space-y-4">
          {batches.map((batch) => {
            const eligible = batch.eligibility.eligible
            const canSubmit = schoolCanSubmit(batch.releaseStatus, eligible)

            return (
              <Panel key={batch.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-bold text-gradely-text">
                        {batch.className ?? 'All accessible classes'} ·{' '}
                        {batch.academicTermName}
                      </h2>
                      <Badge tone={releaseTone(batch.releaseStatus)}>
                        {RELEASE_STATUS_SHORT_LABELS[batch.releaseStatus]}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-gradely-muted">
                      Batch {batch.id.slice(0, 8)} · {batch.scope} · created{' '}
                      {formatDateTime(batch.createdAt)}
                    </p>
                  </div>
                  <Badge tone={batchTone(batch.generationStatus)}>
                    {BATCH_STATUS_LABELS[batch.generationStatus]}
                  </Badge>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl border border-slate-200 bg-gradely-light/60 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gradely-muted">
                      Reports
                    </p>
                    <p className="mt-1 text-lg font-extrabold text-gradely-text">
                      {batch.reportCount}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-gradely-light/60 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gradely-muted">
                      Generated
                    </p>
                    <p className="mt-1 text-lg font-extrabold text-gradely-text">
                      {batch.generatedCount}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-gradely-light/60 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gradely-muted">
                      Submitted
                    </p>
                    <p className="mt-1 text-sm font-semibold text-gradely-text">
                      {batch.submittedAt
                        ? formatDateTime(batch.submittedAt)
                        : 'Not submitted'}
                    </p>
                    {batch.submittedByName ? (
                      <p className="text-xs text-gradely-muted">
                        by {batch.submittedByName}
                      </p>
                    ) : null}
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-gradely-light/60 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gradely-muted">
                      Released
                    </p>
                    <p className="mt-1 text-sm font-semibold text-gradely-text">
                      {batch.releasedAt
                        ? formatDateTime(batch.releasedAt)
                        : 'Not released'}
                    </p>
                    {batch.releasedByName ? (
                      <p className="text-xs text-gradely-muted">
                        by {batch.releasedByName}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-slate-200 px-4 py-3">
                  <p className="text-sm font-bold text-gradely-text">
                    {RELEASE_STATUS_LABELS[batch.releaseStatus]}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-gradely-muted">
                    {batch.releaseStatus === 'APPROVED'
                      ? 'The platform administrator approved this batch, but access is still blocked until a separate explicit release action.'
                      : batch.releaseStatus === 'RELEASED'
                        ? 'The platform administrator released this batch. The private PDFs are now available from the report cards page.'
                        : batch.releaseStatus === 'PENDING_PLATFORM_REVIEW'
                          ? 'The batch is waiting for a platform super administrator to approve, return or hold it.'
                          : batch.releaseStatus === 'RETURNED'
                            ? 'Correct the reported issue, then resubmit the batch.'
                            : batch.releaseStatus === 'ON_HOLD'
                              ? 'The platform administrator placed this batch on hold. It cannot be submitted or opened until the hold is removed.'
                              : 'This batch has not been submitted for platform review.'}
                  </p>
                  {batch.returnedReason ? (
                    <p className="mt-2 rounded-lg bg-gradely-gold/10 px-3 py-2 text-xs font-semibold text-[#7a5400]">
                      Returned: {batch.returnedReason}
                    </p>
                  ) : null}
                  {batch.holdReason ? (
                    <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-800">
                      On hold: {batch.holdReason}
                    </p>
                  ) : null}
                </div>

                {!eligible ? (
                  <div className="mt-4 rounded-xl border border-gradely-gold/30 bg-gradely-gold/10 p-4">
                    <p className="flex items-center gap-2 text-sm font-bold text-[#6b4a00]">
                      <AlertTriangle
                        aria-hidden="true"
                        className="size-4 shrink-0"
                      />
                      Not eligible for platform review
                    </p>
                    <ul className="mt-2 space-y-1 text-xs leading-relaxed text-[#7a5400]">
                      {batch.eligibility.issues.map((issue) => (
                        <li key={issue.code}>• {issue.message}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="mt-4 flex items-center gap-2 text-xs font-semibold text-[#137026]">
                    <CheckCircle2
                      aria-hidden="true"
                      className="size-4"
                    />
                    All release eligibility checks passed on the server.
                  </p>
                )}

                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => void handleSubmit(batch)}
                    loading={submittingId === batch.id}
                    disabled={!canSubmit}
                  >
                    {isResubmission(batch.releaseStatus) ? (
                      <Undo2 aria-hidden="true" className="size-4" />
                    ) : (
                      <Send aria-hidden="true" className="size-4" />
                    )}
                    {isResubmission(batch.releaseStatus)
                      ? 'Resubmit for review'
                      : 'Submit for platform review'}
                  </Button>

                  {batch.releaseStatus === 'RELEASED' ? (
                    <Link
                      to="/dashboard/reports"
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-gradely-text shadow-sm transition-colors hover:bg-gradely-light"
                    >
                      <FileText aria-hidden="true" className="size-4" />
                      Open released report cards
                    </Link>
                  ) : null}

                  {batch.releaseStatus === 'PENDING_PLATFORM_REVIEW' ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gradely-muted">
                      <Clock3 aria-hidden="true" className="size-4" />
                      Awaiting platform decision
                    </span>
                  ) : null}

                  {batch.releaseStatus === 'RELEASED' ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#137026]">
                      <ShieldCheck aria-hidden="true" className="size-4" />
                      Released privately to authorized school users
                    </span>
                  ) : null}
                </div>
              </Panel>
            )
          })}
        </div>
      )}
    </div>
  )
}
