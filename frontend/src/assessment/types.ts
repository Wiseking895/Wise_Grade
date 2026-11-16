export type AssessmentComponentCategory = 'SBA' | 'EXAM'
export type AssessmentCalculationMode = 'COMPONENT_WEIGHTED' | 'GROUPED_SBA'
export type ClassTeacherEntryMode = 'ALL_CLASS_SUBJECTS' | 'EXPLICIT_ONLY'
export type ResultSubmissionStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'RETURNED_FOR_CORRECTION'
  | 'ACCEPTED'
export type ResultReviewDecision = 'ACCEPTED' | 'RETURNED_FOR_CORRECTION'

/**
 * Backend explanation for a register row's subject position. FINAL is an
 * official accepted ranking; PROVISIONAL is calculated from complete current
 * scores before submission or acceptance.
 */
export type SubjectPositionStatus =
  | 'FINAL'
  | 'PROVISIONAL'
  | 'INCOMPLETE'
  | 'NOT_ELIGIBLE'
  | 'NOT_RANKED'

export type SubjectTiePolicy = 'COMPETITION' | 'DENSE' | 'ORDINAL'

export interface AssessmentComponent {
  id: string
  schoolId: string
  policyId: string
  key: string
  name: string
  category: AssessmentComponentCategory
  maximumScore: string
  weightPercent: string
  sortOrder: number
}

export interface AssessmentComponentInput {
  key: string
  name: string
  category: AssessmentComponentCategory
  maximumScore: string
  weightPercent: string
  sortOrder?: number
}

export interface GradeBand {
  id: string
  schoolId: string
  gradingSchemeId: string
  minScore: string
  maxScore: string
  gradeLabel: string
  remark: string
  sortOrder: number
}

export interface GradeBandInput {
  minScore: string
  maxScore: string
  gradeLabel: string
  remark: string
  sortOrder?: number
}

export interface GradingScheme {
  id: string
  schoolId: string
  academicYearId: string
  academicTermId: string | null
  name: string
  description: string | null
  isActive: boolean
  bands: GradeBand[]
  createdAt: string
  updatedAt: string
}

export interface GradingSchemeInput {
  academicYearId: string
  academicTermId?: string | null
  name: string
  description?: string | null
  bands: GradeBandInput[]
}

export interface AssessmentPolicy {
  id: string
  schoolId: string
  academicYearId: string
  academicTermId: string
  classId: string | null
  level: string | null
  gradingSchemeId: string
  name: string
  description: string | null
  scopeKey: string
  version: number
  isActive: boolean
  isDefault: boolean
  calculationMode: AssessmentCalculationMode
  components: AssessmentComponent[]
  gradingScheme: GradingScheme
  createdAt: string
  updatedAt: string
}

export interface AssessmentPolicyInput {
  academicYearId: string
  academicTermId: string
  classId?: string | null
  level?: string | null
  gradingSchemeId: string
  name: string
  description?: string | null
  calculationMode?: AssessmentCalculationMode
  components: AssessmentComponentInput[]
}

export interface AssessmentSettings {
  schoolId: string
  classTeacherEntryMode: ClassTeacherEntryMode
}

export interface ClassTeacherPermission {
  id: string
  schoolId: string
  classId: string
  className: string
  subjectId: string
  subjectName: string
  membershipId: string
  userId: string
  firstName: string
  lastName: string
  email: string
  createdAt: string
}

export interface AuthorizedClassSubject {
  classId: string
  className: string
  classLevel: string | null
  subjectId: string
  subjectName: string
  subjectCode: string | null
  source: 'ADMIN' | 'CLASS_TEACHER' | 'SUBJECT_TEACHER'
  /** Name of the active subject teacher who owns the sheet, if any. */
  subjectTeacherName: string | null
  /** True when the current user may view but not edit this sheet. */
  readOnly: boolean
  canEnterScores: boolean
}

export interface ScoreEntryPupil {
  pupilId: string
  admissionNumber: string
  firstName: string
  lastName: string
  otherNames: string | null
  scores: Record<string, string>
  missingComponentIds: string[]
  sbaContribution: number | null
  examContribution: number | null
  finalScore: number | null
  /** Backend position for the selected subject: provisional or official. */
  subjectPosition: number | null
  /** Backend explanation of whether the position is provisional or official. */
  subjectPositionStatus: SubjectPositionStatus
  gradeLabel: string | null
  gradeRemark: string | null
}

export interface ResultSubmission {
  id: string
  schoolId: string
  academicYearId: string
  academicTermId: string
  classId: string
  className: string
  subjectId: string
  subjectName: string
  status: ResultSubmissionStatus
  version: number
  createdByMembershipId: string
  createdByName: string
  submittedAt: string | null
  reviewedAt: string | null
  reviewerMembershipId: string | null
  reviewerName: string | null
  lastComment: string | null
  pupilCount: number
  completePupilCount: number
  updatedAt: string
  createdAt: string
}

export interface ScoreEntryReadiness {
  totalPupils: number
  completePupils: number
  incompletePupils: number
  canSubmit: boolean
  reason: string | null
}

export interface ScoreEntryView {
  academicTermId: string
  classId: string
  subjectId: string
  policy: AssessmentPolicy | null
  /** Creche/Nursery/KG classes use Gold/Silver/Bronze, not letter grades. */
  earlyYears: boolean
  /** True when the sheet belongs to an active subject teacher. */
  readOnly: boolean
  /** Name of the active subject teacher who owns the sheet, if any. */
  subjectTeacherName: string | null
  /** Display name of the person responsible for the sheet. */
  ownerName: string
  submission: ResultSubmission | null
  pupils: ScoreEntryPupil[]
  /** Ranking configuration for provisional and official positions. */
  ranking: {
    enabled: boolean
    tiePolicy: SubjectTiePolicy
  }
  readiness: ScoreEntryReadiness
}

export interface PupilScoreInput {
  pupilId: string
  scores: Array<{ componentId: string; score: string | null }>
}

export interface SaveDraftInput {
  academicTermId: string
  classId: string
  subjectId: string
  pupils: PupilScoreInput[]
  expectedVersion?: number
}

export interface ResultReview {
  id: string
  resultSubmissionId: string
  /** Null when the review was recorded by a platform super administrator. */
  reviewerMembershipId: string | null
  reviewerName: string
  decision: ResultReviewDecision
  fromStatus: ResultSubmissionStatus
  toStatus: ResultSubmissionStatus
  comment: string | null
  createdAt: string
}

export interface ResultAuditEntry {
  id: string
  resultSubmissionId: string | null
  action: string
  entityType: string
  entityId: string | null
  actorUserId: string | null
  actorMembershipId: string | null
  actorName: string | null
  beforeState: unknown
  afterState: unknown
  metadata: unknown
  createdAt: string
}

export interface SubmissionFilter {
  academicTermId?: string
  status?: ResultSubmissionStatus
  classId?: string
  subjectId?: string
}
