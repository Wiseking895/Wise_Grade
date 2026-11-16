import { randomUUID } from 'node:crypto'
import { HttpError } from '../../src/errors/http-error.js'
import { sha256, type StorageAdapter } from '../../src/storage/storage.js'
import type {
  PlatformReportSchoolScope,
  ReportReleaseActor,
  ReportReleaseBatchFilter,
  ReportReleaseBatchRecord,
  ReportReleaseEligibility,
  ReportReleaseEligibilityIssue,
  ReportReleaseFailedAttemptInput,
  ReportReleaseOverview,
  ReportReleasePreviewRecord,
  ReportReleaseRepository,
  ReportReleaseTransitionInput,
  ReportReleaseVersionRecord,
} from '../../src/reports/release-repository.js'
import type {
  ReportBatchRecord,
  ReportReleaseStatus,
} from '../../src/reports/repository.js'

export interface FakeReleaseSeedOptions {
  schoolId?: string
  academicYearId?: string
  academicTermId?: string
  classId?: string
  releaseStatus?: ReportReleaseStatus
  invoiceStatus?: string
  paidMinor?: number
  totalMinor?: number
  outstandingMinor?: number
  includeInvoice?: boolean
  includeReportInInvoice?: boolean
  acceptedSubmissions?: number
  subjectCount?: number
  corruptFile?: boolean
  missingFile?: boolean
  schoolIsActive?: boolean
  versionClassId?: string
  versionSchoolId?: string
  batchStatus?: ReportBatchRecord['status']
  failedCount?: number
  skippedCount?: number
  generatedCount?: number
}

export interface FakeReleaseSeed {
  record: ReportReleaseBatchRecord
  versionId: string
  storageKey: string
  data: Buffer
}

const DEFAULT_PDF = Buffer.from('%PDF-1.7\n% fake release integration\n')

export async function buildReleaseSeed(
  storage: StorageAdapter,
  options: FakeReleaseSeedOptions = {},
): Promise<FakeReleaseSeed> {
  const schoolId = options.schoolId ?? randomUUID()
  const academicYearId = options.academicYearId ?? randomUUID()
  const academicTermId = options.academicTermId ?? randomUUID()
  const classId = options.classId ?? randomUUID()
  const reportCardId = randomUUID()
  const versionId = randomUUID()
  const storageKey = `schools/${schoolId}/reports/${reportCardId}/v1.pdf`
  const data = options.corruptFile
    ? Buffer.from('%PDF-1.7 corrupt bytes')
    : DEFAULT_PDF
  const checksum = sha256(DEFAULT_PDF)

  if (!options.missingFile) {
    await storage.putObject(storageKey, data, 'application/pdf')
  }

  const snapshot = {
    source: { acceptedSubmissions: options.acceptedSubmissions ?? 1 },
    academic: {
      subjects: Array.from(
        { length: options.subjectCount ?? 1 },
        (_, index) => ({ name: `Subject ${index + 1}` }),
      ),
    },
  }

  const version: ReportReleaseVersionRecord = {
    id: versionId,
    schoolId: options.versionSchoolId ?? schoolId,
    reportCardId,
    reportCardSchoolId: schoolId,
    pupilId: randomUUID(),
    pupilName: 'Ama Mensah',
    admissionNumber: 'ADM-001',
    version: 1,
    generatedAt: new Date('2026-11-01T10:00:00.000Z'),
    storageKey,
    checksum,
    byteSize: data.length,
    academicYearId,
    academicTermId,
    classId: options.versionClassId ?? classId,
    snapshot,
  }

  const totalMinor = options.totalMinor ?? 1500
  const paidMinor = options.paidMinor ?? totalMinor
  const outstandingMinor =
    options.outstandingMinor ?? Math.max(0, totalMinor - paidMinor)

  const batch: ReportBatchRecord = {
    id: randomUUID(),
    schoolId,
    academicYearId,
    academicTermId,
    classId,
    scope: 'CLASS',
    status: options.batchStatus ?? 'COMPLETED',
    requestedPupilCount: 1,
    generatedCount: options.generatedCount ?? 1,
    skippedCount: options.skippedCount ?? 0,
    failedCount: options.failedCount ?? 0,
    fatalError: null,
    startedAt: new Date('2026-11-01T10:00:00.000Z'),
    completedAt: new Date('2026-11-01T10:01:00.000Z'),
    releaseStatus: options.releaseStatus ?? 'GENERATED',
    previousReleaseStatus: null,
    submittedAt: null,
    submittedByMembershipId: null,
    reviewedAt: null,
    reviewedByUserId: null,
    returnedReason: null,
    holdReason: null,
    heldAt: null,
    heldByUserId: null,
    releasedAt: null,
    releasedByUserId: null,
    createdAt: new Date('2026-11-01T09:59:00.000Z'),
  }

  const record: ReportReleaseBatchRecord = {
    batch,
    schoolName: 'Green Valley Academy',
    schoolIsActive: options.schoolIsActive ?? true,
    academicYearName: '2026/2027',
    academicYearSchoolId: schoolId,
    academicTermName: 'Term 1',
    academicTermSchoolId: schoolId,
    academicTermYearId: academicYearId,
    className: 'Basic 5',
    requestedByName: 'School Administrator',
    submittedByName: null,
    reviewedByName: null,
    heldByName: null,
    releasedByName: null,
    invoice:
      options.includeInvoice === false
        ? null
        : {
            id: randomUUID(),
            invoiceNumber: 'INV-TEST-001',
            status: options.invoiceStatus ?? 'PAID',
            currency: 'GHS',
            totalMinor,
            paidMinor,
            outstandingMinor,
            pupilReportCardIds:
              options.includeReportInInvoice === false ? [] : [reportCardId],
          },
    versions: [version],
  }

  return { record, versionId, storageKey, data }
}

/**
 * In-memory Phase 6B release repository for service and HTTP tests.
 *
 * It mirrors the production row-level state guard (expected release state must
 * still match) and records every attempted transition so tests can assert the
 * audit trail without a database.
 */
export class FakeReportReleaseRepository implements ReportReleaseRepository {
  readonly records = new Map<string, ReportReleaseBatchRecord>()
  readonly transitions: ReportReleaseTransitionInput[] = []
  readonly failedAttempts: ReportReleaseFailedAttemptInput[] = []
  readonly schools: PlatformReportSchoolScope[] = []
  readonly eligibilityChecks: Array<{
    batchId: string
    eligibility: ReportReleaseEligibility
  }> = []

  seed(seed: FakeReleaseSeed): ReportReleaseBatchRecord {
    this.records.set(seed.record.batch.id, seed.record)
    return seed.record
  }

  private decorate(
    record: ReportReleaseBatchRecord,
  ): ReportReleaseBatchRecord {
    return {
      ...record,
      batch: { ...record.batch },
      versions: record.versions.map((version) => ({ ...version })),
    }
  }

  async listSchoolBatches(
    actor: ReportReleaseActor,
    filter: { academicTermId?: string },
  ) {
    return [...this.records.values()]
      .filter(
        (record) =>
          record.batch.schoolId === actor.schoolId &&
          (!filter.academicTermId ||
            record.batch.academicTermId === filter.academicTermId),
      )
      .map((record) => this.decorate(record))
  }

  async getSchoolBatch(actor: ReportReleaseActor, batchId: string) {
    const record = this.records.get(batchId)
    return record && record.batch.schoolId === actor.schoolId
      ? this.decorate(record)
      : null
  }

  async listPlatformBatches(filter: ReportReleaseBatchFilter) {
    return [...this.records.values()]
      .filter(
        (record) =>
          (!filter.schoolId || record.batch.schoolId === filter.schoolId) &&
          (!filter.academicYearId ||
            record.batch.academicYearId === filter.academicYearId) &&
          (!filter.academicTermId ||
            record.batch.academicTermId === filter.academicTermId) &&
          (!filter.status || record.batch.releaseStatus === filter.status) &&
          (!filter.submittedFrom ||
            (record.batch.submittedAt !== null &&
              record.batch.submittedAt >= filter.submittedFrom)) &&
          (!filter.submittedTo ||
            (record.batch.submittedAt !== null &&
              record.batch.submittedAt <= filter.submittedTo)),
      )
      .map((record) => this.decorate(record))
  }

  async getPlatformBatch(batchId: string) {
    const record = this.records.get(batchId)
    return record ? this.decorate(record) : null
  }

  async overview(): Promise<ReportReleaseOverview> {
    const count = (status: ReportReleaseStatus) =>
      [...this.records.values()].filter(
        (record) => record.batch.releaseStatus === status,
      ).length

    return {
      totalGenerated: this.records.size,
      generated: count('GENERATED'),
      pendingReview: count('PENDING_PLATFORM_REVIEW'),
      returned: count('RETURNED'),
      approvedUnreleased: count('APPROVED'),
      released: count('RELEASED'),
      onHold: count('ON_HOLD'),
    }
  }

  async listPlatformSchools() {
    return this.schools.map((school) => ({ ...school }))
  }

  async transition(input: ReportReleaseTransitionInput) {
    const record = this.records.get(input.batchId)

    if (
      !record ||
      (input.schoolId !== null && record.batch.schoolId !== input.schoolId)
    ) {
      throw new HttpError(404, 'Report generation batch not found')
    }

    if (!input.expected.includes(record.batch.releaseStatus)) {
      throw new HttpError(
        409,
        'This report batch is no longer in a state that allows that action.',
      )
    }

    this.transitions.push({
      ...input,
      metadata: input.metadata ? { ...input.metadata } : undefined,
    })

    record.batch = {
      ...record.batch,
      ...input.set,
      releaseStatus: input.next,
    }

    return { ...record.batch }
  }

  async recordFailedAttempt(input: ReportReleaseFailedAttemptInput) {
    this.failedAttempts.push({
      ...input,
      metadata: input.metadata ? { ...input.metadata } : undefined,
    })
  }

  async getPreview(
    batchId: string,
    versionId: string,
  ): Promise<ReportReleasePreviewRecord | null> {
    const record = this.records.get(batchId)
    const version = record?.versions.find((item) => item.id === versionId)

    if (!record || !version) {
      return null
    }

    return {
      batchId,
      schoolId: record.batch.schoolId,
      versionId: version.id,
      reportCardId: version.reportCardId,
      version: version.version,
      pupilName: version.pupilName,
      admissionNumber: version.admissionNumber,
      storageKey: version.storageKey,
      checksum: version.checksum,
      byteSize: version.byteSize,
      fileName: `report-${version.admissionNumber}-v${version.version}.pdf`,
    }
  }
}

export function eligibilityIssueCodes(
  issues: ReportReleaseEligibilityIssue[],
): string[] {
  return issues.map((issue) => issue.code)
}
