import { getPrismaClient } from '../lib/prisma.js'
import type { Prisma } from '../generated/prisma/client.js'
import { isSchoolIdentityComplete } from '../lib/school-branding.js'
import type { PlatformRepository } from './repository.js'
import type {
  PlatformAccount,
  PlatformAccountSession,
  PlatformAuditEntry,
  PlatformAuditFilter,
  PlatformAuditPage,
  PlatformMonitoring,
  PlatformMonitoringBucket,
  PlatformOverview,
  PlatformSchoolDetail,
  PlatformSchoolFilter,
  PlatformSchoolMember,
  PlatformSchoolPayment,
  PlatformSchoolReportBatch,
  PlatformSchoolSummary,
  PlatformSettings,
} from './types.js'

const TEACHER_ROLES = ['CLASS_TEACHER', 'SUBJECT_TEACHER'] as const
const DEFAULT_CURRENCY = 'GHS'

const SETTING_SUPPORT_EMAIL = 'platform.supportEmail'
const SETTING_REGISTRATION_ENABLED = 'platform.registrationEnabled'

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function actorName(user: {
  firstName: string
  lastName: string
  email: string
} | null): string | null {
  return user ? `${user.firstName} ${user.lastName}`.trim() || user.email : null
}

/**
 * School logos are private. Platform viewers stream them through the platform
 * route, so the URL deliberately differs from the school-membership route.
 */
function platformLogoUrl(
  schoolId: string,
  logoUpdatedAt: Date | null,
): string | null {
  return logoUpdatedAt
    ? `/api/platform/schools/${schoolId}/logo?v=${logoUpdatedAt.getTime()}`
    : null
}

function emptyBucket(): PlatformMonitoringBucket {
  return { count: 0, schools: [] }
}

function addToBucket(
  bucket: PlatformMonitoringBucket,
  schoolId: string,
  schoolName: string,
  count: number,
  detail: string,
): void {
  bucket.count += count

  const existing = bucket.schools.find((item) => item.schoolId === schoolId)

  if (existing) {
    existing.count += count
    existing.detail = `${existing.detail}; ${detail}`
    return
  }

  bucket.schools.push({ schoolId, schoolName, count, detail })
}

function sortBucket(bucket: PlatformMonitoringBucket): PlatformMonitoringBucket {
  bucket.schools.sort((a, b) => b.count - a.count || a.schoolName.localeCompare(b.schoolName))
  return bucket
}

interface AuditQueryInput {
  action?: string
  schoolId?: string
  from?: Date
  to?: Date
  take: number
}

/**
 * Prisma-backed platform administration repository.
 *
 * Every read is platform-wide by design; the caller is always an authenticated
 * platform administrator. School-scoped routes continue to use the existing
 * tenant repositories and are unaffected.
 */
export function createPrismaPlatformRepository(): PlatformRepository {
  async function loadSettings(): Promise<PlatformSettings> {
    const prisma = getPrismaClient()
    const rows = await prisma.platformSetting.findMany({
      where: { key: { in: [SETTING_SUPPORT_EMAIL, SETTING_REGISTRATION_ENABLED] } },
      include: { updatedBy: { select: { firstName: true, lastName: true, email: true } } },
    })

    const byKey = new Map(rows.map((row) => [row.key, row]))
    const supportRow = byKey.get(SETTING_SUPPORT_EMAIL)
    const registrationRow = byKey.get(SETTING_REGISTRATION_ENABLED)

    const supportEmail =
      supportRow && typeof supportRow.value === 'string' ? supportRow.value : null

    const registrationEnabled =
      registrationRow && typeof registrationRow.value === 'boolean'
        ? registrationRow.value
        : true

    const latest = rows
      .slice()
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]

    return {
      supportEmail,
      registrationEnabled,
      updatedAt: toIso(latest?.updatedAt),
      updatedByName: latest ? actorName(latest.updatedBy) : null,
    }
  }

  async function auditQuery(input: AuditQueryInput): Promise<PlatformAuditEntry[]> {
    const prisma = getPrismaClient()
    const dateFilter =
      input.from || input.to
        ? {
            ...(input.from ? { gte: input.from } : {}),
            ...(input.to ? { lte: input.to } : {}),
          }
        : undefined

    const baseWhere = {
      ...(input.action ? { action: input.action } : {}),
      ...(input.schoolId ? { schoolId: input.schoolId } : {}),
      ...(dateFilter ? { createdAt: dateFilter } : {}),
    }

    const [auditLogs, billing, calendar] = await Promise.all([
      prisma.auditLog.findMany({
        where: baseWhere,
        include: {
          school: { select: { name: true } },
          actor: { select: { firstName: true, lastName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: input.take,
      }),
      prisma.billingAuditHistory.findMany({
        where: baseWhere,
        include: {
          school: { select: { name: true } },
          actor: { select: { firstName: true, lastName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: input.take,
      }),
      prisma.academicCalendarTransition.findMany({
        where: baseWhere,
        include: { school: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: input.take,
      }),
    ])

    const entries: PlatformAuditEntry[] = []

    for (const row of auditLogs) {
      entries.push({
        id: row.id,
        source: 'AUDIT_LOG',
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        schoolId: row.schoolId,
        schoolName: row.school?.name ?? null,
        actorUserId: row.actorUserId,
        actorName: actorName(row.actor),
        actorEmail: row.actor?.email ?? null,
        metadata: row.metadata,
        ipAddress: row.ipAddress,
        createdAt: row.createdAt.toISOString(),
      })
    }

    for (const row of billing) {
      entries.push({
        id: row.id,
        source: 'BILLING',
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        schoolId: row.schoolId,
        schoolName: row.school?.name ?? null,
        actorUserId: row.actorUserId,
        actorName: actorName(row.actor),
        actorEmail: row.actor?.email ?? null,
        metadata: row.metadata ?? row.afterState,
        ipAddress: row.ipAddress,
        createdAt: row.createdAt.toISOString(),
      })
    }

    for (const row of calendar) {
      entries.push({
        id: row.id,
        source: 'CALENDAR',
        action: row.action,
        entityType: 'AcademicCalendarTransition',
        entityId: row.id,
        schoolId: row.schoolId,
        schoolName: row.school.name,
        actorUserId: null,
        actorName: null,
        actorEmail: null,
        metadata: {
          status: row.status,
          trigger: row.trigger,
          message: row.message,
          ...(row.metadata && typeof row.metadata === 'object'
            ? (row.metadata as Record<string, unknown>)
            : {}),
        },
        ipAddress: null,
        createdAt: row.createdAt.toISOString(),
      })
    }

    return entries.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
  }

  function matchesSearch(entry: PlatformAuditEntry, search: string): boolean {
    const needle = search.toLowerCase()
    const haystack = [
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.schoolName,
      entry.actorName,
      entry.actorEmail,
      JSON.stringify(entry.metadata ?? ''),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    return haystack.includes(needle)
  }

  async function buildSchoolSummary(
    school: {
      id: string
      name: string
      slug: string
      email: string | null
      phone: string | null
      address: string | null
      landmark: string | null
      timezone: string
      isActive: boolean
      logoObjectKey: string | null
      logoMimeType: string | null
      logoUpdatedAt: Date | null
      createdAt: Date
    },
    pupilCount: number,
    teacherCount: number,
    classCount: number,
    currentTerm: { name: string; status: string; academicYear: { name: string } } | null,
    outstandingMinor: number,
    currency: string,
    reportCounts: { prepared: number; awaitingRelease: number; released: number },
  ): Promise<PlatformSchoolSummary> {
    return {
      id: school.id,
      name: school.name,
      slug: school.slug,
      email: school.email,
      phone: school.phone,
      address: school.address,
      landmark: school.landmark,
      timezone: school.timezone,
      isActive: school.isActive,
      logoUrl: platformLogoUrl(school.id, school.logoUpdatedAt),
      createdAt: school.createdAt.toISOString(),
      pupilCount,
      teacherCount,
      classCount,
      currentAcademicYearName: currentTerm?.academicYear.name ?? null,
      currentTermName: currentTerm?.name ?? null,
      currentTermStatus: currentTerm?.status ?? null,
      outstandingMinor,
      currency,
      reportsPrepared: reportCounts.prepared,
      reportsAwaitingRelease: reportCounts.awaitingRelease,
      reportsReleased: reportCounts.released,
    }
  }

  return {
    async overview(): Promise<PlatformOverview> {
      const prisma = getPrismaClient()
      const now = new Date()

      const [
        totalSchools,
        activeSchools,
        totalPupils,
        teacherRows,
        activeUsers,
        academicYears,
        activeTerms,
        currentTerm,
        reportsPrepared,
        awaitingApproval,
        approvedAwaitingRelease,
        released,
        onHold,
        awaitingVerification,
        verifiedAgg,
        outstandingAgg,
        latestPricing,
      ] = await Promise.all([
        prisma.school.count(),
        prisma.school.count({ where: { isActive: true } }),
        prisma.pupil.count({ where: { status: 'ACTIVE' } }),
        prisma.schoolMembership.findMany({
          where: { status: 'ACTIVE', role: { in: [...TEACHER_ROLES] } },
          select: { userId: true },
          distinct: ['userId'],
        }),
        prisma.user.count({ where: { isActive: true } }),
        prisma.academicYear.count(),
        prisma.academicTerm.count({ where: { status: 'OPEN' } }),
        prisma.academicTerm.findFirst({
          where: { isCurrent: true, status: 'OPEN' },
          include: { academicYear: { select: { name: true } } },
          orderBy: { startsOn: 'desc' },
        }),
        prisma.reportCardVersion.count(),
        prisma.reportGenerationBatch.count({
          where: { releaseStatus: 'PENDING_PLATFORM_REVIEW' },
        }),
        prisma.reportGenerationBatch.count({ where: { releaseStatus: 'APPROVED' } }),
        prisma.reportGenerationBatch.count({ where: { releaseStatus: 'RELEASED' } }),
        prisma.reportGenerationBatch.count({ where: { releaseStatus: 'ON_HOLD' } }),
        prisma.payment.count({
          where: { status: { in: ['PENDING', 'UNDER_REVIEW'] } },
        }),
        prisma.payment.aggregate({
          where: { status: 'VERIFIED' },
          _count: { _all: true },
          _sum: { appliedMinor: true },
        }),
        prisma.schoolInvoice.aggregate({
          where: { status: { in: ['ISSUED', 'PARTIALLY_PAID'] } },
          _sum: { outstandingMinor: true },
        }),
        prisma.pricingRule.findFirst({ orderBy: { effectiveFrom: 'desc' } }),
      ])

      const recentActivity = await auditQuery({ take: 8 })

      return {
        schools: {
          total: totalSchools,
          active: activeSchools,
          suspended: totalSchools - activeSchools,
        },
        people: {
          pupils: totalPupils,
          teachers: teacherRows.length,
          activeUsers,
        },
        academics: {
          academicYears,
          activeTerms,
          currentTermName: currentTerm?.name ?? null,
          currentAcademicYearName: currentTerm?.academicYear.name ?? null,
        },
        reports: {
          prepared: reportsPrepared,
          awaitingApproval,
          approvedAwaitingRelease,
          released,
          onHold,
        },
        payments: {
          awaitingVerification,
          verifiedCount: verifiedAgg._count._all,
          verifiedMinor: verifiedAgg._sum.appliedMinor ?? 0,
          outstandingMinor: outstandingAgg._sum.outstandingMinor ?? 0,
          currency: latestPricing?.currency ?? DEFAULT_CURRENCY,
        },
        recentActivity,
        generatedAt: now.toISOString(),
      }
    },

    async listSchools(filter: PlatformSchoolFilter): Promise<PlatformSchoolSummary[]> {
      const prisma = getPrismaClient()
      const search = filter.search?.trim()
      const status = filter.status ?? 'all'

      const schools = await prisma.school.findMany({
        where: {
          ...(status === 'active' ? { isActive: true } : {}),
          ...(status === 'suspended' ? { isActive: false } : {}),
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: 'insensitive' } },
                  { slug: { contains: search, mode: 'insensitive' } },
                  { email: { contains: search, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        orderBy: { name: 'asc' },
      })

      if (schools.length === 0) {
        return []
      }

      const schoolIds = schools.map((school) => school.id)

      const [
        pupilCounts,
        classCounts,
        teacherCounts,
        currentTerms,
        outstanding,
        batches,
      ] = await Promise.all([
        prisma.pupil.groupBy({
          by: ['schoolId'],
          where: { schoolId: { in: schoolIds }, status: 'ACTIVE' },
          _count: { _all: true },
        }),
        prisma.schoolClass.groupBy({
          by: ['schoolId'],
          where: { schoolId: { in: schoolIds }, isArchived: false },
          _count: { _all: true },
        }),
        prisma.schoolMembership.groupBy({
          by: ['schoolId'],
          where: {
            schoolId: { in: schoolIds },
            status: 'ACTIVE',
            role: { in: [...TEACHER_ROLES] },
          },
          _count: { _all: true },
        }),
        prisma.academicTerm.findMany({
          where: { schoolId: { in: schoolIds }, isCurrent: true },
          include: { academicYear: { select: { name: true } } },
          orderBy: { sequence: 'asc' },
        }),
        prisma.schoolInvoice.groupBy({
          by: ['schoolId'],
          where: {
            schoolId: { in: schoolIds },
            status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
          },
          _sum: { outstandingMinor: true },
        }),
        prisma.reportGenerationBatch.findMany({
          where: { schoolId: { in: schoolIds } },
          select: {
            schoolId: true,
            generatedCount: true,
            releaseStatus: true,
          },
        }),
      ])

      const pupilMap = new Map(pupilCounts.map((row) => [row.schoolId, row._count._all]))
      const classMap = new Map(classCounts.map((row) => [row.schoolId, row._count._all]))
      const teacherMap = new Map(
        teacherCounts.map((row) => [row.schoolId, row._count._all]),
      )
      const termMap = new Map(currentTerms.map((term) => [term.schoolId, term]))
      const outstandingMap = new Map(
        outstanding.map((row) => [row.schoolId, row._sum.outstandingMinor ?? 0]),
      )

      const reportMap = new Map<
        string,
        { prepared: number; awaitingRelease: number; released: number }
      >()

      for (const batch of batches) {
        const current = reportMap.get(batch.schoolId) ?? {
          prepared: 0,
          awaitingRelease: 0,
          released: 0,
        }

        current.prepared += batch.generatedCount

        if (batch.releaseStatus === 'APPROVED') {
          current.awaitingRelease += 1
        }

        if (batch.releaseStatus === 'RELEASED') {
          current.released += 1
        }

        reportMap.set(batch.schoolId, current)
      }

      return Promise.all(
        schools.map((school) =>
          buildSchoolSummary(
            school,
            pupilMap.get(school.id) ?? 0,
            teacherMap.get(school.id) ?? 0,
            classMap.get(school.id) ?? 0,
            termMap.get(school.id) ?? null,
            outstandingMap.get(school.id) ?? 0,
            DEFAULT_CURRENCY,
            reportMap.get(school.id) ?? {
              prepared: 0,
              awaitingRelease: 0,
              released: 0,
            },
          ),
        ),
      )
    },

    async getSchool(schoolId: string): Promise<PlatformSchoolDetail | null> {
      const prisma = getPrismaClient()
      const school = await prisma.school.findUnique({
        where: { id: schoolId },
        include: {
          memberships: {
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
            },
            orderBy: { joinedAt: 'asc' },
          },
          classes: {
            where: { isArchived: false },
            include: { _count: { select: { pupils: true } } },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          },
          academicYears: {
            include: { terms: { orderBy: { sequence: 'asc' } } },
            orderBy: { startsOn: 'desc' },
          },
        },
      })

      if (!school) {
        return null
      }

      const [pupilCount, payments, reportBatches, outstandingAgg] = await Promise.all([
        prisma.pupil.count({ where: { schoolId, status: 'ACTIVE' } }),
        prisma.payment.findMany({
          where: { schoolId },
          include: {
            invoice: {
              include: {
                academicYear: { select: { name: true } },
                academicTerm: { select: { name: true } },
              },
            },
          },
          orderBy: { submittedAt: 'desc' },
          take: 100,
        }),
        prisma.reportGenerationBatch.findMany({
          where: { schoolId },
          include: {
            academicYear: { select: { name: true } },
            academicTerm: { select: { name: true } },
            class: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
        prisma.schoolInvoice.aggregate({
          where: { schoolId, status: { in: ['ISSUED', 'PARTIALLY_PAID'] } },
          _sum: { outstandingMinor: true },
        }),
      ])

      const currentTerm =
        school.academicYears.flatMap((year) => year.terms).find((term) => term.isCurrent) ??
        null
      const currentYear = school.academicYears.find((year) => year.isCurrent) ?? null

      const administrators: PlatformSchoolMember[] = school.memberships
        .filter((membership) => membership.role === 'SCHOOL_ADMIN')
        .map((membership) => ({
          userId: membership.user.id,
          firstName: membership.user.firstName,
          lastName: membership.user.lastName,
          email: membership.user.email,
          role: membership.role,
          status: membership.status,
          joinedAt: membership.joinedAt.toISOString(),
        }))

      const teachers: PlatformSchoolMember[] = school.memberships
        .filter(
          (membership) =>
            membership.role === 'CLASS_TEACHER' || membership.role === 'SUBJECT_TEACHER',
        )
        .map((membership) => ({
          userId: membership.user.id,
          firstName: membership.user.firstName,
          lastName: membership.user.lastName,
          email: membership.user.email,
          role: membership.role,
          status: membership.status,
          joinedAt: membership.joinedAt.toISOString(),
        }))

      const reportCounts = {
        prepared: reportBatches.reduce((sum, batch) => sum + batch.generatedCount, 0),
        awaitingRelease: reportBatches.filter(
          (batch) => batch.releaseStatus === 'APPROVED',
        ).length,
        released: reportBatches.filter((batch) => batch.releaseStatus === 'RELEASED')
          .length,
      }

      const summary = await buildSchoolSummary(
        school,
        pupilCount,
        teachers.filter((teacher) => teacher.status === 'ACTIVE').length,
        school.classes.length,
        currentTerm
          ? {
              name: currentTerm.name,
              status: currentTerm.status,
              academicYear: { name: currentYear?.name ?? '' },
            }
          : null,
        outstandingAgg._sum.outstandingMinor ?? 0,
        DEFAULT_CURRENCY,
        reportCounts,
      )

      const paymentRecords: PlatformSchoolPayment[] = payments.map((payment) => ({
        id: payment.id,
        invoiceId: payment.invoiceId,
        invoiceNumber: payment.invoice.invoiceNumber,
        termName: payment.invoice.academicTerm.name,
        academicYearName: payment.invoice.academicYear.name,
        method: payment.method,
        source: payment.source,
        status: payment.status,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        paymentReference: payment.paymentReference,
        paidAt: toDateOnly(payment.paidAt),
        submittedAt: payment.submittedAt.toISOString(),
        verifiedAt: toIso(payment.verifiedAt),
        rejectionReason: payment.rejectionReason,
      }))

      const batches: PlatformSchoolReportBatch[] = reportBatches.map((batch) => ({
        id: batch.id,
        academicYearName: batch.academicYear.name,
        termName: batch.academicTerm.name,
        className: batch.class?.name ?? null,
        generationStatus: batch.status,
        releaseStatus: batch.releaseStatus,
        reportCount: batch.generatedCount,
        submittedAt: toIso(batch.submittedAt),
        releasedAt: toIso(batch.releasedAt),
      }))

      return {
        ...summary,
        profileComplete: isSchoolIdentityComplete(school),
        updatedAt: school.updatedAt.toISOString(),
        administrators,
        teachers,
        classes: school.classes.map((classroom) => ({
          id: classroom.id,
          name: classroom.name,
          level: classroom.level,
          pupilCount: classroom._count.pupils,
        })),
        academicYears: school.academicYears.map((year) => ({
          id: year.id,
          name: year.name,
          isCurrent: year.isCurrent,
          startsOn: toDateOnly(year.startsOn),
          endsOn: toDateOnly(year.endsOn),
          terms: year.terms.map((term) => ({
            id: term.id,
            name: term.name,
            sequence: term.sequence,
            status: term.status,
            startsOn: toDateOnly(term.startsOn),
            endsOn: toDateOnly(term.endsOn),
            isCurrent: term.isCurrent,
          })),
        })),
        payments: paymentRecords,
        reportBatches: batches,
      }
    },

    async getSchoolLogo(schoolId) {
      const school = await getPrismaClient().school.findUnique({
        where: { id: schoolId },
        select: { logoObjectKey: true, logoMimeType: true },
      })

      if (!school?.logoObjectKey || !school.logoMimeType) {
        return null
      }

      return {
        storageKey: school.logoObjectKey,
        mimeType: school.logoMimeType,
      }
    },

    async setSchoolActive(actorUserId, schoolId, isActive, audit) {
      const prisma = getPrismaClient()

      await prisma.$transaction(async (tx) => {
        const before = await tx.school.findUnique({
          where: { id: schoolId },
          select: { isActive: true, name: true },
        })

        if (!before) {
          throw Object.assign(new Error('School not found'), { code: 'NOT_FOUND' })
        }

        await tx.school.update({
          where: { id: schoolId },
          data: { isActive },
        })

        await tx.auditLog.create({
          data: {
            schoolId,
            actorUserId,
            action: isActive ? 'SCHOOL_ACTIVATED' : 'SCHOOL_SUSPENDED',
            entityType: 'School',
            entityId: schoolId,
            metadata: {
              schoolName: before.name,
              before: { isActive: before.isActive },
              after: { isActive },
            },
            ipAddress: audit.ipAddress ?? null,
            userAgent: audit.userAgent ?? null,
          },
        })
      })

      const detail = await this.getSchool(schoolId)

      if (!detail) {
        throw Object.assign(new Error('School not found'), { code: 'NOT_FOUND' })
      }

      return detail
    },

    async updateSchool(actorUserId, schoolId, input, audit) {
      const prisma = getPrismaClient()

      await prisma.$transaction(async (tx) => {
        const before = await tx.school.findUnique({ where: { id: schoolId } })

        if (!before) {
          throw Object.assign(new Error('School not found'), { code: 'NOT_FOUND' })
        }

        await tx.school.update({
          where: { id: schoolId },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.email !== undefined ? { email: input.email } : {}),
            ...(input.phone !== undefined ? { phone: input.phone } : {}),
            ...(input.address !== undefined ? { address: input.address } : {}),
            ...(input.landmark !== undefined ? { landmark: input.landmark } : {}),
          },
        })

        await tx.auditLog.create({
          data: {
            schoolId,
            actorUserId,
            action: 'SCHOOL_UPDATED_BY_PLATFORM',
            entityType: 'School',
            entityId: schoolId,
            metadata: {
              schoolName: before.name,
              changes: input as Prisma.InputJsonValue,
            },
            ipAddress: audit.ipAddress ?? null,
            userAgent: audit.userAgent ?? null,
          },
        })
      })

      const detail = await this.getSchool(schoolId)

      if (!detail) {
        throw Object.assign(new Error('School not found'), { code: 'NOT_FOUND' })
      }

      return detail
    },

    async listAudit(filter: PlatformAuditFilter): Promise<PlatformAuditPage> {
      const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200)
      const offset = Math.max(filter.offset ?? 0, 0)
      const source = filter.source ?? 'all'
      const take = filter.search ? 1000 : Math.min(offset + limit, 1000)

      const all = await auditQuery({
        action: filter.action,
        schoolId: filter.schoolId,
        from: filter.from ? new Date(`${filter.from}T00:00:00.000Z`) : undefined,
        to: filter.to ? new Date(`${filter.to}T23:59:59.999Z`) : undefined,
        take,
      })

      const bySource =
        source === 'all' ? all : all.filter((entry) => entry.source === source)
      const filtered = filter.search
        ? bySource.filter((entry) => matchesSearch(entry, filter.search!))
        : bySource

      return {
        entries: filtered.slice(offset, offset + limit),
        total: filtered.length,
        limit,
        offset,
      }
    },

    async monitoring(): Promise<PlatformMonitoring> {
      const prisma = getPrismaClient()
      const now = new Date()
      const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`)
      const soon = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000)

      const [
        submissions,
        batches,
        pendingPayments,
        activeTerms,
        invoices,
      ] = await Promise.all([
        prisma.resultSubmission.findMany({
          select: {
            schoolId: true,
            academicTermId: true,
            status: true,
            school: { select: { name: true } },
          },
        }),
        prisma.reportGenerationBatch.findMany({
          select: {
            schoolId: true,
            academicTermId: true,
            releaseStatus: true,
            generatedCount: true,
            school: { select: { name: true } },
          },
        }),
        prisma.payment.findMany({
          where: { status: { in: ['PENDING', 'UNDER_REVIEW'] } },
          select: {
            schoolId: true,
            amountMinor: true,
            currency: true,
            school: { select: { name: true } },
          },
        }),
        prisma.academicTerm.findMany({
          where: {
            isCurrent: true,
            status: 'OPEN',
            endsOn: { gte: today, lte: soon },
          },
          include: { school: { select: { name: true } } },
        }),
        prisma.schoolInvoice.findMany({
          where: { status: { in: ['ISSUED', 'PARTIALLY_PAID'] } },
          select: {
            schoolId: true,
            academicTermId: true,
            status: true,
            outstandingMinor: true,
          },
        }),
      ])

      const buckets = {
        notSubmitted: emptyBucket(),
        awaitingReview: emptyBucket(),
        returnedForCorrection: emptyBucket(),
        acceptedAwaitingReports: emptyBucket(),
        reportsAwaitingPayment: emptyBucket(),
        paymentsAwaitingVerification: emptyBucket(),
        reportsAwaitingRelease: emptyBucket(),
        approachingDeadlines: emptyBucket(),
        incompleteEndOfYear: emptyBucket(),
      }

      const completedBatches = new Set(
        batches
          .filter((batch) => batch.generatedCount > 0)
          .map((batch) => `${batch.schoolId}:${batch.academicTermId}`),
      )

      for (const submission of submissions) {
        const schoolName = submission.school.name

        if (submission.status === 'DRAFT') {
          addToBucket(
            buckets.notSubmitted,
            submission.schoolId,
            schoolName,
            1,
            'Draft result entry not submitted',
          )
        } else if (submission.status === 'SUBMITTED') {
          addToBucket(
            buckets.awaitingReview,
            submission.schoolId,
            schoolName,
            1,
            'Submitted result awaiting academic review',
          )
        } else if (submission.status === 'RETURNED_FOR_CORRECTION') {
          addToBucket(
            buckets.returnedForCorrection,
            submission.schoolId,
            schoolName,
            1,
            'Returned result awaiting correction',
          )
        } else if (submission.status === 'ACCEPTED') {
          const hasReports = completedBatches.has(
            `${submission.schoolId}:${submission.academicTermId}`,
          )

          if (!hasReports) {
            addToBucket(
              buckets.acceptedAwaitingReports,
              submission.schoolId,
              schoolName,
              1,
              'Accepted result without a prepared report batch',
            )
          }
        }
      }

      const invoiceMap = new Map(
        invoices.map((invoice) => [
          `${invoice.schoolId}:${invoice.academicTermId}`,
          invoice,
        ]),
      )

      for (const batch of batches) {
        if (batch.releaseStatus === 'APPROVED') {
          const invoice = invoiceMap.get(`${batch.schoolId}:${batch.academicTermId}`)

          if (!invoice || invoice.status !== 'PAID') {
            addToBucket(
              buckets.reportsAwaitingPayment,
              batch.schoolId,
              batch.school.name,
              1,
              invoice
                ? `Invoice outstanding ${invoice.outstandingMinor}`
                : 'No invoice issued for the term',
            )
          } else {
            addToBucket(
              buckets.reportsAwaitingRelease,
              batch.schoolId,
              batch.school.name,
              1,
              'Paid and approved, awaiting release',
            )
          }
        }
      }

      for (const payment of pendingPayments) {
        addToBucket(
          buckets.paymentsAwaitingVerification,
          payment.schoolId,
          payment.school.name,
          1,
          `${payment.currency} ${payment.amountMinor} awaiting verification`,
        )
      }

      for (const term of activeTerms) {
        const days = Math.max(
          0,
          Math.ceil((term.endsOn.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)),
        )

        addToBucket(
          buckets.approachingDeadlines,
          term.schoolId,
          term.school.name,
          1,
          `${term.name} closes in ${days} day${days === 1 ? '' : 's'}`,
        )
      }

      const incompleteSchools = new Set<string>()
      const incompleteNames = new Map<string, string>()

      for (const submission of submissions) {
        if (submission.status !== 'ACCEPTED') {
          incompleteSchools.add(submission.schoolId)
          incompleteNames.set(submission.schoolId, submission.school.name)
        }
      }

      for (const batch of batches) {
        if (batch.releaseStatus !== 'RELEASED') {
          incompleteSchools.add(batch.schoolId)
          incompleteNames.set(batch.schoolId, batch.school.name)
        }
      }

      for (const schoolId of incompleteSchools) {
        addToBucket(
          buckets.incompleteEndOfYear,
          schoolId,
          incompleteNames.get(schoolId) ?? 'School',
          1,
          'Assessment or report workflow incomplete',
        )
      }

      for (const bucket of Object.values(buckets)) {
        sortBucket(bucket)
      }

      return { ...buckets, generatedAt: now.toISOString() }
    },

    async getSettings(): Promise<PlatformSettings> {
      return loadSettings()
    },

    async updateSettings(actorUserId, input, audit) {
      const prisma = getPrismaClient()
      const changes: Array<{ key: string; value: Prisma.InputJsonValue }> = []

      if (input.supportEmail !== undefined) {
        changes.push({
          key: SETTING_SUPPORT_EMAIL,
          value: input.supportEmail ?? '',
        })
      }

      if (input.registrationEnabled !== undefined) {
        changes.push({
          key: SETTING_REGISTRATION_ENABLED,
          value: input.registrationEnabled,
        })
      }

      if (changes.length === 0) {
        return loadSettings()
      }

      await prisma.$transaction(async (tx) => {
        for (const change of changes) {
          const before = await tx.platformSetting.findUnique({
            where: { key: change.key },
          })

          await tx.platformSetting.upsert({
            where: { key: change.key },
            create: {
              key: change.key,
              value: change.value,
              updatedByUserId: actorUserId,
            },
            update: {
              value: change.value,
              updatedByUserId: actorUserId,
            },
          })

          await tx.auditLog.create({
            data: {
              actorUserId,
              action: 'PLATFORM_SETTING_UPDATED',
              entityType: 'PlatformSetting',
              entityId: change.key,
              metadata: {
                key: change.key,
                before: before?.value ?? null,
                after: change.value,
              },
              ipAddress: audit.ipAddress ?? null,
              userAgent: audit.userAgent ?? null,
            },
          })
        }
      })

      return loadSettings()
    },

    async getAccount(userId): Promise<PlatformAccount | null> {
      const user = await getPrismaClient().user.findUnique({
        where: { id: userId },
      })

      if (!user) {
        return null
      }

      return {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isPlatformAdmin: user.isPlatformAdmin,
        isActive: user.isActive,
        lastLoginAt: toIso(user.lastLoginAt),
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      }
    },

    async updateAccountProfile(userId, input, audit) {
      const prisma = getPrismaClient()

      const user = await prisma.user.update({
        where: { id: userId },
        data: { firstName: input.firstName, lastName: input.lastName },
      })

      await prisma.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'PLATFORM_ACCOUNT_PROFILE_UPDATED',
          entityType: 'User',
          entityId: userId,
          metadata: { firstName: user.firstName, lastName: user.lastName },
          ipAddress: audit.ipAddress ?? null,
          userAgent: audit.userAgent ?? null,
        },
      })

      return {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isPlatformAdmin: user.isPlatformAdmin,
        isActive: user.isActive,
        lastLoginAt: toIso(user.lastLoginAt),
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      }
    },

    async updateAccountEmail(userId, email, audit) {
      const prisma = getPrismaClient()

      const result = await prisma.$transaction(async (tx) => {
        const before = await tx.user.findUnique({ where: { id: userId } })

        if (!before) {
          throw Object.assign(new Error('Account not found'), { code: 'NOT_FOUND' })
        }

        const user = await tx.user.update({
          where: { id: userId },
          data: { email: email.toLowerCase() },
        })

        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            action: 'PLATFORM_ACCOUNT_EMAIL_CHANGED',
            entityType: 'User',
            entityId: userId,
            metadata: { previousEmail: before.email, email: user.email },
            ipAddress: audit.ipAddress ?? null,
            userAgent: audit.userAgent ?? null,
          },
        })

        return user
      })

      return {
        id: result.id,
        email: result.email,
        firstName: result.firstName,
        lastName: result.lastName,
        isPlatformAdmin: result.isPlatformAdmin,
        isActive: result.isActive,
        lastLoginAt: toIso(result.lastLoginAt),
        createdAt: result.createdAt.toISOString(),
        updatedAt: result.updatedAt.toISOString(),
      }
    },

    async updateAccountPassword(userId, passwordHash, audit) {
      const prisma = getPrismaClient()

      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: { passwordHash },
        })

        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            action: 'PLATFORM_ACCOUNT_PASSWORD_CHANGED',
            entityType: 'User',
            entityId: userId,
            ipAddress: audit.ipAddress ?? null,
            userAgent: audit.userAgent ?? null,
          },
        })
      })
    },

    async listAccountSessions(userId, currentSessionId) {
      const sessions = await getPrismaClient().session.findMany({
        where: {
          userId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { lastUsedAt: 'desc' },
      })

      return sessions.map<PlatformAccountSession>((session) => ({
        id: session.id,
        current: session.id === currentSessionId,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        createdAt: session.createdAt.toISOString(),
        lastUsedAt: session.lastUsedAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
      }))
    },

    async revokeOtherAccountSessions(userId, currentSessionId, audit) {
      const prisma = getPrismaClient()

      const result = await prisma.session.updateMany({
        where: {
          userId,
          id: { not: currentSessionId },
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      })

      await prisma.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'PLATFORM_ACCOUNT_OTHER_SESSIONS_REVOKED',
          entityType: 'User',
          entityId: userId,
          metadata: { revokedCount: result.count },
          ipAddress: audit.ipAddress ?? null,
          userAgent: audit.userAgent ?? null,
        },
      })

      return result.count
    },

    async isRegistrationEnabled(): Promise<boolean> {
      const row = await getPrismaClient().platformSetting.findUnique({
        where: { key: SETTING_REGISTRATION_ENABLED },
      })

      return typeof row?.value === 'boolean' ? row.value : true
    },

    async recordAudit(entry) {
      await getPrismaClient().auditLog.create({
        data: {
          schoolId: entry.schoolId ?? null,
          actorUserId: entry.actorUserId ?? null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          metadata: entry.metadata as Prisma.InputJsonValue | undefined,
          ipAddress: entry.ipAddress ?? null,
          userAgent: entry.userAgent ?? null,
        },
      })
    },
  }
}
