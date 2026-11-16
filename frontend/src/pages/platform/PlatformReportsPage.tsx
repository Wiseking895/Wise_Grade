import {
  CheckCircle2,
  Clock3,
  Eye,
  FileCheck2,
  FileText,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import FormField from '../../components/FormField'
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorNotice,
  LoadingPanel,
  Modal,
  PageHeader,
  Panel,
  SelectField,
  TextareaField,
} from '../../components/ui'
import {
  approvePlatformReportBatch,
  fetchPlatformReportPreview,
  getPlatformReportBatch,
  getPlatformReportOverview,
  listPlatformReportBatches,
  listPlatformReportSchools,
  rejectPlatformReportBatch,
  retryPlatformReportBatch,
} from '../../reports/api'
import {
  BATCH_STATUS_LABELS,
  RELEASE_STATUS_LABELS,
  RELEASE_STATUS_SHORT_LABELS,
  batchTone,
  releaseTone,
} from '../../reports/labels'
import { releaseReasonError } from '../../reports/release-logic'
import type {
  ReportReleaseBatchSummary,
  ReportReleaseOverview,
  ReportReleaseStatus,
  ReportReleaseVersionSummary,
  ReportRequestClassSummary,
  ReportRequestDetail,
} from '../../reports/types'
import { formatDateTime } from '../../lib/format'
import { usePlatformReauth } from '../../platform/reauth-context'
import { PLATFORM_REAUTH_PURPOSE } from '../../platform/reauth-purpose'

type StatusFilter = ReportReleaseStatus | ''
type ConfirmAction = 'approve' | 'retry'

const CLASS_STATUS_LABELS: Record<ReportRequestClassSummary['status'], string> = {
  PENDING: 'Not generated',
  RUNNING: 'Generating',
  COMPLETED: 'Generated',
  PARTIAL: 'Partial failure',
  FAILED: 'Failed',
}

function classStatusTone(
  status: ReportRequestClassSummary['status'],
): 'neutral' | 'success' | 'warning' | 'info' {
  switch (status) {
    case 'COMPLETED':
      return 'success'
    case 'PARTIAL':
    case 'FAILED':
      return 'warning'
    case 'RUNNING':
      return 'info'
    default:
      return 'neutral'
  }
}

function StatCard({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string
  value: number
  hint?: string
  emphasis?: boolean
}) {
  return (
    <div
      className={`rounded-2xl border p-4 shadow-sm ${
        emphasis
          ? 'border-gradely-navy/20 bg-gradely-navy text-white'
          : 'border-slate-200 bg-white'
      }`}
    >
      <p
        className={`text-xs font-semibold uppercase tracking-wide ${
          emphasis ? 'text-white/70' : 'text-gradely-muted'
        }`}
      >
        {label}
      </p>
      <p
        className={`mt-1.5 text-2xl font-extrabold tracking-tight ${
          emphasis ? 'text-white' : 'text-gradely-navy'
        }`}
      >
        {value}
      </p>
      {hint ? (
        <p
          className={`mt-1 text-xs ${
            emphasis ? 'text-white/70' : 'text-gradely-muted'
          }`}
        >
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export default function PlatformReportsPage() {
  const { ensureReauth } = usePlatformReauth()
  const [overview, setOverview] = useState<ReportReleaseOverview | null>(null)
  const [schools, setSchools] = useState<
    Awaited<ReturnType<typeof listPlatformReportSchools>>['schools']
  >([])
  const [batches, setBatches] = useState<ReportReleaseBatchSummary[]>([])
  const [referenceLoading, setReferenceLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [schoolFilter, setSchoolFilter] = useState('')
  const [yearFilter, setYearFilter] = useState('')
  const [termFilter, setTermFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('')
  const [submittedFrom, setSubmittedFrom] = useState('')
  const [submittedTo, setSubmittedTo] = useState('')

  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ReportRequestDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [actionBusy, setActionBusy] = useState(false)

  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewLabel, setPreviewLabel] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const previewUrlRef = useRef<string | null>(null)

  const selectedSchool =
    schools.find((school) => school.id === schoolFilter) ?? null
  const yearOptions = selectedSchool?.academicYears ?? []
  const selectedYear =
    yearOptions.find((year) => year.id === yearFilter) ?? null
  const termOptions = selectedYear?.terms ?? []

  const loadReference = useCallback(async () => {
    try {
      setReferenceLoading(true)
      const [overviewResult, schoolResult] = await Promise.all([
        getPlatformReportOverview(),
        listPlatformReportSchools(),
      ])
      setOverview(overviewResult.overview)
      setSchools(schoolResult.schools)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load the platform report overview.',
      )
    } finally {
      setReferenceLoading(false)
    }
  }, [])

  const loadBatches = useCallback(async () => {
    try {
      setLoading(true)
      const response = await listPlatformReportBatches({
        schoolId: schoolFilter || undefined,
        academicYearId: yearFilter || undefined,
        academicTermId: termFilter || undefined,
        status: statusFilter || undefined,
        submittedFrom: submittedFrom || undefined,
        submittedTo: submittedTo || undefined,
      })
      setBatches(response.batches)
      setError(null)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load the platform report queue.',
      )
    } finally {
      setLoading(false)
    }
  }, [schoolFilter, yearFilter, termFilter, statusFilter, submittedFrom, submittedTo])

  const loadDetail = useCallback(async () => {
    if (!selectedBatchId) {
      setDetail(null)
      return
    }

    try {
      setDetailLoading(true)
      const response = await getPlatformReportBatch(selectedBatchId)
      setDetail(response.batch)
      setError(null)
    } catch (cause) {
      setDetail(null)
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load the report request detail.',
      )
    } finally {
      setDetailLoading(false)
    }
  }, [selectedBatchId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadReference()
  }, [loadReference])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadBatches()
  }, [loadBatches])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadDetail()
  }, [loadDetail])

  useEffect(
    () => () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current)
        previewUrlRef.current = null
      }
    },
    [],
  )

  function clearPreviewUrl() {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
    setPreviewUrl(null)
  }

  function closePreview() {
    setPreviewOpen(false)
    clearPreviewUrl()
  }

  async function openPreview(version: ReportReleaseVersionSummary) {
    if (!detail) return

    setPreviewOpen(true)
    setPreviewLabel(
      `${version.pupilName} · ${version.admissionNumber} · v${version.version}`,
    )
    setPreviewError(null)
    setPreviewLoading(true)
    clearPreviewUrl()

    try {
      const blob = await fetchPlatformReportPreview(detail.id, version.id)
      const url = URL.createObjectURL(blob)
      previewUrlRef.current = url
      setPreviewUrl(url)
    } catch (cause) {
      setPreviewError(
        cause instanceof Error
          ? cause.message
          : 'Could not render this private report preview.',
      )
    } finally {
      setPreviewLoading(false)
    }
  }

  async function refreshAll() {
    await Promise.all([loadReference(), loadBatches(), loadDetail()])
  }

  async function runAction(action: ConfirmAction) {
    if (!detail) return

    setActionBusy(true)
    setError(null)
    setNotice(null)

    const token = await ensureReauth(
      PLATFORM_REAUTH_PURPOSE.sensitive,
      action === 'approve'
        ? 'Approving generates and releases every eligible report to the school. Confirm your identity to continue.'
        : 'Retrying generates the missing reports and releases them when complete. Confirm your identity to continue.',
    )

    if (!token) {
      setActionBusy(false)
      return
    }

    try {
      if (action === 'approve') {
        const outcome = await approvePlatformReportBatch(detail.id, token)
        setNotice(
          outcome.batch.releaseStatus === 'RELEASED'
            ? `Approved and released ${outcome.batch.reportCount} report${
                outcome.batch.reportCount === 1 ? '' : 's'
              } for ${outcome.batch.schoolName}.`
            : `Approved. ${outcome.batch.failedCount} report${
                outcome.batch.failedCount === 1 ? '' : 's'
              } need a retry before release.`,
        )
      } else {
        const outcome = await retryPlatformReportBatch(detail.id, token)
        setNotice(
          outcome.batch.releaseStatus === 'RELEASED'
            ? 'Retry complete. All reports are generated and released.'
            : `Retry finished. ${outcome.batch.failedCount} report${
                outcome.batch.failedCount === 1 ? '' : 's'
              } still need attention.`,
        )
      }

      setConfirmAction(null)
      await refreshAll()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The report request action failed.',
      )
    } finally {
      setActionBusy(false)
    }
  }

  async function rejectRequest() {
    if (!detail) return

    const validation = releaseReasonError(reason)

    if (validation) {
      setReasonError(validation)
      return
    }

    setActionBusy(true)
    setError(null)
    setNotice(null)

    const token = await ensureReauth(
      PLATFORM_REAUTH_PURPOSE.sensitive,
      'Rejecting returns the request to the school with your reason. Confirm your identity to continue.',
    )

    if (!token) {
      setActionBusy(false)
      return
    }

    try {
      const response = await rejectPlatformReportBatch(
        detail.id,
        reason.trim(),
        token,
      )
      setNotice(
        `Request rejected for ${response.batch.schoolName}. The school can resubmit after correcting the issue.`,
      )
      setRejectOpen(false)
      setReason('')
      setReasonError(null)
      await refreshAll()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The report request could not be rejected.',
      )
    } finally {
      setActionBusy(false)
    }
  }

  const selectedBatch =
    batches.find((batch) => batch.id === selectedBatchId) ?? null
  const canApprove = detail?.releaseStatus === 'PENDING_PLATFORM_REVIEW'
  const canRetry =
    detail?.releaseStatus === 'APPROVED' &&
    (detail.failedCount > 0 ||
      detail.generationStatus === 'COMPLETED_WITH_FAILURES' ||
      detail.generationStatus === 'FAILED')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Report requests"
        description="One school request covers every eligible class for a term. Approving it generates the reports and releases them to the school. Payment and invoicing are not part of this workflow."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void refreshAll()}
            loading={referenceLoading || loading || detailLoading}
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            Refresh
          </Button>
        }
      />

      <div className="flex items-start gap-3 rounded-2xl border border-gradely-blue/20 bg-gradely-blue/5 p-4">
        <ShieldCheck
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-gradely-navy"
        />
        <div>
          <p className="text-sm font-extrabold text-gradely-navy">
            Approval generates and releases in one audited action
          </p>
          <p className="mt-1 text-sm leading-relaxed text-gradely-muted">
            Every eligible class is generated into the same request batch. If
            any report fails, the successful reports stay private and only the
            failed pupils can be retried. No public links or storage keys are
            exposed.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Pending review"
          value={overview?.pendingReview ?? 0}
          hint="School requests awaiting approval"
          emphasis
        />
        <StatCard
          label="Approved"
          value={overview?.approvedUnreleased ?? 0}
          hint="Generation or retry in progress"
        />
        <StatCard
          label="Released"
          value={overview?.released ?? 0}
          hint="Available to the school"
        />
        <StatCard
          label="Rejected"
          value={overview?.returned ?? 0}
          hint="Returned to the school"
        />
      </div>

      {error ? (
        <ErrorNotice message={error} onRetry={() => void refreshAll()} />
      ) : null}
      {notice ? (
        <div
          role="status"
          className="rounded-2xl border border-gradely-green/30 bg-gradely-green/10 p-4 text-sm font-semibold text-[#137026]"
        >
          {notice}
        </div>
      ) : null}

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-gradely-text">
              Request queue
            </h2>
            <p className="mt-0.5 text-xs text-gradely-muted">
              {batches.length} request{batches.length === 1 ? '' : 's'} match the
              current filters.
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSchoolFilter('')
              setYearFilter('')
              setTermFilter('')
              setStatusFilter('')
              setSubmittedFrom('')
              setSubmittedTo('')
            }}
          >
            Clear filters
          </Button>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <SelectField
            label="School"
            value={schoolFilter}
            onChange={(event) => {
              setSchoolFilter(event.target.value)
              setYearFilter('')
              setTermFilter('')
            }}
          >
            <option value="">All schools</option>
            {schools.map((school) => (
              <option key={school.id} value={school.id}>
                {school.name}
                {school.isActive ? '' : ' (inactive)'}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Academic year"
            value={yearFilter}
            onChange={(event) => {
              setYearFilter(event.target.value)
              setTermFilter('')
            }}
            disabled={!selectedSchool}
          >
            <option value="">All years</option>
            {yearOptions.map((year) => (
              <option key={year.id} value={year.id}>
                {year.name}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Academic term"
            value={termFilter}
            onChange={(event) => setTermFilter(event.target.value)}
            disabled={!selectedYear}
          >
            <option value="">All terms</option>
            {termOptions.map((term) => (
              <option key={term.id} value={term.id}>
                {term.name}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Request status"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as StatusFilter)
            }
          >
            <option value="">All statuses</option>
            {(
              Object.keys(RELEASE_STATUS_LABELS) as ReportReleaseStatus[]
            ).map((status) => (
              <option key={status} value={status}>
                {RELEASE_STATUS_LABELS[status]}
              </option>
            ))}
          </SelectField>

          <FormField
            label="Submitted from"
            type="date"
            value={submittedFrom}
            onChange={(event) => setSubmittedFrom(event.target.value)}
          />
          <FormField
            label="Submitted to"
            type="date"
            value={submittedTo}
            onChange={(event) => setSubmittedTo(event.target.value)}
          />
        </div>
      </Panel>

      {loading || referenceLoading ? (
        <LoadingPanel label="Loading report requests…" />
      ) : batches.length === 0 ? (
        <EmptyState
          icon={FileCheck2}
          title="No report requests in this queue"
          description="Requests appear here when a school administrator submits one for a term. Adjust the filters to see more."
        />
      ) : (
        <Panel className="overflow-hidden p-0 sm:p-0">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-base font-bold text-gradely-text">
              School requests
            </h2>
            <p className="mt-0.5 text-xs text-gradely-muted">
              Select a request to inspect its classes and take an authorized
              action.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-gradely-muted">
                  <th scope="col" className="px-5 py-3 font-semibold">
                    School
                  </th>
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Term / class
                  </th>
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Pupils
                  </th>
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Generation
                  </th>
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Request state
                  </th>
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Submitted
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
                    className={`border-b border-slate-100 last:border-0 ${
                      selectedBatchId === batch.id
                        ? 'bg-gradely-blue/5'
                        : 'hover:bg-slate-50/70'
                    }`}
                  >
                    <td className="px-5 py-3">
                      <p className="font-semibold text-gradely-text">
                        {batch.schoolName}
                      </p>
                      <p className="text-xs text-gradely-muted">
                        {batch.academicYearName}
                      </p>
                    </td>
                    <td className="px-5 py-3 text-gradely-text">
                      <p>{batch.academicTermName}</p>
                      <p className="text-xs text-gradely-muted">
                        {batch.className ?? 'All eligible classes'}
                      </p>
                    </td>
                    <td className="px-5 py-3">
                      <p className="font-semibold text-gradely-text">
                        {batch.requestedPupilCount}
                      </p>
                      <p className="text-xs text-gradely-muted">
                        {batch.generatedCount} generated · {batch.failedCount}{' '}
                        failed
                      </p>
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={batchTone(batch.generationStatus)}>
                        {BATCH_STATUS_LABELS[batch.generationStatus]}
                      </Badge>
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={releaseTone(batch.releaseStatus)}>
                        {RELEASE_STATUS_SHORT_LABELS[batch.releaseStatus]}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-xs text-gradely-muted">
                      {batch.submittedAt
                        ? formatDateTime(batch.submittedAt)
                        : 'Not submitted'}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedBatchId(batch.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-gradely-navy hover:bg-gradely-navy/5"
                      >
                        <FileText aria-hidden="true" className="size-4" />
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

      {selectedBatchId && detailLoading ? (
        <LoadingPanel label="Loading request detail…" />
      ) : selectedBatchId && detail ? (
        <Panel>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-extrabold text-gradely-text">
                  {detail.schoolName}
                </h2>
                <Badge tone={releaseTone(detail.releaseStatus)}>
                  {RELEASE_STATUS_LABELS[detail.releaseStatus]}
                </Badge>
                <Badge tone={batchTone(detail.generationStatus)}>
                  {BATCH_STATUS_LABELS[detail.generationStatus]}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-gradely-muted">
                {detail.academicYearName} · {detail.academicTermName} ·{' '}
                {detail.className ?? 'All eligible classes'} · request{' '}
                {detail.id.slice(0, 8)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedBatchId(null)}
              className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-gradely-muted hover:bg-slate-100"
            >
              Close detail
            </button>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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

          {detail.releaseStatus === 'RELEASED' ? (
            <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-[#137026]">
              <CheckCircle2 aria-hidden="true" className="size-4" />
              Released. The school can preview, print and download the reports.
            </p>
          ) : detail.releaseStatus === 'PENDING_PLATFORM_REVIEW' ? (
            <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-gradely-navy">
              <Clock3 aria-hidden="true" className="size-4" />
              Awaiting your approval. Approving generates every eligible class
              and releases the completed request.
            </p>
          ) : detail.releaseStatus === 'APPROVED' ? (
            <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-[#7a5400]">
              <Clock3 aria-hidden="true" className="size-4" />
              Approved. {detail.generatedCount} of{' '}
              {detail.requestedPupilCount} reports generated
              {detail.failedCount > 0
                ? ` · ${detail.failedCount} failed and retryable`
                : ''}
              .
            </p>
          ) : null}

          {detail.returnedReason ? (
            <p className="mt-3 rounded-lg bg-gradely-gold/10 px-3 py-2 text-xs font-semibold text-[#7a5400]">
              Rejection reason: {detail.returnedReason}
            </p>
          ) : null}

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-bold text-gradely-text">
                Review trail
              </h3>
              <dl className="mt-3 space-y-2 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-gradely-muted">Submitted</dt>
                  <dd className="text-right font-semibold text-gradely-text">
                    {detail.submittedAt
                      ? `${formatDateTime(detail.submittedAt)}${
                          detail.submittedByName
                            ? ` · ${detail.submittedByName}`
                            : ''
                        }`
                      : 'Not submitted'}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-gradely-muted">Reviewed</dt>
                  <dd className="text-right font-semibold text-gradely-text">
                    {detail.reviewedAt
                      ? `${formatDateTime(detail.reviewedAt)}${
                          detail.reviewedByName
                            ? ` · ${detail.reviewedByName}`
                            : ''
                        }`
                      : 'Not reviewed'}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-gradely-muted">Released</dt>
                  <dd className="text-right font-semibold text-gradely-text">
                    {detail.releasedAt
                      ? `${formatDateTime(detail.releasedAt)}${
                          detail.releasedByName
                            ? ` · ${detail.releasedByName}`
                            : ''
                        }`
                      : 'Not released'}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-bold text-gradely-text">
                Progress by class
              </h3>
              <p className="mt-1 text-xs text-gradely-muted">
                Accepted results are counted from each pupil&apos;s accepted
                assessment snapshot.
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[420px] border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-gradely-muted">
                      <th scope="col" className="py-1.5 pr-3 font-semibold">
                        Class
                      </th>
                      <th scope="col" className="py-1.5 pr-3 font-semibold">
                        Pupils
                      </th>
                      <th scope="col" className="py-1.5 pr-3 font-semibold">
                        Accepted
                      </th>
                      <th scope="col" className="py-1.5 pr-3 font-semibold">
                        Ineligible
                      </th>
                      <th scope="col" className="py-1.5 pr-3 font-semibold">
                        Done
                      </th>
                      <th scope="col" className="py-1.5 font-semibold">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.classes.map((item) => (
                      <tr
                        key={item.classId}
                        className="border-b border-slate-100 last:border-0"
                      >
                        <td className="py-1.5 pr-3 font-semibold text-gradely-text">
                          {item.className}
                        </td>
                        <td className="py-1.5 pr-3 text-gradely-text">
                          {item.pupilCount}
                        </td>
                        <td className="py-1.5 pr-3 text-gradely-text">
                          {item.acceptedResultCount}
                        </td>
                        <td className="py-1.5 pr-3 text-gradely-text">
                          {item.ineligiblePupilCount}
                        </td>
                        <td className="py-1.5 pr-3 text-gradely-text">
                          {item.generatedCount}
                          {item.failedCount > 0
                            ? ` / ${item.failedCount} failed`
                            : ''}
                        </td>
                        <td className="py-1.5">
                          <Badge tone={classStatusTone(item.status)}>
                            {CLASS_STATUS_LABELS[item.status]}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={!canApprove || actionBusy}
              onClick={() => setConfirmAction('approve')}
            >
              <CheckCircle2 aria-hidden="true" className="size-4" />
              Approve &amp; generate
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={!canApprove || actionBusy}
              onClick={() => {
                setReason('')
                setReasonError(null)
                setRejectOpen(true)
              }}
            >
              <XCircle aria-hidden="true" className="size-4" />
              Reject request
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!canRetry || actionBusy}
              onClick={() => setConfirmAction('retry')}
            >
              <RefreshCw aria-hidden="true" className="size-4" />
              Retry failed reports
            </Button>
            {detail.releaseStatus === 'RELEASED' ? (
              <p className="flex items-center gap-2 text-sm font-semibold text-[#137026]">
                <ShieldCheck aria-hidden="true" className="size-4" />
                Released. No further platform action is available.
              </p>
            ) : null}
          </div>

          <div className="mt-5">
            <h3 className="text-sm font-bold text-gradely-text">
              Generated report versions
            </h3>
            <p className="mt-1 text-xs text-gradely-muted">
              Previews stream the exact stored bytes through the authenticated
              backend. Storage keys are never exposed.
            </p>
            {detail.versions.length === 0 ? (
              <p className="mt-3 text-xs text-gradely-muted">
                No report versions have been generated for this request yet.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-gradely-muted">
                      <th scope="col" className="px-3 py-2 font-semibold">
                        Pupil
                      </th>
                      <th scope="col" className="px-3 py-2 font-semibold">
                        Admission no.
                      </th>
                      <th scope="col" className="px-3 py-2 font-semibold">
                        Version
                      </th>
                      <th scope="col" className="px-3 py-2 font-semibold">
                        Generated
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">
                        Private preview
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
                        <td className="px-3 py-2 font-mono text-xs text-gradely-muted">
                          {version.admissionNumber}
                        </td>
                        <td className="px-3 py-2 text-gradely-muted">
                          v{version.version}
                        </td>
                        <td className="px-3 py-2 text-xs text-gradely-muted">
                          {formatDateTime(version.generatedAt)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => void openPreview(version)}
                            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-gradely-navy hover:bg-gradely-navy/5"
                          >
                            <Eye aria-hidden="true" className="size-4" />
                            Preview
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Panel>
      ) : selectedBatchId && selectedBatch ? (
        <ErrorNotice
          message="Could not load this request detail. Try refreshing the queue."
          onRetry={() => void loadDetail()}
        />
      ) : null}

      <Modal
        open={previewOpen}
        onClose={closePreview}
        title="Private report preview"
        description={previewLabel}
        wide
      >
        {previewLoading ? (
          <LoadingPanel label="Verifying and rendering private PDF…" />
        ) : previewError ? (
          <ErrorNotice message={previewError} />
        ) : previewUrl ? (
          <iframe
            key={previewUrl}
            title={`Private report preview for ${previewLabel}`}
            src={previewUrl}
            className="h-[70vh] min-h-[480px] w-full rounded-xl border border-slate-200 bg-slate-100"
          />
        ) : (
          <p className="text-sm text-gradely-muted">
            No preview is available for this version.
          </p>
        )}
      </Modal>

      <Modal
        open={rejectOpen}
        onClose={() => {
          if (actionBusy) return
          setRejectOpen(false)
          setReasonError(null)
        }}
        title="Reject this report request"
        description="The reason is recorded in the audit trail and shown to the school. The school can submit a fresh request after correcting the issue."
      >
        <TextareaField
          label="Reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={4}
          maxLength={1000}
          error={reasonError ?? undefined}
          hint="At least 3 characters and no more than 1000 characters."
          disabled={actionBusy}
        />
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setRejectOpen(false)
              setReasonError(null)
            }}
            disabled={actionBusy}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => void rejectRequest()}
            loading={actionBusy}
          >
            Reject request
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmAction !== null}
        title={
          confirmAction === 'approve'
            ? 'Approve, generate and release this request?'
            : 'Retry the failed reports?'
        }
        description={
          confirmAction === 'approve'
            ? 'This single action approves the request, generates every eligible class and releases the completed reports to the school. If any report fails, the successful reports stay private until the failures are retried.'
            : 'Only the pupils that failed are regenerated into the same request batch. Successful reports are never duplicated. The request is released automatically if every report succeeds.'
        }
        confirmLabel={
          confirmAction === 'approve' ? 'Approve & generate' : 'Retry reports'
        }
        busy={actionBusy}
        onConfirm={() => {
          if (confirmAction) void runAction(confirmAction)
        }}
        onCancel={() => {
          if (!actionBusy) setConfirmAction(null)
        }}
      />
    </div>
  )
}
