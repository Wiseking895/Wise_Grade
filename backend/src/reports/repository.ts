import type { SchoolRole } from '../auth/roles.js'

export type ReportAssetKind = 'EMBLEM' | 'CREST' | 'SIGNATURE'
export type ReportTiePolicy = 'COMPETITION' | 'DENSE' | 'ORDINAL'
export type ReportAggregatePolicy =
  | 'NONE'
  | 'SUM_ALL_SUBJECTS'
  | 'BEST_SIX_TOTAL'
  | 'BEST_SIX_AVERAGE'
export type ReportGenerationScope = 'INDIVIDUAL' | 'CLASS' | 'TERM'
export type ReportBatchStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'COMPLETED_WITH_FAILURES'
  | 'FAILED'
export type ReportReleaseStatus =
  | 'GENERATED'
  | 'PENDING_PLATFORM_REVIEW'
  | 'RETURNED'
  | 'APPROVED'
  | 'RELEASED'
  | 'ON_HOLD'

export interface ReportActor {
  schoolId: string
  userId: string
  membershipId: string | null
  role: SchoolRole | 'PLATFORM_SUPER_ADMIN'
}

export interface ReportAuditContext {
  actorUserId: string
  actorMembershipId: string | null
  ipAddress?: string | null
  userAgent?: string | null
}

export interface ReportSettingsRecord {
  id: string
  schoolId: string
  academicYearId: string
  academicTermId: string
  emblemObjectKey: string | null
  crestObjectKey: string | null
  signatureObjectKey: string | null
  headteacherLabel: string
  rankingEnabled: boolean
  tiePolicy: ReportTiePolicy
  aggregatePolicy: ReportAggregatePolicy
  attendanceRequired: boolean
  closingDate: string | null
  reopeningDate: string | null
  createdAt: Date
  updatedAt: Date
}

export interface ReportSettingsInput {
  academicYearId: string
  academicTermId: string
  emblemObjectKey?: string | null
  crestObjectKey?: string | null
  signatureObjectKey?: string | null
  /**
   * Preferred public identifiers. The service resolves these to private object
   * keys so clients never need to know or send a storage key.
   */
  emblemAssetId?: string | null
  crestAssetId?: string | null
  signatureAssetId?: string | null
  headteacherLabel?: string
  rankingEnabled?: boolean
  tiePolicy?: ReportTiePolicy
  aggregatePolicy?: ReportAggregatePolicy
  attendanceRequired?: boolean
  closingDate?: string | null
  reopeningDate?: string | null
}

/**
 * Client-facing report settings. Attached branding is identified by its asset
 * id; private object keys stay inside the backend.
 */
export interface PublicReportSettings {
  id: string
  schoolId: string
  academicYearId: string
  academicTermId: string
  emblemAssetId: string | null
  crestAssetId: string | null
  signatureAssetId: string | null
  headteacherLabel: string
  rankingEnabled: boolean
  tiePolicy: ReportTiePolicy
  aggregatePolicy: ReportAggregatePolicy
  attendanceRequired: boolean
  closingDate: string | null
  reopeningDate: string | null
  createdAt: Date
  updatedAt: Date
}

export interface ReportAssetRecord {
  id: string
  schoolId: string
  kind: ReportAssetKind
  storageKey: string
  mimeType: string
  byteSize: number
  checksum: string
  originalName: string
  createdAt: Date
}

export interface ReportAssetCreateInput {
  kind: ReportAssetKind
  storageKey: string
  mimeType: string
  byteSize: number
  checksum: string
  originalName: string
}

/**
 * Client-facing view of a report asset. The internal `storageKey` must never
 * leave the backend, matching the sanitisation already applied to report
 * versions.
 */
export type PublicReportAsset = Omit<ReportAssetRecord, 'storageKey'>

export function toPublicReportAsset(
  asset: ReportAssetRecord,
): PublicReportAsset {
  return {
    id: asset.id,
    schoolId: asset.schoolId,
    kind: asset.kind,
    mimeType: asset.mimeType,
    byteSize: asset.byteSize,
    checksum: asset.checksum,
    originalName: asset.originalName,
    createdAt: asset.createdAt,
  }
}

export interface ReportInputRecord {
  id: string
  schoolId: string
  academicYearId: string
  academicTermId: string
  classId: string
  pupilId: string
  daysOpened: number | null
  daysAttended: number | null
  teacherRemarks: string | null
  attitude: string | null
  closingDate: string | null
  reopeningDate: string | null
  updatedAt: Date
}

export interface ReportInputUpsert {
  academicYearId: string
  academicTermId: string
  classId: string
  pupilId: string
  daysOpened?: number | null
  daysAttended?: number | null
  teacherRemarks?: string | null
  attitude?: string | null
  closingDate?: string | null
  reopeningDate?: string | null
}

export interface ReportSchoolRecord {
  id: string
  name: string
  slug: string
  email: string | null
  phone: string | null
  address: string | null
  landmark: string | null
  timezone: string
  logoObjectKey: string | null
  signatureObjectKey: string | null
  signatureName: string | null
  signatureDesignation: string | null
}

export interface ReportYearRecord {
  id: string
  name: string
  startsOn: string
  endsOn: string
}

export interface ReportTermRecord {
  id: string
  academicYearId: string
  name: string
  sequence: number
  startsOn: string
  endsOn: string
}

export interface ReportClassRecord {
  id: string
  name: string
  level: string | null
}

export interface ReportPupilRecord {
  id: string
  firstName: string
  lastName: string
  otherNames: string | null
  admissionNumber: string
  gender: string | null
  photoReference: string | null
  status: string
}

export interface ReportSubjectRecord {
  id: string
  name: string
  code: string | null
  sortOrder: number
}

export interface ReportSubmissionRecord {
  subjectId: string
  status: string
  policySnapshot: unknown
  gradingSnapshot: unknown
  reviewedAt: Date | null
}

export interface ReportScoreRecord {
  pupilId: string
  subjectId: string
  sbaContribution: string | null
  examContribution: string | null
  finalScore: string | null
  gradeLabel: string | null
  gradeRemark: string | null
  policySnapshot: unknown
  gradingSnapshot: unknown
}

/**
 * Everything needed to build reports and calculate rankings for one class and
 * term in a single read. The service applies eligibility and snapshot rules to
 * this data; it never recalculates scores from current policies.
 */
export interface ReportGenerationData {
  school: ReportSchoolRecord
  academicYear: ReportYearRecord
  academicTerm: ReportTermRecord
  class: ReportClassRecord
  settings: ReportSettingsRecord | null
  subjects: ReportSubjectRecord[]
  pupils: ReportPupilRecord[]
  inputs: ReportInputRecord[]
  submissions: ReportSubmissionRecord[]
  scores: ReportScoreRecord[]
  onRoll: number
}

export interface ReportGenerationRequest {
  academicYearId: string
  academicTermId: string
  classId: string
  pupilIds?: string[]
}

export interface ReportBatchCreateInput {
  academicYearId: string
  academicTermId: string
  classId: string | null
  scope: ReportGenerationScope
  requestedPupilCount: number
  /** Request batches start PENDING; direct generation starts PENDING too. */
  status?: ReportBatchStatus
  /** A school request is created directly in the platform review queue. */
  releaseStatus?: ReportReleaseStatus
  submittedAt?: Date | null
  submittedByMembershipId?: string | null
  /** Overrides the default REPORT_BATCH_REQUESTED audit action. */
  auditAction?: string
}

export interface ReportBatchRecord {
  id: string
  schoolId: string
  academicYearId: string
  academicTermId: string
  classId: string | null
  scope: ReportGenerationScope
  status: ReportBatchStatus
  requestedPupilCount: number
  generatedCount: number
  skippedCount: number
  failedCount: number
  fatalError: string | null
  startedAt: Date | null
  completedAt: Date | null
  releaseStatus: ReportReleaseStatus
  previousReleaseStatus: ReportReleaseStatus | null
  submittedAt: Date | null
  submittedByMembershipId: string | null
  reviewedAt: Date | null
  reviewedByUserId: string | null
  returnedReason: string | null
  holdReason: string | null
  heldAt: Date | null
  heldByUserId: string | null
  releasedAt: Date | null
  releasedByUserId: string | null
  createdAt: Date
}

export interface ReportFailureRecord {
  id: string
  batchId: string
  classId: string
  pupilId: string | null
  pupilName: string | null
  code: string
  message: string
  createdAt: Date
}

export interface ReportCardRecord {
  id: string
  schoolId: string
  academicYearId: string
  academicTermId: string
  classId: string
  className: string
  pupilId: string
  pupilName: string
  admissionNumber: string
  currentVersion: number
  versionCount: number
  createdAt: Date
  updatedAt: Date
}

export interface ReportVersionRecord {
  id: string
  reportCardId: string
  batchId: string | null
  releaseStatus: ReportReleaseStatus | null
  version: number
  checksum: string
  byteSize: number
  pageCount: number
  generatedAt: Date
  generatedByName: string | null
  snapshot: unknown
}

/**
 * Public version metadata. The snapshot and storage object key stay inside the
 * backend: they contain private storage paths and the full pupil report data.
 */
export type ReportVersionSummary = Omit<ReportVersionRecord, 'snapshot'>

export interface SaveGeneratedReportInput {
  versionId: string
  batchId: string
  reportCardId?: string | null
  academicYearId: string
  academicTermId: string
  classId: string
  pupilId: string
  snapshot: unknown
  storageKey: string
  checksum: string
  byteSize: number
  pageCount: number
}

export interface StoredObject {
  data: Buffer
  mimeType: string
  fileName: string
  checksum: string
}

export interface ReportBatchDetail extends ReportBatchRecord {
  className: string | null
  academicTermName: string
  failures: ReportFailureRecord[]
  versions: Array<{
    id: string
    reportCardId: string
    pupilId: string
    pupilName: string
    classId: string
    version: number
    generatedAt: Date
    /** Accepted subject results captured in this version's immutable snapshot. */
    acceptedResultCount: number
  }>
}

/**
 * Persistence boundary for Phase 5. All methods are tenant-scoped by the
 * actor's schoolId; no method accepts a school id that can override it.
 */
export interface ReportRepository {
  getSettings(
    actor: ReportActor,
    academicTermId: string,
  ): Promise<ReportSettingsRecord | null>

  updateSettings(
    actor: ReportActor,
    input: ReportSettingsInput,
    audit: ReportAuditContext,
  ): Promise<ReportSettingsRecord>

  uploadAsset(
    actor: ReportActor,
    input: ReportAssetCreateInput,
    audit: ReportAuditContext,
  ): Promise<ReportAssetRecord>

  getAsset(
    actor: ReportActor,
    assetId: string,
  ): Promise<ReportAssetRecord | null>

  listAssets(actor: ReportActor): Promise<ReportAssetRecord[]>

  upsertInput(
    actor: ReportActor,
    input: ReportInputUpsert,
    audit: ReportAuditContext,
  ): Promise<ReportInputRecord>

  listInputs(
    actor: ReportActor,
    filter: { academicTermId: string; classId: string },
  ): Promise<ReportInputRecord[]>

  listAccessibleClassIds(actor: ReportActor): Promise<string[] | null>

  hasClassTeacherAssignment(
    actor: ReportActor,
    classId: string,
  ): Promise<boolean>

  hasSubjectTeacherAssignment(
    actor: ReportActor,
    classId: string,
  ): Promise<boolean>

  loadGenerationData(
    actor: ReportActor,
    request: ReportGenerationRequest,
  ): Promise<ReportGenerationData>

  listClassesForTerm(
    actor: ReportActor,
    academicYearId: string,
    academicTermId: string,
  ): Promise<ReportClassRecord[]>

  getLatestVersionForPupil(
    actor: ReportActor,
    input: { academicTermId: string; pupilId: string },
  ): Promise<{
    reportCardId: string
    version: number
    snapshot: unknown
    storageKey: string
    checksum: string
  } | null>

  createBatch(
    actor: ReportActor,
    input: ReportBatchCreateInput,
    audit: ReportAuditContext,
  ): Promise<ReportBatchRecord>

  /**
   * Creates a school term request while holding a per-school/term lock and
   * rejecting a duplicate request for a reporting period that is still
   * pending, already approved, or has produced report artifacts. A fully
   * failed batch with no generated reports does not block a corrected request.
   */
  createRequestBatch(
    actor: ReportActor,
    input: ReportBatchCreateInput,
    audit: ReportAuditContext,
  ): Promise<ReportBatchRecord>

  /**
   * Atomically claims the batch for generation. For a first run the caller can
   * replace `requestedPupilCount` with the exact pupil snapshot being
   * generated, so the stored counters always reconcile.
   */
  markBatchRunning(
    actor: ReportActor,
    batchId: string,
    requestedPupilCount?: number,
  ): Promise<void>

  recordBatchEvent(
    actor: ReportActor,
    batchId: string,
    action: string,
    metadata?: Record<string, unknown>,
  ): Promise<void>

  /** Removes resolved per-pupil failure rows after a successful retry. */
  deleteFailures(
    actor: ReportActor,
    batchId: string,
    pupilIds: string[],
  ): Promise<void>

  recordReportAccess(
    actor: ReportActor,
    reportCardId: string,
    action: string,
    audit: ReportAuditContext,
  ): Promise<void>

  completeBatch(
    actor: ReportActor,
    batchId: string,
    result: {
      status: 'COMPLETED' | 'COMPLETED_WITH_FAILURES' | 'FAILED'
      generatedCount: number
      skippedCount: number
      failedCount: number
      fatalError?: string | null
    },
  ): Promise<ReportBatchRecord>

  recordFailure(
    actor: ReportActor,
    input: {
      batchId: string
      academicYearId: string
      academicTermId: string
      classId: string
      pupilId: string | null
      code: string
      message: string
    },
  ): Promise<ReportFailureRecord>

  saveGeneratedReport(
    actor: ReportActor,
    input: SaveGeneratedReportInput,
    audit: ReportAuditContext,
  ): Promise<ReportVersionRecord>

  listCards(
    actor: ReportActor,
    filter: {
      academicTermId: string
      classId?: string
      releasedOnly?: boolean
      accessibleClassIds: string[] | null
    },
  ): Promise<ReportCardRecord[]>

  getCard(
    actor: ReportActor,
    reportCardId: string,
  ): Promise<{
    card: ReportCardRecord
    versions: ReportVersionRecord[]
    input: ReportInputRecord | null
  } | null>

  getVersion(
    actor: ReportActor,
    reportCardId: string,
    version: number,
  ): Promise<{
    card: ReportCardRecord
    version: ReportVersionRecord
    storageKey: string
  } | null>

  listBatches(
    actor: ReportActor,
    filter: { academicTermId?: string; classIds: string[] | null },
  ): Promise<ReportBatchRecord[]>

  getBatch(
    actor: ReportActor,
    batchId: string,
  ): Promise<ReportBatchDetail | null>
}
