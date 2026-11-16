import { HttpError } from '../errors/http-error.js'
import type {
  PlatformReportActor,
  ReportReleaseActor,
  ReportReleaseAuditContext,
  ReportReleaseBatchFilter,
} from './release-repository.js'
import {
  ReportReleaseService,
  type ReportReleaseBatchDetail,
  type ReportReleaseBatchSummary,
} from './release-service.js'
import type {
  GenerateReportsResult,
  GenerationItemResult,
  ReportRequestClassSummary,
  ReportRequestResult,
} from './service.js'
import { ReportService } from './service.js'
import type {
  ReportActor,
  ReportAuditContext,
  ReportBatchDetail,
} from './repository.js'

export interface ReportRequestDetail extends ReportReleaseBatchDetail {
  classes: ReportRequestClassSummary[]
}

export interface ReportRequestActionResult {
  batch: ReportRequestDetail
  results: GenerationItemResult[]
}

export interface ReportRequestWorkflowOptions {
  reports: ReportService
  releases: ReportReleaseService
}

/**
 * Temporary Term 1 report workflow.
 *
 * Academic acceptance remains in the assessment workspace. A school
 * administrator then submits one term-wide request. A platform super
 * administrator approves it, which generates every eligible class and releases
 * the completed batch to the school. Payment and invoicing are deliberately not
 * part of this orchestration; the billing services and historical rows remain
 * untouched.
 */
export class ReportWorkflowService {
  private readonly reports: ReportService
  private readonly releases: ReportReleaseService

  constructor(options: ReportRequestWorkflowOptions) {
    this.reports = options.reports
    this.releases = options.releases
  }

  async submitRequest(
    actor: ReportReleaseActor,
    input: { academicYearId: string; academicTermId: string },
    audit: ReportAuditContext,
  ): Promise<ReportRequestResult> {
    return this.reports.createRequest(actor, input, audit)
  }

  async listSchoolRequests(
    actor: ReportReleaseActor,
    filter: { academicTermId?: string },
  ): Promise<ReportReleaseBatchSummary[]> {
    return this.releases.listSchoolBatches(actor, filter)
  }

  async getSchoolRequest(
    actor: ReportReleaseActor,
    batchId: string,
  ): Promise<{
    batch: ReportBatchDetail
    classes: ReportRequestClassSummary[]
  }> {
    if (actor.role !== 'SCHOOL_ADMIN') {
      throw new HttpError(
        403,
        'Only a school administrator may view report-generation requests.',
      )
    }

    return this.reports.getRequest(actor, batchId)
  }

  async listPlatformRequests(
    filter: ReportReleaseBatchFilter,
  ): Promise<ReportReleaseBatchSummary[]> {
    return this.releases.listPlatformBatches(filter)
  }

  async getPlatformRequest(batchId: string): Promise<ReportRequestDetail> {
    const detail = await this.releases.getPlatformBatch(batchId)
    return this.withClasses(detail)
  }

  /**
   * One platform approval action: validate, audit the approval, generate every
   * eligible class into the same request batch, then release the batch only when
   * every required report succeeded.
   */
  async approve(
    actor: PlatformReportActor,
    batchId: string,
    audit: ReportReleaseAuditContext,
  ): Promise<ReportRequestActionResult> {
    const approved = await this.releases.approveRequest(actor, batchId, audit)

    if (approved.releaseStatus === 'RELEASED') {
      throw new HttpError(409, 'This request has already been released.')
    }

    return this.generateAndRelease(actor, approved, audit, false)
  }

  async reject(
    actor: PlatformReportActor,
    batchId: string,
    reason: string,
    audit: ReportReleaseAuditContext,
  ): Promise<ReportRequestDetail> {
    const rejected = await this.releases.rejectRequest(
      actor,
      batchId,
      reason,
      audit,
    )

    return this.withClasses(rejected)
  }

  /**
   * Retries only the pupils that failed. Initial generation failures are retried
   * as a full run because the batch has no linked versions yet. Successful
   * versions are never regenerated or duplicated.
   */
  async retry(
    actor: PlatformReportActor,
    batchId: string,
    audit: ReportReleaseAuditContext,
  ): Promise<ReportRequestActionResult> {
    const detail = await this.releases.getPlatformBatch(batchId)

    if (detail.releaseStatus !== 'APPROVED') {
      throw new HttpError(
        409,
        'Only an approved request with pending generation can be retried.',
      )
    }

    if (detail.generationStatus === 'COMPLETED') {
      throw new HttpError(
        409,
        'This request has already generated every required report.',
      )
    }

    return this.generateAndRelease(actor, detail, audit, true)
  }

  private async generateAndRelease(
    actor: PlatformReportActor,
    detail: ReportReleaseBatchDetail,
    audit: ReportReleaseAuditContext,
    retry: boolean,
  ): Promise<ReportRequestActionResult> {
    // A legacy batch may already have been generated before the request
    // workflow existed. Approval then only needs the release step.
    if (detail.generationStatus === 'COMPLETED' && detail.reportCount > 0) {
      const released = await this.releases.release(actor, detail.id, audit)
      return {
        batch: await this.withClasses(released),
        results: [],
      }
    }

    const reportAudit: ReportAuditContext = {
      actorUserId: audit.actorUserId,
      actorMembershipId: audit.actorMembershipId,
      ipAddress: audit.ipAddress ?? null,
      userAgent: audit.userAgent ?? null,
    }

    // Batch events are written with the real platform user id. A placeholder
    // id would fail the UUID foreign-key check in PostgreSQL.
    const reportActor: ReportActor = {
      schoolId: detail.schoolId,
      userId: audit.actorUserId,
      membershipId: audit.actorMembershipId ?? null,
      role: 'PLATFORM_SUPER_ADMIN',
    }

    let generated: GenerateReportsResult

    try {
      generated = await this.reports.generateIntoBatch(
        reportActor,
        detail.id,
        reportAudit,
        { retry },
      )
    } catch (error) {
      const message =
        error instanceof HttpError
          ? error.message
          : 'Automatic report generation failed.'

      // A 409 means another run owns this request or the request is not in a
      // retryable state. Marking it FAILED here would corrupt a concurrent run,
      // so only genuine generation errors move the batch to a terminal state.
      if (!(error instanceof HttpError && error.statusCode === 409)) {
        await this.reports
          .failBatch(reportActor, detail.id, message)
          .catch(() => undefined)
      }

      await this.releases
        .recordGenerationFailure(detail.id, detail.schoolId, message, audit)
        .catch(() => undefined)
      throw error
    }

    if (generated.batch.status === 'COMPLETED') {
      const released = await this.releases.release(actor, detail.id, audit)
      return {
        batch: await this.withClasses(released),
        results: generated.results,
      }
    }

    const current = await this.releases.getPlatformBatch(detail.id)
    return {
      batch: await this.withClasses(current),
      results: generated.results,
    }
  }

  private async withClasses(
    detail: ReportReleaseBatchDetail,
  ): Promise<ReportRequestDetail> {
    try {
      const { classes } = await this.reports.getRequest(
        this.platformActor(detail.schoolId),
        detail.id,
      )

      return { ...detail, classes }
    } catch (error) {
      // The release repository and the report repository are the same database
      // in production. Unit tests may seed only one of them.
      if (error instanceof HttpError && error.statusCode === 404) {
        return { ...detail, classes: [] }
      }

      throw error
    }
  }

  private platformActor(schoolId: string): ReportActor {
    return {
      schoolId,
      userId: 'platform-report-workflow',
      membershipId: null,
      role: 'PLATFORM_SUPER_ADMIN',
    }
  }
}
