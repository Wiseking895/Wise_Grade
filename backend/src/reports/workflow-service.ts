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
 * Report-generation workflow.
 *
 * Academic acceptance happens in the school assessment workspace and belongs to
 * the school administrator. A school administrator then submits one term-wide
 * generation request. The platform super administrator has a single operational
 * action for an accepted request: Generate Reports. Generation consumes only
 * accepted results and the completed batch is made available automatically, so
 * there is no separate platform approval or manual release step. Payment is not
 * part of this orchestration; billing services and historical rows are untouched.
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
   * The developer's only operational action for an accepted request.
   *
   * A request created from accepted results is already APPROVED for generation.
   * Legacy requests queued in PENDING_PLATFORM_REVIEW are normalised
   * automatically as part of this action; the developer never performs a second
   * academic approval. The generated batch is made available to the school as
   * soon as every required report succeeds.
   */
  async generate(
    actor: PlatformReportActor,
    batchId: string,
    audit: ReportReleaseAuditContext,
  ): Promise<ReportRequestActionResult> {
    let detail = await this.releases.getPlatformBatch(batchId)

    if (detail.generationStatus === 'RUNNING') {
      throw new HttpError(
        409,
        'Report generation is already running for this request.',
      )
    }

    if (detail.releaseStatus === 'RELEASED') {
      throw new HttpError(
        409,
        'Reports have already been generated and made available.',
      )
    }

    if (detail.releaseStatus === 'ON_HOLD') {
      throw new HttpError(
        409,
        'This request is on hold and cannot be generated.',
      )
    }

    // Older requests were queued for platform review before academic acceptance
    // moved to the school administrator. They were created only after accepted
    // results existed, so normalise them without asking the developer to approve
    // academic scores again.
    if (detail.releaseStatus === 'PENDING_PLATFORM_REVIEW') {
      detail = await this.releases.approveRequest(actor, batchId, audit)
    }

    if (detail.releaseStatus !== 'APPROVED') {
      throw new HttpError(
        409,
        'This request is not eligible for report generation. Academic results must be accepted by the school administrator first.',
      )
    }

    return this.generateAndRelease(actor, detail, audit, false)
  }

  /**
   * Retries only the pupils that failed. Successful versions are never
   * regenerated or duplicated.
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
        'Only an accepted request with pending generation can be retried.',
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
    // workflow existed. It only needs the automatic release step.
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

      // A fully consolidated request is a successful no-op, not a generation
      // failure: every pupil already has a released final report.
      const alreadyConsolidated =
        error instanceof HttpError &&
        typeof error.details === 'object' &&
        error.details !== null &&
        (error.details as Record<string, unknown>).code ===
          'ALREADY_CONSOLIDATED'

      if (!alreadyConsolidated) {
        await this.releases
          .recordGenerationFailure(detail.id, detail.schoolId, message, audit)
          .catch(() => undefined)
      }

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
