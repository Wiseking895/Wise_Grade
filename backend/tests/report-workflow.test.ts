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
  })

  it('skips pupils who are ineligible instead of failing the whole request', async () => {
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

    expect(generated.batch.status).toBe('COMPLETED')
    expect(generated.batch.generatedCount).toBe(2)
    expect(generated.batch.failedCount).toBe(0)
    expect(generated.results).toHaveLength(2)
    expect(repository.failures).toHaveLength(0)
    expect(repository.cards.size).toBe(2)
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
