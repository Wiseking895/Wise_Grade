import { ClipboardList, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
import {
  listAuthorizedClassSubjects,
  listSubmissions,
} from '../../assessment/api'
import {
  SUBMISSION_STATUS_LABELS,
  submissionTone,
} from '../../assessment/helpers'
import type {
  AuthorizedClassSubject,
  ResultSubmission,
  ResultSubmissionStatus,
} from '../../assessment/types'
import { listAcademicYears } from '../../schools/api'
import type { AcademicYear } from '../../schools/types'
import { formatDateTime } from '../../lib/format'
import { useSchool } from '../../schools/use-school'

const STATUS_FILTERS: Array<{
  value: ResultSubmissionStatus | ''
  label: string
}> = [
  { value: '', label: 'All statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'RETURNED_FOR_CORRECTION', label: 'Returned for correction' },
  { value: 'ACCEPTED', label: 'Accepted' },
]

export default function SubmissionsPage() {
  const { schoolId, isAdmin } = useSchool()

  const [years, setYears] = useState<AcademicYear[]>([])
  const [authorized, setAuthorized] = useState<AuthorizedClassSubject[]>([])
  const [submissions, setSubmissions] = useState<ResultSubmission[]>([])
  const [yearId, setYearId] = useState('')
  const [termId, setTermId] = useState('')
  const [status, setStatus] = useState<ResultSubmissionStatus | ''>('')
  const [classId, setClassId] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const selectedYear = years.find((year) => year.id === yearId)

  const classOptions = useMemo(() => {
    const map = new Map<string, string>()

    for (const pair of authorized) {
      map.set(pair.classId, pair.className)
    }

    return [...map.entries()].map(([id, name]) => ({ id, name }))
  }, [authorized])

  const subjectOptions = useMemo(
    () => authorized.filter((pair) => pair.classId === classId),
    [authorized, classId],
  )

  const loadOptions = useCallback(async () => {
    if (!schoolId) return

    try {
      const [yearResponse, pairResponse] = await Promise.all([
        listAcademicYears(schoolId),
        listAuthorizedClassSubjects(schoolId),
      ])
      setYears(yearResponse.academicYears)
      setAuthorized(pairResponse.classSubjects)

      if (!termId) {
        const nextYear =
          yearResponse.academicYears.find((year) => year.isCurrent) ??
          yearResponse.academicYears[0]
        setYearId(nextYear?.id ?? '')
        setTermId(
          nextYear?.terms.find((term) => term.isCurrent)?.id ??
            nextYear?.terms[0]?.id ??
            '',
        )
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load submission filters.',
      )
    }
  }, [schoolId, termId])

  const loadSubmissions = useCallback(async () => {
    if (!schoolId) return

    try {
      setLoading(true)
      const response = await listSubmissions(schoolId, {
        academicTermId: termId || undefined,
        status: status || undefined,
        classId: classId || undefined,
        subjectId: subjectId || undefined,
      })
      setSubmissions(response.submissions)
      setError(null)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load result submissions.',
      )
    } finally {
      setLoading(false)
    }
  }, [classId, schoolId, status, subjectId, termId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadOptions()
  }, [loadOptions])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSubmissions()
  }, [loadSubmissions])

  const summary = useMemo(() => {
    const counts = {
      DRAFT: 0,
      SUBMITTED: 0,
      RETURNED_FOR_CORRECTION: 0,
      ACCEPTED: 0,
    }

    for (const submission of submissions) {
      counts[submission.status] += 1
    }

    return counts
  }, [submissions])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Submission tracking"
        description="Track subject result sheets from draft through school review. Accepted results are immutable; returned sheets can be corrected and resubmitted."
        actions={
          <Button variant="secondary" onClick={() => void loadSubmissions()}>
            <RefreshCw aria-hidden="true" className="size-4" />
            Refresh
          </Button>
        }
      />

      {error ? <ErrorNotice message={error} onRetry={loadSubmissions} /> : null}

      <Panel>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <SelectField
            label="Academic year"
            value={yearId}
            onChange={(event) => {
              const nextId = event.target.value
              setYearId(nextId)
              const nextYear = years.find((year) => year.id === nextId)
              setTermId(
                nextYear?.terms.find((term) => term.isCurrent)?.id ??
                  nextYear?.terms[0]?.id ??
                  '',
              )
            }}
          >
            <option value="">All years</option>
            {years.map((year) => (
              <option key={year.id} value={year.id}>
                {year.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Academic term"
            value={termId}
            onChange={(event) => setTermId(event.target.value)}
          >
            <option value="">All terms</option>
            {selectedYear?.terms.map((term) => (
              <option key={term.id} value={term.id}>
                {term.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Status"
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as ResultSubmissionStatus | '')
            }
          >
            {STATUS_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Class"
            value={classId}
            onChange={(event) => {
              setClassId(event.target.value)
              setSubjectId('')
            }}
          >
            <option value="">All classes</option>
            {classOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Subject"
            value={subjectId}
            onChange={(event) => setSubjectId(event.target.value)}
            disabled={!classId}
          >
            <option value="">All subjects</option>
            {subjectOptions.map((option) => (
              <option key={option.subjectId} value={option.subjectId}>
                {option.subjectName}
              </option>
            ))}
          </SelectField>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <Badge>Draft {summary.DRAFT}</Badge>
          <Badge tone="info">Submitted {summary.SUBMITTED}</Badge>
          <Badge tone="warning">
            Returned {summary.RETURNED_FOR_CORRECTION}
          </Badge>
          <Badge tone="success">Accepted {summary.ACCEPTED}</Badge>
        </div>
      </Panel>

      {loading ? (
        <LoadingPanel label="Loading submissions..." />
      ) : submissions.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No submissions match these filters"
          description="Drafts appear after a teacher saves a score sheet. Submitted results appear here for school review."
        />
      ) : (
        <Panel className="p-0 sm:p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              <caption className="sr-only">Result submissions</caption>
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-wide text-gradely-muted">
                  <th scope="col" className="px-4 py-3">Class</th>
                  <th scope="col" className="px-4 py-3">Subject</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Pupils</th>
                  <th scope="col" className="px-4 py-3">Submitted by</th>
                  <th scope="col" className="px-4 py-3">Updated</th>
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((submission) => (
                  <tr key={submission.id} className="border-b border-slate-100">
                    <th scope="row" className="px-4 py-3 text-left font-semibold whitespace-nowrap text-gradely-text">
                      {submission.className}
                    </th>
                    <td className="px-4 py-3">{submission.subjectName}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Badge tone={submissionTone(submission.status)}>
                        {SUBMISSION_STATUS_LABELS[submission.status]}
                      </Badge>
                      <p className="mt-1 text-xs whitespace-nowrap text-gradely-muted">
                        Version {submission.version}
                      </p>
                    </td>
                    <td className="px-4 py-3 tabular-nums whitespace-nowrap">
                      {submission.completePupilCount} / {submission.pupilCount}
                    </td>
                    <td className="px-4 py-3">
                      <p className="whitespace-nowrap">{submission.createdByName}</p>
                      <p className="text-xs whitespace-nowrap text-gradely-muted">
                        {formatDateTime(submission.submittedAt)}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="whitespace-nowrap">{formatDateTime(submission.updatedAt)}</p>
                      {submission.reviewerName ? (
                        <p className="text-xs text-gradely-muted">
                          Reviewed by {submission.reviewerName}
                        </p>
                      ) : null}
                      {submission.lastComment ? (
                        <p className="mt-1 max-w-xs truncate text-xs text-[#7a5400]">
                          {submission.lastComment}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isAdmin && submission.status === 'SUBMITTED' ? (
                        <Link
                          className="inline-flex items-center whitespace-nowrap rounded-xl bg-gradely-navy px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-[#123c80]"
                          to={`/dashboard/assessments/review?submissionId=${submission.id}`}
                        >
                          Review
                        </Link>
                      ) : null}
                      {!isAdmin &&
                      (submission.status === 'DRAFT' ||
                        submission.status === 'RETURNED_FOR_CORRECTION') ? (
                        <Link
                          className="inline-flex items-center whitespace-nowrap rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-gradely-text shadow-sm hover:bg-gradely-light"
                          to={`/dashboard/assessments/scores?termId=${submission.academicTermId}&classId=${submission.classId}&subjectId=${submission.subjectId}`}
                        >
                          Open sheet
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  )
}
