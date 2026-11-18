import { randomUUID } from 'node:crypto'
import { PDFDocument } from 'pdf-lib'
import { HttpError } from '../errors/http-error.js'
import {
  sha256,
  type StorageAdapter,
} from '../storage/storage.js'
import { missingSchoolIdentityFields } from '../lib/school-branding.js'
import {
  renderReportPdf,
  type ReportPdfAssets,
  type ReportPdfOptions,
  type ReportPdfResult,
} from './pdf.js'
import type {
  ReportActor,
  ReportAssetRecord,
  ReportAuditContext,
  ReportBatchDetail,
  ReportBatchRecord,
  ReportCardRecord,
  ReportClassRecord,
  ReportGenerationData,
  ReportGenerationScope,
  ReportInputRecord,
  ReportInputUpsert,
  ReportRepository,
  ReportSettingsInput,
  ReportSettingsRecord,
  PublicReportSettings,
  ReportVersionSummary,
  StoredObject,
} from './repository.js'
import {
  buildReportSet,
  type EligibilityFailure,
  type ReportSnapshot,
} from './snapshot.js'

export interface UploadReportAssetInput {
  kind: 'EMBLEM' | 'CREST' | 'SIGNATURE'
  mimeType: string
  originalName: string
  base64: string
}

export interface GenerateReportsInput {
  academicYearId: string
  academicTermId: string
  classId?: string | null
  pupilIds?: string[]
  scope: ReportGenerationScope
}

export type GenerationOutcome = 'GENERATED' | 'SKIPPED' | 'FAILED'

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
  batch: ReportBatchRecord
  results: GenerationItemResult[]
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

export interface ReportRequestResult {
  batch: ReportBatchRecord
  classes: ReportRequestClassSummary[]
}

export interface ReportPreviewResult {
  data: Buffer
  pageCount: number
  fileName: string
  checksum: string
}

export interface ReportServiceOptions {
  repository: ReportRepository
  storage: StorageAdapter
  renderPdf?: (
    snapshot: ReportSnapshot,
    assets?: ReportPdfAssets,
    options?: ReportPdfOptions,
  ) => Promise<ReportPdfResult>
}

const ALLOWED_ASSET_MIME_TYPES = new Set(['image/png', 'image/jpeg'])
const MAX_ASSET_BYTES = 512 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fullName(pupil: {
  firstName: string
  lastName: string
  otherNames: string | null
}): string {
  return [pupil.firstName, pupil.lastName, pupil.otherNames]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isSnapshot(value: unknown): value is ReportSnapshot {
  return (
    isRecord(value) &&
    isRecord(value.school) &&
    isRecord(value.pupil) &&
    isRecord(value.academic) &&
    typeof value.draftLabel === 'string' &&
    Array.isArray(value.academic.subjects)
  )
}

function safeFailureMessage(error: unknown): string {
  if (error instanceof HttpError) {
    return error.message
  }

  if (error instanceof Error && error.message.trim() !== '') {
    return error.message.slice(0, 1000)
  }

  return 'Report generation failed'
}

/**
 * Phase 5 report orchestration.
 *
 * The service never recalculates assessment results. It consumes the accepted
 * result snapshots through `buildReportSet`, produces an immutable JSON snapshot,
 * renders the PDF, writes the bytes through the private storage adapter, and
 * records the version. A generation run is not a release: stored artifacts keep
 * the INTERNAL DRAFT label. Once a platform administrator releases a batch,
 * preview and download re-render the same snapshot with the released label.
 */
export class ReportService {
  private readonly repository: ReportRepository
  private readonly storage: StorageAdapter
  private readonly renderPdf: NonNullable<ReportServiceOptions['renderPdf']>

  constructor(options: ReportServiceOptions) {
    this.repository = options.repository
    this.storage = options.storage
    this.renderPdf = options.renderPdf ?? renderReportPdf
  }

  async getSettings(
    actor: ReportActor,
    academicTermId: string,
  ): Promise<PublicReportSettings | null> {
    const settings = await this.repository.getSettings(actor, academicTermId)

    return settings ? this.publicSettings(actor, settings) : null
  }

  async updateSettings(
    actor: ReportActor,
    input: ReportSettingsInput,
    audit: ReportAuditContext,
  ): Promise<PublicReportSettings> {
    const resolved: ReportSettingsInput = { ...input }
    const bindings = [
      {
        kind: 'EMBLEM',
        assetId: input.emblemAssetId,
        field: 'emblemObjectKey',
      },
      {
        kind: 'CREST',
        assetId: input.crestAssetId,
        field: 'crestObjectKey',
      },
      {
        kind: 'SIGNATURE',
        assetId: input.signatureAssetId,
        field: 'signatureObjectKey',
      },
    ] as const

    for (const binding of bindings) {
      if (binding.assetId === undefined) {
        continue
      }

      if (binding.assetId === null) {
        resolved[binding.field] = null
        continue
      }

      const asset = await this.repository.getAsset(actor, binding.assetId)

      if (!asset || asset.kind !== binding.kind) {
        throw new HttpError(400, 'Selected branding asset was not found')
      }

      resolved[binding.field] = asset.storageKey
    }

    const schoolPrefix = `schools/${actor.schoolId}/`

    for (const key of [
      resolved.emblemObjectKey,
      resolved.crestObjectKey,
      resolved.signatureObjectKey,
    ]) {
      if (key === undefined || key === null) {
        continue
      }

      if (!key.startsWith(schoolPrefix)) {
        throw new HttpError(
          400,
          'Branding assets must belong to the current school',
        )
      }
    }

    const saved = await this.repository.updateSettings(actor, resolved, audit)

    return this.publicSettings(actor, saved)
  }

  /**
   * Converts internal settings (which store private object keys) into the
   * client-facing shape. Branding is referenced by asset id only.
   */
  private async publicSettings(
    actor: ReportActor,
    settings: ReportSettingsRecord,
  ): Promise<PublicReportSettings> {
    const assets = await this.repository.listAssets(actor)
    const assetIdByKey = new Map(
      assets.map((asset) => [asset.storageKey, asset.id]),
    )
    const assetIdFor = (key: string | null) =>
      key ? (assetIdByKey.get(key) ?? null) : null

    return {
      id: settings.id,
      schoolId: settings.schoolId,
      academicYearId: settings.academicYearId,
      academicTermId: settings.academicTermId,
      emblemAssetId: assetIdFor(settings.emblemObjectKey),
      crestAssetId: assetIdFor(settings.crestObjectKey),
      signatureAssetId: assetIdFor(settings.signatureObjectKey),
      headteacherLabel: settings.headteacherLabel,
      rankingEnabled: settings.rankingEnabled,
      tiePolicy: settings.tiePolicy,
      aggregatePolicy: settings.aggregatePolicy,
      attendanceRequired: settings.attendanceRequired,
      closingDate: settings.closingDate,
      reopeningDate: settings.reopeningDate,
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
    }
  }

  async listAssets(actor: ReportActor): Promise<ReportAssetRecord[]> {
    return this.repository.listAssets(actor)
  }

  async uploadAsset(
    actor: ReportActor,
    input: UploadReportAssetInput,
    audit: ReportAuditContext,
  ): Promise<ReportAssetRecord> {
    if (!ALLOWED_ASSET_MIME_TYPES.has(input.mimeType)) {
      throw new HttpError(
        400,
        'Branding assets must be PNG or JPEG images',
      )
    }

    const data = Buffer.from(input.base64, 'base64')

    if (data.length === 0) {
      throw new HttpError(400, 'The uploaded image is empty')
    }

    if (data.length > MAX_ASSET_BYTES) {
      throw new HttpError(
        400,
        'Branding images must be 512 KB or smaller',
      )
    }

    const extension = input.mimeType === 'image/png' ? 'png' : 'jpg'
    const storageKey = `schools/${actor.schoolId}/report-assets/${input.kind.toLowerCase()}/${randomUUID()}.${extension}`

    await this.storage.putObject(storageKey, data, input.mimeType)

    try {
      return await this.repository.uploadAsset(
        actor,
        {
          kind: input.kind,
          storageKey,
          mimeType: input.mimeType,
          byteSize: data.length,
          checksum: sha256(data),
          originalName: input.originalName.slice(0, 255),
        },
        audit,
      )
    } catch (error) {
      await this.storage.deleteObject(storageKey).catch(() => undefined)
      throw error
    }
  }

  async getAssetBytes(
    actor: ReportActor,
    assetId: string,
  ): Promise<StoredObject> {
    const asset = await this.repository.getAsset(actor, assetId)

    if (!asset) {
      throw new HttpError(404, 'Report asset not found')
    }

    const data = await this.storage.getObject(asset.storageKey)

    if (!data) {
      throw new HttpError(404, 'Report asset file is missing from private storage')
    }

    if (sha256(data) !== asset.checksum) {
      throw new HttpError(500, 'Report asset failed integrity verification')
    }

    return {
      data,
      mimeType: asset.mimeType,
      fileName: asset.originalName,
      checksum: asset.checksum,
    }
  }

  async listInputs(
    actor: ReportActor,
    filter: { academicTermId: string; classId: string },
  ): Promise<ReportInputRecord[]> {
    this.assertRecordsReader(actor)
    await this.assertRecordsClassReadable(actor, filter.classId)
    return this.repository.listInputs(actor, filter)
  }

  async upsertInput(
    actor: ReportActor,
    input: ReportInputUpsert,
    audit: ReportAuditContext,
  ): Promise<ReportInputRecord> {
    if (actor.role !== 'CLASS_TEACHER') {
      throw new HttpError(
        403,
        'Only the assigned class teacher may edit report inputs for this class',
      )
    }

    const assigned = await this.repository.hasClassTeacherAssignment(
      actor,
      input.classId,
    )

    if (!assigned) {
      throw new HttpError(
        403,
        'Only the assigned class teacher may edit report inputs for this class',
      )
    }

    return this.repository.upsertInput(actor, input, audit)
  }

  async listClasses(
    actor: ReportActor,
    academicYearId: string,
    academicTermId: string,
  ): Promise<ReportClassRecord[]> {
    const classes = await this.repository.listClassesForTerm(
      actor,
      academicYearId,
      academicTermId,
    )
    const accessible = await this.repository.listAccessibleClassIds(actor)

    if (accessible === null) {
      return classes
    }

    const allowed = new Set(accessible)
    return classes.filter((item) => allowed.has(item.id))
  }

  async checkEligibility(
    actor: ReportActor,
    input: { academicYearId: string; academicTermId: string; classId: string },
  ): Promise<ReportEligibilityResult> {
    this.assertRecordsReader(actor)
    await this.assertRecordsClassReadable(actor, input.classId)
    const data = await this.repository.loadGenerationData(actor, input)
    const built = buildReportSet(data)

    return {
      className: data.class.name,
      onRoll: data.onRoll,
      eligibleCount: built.eligibleCount,
      pupils: built.builds.map((build) => ({
        pupilId: build.pupil.id,
        pupilName: fullName(build.pupil),
        eligible: build.eligible,
        acceptedResultCount: build.snapshot?.source.acceptedSubmissions ?? 0,
        failure: build.failure,
      })),
    }
  }

  async generate(
    actor: ReportActor,
    input: GenerateReportsInput,
    audit: ReportAuditContext,
  ): Promise<GenerateReportsResult> {
    if (input.scope === 'TERM' && input.classId) {
      throw new HttpError(
        400,
        'A term-wide generation run must not target a single class',
      )
    }

    if (input.scope !== 'TERM' && !input.classId) {
      throw new HttpError(400, 'A class is required for this generation run')
    }

    const classIds =
      input.scope === 'TERM'
        ? (
            await this.repository.listClassesForTerm(
              actor,
              input.academicYearId,
              input.academicTermId,
            )
          ).map((item) => item.id)
        : [input.classId!]

    if (classIds.length === 0) {
      throw new HttpError(
        400,
        'No classes with active pupil enrollments were found for this term',
      )
    }

    const datasets: ReportGenerationData[] = []

    for (const classId of classIds) {
      datasets.push(
        await this.repository.loadGenerationData(actor, {
          academicYearId: input.academicYearId,
          academicTermId: input.academicTermId,
          classId,
        }),
      )
    }

    // A report is a formal school document. New generations are blocked until
    // the school has supplied the identity details printed on it. Historical
    // snapshots remain downloadable because this guard runs only on generate.
    this.assertSchoolIdentityComplete(datasets[0]!.school)

    const allBuilds = datasets.flatMap((data) =>
      buildReportSet(data).builds.map((build) => ({ data, build })),
    )
    let targets = allBuilds

    if (input.pupilIds && input.pupilIds.length > 0) {
      const requested = new Set(input.pupilIds)
      const available = new Set(allBuilds.map((item) => item.build.pupil.id))

      for (const pupilId of requested) {
        if (!available.has(pupilId)) {
          throw new HttpError(
            400,
            'One or more selected pupils are not actively enrolled in the target class or term',
          )
        }
      }

      targets = allBuilds.filter((item) => requested.has(item.build.pupil.id))
    }

    if (targets.length === 0) {
      throw new HttpError(
        400,
        'There are no pupils to generate reports for in the selected scope',
      )
    }

    const batch = await this.repository.createBatch(
      actor,
      {
        academicYearId: input.academicYearId,
        academicTermId: input.academicTermId,
        classId: input.scope === 'TERM' ? null : input.classId!,
        scope: input.scope,
        requestedPupilCount: targets.length,
      },
      audit,
    )

    await this.repository.markBatchRunning(actor, batch.id)

    const results: GenerationItemResult[] = []
    let generatedCount = 0
    let skippedCount = 0
    let failedCount = 0

    for (const { data, build } of targets) {
      const pupilName = fullName(build.pupil)

      if (!build.eligible || !build.snapshot) {
        const failure = build.failure ?? {
          code: 'RESULTS_INCOMPLETE',
          message: 'Required accepted results are incomplete.',
        }

        await this.repository.recordFailure(actor, {
          batchId: batch.id,
          academicYearId: input.academicYearId,
          academicTermId: input.academicTermId,
          classId: data.class.id,
          pupilId: build.pupil.id,
          code: failure.code,
          message: failure.message,
        })

        failedCount += 1
        results.push({
          pupilId: build.pupil.id,
          pupilName,
          classId: data.class.id,
          status: 'FAILED',
          version: null,
          failureCode: failure.code,
          failureMessage: failure.message,
        })
        continue
      }

      try {
        const skipped = await this.canSkipGeneration(
          actor,
          input.academicTermId,
          build.snapshot,
          build.pupil.id,
        )

        if (skipped !== null) {
          skippedCount += 1
          results.push({
            pupilId: build.pupil.id,
            pupilName,
            classId: data.class.id,
            status: 'SKIPPED',
            version: skipped,
            failureCode: null,
            failureMessage: null,
          })
          continue
        }

        const versionId = randomUUID()
        const assets = await this.loadAssets(build.snapshot)
        const pdf = await this.renderPdf(build.snapshot, assets)
        const storageKey = `schools/${actor.schoolId}/reports/${input.academicTermId}/${build.pupil.id}/${versionId}.pdf`

        await this.storage.putObject(storageKey, pdf.data, 'application/pdf')

        try {
          const saved = await this.repository.saveGeneratedReport(
            actor,
            {
              versionId,
              batchId: batch.id,
              academicYearId: input.academicYearId,
              academicTermId: input.academicTermId,
              classId: data.class.id,
              pupilId: build.pupil.id,
              snapshot: build.snapshot,
              storageKey,
              checksum: pdf.checksum,
              byteSize: pdf.byteSize,
              pageCount: pdf.pageCount,
            },
            audit,
          )

          generatedCount += 1
          results.push({
            pupilId: build.pupil.id,
            pupilName,
            classId: data.class.id,
            status: 'GENERATED',
            version: saved.version,
            failureCode: null,
            failureMessage: null,
          })
        } catch (error) {
          await this.storage.deleteObject(storageKey).catch(() => undefined)
          throw error
        }
      } catch (error) {
        const message = safeFailureMessage(error)

        await this.repository
          .recordFailure(actor, {
            batchId: batch.id,
            academicYearId: input.academicYearId,
            academicTermId: input.academicTermId,
            classId: data.class.id,
            pupilId: build.pupil.id,
            code: 'GENERATION_FAILED',
            message,
          })
          .catch(() => undefined)

        failedCount += 1
        results.push({
          pupilId: build.pupil.id,
          pupilName,
          classId: data.class.id,
          status: 'FAILED',
          version: null,
          failureCode: 'GENERATION_FAILED',
          failureMessage: message,
        })
      }
    }

    const status =
      generatedCount + skippedCount === 0 && failedCount > 0
        ? 'FAILED'
        : failedCount > 0
          ? 'COMPLETED_WITH_FAILURES'
          : 'COMPLETED'

    const completed = await this.repository.completeBatch(actor, batch.id, {
      status,
      generatedCount,
      skippedCount,
      failedCount,
    })

    return { batch: completed, results }
  }

  /**
   * Builds a per-class preflight for a term. This is the request-time view the
   * school administrator and platform reviewer see before generation.
   */
  async buildClassSummaries(
    actor: ReportActor,
    academicYearId: string,
    academicTermId: string,
  ): Promise<ReportRequestClassSummary[]> {
    const classes = await this.repository.listClassesForTerm(
      actor,
      academicYearId,
      academicTermId,
    )
    const summaries: ReportRequestClassSummary[] = []

    for (const item of classes) {
      const eligibility = await this.checkEligibility(actor, {
        academicYearId,
        academicTermId,
        classId: item.id,
      })
      const acceptedResultCount = eligibility.pupils.reduce(
        (total, pupil) => total + pupil.acceptedResultCount,
        0,
      )

      summaries.push({
        classId: item.id,
        className: item.name,
        pupilCount: eligibility.pupils.length,
        eligiblePupilCount: eligibility.eligibleCount,
        acceptedResultCount,
        ineligiblePupilCount:
          eligibility.pupils.length - eligibility.eligibleCount,
        generatedCount: 0,
        failedCount: 0,
        status: 'PENDING',
      })
    }

    return summaries
  }

  /**
   * Creates the school's report-generation request. Academic acceptance has
   * already happened in the school workspace; the request is therefore created
   * in the APPROVED state, ready for the platform's single Generate Reports
   * action. No developer approval step exists.
   */
  async createRequest(
    actor: ReportActor,
    input: { academicYearId: string; academicTermId: string },
    audit: ReportAuditContext,
  ): Promise<ReportRequestResult> {
    if (actor.role !== 'SCHOOL_ADMIN') {
      throw new HttpError(
        403,
        'Only a school administrator may submit a report-generation request.',
      )
    }

    const existing = (
      await this.repository.listBatches(actor, {
        academicTermId: input.academicTermId,
        classIds: null,
      })
    ).find(
      (batch) =>
        batch.scope === 'TERM' &&
        (batch.releaseStatus === 'PENDING_PLATFORM_REVIEW' ||
          batch.releaseStatus === 'APPROVED'),
    )

    if (existing) {
      throw new HttpError(
        409,
        'A report-generation request for this term is already awaiting platform generation.',
        { batchId: existing.id },
      )
    }

    const classes = await this.buildClassSummaries(
      actor,
      input.academicYearId,
      input.academicTermId,
    )

    if (classes.length === 0) {
      throw new HttpError(
        400,
        'No classes with active pupil enrollments were found for this term.',
      )
    }

    const eligiblePupilCount = classes.reduce(
      (total, item) => total + item.eligiblePupilCount,
      0,
    )

    if (eligiblePupilCount === 0) {
      throw new HttpError(
        400,
        'No accepted academic results are available for this term. Complete academic review and acceptance before requesting report generation.',
        {
          issues: classes.map((item) => ({
            classId: item.classId,
            className: item.className,
            ineligiblePupilCount: item.ineligiblePupilCount,
          })),
        },
      )
    }

    const batch = await this.repository.createBatch(
      actor,
      {
        academicYearId: input.academicYearId,
        academicTermId: input.academicTermId,
        classId: null,
        scope: 'TERM',
        requestedPupilCount: eligiblePupilCount,
        status: 'PENDING',
        releaseStatus: 'APPROVED',
        submittedAt: new Date(),
        submittedByMembershipId: actor.membershipId,
        auditAction: 'REPORT_REQUEST_SUBMITTED',
      },
      audit,
    )

    return { batch, classes }
  }

  /**
   * Returns a request batch with the current class list. Classes that already
   * produced versions or failures are annotated with those counts; a request
   * that has not run yet uses the live accepted-result preflight.
   */
  async getRequest(
    actor: ReportActor,
    batchId: string,
  ): Promise<{ batch: ReportBatchDetail; classes: ReportRequestClassSummary[] }> {
    const batch = await this.getBatch(actor, batchId)
    const live = await this.buildClassSummaries(
      actor,
      batch.academicYearId,
      batch.academicTermId,
    )

    const generatedByClass = new Map<string, number>()
    const failedByClass = new Map<string, number>()

    for (const version of batch.versions) {
      generatedByClass.set(
        version.classId,
        (generatedByClass.get(version.classId) ?? 0) + 1,
      )
    }

    for (const failure of batch.failures) {
      if (!failure.pupilId) {
        continue
      }

      failedByClass.set(
        failure.classId,
        (failedByClass.get(failure.classId) ?? 0) + 1,
      )
    }

    const classes = live.map((item) => {
      const generatedCount = generatedByClass.get(item.classId) ?? 0
      const failedCount = failedByClass.get(item.classId) ?? 0
      let status: ReportRequestClassSummary['status'] = 'PENDING'

      if (batch.status === 'RUNNING') {
        status = 'RUNNING'
      } else if (failedCount > 0 && generatedCount > 0) {
        status = 'PARTIAL'
      } else if (failedCount > 0) {
        status = 'FAILED'
      } else if (generatedCount > 0) {
        status = 'COMPLETED'
      }

      return {
        ...item,
        generatedCount,
        failedCount,
        status,
      }
    })

    return { batch, classes }
  }

  /**
   * Generates every eligible class into an existing request batch. No report is
   * skipped: a fresh version is always attached to this batch, which guarantees
   * the approved request has linked artifacts and avoids cross-batch reuse.
   */
  async generateIntoBatch(
    actor: ReportActor,
    batchId: string,
    audit: ReportAuditContext,
    options: { retry?: boolean } = {},
  ): Promise<GenerateReportsResult> {
    const batch = await this.getBatch(actor, batchId)

    if (batch.status === 'RUNNING') {
      throw new HttpError(
        409,
        'Report generation is already running for this request.',
      )
    }

    if (options.retry) {
      if (
        batch.status !== 'COMPLETED_WITH_FAILURES' &&
        batch.status !== 'FAILED'
      ) {
        throw new HttpError(
          409,
          'Only a request with failed reports can be retried.',
        )
      }

      const failedPupils = new Set(
        batch.failures
          .map((failure) => failure.pupilId)
          .filter((pupilId): pupilId is string => Boolean(pupilId)),
      )

      if (failedPupils.size === 0) {
        if (batch.status !== 'FAILED') {
          throw new HttpError(
            400,
            'This request has no per-pupil failures that can be retried.',
          )
        }

        // A fatal generation error may occur before any pupil is processed.
        // The batch is marked FAILED, so retry safely falls through to a full
        // rerun of the eligible pupils instead of remaining stuck.
      } else {
        const classIds = [
          ...new Set(batch.failures.map((failure) => failure.classId)),
        ]
        const datasets = await this.loadClassDatasets(
          actor,
          batch.academicYearId,
          batch.academicTermId,
          classIds,
        )

        this.assertSchoolIdentityComplete(datasets[0]!.school)

        const targets = datasets
          .flatMap((data) =>
            buildReportSet(data).builds.map((build) => ({ data, build })),
          )
          .filter((item) => failedPupils.has(item.build.pupil.id))

        if (targets.length === 0) {
          throw new HttpError(
            400,
            'The failed pupils are no longer enrolled in this term.',
          )
        }

        await this.repository.deleteFailures(actor, batchId, [...failedPupils])
        await this.repository.recordBatchEvent(
          actor,
          batchId,
          'REPORT_GENERATION_RETRIED',
          { pupilCount: targets.length },
        )

        return this.runIntoBatch(actor, batch, targets, audit, {
          allowSkip: false,
          previousGenerated: batch.generatedCount,
          previousSkipped: batch.skippedCount,
        })
      }
    }

    if (
      batch.status !== 'PENDING' &&
      batch.status !== 'FAILED' &&
      batch.status !== 'COMPLETED_WITH_FAILURES'
    ) {
      throw new HttpError(
        409,
        'This request has already been generated and cannot be generated again.',
      )
    }

    const datasets = await this.loadTermDatasets(
      actor,
      batch.academicYearId,
      batch.academicTermId,
    )

    this.assertSchoolIdentityComplete(datasets[0]!.school)

    // Generate only the pupils who are eligible at approval time. Pupils
    // without complete accepted results are shown as ineligible in the request
    // preflight; they are not converted into generation failures, so a single
    // incomplete pupil cannot block the release of every other eligible report.
    const targets = datasets
      .flatMap((data) =>
        buildReportSet(data).builds.map((build) => ({ data, build })),
      )
      .filter((item) => item.build.eligible)

    if (targets.length === 0) {
      throw new HttpError(
        400,
        'There are no eligible pupils to generate reports for in this request. Complete academic review and acceptance first.',
      )
    }

    await this.repository.deleteFailures(
      actor,
      batchId,
      targets.map((item) => item.build.pupil.id),
    )

    return this.runIntoBatch(actor, batch, targets, audit, {
      allowSkip: false,
      previousGenerated: 0,
      previousSkipped: 0,
    })
  }

  private async runIntoBatch(
    actor: ReportActor,
    batch: ReportBatchDetail,
    targets: Array<{ data: ReportGenerationData; build: ReturnType<typeof buildReportSet>['builds'][number] }>,
    audit: ReportAuditContext,
    options: {
      allowSkip: boolean
      previousGenerated: number
      previousSkipped: number
    },
  ): Promise<GenerateReportsResult> {
    await this.repository.markBatchRunning(actor, batch.id)
    await this.repository.recordBatchEvent(
      actor,
      batch.id,
      'REPORT_GENERATION_STARTED',
      { pupilCount: targets.length },
    )

    const results: GenerationItemResult[] = []
    let generatedCount = 0
    let skippedCount = 0
    let failedCount = 0

    for (const { data, build } of targets) {
      const pupilName = fullName(build.pupil)

      if (!build.eligible || !build.snapshot) {
        const failure = build.failure ?? {
          code: 'RESULTS_INCOMPLETE',
          message: 'Required accepted results are incomplete.',
        }

        await this.repository.recordFailure(actor, {
          batchId: batch.id,
          academicYearId: batch.academicYearId,
          academicTermId: batch.academicTermId,
          classId: data.class.id,
          pupilId: build.pupil.id,
          code: failure.code,
          message: failure.message,
        })

        failedCount += 1
        results.push({
          pupilId: build.pupil.id,
          pupilName,
          classId: data.class.id,
          status: 'FAILED',
          version: null,
          failureCode: failure.code,
          failureMessage: failure.message,
        })
        continue
      }

      try {
        const skipped = options.allowSkip
          ? await this.canSkipGeneration(
              actor,
              batch.academicTermId,
              build.snapshot,
              build.pupil.id,
            )
          : null

        if (skipped !== null) {
          skippedCount += 1
          results.push({
            pupilId: build.pupil.id,
            pupilName,
            classId: data.class.id,
            status: 'SKIPPED',
            version: skipped,
            failureCode: null,
            failureMessage: null,
          })
          continue
        }

        const versionId = randomUUID()
        const assets = await this.loadAssets(build.snapshot)
        const pdf = await this.renderPdf(build.snapshot, assets)
        const storageKey = `schools/${actor.schoolId}/reports/${batch.academicTermId}/${build.pupil.id}/${versionId}.pdf`

        await this.storage.putObject(storageKey, pdf.data, 'application/pdf')

        try {
          const saved = await this.repository.saveGeneratedReport(
            actor,
            {
              versionId,
              batchId: batch.id,
              academicYearId: batch.academicYearId,
              academicTermId: batch.academicTermId,
              classId: data.class.id,
              pupilId: build.pupil.id,
              snapshot: build.snapshot,
              storageKey,
              checksum: pdf.checksum,
              byteSize: pdf.byteSize,
              pageCount: pdf.pageCount,
            },
            audit,
          )

          generatedCount += 1
          results.push({
            pupilId: build.pupil.id,
            pupilName,
            classId: data.class.id,
            status: 'GENERATED',
            version: saved.version,
            failureCode: null,
            failureMessage: null,
          })
        } catch (error) {
          await this.storage.deleteObject(storageKey).catch(() => undefined)
          throw error
        }
      } catch (error) {
        const message = safeFailureMessage(error)

        await this.repository
          .recordFailure(actor, {
            batchId: batch.id,
            academicYearId: batch.academicYearId,
            academicTermId: batch.academicTermId,
            classId: data.class.id,
            pupilId: build.pupil.id,
            code: 'GENERATION_FAILED',
            message,
          })
          .catch(() => undefined)

        failedCount += 1
        results.push({
          pupilId: build.pupil.id,
          pupilName,
          classId: data.class.id,
          status: 'FAILED',
          version: null,
          failureCode: 'GENERATION_FAILED',
          failureMessage: message,
        })
      }
    }

    const totalGenerated = options.previousGenerated + generatedCount
    const totalSkipped = options.previousSkipped + skippedCount
    const status =
      totalGenerated + totalSkipped === 0 && failedCount > 0
        ? 'FAILED'
        : failedCount > 0
          ? 'COMPLETED_WITH_FAILURES'
          : 'COMPLETED'

    const completed = await this.repository.completeBatch(actor, batch.id, {
      status,
      generatedCount: totalGenerated,
      skippedCount: totalSkipped,
      failedCount,
    })

    await this.repository.recordBatchEvent(
      actor,
      batch.id,
      status === 'FAILED'
        ? 'REPORT_GENERATION_FAILED'
        : status === 'COMPLETED_WITH_FAILURES'
          ? 'REPORT_GENERATION_PARTIAL_FAILURE'
          : 'REPORT_GENERATION_COMPLETED',
      {
        generatedCount: totalGenerated,
        failedCount,
        skippedCount: totalSkipped,
      },
    )

    return { batch: completed, results }
  }

  private async loadTermDatasets(
    actor: ReportActor,
    academicYearId: string,
    academicTermId: string,
  ): Promise<ReportGenerationData[]> {
    const classIds = (
      await this.repository.listClassesForTerm(
        actor,
        academicYearId,
        academicTermId,
      )
    ).map((item) => item.id)

    if (classIds.length === 0) {
      throw new HttpError(
        400,
        'No classes with active pupil enrollments were found for this term.',
      )
    }

    return this.loadClassDatasets(
      actor,
      academicYearId,
      academicTermId,
      classIds,
    )
  }

  private async loadClassDatasets(
    actor: ReportActor,
    academicYearId: string,
    academicTermId: string,
    classIds: string[],
  ): Promise<ReportGenerationData[]> {
    const datasets: ReportGenerationData[] = []

    for (const classId of classIds) {
      datasets.push(
        await this.repository.loadGenerationData(actor, {
          academicYearId,
          academicTermId,
          classId,
        }),
      )
    }

    return datasets
  }

  async listCards(
    actor: ReportActor,
    filter: {
      academicTermId: string
      classId?: string
      releasedOnly?: boolean
    },
  ): Promise<ReportCardRecord[]> {
    const accessibleClassIds =
      await this.repository.listAccessibleClassIds(actor)

    return this.repository.listCards(actor, {
      academicTermId: filter.academicTermId,
      classId: filter.classId,
      releasedOnly: filter.releasedOnly,
      accessibleClassIds,
    })
  }

  async getCard(
    actor: ReportActor,
    reportCardId: string,
  ): Promise<{
    card: ReportCardRecord
    versions: ReportVersionSummary[]
    input: ReportInputRecord | null
  }> {
    const detail = await this.repository.getCard(actor, reportCardId)

    if (!detail) {
      throw new HttpError(404, 'Report card not found')
    }

    await this.assertClassReadable(actor, detail.card.classId)

    return {
      card: detail.card,
      versions: detail.versions.map((version) => ({
        id: version.id,
        reportCardId: version.reportCardId,
        batchId: version.batchId,
        releaseStatus: version.releaseStatus,
        version: version.version,
        checksum: version.checksum,
        byteSize: version.byteSize,
        pageCount: version.pageCount,
        generatedAt: version.generatedAt,
        generatedByName: version.generatedByName,
      })),
      input: detail.input,
    }
  }

  async preview(
    actor: ReportActor,
    reportCardId: string,
    version?: number,
    audit?: ReportAuditContext,
  ): Promise<ReportPreviewResult> {
    const detail = await this.repository.getCard(actor, reportCardId)

    if (!detail) {
      throw new HttpError(404, 'Report card not found')
    }

    await this.assertClassReadable(actor, detail.card.classId)

    const selected =
      version === undefined
        ? detail.versions[0]
        : detail.versions.find((item) => item.version === version)

    if (!selected) {
      throw new HttpError(404, 'Report version not found')
    }

    if (selected.releaseStatus !== 'RELEASED') {
      throw new HttpError(
        403,
        'This report has not been released by the platform administrator.',
      )
    }

    if (!isSnapshot(selected.snapshot)) {
      throw new HttpError(500, 'The stored report snapshot is invalid')
    }

    const assets = await this.loadAssets(selected.snapshot)
    const pdf = await this.renderPdf(selected.snapshot, assets, {
      released: true,
    })

    if (audit) {
      await this.repository.recordReportAccess(
        actor,
        detail.card.id,
        'REPORT_ACCESSED',
        audit,
      )
    }

    return {
      data: pdf.data,
      pageCount: pdf.pageCount,
      fileName: reportFileName(
        selected.snapshot.pupil.admissionNumber,
        selected.version,
      ),
      checksum: pdf.checksum,
    }
  }

  async getStoredPdf(
    actor: ReportActor,
    reportCardId: string,
    version: number,
    audit?: ReportAuditContext,
  ): Promise<ReportPreviewResult> {
    const found = await this.repository.getVersion(
      actor,
      reportCardId,
      version,
    )

    if (!found) {
      throw new HttpError(404, 'Report version not found')
    }

    await this.assertClassReadable(actor, found.card.classId)

    if (found.version.releaseStatus !== 'RELEASED') {
      throw new HttpError(
        403,
        'This report has not been released by the platform administrator.',
      )
    }

    // The stored artifact is the immutable generation-time PDF and therefore
    // carries the INTERNAL DRAFT band. A released download must never serve
    // that label, so verify the stored artifact still exists and matches its
    // checksum, then render a released copy from the same snapshot.
    const stored = await this.storage.getObject(found.storageKey)

    if (!stored) {
      throw new HttpError(404, 'Stored report PDF is missing from private storage')
    }

    if (sha256(stored) !== found.version.checksum) {
      throw new HttpError(500, 'Stored report PDF failed integrity verification')
    }

    if (!isSnapshot(found.version.snapshot)) {
      throw new HttpError(500, 'The stored report snapshot is invalid')
    }

    const assets = await this.loadAssets(found.version.snapshot)
    const pdf = await this.renderPdf(found.version.snapshot, assets, {
      released: true,
    })

    if (audit) {
      await this.repository.recordReportAccess(
        actor,
        found.card.id,
        'REPORT_DOWNLOADED',
        audit,
      )
    }

    return {
      data: pdf.data,
      pageCount: pdf.pageCount,
      fileName: reportFileName(found.card.admissionNumber, version),
      checksum: pdf.checksum,
    }
  }

  /**
   * Merges every released pupil report for one class into a single printable
   * PDF. Individual PDFs are re-rendered from their immutable snapshots; no
   * generation-time draft artifact is ever served.
   */
  async getClassCollection(
    actor: ReportActor,
    filter: { academicTermId: string; classId: string },
    audit?: ReportAuditContext,
  ): Promise<ReportPreviewResult> {
    const cards = await this.repository.listCards(actor, {
      academicTermId: filter.academicTermId,
      classId: filter.classId,
      releasedOnly: true,
      accessibleClassIds: null,
    })

    if (cards.length === 0) {
      throw new HttpError(
        404,
        'No released reports are available for this class.',
      )
    }

    const merged = await PDFDocument.create()
    let included = 0

    for (const card of cards) {
      const detail = await this.repository.getCard(actor, card.id)
      const selected = detail?.versions.find(
        (version) => version.releaseStatus === 'RELEASED',
      )

      if (!selected || !isSnapshot(selected.snapshot)) {
        continue
      }

      const assets = await this.loadAssets(selected.snapshot)
      const rendered = await this.renderPdf(selected.snapshot, assets, {
        released: true,
      })
      const source = await PDFDocument.load(rendered.data)
      const pages = await merged.copyPages(source, source.getPageIndices())

      for (const page of pages) {
        merged.addPage(page)
      }

      included += 1

      if (audit) {
        await this.repository.recordReportAccess(
          actor,
          card.id,
          'REPORT_COLLECTION_DOWNLOADED',
          audit,
        )
      }
    }

    if (included === 0) {
      throw new HttpError(
        404,
        'No released reports are available for this class.',
      )
    }

    const data = Buffer.from(await merged.save())
    const safeClass = cards[0]!.className.replace(/[^A-Za-z0-9_-]+/g, '-')

    return {
      data,
      pageCount: merged.getPageCount(),
      fileName: `class-reports-${safeClass}.pdf`,
      checksum: sha256(data),
    }
  }

  async listBatches(
    actor: ReportActor,
    filter: { academicTermId?: string },
  ): Promise<ReportBatchRecord[]> {
    const classIds = await this.repository.listAccessibleClassIds(actor)
    return this.repository.listBatches(actor, {
      academicTermId: filter.academicTermId,
      classIds,
    })
  }

  async getBatch(
    actor: ReportActor,
    batchId: string,
  ): Promise<ReportBatchDetail> {
    const batch = await this.repository.getBatch(actor, batchId)

    if (!batch) {
      throw new HttpError(404, 'Report generation batch not found')
    }

    return batch
  }

  async retryBatch(
    actor: ReportActor,
    batchId: string,
    audit: ReportAuditContext,
  ): Promise<GenerateReportsResult[]> {
    const batch = await this.getBatch(actor, batchId)

    if (batch.failures.length === 0) {
      throw new HttpError(
        400,
        'This batch has no per-pupil failures that can be retried',
      )
    }

    return [await this.generateIntoBatch(actor, batchId, audit, { retry: true })]
  }

  /**
   * Marks a request FAILED after a fatal generation error. Without this, the
   * batch would stay RUNNING forever and no retry could ever be accepted.
   */
  async failBatch(
    actor: ReportActor,
    batchId: string,
    message: string,
  ): Promise<void> {
    const batch = await this.getBatch(actor, batchId)

    await this.repository.completeBatch(actor, batchId, {
      status: 'FAILED',
      generatedCount: batch.generatedCount,
      skippedCount: batch.skippedCount,
      failedCount: batch.failedCount,
      fatalError: message,
    })

    await this.repository.recordBatchEvent(
      actor,
      batchId,
      'REPORT_GENERATION_ABORTED',
      { message },
    )
  }

  private assertRecordsReader(actor: ReportActor): void {
    // School administrators retain read access for review, and the assigned
    // class teacher owns the records. The platform reviewer also needs read
    // access because approving a term request re-runs the live eligibility
    // preflight through `buildClassSummaries`. Subject teachers are denied.
    if (
      actor.role !== 'SCHOOL_ADMIN' &&
      actor.role !== 'CLASS_TEACHER' &&
      actor.role !== 'PLATFORM_SUPER_ADMIN'
    ) {
      throw new HttpError(
        403,
        'Attendance, teacher remarks and attitude records are limited to school administrators and class teachers',
      )
    }
  }

  /**
   * Term records are stricter than general report reads: a class teacher may
   * only reach the class they are actually assigned to, and a subject-teacher
   * assignment in another class never widens that access. Administrators keep
   * their existing school-wide read access, and the platform reviewer needs the
   * same read path during approval preflight.
   */
  private async assertRecordsClassReadable(
    actor: ReportActor,
    classId: string,
  ): Promise<void> {
    if (
      actor.role === 'SCHOOL_ADMIN' ||
      actor.role === 'PLATFORM_SUPER_ADMIN'
    ) {
      return
    }

    const assigned = await this.repository.hasClassTeacherAssignment(
      actor,
      classId,
    )

    if (!assigned) {
      throw new HttpError(
        403,
        'You do not have access to attendance, teacher remarks or attitude records for this class',
      )
    }
  }

  private async assertClassReadable(
    actor: ReportActor,
    classId: string,
  ): Promise<void> {
    if (
      actor.role === 'SCHOOL_ADMIN' ||
      actor.role === 'PLATFORM_SUPER_ADMIN'
    ) {
      return
    }

    const [classTeacher, subjectTeacher] = await Promise.all([
      this.repository.hasClassTeacherAssignment(actor, classId),
      this.repository.hasSubjectTeacherAssignment(actor, classId),
    ])

    if (!classTeacher && !subjectTeacher) {
      throw new HttpError(
        403,
        'You do not have access to reports for this class',
      )
    }
  }

  private async canSkipGeneration(
    actor: ReportActor,
    academicTermId: string,
    snapshot: ReportSnapshot,
    pupilId: string,
  ): Promise<number | null> {
    const latest = await this.repository.getLatestVersionForPupil(actor, {
      academicTermId,
      pupilId,
    })

    if (!latest || !isRecord(latest.snapshot)) {
      return null
    }

    if (latest.snapshot.fingerprint !== snapshot.fingerprint) {
      return null
    }

    try {
      const existing = await this.storage.getObject(latest.storageKey)

      if (!existing || sha256(existing) !== latest.checksum) {
        return null
      }
    } catch {
      return null
    }

    return latest.version
  }

  private async loadAssets(
    snapshot: ReportSnapshot,
  ): Promise<ReportPdfAssets> {
    const [schoolLogo, emblem, crest, pupilPhoto, signature] =
      await Promise.all([
        this.readOptional(snapshot.school.logoObjectKey ?? null),
        this.readOptional(snapshot.school.emblemObjectKey ?? null),
        this.readOptional(snapshot.school.crestObjectKey ?? null),
        this.readOptional(snapshot.pupil.photoObjectKey),
        this.readOptional(snapshot.document.signatureObjectKey),
      ])

    return { schoolLogo, emblem, crest, pupilPhoto, signature }
  }

  private assertSchoolIdentityComplete(school: {
    logoObjectKey: string | null
    landmark: string | null
    address: string | null
    phone: string | null
  }): void {
    const missing = missingSchoolIdentityFields(school)

    if (missing.length > 0) {
      throw new HttpError(
        400,
        `Complete the school profile before generating reports. Missing: ${missing.join(', ')}.`,
      )
    }
  }

  private async readOptional(key: string | null): Promise<Buffer | null> {
    if (!key) {
      return null
    }

    try {
      return await this.storage.getObject(key)
    } catch {
      // A missing or unreadable optional image must never block a report.
      return null
    }
  }
}

function reportFileName(admissionNumber: string, version: number): string {
  const safeAdmission = admissionNumber.replace(/[^A-Za-z0-9_-]+/g, '-')
  return `report-${safeAdmission}-v${version}.pdf`
}
