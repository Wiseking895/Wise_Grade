import type {
  ClassTeacherEntryMode,
  ResultReviewDecision,
  ResultSubmissionStatus,
} from './repository.js'

/**
 * Pure Phase 4 decision rules.
 *
 * These functions contain no database or HTTP dependencies so the teacher
 * authorization matrix and submission state machine can be unit tested
 * without PostgreSQL. The Prisma repository loads the facts and delegates the
 * final decision here.
 */

export interface ScoreEntryAuthorizationInput {
  role: string
  classSubjectActive: boolean
  hasClassTeacherAssignment: boolean
  hasSubjectTeacherAssignment: boolean
  classTeacherEntryMode: ClassTeacherEntryMode
  hasExplicitClassTeacherPermission: boolean
}

/**
 * Only teaching roles may enter scores. A subject teacher needs both an active
 * class-subject and an active assignment for that exact class and subject. A
 * class teacher owns every subject in their class unless an active subject
 * teacher is assigned to that class-subject; subject-teacher-owned sheets are
 * read-only for the class teacher. A school administrator and a platform
 * administrator (who has no school membership) are denied.
 */
export function isScoreEntryAuthorized(
  input: ScoreEntryAuthorizationInput,
): boolean {
  if (input.role === 'SCHOOL_ADMIN') {
    return false
  }

  if (!input.classSubjectActive) {
    return false
  }

  if (input.role === 'SUBJECT_TEACHER') {
    return input.hasSubjectTeacherAssignment
  }

  if (input.role === 'CLASS_TEACHER') {
    if (!input.hasClassTeacherAssignment) {
      return false
    }

    // A subject-teacher-owned sheet can never be edited by the class teacher.
    if (input.hasSubjectTeacherAssignment) {
      return false
    }

    // Subjects without a subject teacher remain class-teacher-owned. The
    // legacy ALL_CLASS_SUBJECTS / EXPLICIT_ONLY setting is intentionally
    // superseded for this workflow but retained for compatibility.
    return true
  }

  return false
}

/**
 * Returns the reason a saved submission may not be edited, or null when it is
 * editable. Drafts and sheets returned for correction remain editable;
 * submitted sheets are locked for review and accepted results are immutable.
 */
export function submissionEditBlockReason(
  status: ResultSubmissionStatus | string,
): string | null {
  if (status === 'SUBMITTED') {
    return 'These results have been submitted and are locked. The Wise Grade academic review team can return them for correction.'
  }

  if (status === 'ACCEPTED') {
    return 'These results were accepted and are immutable. A new assessment cycle must be used for later changes.'
  }

  return null
}

export function isSubmissionEditable(
  status: ResultSubmissionStatus | string,
): boolean {
  return submissionEditBlockReason(status) === null
}

/** Only a submitted sheet can be accepted or returned by school review. */
export function canReviewSubmission(
  status: ResultSubmissionStatus | string,
): boolean {
  return status === 'SUBMITTED'
}

export function reviewTransition(
  decision: ResultReviewDecision,
): ResultSubmissionStatus {
  return decision === 'ACCEPTED' ? 'ACCEPTED' : 'RETURNED_FOR_CORRECTION'
}
