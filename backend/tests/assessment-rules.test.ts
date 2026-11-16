import { describe, expect, it } from 'vitest'
import {
  canReviewSubmission,
  isScoreEntryAuthorized,
  isSubmissionEditable,
  reviewTransition,
  submissionEditBlockReason,
  type ScoreEntryAuthorizationInput,
} from '../src/assessment/rules.js'

function authorization(
  patch: Partial<ScoreEntryAuthorizationInput> = {},
): ScoreEntryAuthorizationInput {
  return {
    role: 'CLASS_TEACHER',
    classSubjectActive: true,
    hasClassTeacherAssignment: true,
    hasSubjectTeacherAssignment: false,
    classTeacherEntryMode: 'EXPLICIT_ONLY',
    hasExplicitClassTeacherPermission: true,
    ...patch,
  }
}

describe('score entry authorization', () => {
  it('denies a school administrator score entry', () => {
    expect(
      isScoreEntryAuthorized(
        authorization({
          role: 'SCHOOL_ADMIN',
          classSubjectActive: false,
          hasClassTeacherAssignment: false,
          hasExplicitClassTeacherPermission: false,
        }),
      ),
    ).toBe(false)
  })

  it('denies a platform super administrator with no school membership', () => {
    expect(
      isScoreEntryAuthorized(
        authorization({
          role: 'PLATFORM_SUPER_ADMIN',
          hasClassTeacherAssignment: false,
          hasExplicitClassTeacherPermission: false,
        }),
      ),
    ).toBe(false)
  })

  it('denies every teacher role when the class-subject is not active', () => {
    expect(
      isScoreEntryAuthorized(
        authorization({ classSubjectActive: false }),
      ),
    ).toBe(false)
    expect(
      isScoreEntryAuthorized(
        authorization({
          role: 'SUBJECT_TEACHER',
          classSubjectActive: false,
          hasSubjectTeacherAssignment: true,
        }),
      ),
    ).toBe(false)
  })

  it('allows a subject teacher only for an active assignment', () => {
    expect(
      isScoreEntryAuthorized(
        authorization({
          role: 'SUBJECT_TEACHER',
          hasClassTeacherAssignment: false,
          hasSubjectTeacherAssignment: true,
          hasExplicitClassTeacherPermission: false,
        }),
      ),
    ).toBe(true)

    expect(
      isScoreEntryAuthorized(
        authorization({
          role: 'SUBJECT_TEACHER',
          hasClassTeacherAssignment: false,
          hasSubjectTeacherAssignment: false,
          hasExplicitClassTeacherPermission: false,
        }),
      ),
    ).toBe(false)
  })

  it('ignores explicit class-teacher grants for subject teachers', () => {
    expect(
      isScoreEntryAuthorized(
        authorization({
          role: 'SUBJECT_TEACHER',
          hasClassTeacherAssignment: false,
          hasSubjectTeacherAssignment: false,
          hasExplicitClassTeacherPermission: true,
        }),
      ),
    ).toBe(false)
  })

  it('requires an active class assignment for a class teacher', () => {
    expect(
      isScoreEntryAuthorized(
        authorization({ hasClassTeacherAssignment: false }),
      ),
    ).toBe(false)
  })

  it('allows a class teacher for subjects with no assigned subject teacher', () => {
    expect(
      isScoreEntryAuthorized(
        authorization({
          classTeacherEntryMode: 'ALL_CLASS_SUBJECTS',
          hasExplicitClassTeacherPermission: false,
        }),
      ),
    ).toBe(true)

    // The legacy EXPLICIT_ONLY mode no longer restricts the class teacher: a
    // subject with no active subject-teacher assignment is class-teacher-owned.
    expect(
      isScoreEntryAuthorized(
        authorization({
          classTeacherEntryMode: 'EXPLICIT_ONLY',
          hasExplicitClassTeacherPermission: false,
        }),
      ),
    ).toBe(true)
  })

  it('denies a class teacher when a subject teacher owns the class subject', () => {
    expect(
      isScoreEntryAuthorized(
        authorization({
          hasSubjectTeacherAssignment: true,
          classTeacherEntryMode: 'ALL_CLASS_SUBJECTS',
          hasExplicitClassTeacherPermission: true,
        }),
      ),
    ).toBe(false)
  })

  it('denies unknown roles', () => {
    expect(
      isScoreEntryAuthorized(authorization({ role: 'SOMETHING_ELSE' })),
    ).toBe(false)
  })
})

describe('submission edit state', () => {
  it('keeps drafts editable', () => {
    expect(isSubmissionEditable('DRAFT')).toBe(true)
    expect(submissionEditBlockReason('DRAFT')).toBeNull()
  })

  it('keeps returned sheets editable for correction', () => {
    expect(isSubmissionEditable('RETURNED_FOR_CORRECTION')).toBe(true)
    expect(submissionEditBlockReason('RETURNED_FOR_CORRECTION')).toBeNull()
  })

  it('locks submitted sheets', () => {
    expect(isSubmissionEditable('SUBMITTED')).toBe(false)
    expect(submissionEditBlockReason('SUBMITTED')).toMatch(/locked/i)
  })

  it('treats accepted results as immutable', () => {
    expect(isSubmissionEditable('ACCEPTED')).toBe(false)
    expect(submissionEditBlockReason('ACCEPTED')).toMatch(/immutable/i)
  })
})

describe('submission review state', () => {
  it('allows review only for submitted sheets', () => {
    expect(canReviewSubmission('SUBMITTED')).toBe(true)
    expect(canReviewSubmission('DRAFT')).toBe(false)
    expect(canReviewSubmission('RETURNED_FOR_CORRECTION')).toBe(false)
    expect(canReviewSubmission('ACCEPTED')).toBe(false)
  })

  it('maps review decisions to submission statuses', () => {
    expect(reviewTransition('ACCEPTED')).toBe('ACCEPTED')
    expect(reviewTransition('RETURNED_FOR_CORRECTION')).toBe(
      'RETURNED_FOR_CORRECTION',
    )
  })
})
