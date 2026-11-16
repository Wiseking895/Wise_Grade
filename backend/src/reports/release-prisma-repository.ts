import { HttpError } from '../errors/http-error.js'
import { getPrismaClient } from '../lib/prisma.js'
import type { Prisma } from '../generated/prisma/client.js'
import { mapReportBatch } from './prisma-repository.js'
import type {
  PlatformReportSchoolScope,
  ReportReleaseBatchRecord,
  ReportReleaseInvoiceRecord,
  ReportReleaseOverview,
  ReportReleasePreviewRecord,
  ReportReleaseRepository,
  ReportReleaseTransitionInput,
  ReportReleaseVersionRecord,
} from './release-repository.js'

type Tx = Prisma.TransactionClient

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function personName(
  user: { firstName: string; lastName: string } | null | undefined,
): string | null {
  return user ? `${user.firstName} ${user.lastName}`.trim() : null
}

function membershipName(
  membership:
    | { user: { firstName: string; lastName: string } }
    | null
    | undefined,
): string | null {
  return membership ? personName(membership.user) : null
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

const batchInclude = {
  school: { select: { name: true, isActive: true } },
  academicYear: { select: { name: true, schoolId: true } },
  academicTerm: {
    select: { name: true, schoolId: true, academicYearId: true },
  },
  class: { select: { name: true } },
  requestedBy: {
    include: { user: { select: { firstName: true, lastName: true } } },
  },
  submittedBy: {
    include: { user: { select: { firstName: true, lastName: true } } },
  },
  reviewedBy: { select: { firstName: true, lastName: true } },
  heldBy: { select: { firstName: true, lastName: true } },
  releasedBy: { select: { firstName: true, lastName: true } },
  versions: {
    include: {
      reportCard: {
        select: {
          schoolId: true,
          pupilId: true,
          academicYearId: true,
          academicTermId: true,
          classId: true,
          pupil: {
            select: {
              firstName: true,
              lastName: true,
              otherNames: true,
              admissionNumber: true,
            },
          },
        },
      },
    },
    orderBy: [{ generatedAt: 'asc' }, { version: 'asc' }],
  },
} satisfies Prisma.ReportGenerationBatchInclude

type BatchRow = Prisma.ReportGenerationBatchGetPayload<{
  include: typeof batchInclude
}>

function mapVersion(row: BatchRow['versions'][number]): ReportReleaseVersionRecord {
  return {
    id: row.id,
    schoolId: row.schoolId,
    reportCardId: row.reportCardId,
    reportCardSchoolId: row.reportCard.schoolId,
    pupilId: row.reportCard.pupilId,
    pupilName: fullName(row.reportCard.pupil),
    admissionNumber: row.reportCard.pupil.admissionNumber,
    version: row.version,
    generatedAt: row.generatedAt,
    storageKey: row.storageKey,
    checksum: row.checksum,
    byteSize: row.byteSize,
    academicYearId: row.reportCard.academicYearId,
    academicTermId: row.reportCard.academicTermId,
    classId: row.reportCard.classId,
    snapshot: row.snapshot,
  }
}

function mapInvoice(
  row: {
    id: string
    invoiceNumber: string
    status: string
    currency: string
    totalMinor: number
    paidMinor: number
    outstandingMinor: number
    pupils: Array<{ reportCardId: string | null }>
  } | null,
): ReportReleaseInvoiceRecord | null {
  if (!row) {
    return null
  }

  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    status: row.status,
    currency: row.currency,
    totalMinor: row.totalMinor,
    paidMinor: row.paidMinor,
    outstandingMinor: row.outstandingMinor,
    pupilReportCardIds: row.pupils
      .map((pupil) => pupil.reportCardId)
      .filter((id): id is string => Boolean(id)),
  }
}

async function invoiceForBatch(
  prisma: Tx | ReturnType<typeof getPrismaClient>,
  row: BatchRow,
): Promise<ReportReleaseInvoiceRecord | null> {
  const invoice = await prisma.schoolInvoice.findUnique({
    where: {
      schoolId_academicYearId_academicTermId: {
        schoolId: row.schoolId,
        academicYearId: row.academicYearId,
        academicTermId: row.academicTermId,
      },
    },
    include: { pupils: { select: { reportCardId: true } } },
  })

  return mapInvoice(invoice)
}

async function mapBatchRow(
  prisma: Tx | ReturnType<typeof getPrismaClient>,
  row: BatchRow,
): Promise<ReportReleaseBatchRecord> {
  return {
    batch: mapReportBatch(row),
    schoolName: row.school.name,
    schoolIsActive: row.school.isActive,
    academicYearName: row.academicYear.name,
    academicYearSchoolId: row.academicYear.schoolId,
    academicTermName: row.academicTerm.name,
    academicTermSchoolId: row.academicTerm.schoolId,
    academicTermYearId: row.academicTerm.academicYearId,
    className: row.class?.name ?? null,
    requestedByName: membershipName(row.requestedBy),
    submittedByName: membershipName(row.submittedBy),
    reviewedByName: personName(row.reviewedBy),
    heldByName: personName(row.heldBy),
    releasedByName: personName(row.releasedBy),
    invoice: await invoiceForBatch(prisma, row),
    versions: row.versions.map(mapVersion),
  }
}

async function lockBatchRow(tx: Tx, batchId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "ReportGenerationBatch" WHERE "id" = CAST(${batchId} AS uuid) FOR UPDATE`
}

/**
 * Transactional defense-in-depth. The service performs the full eligibility
 * check (including private storage integrity); this guard re-reads the mutable
 * database facts after locking so a concurrent generation change or cross-scope
 * mutation cannot slip between review and release.
 */
async function assertEligibleTx(tx: Tx, row: BatchRow): Promise<void> {
  const issues: string[] = []

  if (row.status !== 'COMPLETED') {
    issues.push('GENERATION_INCOMPLETE')
  }

  if (row.failedCount > 0) {
    issues.push('GENERATION_FAILURES')
  }

  if (row.skippedCount > 0) {
    issues.push('GENERATION_SKIPPED')
  }

  if (row.generatedCount <= 0 || row.versions.length === 0) {
    issues.push('NO_GENERATED_REPORTS')
  }

  const [school, year, term] = await Promise.all([
    tx.school.findUnique({
      where: { id: row.schoolId },
      select: { isActive: true },
    }),
    tx.academicYear.findFirst({
      where: { id: row.academicYearId, schoolId: row.schoolId },
      select: { id: true },
    }),
    tx.academicTerm.findFirst({
      where: {
        id: row.academicTermId,
        schoolId: row.schoolId,
        academicYearId: row.academicYearId,
      },
      select: { id: true },
    }),
  ])

  if (!school?.isActive) {
    issues.push('SCHOOL_INACTIVE')
  }

  if (!year || !term) {
    issues.push('YEAR_TERM_INVALID')
  }

  for (const version of row.versions) {
    if (
      version.schoolId !== row.schoolId ||
      version.reportCard.schoolId !== row.schoolId ||
      version.reportCard.academicYearId !== row.academicYearId ||
      version.reportCard.academicTermId !== row.academicTermId ||
      (row.classId !== null && version.reportCard.classId !== row.classId)
    ) {
      issues.push('REPORT_SCOPE_INVALID')
    }

    if (
      snapshotAcceptedCount(version.snapshot) <= 0 ||
      snapshotSubjectCount(version.snapshot) <= 0
    ) {
      issues.push('RESULTS_NOT_ACCEPTED')
    }
  }

  if (issues.length > 0) {
    throw new HttpError(
      409,
      'This report batch is not eligible for platform review or release.',
      { issues: [...new Set(issues)] },
    )
  }
}

function transitionData(
  input: ReportReleaseTransitionInput,
): Prisma.ReportGenerationBatchUncheckedUpdateInput {
  return {
    releaseStatus: input.next,
    ...input.set,
  }
}

export function createPrismaReportReleaseRepository(): ReportReleaseRepository {
  const repository: ReportReleaseRepository = {
    async listSchoolBatches(actor, filter) {
      const prisma = getPrismaClient()
      const rows = await prisma.reportGenerationBatch.findMany({
        where: {
          schoolId: actor.schoolId,
          ...(filter.academicTermId
            ? { academicTermId: filter.academicTermId }
            : {}),
        },
        include: batchInclude,
        orderBy: [{ createdAt: 'desc' }],
      })

      return Promise.all(rows.map((row) => mapBatchRow(prisma, row)))
    },

    async getSchoolBatch(actor, batchId) {
      const prisma = getPrismaClient()
      const row = await prisma.reportGenerationBatch.findFirst({
        where: { id: batchId, schoolId: actor.schoolId },
        include: batchInclude,
      })

      return row ? mapBatchRow(prisma, row) : null
    },

    async listPlatformBatches(filter) {
      const prisma = getPrismaClient()
      const where: Prisma.ReportGenerationBatchWhereInput = {
        ...(filter.schoolId ? { schoolId: filter.schoolId } : {}),
        ...(filter.academicYearId
          ? { academicYearId: filter.academicYearId }
          : {}),
        ...(filter.academicTermId
          ? { academicTermId: filter.academicTermId }
          : {}),
        ...(filter.status ? { releaseStatus: filter.status } : {}),
        ...(filter.submittedFrom || filter.submittedTo
          ? {
              submittedAt: {
                ...(filter.submittedFrom
                  ? { gte: filter.submittedFrom }
                  : {}),
                ...(filter.submittedTo ? { lte: filter.submittedTo } : {}),
              },
            }
          : {}),
      }

      const rows = await prisma.reportGenerationBatch.findMany({
        where,
        include: batchInclude,
        orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
      })

      return Promise.all(rows.map((row) => mapBatchRow(prisma, row)))
    },

    async getPlatformBatch(batchId) {
      const prisma = getPrismaClient()
      const row = await prisma.reportGenerationBatch.findUnique({
        where: { id: batchId },
        include: batchInclude,
      })

      return row ? mapBatchRow(prisma, row) : null
    },

    async overview() {
      const prisma = getPrismaClient()
      const [
        totalGenerated,
        generated,
        pendingReview,
        returned,
        approvedUnreleased,
        released,
        onHold,
      ] = await Promise.all([
        prisma.reportGenerationBatch.count({
          where: { status: { in: ['COMPLETED', 'COMPLETED_WITH_FAILURES'] } },
        }),
        prisma.reportGenerationBatch.count({
          where: { releaseStatus: 'GENERATED' },
        }),
        prisma.reportGenerationBatch.count({
          where: { releaseStatus: 'PENDING_PLATFORM_REVIEW' },
        }),
        prisma.reportGenerationBatch.count({
          where: { releaseStatus: 'RETURNED' },
        }),
        prisma.reportGenerationBatch.count({
          where: { releaseStatus: 'APPROVED' },
        }),
        prisma.reportGenerationBatch.count({
          where: { releaseStatus: 'RELEASED' },
        }),
        prisma.reportGenerationBatch.count({
          where: { releaseStatus: 'ON_HOLD' },
        }),
      ])

      return {
        totalGenerated,
        generated,
        pendingReview,
        returned,
        approvedUnreleased,
        released,
        onHold,
      } satisfies ReportReleaseOverview
    },

    async listPlatformSchools() {
      const prisma = getPrismaClient()
      const schools = await prisma.school.findMany({
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          isActive: true,
          academicYears: {
            orderBy: { startsOn: 'desc' },
            select: {
              id: true,
              name: true,
              terms: {
                orderBy: { sequence: 'asc' },
                select: { id: true, name: true },
              },
            },
          },
        },
      })

      return schools.map(
        (school): PlatformReportSchoolScope => ({
          id: school.id,
          name: school.name,
          isActive: school.isActive,
          academicYears: school.academicYears.map((year) => ({
            id: year.id,
            name: year.name,
            terms: year.terms.map((term) => ({
              id: term.id,
              name: term.name,
            })),
          })),
        }),
      )
    },

    async transition(input) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        await lockBatchRow(tx, input.batchId)

        const row = await tx.reportGenerationBatch.findFirst({
          where: {
            id: input.batchId,
            ...(input.schoolId ? { schoolId: input.schoolId } : {}),
          },
          include: batchInclude,
        })

        if (!row) {
          throw new HttpError(404, 'Report generation batch not found')
        }

        if (!input.expected.includes(row.releaseStatus)) {
          throw new HttpError(
            409,
            'This report batch is no longer in a state that allows that action.',
          )
        }

        if (input.requireEligible) {
          await assertEligibleTx(tx, row)
        }

        const updated = await tx.reportGenerationBatch.update({
          where: { id: row.id },
          data: transitionData(input),
        })

        await tx.auditLog.create({
          data: {
            schoolId: row.schoolId,
            actorUserId: input.actor.actorUserId,
            action: input.action,
            entityType: 'ReportGenerationBatch',
            entityId: row.id,
            metadata: jsonValue({
              actorRole: input.actor.actorRole,
              actorMembershipId: input.actor.actorMembershipId,
              fromStatus: row.releaseStatus,
              toStatus: input.next,
              reason: input.reason ?? null,
              reportCount: row.versions.length,
              ...input.metadata,
            }),
            ipAddress: input.actor.ipAddress ?? null,
            userAgent: input.actor.userAgent ?? null,
          },
        })

        return mapReportBatch(updated)
      })
    },

    async recordFailedAttempt(input) {
      const prisma = getPrismaClient()

      await prisma.auditLog.create({
        data: {
          schoolId: input.schoolId,
          actorUserId: input.actor.actorUserId,
          action: input.action,
          entityType: 'ReportGenerationBatch',
          entityId: input.batchId,
          metadata: jsonValue({
            actorRole: input.actor.actorRole,
            actorMembershipId: input.actor.actorMembershipId,
            reason: input.reason,
            ...input.metadata,
          }),
          ipAddress: input.actor.ipAddress ?? null,
          userAgent: input.actor.userAgent ?? null,
        },
      })
    },

    async getPreview(batchId, versionId) {
      const prisma = getPrismaClient()
      const batch = await prisma.reportGenerationBatch.findUnique({
        where: { id: batchId },
        select: { id: true, schoolId: true },
      })

      if (!batch) {
        return null
      }

      const version = await prisma.reportCardVersion.findFirst({
        where: {
          id: versionId,
          batchId,
          schoolId: batch.schoolId,
        },
        include: {
          reportCard: {
            include: {
              pupil: {
                select: {
                  firstName: true,
                  lastName: true,
                  otherNames: true,
                  admissionNumber: true,
                },
              },
            },
          },
        },
      })

      if (!version) {
        return null
      }

      const pupilName = fullName(version.reportCard.pupil)
      const safeAdmission = version.reportCard.pupil.admissionNumber.replace(
        /[^A-Za-z0-9_-]+/g,
        '-',
      )

      return {
        batchId: batch.id,
        schoolId: batch.schoolId,
        versionId: version.id,
        reportCardId: version.reportCardId,
        version: version.version,
        pupilName,
        admissionNumber: version.reportCard.pupil.admissionNumber,
        storageKey: version.storageKey,
        checksum: version.checksum,
        byteSize: version.byteSize,
        fileName: `report-${safeAdmission}-v${version.version}.pdf`,
      } satisfies ReportReleasePreviewRecord
    },
  }

  return repository
}
