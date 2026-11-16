import type { SchoolRole } from '../auth/roles.js'

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
 * Explains a register row's subject position. FINAL is the official accepted
 * ranking, PROVISIONAL is calculated from complete current scores before
 * submission, and the remaining states never receive an ordinal.
 */
export type SubjectPositionStatus =
  | 'FINAL'
  | 'PROVISIONAL'
  | 'INCOMPLETE'
  | 'NOT_ELIGIBLE'
  | 'NOT_RANKED'

/** School-configured tie policy, mirrored from report settings. */
export type SubjectTiePolicy = 'COMPETITION' | 'DENSE' | 'ORDINAL'

export interface AssessmentAuditContext {
  /** Null for a restricted subject-teacher session. */
  actorUserId: string | null
  actorMembershipId: string | null
  ipAddress?: string | null
  userAgent?: string | null
}

export interface AssessmentActor {
  schoolId: string
  /** Null for a restricted subject-teacher session. */
  userId: string | null
  /** Null when the actor is a subject session without a school membership. */
  membershipId: string | null
  /** Set only for a restricted subject-teacher session. */
  assignmentId?: string | null
  role: SchoolRole
}

export interface AssessmentComponentInput {
  key: string
  name: string
  category: AssessmentComponentCategory
  maximumScore: string
  weightPercent: string
  sortOrder?: number
}

export interface AssessmentComponentRecord {
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

export interface GradeBandInput {
  minScore: string
  maxScore: string
  gradeLabel: string
  remark: string
  sortOrder?: number
}

export interface GradeBandRecord {
  id: string
  schoolId: string
  gradingSchemeId: string
  minScore: string
  maxScore: string
  gradeLabel: string
  remark: string
  sortOrder: number
}

export interface GradingSchemeInput {
  academicYearId: string
  academicTermId?: string | null
  name: string
  description?: string | null
  bands: GradeBandInput[]
}

export interface GradingSchemeRecord {
  id: string
  schoolId: string
  academicYearId: string
  academicTermId: string | null
  name: string
  description: string | null
  isActive: boolean
  bands: GradeBandRecord[]
  createdAt: Date
  updatedAt: Date
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

export interface AssessmentPolicyUpdateInput {
  name?: string
  description?: string | null
  gradingSchemeId?: string
  calculationMode?: AssessmentCalculationMode
  components?: AssessmentComponentInput[]
  isActive?: boolean
}

export interface AssessmentPolicyRecord {
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
  components: AssessmentComponentRecord[]
  gradingScheme: GradingSchemeRecord
  createdAt: Date
  updatedAt: Date
}

export interface AuthorizedClassSubject {
  classId: string
  className: string
  classLevel: string | null
  subjectId: string
  subjectName: string
  subjectCode: string | null
  source: 'ADMIN' | 'CLASS_TEACHER' | 'SUBJECT_TEACHER'
  /** Active subject teacher for this class-subject, when one exists. */
  subjectTeacherName?: string | null
  /** True when the current actor may not edit this sheet. */
  readOnly?: boolean
  /** True when the current actor may save drafts and submit results. */
  canEnterScores?: boolean
}

export interface ClassTeacherPermissionRecord {
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
  createdAt: Date
}

export interface AssessmentSettingsRecord {
  schoolId: string
  classTeacherEntryMode: ClassTeacherEntryMode
}

export interface AssessmentScoreInput {
  componentId: string
  score: string | null
}

export interface PupilScoreInput {
  pupilId: string
  scores: AssessmentScoreInput[]
}

export interface SaveDraftInput {
  academicTermId: string
  classId: string
  subjectId: string
  pupils: PupilScoreInput[]
  expectedVersion?: number
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
  /**
   * Backend-calculated competition position for this subject. It is
   * provisional while scores are being entered or awaiting acceptance, then
   * official once the submission is accepted. Teachers never supply this.
   */
  subjectPosition: number | null
  /**
   * Why `subjectPosition` is set or null. FINAL means the result is accepted
   * and officially ranked; PROVISIONAL means it is calculated from complete
   * current scores before submission or acceptance.
   */
  subjectPositionStatus: SubjectPositionStatus
  gradeLabel: string | null
  gradeRemark: string | null
}

export interface ResultSubmissionRecord {
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
  createdByMembershipId: string | null
  createdByAssignmentId: string | null
  createdByName: string
  submittedAt: Date | null
  reviewedAt: Date | null
  reviewerMembershipId: string | null
  reviewerName: string | null
  lastComment: string | null
  pupilCount: number
  completePupilCount: number
  updatedAt: Date
  createdAt: Date
}

export interface ScoreEntryView {
  academicTermId: string
  classId: string
  subjectId: string
  policy: AssessmentPolicyRecord | null
  /**
   * True for Creche, Nursery 1, Nursery 2, KG1 and KG2. Their subjects use the
   * fixed Gold/Silver/Bronze performance scale instead of letter grades.
   */
  earlyYears: boolean
  /** True when the actor may view but not edit/submit this sheet. */
  readOnly: boolean
  /** Name of the active subject teacher who owns the sheet, when applicable. */
  subjectTeacherName: string | null
  /** Name of the teacher responsible for the current sheet. */
  ownerName: string | null
  submission: ResultSubmissionRecord | null
  pupils: ScoreEntryPupil[]
  /** Ranking configuration used for provisional and official positions. */
  ranking: {
    enabled: boolean
    tiePolicy: SubjectTiePolicy
  }
  readiness: {
    totalPupils: number
    completePupils: number
    incompletePupils: number
    canSubmit: boolean
    reason: string | null
  }
}

export interface ResultReviewInput {
  decision: ResultReviewDecision
  comment?: string | null
  expectedVersion: number
}

export interface ResultReviewRecord {
  id: string
  resultSubmissionId: string
  reviewerMembershipId: string | null
  reviewerName: string
  decision: ResultReviewDecision
  fromStatus: ResultSubmissionStatus
  toStatus: ResultSubmissionStatus
  comment: string | null
  createdAt: Date
}

export interface ResultAuditRecord {
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
  createdAt: Date
}

export interface SubmissionListFilter {
  academicTermId?: string
  status?: ResultSubmissionStatus
  classId?: string
  subjectId?: string
}

export interface AssessmentRepository {
  getSettings(schoolId: string): Promise<AssessmentSettingsRecord>
  updateSettings(
    schoolId: string,
    mode: ClassTeacherEntryMode,
    audit: AssessmentAuditContext,
  ): Promise<AssessmentSettingsRecord>

  listClassTeacherPermissions(
    schoolId: string,
  ): Promise<ClassTeacherPermissionRecord[]>
  grantClassTeacherPermission(
    schoolId: string,
    input: { classId: string; subjectId: string; membershipId: string },
    audit: AssessmentAuditContext,
  ): Promise<ClassTeacherPermissionRecord>
  revokeClassTeacherPermission(
    schoolId: string,
    permissionId: string,
    audit: AssessmentAuditContext,
  ): Promise<void>

  listGradingSchemes(
    schoolId: string,
    filter?: { academicYearId?: string; academicTermId?: string },
  ): Promise<GradingSchemeRecord[]>
  createGradingScheme(
    schoolId: string,
    input: GradingSchemeInput,
    audit: AssessmentAuditContext,
  ): Promise<GradingSchemeRecord>
  updateGradingScheme(
    schoolId: string,
    schemeId: string,
    input: Partial<GradingSchemeInput> & { isActive?: boolean },
    audit: AssessmentAuditContext,
  ): Promise<GradingSchemeRecord>
  activateGradingScheme(
    schoolId: string,
    schemeId: string,
    audit: AssessmentAuditContext,
  ): Promise<GradingSchemeRecord>

  listPolicies(
    schoolId: string,
    filter?: {
      academicYearId?: string
      academicTermId?: string
      includeInactive?: boolean
    },
  ): Promise<AssessmentPolicyRecord[]>
  createPolicy(
    schoolId: string,
    input: AssessmentPolicyInput,
    audit: AssessmentAuditContext,
  ): Promise<AssessmentPolicyRecord>
  updatePolicy(
    schoolId: string,
    policyId: string,
    input: AssessmentPolicyUpdateInput,
    audit: AssessmentAuditContext,
  ): Promise<AssessmentPolicyRecord>
  activatePolicy(
    schoolId: string,
    policyId: string,
    audit: AssessmentAuditContext,
  ): Promise<AssessmentPolicyRecord>

  listAuthorizedClassSubjects(
    actor: AssessmentActor,
  ): Promise<AuthorizedClassSubject[]>
  /** Active class assignments for a CLASS_TEACHER actor, resolved server-side. */
  listClassTeacherClassIds(actor: AssessmentActor): Promise<string[]>
  canEnterScores(
    actor: AssessmentActor,
    classId: string,
    subjectId: string,
  ): Promise<boolean>
  /** Read-only check used by score-entry views and submission review. */
  canViewScoreEntry(
    actor: AssessmentActor,
    classId: string,
    subjectId: string,
  ): Promise<boolean>

  getScoreEntry(
    actor: AssessmentActor,
    input: { academicTermId: string; classId: string; subjectId: string },
  ): Promise<ScoreEntryView>
  saveDraft(
    actor: AssessmentActor,
    input: SaveDraftInput,
    audit: AssessmentAuditContext,
  ): Promise<ScoreEntryView>
  submitResults(
    actor: AssessmentActor,
    input: SaveDraftInput & { expectedVersion?: number },
    audit: AssessmentAuditContext,
  ): Promise<ResultSubmissionRecord>

  listSubmissions(
    schoolId: string,
    filter?: SubmissionListFilter,
  ): Promise<ResultSubmissionRecord[]>
  getSubmission(
    schoolId: string,
    submissionId: string,
  ): Promise<ResultSubmissionRecord | null>
  reviewSubmission(
    schoolId: string,
    submissionId: string,
    input: ResultReviewInput,
    audit: AssessmentAuditContext,
  ): Promise<ResultSubmissionRecord>
  listReviews(
    schoolId: string,
    submissionId: string,
  ): Promise<ResultReviewRecord[]>
  listHistory(
    schoolId: string,
    submissionId?: string,
  ): Promise<ResultAuditRecord[]>
}
