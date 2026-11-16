import {
  CheckCircle2,
  ClipboardCheck,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
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
  getPlatformSubmission,
  listPlatformSubmissionHistory,
  listPlatformSubmissionReviews,
  listPlatformSubmissions,
  reviewPlatformSubmission,
} from '../../assessment/api'
import {
  SUBMISSION_STATUS_LABELS,
  submissionTone,
} from '../../assessment/helpers'
import type {
  ResultAuditEntry,
  ResultReview,
  ResultReviewDecision,
  ResultSubmission,
  ResultSubmissionStatus,
} from '../../assessment/types'
import { formatDateTime, statusLabel } from '../../lib/format'
import { listPlatformReportSchools } from '../../reports/api'
import type { PlatformReportSchoolScope } from '../../reports/types'

const REVIEW_DECISION_LABELS: Record<ResultReviewDecision, string> = {
  ACCEPTED: 'Accepted',
  RETURNED_FOR_CORRECTION: 'Returned for correction',
}

const STATUS_OPTIONS: ResultSubmissionStatus[] = [
  'SUBMITTED',
  'ACCEPTED',
  'RETURNED_FOR_CORRECTION',
  'DRAFT',
]

export default function PlatformAssessmentsPage() {
  const [schools, setSchools] = useState<PlatformReportSchoolScope[]>([])
  const [schoolId, setSchoolId] = useState('')
  const [termId, setTermId] = useState('')
  const [status, setStatus] = useState<ResultSubmissionStatus | ''>('SUBMITTED')

  const [submissions, setSubmissions] = useState<ResultSubmission[]>([])
  const [referenceLoading, setReferenceLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ResultSubmission | null>(null)
  const [reviews, setReviews] = useState<ResultReview[]>([])
  const [history, setHistory] = useState<ResultAuditEntry[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const [comment, setComment] = useState('')
  const [confirmDecision, setConfirmDecision] =
    useState<ResultReviewDecision | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionBusy, setActionBusy] = useState(false)

  const selectedSchool = schools.find((school) => school.id === schoolId) ?? null
  const termOptions =
    selectedSchool?.academicYears.flatMap((year) =>
      year.terms.map((term) => ({
        id: term.id,
        label: `${year.name} · ${term.name}`,
      })),
    ) ?? []

  const loadReference = useCallback(async () => {
    try {
      setReferenceLoading(true)
      const response = await listPlatformReportSchools()
      setSchools(response.schools)
      setSchoolId((current) =>
        response.schools.some((school) => school.id === current)
          ? current
          : (response.schools[0]?.id ?? ''),
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load schools for academic review.',
      )
    } finally {
      setReferenceLoading(false)
    }
  }, [])

  const loadSubmissions = useCallback(async () => {
    if (!schoolId) {
      setSubmissions([])
      return
    }

    try {
      setLoading(true)
      const response = await listPlatformSubmissions(schoolId, {
        academicTermId: termId || undefined,
        status: status || undefined,
      })
      setSubmissions(response.submissions)
      setError(null)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load submitted results.',
      )
    } finally {
      setLoading(false)
    }
  }, [schoolId, termId, status])

  const loadDetail = useCallback(async () => {
    if (!schoolId || !selectedId) {
      setDetail(null)
      setReviews([])
      setHistory([])
      return
    }

    try {
      setDetailLoading(true)
      setDetailError(null)
      const [submissionResponse, reviewResponse, historyResponse] =
        await Promise.all([
          getPlatformSubmission(schoolId, selectedId),
          listPlatformSubmissionReviews(schoolId, selectedId),
          listPlatformSubmissionHistory(schoolId, selectedId),
        ])
      setDetail(submissionResponse.submission)
      setReviews(reviewResponse.reviews)
      setHistory(historyResponse.history)
    } catch (cause) {
      setDetail(null)
      setDetailError(
        cause instanceof Error
          ? cause.message
          : 'Could not load the result submission.',
      )
    } finally {
      setDetailLoading(false)
    }
  }, [schoolId, selectedId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadReference()
  }, [loadReference])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSubmissions()
  }, [loadSubmissions])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadDetail()
  }, [loadDetail])

  function openSubmission(submission: ResultSubmission) {
    setSelectedId(submission.id)
    setComment('')
    setActionError(null)
  }

  function requestReview(decision: ResultReviewDecision) {
    setActionError(null)

    if (decision === 'RETURNED_FOR_CORRECTION' && !comment.trim()) {
      setActionError(
        'Add a comment explaining what must be corrected before returning this sheet.',
      )
      return
    }

    setConfirmDecision(decision)
  }

  async function confirmReview() {
    if (!schoolId || !detail || !confirmDecision) return

    setActionBusy(true)
    setActionError(null)

    try {
      const response = await reviewPlatformSubmission(schoolId, detail.id, {
        decision: confirmDecision,
        comment: comment.trim() || null,
        expectedVersion: detail.version,
      })
      setNotice(
        response.submission.status === 'ACCEPTED'
          ? 'Results accepted. They are now eligible for platform report preparation.'
          : 'Results returned to the class teacher for correction.',
      )
      setConfirmDecision(null)
      setComment('')
      await Promise.all([loadDetail(), loadSubmissions()])
    } catch (cause) {
      setConfirmDecision(null)
      setActionError(
        cause instanceof Error
          ? cause.message
          : 'Could not record the review decision.',
      )
    } finally {
      setActionBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Academic review"
        description="Authorized platform review of results submitted by school teachers. Acceptance makes results immutable and eligible for report generation. Acceptance alone never releases reports."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void loadReference()
              void loadSubmissions()
              void loadDetail()
            }}
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
        <p className="text-sm leading-relaxed text-gradely-muted">
          Platform reviewers hold no school membership. Every decision is
          recorded against the platform user in the audit trail. Reports remain
          private until a separate platform approval and release action.
        </p>
      </div>

      {error ? (
        <ErrorNotice
          message={error}
          onRetry={() => {
            void loadReference()
            void loadSubmissions()
          }}
        />
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
        <div className="grid gap-4 lg:grid-cols-3">
          <SelectField
            label="School"
            value={schoolId}
            onChange={(event) => {
              setSchoolId(event.target.value)
              setTermId('')
              setSelectedId(null)
            }}
            disabled={referenceLoading || schools.length === 0}
          >
            {schools.length === 0 ? (
              <option value="">No schools available</option>
            ) : null}
            {schools.map((school) => (
              <option key={school.id} value={school.id}>
                {school.name}
                {school.isActive ? '' : ' (inactive)'}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Academic term"
            value={termId}
            onChange={(event) => {
              setTermId(event.target.value)
              setSelectedId(null)
            }}
            disabled={!selectedSchool}
          >
            <option value="">All terms</option>
            {termOptions.map((term) => (
              <option key={term.id} value={term.id}>
                {term.label}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as ResultSubmissionStatus | '')
              setSelectedId(null)
            }}
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {SUBMISSION_STATUS_LABELS[option]}
              </option>
            ))}
          </SelectField>
        </div>
      </Panel>

      {loading || referenceLoading ? (
        <LoadingPanel label="Loading submitted results…" />
      ) : submissions.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No result submissions match these filters"
          description="Teachers must submit SBA and examination scores before platform academic review can begin."
        />
      ) : (
        <Panel className="overflow-hidden p-0 sm:p-0">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-base font-bold text-gradely-text">
              Submitted result sheets
            </h2>
            <p className="mt-0.5 text-xs text-gradely-muted">
              {submissions.length} sheet{submissions.length === 1 ? '' : 's'} in
              this view.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-gradely-muted">
                  <th scope="col" className="px-5 py-3 font-semibold">Class</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Subject</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Pupils complete</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Submitted by</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Version</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((submission) => (
                  <tr
                    key={submission.id}
                    className={`border-b border-slate-100 last:border-0 ${
                      selectedId === submission.id
                        ? 'bg-gradely-blue/5'
                        : 'hover:bg-slate-50/70'
                    }`}
                  >
                    <td className="px-5 py-3 font-semibold text-gradely-text">
                      {submission.className}
                    </td>
                    <td className="px-5 py-3 text-gradely-text">
                      {submission.subjectName}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={submissionTone(submission.status)}>
                        {SUBMISSION_STATUS_LABELS[submission.status]}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 tabular-nums text-gradely-muted">
                      {submission.completePupilCount} / {submission.pupilCount}
                    </td>
                    <td className="px-5 py-3">
                      <p className="text-gradely-text">{submission.createdByName}</p>
                      <p className="text-xs text-gradely-muted">
                        {formatDateTime(submission.submittedAt)}
                      </p>
                    </td>
                    <td className="px-5 py-3 tabular-nums text-gradely-muted">
                      v{submission.version}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => openSubmission(submission)}
                      >
                        <ClipboardCheck aria-hidden="true" className="size-4" />
                        Review
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Modal
        open={selectedId !== null}
        onClose={() => {
          if (actionBusy) return
          setSelectedId(null)
          setDetail(null)
          setReviews([])
          setHistory([])
          setDetailError(null)
          setActionError(null)
        }}
        title="Result submission review"
        description={
          detail
            ? `${detail.className} · ${detail.subjectName} · v${detail.version}`
            : 'Loading submission…'
        }
        wide
      >
        {detailLoading ? (
          <LoadingPanel label="Loading result submission…" />
        ) : detailError ? (
          <ErrorNotice message={detailError} onRetry={() => void loadDetail()} />
        ) : detail ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={submissionTone(detail.status)}>
                {SUBMISSION_STATUS_LABELS[detail.status]}
              </Badge>
              <Badge tone="info">v{detail.version}</Badge>
              <span className="text-xs text-gradely-muted">
                Submitted by {detail.createdByName} on{' '}
                {formatDateTime(detail.submittedAt)}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-gradely-light/60 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gradely-muted">
                  Pupils complete
                </p>
                <p className="mt-1 text-xl font-extrabold text-gradely-text">
                  {detail.completePupilCount} / {detail.pupilCount}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-gradely-light/60 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gradely-muted">
                  Reviewed
                </p>
                <p className="mt-1 text-sm font-semibold text-gradely-text">
                  {detail.reviewedAt
                    ? `${formatDateTime(detail.reviewedAt)}${
                        detail.reviewerName ? ` · ${detail.reviewerName}` : ''
                      }`
                    : 'Not reviewed'}
                </p>
              </div>
            </div>

            {detail.lastComment ? (
              <p className="rounded-xl border border-gradely-gold/30 bg-gradely-gold/10 p-3 text-sm text-[#7a5400]">
                <span className="font-bold">Latest review comment:</span>{' '}
                {detail.lastComment}
              </p>
            ) : null}

            {detail.status === 'SUBMITTED' ? (
              <div className="rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-bold text-gradely-text">
                  Record a review decision
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-gradely-muted">
                  A comment is required when returning a sheet for correction.
                  Acceptance is an academic review step, not report release.
                </p>
                {actionError ? (
                  <div className="mt-3">
                    <ErrorNotice message={actionError} />
                  </div>
                ) : null}
                <div className="mt-3">
                  <TextareaField
                    label="Review comment"
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    rows={3}
                    maxLength={1000}
                    hint="Shared with the teacher and stored in the review history."
                  />
                </div>
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => requestReview('RETURNED_FOR_CORRECTION')}
                    disabled={actionBusy}
                  >
                    <RotateCcw aria-hidden="true" className="size-4" />
                    Return for correction
                  </Button>
                  <Button
                    onClick={() => requestReview('ACCEPTED')}
                    disabled={actionBusy}
                  >
                    <CheckCircle2 aria-hidden="true" className="size-4" />
                    Accept results
                  </Button>
                </div>
              </div>
            ) : (
              <p className="rounded-xl border border-slate-200 p-4 text-sm text-gradely-muted">
                {detail.status === 'ACCEPTED'
                  ? 'These results are accepted and immutable. They are eligible for platform report generation.'
                  : 'Only a submitted sheet can be reviewed from this screen.'}
              </p>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-bold text-gradely-text">
                  Review history
                </h3>
                {reviews.length === 0 ? (
                  <p className="mt-3 text-sm text-gradely-muted">
                    No review decisions recorded yet.
                  </p>
                ) : (
                  <ol className="mt-3 space-y-3">
                    {reviews.map((review) => (
                      <li
                        key={review.id}
                        className="rounded-xl border border-slate-100 p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            tone={
                              review.decision === 'ACCEPTED'
                                ? 'success'
                                : 'warning'
                            }
                          >
                            {REVIEW_DECISION_LABELS[review.decision]}
                          </Badge>
                          <span className="text-xs text-gradely-muted">
                            {formatDateTime(review.createdAt)}
                          </span>
                        </div>
                        <p className="mt-2 text-sm font-semibold text-gradely-text">
                          {review.reviewerName}
                        </p>
                        {review.comment ? (
                          <p className="mt-1 text-sm text-gradely-muted">
                            {review.comment}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-bold text-gradely-text">
                  Audit trail
                </h3>
                {history.length === 0 ? (
                  <p className="mt-3 text-sm text-gradely-muted">
                    No audit entries recorded for this submission.
                  </p>
                ) : (
                  <ol className="mt-3 space-y-2">
                    {history.map((entry) => (
                      <li
                        key={entry.id}
                        className="flex flex-col gap-1 border-b border-slate-100 pb-2 text-sm last:border-0 last:pb-0"
                      >
                        <span className="font-semibold text-gradely-text">
                          {statusLabel(entry.action)}
                        </span>
                        <span className="text-xs text-gradely-muted">
                          {entry.actorName ?? 'System'} ·{' '}
                          {formatDateTime(entry.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={confirmDecision !== null}
        title={
          confirmDecision === 'ACCEPTED'
            ? 'Accept these results?'
            : 'Return these results for correction?'
        }
        description={
          confirmDecision === 'ACCEPTED'
            ? 'Acceptance makes the results immutable and eligible for report preparation. It does not generate, approve or release any report.'
            : 'Returning unlocks the sheet for the class teacher to correct and resubmit. The comment is shared with the school and kept in the audit trail.'
        }
        confirmLabel={
          confirmDecision === 'ACCEPTED'
            ? 'Accept results'
            : 'Return for correction'
        }
        danger={confirmDecision === 'RETURNED_FOR_CORRECTION'}
        busy={actionBusy}
        onConfirm={() => void confirmReview()}
        onCancel={() => setConfirmDecision(null)}
      />
    </div>
  )
}
