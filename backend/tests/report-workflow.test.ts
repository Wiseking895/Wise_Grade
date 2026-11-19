import { describe, expect, it, vi } from 'vitest'
import { HttpError } from '../src/errors/http-error.js'
import { ReportReleaseService } from '../src/reports/release-service.js'
import type {
  PlatformReportActor,
  ReportReleaseActor,
  ReportReleaseAuditContext,
} from '../src/reports/release-repository.js'
import type {
  ReportActor,
  ReportAuditContext,
  ReportGenerationData,
} from '../src/reports/repository.js'
import { ReportService } from '../src/reports/service.js'
import { ReportWorkflowService } from '../src/reports/workflow-service.js'
import { MemoryStorageAdapter } from '../src/storage/storage.js'
import { FakeReportRepository } from './helpers/fake-report-repository.js'
import {
  buildReleaseSeed,
  FakeReportReleaseRepository,
} from './helpers/fake-release-repository.js'
import { makeReportData } from './helpers/report-fixtures.js'
import { extractPdfText } from './helpers/pdf-text.js'

const admin: ReportActor = {
  schoolId: 'school-1',
  userId: 'user-admin',
  membershipId: 'membership-admin',
  role: 'SCHOOL_ADMIN',
}

const platformActor: PlatformReportActor = { userId: 'platform-user' }

const schoolActor: ReportReleaseActor = {
  schoolId: 'school-1',
  userId: admin.userId,
  membershipId: 'membership-admin',
  role: 'SCHOOL_ADMIN',
}

const audit: ReportAuditContext = {
  actorUserId: admin.userId,
  actorMembershipId: admin.membershipId,
  ipAddress: '127.0.0.1',
  userAgent: 'vitest',
}

const releaseAudit: ReportReleaseAuditContext = {
  actorUserId: platformActor.userId,
  actorMembershipId: null,
  actorRole: 'PLATFORM_SUPER_ADMIN',
  ipAddress: '127.0.0.1',
}

function secondClassData(): ReportGenerationData {
  const data = makeReportData({
    className: 'Basic 5',
    pupils: [
      {
        id: 'pupil-yaw',
        firstName: 'Yaw',
        lastName: 'Asante',
        admissionNumber: 'GVA/2026/004',
        scores: { 'sub-math': '90.00', 'sub-english': '85.00', 'sub-science': '80.00' },
      },
      {
        id: 'pupil-ama',
        firstName: 'Ama',
        lastName: 'Darko',
        admissionNumber: 'GVA/2026/005',
        scores: { 'sub-math': '75.00', 'sub-english': '70.00', 'sub-science': '65.00' },
      },
    ],
  })
  data.class.id = 'class-2'
  return data
}

function requestService(
  data: ReportGenerationData[] = [makeReportData()],
  storage: MemoryStorageAdapter = new MemoryStorageAdapter(),
) {
  const repository = new FakeReportRepository(data)
  const service = new ReportService({ repository, storage })
  return { repository, storage, service }
}

/**
 * Simulates a pupil enrolling after a request was created. The enrollment
 * timestamp is deliberately later than the request so snapshot reconstruction
 * can distinguish the two pupils.
 */
function addLaterPupil(
  data: ReportGenerationData,
  pupil: {
    id: string
    firstName: string
    lastName: string
    admissionNumber: string
  },
  enrolledAt = new Date(Date.now() + 24 * 60 * 60 * 1000),
) {
  const extra = makeReportData({
    pupils: [
      {
        ...pupil,
        scores: {
          'sub-math': '82.00',
          'sub-english': '78.00',
          'sub-science': '74.00',
        },
        daysOpened: 60,
        daysAttended: 57,
        enrolledAt,
      },
    ],
  })

  data.pupils.push(extra.pupils[0]!)
  data.scores.push(...extra.scores)
  data.inputs.push(...extra.inputs)
  data.onRoll = data.pupils.length
}

function requestDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'batch-1',
    schoolId: 'school-1',
    schoolName: 'Green Valley Academy',
    academicYearId: 'year-1',
    academicTermId: 'term-1',
    classId: null,
    className: null,
    scope: 'TERM',
    generationStatus: 'PENDING',
    requestedPupilCount: 3,
    generatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    reportCount: 0,
    releaseStatus: 'APPROVED',
    previousReleaseStatus: null,
    submittedAt: new Date('2026-11-01T00:00:00.000Z'),
    submittedByName: 'School Administrator',
    reviewedAt: new Date('2026-11-01T01:00:00.000Z'),
    reviewedByName: 'Platform Reviewer',
    returnedReason: null,
    holdReason: null,
    heldAt: null,
    heldByName: null,
    releasedAt: null,
    releasedByName: null,
    eligibility: { eligible: true, issues: [] },
    versions: [],
    ...overrides,
  }
}

function workflowStubs() {
  const reports = {
    createRequest: vi.fn(),
    getRequest: vi.fn().mockResolvedValue({ batch: {}, classes: [] }),
    generateIntoBatch: vi.fn(),
    failBatch: vi.fn().mockResolvedValue(undefined),
  }
  const releases = {
    approveRequest: vi.fn(),
    rejectRequest: vi.fn(),
    release: vi.fn(),
    getPlatformBatch: vi.fn(),
    recordGenerationFailure: vi.fn().mockResolvedValue(undefined),
    listPlatformBatches: vi.fn(),
    listSchoolBatches: vi.fn(),
  }

  const workflow = new ReportWorkflowService({
    reports: reports as unknown as ReportService,
    releases: releases as unknown as ReportReleaseService,
  })

  return { workflow, reports, releases }
}

describe('ReportService term request', () => {
  it('creates one admin-accepted term-wide request ready for generation', async () => {
    const { service } = requestService()

    const result = await service.createRequest(
      admin,
      { academicYearId: 'year-1', academicTermId: 'term-1' },
      audit,
    )

    expect(result.batch).toMatchObject({
      scope: 'TERM',
      status: 'PENDING',
      releaseStatus: 'APPROVED',
      classId: null,
    })
    expect(result.batch.submittedAt).toBeInstanceOf(Date)
    expect(result.batch.submittedByMembershipId).toBe(admin.membershipId)
    expect(result.classes).toHaveLength(1)
    expect(result.classes[0]).toMatchObject({
      classId: 'class-1',
      className: 'Basic 6',
      pupilCount: 3,
      eligiblePupilCount: 3,
      acceptedResultCount: 9,
      ineligiblePupilCount: 0,
    })
  })

  it('rejects a duplicate pending request for the same term', async () => {
    const { service } = requestService()
    const input = { academicYearId: 'year-1', academicTermId: 'term-1' }

    await service.createRequest(admin, input, audit)

    await expect(service.createRequest(admin, input, audit)).rejects.toMatchObject(
      { statusCode: 409 },
    )
  })

  it('allows a new request that adds a pupil an earlier request did not cover', async () => {
    const data = makeReportData({
      pupils: [
        {
          id: 'pupil-kwame',
          firstName: 'Kwame',
          lastName: 'Appiah',
          admissionNumber: 'BW/2026/0075',
          scores: {
            'sub-math': '80.00',
            'sub-english': '68.70',
            'sub-science': '82.60',
          },
          daysOpened: 66,
          daysAttended: 57,
        },
      ],
    })
    const { service, repository } = requestService([data])

    // A historical class-wide request. Its creation time predates the second
    // pupil's enrollment, so that pupil is not part of the request snapshot.
    const legacy = await repository.createBatch(
      admin,
      {
        academicYearId: 'year-1',
        academicTermId: 'term-1',
        classId: 'class-1',
        scope: 'CLASS',
        requestedPupilCount: 1,
        status: 'PENDING',
        releaseStatus: 'APPROVED',
      },
      audit,
    )
    repository.batches.get(legacy.id)!.createdAt = new Date(
      Date.now() - 120_000,
    )

    addLaterPupil(
      data,
      {
        id: 'pupil-dominic',
        firstName: 'Dominic',
        lastName: 'Yeboah',
        admissionNumber: 'BW/2026/00754',
      },
      new Date(Date.now() - 60_000),
    )

    const historic = await service.generateIntoBatch(admin, legacy.id, audit)
    expect(historic.batch.generatedCount).toBe(1)
    expect(historic.results.map((item) => item.pupilId)).toEqual([
      'pupil-kwame',
    ])
    repository.markReleased(legacy.id)

    // The new term request covers both pupils. The pupil who already has a
    // released final report is reused, not duplicated; only the new pupil is
    // generated.
    const request = await service.createRequest(
      admin,
      { academicYearId: 'year-1', academicTermId: 'term-1' },
      audit,
    )
    expect(request.batch.requestedPupilCount).toBe(2)

    const consolidated = await service.generateIntoBatch(
      admin,
      request.batch.id,
      audit,
    )

    expect(consolidated.batch).toMatchObject({
      status: 'COMPLETED',
      requestedPupilCount: 2,
      generatedCount: 1,
      skippedCount: 1,
      failedCount: 0,
    })
    expect(
      consolidated.results.find((item) => item.pupilId === 'pupil-kwame'),
    ).toMatchObject({ status: 'SKIPPED', version: 1 })
    expect(
      consolidated.results.find((item) => item.pupilId === 'pupil-dominic'),
    ).toMatchObject({ status: 'GENERATED', version: 1 })

    const kwameCard = [...repository.cards.values()].find(
      (card) => card.pupilId === 'pupil-kwame',
    )!
    const kwameVersions = [...repository.versions.values()].filter(
      (version) => version.reportCardId === kwameCard.id,
    )
    expect(kwameVersions).toHaveLength(1)
    expect(repository.cards.size).toBe(2)
    expect(repository.versions.size).toBe(2)
  })

  it('refuses a new request when every pupil already has a released final report', async () => {
    const { service, repository } = requestService()
    const request = await service.createRequest(
      admin,
      { academicYearId: 'year-1', academicTermId: 'term-1' },
      audit,
    )

    const generated = await service.generateIntoBatch(
      admin,
      request.batch.id,
      audit,
    )
    expect(generated.batch.generatedCount).toBe(3)
    repository.markReleased(request.batch.id)

    await expect(
      service.createRequest(
        admin,
        { academicYearId: 'year-1', academicTermId: 'term-1' },
        audit,
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/released final report/i),
    })

    // Nothing was rewritten by the refused request.
    expect(repository.cards.size).toBe(3)
    expect(repository.versions.size).toBe(3)
  })

  it('consolidates four historical requests into one final report per pupil', async () => {
    const data = makeReportData({
      pupils: [
        {
          id: 'pupil-kwame',
          firstName: 'Kwame',
          lastName: 'Appiah',
          admissionNumber: 'BW/2026/0075',
          scores: {
            'sub-math': '80.00',
            'sub-english': '68.70',
            'sub-science': '82.60',
          },
          daysOpened: 66,
          daysAttended: 57,
        },
      ],
    })
    const { service, repository } = requestService([data])

    // Bright World's four class-wide requests: same school, year, term and
    // class, each with a one-pupil snapshot. They are duplicate generation
    // requests, not separate subject submissions.
    const batches = []

    for (let index = 0; index < 4; index += 1) {
      batches.push(
        await repository.createBatch(
          admin,
          {
            academicYearId: 'year-1',
            academicTermId: 'term-1',
            classId: 'class-1',
            scope: 'CLASS',
            requestedPupilCount: 1,
            status: index === 0 ? 'PENDING' : 'FAILED',
            releaseStatus: 'APPROVED',
          },
          audit,
        ),
      )
    }

    const first = await service.generateIntoBatch(
      admin,
      batches[0]!.id,
      audit,
    )
    expect(first.batch.status).toBe('COMPLETED')
    expect(first.batch.generatedCount).toBe(1)
    repository.markReleased(batches[0]!.id)

    for (const duplicate of batches.slice(1)) {
      await expect(
        service.generateIntoBatch(admin, duplicate.id, audit),
      ).rejects.toMatchObject({
        statusCode: 409,
        details: { code: 'ALREADY_CONSOLIDATED' },
      })

      // The duplicate request is left exactly as it was: no version, no
      // failure, no status change.
      expect(repository.batches.get(duplicate.id)?.status).toBe('FAILED')
      expect(repository.batches.get(duplicate.id)?.generatedCount).toBe(0)
    }

    expect(repository.cards.size).toBe(1)
    expect(repository.versions.size).toBe(1)
    expect([...repository.versions.values()][0]!.batchId).toBe(batches[0]!.id)
  })

  it('allows a corrected request after a fully failed batch produced nothing', async () => {
    const { service, repository } = requestService()
    const existing = await repository.createBatch(
      admin,
      {
        academicYearId: 'year-1',
        academicTermId: 'term-1',
        classId: 'class-1',
        scope: 'CLASS',
        requestedPupilCount: 1,
        status: 'FAILED',
        releaseStatus: 'PENDING_PLATFORM_REVIEW',
      },
      audit,
    )
    existing.failedCount = 1

    const result = await service.createRequest(
      admin,
      { academicYearId: 'year-1', academicTermId: 'term-1' },
      audit,
    )

    expect(result.batch).toMatchObject({
      scope: 'TERM',
      status: 'PENDING',
      releaseStatus: 'APPROVED',
    })
  })

  it('refuses to request reports when no accepted results exist', async () => {
    const data = makeReportData({ submissions: [] })
    data.scores = []
    const { service } = requestService([data])

    await expect(
      service.createRequest(
        admin,
        { academicYearId: 'year-1', academicTermId: 'term-1' },
        audit,
      ),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('denies a non-administrator the ability to request reports', async () => {
    const { service } = requestService()
    const teacher: ReportActor = {
      ...admin,
      userId: 'user-teacher',
      membershipId: 'membership-teacher',
      role: 'CLASS_TEACHER',
    }

    await expect(
      service.createRequest(
        teacher,
        { academicYearId: 'year-1', academicTermId: 'term-1' },
        audit,
      ),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('generates every eligible class into the approved request batch', async () => {
    const { service, repository } = requestService([
      makeReportData(),
      secondClassData(),
    ])

    const request = await service.createRequest(
      admin,
      { academicYearId: 'year-1', academicTermId: 'term-1' },
      audit,
    )

    const generated = await service.generateIntoBatch(
      admin,
      request.batch.id,
      audit,
    )

    expect(generated.batch.id).toBe(request.batch.id)
    expect(generated.batch.status).toBe('COMPLETED')
    expect(generated.batch.generatedCount).toBe(5)
    expect(generated.batch.failedCount).toBe(0)
    expect(generated.results).toHaveLength(5)
    expect(repository.cards.size).toBe(5)

    const detail = await service.getRequest(admin, request.batch.id)
    expect(detail.batch.versions).toHaveLength(5)
    expect(detail.classes.map((item) => item.classId).sort()).toEqual([
      'class-1',
      'class-2',
    ])
    expect(detail.classes.every((item) => item.status === 'COMPLETED')).toBe(
      true,
    )
    expect(
      detail.classes.reduce((total, item) => total + item.generatedCount, 0),
    ).toBe(5)
  })

  it('keeps request counters on the original pupil snapshot after a later enrollment', async () => {
    const { service, repository } = requestService()
    const request = await service.createRequest(
      admin,
      { academicYearId: 'year-1', academicTermId: 'term-1' },
      audit,
    )

    const generated = await service.generateIntoBatch(
      admin,
      request.batch.id,
      audit,
    )
    expect(generated.batch.requestedPupilCount).toBe(3)
    expect(generated.batch.generatedCount).toBe(3)

    // Bright World enrolled a second pupil after the earlier request had
    // already run. That pupil must not appear inside the finished request.
    repository.data[0]!.pupils.push({
      id: 'pupil-late-enrollee',
      firstName: 'Late',
      lastName: 'Enrollee',
      otherNames: null,
      admissionNumber: 'GVA/2026/099',
      gender: null,
      photoReference: null,
      status: 'ACTIVE',
    })

    const detail = await service.getRequest(admin, request.batch.id)

    expect(detail.classes).toHaveLength(1)
    expect(detail.classes[0]).toMatchObject({
      pupilCount: 3,
      generatedCount: 3,
      failedCount: 0,
      ineligiblePupilCount: 0,
      // Three accepted subjects (from the immutable snapshot) per pupil.
      acceptedResultCount: 9,
      status: 'COMPLETED',
    })
    expect(
      detail.batch.generatedCount +
        detail.batch.skippedCount +
        detail.batch.failedCount,
    ).toBe(detail.batch.requestedPupilCount)
  })

  it('reconciles counters when a request aborts before any pupil is generated', async () => {
    const { service } = requestService()
    const request = await service.createRequest(
      admin,
      { academicYearId: 'year-1', academicTermId: 'term-1' },
      audit,
    )

    await service.failBatch(
      admin,
      request.batch.id,
      'Private storage is unavailable.',
    )

    const detail = await service.getRequest(admin, request.batch.id)

    expect(detail.batch.failedCount).toBe(detail.batch.requestedPupilCount)
    expect(
      detail.batch.generatedCount +
        detail.batch.skippedCount +
        detail.batch.failedCount,
    ).toBe(detail.batch.requestedPupilCount)
    expect(detail.classes).toHaveLength(1)
    expect(detail.classes[0]).toMatchObject({
      pupilCount: detail.batch.requestedPupilCount,
      failedCount: detail.batch.failedCount,
      acceptedResultCount: 0,
      status: 'FAILED',
    })
  })

  it('links generated versions to the request and keeps accepted snapshots', async () => {
    const { service, repository, storage } = requestService()

    const request = await service.createRequest(
      admin,
      { academicYearId: 'year-1', academicTermId: 'term-1' },
      audit,
    )
    await service.generateIntoBatch(admin, request.batch.id, audit)

    const versions = [...repository.versions.values()]
    expect(versions).toHaveLength(3)
    expect(versions.every((version) => version.batchId === request.batch.id)).toBe(
      true,
    )
    expect(
      [...repository.cards.values()].every((card) => card.classId === 'class-1'),
    ).toBe(true)

    for (const version of versions) {
      expect(version.snapshot).toMatchObject({
        school: { name: 'Green Valley Academy' },
        source: { acceptedSubmissions: 3 },
        ranking: { enabled: true },
      })
      const stored = await storage.getObject(version.storageKey)
      expect(stored).not.toBeNull()
      const text = await extractPdfText(stored!)
      expect(text).toContain('GREEN VALLEY ACADEMY')
      expect(text).toContain('INTERNAL DRAFT')
    }
  })

  it('retries only failed pupils into the same request batch', async () => {
    class FlakyStorage extends MemoryStorageAdapter {
      failFor: string | null = null

      override async putObject(
        key: string,
        data: Buffer,
        contentType: string,
      ) {
        if (this.failFor && key.includes(this.failFor)) {
          throw new Error('Simulated storage outage')
        }

        return super.putObject(key, data, contentType)
      }
    }

    const storage = new FlakyStorage()
    const { service, repository } = requestService([makeReportData()], storage)
    storage.failFor = 'pupil-esi'

    const request = await service.createRequest(
      admin,
      { academicYearId: 'year-1', academicTermId: 'term-1' },
      audit,
    )
    const first = await service.generateIntoBatch(
      admin,
      request.batch.id,
      audit,
    )
    expect(first.batch.status).toBe('COMPLETED_WITH_FAILURES')
    expect(first.batch.generatedCount).toBe(2)
    expect(first.batch.failedCount).toBe(1)
    expect(repository.failures).toHaveLength(1)
    expect(repository.failures[0]!.code).toBe('GENERATION_FAILED')

    const successful = [...repository.versions.entries()].map(
      ([id, version]) => ({
        id,
        reportCardId: version.reportCardId,
        checksum: version.checksum,
        generatedAt: version.generatedAt.getTime(),
      }),
    )
    expect(successful).toHaveLength(2)

    storage.failFor = null

    const retried = await service.generateIntoBatch(
      admin,
      request.batch.id,
      audit,
      { retry: true },
    )

    expect(retried.batch.id).toBe(request.batch.id)
    expect(retried.batch.status).toBe('COMPLETED')
    expect(retried.batch.generatedCount).toBe(3)
    expect(retried.batch.failedCount).toBe(0)
    expect(retried.results).toHaveLength(1)
    expect(retried.results[0]!.pupilId).toBe('pupil-esi')
    expect(repository.failures).toHaveLength(0)
    expect(repository.cards.size).toBe(3)

    // The reports that succeeded before the retry are untouched: same version
    // row, same checksum and same generation timestamp.
    for (const version of successful) {
      const stored = repository.versions.get(version.id)
      expect(stored).toMatchObject({
        reportCardId: version.reportCardId,
        checksum: version.checksum,
      })
      expect(stored?.generatedAt.getTime()).toBe(version.generatedAt)
    }
  })

  it('records a clear reason for an ineligible pupil instead of silently dropping them', async () => {
    const data = makeReportData()
    data.scores = data.scores.filter(
      (score) =>
        !(score.pupilId === 'pupil-esi' && score.subjectId === 'sub-science'),
    )
    const { service, repository } = requestService([data])

    const request = await service.createRequest(
      admin,
      { academicYearId: 'year-1', academicTermId: 'term-1' },
      audit,
    )
    const generated = await service.generateIntoBatch(
      admin,
      request.batch.id,
      audit,
    )

    expect(generated.batch.status).toBe('COMPLETED_WITH_FAILURES')
    expect(generated.batch.requestedPupilCount).toBe(3)
    expect(generated.batch.generatedCount).toBe(2)
    expect(generated.batch.failedCount).toBe(1)
    expect(generated.results).toHaveLength(3)

    const ineligible = generated.results.find(
      (item) => item.pupilId === 'pupil-esi',
    )
    expect(ineligible).toMatchObject({
      status: 'FAILED',
      failureCode: 'RESULT_MISSING',
    })
    expect(ineligible?.failureMessage).toBeTruthy()

    expect(repository.failures).toHaveLength(1)
    expect(repository.failures[0]).toMatchObject({
      pupilId: 'pupil-esi',
      code: 'RESULT_MISSING',
    })
    expect(repository.cards.size).toBe(2)
    expect(
      generated.batch.generatedCount +
        generated.batch.skippedCount +
        generated.batch.failedCount,
    ).toBe(generated.batch.requestedPupilCount)
  })

  it('refreshes eligibility only for the original pupil of a historical one-pupil request', async () => {
    const data = makeReportData({
      pupils: [
        {
          id: 'pupil-historic',
          firstName: 'Kwame',
          lastName: 'Appiah',
          admissionNumber: 'BW/2026/0075',
          scores: {
            'sub-math': '80.00',
            'sub-english': '75.00',
            'sub-science': '70.00',
          },
          daysOpened: 60,
          daysAttended: 57,
        },
      ],
    })
    const { service, repository } = requestService([data])

    const request = await service.createRequest(
      admin,
      { academicYearId: 'year-1', academicTermId: 'term-1' },
      audit,
    )
    expect(request.batch.requestedPupilCount).toBe(1)

    // Attendance was cleared after the request existed, which is what produced
    // the historical ATTENDANCE_MISSING failure for this request.
    const historicInput = data.inputs.find(
      (item) => item.pupilId === 'pupil-historic',
    )!
    historicInput.daysOpened = null
    historicInput.daysAttended = null

    const blocked = await service.generateIntoBatch(
      admin,
      request.batch.id,
      audit,
    )
    expect(blocked.batch.status).toBe('FAILED')
    expect(blocked.batch.requestedPupilCount).toBe(1)
    expect(blocked.batch.failedCount).toBe(1)
    expect(repository.failures[0]).toMatchObject({
      pupilId: 'pupil-historic',
      code: 'ATTENDANCE_MISSING',
    })

    // The second pupil enrolls only after the request was created. They must
    // not be added to the historical request.
    addLaterPupil(data, {
      id: 'pupil-late',
      firstName: 'Dominic',
      lastName: 'Yeboah',
      admissionNumber: 'BW/2026/00754',
    })

    // Correcting the original pupil's attendance refreshes eligibility for
    // exactly that pupil.
    const input = data.inputs.find(
      (item) => item.pupilId === 'pupil-historic',
    )!
    input.daysOpened = 60
    input.daysAttended = 57

    const refreshed = await service.generateIntoBatch(
      admin,
      request.batch.id,
      audit,
    )

    expect(refreshed.batch.status).toBe('COMPLETED')
    expect(refreshed.batch.requestedPupilCount).toBe(1)
    expect(refreshed.batch.generatedCount).toBe(1)
    expect(refreshed.batch.failedCount).toBe(0)
    expect(refreshed.results.map((item) => item.pupilId)).toEqual([
      'pupil-historic',
    ])
    expect(
      [...repository.cards.values()].map((card) => card.pupilId),
    ).toEqual(['pupil-historic'])
    expect(repository.failures).toHaveLength(0)
  })

  it('uses the creation-time enrollment snapshot when an aborted request has no per-pupil rows', async () => {
    const data = makeReportData({
      pupils: [
        {
          id: 'pupil-original',
          firstName: 'Original',
          lastName: 'Pupil',
          admissionNumber: 'BW/2026/0075',
          scores: {
            'sub-math': '80.00',
            'sub-english': '75.00',
            'sub-science': '70.00',
          },
        },
      ],
    })
    const { service, repository } = requestService([data])
    const request = await service.createRequest(
      admin,
      { academicYearId: 'year-1', academicTermId: 'term-1' },
      audit,
    )

    await service.failBatch(
      admin,
      request.batch.id,
      'Private storage is unavailable.',
    )

    addLaterPupil(data, {
      id: 'pupil-after-abort',
      firstName: 'Later',
      lastName: 'Pupil',
      admissionNumber: 'BW/2026/00754',
    })

    const generated = await service.generateIntoBatch(
      admin,
      request.batch.id,
      audit,
    )

    expect(generated.batch.status).toBe('COMPLETED')
    expect(generated.batch.requestedPupilCount).toBe(1)
    expect(generated.batch.generatedCount).toBe(1)
    expect(generated.results.map((item) => item.pupilId)).toEqual([
      'pupil-original',
    ])
    expect(
      [...repository.cards.values()].map((card) => card.pupilId),
    ).toEqual(['pupil-original'])
  })

  it('generates both pupils of a new two-pupil request exactly once', async () => {
    const data = makeReportData({
      pupils: [
        {
          id: 'pupil-a',
          firstName: 'Ama',
          lastName: 'Mensah',
          admissionNumber: 'BW/2026/0075',
          scores: {
            'sub-math': '90.00',
            'sub-english': '85.00',
            'sub-science': '80.00',
          },
        },
        {
          id: 'pupil-b',
          firstName: 'Kofi',
          lastName: 'Owusu',
          admissionNumber: 'BW/2026/00754',
          scores: {
            'sub-math': '75.00',
            'sub-english': '70.00',
            'sub-science': '65.00',
          },
        },
      ],
    })
    const { service, repository } = requestService([data])

    const request = await service.createRequest(
      admin,
      { academicYearId: 'year-1', academicTermId: 'term-1' },
      audit,
    )
    expect(request.batch.requestedPupilCount).toBe(2)

    const generated = await service.generateIntoBatch(
      admin,
      request.batch.id,
      audit,
    )

    expect(generated.batch).toMatchObject({
      status: 'COMPLETED',
      requestedPupilCount: 2,
      generatedCount: 2,
      skippedCount: 0,
      failedCount: 0,
    })
    expect(generated.results).toHaveLength(2)
    expect(
      generated.batch.generatedCount +
        generated.batch.skippedCount +
        generated.batch.failedCount,
    ).toBe(generated.batch.requestedPupilCount)
    expect(
      [...repository.cards.values()]
        .map((card) => card.pupilId)
        .sort(),
    ).toEqual(['pupil-a', 'pupil-b'])
    expect(repository.versions.size).toBe(2)

    // Both cards are built from every accepted subject for the class: multiple
    // subject submissions contribute to one consolidated report per pupil.
    for (const version of repository.versions.values()) {
      const snapshot = version.snapshot as {
        academic: { subjects: unknown[] }
        source: { acceptedSubmissions: number }
      }

      expect(snapshot.academic.subjects).toHaveLength(3)
      expect(snapshot.source.acceptedSubmissions).toBe(3)
    }

    // A second Generate must not create duplicate versions.
    await expect(
      service.generateIntoBatch(admin, request.batch.id, audit),
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(repository.versions.size).toBe(2)
  })

  it('marks a request FAILED when generation aborts so retry is possible', async () => {
    const { service, repository } = requestService()
    const request = await service.createRequest(
      admin,
      { academicYearId: 'year-1', academicTermId: 'term-1' },
      audit,
    )

    await service.failBatch(
      admin,
      request.batch.id,
      'Private storage is unavailable.',
    )

    const detail = await service.getRequest(admin, request.batch.id)

    expect(detail.batch.status).toBe('FAILED')
    expect(detail.batch.fatalError).toBe('Private storage is unavailable.')
    expect(repository.audits).toContainEqual(
      expect.objectContaining({
        action: 'REPORT_GENERATION_ABORTED',
        entityId: request.batch.id,
      }),
    )
  })
})

describe('ReportReleaseService request approval', () => {
  function setup(options: Parameters<typeof buildReleaseSeed>[1] = {}) {
    const repository = new FakeReportReleaseRepository()
    const storage = new MemoryStorageAdapter()
    const service = new ReportReleaseService({ repository, storage })
    return { repository, service, storage, options }
  }

  it('approves a pending request without requiring reports or payment', async () => {
    const context = setup()
    const seed = await buildReleaseSeed(context.storage, {
      releaseStatus: 'PENDING_PLATFORM_REVIEW',
      batchStatus: 'PENDING',
      generatedCount: 0,
      includeInvoice: false,
    })
    context.repository.seed(seed)

    const approved = await context.service.approveRequest(
      platformActor,
      seed.record.batch.id,
      releaseAudit,
    )

    expect(approved.releaseStatus).toBe('APPROVED')
    expect(context.repository.transitions.at(-1)).toMatchObject({
      action: 'REPORT_RELEASE_APPROVED',
      expected: ['PENDING_PLATFORM_REVIEW'],
      next: 'APPROVED',
      requireEligible: false,
    })
  })

  it('approves a failed legacy request so Generate can re-evaluate eligibility', async () => {
    const context = setup()
    const seed = await buildReleaseSeed(context.storage, {
      releaseStatus: 'PENDING_PLATFORM_REVIEW',
      batchStatus: 'FAILED',
      generatedCount: 0,
      failedCount: 1,
      includeInvoice: false,
      failures: [
        {
          pupilId: 'pupil-kwame',
          pupilName: 'Kwame Appiah',
          code: 'ATTENDANCE_MISSING',
          message:
            'School days opened and days attended are required before generation.',
        },
      ],
    })
    // A failed request produced no report versions.
    seed.record.versions = []
    context.repository.seed(seed)

    const approved = await context.service.approveRequest(
      platformActor,
      seed.record.batch.id,
      releaseAudit,
    )

    expect(approved.releaseStatus).toBe('APPROVED')
    expect(approved.generationStatus).toBe('FAILED')
    expect(approved.eligibility).toEqual({ eligible: true, issues: [] })
    expect(approved.failures).toEqual([
      {
        pupilId: 'pupil-kwame',
        pupilName: 'Kwame Appiah',
        code: 'ATTENDANCE_MISSING',
        message:
          'School days opened and days attended are required before generation.',
      },
    ])
    expect(context.repository.transitions.at(-1)).toMatchObject({
      action: 'REPORT_RELEASE_APPROVED',
      expected: ['PENDING_PLATFORM_REVIEW'],
      next: 'APPROVED',
      requireEligible: false,
    })
  })

  it('distinguishes eligibility blockers from retryable generation failures', async () => {
    const context = setup()
    const blocking = await buildReleaseSeed(context.storage, {
      releaseStatus: 'APPROVED',
      batchStatus: 'COMPLETED_WITH_FAILURES',
      generatedCount: 1,
      failedCount: 1,
      failures: [
        {
          pupilId: 'pupil-ineligible',
          pupilName: 'Ineligible Pupil',
          code: 'RESULT_NOT_ACCEPTED',
          message: 'Creative Art results have not been accepted.',
        },
      ],
    })
    const retryable = await buildReleaseSeed(context.storage, {
      releaseStatus: 'APPROVED',
      batchStatus: 'COMPLETED_WITH_FAILURES',
      generatedCount: 1,
      failedCount: 1,
      failures: [
        {
          pupilId: 'pupil-storage',
          pupilName: 'Storage Pupil',
          code: 'GENERATION_FAILED',
          message: 'Private storage is unavailable.',
        },
      ],
    })
    context.repository.seed(blocking)
    context.repository.seed(retryable)

    const summaries = await context.service.listPlatformBatches({})
    const blockingSummary = summaries.find(
      (item) => item.id === blocking.record.batch.id,
    )!
    const retryableSummary = summaries.find(
      (item) => item.id === retryable.record.batch.id,
    )!

    expect(blockingSummary).toMatchObject({
      failedCount: 1,
      failureCodes: ['RESULT_NOT_ACCEPTED'],
      retryableFailureCount: 0,
    })
    expect(retryableSummary).toMatchObject({
      failedCount: 1,
      failureCodes: ['GENERATION_FAILED'],
      retryableFailureCount: 1,
    })
  })

  it('rejects an approval when the school is suspended', async () => {
    const context = setup()
    const seed = await buildReleaseSeed(context.storage, {
      releaseStatus: 'PENDING_PLATFORM_REVIEW',
      batchStatus: 'PENDING',
      generatedCount: 0,
      schoolIsActive: false,
    })
    context.repository.seed(seed)

    await expect(
      context.service.approveRequest(
        platformActor,
        seed.record.batch.id,
        releaseAudit,
      ),
    ).rejects.toMatchObject({ statusCode: 409 })

    expect(context.repository.failedAttempts).toHaveLength(1)
    expect(context.repository.failedAttempts[0]).toMatchObject({
      action: 'REPORT_RELEASE_APPROVAL_FAILED',
    })
  })

  it('requires a reason and records the rejection', async () => {
    const context = setup()
    const seed = await buildReleaseSeed(context.storage, {
      releaseStatus: 'PENDING_PLATFORM_REVIEW',
      batchStatus: 'PENDING',
      generatedCount: 0,
    })
    context.repository.seed(seed)

    await expect(
      context.service.rejectRequest(
        platformActor,
        seed.record.batch.id,
        '   ',
        releaseAudit,
      ),
    ).rejects.toBeInstanceOf(HttpError)

    const rejected = await context.service.rejectRequest(
      platformActor,
      seed.record.batch.id,
      'Attendance figures need correction.',
      releaseAudit,
    )

    expect(rejected.releaseStatus).toBe('RETURNED')
    expect(rejected.returnedReason).toBe('Attendance figures need correction.')
    expect(context.repository.transitions.at(-1)).toMatchObject({
      action: 'REPORT_REQUEST_REJECTED',
      next: 'RETURNED',
    })
  })

  it('refuses to approve a request that is not awaiting review', async () => {
    const context = setup()
    const seed = await buildReleaseSeed(context.storage, {
      releaseStatus: 'GENERATED',
      batchStatus: 'PENDING',
      generatedCount: 0,
    })
    context.repository.seed(seed)

    await expect(
      context.service.approveRequest(
        platformActor,
        seed.record.batch.id,
        releaseAudit,
      ),
    ).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe('ReportWorkflowService orchestration', () => {
  it('generates an accepted request and makes the completed batch available', async () => {
    const { workflow, reports, releases } = workflowStubs()
    releases.getPlatformBatch.mockResolvedValue(
      requestDetail({ releaseStatus: 'APPROVED', generationStatus: 'PENDING' }),
    )
    reports.generateIntoBatch.mockResolvedValue({
      batch: { id: 'batch-1', status: 'COMPLETED' },
      results: [{ pupilId: 'pupil-ada', status: 'GENERATED' }],
    })
    releases.release.mockResolvedValue(
      requestDetail({
        releaseStatus: 'RELEASED',
        generationStatus: 'COMPLETED',
      }),
    )

    const outcome = await workflow.generate(
      platformActor,
      'batch-1',
      releaseAudit,
    )

    expect(reports.generateIntoBatch).toHaveBeenCalledWith(
      expect.objectContaining({ schoolId: 'school-1' }),
      'batch-1',
      expect.any(Object),
      { retry: false },
    )
    expect(releases.release).toHaveBeenCalledWith(
      platformActor,
      'batch-1',
      releaseAudit,
    )
    expect(outcome.batch.releaseStatus).toBe('RELEASED')
    expect(outcome.results).toHaveLength(1)
  })

  it('normalises a legacy review-queue request without a second academic approval', async () => {
    const { workflow, reports, releases } = workflowStubs()
    releases.getPlatformBatch.mockResolvedValue(
      requestDetail({
        releaseStatus: 'PENDING_PLATFORM_REVIEW',
        generationStatus: 'PENDING',
      }),
    )
    releases.approveRequest.mockResolvedValue(
      requestDetail({ releaseStatus: 'APPROVED', generationStatus: 'PENDING' }),
    )
    reports.generateIntoBatch.mockResolvedValue({
      batch: { id: 'batch-1', status: 'COMPLETED' },
      results: [],
    })
    releases.release.mockResolvedValue(
      requestDetail({ releaseStatus: 'RELEASED', generationStatus: 'COMPLETED' }),
    )

    const outcome = await workflow.generate(
      platformActor,
      'batch-1',
      releaseAudit,
    )

    expect(releases.approveRequest).toHaveBeenCalledWith(
      platformActor,
      'batch-1',
      releaseAudit,
    )
    expect(outcome.batch.releaseStatus).toBe('RELEASED')
  })

  it('does not make reports available when generation has partial failures', async () => {
    const { workflow, reports, releases } = workflowStubs()
    releases.getPlatformBatch.mockResolvedValue(
      requestDetail({ releaseStatus: 'APPROVED', generationStatus: 'PENDING' }),
    )
    reports.generateIntoBatch.mockResolvedValue({
      batch: { id: 'batch-1', status: 'COMPLETED_WITH_FAILURES' },
      results: [{ pupilId: 'pupil-ada', status: 'FAILED' }],
    })
    releases.getPlatformBatch
      .mockResolvedValueOnce(
        requestDetail({ releaseStatus: 'APPROVED', generationStatus: 'PENDING' }),
      )
      .mockResolvedValueOnce(
        requestDetail({
          releaseStatus: 'APPROVED',
          generationStatus: 'COMPLETED_WITH_FAILURES',
          failedCount: 1,
        }),
      )

    const outcome = await workflow.generate(
      platformActor,
      'batch-1',
      releaseAudit,
    )

    expect(releases.release).not.toHaveBeenCalled()
    expect(outcome.batch.releaseStatus).toBe('APPROVED')
  })

  it('records a generation failure and rethrows', async () => {
    const { workflow, reports, releases } = workflowStubs()
    releases.getPlatformBatch.mockResolvedValue(
      requestDetail({ releaseStatus: 'APPROVED', generationStatus: 'PENDING' }),
    )
    reports.generateIntoBatch.mockRejectedValue(
      new HttpError(400, 'No accepted results.'),
    )

    await expect(
      workflow.generate(platformActor, 'batch-1', releaseAudit),
    ).rejects.toMatchObject({ statusCode: 400 })

    expect(reports.failBatch).toHaveBeenCalledWith(
      expect.objectContaining({ schoolId: 'school-1' }),
      'batch-1',
      'No accepted results.',
    )
    expect(releases.recordGenerationFailure).toHaveBeenCalledWith(
      'batch-1',
      'school-1',
      'No accepted results.',
      releaseAudit,
    )
  })

  it('never marks a batch failed when another run already owns it', async () => {
    const { workflow, reports, releases } = workflowStubs()
    releases.getPlatformBatch.mockResolvedValue(
      requestDetail({ releaseStatus: 'APPROVED', generationStatus: 'PENDING' }),
    )
    reports.generateIntoBatch.mockRejectedValue(
      new HttpError(409, 'Report generation is already running for this request.'),
    )

    await expect(
      workflow.generate(platformActor, 'batch-1', releaseAudit),
    ).rejects.toMatchObject({ statusCode: 409 })

    expect(reports.failBatch).not.toHaveBeenCalled()
    expect(releases.recordGenerationFailure).toHaveBeenCalled()
  })

  it('treats an already consolidated request as a no-op, not a failure', async () => {
    const { workflow, reports, releases } = workflowStubs()
    releases.getPlatformBatch.mockResolvedValue(
      requestDetail({ releaseStatus: 'APPROVED', generationStatus: 'FAILED' }),
    )
    reports.generateIntoBatch.mockRejectedValue(
      new HttpError(
        409,
        'Every pupil in this request already has a released final report for this term.',
        { code: 'ALREADY_CONSOLIDATED' },
      ),
    )

    await expect(
      workflow.generate(platformActor, 'batch-1', releaseAudit),
    ).rejects.toMatchObject({ statusCode: 409 })

    expect(reports.failBatch).not.toHaveBeenCalled()
    expect(releases.recordGenerationFailure).not.toHaveBeenCalled()
  })

  it('refuses to generate an already released request', async () => {
    const { workflow, releases } = workflowStubs()
    releases.getPlatformBatch.mockResolvedValue(
      requestDetail({ releaseStatus: 'RELEASED', generationStatus: 'COMPLETED' }),
    )

    await expect(
      workflow.generate(platformActor, 'batch-1', releaseAudit),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it('refuses to generate while another run is in progress', async () => {
    const { workflow, releases } = workflowStubs()
    releases.getPlatformBatch.mockResolvedValue(
      requestDetail({ releaseStatus: 'APPROVED', generationStatus: 'RUNNING' }),
    )

    await expect(
      workflow.generate(platformActor, 'batch-1', releaseAudit),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it('refuses to generate a request without administrator acceptance', async () => {
    const { workflow, reports, releases } = workflowStubs()
    releases.getPlatformBatch.mockResolvedValue(
      requestDetail({ releaseStatus: 'RETURNED', generationStatus: 'PENDING' }),
    )

    await expect(
      workflow.generate(platformActor, 'batch-1', releaseAudit),
    ).rejects.toMatchObject({ statusCode: 409 })

    expect(reports.generateIntoBatch).not.toHaveBeenCalled()
  })

  it('does not require payment records for an accepted request', async () => {
    const { workflow, reports, releases } = workflowStubs()
    releases.getPlatformBatch.mockResolvedValue(
      requestDetail({
        releaseStatus: 'APPROVED',
        generationStatus: 'PENDING',
        invoice: null,
      }),
    )
    reports.generateIntoBatch.mockResolvedValue({
      batch: { id: 'batch-1', status: 'COMPLETED' },
      results: [],
    })
    releases.release.mockResolvedValue(
      requestDetail({ releaseStatus: 'RELEASED', generationStatus: 'COMPLETED' }),
    )

    await expect(
      workflow.generate(platformActor, 'batch-1', releaseAudit),
    ).resolves.toMatchObject({ batch: { releaseStatus: 'RELEASED' } })

    expect(reports.generateIntoBatch).toHaveBeenCalled()
  })

  it('retries only an approved, incomplete request', async () => {
    const { workflow, reports, releases } = workflowStubs()
    releases.getPlatformBatch.mockResolvedValue(
      requestDetail({ releaseStatus: 'APPROVED', generationStatus: 'PENDING' }),
    )
    reports.generateIntoBatch.mockResolvedValue({
      batch: { id: 'batch-1', status: 'COMPLETED' },
      results: [],
    })
    releases.release.mockResolvedValue(
      requestDetail({ releaseStatus: 'RELEASED' }),
    )

    const outcome = await workflow.retry(platformActor, 'batch-1', releaseAudit)

    expect(reports.generateIntoBatch).toHaveBeenCalledWith(
      expect.objectContaining({ schoolId: 'school-1' }),
      'batch-1',
      expect.any(Object),
      { retry: true },
    )
    expect(outcome.batch.releaseStatus).toBe('RELEASED')
  })

  it('refuses to retry a request that is not approved or already complete', async () => {
    const notApproved = workflowStubs()
    notApproved.releases.getPlatformBatch.mockResolvedValue(
      requestDetail({ releaseStatus: 'PENDING_PLATFORM_REVIEW' }),
    )
    await expect(
      notApproved.workflow.retry(platformActor, 'batch-1', releaseAudit),
    ).rejects.toMatchObject({ statusCode: 409 })

    const complete = workflowStubs()
    complete.releases.getPlatformBatch.mockResolvedValue(
      requestDetail({ releaseStatus: 'APPROVED', generationStatus: 'COMPLETED' }),
    )
    await expect(
      complete.workflow.retry(platformActor, 'batch-1', releaseAudit),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it('denies non-administrators access to school requests', async () => {
    const { workflow } = workflowStubs()
    const teacher: ReportReleaseActor = {
      ...schoolActor,
      role: 'CLASS_TEACHER',
    }

    await expect(
      workflow.getSchoolRequest(teacher, 'batch-1'),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('keeps platform and school listings separate', async () => {
    const { workflow, releases } = workflowStubs()
    releases.listPlatformBatches.mockResolvedValue([{ id: 'platform' }])
    releases.listSchoolBatches.mockResolvedValue([{ id: 'school' }])

    await expect(workflow.listPlatformRequests({})).resolves.toEqual([
      { id: 'platform' },
    ])
    await expect(workflow.listSchoolRequests(schoolActor, {})).resolves.toEqual([
      { id: 'school' },
    ])
    expect(releases.listPlatformBatches).toHaveBeenCalledWith({})
    expect(releases.listSchoolBatches).toHaveBeenCalledWith(schoolActor, {})
  })
})
