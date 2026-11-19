import { describe, expect, it } from 'vitest'
import type {
  PlatformReportActor,
  ReportReleaseActor,
  ReportReleaseAuditContext,
} from '../src/reports/release-repository.js'
import { ReportReleaseService } from '../src/reports/release-service.js'
import { MemoryStorageAdapter } from '../src/storage/storage.js'
import {
  buildReleaseSeed,
  eligibilityIssueCodes,
  FakeReportReleaseRepository,
} from './helpers/fake-release-repository.js'

function schoolActor(overrides: Partial<ReportReleaseActor> = {}): ReportReleaseActor {
  return {
    schoolId: 'school-a',
    userId: 'school-user',
    membershipId: 'membership-a',
    role: 'SCHOOL_ADMIN',
    ...overrides,
  }
}

function platformActor(): PlatformReportActor {
  return { userId: 'platform-user' }
}

function audit(): ReportReleaseAuditContext {
  return {
    actorUserId: 'actor-user',
    actorMembershipId: null,
    actorRole: 'PLATFORM_SUPER_ADMIN',
    ipAddress: '127.0.0.1',
    userAgent: 'unit-test',
  }
}

async function setup(seedOptions = {}) {
  const storage = new MemoryStorageAdapter()
  const repository = new FakeReportReleaseRepository()
  const seed = await buildReleaseSeed(storage, {
    schoolId: 'school-a',
    ...seedOptions,
  })
  repository.seed(seed)
  const service = new ReportReleaseService({ repository, storage })
  return { storage, repository, seed, service }
}

async function submittedSetup(seedOptions = {}) {
  const context = await setup(seedOptions)
  await context.service.submit(
    schoolActor({ schoolId: context.seed.record.batch.schoolId }),
    context.seed.record.batch.id,
    audit(),
  )
  return context
}

async function approvedSetup(seedOptions = {}) {
  const context = await submittedSetup(seedOptions)
  await context.service.approve(
    platformActor(),
    context.seed.record.batch.id,
    audit(),
  )
  return context
}

describe('ReportReleaseService school submission', () => {
  it('submits a generated batch for platform review with an audit transition', async () => {
    const context = await setup()
    const actor = schoolActor({ schoolId: context.seed.record.batch.schoolId })

    const result = await context.service.submit(
      actor,
      context.seed.record.batch.id,
      audit(),
    )

    expect(result.releaseStatus).toBe('PENDING_PLATFORM_REVIEW')
    expect(result.submittedAt).toBeInstanceOf(Date)
    expect(result.eligibility.eligible).toBe(true)
    expect(context.repository.transitions).toHaveLength(1)
    expect(context.repository.transitions[0]).toMatchObject({
      next: 'PENDING_PLATFORM_REVIEW',
      expected: ['GENERATED', 'RETURNED'],
      action: 'REPORT_RELEASE_SUBMITTED',
      schoolId: actor.schoolId,
    })
  })

  it('rejects submission by a teacher', async () => {
    const context = await setup()

    await expect(
      context.service.submit(
        schoolActor({
          schoolId: context.seed.record.batch.schoolId,
          role: 'CLASS_TEACHER',
        }),
        context.seed.record.batch.id,
        audit(),
      ),
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(context.repository.transitions).toHaveLength(0)
  })

  it('rejects submission from another school as not found', async () => {
    const context = await setup()

    await expect(
      context.service.submit(
        schoolActor({ schoolId: 'school-b' }),
        context.seed.record.batch.id,
        audit(),
      ),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('does not let an unpaid or missing invoice block submission', async () => {
    for (const seedOptions of [
      { invoiceStatus: 'ISSUED', paidMinor: 0, outstandingMinor: 1500 },
      { includeInvoice: false },
    ]) {
      const context = await setup(seedOptions)

      const result = await context.service.submit(
        schoolActor({ schoolId: context.seed.record.batch.schoolId }),
        context.seed.record.batch.id,
        audit(),
      )

      expect(result.releaseStatus).toBe('PENDING_PLATFORM_REVIEW')
      expect(result.eligibility.eligible).toBe(true)
      expect(context.repository.transitions).toHaveLength(1)
    }
  })

  it('resubmits a returned batch and clears the returned reason', async () => {
    const context = await submittedSetup()
    await context.service.returnBatch(
      platformActor(),
      context.seed.record.batch.id,
      'Correct the attendance figures.',
      audit(),
    )

    const result = await context.service.submit(
      schoolActor({ schoolId: context.seed.record.batch.schoolId }),
      context.seed.record.batch.id,
      audit(),
    )

    expect(result.releaseStatus).toBe('PENDING_PLATFORM_REVIEW')
    expect(result.returnedReason).toBeNull()
    expect(context.repository.transitions.at(-1)).toMatchObject({
      action: 'REPORT_RELEASE_RESUBMITTED',
      metadata: { resubmission: true },
    })
  })
})

describe('ReportReleaseService platform workflow', () => {
  it('approves but does not release a pending batch', async () => {
    const context = await submittedSetup()

    const approved = await context.service.approve(
      platformActor(),
      context.seed.record.batch.id,
      audit(),
    )

    expect(approved.releaseStatus).toBe('APPROVED')
    expect(approved.releasedAt).toBeNull()
    expect(context.repository.transitions.at(-1)).toMatchObject({
      action: 'REPORT_RELEASE_APPROVED',
      next: 'APPROVED',
      expected: ['PENDING_PLATFORM_REVIEW'],
    })
  })

  it('requires approval before release', async () => {
    const context = await submittedSetup()

    await expect(
      context.service.release(
        platformActor(),
        context.seed.record.batch.id,
        audit(),
      ),
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(context.repository.transitions.at(-1)?.next).toBe(
      'PENDING_PLATFORM_REVIEW',
    )
  })

  it('releases only after a separate explicit approval action', async () => {
    const context = await approvedSetup()

    const released = await context.service.release(
      platformActor(),
      context.seed.record.batch.id,
      audit(),
    )

    expect(released.releaseStatus).toBe('RELEASED')
    expect(released.releasedAt).toBeInstanceOf(Date)
    expect(context.repository.transitions.map((item) => item.action)).toEqual([
      'REPORT_RELEASE_SUBMITTED',
      'REPORT_RELEASE_APPROVED',
      'REPORT_RELEASE_RELEASED',
    ])
  })

  it('allows a submitted request to release after reusing an existing final report', async () => {
    const context = await setup({
      releaseStatus: 'APPROVED',
      batchStatus: 'COMPLETED',
      generatedCount: 1,
      skippedCount: 1,
      submittedAt: new Date('2026-11-02T09:00:00.000Z'),
    })

    const released = await context.service.release(
      platformActor(),
      context.seed.record.batch.id,
      audit(),
    )

    expect(released.releaseStatus).toBe('RELEASED')
    expect(eligibilityIssueCodes(released.eligibility.issues)).not.toContain(
      'GENERATION_SKIPPED',
    )
  })

  it('blocks release when a direct generation batch skipped a pupil', async () => {
    const context = await setup({
      releaseStatus: 'APPROVED',
      batchStatus: 'COMPLETED',
      generatedCount: 1,
      skippedCount: 1,
      submittedAt: null,
    })

    await expect(
      context.service.release(
        platformActor(),
        context.seed.record.batch.id,
        audit(),
      ),
    ).rejects.toMatchObject({ statusCode: 409 })

    expect(context.repository.failedAttempts.at(-1)?.metadata).toMatchObject({
      issues: [expect.objectContaining({ code: 'GENERATION_SKIPPED' })],
    })
    expect(
      context.repository.records.get(context.seed.record.batch.id)?.batch
        .releaseStatus,
    ).toBe('APPROVED')
  })

  it('does not allow approval twice', async () => {
    const context = await approvedSetup()

    await expect(
      context.service.approve(
        platformActor(),
        context.seed.record.batch.id,
        audit(),
      ),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it('requires a meaningful return reason and trims it', async () => {
    const context = await submittedSetup()

    await expect(
      context.service.returnBatch(
        platformActor(),
        context.seed.record.batch.id,
        '  ',
        audit(),
      ),
    ).rejects.toMatchObject({ statusCode: 400 })

    const returned = await context.service.returnBatch(
      platformActor(),
      context.seed.record.batch.id,
      '  Attendance totals need correction.  ',
      audit(),
    )

    expect(returned.releaseStatus).toBe('RETURNED')
    expect(returned.returnedReason).toBe('Attendance totals need correction.')
  })

  it('requires a hold reason, keeps the previous state and restores it on unhold', async () => {
    const context = await submittedSetup()

    await expect(
      context.service.hold(
        platformActor(),
        context.seed.record.batch.id,
        '',
        audit(),
      ),
    ).rejects.toMatchObject({ statusCode: 400 })

    const held = await context.service.hold(
      platformActor(),
      context.seed.record.batch.id,
      'Awaiting finance clarification.',
      audit(),
    )
    expect(held.releaseStatus).toBe('ON_HOLD')
    expect(held.previousReleaseStatus).toBe('PENDING_PLATFORM_REVIEW')
    expect(held.holdReason).toBe('Awaiting finance clarification.')

    const unheld = await context.service.unhold(
      context.seed.record.batch.id,
      audit(),
    )
    expect(unheld.releaseStatus).toBe('PENDING_PLATFORM_REVIEW')
    expect(unheld.holdReason).toBeNull()
    expect(context.repository.transitions.map((item) => item.action)).toEqual([
      'REPORT_RELEASE_SUBMITTED',
      'REPORT_RELEASE_HELD',
      'REPORT_RELEASE_HOLD_REMOVED',
    ])
  })

  it('refuses to hold a released batch', async () => {
    const context = await approvedSetup()
    await context.service.release(
      platformActor(),
      context.seed.record.batch.id,
      audit(),
    )

    await expect(
      context.service.hold(
        platformActor(),
        context.seed.record.batch.id,
        'Late concern.',
        audit(),
      ),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it('returns an approved batch before release', async () => {
    const context = await approvedSetup()

    const returned = await context.service.returnBatch(
      platformActor(),
      context.seed.record.batch.id,
      'The headteacher signature is missing.',
      audit(),
    )

    expect(returned.releaseStatus).toBe('RETURNED')
    expect(context.repository.transitions.at(-1)).toMatchObject({
      action: 'REPORT_RELEASE_RETURNED',
      expected: ['PENDING_PLATFORM_REVIEW', 'APPROVED'],
    })
  })
})

describe('ReportReleaseService eligibility', () => {
  it('ignores invoice state entirely when reports are otherwise eligible', async () => {
    for (const seedOptions of [
      { invoiceStatus: 'ISSUED', paidMinor: 0, outstandingMinor: 1500 },
      { invoiceStatus: 'CANCELLED', paidMinor: 0, outstandingMinor: 1500 },
      { includeReportInInvoice: false },
      { includeInvoice: false },
    ]) {
      const context = await setup(seedOptions)

      const batches = await context.service.listSchoolBatches(
        schoolActor({ schoolId: context.seed.record.batch.schoolId }),
        {},
      )

      expect(batches[0]?.eligibility.eligible).toBe(true)
      const codes = eligibilityIssueCodes(batches[0]!.eligibility.issues)
      expect(codes).not.toContain('INVOICE_MISSING')
      expect(codes).not.toContain('INVOICE_NOT_PAID')
      expect(codes).not.toContain('REPORT_NOT_BILLED')
    }
  })

  it('blocks missing and corrupted private report files', async () => {
    const missing = await setup({ missingFile: true })
    const [missingBatch] = await missing.service.listSchoolBatches(
      schoolActor({ schoolId: missing.seed.record.batch.schoolId }),
      {},
    )
    expect(eligibilityIssueCodes(missingBatch!.eligibility.issues)).toContain(
      'REPORT_FILE_MISSING',
    )

    const corrupt = await setup({ corruptFile: true })
    const [corruptBatch] = await corrupt.service.listSchoolBatches(
      schoolActor({ schoolId: corrupt.seed.record.batch.schoolId }),
      {},
    )
    expect(eligibilityIssueCodes(corruptBatch!.eligibility.issues)).toContain(
      'REPORT_INTEGRITY_FAILED',
    )
  })

  it('blocks reports not built from accepted results', async () => {
    const context = await setup({ acceptedSubmissions: 0, subjectCount: 0 })
    const [batch] = await context.service.listSchoolBatches(
      schoolActor({ schoolId: context.seed.record.batch.schoolId }),
      {},
    )

    expect(eligibilityIssueCodes(batch!.eligibility.issues)).toContain(
      'RESULTS_NOT_ACCEPTED',
    )
  })

  it('blocks a report whose class does not match the batch', async () => {
    const context = await setup({ versionClassId: 'other-class' })
    const [batch] = await context.service.listSchoolBatches(
      schoolActor({ schoolId: context.seed.record.batch.schoolId }),
      {},
    )

    expect(eligibilityIssueCodes(batch!.eligibility.issues)).toContain(
      'REPORT_SCOPE_INVALID',
    )
  })

  it('blocks an inactive school', async () => {
    const context = await setup({ schoolIsActive: false })
    const [batch] = await context.service.listSchoolBatches(
      schoolActor({ schoolId: context.seed.record.batch.schoolId }),
      {},
    )

    expect(eligibilityIssueCodes(batch!.eligibility.issues)).toContain(
      'SCHOOL_INACTIVE',
    )
  })

  it('re-evaluates eligibility at release and records a failed attempt', async () => {
    const context = await approvedSetup()
    const record = context.repository.records.get(
      context.seed.record.batch.id,
    )!
    record.schoolIsActive = false

    await expect(
      context.service.release(
        platformActor(),
        context.seed.record.batch.id,
        audit(),
      ),
    ).rejects.toMatchObject({ statusCode: 409 })

    expect(context.repository.failedAttempts).toHaveLength(1)
    expect(context.repository.failedAttempts[0]).toMatchObject({
      action: 'REPORT_RELEASE_FAILED',
      schoolId: record.batch.schoolId,
    })
    expect(context.repository.records.get(context.seed.record.batch.id)?.batch.releaseStatus).toBe(
      'APPROVED',
    )
  })
})

describe('ReportReleaseService platform preview', () => {
  it('streams a verified private PDF preview', async () => {
    const context = await setup()

    const preview = await context.service.previewPlatformVersion(
      context.seed.record.batch.id,
      context.seed.versionId,
    )

    expect(preview.fileName).toBe('report-ADM-001-v1.pdf')
    expect(preview.data.toString()).toContain('%PDF-')
    expect(preview.checksum).toBe(context.seed.record.versions[0]!.checksum)
  })

  it('rejects a preview after the stored bytes are tampered with', async () => {
    const context = await setup()
    await context.storage.putObject(
      context.seed.storageKey,
      Buffer.from('%PDF-1.7 tampered'),
      'application/pdf',
    )

    await expect(
      context.service.previewPlatformVersion(
        context.seed.record.batch.id,
        context.seed.versionId,
      ),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it('rejects a preview from a different batch and hides missing versions', async () => {
    const context = await setup()

    await expect(
      context.service.previewPlatformVersion(
        'another-batch',
        context.seed.versionId,
      ),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('ReportReleaseService forbidden transitions', () => {
  it('rejects approval unless the batch is awaiting platform review', async () => {
    for (const releaseStatus of [
      'GENERATED',
      'RETURNED',
      'APPROVED',
      'RELEASED',
      'ON_HOLD',
    ] as const) {
      const context = await setup({ releaseStatus })

      await expect(
        context.service.approve(
          platformActor(),
          context.seed.record.batch.id,
          audit(),
        ),
      ).rejects.toMatchObject({ statusCode: 409 })
      expect(context.repository.transitions).toHaveLength(0)
    }
  })

  it('rejects release unless the batch is APPROVED', async () => {
    for (const releaseStatus of [
      'GENERATED',
      'PENDING_PLATFORM_REVIEW',
      'RETURNED',
      'RELEASED',
      'ON_HOLD',
    ] as const) {
      const context = await setup({ releaseStatus })

      await expect(
        context.service.release(
          platformActor(),
          context.seed.record.batch.id,
          audit(),
        ),
      ).rejects.toMatchObject({ statusCode: 409 })
      expect(context.repository.transitions).toHaveLength(0)
    }
  })

  it('rejects returning a batch that is not pending or approved', async () => {
    for (const releaseStatus of ['GENERATED', 'RELEASED', 'ON_HOLD'] as const) {
      const context = await setup({ releaseStatus })

      await expect(
        context.service.returnBatch(
          platformActor(),
          context.seed.record.batch.id,
          'Correction required.',
          audit(),
        ),
      ).rejects.toMatchObject({ statusCode: 409 })
      expect(context.repository.transitions).toHaveLength(0)
    }
  })

  it('rejects unhold when the batch is not on hold', async () => {
    for (const releaseStatus of [
      'GENERATED',
      'PENDING_PLATFORM_REVIEW',
      'APPROVED',
      'RELEASED',
    ] as const) {
      const context = await setup({ releaseStatus })

      await expect(
        context.service.unhold(context.seed.record.batch.id, audit()),
      ).rejects.toMatchObject({ statusCode: 409 })
      expect(context.repository.transitions).toHaveLength(0)
    }
  })

  it('rejects a second hold while the batch is already on hold', async () => {
    const context = await submittedSetup()
    await context.service.hold(
      platformActor(),
      context.seed.record.batch.id,
      'Finance verification.',
      audit(),
    )

    await expect(
      context.service.hold(
        platformActor(),
        context.seed.record.batch.id,
        'Second hold.',
        audit(),
      ),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it('rejects a duplicate submission and never creates two transitions', async () => {
    const context = await setup()
    const actor = schoolActor({ schoolId: context.seed.record.batch.schoolId })

    await context.service.submit(
      actor,
      context.seed.record.batch.id,
      audit(),
    )

    await expect(
      context.service.submit(actor, context.seed.record.batch.id, audit()),
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(context.repository.transitions).toHaveLength(1)
  })

  it('never reverts a released batch to an earlier state', async () => {
    const context = await approvedSetup()
    await context.service.release(
      platformActor(),
      context.seed.record.batch.id,
      audit(),
    )

    await expect(
      context.service.submit(
        schoolActor({ schoolId: context.seed.record.batch.schoolId }),
        context.seed.record.batch.id,
        audit(),
      ),
    ).rejects.toMatchObject({ statusCode: 409 })

    await expect(
      context.service.returnBatch(
        platformActor(),
        context.seed.record.batch.id,
        'Late reversal attempt.',
        audit(),
      ),
    ).rejects.toMatchObject({ statusCode: 409 })

    expect(
      context.repository.records.get(context.seed.record.batch.id)?.batch
        .releaseStatus,
    ).toBe('RELEASED')
  })
})

describe('ReportReleaseService concurrency and idempotency', () => {
  it('allows exactly one of two concurrent approvals', async () => {
    const context = await submittedSetup()

    const outcomes = await Promise.allSettled([
      context.service.approve(
        platformActor(),
        context.seed.record.batch.id,
        audit(),
      ),
      context.service.approve(
        platformActor(),
        context.seed.record.batch.id,
        audit(),
      ),
    ])

    expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    )
    const rejected = outcomes.filter(
      (item): item is PromiseRejectedResult => item.status === 'rejected',
    )
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.reason).toMatchObject({ statusCode: 409 })
    expect(
      context.repository.transitions.filter(
        (item) => item.action === 'REPORT_RELEASE_APPROVED',
      ),
    ).toHaveLength(1)
  })

  it('allows exactly one of two concurrent releases', async () => {
    const context = await approvedSetup()

    const outcomes = await Promise.allSettled([
      context.service.release(
        platformActor(),
        context.seed.record.batch.id,
        audit(),
      ),
      context.service.release(
        platformActor(),
        context.seed.record.batch.id,
        audit(),
      ),
    ])

    expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    )
    expect(
      context.repository.transitions.filter(
        (item) => item.action === 'REPORT_RELEASE_RELEASED',
      ),
    ).toHaveLength(1)
  })

  it('keeps hold and release mutually consistent when raced', async () => {
    const context = await approvedSetup()

    const outcomes = await Promise.allSettled([
      context.service.release(
        platformActor(),
        context.seed.record.batch.id,
        audit(),
      ),
      context.service.hold(
        platformActor(),
        context.seed.record.batch.id,
        'Concurrent hold.',
        audit(),
      ),
    ])

    expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    )

    const record = context.repository.records.get(
      context.seed.record.batch.id,
    )!

    if (record.batch.releaseStatus === 'RELEASED') {
      expect(record.batch.releasedAt).toBeInstanceOf(Date)
      expect(record.batch.releaseStatus).not.toBe('ON_HOLD')
    } else {
      expect(record.batch.releaseStatus).toBe('ON_HOLD')
      expect(record.batch.releasedAt).toBeNull()
    }
  })

  it('records a failed release attempt when a file disappears after approval', async () => {
    const context = await approvedSetup()
    await context.storage.deleteObject(context.seed.storageKey)

    await expect(
      context.service.release(
        platformActor(),
        context.seed.record.batch.id,
        audit(),
      ),
    ).rejects.toMatchObject({ statusCode: 409 })

    expect(context.repository.failedAttempts).toHaveLength(1)
    expect(context.repository.failedAttempts[0]).toMatchObject({
      action: 'REPORT_RELEASE_FAILED',
    })
    expect(
      context.repository.records.get(context.seed.record.batch.id)?.batch
        .releaseStatus,
    ).toBe('APPROVED')
    expect(
      context.repository.records.get(context.seed.record.batch.id)?.batch
        .releasedAt,
    ).toBeNull()
  })
})

describe('ReportReleaseService platform queue', () => {
  it('filters the platform queue by school and release status', async () => {
    const context = await setup()
    await context.service.submit(
      schoolActor({ schoolId: context.seed.record.batch.schoolId }),
      context.seed.record.batch.id,
      audit(),
    )

    expect(
      await context.service.listPlatformBatches({
        schoolId: context.seed.record.batch.schoolId,
        status: 'PENDING_PLATFORM_REVIEW',
      }),
    ).toHaveLength(1)
    expect(
      await context.service.listPlatformBatches({ status: 'RELEASED' }),
    ).toHaveLength(0)
  })

  it('reports overview counts by release state', async () => {
    const context = await setup()
    const overview = await context.service.overview()

    expect(overview).toMatchObject({
      totalGenerated: 1,
      generated: 1,
      pendingReview: 0,
      approvedUnreleased: 0,
      released: 0,
    })
  })
})
