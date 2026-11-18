import {
  CheckCircle2,
  ClipboardList,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AccessDenied,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorNotice,
  LoadingPanel,
  PageHeader,
  Panel,
  TextareaField,
} from '../../components/ui'
import {
  getScoreEntry,
  getSubmission,
  listSubmissionHistory,
  listSubmissionReviews,
  listSubmissions,
  reviewSubmission,
} from '../../assessment/api'
import {
  SUBMISSION_STATUS_LABELS,
  formatScore,
  pupilName,
  submissionTone,
} from '../../assessment/helpers'
import type {
  ResultAuditEntry,
  ResultReview,
  ResultReviewDecision,
  ResultSubmission,
  ScoreEntryView,
} from '../../assessment/types'
import { formatDateTime, statusLabel } from '../../lib/format'
import { useSchool } from '../../schools/use-school'

const REVIEW_DECISION_LABELS: Record<ResultReviewDecision, string> = {
  ACCEPTED: 'Accepted',
  RETURNED_FOR_CORRECTION: 'Returned for correction',
}

export default function ResultReviewPage() {
  const { schoolId, isAdmin } = useSchool()
  const [searchParams] = useSearchParams()
  const submissionId = searchParams.get('submissionId') ?? ''

  const [queue, setQueue] = useState<ResultSubmission[]>([])
  const [submission, setSubmission] = useState<ResultSubmission | null>(null)
  const [view, setView] = useState<ScoreEntryView | null>(null)
  const [reviews, setReviews] = useState<ResultReview[]>([])
  const [history, setHistory] = useState<ResultAuditEntry[]>([])
  const [loading, setLoading] = useState(Boolean(submissionId))
  const [queueLoading, setQueueLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [confirmDecision, setConfirmDecision] =
    useState<ResultReviewDecision | null>(null)
  const [reviewing, setReviewing] = useState(false)

  const loadQueue = useCallback(async () => {
    if (!schoolId || !isAdmin) return

    try {
      setQueueLoading(true)
      const response = await listSubmissions(schoolId, { status: 'SUBMITTED' })
      setQueue(response.submissions)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load submitted results.',
      )
    } finally {
      setQueueLoading(false)
    }
  }, [isAdmin, schoolId])

  const loadDetail = useCallback(async () => {
    if (!schoolId || !isAdmin || !submissionId) {
      setSubmission(null)
      setView(null)
      setReviews([])
      setHistory([])
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      const submissionResponse = await getSubmission(schoolId, submissionId)
      const selected = submissionResponse.submission
      const [entryResponse, reviewResponse, historyResponse] = await Promise.all([
        getScoreEntry(schoolId, {
          academicTermId: selected.academicTermId,
          classId: selected.classId,
          subjectId: selected.subjectId,
        }),
        listSubmissionReviews(schoolId, selected.id),
        listSubmissionHistory(schoolId, selected.id),
      ])

      setSubmission(selected)
      setView(entryResponse.scoreEntry)
      setReviews(reviewResponse.reviews)
      setHistory(historyResponse.history)
      setError(null)
    } catch (cause) {
      setSubmission(null)
      setView(null)
      setReviews([])
      setHistory([])
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load the result submission.',
      )
    } finally {
      setLoading(false)
    }
  }, [isAdmin, schoolId, submissionId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadQueue()
  }, [loadQueue])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadDetail()
  }, [loadDetail])

  if (!isAdmin) {
    return (
      <AccessDenied message="Only a school administrator can review submitted results." />
    )
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
    if (!schoolId || !submission || !confirmDecision) return

    setReviewing(true)
    setActionError(null)

    try {
      const response = await reviewSubmission(schoolId, submission.id, {
        decision: confirmDecision,
        comment: comment.trim() || null,
        expectedVersion: submission.version,
      })
      setSuccess(
        response.submission.status === 'ACCEPTED'
          ? 'Results accepted. They are now immutable and eligible for the platform to generate report cards.'
          : 'Results returned for correction and unlocked for the teacher.',
      )
      setComment('')
      setConfirmDecision(null)
      await Promise.all([loadDetail(), loadQueue()])
    } catch (cause) {
      setConfirmDecision(null)
      setActionError(
        cause instanceof Error
          ? cause.message
          : 'Could not record the review decision.',
      )
    } finally {
      setReviewing(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Result review"
        description="Review submitted subject sheets and record the school's academic acceptance, or return them to the teacher for correction. Accepted results become eligible for platform report generation."
        actions={
          submissionId ? (
            <Link
              to="/dashboard/assessments/review"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-gradely-text shadow-sm transition-colors hover:bg-gradely-light"
            >
              Back to review queue
            </Link>
          ) : (
            <Button variant="secondary" onClick={() => void loadQueue()}>
              <RefreshCw aria-hidden="true" className="size-4" />
              Refresh
            </Button>
          )
        }
      />

      {error ? <ErrorNotice message={error} onRetry={loadDetail} /> : null}
      {success ? (
        <div
          role="status"
          className="rounded-2xl border border-gradely-green/30 bg-gradely-green/10 p-4 text-sm font-medium text-[#137026]"
        >
          {success}
        </div>
      ) : null}

      {!submissionId ? (
        queueLoading ? (
          <LoadingPanel label="Loading submitted results..." />
        ) : queue.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No results are waiting for review"
            description="Submitted subject sheets appear here. Teachers can save drafts and submit them from score entry."
          />
        ) : (
          <Panel className="p-0 sm:p-0">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-base font-bold text-gradely-text">
                Awaiting review
              </h2>
              <p className="mt-1 text-sm text-gradely-muted">
                {queue.length} submitted {queue.length === 1 ? 'sheet' : 'sheets'}.
                Choose one to inspect every pupil score and record a decision.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] border-collapse text-sm">
                <caption className="sr-only">Submitted results awaiting review</caption>
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-wide text-gradely-muted">
                    <th scope="col" className="px-4 py-3">Class</th>
                    <th scope="col" className="px-4 py-3">Subject</th>
                    <th scope="col" className="px-4 py-3">Pupils complete</th>
                    <th scope="col" className="px-4 py-3">Submitted by</th>
                    <th scope="col" className="px-4 py-3">Version</th>
                    <th scope="col" className="px-4 py-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map((item) => (
                    <tr key={item.id} className="border-b border-slate-100">
                      <th scope="row" className="px-4 py-3 text-left font-semibold text-gradely-text">
                        {item.className}
                      </th>
                      <td className="px-4 py-3">{item.subjectName}</td>
                      <td className="px-4 py-3 tabular-nums">
                        {item.completePupilCount} / {item.pupilCount}
                      </td>
                      <td className="px-4 py-3">
                        <p>{item.createdByName}</p>
                        <p className="text-xs text-gradely-muted">
                          {formatDateTime(item.submittedAt)}
                        </p>
                      </td>
                      <td className="px-4 py-3 tabular-nums">v{item.version}</td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          className="inline-flex items-center rounded-xl bg-gradely-navy px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-[#123c80]"
                          to={`/dashboard/assessments/review?submissionId=${item.id}`}
                        >
                          Review
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )
      ) : loading ? (
        <LoadingPanel label="Loading result submission..." />
      ) : !submission ? (
        <EmptyState
          icon={ClipboardList}
          title="Submission not found"
          description="The result sheet may have been removed or belongs to another school. Return to the review queue and choose another submission."
        />
      ) : (
        <>
          <Panel>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold text-gradely-text">
                    {submission.className} · {submission.subjectName}
                  </h2>
                  <Badge tone={submissionTone(submission.status)}>
                    {SUBMISSION_STATUS_LABELS[submission.status]}
                  </Badge>
                  <Badge tone="info">v{submission.version}</Badge>
                </div>
                <p className="mt-1 text-sm text-gradely-muted">
                  Submitted by {submission.createdByName} on{' '}
                  {formatDateTime(submission.submittedAt)}.
                </p>
                <p className="mt-1 text-sm text-gradely-muted">
                  {submission.completePupilCount} of {submission.pupilCount}{' '}
                  pupils have a complete result.
                </p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-xl bg-gradely-green/10 px-3 py-1.5 text-xs font-semibold text-[#137026]">
                <ShieldCheck aria-hidden="true" className="size-4" />
                School review only
              </span>
            </div>

            <div className="mt-4 rounded-xl border border-gradely-blue/20 bg-gradely-blue/5 p-3 text-sm leading-relaxed text-gradely-navy">
              <p className="font-semibold">
                Acceptance is the school's academic decision
              </p>
              <p className="mt-1 text-gradely-muted">
                It records school approval of the entered results. Once every
                required subject is accepted, the school can request report
                generation and the platform generates the reports. There is no
                separate approval, manual release or payment step. Accepted
                results become immutable; later changes need a new assessment
                cycle.
              </p>
            </div>

            {submission.lastComment ? (
              <p className="mt-3 rounded-xl border border-gradely-gold/30 bg-gradely-gold/10 p-3 text-sm text-[#7a5400]">
                <span className="font-bold">Latest review comment:</span>{' '}
                {submission.lastComment}
              </p>
            ) : null}
          </Panel>

          {view?.policy ? (
            <Panel className="p-0 sm:p-0">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-base font-bold text-gradely-text">
                  Score sheet snapshot
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-gradely-muted">
                  Policy: {view.policy.name} (v{view.policy.version}) · grading
                  scheme: {view.policy.gradingScheme.name}. These are the scores
                  recorded with this submission.
                </p>
              </div>
              <div className="max-h-[70vh] overflow-auto">
                <table className="w-full min-w-[52rem] border-collapse text-sm">
                  <caption className="sr-only">
                    Submitted scores for {submission.className}{' '}
                    {submission.subjectName}
                  </caption>
                  <thead className="sticky top-0 z-10 bg-white shadow-sm">
                    <tr className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-wide text-gradely-muted">
                      <th scope="col" className="px-3 py-3">#</th>
                      <th scope="col" className="px-3 py-3">Pupil</th>
                      {view.policy.components.map((component) => (
                        <th
                          key={component.id}
                          scope="col"
                          className="px-2 py-3 text-center"
                        >
                          <span className="block">{component.name}</span>
                          <span className="block font-normal normal-case text-[0.65rem]">
                            max {component.maximumScore}
                          </span>
                        </th>
                      ))}
                      <th scope="col" className="px-3 py-3 text-right">SBA</th>
                      <th scope="col" className="px-3 py-3 text-right">Exam</th>
                      <th scope="col" className="px-3 py-3 text-right">Final</th>
                      <th scope="col" className="px-3 py-3">Grade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.pupils.map((pupil, index) => (
                      <tr key={pupil.pupilId} className="border-b border-slate-100">
                        <td className="px-3 py-2 text-xs tabular-nums text-gradely-muted">
                          {index + 1}
                        </td>
                        <th scope="row" className="px-3 py-2 text-left">
                          <p className="font-semibold text-gradely-text">
                            {pupilName(pupil)}
                          </p>
                          <p className="text-xs font-normal text-gradely-muted">
                            {pupil.admissionNumber}
                          </p>
                        </th>
                        {view.policy!.components.map((component) => (
                          <td
                            key={component.id}
                            className="px-2 py-2 text-center tabular-nums"
                          >
                            {pupil.scores[component.id] ?? '—'}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatScore(pupil.sbaContribution)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatScore(pupil.examContribution)}
                        </td>
                        <td className="px-3 py-2 text-right font-bold tabular-nums">
                          {formatScore(pupil.finalScore)}
                        </td>
                        <td className="px-3 py-2">
                          {pupil.gradeLabel ? (
                            <div>
                              <p className="font-bold text-gradely-text">
                                {pupil.gradeLabel}
                              </p>
                              <p className="text-xs text-gradely-muted">
                                {pupil.gradeRemark ?? '—'}
                              </p>
                            </div>
                          ) : (
                            <span className="text-xs text-gradely-muted">
                              Incomplete
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) : null}

          {submission.status === 'SUBMITTED' ? (
            <Panel>
              <div className="flex items-start gap-3">
                <span className="rounded-xl bg-gradely-gold/15 p-2">
                  <CheckCircle2 aria-hidden="true" className="size-5 text-[#7a5400]" />
                </span>
                <div>
                  <h2 className="text-base font-bold text-gradely-text">
                    Record a review decision
                  </h2>
                  <p className="mt-1 text-sm leading-relaxed text-gradely-muted">
                    Add a comment for the teacher. A comment is required when
                    returning a sheet for correction and optional when accepting.
                  </p>
                </div>
              </div>

              {actionError ? (
                <div className="mt-4">
                  <ErrorNotice message={actionError} />
                </div>
              ) : null}

              <div className="mt-4">
                <TextareaField
                  label="Review comment"
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  rows={3}
                  maxLength={1000}
                  hint="Required to return a submission. Shared with the teacher and stored in the review history."
                />
              </div>

              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => requestReview('RETURNED_FOR_CORRECTION')}
                  disabled={reviewing}
                >
                  <RotateCcw aria-hidden="true" className="size-4" />
                  Return for correction
                </Button>
                <Button
                  onClick={() => requestReview('ACCEPTED')}
                  loading={reviewing}
                  disabled={reviewing}
                >
                  <CheckCircle2 aria-hidden="true" className="size-4" />
                  Accept results
                </Button>
              </div>
            </Panel>
          ) : (
            <Panel>
              <p className="text-sm leading-relaxed text-gradely-muted">
                {submission.status === 'ACCEPTED'
                  ? 'These results are accepted and immutable. No further review action is available for this assessment cycle.'
                  : 'Only a submitted sheet can be reviewed. This submission is not currently awaiting a school decision.'}
              </p>
            </Panel>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel>
              <h2 className="text-base font-bold text-gradely-text">
                Review history
              </h2>
              {reviews.length === 0 ? (
                <p className="mt-3 text-sm text-gradely-muted">
                  No review decisions recorded yet.
                </p>
              ) : (
                <ol className="mt-4 space-y-3">
                  {reviews.map((review) => (
                    <li
                      key={review.id}
                      className="rounded-xl border border-slate-200 p-3"
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
            </Panel>

            <Panel>
              <h2 className="text-base font-bold text-gradely-text">
                Audit trail
              </h2>
              {history.length === 0 ? (
                <p className="mt-3 text-sm text-gradely-muted">
                  No audit entries recorded for this submission.
                </p>
              ) : (
                <ol className="mt-4 space-y-2">
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
            </Panel>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmDecision !== null}
        title={
          confirmDecision === 'ACCEPTED'
            ? 'Accept these results?'
            : 'Return these results for correction?'
        }
        description={
          confirmDecision === 'ACCEPTED'
            ? 'Accepting records the school academic decision and makes the results immutable. Accepted results become eligible for platform report generation. Use a new assessment cycle for later changes.'
            : 'Returning unlocks the sheet so the teacher can correct it and resubmit. The review comment is shared with the teacher and kept in the audit trail.'
        }
        confirmLabel={
          confirmDecision === 'ACCEPTED'
            ? 'Accept results'
            : 'Return for correction'
        }
        danger={confirmDecision === 'RETURNED_FOR_CORRECTION'}
        busy={reviewing}
        onConfirm={() => void confirmReview()}
        onCancel={() => setConfirmDecision(null)}
      />
    </div>
  )
}
