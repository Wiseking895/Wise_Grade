import { apiRequest } from '../lib/api'
import type {
  AuthorizedClassSubject,
  ResultAuditEntry,
  ResultReview,
  ResultReviewDecision,
  ResultSubmission,
  ResultSubmissionStatus,
  SaveDraftInput,
  ScoreEntryView,
} from './types'

function assessmentPath(schoolId: string, suffix = ''): string {
  return `/api/schools/${schoolId}/assessments${suffix}`
}

export function listAuthorizedClassSubjects(schoolId: string) {
  return apiRequest<{ classSubjects: AuthorizedClassSubject[] }>(
    assessmentPath(schoolId, '/class-subjects'),
  )
}

export function getScoreEntry(
  schoolId: string,
  query: { academicTermId: string; classId: string; subjectId: string },
) {
  const params = new URLSearchParams({
    academicTermId: query.academicTermId,
    classId: query.classId,
    subjectId: query.subjectId,
  })

  return apiRequest<{ scoreEntry: ScoreEntryView }>(
    assessmentPath(schoolId, `/score-entry?${params.toString()}`),
  )
}

export function saveScoreDraft(schoolId: string, input: SaveDraftInput) {
  return apiRequest<{ scoreEntry: ScoreEntryView }>(
    assessmentPath(schoolId, '/score-entry'),
    { method: 'PUT', body: input },
  )
}

export function submitScoreResults(
  schoolId: string,
  input: SaveDraftInput & { expectedVersion?: number },
) {
  return apiRequest<{ submission: ResultSubmission }>(
    assessmentPath(schoolId, '/score-entry/submit'),
    { method: 'POST', body: input },
  )
}

export function listSubmissions(
  schoolId: string,
  query: {
    academicTermId?: string
    status?: ResultSubmissionStatus
    classId?: string
    subjectId?: string
  } = {},
) {
  const params = new URLSearchParams()

  if (query.academicTermId) params.set('academicTermId', query.academicTermId)
  if (query.status) params.set('status', query.status)
  if (query.classId) params.set('classId', query.classId)
  if (query.subjectId) params.set('subjectId', query.subjectId)

  const suffix = params.size > 0 ? `?${params.toString()}` : ''
  return apiRequest<{ submissions: ResultSubmission[] }>(
    assessmentPath(schoolId, `/submissions${suffix}`),
  )
}

export function getSubmission(schoolId: string, submissionId: string) {
  return apiRequest<{ submission: ResultSubmission }>(
    assessmentPath(schoolId, `/submissions/${submissionId}`),
  )
}

export function reviewSubmission(
  schoolId: string,
  submissionId: string,
  input: {
    decision: ResultReviewDecision
    comment?: string | null
    expectedVersion: number
  },
) {
  return apiRequest<{ submission: ResultSubmission }>(
    assessmentPath(schoolId, `/submissions/${submissionId}/review`),
    { method: 'POST', body: input },
  )
}

export function listSubmissionReviews(
  schoolId: string,
  submissionId: string,
) {
  return apiRequest<{ reviews: ResultReview[] }>(
    assessmentPath(schoolId, `/submissions/${submissionId}/reviews`),
  )
}

export function listSubmissionHistory(
  schoolId: string,
  submissionId: string,
) {
  return apiRequest<{ history: ResultAuditEntry[] }>(
    assessmentPath(schoolId, `/submissions/${submissionId}/history`),
  )
}

// ---------------------------------------------------------------------------
// Platform academic review (no school membership)
// ---------------------------------------------------------------------------

function platformAssessmentPath(schoolId: string, suffix = ''): string {
  return `/api/platform/assessments/schools/${schoolId}${suffix}`
}

export function listPlatformSubmissions(
  schoolId: string,
  query: {
    academicTermId?: string
    status?: ResultSubmissionStatus
    classId?: string
    subjectId?: string
  } = {},
) {
  const params = new URLSearchParams()

  if (query.academicTermId) params.set('academicTermId', query.academicTermId)
  if (query.status) params.set('status', query.status)
  if (query.classId) params.set('classId', query.classId)
  if (query.subjectId) params.set('subjectId', query.subjectId)

  const suffix = params.size > 0 ? `?${params.toString()}` : ''
  return apiRequest<{ submissions: ResultSubmission[] }>(
    platformAssessmentPath(schoolId, `/submissions${suffix}`),
  )
}

export function getPlatformSubmission(
  schoolId: string,
  submissionId: string,
) {
  return apiRequest<{ submission: ResultSubmission }>(
    platformAssessmentPath(schoolId, `/submissions/${submissionId}`),
  )
}

export function listPlatformSubmissionReviews(
  schoolId: string,
  submissionId: string,
) {
  return apiRequest<{ reviews: ResultReview[] }>(
    platformAssessmentPath(schoolId, `/submissions/${submissionId}/reviews`),
  )
}

export function listPlatformSubmissionHistory(
  schoolId: string,
  submissionId: string,
) {
  return apiRequest<{ history: ResultAuditEntry[] }>(
    platformAssessmentPath(schoolId, `/submissions/${submissionId}/history`),
  )
}

export function reviewPlatformSubmission(
  schoolId: string,
  submissionId: string,
  input: {
    decision: ResultReviewDecision
    comment?: string | null
    expectedVersion: number
  },
) {
  return apiRequest<{ submission: ResultSubmission }>(
    platformAssessmentPath(schoolId, `/submissions/${submissionId}/review`),
    { method: 'POST', body: input },
  )
}
