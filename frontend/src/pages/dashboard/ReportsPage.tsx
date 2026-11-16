import {
  CheckCircle2,
  Download,
  Eye,
  FileText,
  ListChecks,
  Printer,
  RefreshCw,
  Send,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
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
import { useSchool } from '../../schools/use-school'
import {
  fetchClassCollection,
  fetchStoredReportPdf,
  getReportRequest,
  listReportCards,
  listReportClasses,
  listReportRequests,
  submitReportRequest,
} from '../../reports/api'
import {
  BATCH_STATUS_LABELS,
  RELEASE_STATUS_SHORT_LABELS,
  batchTone,
  releaseTone,
} from '../../reports/labels'
import type {
  ReportBatchDetail,
  ReportCard,
  ReportClass,
  ReportReleaseBatchSummary,
  ReportRequestClassSummary,
} from '../../reports/types'
import { useAcademicTerms } from '../../reports/use-academic-terms'

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

function activeRequest(
  requests: ReportReleaseBatchSummary[],
): ReportReleaseBatchSummary | null {
  return (
    requests.find(
      (request) =>
        request.releaseStatus === 'PENDING_PLATFORM_REVIEW' ||
        request.releaseStatus === 'APPROVED',
    ) ??
    requests[0] ??
    null
  )
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function openBlobForPrint(blob: Blob) {
  const url = URL.createObjectURL(blob)
  const opened = window.open(url, '_blank', 'noopener,noreferrer')
  // Revoke after the new tab has had a chance to load the document.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return opened !== null
}

export default function ReportsPage() {
  const { schoolId } = useSchool()
  const {
    options,
    selected,
    selectedTermId,
    setSelectedTermId,
    loading: termsLoading,
    error: termsError,
    reload: reloadTerms,
  } = useAcademicTerms(schoolId)

  const [classes, setClasses] = useState<ReportClass[]>([])
  const [classId, setClassId] = useState('')
  const [cards, setCards] = useState<ReportCard[]>([])
  const [requestDetail, setRequestDetail] = useState<{
    batch: ReportBatchDetail
    classes: ReportRequestClassSummary[]
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [busyCardId, setBusyCardId] = useState<string | null>(null)
  const [collectionBusy, setCollectionBusy] = useState(false)

  useEffect(() => {
    if (!schoolId || !selected) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setClasses([])
      setClassId('')
      return
    }

    let cancelled = false

    void (async () => {
      try {
        const response = await listReportClasses(
          schoolId,
          selected.yearId,
          selected.termId,
        )

        if (!cancelled) {
          setClasses(response.classes)
          setClassId((current) =>
            response.classes.some((item) => item.id === current) ? current : '',
          )
        }
      } catch {
        if (!cancelled) setClasses([])
      }
    })()

    return () => {
      cancelled = true
    }
  }, [schoolId, selected])

  const loadWorkspace = useCallback(async () => {
    if (!schoolId || !selected) {
      setCards([])
      setRequestDetail(null)
      return
    }

    try {
      setLoading(true)
      const [requestList, cardList] = await Promise.all([
        listReportRequests(schoolId, selected.termId),
        listReportCards(schoolId, {
          academicTermId: selected.termId,
          classId: classId || undefined,
          releasedOnly: true,
        }),
      ])

      setCards(cardList.cards)

      const current = activeRequest(requestList.requests)

      if (current) {
        const detail = await getReportRequest(schoolId, current.id)
        setRequestDetail(detail)
      } else {
        setRequestDetail(null)
      }

      setError(null)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load the reports workspace.',
      )
    } finally {
      setLoading(false)
    }
  }, [schoolId, selected, classId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadWorkspace()
  }, [loadWorkspace])

  const currentRequest = requestDetail?.batch ?? null
  const awaitingReview =
    currentRequest?.releaseStatus === 'PENDING_PLATFORM_REVIEW'
  const requestInFlight =
    currentRequest?.releaseStatus === 'PENDING_PLATFORM_REVIEW' ||
    currentRequest?.releaseStatus === 'APPROVED'
  const canRequest =
    Boolean(selected) && !requestInFlight && !submitting && !loading

  async function requestReports() {
    if (!schoolId || !selected) return

    try {
      setSubmitting(true)
      setError(null)
      setNotice(null)
      const result = await submitReportRequest(schoolId, {
        academicYearId: selected.yearId,
        academicTermId: selected.termId,
      })
      setNotice(
        `Report request submitted for ${result.classes.length} class${
          result.classes.length === 1 ? '' : 'es'
        }. The platform super administrator will review it.`,
      )
      await loadWorkspace()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not submit the report request.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function downloadCard(card: ReportCard) {
    if (!schoolId) return

    try {
      setBusyCardId(card.id)
      setError(null)
      const blob = await fetchStoredReportPdf(
        schoolId,
        card.id,
        card.currentVersion,
      )
      downloadBlob(
        blob,
        `${card.admissionNumber}-v${card.currentVersion}.pdf`,
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not download the report PDF.',
      )
    } finally {
      setBusyCardId(null)
    }
  }

  async function printCard(card: ReportCard) {
    if (!schoolId) return

    try {
      setBusyCardId(card.id)
      setError(null)
      const blob = await fetchStoredReportPdf(
        schoolId,
        card.id,
        card.currentVersion,
      )
      const opened = openBlobForPrint(blob)

      if (!opened) {
        setError('Allow pop-ups to open the report for printing.')
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not open the report for printing.',
      )
    } finally {
      setBusyCardId(null)
    }
  }

  async function downloadCollection() {
    if (!schoolId || !selected || !classId) return

    try {
      setCollectionBusy(true)
      setError(null)
      const blob = await fetchClassCollection(
        schoolId,
        classId,
        selected.termId,
      )
      const className =
        classes.find((item) => item.id === classId)?.name ?? 'class'
      downloadBlob(
        blob,
        `class-reports-${className.replace(/[^A-Za-z0-9_-]+/g, '-')}.pdf`,
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not download the class report collection.',
      )
    } finally {
      setCollectionBusy(false)
    }
  }

  const headerActions = (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => {
        void loadWorkspace()
        void reloadTerms()
      }}
      loading={loading || termsLoading}
    >
      <RefreshCw aria-hidden="true" className="size-4" />
      Refresh
    </Button>
  )

  const classSummaries = requestDetail?.classes ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Term reports"
        description="Submit one report request for the term. The Wise Grade platform super administrator reviews it, generates every eligible class and releases the reports back to this school."
        actions={headerActions}
      />

      <Panel>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Academic term"
            value={selectedTermId}
            onChange={(event) => setSelectedTermId(event.target.value)}
            disabled={termsLoading || options.length === 0}
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

          <SelectField
            label="Released class filter"
            value={classId}
            onChange={(event) => setClassId(event.target.value)}
            hint="Filter the released report cards below. Selecting a class also enables a printable class collection."
          >
            <option value="">All classes</option>
            {classes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </SelectField>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
          <div>
            <p className="text-sm font-bold text-gradely-text">
              Term report request
            </p>
            <p className="mt-0.5 text-xs text-gradely-muted">
              {selected
                ? `One request covers every eligible class in ${selected.label}.`
                : 'Select an academic term to request reports.'}
            </p>
          </div>
          <Button
            onClick={() => void requestReports()}
            loading={submitting}
            disabled={!canRequest}
          >
            <Send aria-hidden="true" className="size-4" />
            {currentRequest?.releaseStatus === 'RETURNED'
              ? 'Resubmit request'
              : 'Request term reports'}
          </Button>
        </div>
      </Panel>

      {termsError ? (
        <ErrorNotice message={termsError} onRetry={() => void reloadTerms()} />
      ) : null}

      {error ? (
        <ErrorNotice message={error} onRetry={() => void loadWorkspace()} />
      ) : null}

      {notice ? (
        <div
          role="status"
          className="rounded-2xl border border-gradely-green/30 bg-gradely-green/10 p-4 text-sm font-semibold text-[#137026]"
        >
          {notice}
        </div>
      ) : null}

      {currentRequest ? (
        <Panel>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-gradely-text">
                  Request status
                </h2>
                <Badge tone={releaseTone(currentRequest.releaseStatus)}>
                  {RELEASE_STATUS_SHORT_LABELS[currentRequest.releaseStatus]}
                </Badge>
                <Badge tone={batchTone(currentRequest.status)}>
                  {BATCH_STATUS_LABELS[currentRequest.status]}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-gradely-muted">
                {currentRequest.submittedAt
                  ? `Submitted ${formatDateTime(currentRequest.submittedAt)}`
                  : 'Not submitted'}
                {currentRequest.reviewedAt
                  ? ` · Reviewed ${formatDateTime(currentRequest.reviewedAt)}`
                  : ''}
                {currentRequest.releasedAt
                  ? ` · Released ${formatDateTime(currentRequest.releasedAt)}`
                  : ''}
              </p>
            </div>
            <div className="text-right text-xs text-gradely-muted">
              <p>
                {currentRequest.generatedCount} generated ·{' '}
                {currentRequest.failedCount} failed
              </p>
              <p>{currentRequest.requestedPupilCount} pupils requested</p>
            </div>
          </div>

          {awaitingReview ? (
            <p className="mt-4 rounded-xl bg-gradely-blue/5 px-4 py-3 text-sm font-semibold text-gradely-navy">
              Awaiting platform review. No report PDFs are available until the
              platform approves and generates them.
            </p>
          ) : null}

          {currentRequest.releaseStatus === 'RETURNED' ? (
            <div className="mt-4 rounded-xl border border-gradely-gold/30 bg-gradely-gold/10 p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-[#6b4a00]">
                <XCircle aria-hidden="true" className="size-4" />
                Request rejected by the platform
              </p>
              <p className="mt-1 text-sm leading-relaxed text-[#7a5400]">
                {currentRequest.returnedReason ??
                  'No reason was recorded. Contact the platform administrator.'}
              </p>
            </div>
          ) : null}

          {currentRequest.releaseStatus === 'APPROVED' &&
          currentRequest.failedCount > 0 ? (
            <div className="mt-4 rounded-xl border border-gradely-gold/30 bg-gradely-gold/10 p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-[#6b4a00]">
                <XCircle aria-hidden="true" className="size-4" />
                Some reports need a platform retry
              </p>
              <p className="mt-1 text-sm leading-relaxed text-[#7a5400]">
                {currentRequest.failedCount} report
                {currentRequest.failedCount === 1 ? '' : 's'} could not be
                generated. The platform administrator can retry the failed
                pupils without regenerating the successful reports.
              </p>
            </div>
          ) : null}

          {currentRequest.releaseStatus === 'RELEASED' ? (
            <p className="mt-4 flex items-center gap-2 rounded-xl bg-gradely-green/10 px-4 py-3 text-sm font-semibold text-[#137026]">
              <CheckCircle2 aria-hidden="true" className="size-4" />
              Reports released. You can preview, print and download them below.
            </p>
          ) : null}

          {classSummaries.length > 0 ? (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-gradely-muted">
                    <th scope="col" className="px-4 py-2 font-semibold">
                      Class
                    </th>
                    <th scope="col" className="px-4 py-2 font-semibold">
                      Pupils
                    </th>
                    <th scope="col" className="px-4 py-2 font-semibold">
                      Eligible
                    </th>
                    <th scope="col" className="px-4 py-2 font-semibold">
                      Accepted results
                    </th>
                    <th scope="col" className="px-4 py-2 font-semibold">
                      Generated
                    </th>
                    <th scope="col" className="px-4 py-2 font-semibold">
                      Failed
                    </th>
                    <th scope="col" className="px-4 py-2 font-semibold">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {classSummaries.map((item) => (
                    <tr
                      key={item.classId}
                      className="border-b border-slate-100 last:border-0"
                    >
                      <td className="px-4 py-2 font-semibold text-gradely-text">
                        {item.className}
                      </td>
                      <td className="px-4 py-2 text-gradely-text">
                        {item.pupilCount}
                      </td>
                      <td className="px-4 py-2 text-gradely-text">
                        {item.eligiblePupilCount}
                      </td>
                      <td className="px-4 py-2 text-gradely-text">
                        {item.acceptedResultCount}
                      </td>
                      <td className="px-4 py-2 text-gradely-text">
                        {item.generatedCount}
                      </td>
                      <td className="px-4 py-2 text-gradely-text">
                        {item.failedCount}
                      </td>
                      <td className="px-4 py-2">
                        <Badge tone={classStatusTone(item.status)}>
                          {CLASS_STATUS_LABELS[item.status]}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Panel>
      ) : (
        <EmptyState
          icon={Send}
          title="No report request for this term"
          description="Submit one term-wide request when academic results have been reviewed and accepted. The platform super administrator then approves, generates and releases the reports."
        />
      )}

      <Panel className="overflow-hidden p-0 sm:p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-gradely-text">
              Released reports
            </h2>
            <p className="mt-0.5 text-xs text-gradely-muted">
              {cards.length} report card{cards.length === 1 ? '' : 's'} ·
              preview, print or download only after release
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="info">
              <ListChecks aria-hidden="true" className="mr-1 size-3.5" />
              {cards.reduce((sum, card) => sum + card.versionCount, 0)} versions
            </Badge>
            <Button
              size="sm"
              variant="secondary"
              disabled={!classId || collectionBusy || cards.length === 0}
              loading={collectionBusy}
              onClick={() => void downloadCollection()}
            >
              <Download aria-hidden="true" className="size-4" />
              Download class collection
            </Button>
          </div>
        </div>

        {loading || termsLoading ? (
          <div className="p-5">
            <LoadingPanel label="Loading released reports…" />
          </div>
        ) : cards.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={FileText}
              title="No released reports yet"
              description="Report cards appear here only after the platform has generated and released them for this term."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-gradely-muted">
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Pupil
                  </th>
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Admission no.
                  </th>
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Class
                  </th>
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Version
                  </th>
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Updated
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {cards.map((card) => (
                  <tr
                    key={card.id}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70"
                  >
                    <td className="px-5 py-3">
                      <p className="font-semibold text-gradely-text">
                        {card.pupilName}
                      </p>
                      <p className="text-xs text-gradely-muted">
                        {card.versionCount} saved version
                        {card.versionCount === 1 ? '' : 's'}
                      </p>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs whitespace-nowrap text-gradely-muted">
                      {card.admissionNumber}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap text-gradely-text">
                      {card.className}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <Badge tone="info">v{card.currentVersion}</Badge>
                    </td>
                    <td className="px-5 py-3 text-xs whitespace-nowrap text-gradely-muted">
                      {formatDateTime(card.updatedAt)}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                        <Link
                          to={`/dashboard/reports/cards/${card.id}`}
                          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold text-gradely-navy hover:bg-gradely-navy/5"
                        >
                          <Eye aria-hidden="true" className="size-4" />
                          Preview
                        </Link>
                        <button
                          type="button"
                          onClick={() => void printCard(card)}
                          disabled={busyCardId === card.id}
                          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold text-gradely-navy hover:bg-gradely-navy/5 disabled:opacity-60"
                        >
                          <Printer aria-hidden="true" className="size-4" />
                          Print
                        </button>
                        <button
                          type="button"
                          onClick={() => void downloadCard(card)}
                          disabled={busyCardId === card.id}
                          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold text-gradely-navy hover:bg-gradely-navy/5 disabled:opacity-60"
                        >
                          <Download aria-hidden="true" className="size-4" />
                          Download
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
