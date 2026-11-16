import type { SchoolRole } from '../auth/roles.js'
import type {
  ReportBatchRecord,
  ReportReleaseStatus,
} from './repository.js'

export interface ReportReleaseActor {
  schoolId: string
  userId: string
  membershipId: string
  role: SchoolRole
}

export interface PlatformReportActor {
  userId: string
}

export interface ReportReleaseAuditContext {
  actorUserId: string
  actorMembershipId: string | null
  actorRole: string
  ipAddress?: string | null
  userAgent?: string | null
}

export interface ReportReleaseEligibilityIssue {
  code: string
  message: string
}

export interface ReportReleaseEligibility {
  eligible: boolean
  issues: ReportReleaseEligibilityIssue[]
}

export interface ReportReleaseInvoiceRecord {
  id: string
  invoiceNumber: string
  status: string
  currency: string
  totalMinor: number
  paidMinor: number
  outstandingMinor: number
  pupilReportCardIds: string[]
}

export interface ReportReleaseVersionRecord {
  id: string
  schoolId: string
  reportCardId: string
  reportCardSchoolId: string
  pupilId: string
  pupilName: string
  admissionNumber: string
  version: number
  generatedAt: Date
  storageKey: string
  checksum: string
  byteSize: number
  academicYearId: string
  academicTermId: string
  classId: string
  snapshot: unknown
}

/**
 * A batch plus the denormalized context needed to evaluate release eligibility.
 * Storage object keys never leave the backend response layer.
 */
export interface ReportReleaseBatchRecord {
  batch: ReportBatchRecord
  schoolName: string
  schoolIsActive: boolean
  academicYearName: string
  academicYearSchoolId: string
  academicTermName: string
  academicTermSchoolId: string
  academicTermYearId: string
  className: string | null
  requestedByName: string | null
  submittedByName: string | null
  reviewedByName: string | null
  heldByName: string | null
  releasedByName: string | null
  invoice: ReportReleaseInvoiceRecord | null
  versions: ReportReleaseVersionRecord[]
}

export interface ReportReleaseBatchFilter {
  schoolId?: string
  academicYearId?: string
  academicTermId?: string
  status?: ReportReleaseStatus
  submittedFrom?: Date
  submittedTo?: Date
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

export interface ReportReleaseTransitionSet {
  submittedAt?: Date | null
  submittedByMembershipId?: string | null
  reviewedAt?: Date | null
  reviewedByUserId?: string | null
  returnedReason?: string | null
  holdReason?: string | null
  heldAt?: Date | null
  heldByUserId?: string | null
  releasedAt?: Date | null
  releasedByUserId?: string | null
  previousReleaseStatus?: ReportReleaseStatus | null
}

export interface ReportReleaseTransitionInput {
  batchId: string
  schoolId: string | null
  expected: ReportReleaseStatus[]
  next: ReportReleaseStatus
  actor: ReportReleaseAuditContext
  action: string
  reason?: string | null
  set: ReportReleaseTransitionSet
  metadata?: Record<string, unknown>
  /** Re-run the transactional invoice/report eligibility guard. */
  requireEligible?: boolean
}

export interface ReportReleaseFailedAttemptInput {
  batchId: string
  schoolId: string
  actor: ReportReleaseAuditContext
  action: string
  reason: string
  metadata?: Record<string, unknown>
}

export interface ReportReleasePreviewRecord {
  batchId: string
  schoolId: string
  versionId: string
  reportCardId: string
  version: number
  pupilName: string
  admissionNumber: string
  storageKey: string
  checksum: string
  byteSize: number
  fileName: string
}

export interface ReportReleaseRepository {
  listSchoolBatches(
    actor: ReportReleaseActor,
    filter: { academicTermId?: string },
  ): Promise<ReportReleaseBatchRecord[]>

  getSchoolBatch(
    actor: ReportReleaseActor,
    batchId: string,
  ): Promise<ReportReleaseBatchRecord | null>

  listPlatformBatches(
    filter: ReportReleaseBatchFilter,
  ): Promise<ReportReleaseBatchRecord[]>

  getPlatformBatch(batchId: string): Promise<ReportReleaseBatchRecord | null>

  overview(): Promise<ReportReleaseOverview>

  listPlatformSchools(): Promise<PlatformReportSchoolScope[]>

  transition(input: ReportReleaseTransitionInput): Promise<ReportBatchRecord>

  recordFailedAttempt(input: ReportReleaseFailedAttemptInput): Promise<void>

  getPreview(
    batchId: string,
    versionId: string,
  ): Promise<ReportReleasePreviewRecord | null>
}
