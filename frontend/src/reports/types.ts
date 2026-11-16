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
export type GenerationOutcome = 'GENERATED' | 'SKIPPED' | 'FAILED'
export type ReportReleaseStatus =
  | 'GENERATED'
  | 'PENDING_PLATFORM_REVIEW'
  | 'RETURNED'
  | 'APPROVED'
  | 'RELEASED'
  | 'ON_HOLD'

export interface ReportSettings {
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
  createdAt: string
  updatedAt: string
}

export interface ReportSettingsInput {
  academicYearId: string
  academicTermId: string
  emblemObjectKey?: string | null
  crestObjectKey?: string | null
  signatureObjectKey?: string | null
  headteacherLabel?: string
  rankingEnabled?: boolean
  tiePolicy?: ReportTiePolicy
  aggregatePolicy?: ReportAggregatePolicy
  attendanceRequired?: boolean
  closingDate?: string | null
  reopeningDate?: string | null
}

export interface ReportAsset {
  id: string
  schoolId: string
  kind: ReportAssetKind
  storageKey: string
  mimeType: string
  byteSize: number
  checksum: string
  originalName: string
  createdAt: string
}

export interface ReportInput {
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
  updatedAt: string
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

export interface ReportClass {
  id: string
  name: string
  level: string | null
}

export interface EligibilityFailure {
  code: string
  message: string
}

export interface ReportEligibilityItem {
  pupilId: string
  pupilName: string
  eligible: boolean
  acceptedResultCount: number
  failure: EligibilityFailure | null
}

export interface ReportEligibilityResult {
  className: string
  onRoll: number
  eligibleCount: number
  pupils: ReportEligibilityItem[]
}

export type ReportRequestClassStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'FAILED'

export interface ReportRequestClassSummary {
  classId: string
  className: string
  pupilCount: number
  eligiblePupilCount: number
  acceptedResultCount: number
  ineligiblePupilCount: number
  generatedCount: number
  failedCount: number
  status: ReportRequestClassStatus
}

export interface ReportFailure {
  id: string
  batchId: string
  classId: string
  pupilId: string | null
  pupilName: string | null
  code: string
  message: string
  createdAt: string
}

export interface ReportBatch {
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
  startedAt: string | null
  completedAt: string | null
  releaseStatus: ReportReleaseStatus
  previousReleaseStatus: ReportReleaseStatus | null
  submittedAt: string | null
  submittedByMembershipId: string | null
  reviewedAt: string | null
  reviewedByUserId: string | null
  returnedReason: string | null
  holdReason: string | null
  heldAt: string | null
  heldByUserId: string | null
  releasedAt: string | null
  releasedByUserId: string | null
  createdAt: string
}

export interface ReportBatchDetail extends ReportBatch {
  className: string | null
  academicTermName: string
  failures: ReportFailure[]
  versions: Array<{
    id: string
    reportCardId: string
    pupilId: string
    pupilName: string
    classId: string
    version: number
    generatedAt: string
  }>
}

export interface GenerationItemResult {
  pupilId: string
  pupilName: string
  classId: string
  status: GenerationOutcome
  version: number | null
  failureCode: string | null
  failureMessage: string | null
}

export interface GenerateReportsResult {
  batch: ReportBatch
  results: GenerationItemResult[]
}

export interface ReportCard {
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
  createdAt: string
  updatedAt: string
}

export interface ReportVersion {
  id: string
  reportCardId: string
  batchId: string | null
  releaseStatus: ReportReleaseStatus | null
  version: number
  checksum: string
  byteSize: number
  pageCount: number
  generatedAt: string
  generatedByName: string | null
}

export interface ReportCardDetail {
  card: ReportCard
  versions: ReportVersion[]
  input: ReportInput | null
}

export interface GenerateReportsInput {
  academicYearId: string
  academicTermId: string
  classId?: string | null
  pupilIds?: string[]
  scope: ReportGenerationScope
}

export interface ReportReleaseEligibility {
  eligible: boolean
  issues: EligibilityFailure[]
}

export interface ReportReleaseInvoiceSummary {
  id: string
  invoiceNumber: string
  status: string
  currency: string
  totalMinor: number
  paidMinor: number
  outstandingMinor: number
}

export interface ReportReleaseBatchSummary {
  id: string
  schoolId: string
  schoolName: string
  academicYearId: string
  academicYearName: string
  academicTermId: string
  academicTermName: string
  classId: string | null
  className: string | null
  scope: ReportGenerationScope
  generationStatus: ReportBatchStatus
  requestedPupilCount: number
  generatedCount: number
  skippedCount: number
  failedCount: number
  reportCount: number
  releaseStatus: ReportReleaseStatus
  previousReleaseStatus: ReportReleaseStatus | null
  submittedAt: string | null
  submittedByName: string | null
  reviewedAt: string | null
  reviewedByName: string | null
  returnedReason: string | null
  holdReason: string | null
  heldAt: string | null
  heldByName: string | null
  releasedAt: string | null
  releasedByName: string | null
  invoice: ReportReleaseInvoiceSummary | null
  eligibility: ReportReleaseEligibility
  createdAt: string
  completedAt: string | null
}

export interface ReportReleaseVersionSummary {
  id: string
  reportCardId: string
  pupilId: string
  pupilName: string
  admissionNumber: string
  version: number
  generatedAt: string
  releaseStatus: ReportReleaseStatus
}

export interface ReportReleaseBatchDetail extends ReportReleaseBatchSummary {
  versions: ReportReleaseVersionSummary[]
}

export interface ReportRequestDetail extends ReportReleaseBatchDetail {
  classes: ReportRequestClassSummary[]
}

export interface ReportRequestResult {
  batch: ReportBatch
  classes: ReportRequestClassSummary[]
}

export interface ReportRequestActionResult {
  batch: ReportRequestDetail
  results: GenerationItemResult[]
}

export interface ReportReleaseOverview {
  totalGenerated: number
  generated: number
  pendingReview: number
  returned: number
  approvedUnreleased: number
  released: number
  onHold: number
}

export interface PlatformReportSchoolScope {
  id: string
  name: string
  isActive: boolean
  academicYears: Array<{
    id: string
    name: string
    terms: Array<{ id: string; name: string }>
  }>
}

export interface PlatformReportBatchFilter {
  schoolId?: string
  academicYearId?: string
  academicTermId?: string
  status?: ReportReleaseStatus
  submittedFrom?: string
  submittedTo?: string
}
