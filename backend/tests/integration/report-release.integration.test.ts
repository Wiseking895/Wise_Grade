import './test-database-env.js'
import { PrismaPg } from '@prisma/adapter-pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Prisma, PrismaClient } from '../../src/generated/prisma/client.js'
import { createPrismaReportRepository } from '../../src/reports/prisma-repository.js'
import type { ReportActor } from '../../src/reports/repository.js'
import { sha256, MemoryStorageAdapter } from '../../src/storage/storage.js'
import { createPrismaReportReleaseRepository } from '../../src/reports/release-prisma-repository.js'
import type {
  PlatformReportActor,
  ReportReleaseActor,
  ReportReleaseAuditContext,
} from '../../src/reports/release-repository.js'
import { ReportReleaseService } from '../../src/reports/release-service.js'
import { ReportService } from '../../src/reports/service.js'
import { buildReportSet } from '../../src/reports/snapshot.js'
import { makeReportData } from '../helpers/report-fixtures.js'
import { extractPdfText } from '../helpers/pdf-text.js'
import { assertSafeIntegrationTarget } from './target.js'
import { integrationEnvironment } from './test-database-env.js'

/**
 * Live PostgreSQL Phase 6B release lifecycle.
 *
 * Safety mirrors the other integration suites: it is skipped unless
 * TEST_DATABASE_URL is set, refuses production or the development database,
 * and deletes only schools and users created by this file.
 */

const testDatabaseUrl = integrationEnvironment.testDatabaseUrl
const configuredDatabaseUrl = integrationEnvironment.configuredDatabaseUrl
const runIntegration = testDatabaseUrl !== undefined

if (runIntegration) {
  assertSafeIntegrationTarget({
    testDatabaseUrl,
    databaseUrl: configuredDatabaseUrl,
    nodeEnv: process.env.NODE_ENV,
  })
}

const PDF_BYTES = Buffer.from('%PDF-1.7\n% phase6b integration report\n')

describe.skipIf(!runIntegration)('PostgreSQL report release lifecycle', () => {
  let prisma: PrismaClient
  let storage: MemoryStorageAdapter
  let releaseService: ReportReleaseService
  let reportService: ReportService
  let platformUser: { id: string }
  let schoolAdminUser: { id: string }

  const createdSchoolIds: string[] = []
  const createdUserIds: string[] = []
  const createdBatchIds: string[] = []
  let fixtureCounter = 0

  function nextSuffix(): string {
    fixtureCounter += 1
    return `${Date.now().toString(36)}-${fixtureCounter}-${Math.random()
      .toString(36)
      .slice(2, 8)}`
  }

  /**
   * Currency is unique per pricing rule version and must be three letters.
   * A random per-run seed keeps fixtures distinct from rows left behind by an
   * interrupted earlier run, which a counter that always starts at RA cannot
   * guarantee.
   */
  const currencySeed = Math.floor(Math.random() * 26 ** 3)

  function nextCurrency(): string {
    const value = (currencySeed + fixtureCounter) % 26 ** 3
    const letters = [
      Math.floor(value / 676) % 26,
      Math.floor(value / 26) % 26,
      value % 26,
    ]

    return letters.map((letter) => String.fromCharCode(65 + letter)).join('')
  }

  function platformActor(): PlatformReportActor {
    return { userId: platformUser.id }
  }

  function audit(
    userId: string,
    role = 'PLATFORM_SUPER_ADMIN',
    actorMembershipId: string | null = null,
  ): ReportReleaseAuditContext {
    return {
      actorUserId: userId,
      actorMembershipId,
      actorRole: role,
      ipAddress: '127.0.0.1',
      userAgent: 'report-release-integration-test',
    }
  }

  async function createFixture(options: {
    fullyPaid: boolean
    invoiceStatus?: 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED'
    acceptedSubmissions?: number
    subjectCount?: number
    missingFile?: boolean
    corruptFile?: boolean
  }) {
    const suffix = nextSuffix()

    const school = await prisma.school.create({
      data: {
        name: `Release IT ${suffix}`,
        slug: `release-it-${suffix}`,
        email: `release-${suffix}@gradely-integration.test`,
      },
    })
    createdSchoolIds.push(school.id)

    const year = await prisma.academicYear.create({
      data: {
        schoolId: school.id,
        name: `Year ${suffix}`,
        startsOn: new Date('2026-01-01T00:00:00.000Z'),
        endsOn: new Date('2026-12-31T00:00:00.000Z'),
        isCurrent: true,
      },
    })

    const term = await prisma.academicTerm.create({
      data: {
        schoolId: school.id,
        academicYearId: year.id,
        name: `Term ${suffix}`,
        sequence: 1,
        startsOn: new Date('2026-01-01T00:00:00.000Z'),
        endsOn: new Date('2026-04-30T00:00:00.000Z'),
        isCurrent: true,
      },
    })

    const classroom = await prisma.schoolClass.create({
      data: {
        schoolId: school.id,
        academicYearId: year.id,
        name: `Class ${suffix}`,
        level: 'Basic 5',
      },
    })

    const pupil = await prisma.pupil.create({
      data: {
        schoolId: school.id,
        firstName: 'Ama',
        lastName: 'Mensah',
        admissionNumber: `ADM-${suffix}`.toUpperCase(),
        currentClassId: classroom.id,
      },
    })

    const membership = await prisma.schoolMembership.create({
      data: {
        schoolId: school.id,
        userId: schoolAdminUser.id,
        role: 'SCHOOL_ADMIN',
        status: 'ACTIVE',
      },
    })

    const batch = await prisma.reportGenerationBatch.create({
      data: {
        schoolId: school.id,
        academicYearId: year.id,
        academicTermId: term.id,
        classId: classroom.id,
        scope: 'CLASS',
        status: 'COMPLETED',
        requestedByMembershipId: membership.id,
        requestedPupilCount: 1,
        generatedCount: 1,
        skippedCount: 0,
        failedCount: 0,
        startedAt: new Date('2026-11-01T10:00:00.000Z'),
        completedAt: new Date('2026-11-01T10:01:00.000Z'),
      },
    })
    createdBatchIds.push(batch.id)

    const reportCard = await prisma.reportCard.create({
      data: {
        schoolId: school.id,
        academicYearId: year.id,
        academicTermId: term.id,
        classId: classroom.id,
        pupilId: pupil.id,
        currentVersion: 1,
        createdByMembershipId: membership.id,
      },
    })

    const storageKey = `schools/${school.id}/reports/${reportCard.id}/v1.pdf`
    if (!options.missingFile) {
      await storage.putObject(
        storageKey,
        options.corruptFile
          ? Buffer.from('%PDF-1.7 tampered report bytes')
          : PDF_BYTES,
        'application/pdf',
      )
    }
    const checksum = sha256(PDF_BYTES)

    const subjectCount = options.subjectCount ?? 1

    // Released downloads are re-rendered from the stored snapshot, so the
    // fixture needs a complete, renderable snapshot rather than a stub.
    const builtSnapshot = buildReportSet(makeReportData()).builds[0]!.snapshot!

    if (!builtSnapshot) {
      throw new Error('Fixture did not produce a report snapshot')
    }

    const snapshot = {
      ...builtSnapshot,
      academic: {
        ...builtSnapshot.academic,
        subjects: builtSnapshot.academic.subjects.slice(0, subjectCount),
        subjectCount,
      },
      source: {
        ...builtSnapshot.source,
        acceptedSubmissions:
          options.acceptedSubmissions ??
          builtSnapshot.source.acceptedSubmissions,
      },
    }

    const version = await prisma.reportCardVersion.create({
      data: {
        schoolId: school.id,
        reportCardId: reportCard.id,
        batchId: batch.id,
        version: 1,
        snapshot: JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue,
        storageKey,
        checksum,
        byteSize: PDF_BYTES.length,
        pageCount: 1,
        generatedByMembershipId: membership.id,
        generatedAt: new Date('2026-11-01T10:00:30.000Z'),
      },
    })

    const totalMinor = 1500
    const pricingRule = await prisma.pricingRule.create({
      data: {
        currency: nextCurrency(),
        amountMinor: totalMinor,
        effectiveFrom: new Date('2099-01-01T00:00:00.000Z'),
        isActive: true,
        version: 1,
        createdByUserId: platformUser.id,
      },
    })

    const invoiceStatus =
      options.invoiceStatus ?? (options.fullyPaid ? 'PAID' : 'ISSUED')
    const paidMinor =
      invoiceStatus === 'PAID'
        ? totalMinor
        : invoiceStatus === 'PARTIALLY_PAID'
          ? Math.floor(totalMinor / 2)
          : 0
    const outstandingMinor = totalMinor - paidMinor

    const invoice = await prisma.schoolInvoice.create({
      data: {
        invoiceNumber: `INV-RL-${suffix}`,
        schoolId: school.id,
        academicYearId: year.id,
        academicTermId: term.id,
        pricingRuleId: pricingRule.id,
        currency: pricingRule.currency,
        unitAmountMinor: totalMinor,
        billablePupilCount: 1,
        subtotalMinor: totalMinor,
        adjustmentMinor: 0,
        totalMinor,
        paidMinor,
        outstandingMinor,
        status: invoiceStatus,
        issueDate: new Date('2026-11-01T00:00:00.000Z'),
        snapshot: { test: true },
        createdByUserId: platformUser.id,
        pupils: {
          create: {
            schoolId: school.id,
            academicYearId: year.id,
            academicTermId: term.id,
            classId: classroom.id,
            pupilId: pupil.id,
            reportCardId: reportCard.id,
            pupilName: 'Ama Mensah',
            admissionNumber: pupil.admissionNumber,
            reportVersion: 1,
          },
        },
      },
    })

    const schoolActor: ReportReleaseActor = {
      schoolId: school.id,
      userId: schoolAdminUser.id,
      membershipId: membership.id,
      role: 'SCHOOL_ADMIN',
    }

    const reportActor: ReportActor = {
      schoolId: school.id,
      userId: schoolAdminUser.id,
      membershipId: membership.id,
      role: 'SCHOOL_ADMIN',
    }

    return {
      school,
      year,
      term,
      classroom,
      pupil,
      membership,
      batch,
      reportCard,
      version,
      invoice,
      schoolActor,
      reportActor,
    }
  }

  beforeAll(async () => {
    assertSafeIntegrationTarget({
      testDatabaseUrl: testDatabaseUrl!,
      databaseUrl: configuredDatabaseUrl,
      nodeEnv: process.env.NODE_ENV,
    })

    process.env.DATABASE_URL = testDatabaseUrl!

    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: testDatabaseUrl! }),
    })

    const suffix = nextSuffix()
    platformUser = await prisma.user.create({
      data: {
        email: `release-platform-${suffix}@gradely-integration.test`,
        passwordHash: 'integration-test-only',
        firstName: 'Platform',
        lastName: 'Reviewer',
        isPlatformAdmin: true,
      },
      select: { id: true },
    })
    schoolAdminUser = await prisma.user.create({
      data: {
        email: `release-school-${suffix}@gradely-integration.test`,
        passwordHash: 'integration-test-only',
        firstName: 'School',
        lastName: 'Administrator',
      },
      select: { id: true },
    })
    createdUserIds.push(platformUser.id, schoolAdminUser.id)

    storage = new MemoryStorageAdapter()
    releaseService = new ReportReleaseService({
      repository: createPrismaReportReleaseRepository(),
      storage,
    })
    reportService = new ReportService({
      repository: createPrismaReportRepository(),
      storage,
    })
  }, 30_000)

  afterAll(async () => {
    if (!prisma) {
      return
    }

    try {
      if (createdBatchIds.length > 0) {
        await prisma.auditLog.deleteMany({
          where: { entityId: { in: createdBatchIds } },
        })
      }

      if (createdSchoolIds.length > 0) {
        await prisma.school.deleteMany({
          where: { id: { in: createdSchoolIds } },
        })
      }

      if (createdUserIds.length > 0) {
        await prisma.pricingRule.deleteMany({
          where: { createdByUserId: { in: createdUserIds } },
        })
        await prisma.user.deleteMany({
          where: { id: { in: createdUserIds } },
        })
      }
    } finally {
      await prisma.$disconnect()
    }
  }, 30_000)

  it('submits, approves and releases only through separate explicit actions', async () => {
    const fixture = await createFixture({ fullyPaid: true })

    const submitted = await releaseService.submit(
      fixture.schoolActor,
      fixture.batch.id,
      audit(schoolAdminUser.id, 'SCHOOL_ADMIN', fixture.membership.id),
    )
    expect(submitted.releaseStatus).toBe('PENDING_PLATFORM_REVIEW')

    await expect(
      reportService.getStoredPdf(fixture.reportActor, fixture.reportCard.id, 1),
    ).rejects.toMatchObject({ statusCode: 403 })

    const approved = await releaseService.approve(
      platformActor(),
      fixture.batch.id,
      audit(platformUser.id),
    )
    expect(approved.releaseStatus).toBe('APPROVED')
    expect(approved.releasedAt).toBeNull()

    await expect(
      reportService.getStoredPdf(fixture.reportActor, fixture.reportCard.id, 1),
    ).rejects.toMatchObject({ statusCode: 403 })

    const released = await releaseService.release(
      platformActor(),
      fixture.batch.id,
      audit(platformUser.id),
    )
    expect(released.releaseStatus).toBe('RELEASED')
    expect(released.releasedAt).toBeInstanceOf(Date)
    expect(released.releasedByName).toBe('Platform Reviewer')

    const pdf = await reportService.getStoredPdf(
      fixture.reportActor,
      fixture.reportCard.id,
      1,
    )
    // Released downloads must be rendered as released copies, never the
    // generation-time draft artifact.
    expect(pdf.data.equals(PDF_BYTES)).toBe(false)
    expect(pdf.data.subarray(0, 5).toString()).toBe('%PDF-')
    const pdfText = await extractPdfText(pdf.data)
    expect(pdfText).not.toContain('RELEASED — PRIVATE SCHOOL ACCESS')
    expect(pdfText).not.toContain('INTERNAL DRAFT')

    const stored = await prisma.reportGenerationBatch.findUniqueOrThrow({
      where: { id: fixture.batch.id },
    })
    expect(stored).toMatchObject({
      releaseStatus: 'RELEASED',
      submittedByMembershipId: fixture.membership.id,
      reviewedByUserId: platformUser.id,
      releasedByUserId: platformUser.id,
    })

    const audits = await prisma.auditLog.findMany({
      where: { entityId: fixture.batch.id },
      orderBy: { createdAt: 'asc' },
    })
    expect(audits.map((item) => item.action)).toEqual([
      'REPORT_RELEASE_SUBMITTED',
      'REPORT_RELEASE_APPROVED',
      'REPORT_RELEASE_RELEASED',
    ])
    expect(audits[0]?.metadata).toMatchObject({
      actorRole: 'SCHOOL_ADMIN',
      fromStatus: 'GENERATED',
      toStatus: 'PENDING_PLATFORM_REVIEW',
    })
    expect(audits[2]?.metadata).toMatchObject({
      actorRole: 'PLATFORM_SUPER_ADMIN',
      fromStatus: 'APPROVED',
      toStatus: 'RELEASED',
    })
    expect(JSON.stringify(audits)).not.toContain(PDF_BYTES.toString())
  }, 30_000)

  it('submits regardless of invoice state and leaves the invoice untouched', async () => {
    const fixture = await createFixture({ fullyPaid: false })

    const submitted = await releaseService.submit(
      fixture.schoolActor,
      fixture.batch.id,
      audit(schoolAdminUser.id, 'SCHOOL_ADMIN', fixture.membership.id),
    )
    expect(submitted.releaseStatus).toBe('PENDING_PLATFORM_REVIEW')

    const stored = await prisma.reportGenerationBatch.findUniqueOrThrow({
      where: { id: fixture.batch.id },
    })
    expect(stored.releaseStatus).toBe('PENDING_PLATFORM_REVIEW')
    expect(stored.submittedAt).toBeInstanceOf(Date)

    // Payment history is preserved even though it no longer gates reports.
    const invoice = await prisma.schoolInvoice.findUniqueOrThrow({
      where: { id: fixture.invoice.id },
    })
    expect(invoice.status).not.toBe('PAID')
    expect(invoice.outstandingMinor).toBeGreaterThan(0)

    const status = await reportService
      .getStoredPdf(fixture.reportActor, fixture.reportCard.id, 1)
      .catch((error: unknown) => error)
    expect(status).toMatchObject({ statusCode: 403 })
  }, 30_000)

  it('approves regardless of invoice state and preserves invoice rows', async () => {
    const fixture = await createFixture({ fullyPaid: true })

    await releaseService.submit(
      fixture.schoolActor,
      fixture.batch.id,
      audit(schoolAdminUser.id, 'SCHOOL_ADMIN', fixture.membership.id),
    )

    await prisma.schoolInvoice.update({
      where: { id: fixture.invoice.id },
      data: {
        status: 'ISSUED',
        paidMinor: 0,
        outstandingMinor: fixture.invoice.totalMinor,
      },
    })

    const approved = await releaseService.approve(
      platformActor(),
      fixture.batch.id,
      audit(platformUser.id),
    )
    expect(approved.releaseStatus).toBe('APPROVED')

    const stored = await prisma.reportGenerationBatch.findUniqueOrThrow({
      where: { id: fixture.batch.id },
    })
    expect(stored.releaseStatus).toBe('APPROVED')
    expect(stored.reviewedByUserId).toBe(platformUser.id)

    const invoice = await prisma.schoolInvoice.findUniqueOrThrow({
      where: { id: fixture.invoice.id },
    })
    expect(invoice.status).toBe('ISSUED')
    expect(invoice.paidMinor).toBe(0)
  }, 30_000)

  it('releases after approval even when the invoice is not paid', async () => {
    const fixture = await createFixture({ fullyPaid: true })

    await releaseService.submit(
      fixture.schoolActor,
      fixture.batch.id,
      audit(schoolAdminUser.id, 'SCHOOL_ADMIN', fixture.membership.id),
    )
    await releaseService.approve(
      platformActor(),
      fixture.batch.id,
      audit(platformUser.id),
    )

    await prisma.schoolInvoice.update({
      where: { id: fixture.invoice.id },
      data: {
        status: 'ISSUED',
        paidMinor: 0,
        outstandingMinor: fixture.invoice.totalMinor,
      },
    })

    const released = await releaseService.release(
      platformActor(),
      fixture.batch.id,
      audit(platformUser.id),
    )
    expect(released.releaseStatus).toBe('RELEASED')

    const stored = await prisma.reportGenerationBatch.findUniqueOrThrow({
      where: { id: fixture.batch.id },
    })
    expect(stored.releaseStatus).toBe('RELEASED')
    expect(stored.releasedAt).toBeInstanceOf(Date)
    expect(stored.releasedByUserId).toBe(platformUser.id)

    const pdf = await reportService.getStoredPdf(
      fixture.reportActor,
      fixture.reportCard.id,
      1,
    )
    expect(pdf.data.subarray(0, 5).toString()).toBe('%PDF-')

    // No failed release attempt was recorded for a payment reason.
    const failed = await prisma.auditLog.count({
      where: {
        entityId: fixture.batch.id,
        action: 'REPORT_RELEASE_FAILED',
      },
    })
    expect(failed).toBe(0)
  }, 30_000)

  it('serializes concurrent release attempts and records one release', async () => {
    const fixture = await createFixture({ fullyPaid: true })

    await releaseService.submit(
      fixture.schoolActor,
      fixture.batch.id,
      audit(schoolAdminUser.id, 'SCHOOL_ADMIN', fixture.membership.id),
    )
    await releaseService.approve(
      platformActor(),
      fixture.batch.id,
      audit(platformUser.id),
    )

    const outcomes = await Promise.allSettled([
      releaseService.release(
        platformActor(),
        fixture.batch.id,
        audit(platformUser.id),
      ),
      releaseService.release(
        platformActor(),
        fixture.batch.id,
        audit(platformUser.id),
      ),
    ])

    expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1)
    const rejected = outcomes.filter(
      (item): item is PromiseRejectedResult => item.status === 'rejected',
    )
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.reason).toMatchObject({ statusCode: 409 })

    const stored = await prisma.reportGenerationBatch.findUniqueOrThrow({
      where: { id: fixture.batch.id },
    })
    expect(stored.releaseStatus).toBe('RELEASED')

    const releasedAudits = await prisma.auditLog.count({
      where: {
        entityId: fixture.batch.id,
        action: 'REPORT_RELEASE_RELEASED',
      },
    })
    expect(releasedAudits).toBe(1)
  }, 30_000)

  it('isolates batches between schools', async () => {
    const fixture = await createFixture({ fullyPaid: true })
    const otherSuffix = nextSuffix()
    const otherSchool = await prisma.school.create({
      data: {
        name: `Other Release IT ${otherSuffix}`,
        slug: `other-release-it-${otherSuffix}`,
      },
    })
    createdSchoolIds.push(otherSchool.id)
    const otherMembership = await prisma.schoolMembership.create({
      data: {
        schoolId: otherSchool.id,
        userId: schoolAdminUser.id,
        role: 'SCHOOL_ADMIN',
        status: 'ACTIVE',
      },
    })

    const otherActor: ReportReleaseActor = {
      ...fixture.schoolActor,
      schoolId: otherSchool.id,
      membershipId: otherMembership.id,
    }

    await expect(
      releaseService.getSchoolBatch(otherActor, fixture.batch.id),
    ).rejects.toMatchObject({ statusCode: 404 })

    await expect(
      releaseService.submit(
        otherActor,
        fixture.batch.id,
        audit(schoolAdminUser.id, 'SCHOOL_ADMIN', otherMembership.id),
      ),
    ).rejects.toMatchObject({ statusCode: 404 })

    const stored = await prisma.reportGenerationBatch.findUniqueOrThrow({
      where: { id: fixture.batch.id },
    })
    expect(stored.releaseStatus).toBe('GENERATED')
  }, 30_000)

  it('requires an explicit return or hold reason at the database boundary', async () => {
    const fixture = await createFixture({ fullyPaid: true })

    await releaseService.submit(
      fixture.schoolActor,
      fixture.batch.id,
      audit(schoolAdminUser.id, 'SCHOOL_ADMIN', fixture.membership.id),
    )

    await expect(
      releaseService.returnBatch(
        platformActor(),
        fixture.batch.id,
        '  ',
        audit(platformUser.id),
      ),
    ).rejects.toMatchObject({ statusCode: 400 })

    const held = await releaseService.hold(
      platformActor(),
      fixture.batch.id,
      'Finance is verifying the transfer.',
      audit(platformUser.id),
    )
    expect(held.releaseStatus).toBe('ON_HOLD')
    expect(held.holdReason).toBe('Finance is verifying the transfer.')

    const unheld = await releaseService.unhold(
      fixture.batch.id,
      audit(platformUser.id),
    )
    expect(unheld.releaseStatus).toBe('PENDING_PLATFORM_REVIEW')
    expect(unheld.holdReason).toBeNull()
  }, 30_000)

  it('allows exactly one of two concurrent platform approvals', async () => {
    const fixture = await createFixture({ fullyPaid: true })

    await releaseService.submit(
      fixture.schoolActor,
      fixture.batch.id,
      audit(schoolAdminUser.id, 'SCHOOL_ADMIN', fixture.membership.id),
    )

    const outcomes = await Promise.allSettled([
      releaseService.approve(
        platformActor(),
        fixture.batch.id,
        audit(platformUser.id),
      ),
      releaseService.approve(
        platformActor(),
        fixture.batch.id,
        audit(platformUser.id),
      ),
    ])

    expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1)
    const rejected = outcomes.filter(
      (item): item is PromiseRejectedResult => item.status === 'rejected',
    )
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.reason).toMatchObject({ statusCode: 409 })

    const stored = await prisma.reportGenerationBatch.findUniqueOrThrow({
      where: { id: fixture.batch.id },
    })
    expect(stored.releaseStatus).toBe('APPROVED')
    expect(stored.releasedAt).toBeNull()

    const approvedAudits = await prisma.auditLog.count({
      where: {
        entityId: fixture.batch.id,
        action: 'REPORT_RELEASE_APPROVED',
      },
    })
    expect(approvedAudits).toBe(1)
  }, 30_000)

  it('keeps hold and release mutually consistent when raced', async () => {
    const fixture = await createFixture({ fullyPaid: true })

    await releaseService.submit(
      fixture.schoolActor,
      fixture.batch.id,
      audit(schoolAdminUser.id, 'SCHOOL_ADMIN', fixture.membership.id),
    )
    await releaseService.approve(
      platformActor(),
      fixture.batch.id,
      audit(platformUser.id),
    )

    const outcomes = await Promise.allSettled([
      releaseService.release(
        platformActor(),
        fixture.batch.id,
        audit(platformUser.id),
      ),
      releaseService.hold(
        platformActor(),
        fixture.batch.id,
        'Concurrent finance hold.',
        audit(platformUser.id),
      ),
    ])

    expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1)

    const stored = await prisma.reportGenerationBatch.findUniqueOrThrow({
      where: { id: fixture.batch.id },
    })

    if (stored.releaseStatus === 'RELEASED') {
      expect(stored.releasedAt).toBeInstanceOf(Date)
      expect(stored.releasedByUserId).toBe(platformUser.id)
    } else {
      expect(stored.releaseStatus).toBe('ON_HOLD')
      expect(stored.releasedAt).toBeNull()
      expect(stored.releasedByUserId).toBeNull()
      expect(stored.previousReleaseStatus).toBe('APPROVED')
    }

    const releasedAudits = await prisma.auditLog.count({
      where: {
        entityId: fixture.batch.id,
        action: 'REPORT_RELEASE_RELEASED',
      },
    })
    expect(releasedAudits).toBe(stored.releaseStatus === 'RELEASED' ? 1 : 0)
  }, 30_000)

  it('ignores a duplicate submission and does not transition twice', async () => {
    const fixture = await createFixture({ fullyPaid: true })

    await releaseService.submit(
      fixture.schoolActor,
      fixture.batch.id,
      audit(schoolAdminUser.id, 'SCHOOL_ADMIN', fixture.membership.id),
    )

    await expect(
      releaseService.submit(
        fixture.schoolActor,
        fixture.batch.id,
        audit(schoolAdminUser.id, 'SCHOOL_ADMIN', fixture.membership.id),
      ),
    ).rejects.toMatchObject({ statusCode: 409 })

    const stored = await prisma.reportGenerationBatch.findUniqueOrThrow({
      where: { id: fixture.batch.id },
    })
    expect(stored.releaseStatus).toBe('PENDING_PLATFORM_REVIEW')

    const submittedAudits = await prisma.auditLog.findMany({
      where: {
        entityId: fixture.batch.id,
        action: {
          in: ['REPORT_RELEASE_SUBMITTED', 'REPORT_RELEASE_RESUBMITTED'],
        },
      },
    })
    expect(submittedAudits).toHaveLength(1)
  }, 30_000)

  it('returns a batch and accepts a resubmission without leaking the report', async () => {
    const fixture = await createFixture({ fullyPaid: true })

    await releaseService.submit(
      fixture.schoolActor,
      fixture.batch.id,
      audit(schoolAdminUser.id, 'SCHOOL_ADMIN', fixture.membership.id),
    )

    const returned = await releaseService.returnBatch(
      platformActor(),
      fixture.batch.id,
      'Attendance totals need correction.',
      audit(platformUser.id),
    )
    expect(returned.releaseStatus).toBe('RETURNED')
    expect(returned.returnedReason).toBe('Attendance totals need correction.')

    await expect(
      reportService.getStoredPdf(fixture.reportActor, fixture.reportCard.id, 1),
    ).rejects.toMatchObject({ statusCode: 403 })

    const resubmitted = await releaseService.submit(
      fixture.schoolActor,
      fixture.batch.id,
      audit(schoolAdminUser.id, 'SCHOOL_ADMIN', fixture.membership.id),
    )
    expect(resubmitted.releaseStatus).toBe('PENDING_PLATFORM_REVIEW')
    expect(resubmitted.returnedReason).toBeNull()

    const resubmissionAudit = await prisma.auditLog.findFirstOrThrow({
      where: {
        entityId: fixture.batch.id,
        action: 'REPORT_RELEASE_RESUBMITTED',
      },
    })
    expect(resubmissionAudit.actorUserId).toBe(schoolAdminUser.id)
    expect(resubmissionAudit.metadata).toMatchObject({
      actorMembershipId: fixture.membership.id,
      actorRole: 'SCHOOL_ADMIN',
      fromStatus: 'RETURNED',
      toStatus: 'PENDING_PLATFORM_REVIEW',
    })
  }, 30_000)

  it('submits independently of a pending payment verification', async () => {
    const fixture = await createFixture({
      fullyPaid: false,
      invoiceStatus: 'ISSUED',
    })

    await prisma.payment.create({
      data: {
        schoolId: fixture.school.id,
        invoiceId: fixture.invoice.id,
        source: 'MANUAL',
        method: 'BANK_TRANSFER',
        status: 'UNDER_REVIEW',
        amountMinor: fixture.invoice.totalMinor,
        appliedMinor: 0,
        overpaymentMinor: 0,
        currency: fixture.invoice.currency,
        paymentReference: `PAY-RL-${nextSuffix()}`,
        paidAt: new Date('2026-11-02T00:00:00.000Z'),
        submittedByMembershipId: fixture.membership.id,
      },
    })

    const submitted = await releaseService.submit(
      fixture.schoolActor,
      fixture.batch.id,
      audit(schoolAdminUser.id, 'SCHOOL_ADMIN', fixture.membership.id),
    )
    expect(submitted.releaseStatus).toBe('PENDING_PLATFORM_REVIEW')

    const stored = await prisma.reportGenerationBatch.findUniqueOrThrow({
      where: { id: fixture.batch.id },
    })
    expect(stored.releaseStatus).toBe('PENDING_PLATFORM_REVIEW')

    const payment = await prisma.payment.findFirstOrThrow({
      where: { invoiceId: fixture.invoice.id },
    })
    expect(payment.status).toBe('UNDER_REVIEW')
  }, 30_000)

  it('blocks submission when the report was not built from accepted results', async () => {
    const fixture = await createFixture({
      fullyPaid: true,
      acceptedSubmissions: 0,
      subjectCount: 0,
    })

    const error = await releaseService
      .submit(
        fixture.schoolActor,
        fixture.batch.id,
        audit(schoolAdminUser.id, 'SCHOOL_ADMIN', fixture.membership.id),
      )
      .catch((caught: unknown) => caught)

    expect(error).toMatchObject({ statusCode: 409 })
    expect(
      (error as { details?: { issues?: Array<{ code: string }> } }).details
        ?.issues?.map((issue) => issue.code),
    ).toContain('RESULTS_NOT_ACCEPTED')

    const stored = await prisma.reportGenerationBatch.findUniqueOrThrow({
      where: { id: fixture.batch.id },
    })
    expect(stored.releaseStatus).toBe('GENERATED')
  }, 30_000)

  it('refuses release when the private PDF disappears after approval', async () => {
    const fixture = await createFixture({ fullyPaid: true })

    await releaseService.submit(
      fixture.schoolActor,
      fixture.batch.id,
      audit(schoolAdminUser.id, 'SCHOOL_ADMIN', fixture.membership.id),
    )
    await releaseService.approve(
      platformActor(),
      fixture.batch.id,
      audit(platformUser.id),
    )

    await storage.deleteObject(fixture.version.storageKey)

    await expect(
      releaseService.release(
        platformActor(),
        fixture.batch.id,
        audit(platformUser.id),
      ),
    ).rejects.toMatchObject({ statusCode: 409 })

    const stored = await prisma.reportGenerationBatch.findUniqueOrThrow({
      where: { id: fixture.batch.id },
    })
    expect(stored.releaseStatus).toBe('APPROVED')
    expect(stored.releasedAt).toBeNull()

    const failed = await prisma.auditLog.findFirstOrThrow({
      where: {
        entityId: fixture.batch.id,
        action: 'REPORT_RELEASE_FAILED',
      },
    })
    expect(failed.metadata).toMatchObject({
      actorRole: 'PLATFORM_SUPER_ADMIN',
      reason: expect.stringContaining('missing from private storage'),
    })

    await expect(
      reportService.getStoredPdf(fixture.reportActor, fixture.reportCard.id, 1),
    ).rejects.toMatchObject({ statusCode: 403 })
  }, 30_000)

  it('hides a released report from another school', async () => {
    const fixture = await createFixture({ fullyPaid: true })

    await releaseService.submit(
      fixture.schoolActor,
      fixture.batch.id,
      audit(schoolAdminUser.id, 'SCHOOL_ADMIN', fixture.membership.id),
    )
    await releaseService.approve(
      platformActor(),
      fixture.batch.id,
      audit(platformUser.id),
    )
    const released = await releaseService.release(
      platformActor(),
      fixture.batch.id,
      audit(platformUser.id),
    )
    expect(released.releaseStatus).toBe('RELEASED')

    const otherSuffix = nextSuffix()
    const otherSchool = await prisma.school.create({
      data: {
        name: `Cross-school Release IT ${otherSuffix}`,
        slug: `cross-school-release-it-${otherSuffix}`,
      },
    })
    createdSchoolIds.push(otherSchool.id)

    const otherMembership = await prisma.schoolMembership.create({
      data: {
        schoolId: otherSchool.id,
        userId: schoolAdminUser.id,
        role: 'SCHOOL_ADMIN',
        status: 'ACTIVE',
      },
    })

    const otherReportActor: ReportActor = {
      schoolId: otherSchool.id,
      userId: schoolAdminUser.id,
      membershipId: otherMembership.id,
      role: 'SCHOOL_ADMIN',
    }

    await expect(
      reportService.getStoredPdf(otherReportActor, fixture.reportCard.id, 1),
    ).rejects.toMatchObject({ statusCode: 404 })

    await expect(
      reportService.getCard(otherReportActor, fixture.reportCard.id),
    ).rejects.toMatchObject({ statusCode: 404 })

    const cards = await reportService.listCards(otherReportActor, {
      academicTermId: fixture.term.id,
    })
    expect(cards).toHaveLength(0)

    // The owning school can still retrieve an explicitly released PDF.
    const owned = await reportService.getStoredPdf(
      fixture.reportActor,
      fixture.reportCard.id,
      1,
    )
    expect(owned.data.equals(PDF_BYTES)).toBe(false)
    expect(owned.data.subarray(0, 5).toString()).toBe('%PDF-')
  }, 30_000)

  it('keeps release metadata and storage keys out of public summaries', async () => {
    const fixture = await createFixture({ fullyPaid: true })

    const [summary] = await releaseService.listSchoolBatches(
      fixture.schoolActor,
      {},
    )

    expect(summary).toBeDefined()
    expect(summary).not.toHaveProperty('versions')
    expect(JSON.stringify(summary)).not.toContain(fixture.version.storageKey)
    expect(JSON.stringify(summary)).not.toContain('"snapshot"')
  }, 30_000)
})
