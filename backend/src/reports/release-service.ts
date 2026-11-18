import { HttpError } from '../errors/http-error.js'
import { sha256, type StorageAdapter } from '../storage/storage.js'
import type {
  PlatformReportActor,
  PlatformReportSchoolScope,
  ReportReleaseActor,
  ReportReleaseAuditContext,
  ReportReleaseBatchFilter,
  ReportReleaseBatchRecord,
  ReportReleaseEligibility,
  ReportReleaseEligibilityIssue,
  ReportReleaseOverview,
  ReportReleaseRepository,
} from './release-repository.js'
import type { ReportReleaseStatus } from './repository.js'

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
  scope: string
  generationStatus: string
  requestedPupilCount: number
  generatedCount: number
  skippedCount: number
  failedCount: number
  reportCount: number
  fatalError: string | null
  /**
   * Distinct failure reasons recorded for this batch. Eligibility codes such as
   * RESULT_NOT_ACCEPTED or ATTENDANCE_MISSING are resolved by correcting records
   * and using Generate; GENERATION_FAILED is the only retryable code.
   */
  failureCodes: string[]
  retryableFailureCount: number
  releaseStatus: ReportReleaseStatus
  previousReleaseStatus: ReportReleaseStatus | null
  submittedAt: Date | null
  submittedByName: string | null
  reviewedAt: Date | null
  reviewedByName: string | null
  returnedReason: string | null
  holdReason: string | null
  heldAt: Date | null
  heldByName: string | null
  releasedAt: Date | null
  releasedByName: string | null
  invoice: {
    id: string
    invoiceNumber: string
    status: string
    currency: string
    totalMinor: number
    paidMinor: number
    outstandingMinor: number
  } | null
  eligibility: ReportReleaseEligibility
  createdAt: Date
  completedAt: Date | null
}

export interface ReportReleaseVersionSummary {
  id: string
  reportCardId: string
  pupilId: string
  pupilName: string
  admissionNumber: string
  version: number
  generatedAt: Date
  releaseStatus: ReportReleaseStatus
}

export interface ReportReleaseFailureSummary {
  pupilId: string | null
  pupilName: string | null
  code: string
  message: string
}

export interface ReportReleaseBatchDetail extends ReportReleaseBatchSummary {
  versions: ReportReleaseVersionSummary[]
  failures: ReportReleaseFailureSummary[]
}

export interface PlatformReportPreview {
  data: Buffer
  fileName: string
  checksum: string
}

export interface ReportReleaseServiceOptions {
  repository: ReportReleaseRepository
  storage: StorageAdapter
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function snapshotAcceptedCount(snapshot: unknown): number {
  if (!isRecord(snapshot) || !isRecord(snapshot.source)) {
    return 0
  }

  const count = snapshot.source.acceptedSubmissions
  return typeof count === 'number' && Number.isFinite(count) ? count : 0
}

function snapshotSubjectCount(snapshot: unknown): number {
  if (
    !isRecord(snapshot) ||
    !isRecord(snapshot.academic) ||
    !Array.isArray(snapshot.academic.subjects)
  ) {
    return 0
  }

  return snapshot.academic.subjects.length
}

function reasonForIssues(issues: ReportReleaseEligibilityIssue[]): string {
  return issues.map((issue) => issue.message).join(' ')
}

function requireReason(reason: string): string {
  const trimmed = reason.trim()

  if (trimmed.length < 3) {
    throw new HttpError(
      400,
      'A reason of at least 3 characters is required.',
    )
  }

  if (trimmed.length > 1000) {
    throw new HttpError(400, 'Reason must be 1000 characters or fewer.')
  }

  return trimmed
}

/**
 * Phase 6B release orchestration.
 *
 * Payment verification and generation never call this service. A school must
 * explicitly submit an eligible batch; only a platform super administrator can
 * approve, return, hold or release it. Approval is deliberately not release.
 */
export class ReportReleaseService {
  private readonly repository: ReportReleaseRepository
  private readonly storage: StorageAdapter

  constructor(options: ReportReleaseServiceOptions) {
    this.repository = options.repository
    this.storage = options.storage
  }

  async listSchoolBatches(
    actor: ReportReleaseActor,
    filter: { academicTermId?: string },
  ): Promise<ReportReleaseBatchSummary[]> {
    this.assertSchoolAdmin(actor)
    const records = await this.repository.listSchoolBatches(actor, filter)

    return Promise.all(
      records.map(async (record) =>
        this.toSummary(record, await this.evaluate(record, true)),
      ),
    )
  }

  async getSchoolBatch(
    actor: ReportReleaseActor,
    batchId: string,
  ): Promise<ReportReleaseBatchDetail> {
    this.assertSchoolAdmin(actor)
    const record = await this.requireSchoolBatch(actor, batchId)
    return this.toDetail(record, await this.evaluate(record, true))
  }

  async submit(
    actor: ReportReleaseActor,
    batchId: string,
    audit: ReportReleaseAuditContext,
  ): Promise<ReportReleaseBatchDetail> {
    this.assertSchoolAdmin(actor)
    const record = await this.requireSchoolBatch(actor, batchId)

    if (
      record.batch.releaseStatus !== 'GENERATED' &&
      record.batch.releaseStatus !== 'RETURNED'
    ) {
      throw new HttpError(
        409,
        'This batch is not awaiting school submission or resubmission.',
      )
    }

    const eligibility = await this.evaluate(record, true)

    if (!eligibility.eligible) {
      throw new HttpError(
        409,
        'This report batch is not eligible for platform review.',
        { issues: eligibility.issues },
      )
    }

    const resubmission = record.batch.releaseStatus === 'RETURNED'
    await this.repository.transition({
      batchId,
      schoolId: actor.schoolId,
      expected: ['GENERATED', 'RETURNED'],
      next: 'PENDING_PLATFORM_REVIEW',
      actor: audit,
      action: resubmission
        ? 'REPORT_RELEASE_RESUBMITTED'
        : 'REPORT_RELEASE_SUBMITTED',
      set: {
        submittedAt: new Date(),
        submittedByMembershipId: actor.membershipId,
        reviewedAt: null,
        reviewedByUserId: null,
        returnedReason: null,
        previousReleaseStatus: null,
      },
      metadata: {
        resubmission,
        invoiceId: record.invoice?.id ?? null,
        invoiceStatus: record.invoice?.status ?? null,
        reportCount: record.versions.length,
      },
      requireEligible: true,
    })

    const refreshed = await this.requireSchoolBatch(actor, batchId)
    return this.toDetail(refreshed, await this.evaluate(refreshed, true))
  }

  /**
   * Moves a freshly generated batch into platform review. This replaces the old
   * school-submission step: the platform creates the batch, so it owns the
   * review queue. Eligibility (including payment) is deliberately not checked
   * here; approval and release re-check it.
   */
  async submitGenerated(
    batchId: string,
    schoolId: string,
    audit: ReportReleaseAuditContext,
  ): Promise<ReportReleaseBatchDetail> {
    const record = await this.requirePlatformBatch(batchId)

    if (record.batch.schoolId !== schoolId) {
      throw new HttpError(404, 'Report generation batch not found')
    }

    if (record.batch.releaseStatus !== 'GENERATED') {
      throw new HttpError(
        409,
        'Only a newly generated batch can be queued for platform review.',
      )
    }

    const batch = await this.repository.transition({
      batchId,
      schoolId,
      expected: ['GENERATED'],
      next: 'PENDING_PLATFORM_REVIEW',
      actor: audit,
      action: 'REPORT_RELEASE_GENERATED_FOR_REVIEW',
      set: {
        submittedAt: new Date(),
        submittedByMembershipId: null,
        reviewedAt: null,
        reviewedByUserId: null,
        returnedReason: null,
        previousReleaseStatus: null,
      },
      metadata: {
        reportCount: record.versions.length,
        generatedBy: 'PLATFORM_SUPER_ADMIN',
      },
      requireEligible: false,
    })

    return this.toDetail(
      { ...(await this.requirePlatformBatch(batchId)), batch },
      await this.evaluate(record, false),
    )
  }

  async listPlatformBatches(
    filter: ReportReleaseBatchFilter,
  ): Promise<ReportReleaseBatchSummary[]> {
    const records = await this.repository.listPlatformBatches(filter)

    return Promise.all(
      records.map(async (record) =>
        this.toSummary(record, await this.evaluate(record, false)),
      ),
    )
  }

  async getPlatformBatch(batchId: string): Promise<ReportReleaseBatchDetail> {
    const record = await this.requirePlatformBatch(batchId)
    return this.toDetail(record, await this.evaluate(record, true))
  }

  async overview(): Promise<ReportReleaseOverview> {
    return this.repository.overview()
  }

  async listPlatformSchools(): Promise<PlatformReportSchoolScope[]> {
    return this.repository.listPlatformSchools()
  }

  async approve(
    actor: PlatformReportActor,
    batchId: string,
    audit: ReportReleaseAuditContext,
  ): Promise<ReportReleaseBatchDetail> {
    const record = await this.requirePlatformBatch(batchId)

    if (record.batch.releaseStatus !== 'PENDING_PLATFORM_REVIEW') {
      throw new HttpError(
        409,
        'This batch is not awaiting platform approval.',
      )
    }

    const eligibility = await this.evaluate(record, true)

    if (!eligibility.eligible) {
      await this.repository.recordFailedAttempt({
        batchId,
        schoolId: record.batch.schoolId,
        actor: audit,
        action: 'REPORT_RELEASE_APPROVAL_FAILED',
        reason: reasonForIssues(eligibility.issues),
        metadata: { issues: eligibility.issues },
      })

      throw new HttpError(
        409,
        'This report batch is no longer eligible for approval.',
        { issues: eligibility.issues },
      )
    }

    const batch = await this.repository.transition({
      batchId,
      schoolId: null,
      expected: ['PENDING_PLATFORM_REVIEW'],
      next: 'APPROVED',
      actor: audit,
      action: 'REPORT_RELEASE_APPROVED',
      set: {
        reviewedAt: new Date(),
        reviewedByUserId: actor.userId,
        returnedReason: null,
        previousReleaseStatus: null,
      },
      metadata: {
        invoiceId: record.invoice?.id ?? null,
        invoiceStatus: record.invoice?.status ?? null,
        reportCount: record.versions.length,
      },
      requireEligible: true,
    })

    return this.toDetail(
      { ...(await this.requirePlatformBatch(batchId)), batch },
      eligibility,
    )
  }

  /**
   * Approves a school-submitted generation request. At this point the request
   * has no reports yet: approval authorises generation, which the workflow
   * service runs immediately afterwards. Report availability still requires the
   * generation to complete and the separate release guard to pass.
   */
  async approveRequest(
    actor: PlatformReportActor,
    batchId: string,
    audit: ReportReleaseAuditContext,
  ): Promise<ReportReleaseBatchDetail> {
    const record = await this.requirePlatformBatch(batchId)

    if (record.batch.releaseStatus !== 'PENDING_PLATFORM_REVIEW') {
      throw new HttpError(
        409,
        'This report-generation request is not awaiting platform approval.',
      )
    }

    // A fully generated batch queued for review still needs the full report
    // eligibility check before it can be approved. A failed or partially
    // generated request must be allowed to become APPROVED so Generate Reports
    // can re-evaluate its pupils; release still requires a completed batch.
    if (
      record.batch.status === 'COMPLETED' &&
      record.batch.failedCount === 0 &&
      record.batch.skippedCount === 0 &&
      record.versions.length > 0
    ) {
      return this.approve(actor, batchId, audit)
    }

    const issues: ReportReleaseEligibilityIssue[] = []

    if (!record.schoolIsActive) {
      issues.push({
        code: 'SCHOOL_INACTIVE',
        message: 'The school is inactive and cannot generate reports.',
      })
    }

    if (
      record.academicYearSchoolId !== record.batch.schoolId ||
      record.academicTermSchoolId !== record.batch.schoolId ||
      record.academicTermYearId !== record.batch.academicYearId
    ) {
      issues.push({
        code: 'YEAR_TERM_INVALID',
        message:
          'The academic year and term do not belong to this school and request.',
      })
    }

    if (issues.length > 0) {
      await this.repository.recordFailedAttempt({
        batchId,
        schoolId: record.batch.schoolId,
        actor: audit,
        action: 'REPORT_RELEASE_APPROVAL_FAILED',
        reason: reasonForIssues(issues),
        metadata: { issues },
      })

      throw new HttpError(
        409,
        'This report-generation request is no longer eligible for approval.',
        { issues },
      )
    }

    const batch = await this.repository.transition({
      batchId,
      schoolId: null,
      expected: ['PENDING_PLATFORM_REVIEW'],
      next: 'APPROVED',
      actor: audit,
      action: 'REPORT_RELEASE_APPROVED',
      set: {
        reviewedAt: new Date(),
        reviewedByUserId: actor.userId,
        returnedReason: null,
        previousReleaseStatus: null,
      },
      metadata: { request: true, reportCount: 0 },
      requireEligible: false,
    })

    return this.toDetail(
      { ...(await this.requirePlatformBatch(batchId)), batch },
      { eligible: true, issues: [] },
    )
  }

  /**
   * Rejects a request with a required reason. The school sees the reason on its
   * dashboard and may submit a fresh request after correcting the issue.
   */
  async rejectRequest(
    actor: PlatformReportActor,
    batchId: string,
    reason: string,
    audit: ReportReleaseAuditContext,
  ): Promise<ReportReleaseBatchDetail> {
    const record = await this.requirePlatformBatch(batchId)
    const normalizedReason = requireReason(reason)

    if (record.batch.releaseStatus !== 'PENDING_PLATFORM_REVIEW') {
      throw new HttpError(
        409,
        'Only a request awaiting platform review can be rejected.',
      )
    }

    const batch = await this.repository.transition({
      batchId,
      schoolId: null,
      expected: ['PENDING_PLATFORM_REVIEW'],
      next: 'RETURNED',
      actor: audit,
      action: 'REPORT_REQUEST_REJECTED',
      reason: normalizedReason,
      set: {
        reviewedAt: new Date(),
        reviewedByUserId: actor.userId,
        returnedReason: normalizedReason,
        previousReleaseStatus: null,
      },
      metadata: { request: true, reportCount: record.versions.length },
      requireEligible: false,
    })

    return this.toDetail(
      { ...(await this.requirePlatformBatch(batchId)), batch },
      await this.evaluate(record, false),
    )
  }

  async recordGenerationFailure(
    batchId: string,
    schoolId: string,
    reason: string,
    audit: ReportReleaseAuditContext,
  ): Promise<void> {
    await this.repository.recordFailedAttempt({
      batchId,
      schoolId,
      actor: audit,
      action: 'REPORT_GENERATION_FAILED',
      reason,
    })
  }

  async returnBatch(
    actor: PlatformReportActor,
    batchId: string,
    reason: string,
    audit: ReportReleaseAuditContext,
  ): Promise<ReportReleaseBatchDetail> {
    const record = await this.requirePlatformBatch(batchId)
    const normalizedReason = requireReason(reason)

    if (
      record.batch.releaseStatus !== 'PENDING_PLATFORM_REVIEW' &&
      record.batch.releaseStatus !== 'APPROVED'
    ) {
      throw new HttpError(
        409,
        'Only a pending or approved batch can be returned for correction.',
      )
    }

    const batch = await this.repository.transition({
      batchId,
      schoolId: null,
      expected: ['PENDING_PLATFORM_REVIEW', 'APPROVED'],
      next: 'RETURNED',
      actor: audit,
      action: 'REPORT_RELEASE_RETURNED',
      reason: normalizedReason,
      set: {
        reviewedAt: new Date(),
        reviewedByUserId: actor.userId,
        returnedReason: normalizedReason,
        previousReleaseStatus: null,
      },
      metadata: { reportCount: record.versions.length },
    })

    return this.toDetail(
      { ...(await this.requirePlatformBatch(batchId)), batch },
      await this.evaluate(record, false),
    )
  }

  async hold(
    actor: PlatformReportActor,
    batchId: string,
    reason: string,
    audit: ReportReleaseAuditContext,
  ): Promise<ReportReleaseBatchDetail> {
    const record = await this.requirePlatformBatch(batchId)
    const normalizedReason = requireReason(reason)
    const current = record.batch.releaseStatus

    if (current === 'RELEASED') {
      throw new HttpError(409, 'A released batch cannot be placed on hold.')
    }

    if (current === 'ON_HOLD') {
      throw new HttpError(409, 'This batch is already on hold.')
    }

    const batch = await this.repository.transition({
      batchId,
      schoolId: null,
      expected: ['GENERATED', 'PENDING_PLATFORM_REVIEW', 'RETURNED', 'APPROVED'],
      next: 'ON_HOLD',
      actor: audit,
      action: 'REPORT_RELEASE_HELD',
      reason: normalizedReason,
      set: {
        previousReleaseStatus: current,
        holdReason: normalizedReason,
        heldAt: new Date(),
        heldByUserId: actor.userId,
      },
      metadata: { previousStatus: current, reportCount: record.versions.length },
    })

    return this.toDetail(
      { ...(await this.requirePlatformBatch(batchId)), batch },
      await this.evaluate(record, false),
    )
  }

  async unhold(
    batchId: string,
    audit: ReportReleaseAuditContext,
  ): Promise<ReportReleaseBatchDetail> {
    const record = await this.requirePlatformBatch(batchId)

    if (record.batch.releaseStatus !== 'ON_HOLD') {
      throw new HttpError(409, 'This batch is not on hold.')
    }

    const previous = record.batch.previousReleaseStatus

    if (!previous || previous === 'ON_HOLD' || previous === 'RELEASED') {
      throw new HttpError(
        409,
        'The previous release state cannot be restored automatically.',
      )
    }

    const batch = await this.repository.transition({
      batchId,
      schoolId: null,
      expected: ['ON_HOLD'],
      next: previous,
      actor: audit,
      action: 'REPORT_RELEASE_HOLD_REMOVED',
      set: {
        previousReleaseStatus: null,
        holdReason: null,
        heldAt: null,
        heldByUserId: null,
      },
      metadata: { restoredStatus: previous, reportCount: record.versions.length },
    })

    return this.toDetail(
      { ...(await this.requirePlatformBatch(batchId)), batch },
      await this.evaluate(record, false),
    )
  }

  async release(
    actor: PlatformReportActor,
    batchId: string,
    audit: ReportReleaseAuditContext,
  ): Promise<ReportReleaseBatchDetail> {
    const record = await this.requirePlatformBatch(batchId)

    if (record.batch.releaseStatus !== 'APPROVED') {
      throw new HttpError(
        409,
        'Only an approved batch can be released.',
      )
    }

    const eligibility = await this.evaluate(record, true)

    if (!eligibility.eligible) {
      await this.repository.recordFailedAttempt({
        batchId,
        schoolId: record.batch.schoolId,
        actor: audit,
        action: 'REPORT_RELEASE_FAILED',
        reason: reasonForIssues(eligibility.issues),
        metadata: { issues: eligibility.issues },
      })

      throw new HttpError(
        409,
        'This report batch cannot be released because it is no longer eligible.',
        { issues: eligibility.issues },
      )
    }

    try {
      const batch = await this.repository.transition({
        batchId,
        schoolId: null,
        expected: ['APPROVED'],
        next: 'RELEASED',
        actor: audit,
        action: 'REPORT_RELEASE_RELEASED',
        set: {
          releasedAt: new Date(),
          releasedByUserId: actor.userId,
        },
        metadata: {
          invoiceId: record.invoice?.id ?? null,
          invoiceStatus: record.invoice?.status ?? null,
          reportCount: record.versions.length,
        },
        requireEligible: true,
      })

      return this.toDetail(
        { ...(await this.requirePlatformBatch(batchId)), batch },
        eligibility,
      )
    } catch (error) {
      await this.repository
        .recordFailedAttempt({
          batchId,
          schoolId: record.batch.schoolId,
          actor: audit,
          action: 'REPORT_RELEASE_FAILED',
          reason:
            error instanceof HttpError
              ? error.message
              : 'Concurrent release check failed',
          metadata: {
            issues:
              error instanceof HttpError && isRecord(error.details)
                ? error.details.issues
                : undefined,
          },
        })
        .catch(() => undefined)

      throw error
    }
  }

  async previewPlatformVersion(
    batchId: string,
    versionId: string,
  ): Promise<PlatformReportPreview> {
    const preview = await this.repository.getPreview(batchId, versionId)

    if (!preview) {
      throw new HttpError(404, 'Report preview is not available.')
    }

    const data = await this.storage.getObject(preview.storageKey)

    if (!data) {
      throw new HttpError(
        404,
        'The stored report PDF is missing from private storage.',
      )
    }

    if (data.length !== preview.byteSize || sha256(data) !== preview.checksum) {
      throw new HttpError(
        409,
        'The stored report PDF failed integrity verification.',
      )
    }

    return {
      data,
      fileName: preview.fileName,
      checksum: preview.checksum,
    }
  }

  private assertSchoolAdmin(actor: ReportReleaseActor): void {
    if (actor.role !== 'SCHOOL_ADMIN') {
      throw new HttpError(
        403,
        'Only a school administrator may submit reports for platform review.',
      )
    }
  }

  private async requireSchoolBatch(
    actor: ReportReleaseActor,
    batchId: string,
  ): Promise<ReportReleaseBatchRecord> {
    const record = await this.repository.getSchoolBatch(actor, batchId)

    if (!record) {
      throw new HttpError(404, 'Report generation batch not found')
    }

    return record
  }

  private async requirePlatformBatch(
    batchId: string,
  ): Promise<ReportReleaseBatchRecord> {
    const record = await this.repository.getPlatformBatch(batchId)

    if (!record) {
      throw new HttpError(404, 'Report generation batch not found')
    }

    return record
  }

  private async evaluate(
    record: ReportReleaseBatchRecord,
    checkFiles: boolean,
  ): Promise<ReportReleaseEligibility> {
    const issues: ReportReleaseEligibilityIssue[] = []
    const batch = record.batch

    const add = (code: string, message: string) => {
      if (!issues.some((issue) => issue.code === code)) {
        issues.push({ code, message })
      }
    }

    if (!record.schoolIsActive) {
      add(
        'SCHOOL_INACTIVE',
        'The school is inactive and cannot release reports.',
      )
    }

    if (
      record.academicYearSchoolId !== batch.schoolId ||
      record.academicTermSchoolId !== batch.schoolId ||
      record.academicTermYearId !== batch.academicYearId
    ) {
      add(
        'YEAR_TERM_INVALID',
        'The academic year and term do not belong to this school and batch.',
      )
    }

    if (batch.status !== 'COMPLETED') {
      add(
        'GENERATION_INCOMPLETE',
        'Report generation has not completed successfully for this batch.',
      )
    }

    if (batch.failedCount > 0) {
      add(
        'GENERATION_FAILURES',
        'Some reports in this batch failed to generate.',
      )
    }

    if (batch.skippedCount > 0) {
      add(
        'GENERATION_SKIPPED',
        'This batch reused existing report versions that are not attached to the batch. Generate a fresh batch before submitting it for release.',
      )
    }

    if (batch.generatedCount <= 0 || record.versions.length === 0) {
      add(
        'NO_GENERATED_REPORTS',
        'This batch has no generated report files to release.',
      )
    }

    for (const version of record.versions) {
      if (
        version.schoolId !== batch.schoolId ||
        version.reportCardSchoolId !== batch.schoolId ||
        version.academicYearId !== batch.academicYearId ||
        version.academicTermId !== batch.academicTermId ||
        (batch.classId !== null && version.classId !== batch.classId)
      ) {
        add(
          'REPORT_SCOPE_INVALID',
          'A report in this batch does not belong to the expected school, year, term or class.',
        )
        continue
      }

      if (
        snapshotAcceptedCount(version.snapshot) <= 0 ||
        snapshotSubjectCount(version.snapshot) <= 0
      ) {
        add(
          'RESULTS_NOT_ACCEPTED',
          'A report in this batch was not built from accepted assessment results.',
        )
      }

      if (!checkFiles) {
        continue
      }

      let data: Buffer | null

      try {
        data = await this.storage.getObject(version.storageKey)
      } catch {
        data = null
      }

      if (!data) {
        add(
          'REPORT_FILE_MISSING',
          'A generated report file is missing from private storage.',
        )
        continue
      }

      if (data.length !== version.byteSize || sha256(data) !== version.checksum) {
        add(
          'REPORT_INTEGRITY_FAILED',
          'A generated report file failed integrity verification.',
        )
      }
    }

    return { eligible: issues.length === 0, issues }
  }

  private toSummary(
    record: ReportReleaseBatchRecord,
    eligibility: ReportReleaseEligibility,
  ): ReportReleaseBatchSummary {
    const batch = record.batch
    const failureCodes = [...new Set(record.failures.map((failure) => failure.code))]
    // Only a rendering, storage or persistence error is safe to retry. An
    // eligibility failure is resolved by correcting records and regenerating.
    const retryableFailureCount = record.failures.filter(
      (failure) =>
        failure.code === 'GENERATION_FAILED' && failure.pupilId !== null,
    ).length

    return {
      id: batch.id,
      schoolId: batch.schoolId,
      schoolName: record.schoolName,
      academicYearId: batch.academicYearId,
      academicYearName: record.academicYearName,
      academicTermId: batch.academicTermId,
      academicTermName: record.academicTermName,
      classId: batch.classId,
      className: record.className,
      scope: batch.scope,
      generationStatus: batch.status,
      requestedPupilCount: batch.requestedPupilCount,
      generatedCount: batch.generatedCount,
      skippedCount: batch.skippedCount,
      failedCount: batch.failedCount,
      reportCount: record.versions.length,
      fatalError: batch.fatalError,
      failureCodes,
      retryableFailureCount,
      releaseStatus: batch.releaseStatus,
      previousReleaseStatus: batch.previousReleaseStatus,
      submittedAt: batch.submittedAt,
      submittedByName: record.submittedByName,
      reviewedAt: batch.reviewedAt,
      reviewedByName: record.reviewedByName,
      returnedReason: batch.returnedReason,
      holdReason: batch.holdReason,
      heldAt: batch.heldAt,
      heldByName: record.heldByName,
      releasedAt: batch.releasedAt,
      releasedByName: record.releasedByName,
      invoice: record.invoice
        ? {
            id: record.invoice.id,
            invoiceNumber: record.invoice.invoiceNumber,
            status: record.invoice.status,
            currency: record.invoice.currency,
            totalMinor: record.invoice.totalMinor,
            paidMinor: record.invoice.paidMinor,
            outstandingMinor: record.invoice.outstandingMinor,
          }
        : null,
      eligibility,
      createdAt: batch.createdAt,
      completedAt: batch.completedAt,
    }
  }

  private toDetail(
    record: ReportReleaseBatchRecord,
    eligibility: ReportReleaseEligibility,
  ): ReportReleaseBatchDetail {
    return {
      ...this.toSummary(record, eligibility),
      versions: record.versions.map((version) => ({
        id: version.id,
        reportCardId: version.reportCardId,
        pupilId: version.pupilId,
        pupilName: version.pupilName,
        admissionNumber: version.admissionNumber,
        version: version.version,
        generatedAt: version.generatedAt,
        releaseStatus: record.batch.releaseStatus,
      })),
      failures: record.failures.map((failure) => ({
        pupilId: failure.pupilId,
        pupilName: failure.pupilName,
        code: failure.code,
        message: failure.message,
      })),
    }
  }
}
