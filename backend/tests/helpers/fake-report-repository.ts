import { randomUUID } from 'node:crypto'
import { HttpError } from '../../src/errors/http-error.js'
import type {
  ReportActor,
  ReportAssetCreateInput,
  ReportAssetRecord,
  ReportAuditContext,
  ReportBatchCreateInput,
  ReportBatchDetail,
  ReportBatchRecord,
  ReportCardRecord,
  ReportClassRecord,
  ReportFailureRecord,
  ReportGenerationData,
  ReportGenerationRequest,
  ReportInputRecord,
  ReportInputUpsert,
  ReportRepository,
  ReportSettingsInput,
  ReportSettingsRecord,
  ReportVersionRecord,
  SaveGeneratedReportInput,
} from '../../src/reports/repository.js'

interface StoredCard extends ReportCardRecord {
  academicTermId: string
}

interface StoredVersion extends ReportVersionRecord {
  schoolId: string
  storageKey: string
  snapshot: unknown
  batchId: string | null
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

function key(...parts: string[]): string {
  return parts.join(':')
}

/**
 * In-memory Phase 5 repository used by service and HTTP tests. It mirrors the
 * tenant scoping and immutable-version behaviour of the Prisma implementation
 * without touching PostgreSQL.
 */
export class FakeReportRepository implements ReportRepository {
  readonly data: ReportGenerationData[] = []
  readonly settings = new Map<string, ReportSettingsRecord>()
  readonly assets = new Map<string, ReportAssetRecord>()
  readonly inputs = new Map<string, ReportInputRecord>()
  readonly batches = new Map<string, ReportBatchRecord>()
  readonly failures: ReportFailureRecord[] = []
  readonly cards = new Map<string, StoredCard>()
  readonly versions = new Map<string, StoredVersion>()
  readonly classTeacherAssignments = new Set<string>()
  readonly subjectTeacherAssignments = new Set<string>()
  readonly audits: Array<{
    action: string
    entityId: string | null
    metadata?: Record<string, unknown>
  }> = []

  constructor(data: ReportGenerationData[] = []) {
    this.data.push(...data)
  }

  private findData(schoolId: string, classId: string): ReportGenerationData | null {
    return (
      this.data.find(
        (item) => item.school.id === schoolId && item.class.id === classId,
      ) ?? null
    )
  }

  async getSettings(actor: ReportActor, academicTermId: string) {
    return this.settings.get(key(actor.schoolId, academicTermId)) ?? null
  }

  async updateSettings(
    actor: ReportActor,
    input: ReportSettingsInput,
    audit: ReportAuditContext,
  ) {
    const existing = this.settings.get(key(actor.schoolId, input.academicTermId))
    const now = new Date()
    const record: ReportSettingsRecord = {
      id: existing?.id ?? randomUUID(),
      schoolId: actor.schoolId,
      academicYearId: input.academicYearId,
      academicTermId: input.academicTermId,
      emblemObjectKey:
        input.emblemObjectKey !== undefined
          ? input.emblemObjectKey
          : (existing?.emblemObjectKey ?? null),
      crestObjectKey:
        input.crestObjectKey !== undefined
          ? input.crestObjectKey
          : (existing?.crestObjectKey ?? null),
      signatureObjectKey:
        input.signatureObjectKey !== undefined
          ? input.signatureObjectKey
          : (existing?.signatureObjectKey ?? null),
      headteacherLabel:
        input.headteacherLabel ??
        existing?.headteacherLabel ??
        'SCHOOL ADMIN SIGNATURE',
      rankingEnabled: input.rankingEnabled ?? existing?.rankingEnabled ?? true,
      tiePolicy: input.tiePolicy ?? existing?.tiePolicy ?? 'COMPETITION',
      aggregatePolicy:
        input.aggregatePolicy ?? existing?.aggregatePolicy ?? 'NONE',
      attendanceRequired:
        input.attendanceRequired ?? existing?.attendanceRequired ?? true,
      closingDate:
        input.closingDate !== undefined
          ? input.closingDate
          : (existing?.closingDate ?? null),
      reopeningDate:
        input.reopeningDate !== undefined
          ? input.reopeningDate
          : (existing?.reopeningDate ?? null),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }

    this.settings.set(key(actor.schoolId, input.academicTermId), record)
    this.audits.push({
      action: 'REPORT_SETTINGS_UPDATED',
      entityId: record.id,
    })
    void audit
    return record
  }

  async uploadAsset(
    actor: ReportActor,
    input: ReportAssetCreateInput,
    audit: ReportAuditContext,
  ) {
    const record: ReportAssetRecord = {
      id: randomUUID(),
      schoolId: actor.schoolId,
      kind: input.kind,
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      checksum: input.checksum,
      originalName: input.originalName,
      createdAt: new Date(),
    }
    this.assets.set(record.id, record)
    this.audits.push({ action: 'REPORT_ASSET_UPLOADED', entityId: record.id })
    void audit
    return record
  }

  async getAsset(actor: ReportActor, assetId: string) {
    const record = this.assets.get(assetId)
    return record && record.schoolId === actor.schoolId ? record : null
  }

  async listAssets(actor: ReportActor) {
    return [...this.assets.values()].filter(
      (record) => record.schoolId === actor.schoolId,
    )
  }

  async upsertInput(
    actor: ReportActor,
    input: ReportInputUpsert,
    audit: ReportAuditContext,
  ) {
    const inputKey = key(actor.schoolId, input.academicTermId, input.pupilId)
    const existing = this.inputs.get(inputKey)
    const record: ReportInputRecord = {
      id: existing?.id ?? randomUUID(),
      schoolId: actor.schoolId,
      academicYearId: input.academicYearId,
      academicTermId: input.academicTermId,
      classId: input.classId,
      pupilId: input.pupilId,
      daysOpened:
        input.daysOpened !== undefined
          ? input.daysOpened
          : (existing?.daysOpened ?? null),
      daysAttended:
        input.daysAttended !== undefined
          ? input.daysAttended
          : (existing?.daysAttended ?? null),
      teacherRemarks:
        input.teacherRemarks !== undefined
          ? input.teacherRemarks
          : (existing?.teacherRemarks ?? null),
      attitude:
        input.attitude !== undefined
          ? input.attitude
          : (existing?.attitude ?? null),
      closingDate:
        input.closingDate !== undefined
          ? input.closingDate
          : (existing?.closingDate ?? null),
      reopeningDate:
        input.reopeningDate !== undefined
          ? input.reopeningDate
          : (existing?.reopeningDate ?? null),
      updatedAt: new Date(),
    }

    this.inputs.set(inputKey, record)
    this.audits.push({
      action: existing ? 'REPORT_INPUT_UPDATED' : 'REPORT_INPUT_CREATED',
      entityId: record.id,
      metadata: {
        pupilId: record.pupilId,
        classId: record.classId,
        academicYearId: record.academicYearId,
        academicTermId: record.academicTermId,
        daysOpened: record.daysOpened,
        daysAttended: record.daysAttended,
        hasTeacherRemarks:
          record.teacherRemarks !== null &&
          record.teacherRemarks.trim() !== '',
        hasAttitude:
          record.attitude !== null && record.attitude.trim() !== '',
        actorMembershipId: audit.actorMembershipId,
      },
    })
    return record
  }

  async listInputs(
    actor: ReportActor,
    filter: { academicTermId: string; classId: string },
  ) {
    return [...this.inputs.values()].filter(
      (record) =>
        record.schoolId === actor.schoolId &&
        record.academicTermId === filter.academicTermId &&
        record.classId === filter.classId,
    )
  }

  async listAccessibleClassIds(actor: ReportActor) {
    if (actor.role === 'SCHOOL_ADMIN') {
      return null
    }

    const ids = new Set<string>()

    for (const item of this.classTeacherAssignments) {
      const [schoolId, membershipId, classId] = item.split(':')
      if (schoolId === actor.schoolId && membershipId === actor.membershipId && classId) {
        ids.add(classId)
      }
    }

    for (const item of this.subjectTeacherAssignments) {
      const [schoolId, membershipId, classId] = item.split(':')
      if (schoolId === actor.schoolId && membershipId === actor.membershipId && classId) {
        ids.add(classId)
      }
    }

    return [...ids]
  }

  async hasClassTeacherAssignment(actor: ReportActor, classId: string) {
    if (!actor.membershipId) {
      return false
    }

    return this.classTeacherAssignments.has(
      key(actor.schoolId, actor.membershipId, classId),
    )
  }

  async hasSubjectTeacherAssignment(actor: ReportActor, classId: string) {
    if (!actor.membershipId) {
      return false
    }

    return this.subjectTeacherAssignments.has(
      key(actor.schoolId, actor.membershipId, classId),
    )
  }

  async loadGenerationData(
    actor: ReportActor,
    request: ReportGenerationRequest,
  ) {
    const data = this.findData(actor.schoolId, request.classId)

    if (
      !data ||
      data.academicYear.id !== request.academicYearId ||
      data.academicTerm.id !== request.academicTermId
    ) {
      throw new HttpError(400, 'No report data for this school, class and term')
    }

    return data
  }

  async listClassesForTerm(
    actor: ReportActor,
    academicYearId: string,
    academicTermId: string,
  ): Promise<ReportClassRecord[]> {
    return this.data
      .filter(
        (item) =>
          item.school.id === actor.schoolId &&
          item.academicYear.id === academicYearId &&
          item.academicTerm.id === academicTermId,
      )
      .map((item) => ({
        id: item.class.id,
        name: item.class.name,
        level: item.class.level,
      }))
  }

  async getLatestVersionForPupil(
    actor: ReportActor,
    input: { academicTermId: string; pupilId: string },
  ) {
    const card = [...this.cards.values()].find(
      (item) =>
        item.schoolId === actor.schoolId &&
        item.academicTermId === input.academicTermId &&
        item.pupilId === input.pupilId,
    )

    if (!card) {
      return null
    }

    const latest = [...this.versions.values()]
      .filter((item) => item.reportCardId === card.id)
      .sort((a, b) => b.version - a.version)[0]

    if (!latest) {
      return null
    }

    return {
      reportCardId: card.id,
      version: latest.version,
      snapshot: latest.snapshot,
      storageKey: latest.storageKey,
      checksum: latest.checksum,
    }
  }

  async createBatch(
    actor: ReportActor,
    input: ReportBatchCreateInput,
    audit: ReportAuditContext,
  ) {
    const record: ReportBatchRecord = {
      id: randomUUID(),
      schoolId: actor.schoolId,
      academicYearId: input.academicYearId,
      academicTermId: input.academicTermId,
      classId: input.classId,
      scope: input.scope,
      status: input.status ?? 'PENDING',
      requestedPupilCount: input.requestedPupilCount,
      generatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      fatalError: null,
      startedAt: null,
      completedAt: null,
      releaseStatus: input.releaseStatus ?? 'GENERATED',
      previousReleaseStatus: null,
      submittedAt: input.submittedAt ?? null,
      submittedByMembershipId: input.submittedByMembershipId ?? null,
      reviewedAt: null,
      reviewedByUserId: null,
      returnedReason: null,
      holdReason: null,
      heldAt: null,
      heldByUserId: null,
      releasedAt: null,
      releasedByUserId: null,
      createdAt: new Date(),
    }

    this.batches.set(record.id, record)
    this.audits.push({
      action: input.auditAction ?? 'REPORT_BATCH_REQUESTED',
      entityId: record.id,
    })
    void audit
    return record
  }

  async markBatchRunning(actor: ReportActor, batchId: string) {
    const batch = this.batches.get(batchId)

    if (!batch || batch.schoolId !== actor.schoolId) {
      throw new HttpError(404, 'Report generation batch not found')
    }

    batch.status = 'RUNNING'
    batch.startedAt = new Date()
  }

  async recordBatchEvent(
    actor: ReportActor,
    batchId: string,
    action: string,
    metadata?: Record<string, unknown>,
  ) {
    const batch = this.batches.get(batchId)

    if (!batch || batch.schoolId !== actor.schoolId) {
      throw new HttpError(404, 'Report generation batch not found')
    }

    this.audits.push({ action, entityId: batchId })
    void metadata
  }

  async deleteFailures(
    actor: ReportActor,
    batchId: string,
    pupilIds: string[],
  ) {
    const remove = new Set(pupilIds)

    for (let index = this.failures.length - 1; index >= 0; index -= 1) {
      const failure = this.failures[index]!

      if (
        failure.batchId === batchId &&
        failure.pupilId !== null &&
        remove.has(failure.pupilId)
      ) {
        this.failures.splice(index, 1)
      }
    }

    void actor
  }

  async recordReportAccess(
    actor: ReportActor,
    reportCardId: string,
    action: string,
    audit: ReportAuditContext,
  ) {
    this.audits.push({ action, entityId: reportCardId })
    void actor
    void audit
  }

  async completeBatch(
    actor: ReportActor,
    batchId: string,
    result: {
      status: ReportBatchRecord['status']
      generatedCount: number
      skippedCount: number
      failedCount: number
      fatalError?: string | null
    },
  ) {
    const batch = this.batches.get(batchId)

    if (!batch || batch.schoolId !== actor.schoolId) {
      throw new HttpError(404, 'Report generation batch not found')
    }

    batch.status = result.status
    batch.generatedCount = result.generatedCount
    batch.skippedCount = result.skippedCount
    batch.failedCount = result.failedCount
    batch.fatalError = result.fatalError ?? null
    batch.completedAt = new Date()

    return batch
  }

  async recordFailure(
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
  ) {
    const data = this.findData(actor.schoolId, input.classId)
    const pupil = data?.pupils.find((item) => item.id === input.pupilId)
    const record: ReportFailureRecord = {
      id: randomUUID(),
      batchId: input.batchId,
      classId: input.classId,
      pupilId: input.pupilId,
      pupilName: pupil ? fullName(pupil) : null,
      code: input.code,
      message: input.message,
      createdAt: new Date(),
    }

    this.failures.push(record)
    return record
  }

  async saveGeneratedReport(
    actor: ReportActor,
    input: SaveGeneratedReportInput,
    audit: ReportAuditContext,
  ) {
    const cardKey = key(actor.schoolId, input.academicTermId, input.pupilId)
    const data = this.findData(actor.schoolId, input.classId)
    const pupil = data?.pupils.find((item) => item.id === input.pupilId)
    let card = this.cards.get(cardKey)

    if (!card) {
      card = {
        id: input.reportCardId ?? randomUUID(),
        schoolId: actor.schoolId,
        academicYearId: input.academicYearId,
        academicTermId: input.academicTermId,
        classId: input.classId,
        className: data?.class.name ?? 'Unknown class',
        pupilId: input.pupilId,
        pupilName: pupil ? fullName(pupil) : 'Unknown pupil',
        admissionNumber: pupil?.admissionNumber ?? '',
        currentVersion: 0,
        versionCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      this.cards.set(cardKey, card)
    }

    const versionNumber = card.currentVersion + 1
    card.currentVersion = versionNumber
    card.versionCount += 1
    card.updatedAt = new Date()

    const version: StoredVersion = {
      id: input.versionId,
      reportCardId: card.id,
      releaseStatus:
        this.batches.get(input.batchId)?.releaseStatus ?? 'GENERATED',
      version: versionNumber,
      checksum: input.checksum,
      byteSize: input.byteSize,
      pageCount: input.pageCount,
      generatedAt: new Date(),
      generatedByName: 'Test Administrator',
      snapshot: input.snapshot,
      schoolId: actor.schoolId,
      storageKey: input.storageKey,
      batchId: input.batchId,
    }

    this.versions.set(key(card.id, String(versionNumber)), version)
    this.audits.push({
      action: 'REPORT_VERSION_GENERATED',
      entityId: version.id,
    })
    void audit
    return version
  }

  async listCards(
    actor: ReportActor,
    filter: {
      academicTermId: string
      classId?: string
      releasedOnly?: boolean
      accessibleClassIds: string[] | null
    },
  ) {
    return [...this.cards.values()].filter(
      (card) =>
        card.schoolId === actor.schoolId &&
        card.academicTermId === filter.academicTermId &&
        (!filter.classId || card.classId === filter.classId) &&
        (filter.accessibleClassIds === null ||
          filter.accessibleClassIds.includes(card.classId)),
    )
  }

  async getCard(actor: ReportActor, reportCardId: string) {
    const card = [...this.cards.values()].find(
      (item) => item.id === reportCardId && item.schoolId === actor.schoolId,
    )

    if (!card) {
      return null
    }

    const versions = [...this.versions.values()]
      .filter((item) => item.reportCardId === card.id)
      .sort((a, b) => b.version - a.version)
      .map((version) => this.withReleaseStatus(version))
    const input =
      this.inputs.get(
        key(actor.schoolId, card.academicTermId, card.pupilId),
      ) ?? null

    return { card, versions, input }
  }

  async getVersion(
    actor: ReportActor,
    reportCardId: string,
    version: number,
  ) {
    const card = [...this.cards.values()].find(
      (item) => item.id === reportCardId && item.schoolId === actor.schoolId,
    )

    if (!card) {
      return null
    }

    const found = this.versions.get(key(reportCardId, String(version)))

    if (!found || found.schoolId !== actor.schoolId) {
      return null
    }

    return {
      card,
      version: this.withReleaseStatus(found),
      storageKey: found.storageKey,
    }
  }

  /**
   * Test-only release shortcut for Phase 5 report-access tests. Production
   * release goes through ReportReleaseService and its audited state machine.
   */
  markBatchReleased(batchId: string, releasedByUserId = 'platform-test-user') {
    const batch = this.batches.get(batchId)

    if (!batch) {
      throw new Error('Batch not found')
    }

    batch.releaseStatus = 'RELEASED'
    batch.releasedAt = new Date()
    batch.releasedByUserId = releasedByUserId
    this.audits.push({
      action: 'REPORT_RELEASE_RELEASED',
      entityId: batch.id,
    })

    return batch
  }

  private withReleaseStatus(version: StoredVersion): StoredVersion {
    const batch = version.batchId ? this.batches.get(version.batchId) : null

    return {
      ...version,
      releaseStatus: batch?.releaseStatus ?? version.releaseStatus,
    }
  }

  async listBatches(
    actor: ReportActor,
    filter: { academicTermId?: string; classIds: string[] | null },
  ) {
    return [...this.batches.values()].filter(
      (batch) =>
        batch.schoolId === actor.schoolId &&
        (!filter.academicTermId ||
          batch.academicTermId === filter.academicTermId) &&
        (filter.classIds === null ||
          (batch.classId !== null && filter.classIds.includes(batch.classId))),
    )
  }

  async getBatch(actor: ReportActor, batchId: string): Promise<ReportBatchDetail | null> {
    const batch = this.batches.get(batchId)

    if (!batch || batch.schoolId !== actor.schoolId) {
      return null
    }

    const data = batch.classId
      ? this.findData(actor.schoolId, batch.classId)
      : null
    const failures = this.failures.filter(
      (failure) => failure.batchId === batch.id,
    )
    const versions = [...this.versions.values()]
      .filter((version) => version.batchId === batch.id)
      .map((version) => {
        const card = [...this.cards.values()].find(
          (item) => item.id === version.reportCardId,
        )!
        return {
          id: version.id,
          reportCardId: version.reportCardId,
          pupilId: card.pupilId,
          pupilName: card.pupilName,
          classId: card.classId,
          version: version.version,
          generatedAt: version.generatedAt,
        }
      })

    return {
      ...batch,
      className: data?.class.name ?? null,
      academicTermName: data?.academicTerm.name ?? 'Term',
      failures,
      versions,
    }
  }
}
