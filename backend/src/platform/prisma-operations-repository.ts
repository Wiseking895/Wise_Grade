import { getPrismaClient } from '../lib/prisma.js'
import { Prisma } from '../generated/prisma/client.js'
import { isUniqueConstraintError } from '../auth/prisma-repository.js'
import type {
  AuditEntry,
  CreateReauthGrantInput,
  PlatformOperationsRepository,
  SchedulerRunInput,
} from './operations-repository.js'
import type {
  AcknowledgePaymentInput,
  ExportDatasetId,
  ExportDatasetResult,
  PlatformNotificationFilter,
  PlatformNotificationInput,
  PlatformNotificationPage,
  PlatformNotificationRecord,
  PlatformNotificationSeverity,
  PlatformSecurityEvent,
  PlatformSessionRecord,
  ReconciliationIssue,
  ReconciliationIssueCode,
  ReconciliationPage,
  ReconciliationSeverity,
  ReconciliationSummary,
  SchedulerRunRecord,
  UserSecurityRecord,
} from './operations-types.js'

const DEFAULT_CURRENCY = 'GHS'
const RECONCILIATION_WINDOW_DAYS = 7
const REPEATED_SUBMISSION_WINDOW_MS = 10 * 60 * 1000
const SECURITY_ACTIONS = [
  'LOGIN_FAILED',
  'LOGIN_SUCCEEDED',
  'LOGIN_LOCKED',
  'LOGIN_MFA_FAILED',
  'PLATFORM_MFA_ENABLED',
  'PLATFORM_MFA_DISABLED',
  'PLATFORM_MFA_RECOVERY_REGENERATED',
  'PLATFORM_REAUTH_GRANTED',
  'PLATFORM_SESSION_REVOKED',
  'PLATFORM_EXPORT_DOWNLOADED',
  'PLATFORM_PAYMENT_RECONCILED',
  'PLATFORM_ACCOUNT_OTHER_SESSIONS_REVOKED',
]

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function severityOf(value: string): PlatformNotificationSeverity {
  return value === 'SUCCESS' ||
    value === 'WARNING' ||
    value === 'CRITICAL'
    ? value
    : 'INFO'
}

interface NotificationRow {
  id: string
  type: string
  severity: string
  title: string
  body: string | null
  schoolId: string | null
  entityType: string | null
  entityId: string | null
  link: string | null
  readAt: Date | null
  metadata: unknown
  createdAt: Date
  school?: { name: string } | null
}

function mapNotification(row: NotificationRow): PlatformNotificationRecord {
  return {
    id: row.id,
    type: row.type,
    severity: severityOf(row.severity),
    title: row.title,
    body: row.body,
    schoolId: row.schoolId,
    schoolName: row.school?.name ?? null,
    entityType: row.entityType,
    entityId: row.entityId,
    link: row.link,
    read: row.readAt !== null,
    readAt: toIso(row.readAt),
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
  }
}

function mapSchedulerRun(row: {
  id: string
  trigger: string
  status: string
  startedAt: Date
  completedAt: Date | null
  durationMs: number | null
  schoolCount: number
  failureCount: number
  message: string | null
}): SchedulerRunRecord {
  return {
    id: row.id,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    completedAt: toIso(row.completedAt),
    durationMs: row.durationMs,
    schoolCount: row.schoolCount,
    failureCount: row.failureCount,
    message: row.message,
  }
}

export interface ReconciliationPaymentRow {
  id: string
  schoolId: string
  invoiceId: string
  source: string
  method: string
  status: string
  amountMinor: number
  appliedMinor: number
  overpaymentMinor: number
  currency: string
  paymentReference: string
  providerReference: string | null
  submittedAt: Date
  verifiedAt: Date | null
  reconciledAt: Date | null
  school: { name: string }
  invoice: {
    id: string
    invoiceNumber: string
    schoolId: string
    academicTermId: string
    totalMinor: number
    currency: string
    status: string
    academicTerm: { startsOn: Date; endsOn: Date; name: string }
  }
}

function buildIssue(
  row: ReconciliationPaymentRow,
  code: ReconciliationIssueCode,
  severity: ReconciliationSeverity,
  detail: string,
): ReconciliationIssue {
  return {
    code,
    severity,
    paymentId: row.id,
    schoolId: row.schoolId,
    schoolName: row.school.name,
    invoiceId: row.invoiceId,
    invoiceNumber: row.invoice.invoiceNumber,
    invoiceSchoolId: row.invoice.schoolId,
    invoiceTermId: row.invoice.academicTermId,
    paymentReference: row.paymentReference,
    providerReference: row.providerReference,
    source: row.source,
    method: row.method,
    status: row.status,
    amountMinor: row.amountMinor,
    appliedMinor: row.appliedMinor,
    overpaymentMinor: row.overpaymentMinor,
    invoiceTotalMinor: row.invoice.totalMinor,
    currency: row.currency,
    submittedAt: row.submittedAt.toISOString(),
    verifiedAt: toIso(row.verifiedAt),
    reconciledAt: toIso(row.reconciledAt),
    detail,
  }
}

function summarise(
  rows: ReconciliationPaymentRow[],
  issues: ReconciliationIssue[],
): ReconciliationSummary {
  const issueCounts: Partial<Record<ReconciliationIssueCode, number>> = {}

  for (const issue of issues) {
    issueCounts[issue.code] = (issueCounts[issue.code] ?? 0) + 1
  }

  return {
    totalPayments: rows.length,
    verifiedPayments: rows.filter((row) => row.status === 'VERIFIED').length,
    unreconciledVerified: rows.filter(
      (row) => row.status === 'VERIFIED' && row.reconciledAt === null,
    ).length,
    totalIssues: issues.length,
    criticalIssues: issues.filter((issue) => issue.severity === 'CRITICAL')
      .length,
    warningIssues: issues.filter((issue) => issue.severity === 'WARNING').length,
    infoIssues: issues.filter((issue) => issue.severity === 'INFO').length,
    issueCounts,
  }
}

export function detectIssues(
  rows: ReconciliationPaymentRow[],
  now: Date,
): ReconciliationIssue[] {
  const issues: ReconciliationIssue[] = []

  const referenceSchools = new Map<string, Set<string>>()
  const submissionGroups = new Map<string, ReconciliationPaymentRow[]>()

  for (const row of rows) {
    const normalizedReference = row.paymentReference.trim().toUpperCase()

    if (normalizedReference) {
      const schools =
        referenceSchools.get(normalizedReference) ?? new Set<string>()
      schools.add(row.schoolId)
      referenceSchools.set(normalizedReference, schools)
    }

    const groupKey = `${row.schoolId}|${row.invoiceId}|${row.amountMinor}`
    const group = submissionGroups.get(groupKey) ?? []
    group.push(row)
    submissionGroups.set(groupKey, group)
  }

  for (const row of rows) {
    const normalizedReference = row.paymentReference.trim().toUpperCase()

    if ((referenceSchools.get(normalizedReference)?.size ?? 0) > 1) {
      issues.push(
        buildIssue(
          row,
          'MISMATCHED_REFERENCE',
          'WARNING',
          'This payment reference is also used by a payment in another school.',
        ),
      )
    }

    if (row.schoolId !== row.invoice.schoolId) {
      issues.push(
        buildIssue(
          row,
          'WRONG_SCHOOL',
          'CRITICAL',
          'The payment school does not match the school on the invoice.',
        ),
      )
    }

    const paidAt = row.submittedAt
    if (
      paidAt < row.invoice.academicTerm.startsOn ||
      paidAt > row.invoice.academicTerm.endsOn
    ) {
      issues.push(
        buildIssue(
          row,
          'WRONG_TERM',
          'WARNING',
          `Payment was submitted outside ${row.invoice.academicTerm.name}.`,
        ),
      )
    }

    if (row.status === 'REJECTED' || row.status === 'FAILED') {
      issues.push(
        buildIssue(
          row,
          'FAILED_VERIFICATION',
          'WARNING',
          `Payment is in ${row.status} state and cannot settle the invoice.`,
        ),
      )
    }

    if (row.status === 'VERIFIED') {
      if (row.appliedMinor + row.overpaymentMinor !== row.amountMinor) {
        issues.push(
          buildIssue(
            row,
            'INCONSISTENT_AMOUNT',
            'CRITICAL',
            'Applied and overpayment amounts do not add up to the payment amount.',
          ),
        )
      }

      if (row.overpaymentMinor > 0) {
        issues.push(
          buildIssue(
            row,
            'OVERPAYMENT',
            'WARNING',
            'This payment exceeds the invoice balance and includes an overpayment.',
          ),
        )
      }

      if (
        row.reconciledAt === null &&
        now.getTime() - row.submittedAt.getTime() >
          RECONCILIATION_WINDOW_DAYS * 24 * 60 * 60 * 1000
      ) {
        issues.push(
          buildIssue(
            row,
            'UNRECONCILED_PAYMENT',
            'INFO',
            `Verified payment has not been acknowledged for more than ${RECONCILIATION_WINDOW_DAYS} days.`,
          ),
        )
      }
    }

    if (row.currency !== row.invoice.currency) {
      issues.push(
        buildIssue(
          row,
          'INCONSISTENT_AMOUNT',
          'CRITICAL',
          'Payment currency does not match the invoice currency.',
        ),
      )
    }

    if (row.amountMinor <= 0) {
      issues.push(
        buildIssue(
          row,
          'INCONSISTENT_AMOUNT',
          'CRITICAL',
          'Payment amount must be greater than zero.',
        ),
      )
    }
  }

  // Duplicate provider references (the schema makes these impossible to insert
  // twice, but a legacy import or a provider bug could still surface them).
  const providerReferences = new Map<string, number>()
  for (const row of rows) {
    if (row.providerReference) {
      providerReferences.set(
        row.providerReference,
        (providerReferences.get(row.providerReference) ?? 0) + 1,
      )
    }
  }

  for (const row of rows) {
    if (
      row.providerReference &&
      (providerReferences.get(row.providerReference) ?? 0) > 1
    ) {
      issues.push(
        buildIssue(
          row,
          'DUPLICATE_PROVIDER_REFERENCE',
          'CRITICAL',
          'The provider reference is attached to more than one payment.',
        ),
      )
    }
  }

  // Repeated submissions: same school, invoice and amount submitted more than
  // once in a short window with different references.
  for (const group of submissionGroups.values()) {
    if (group.length < 2) {
      continue
    }

    const sorted = [...group].sort(
      (left, right) => left.submittedAt.getTime() - right.submittedAt.getTime(),
    )

    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1]!
      const current = sorted[index]!

      if (
        current.submittedAt.getTime() - previous.submittedAt.getTime() <=
        REPEATED_SUBMISSION_WINDOW_MS
      ) {
        issues.push(
          buildIssue(
            current,
            'REPEATED_SUBMISSION',
            'WARNING',
            'A payment with the same invoice and amount was submitted moments earlier.',
          ),
        )
      }
    }
  }

  return issues
}

async function loadReconciliationRows(): Promise<ReconciliationPaymentRow[]> {
  const prisma = getPrismaClient()

  return prisma.payment.findMany({
    orderBy: { submittedAt: 'desc' },
    take: 5000,
    select: {
      id: true,
      schoolId: true,
      invoiceId: true,
      source: true,
      method: true,
      status: true,
      amountMinor: true,
      appliedMinor: true,
      overpaymentMinor: true,
      currency: true,
      paymentReference: true,
      providerReference: true,
      submittedAt: true,
      verifiedAt: true,
      reconciledAt: true,
      school: { select: { name: true } },
      invoice: {
        select: {
          id: true,
          invoiceNumber: true,
          schoolId: true,
          academicTermId: true,
          totalMinor: true,
          currency: true,
          status: true,
          academicTerm: {
            select: { startsOn: true, endsOn: true, name: true },
          },
        },
      },
    },
  })
}

export function createPrismaOperationsRepository(): PlatformOperationsRepository {
  return {
    async createNotification(input: PlatformNotificationInput) {
      const prisma = getPrismaClient()

      try {
        const row = await prisma.platformNotification.create({
          data: {
            type: input.type,
            severity: input.severity ?? 'INFO',
            title: input.title,
            body: input.body ?? null,
            schoolId: input.schoolId ?? null,
            entityType: input.entityType ?? null,
            entityId: input.entityId ?? null,
            link: input.link ?? null,
            dedupeKey: input.dedupeKey ?? null,
            metadata: input.metadata as Prisma.InputJsonValue | undefined,
          },
          include: { school: { select: { name: true } } },
        })

        return mapNotification(row)
      } catch (error) {
        // A retried job must be idempotent, not a failure.
        if (isUniqueConstraintError(error)) {
          return null
        }

        throw error
      }
    },

    async listNotifications(
      filter: PlatformNotificationFilter,
    ): Promise<PlatformNotificationPage> {
      const prisma = getPrismaClient()
      const limit = Math.min(Math.max(filter.limit ?? 25, 1), 100)
      const offset = Math.max(filter.offset ?? 0, 0)
      const where: Prisma.PlatformNotificationWhereInput = {}

      if (filter.unreadOnly) {
        where.readAt = null
      }

      if (filter.severity) {
        where.severity = filter.severity
      }

      if (filter.type) {
        where.type = filter.type
      }

      if (filter.schoolId) {
        where.schoolId = filter.schoolId
      }

      if (filter.search) {
        where.OR = [
          { title: { contains: filter.search, mode: 'insensitive' } },
          { body: { contains: filter.search, mode: 'insensitive' } },
        ]
      }

      const [rows, total, unreadCount] = await Promise.all([
        prisma.platformNotification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: offset,
          take: limit,
          include: { school: { select: { name: true } } },
        }),
        prisma.platformNotification.count({ where }),
        prisma.platformNotification.count({ where: { readAt: null } }),
      ])

      return {
        notifications: rows.map(mapNotification),
        total,
        unreadCount,
        limit,
        offset,
      }
    },

    async markNotificationRead(notificationId: string, userId: string) {
      const prisma = getPrismaClient()
      const existing = await prisma.platformNotification.findUnique({
        where: { id: notificationId },
      })

      if (!existing) {
        return null
      }

      const row =
        existing.readAt === null
          ? await prisma.platformNotification.update({
              where: { id: notificationId },
              data: { readAt: new Date(), readByUserId: userId },
              include: { school: { select: { name: true } } },
            })
          : await prisma.platformNotification.findUniqueOrThrow({
              where: { id: notificationId },
              include: { school: { select: { name: true } } },
            })

      return mapNotification(row)
    },

    async markAllNotificationsRead(userId: string) {
      const result = await getPrismaClient().platformNotification.updateMany({
        where: { readAt: null },
        data: { readAt: new Date(), readByUserId: userId },
      })

      return result.count
    },

    async unreadNotificationCount() {
      return getPrismaClient().platformNotification.count({
        where: { readAt: null },
      })
    },

    async recordSchedulerRun(input: SchedulerRunInput) {
      await getPrismaClient().schedulerRun.create({
        data: {
          trigger: input.trigger ?? 'SCHEDULER',
          status: input.status,
          startedAt: input.startedAt,
          completedAt: input.completedAt ?? null,
          durationMs: input.durationMs ?? null,
          schoolCount: input.schoolCount ?? 0,
          failureCount: input.failureCount ?? 0,
          message: input.message ?? null,
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
        },
      })
    },

    async listSchedulerRuns(limit: number) {
      const rows = await getPrismaClient().schedulerRun.findMany({
        orderBy: { createdAt: 'desc' },
        take: Math.min(Math.max(limit, 1), 50),
      })

      return rows.map(mapSchedulerRun)
    },

    async lastSuccessfulSchedulerRun() {
      const row = await getPrismaClient().schedulerRun.findFirst({
        where: { status: 'COMPLETED' },
        orderBy: { createdAt: 'desc' },
      })

      return row ? mapSchedulerRun(row) : null
    },

    async reconciliation(): Promise<ReconciliationPage> {
      const rows = await loadReconciliationRows()
      const issues = detectIssues(rows, new Date())

      return {
        issues,
        summary: summarise(rows, issues),
        generatedAt: new Date().toISOString(),
      }
    },

    async acknowledgePayment(
      paymentId: string,
      input: AcknowledgePaymentInput,
      actorUserId: string,
      audit,
    ) {
      const prisma = getPrismaClient()
      const row = await prisma.payment.findUnique({
        where: { id: paymentId },
        select: {
          id: true,
          schoolId: true,
          invoiceId: true,
          source: true,
          method: true,
          status: true,
          amountMinor: true,
          appliedMinor: true,
          overpaymentMinor: true,
          currency: true,
          paymentReference: true,
          providerReference: true,
          submittedAt: true,
          verifiedAt: true,
          reconciledAt: true,
          school: { select: { name: true } },
          invoice: {
            select: {
              id: true,
              invoiceNumber: true,
              schoolId: true,
              academicTermId: true,
              totalMinor: true,
              currency: true,
              status: true,
              academicTerm: {
                select: { startsOn: true, endsOn: true, name: true },
              },
            },
          },
        },
      })

      if (!row) {
        throw Object.assign(new Error('Payment not found'), {
          code: 'NOT_FOUND',
        })
      }

      const updated = await prisma.payment.update({
        where: { id: paymentId },
        data: {
          reconciledAt: new Date(),
          reconciledByUserId: actorUserId,
          reconciliationNote: input.note ?? null,
        },
        select: { reconciledAt: true },
      })

      await prisma.auditLog.create({
        data: {
          schoolId: row.schoolId,
          actorUserId,
          action: 'PLATFORM_PAYMENT_RECONCILED',
          entityType: 'Payment',
          entityId: paymentId,
          metadata: {
            note: input.note ?? null,
            status: row.status,
            paymentReference: row.paymentReference,
          } as Prisma.InputJsonValue,
          ipAddress: audit.ipAddress ?? null,
          userAgent: audit.userAgent ?? null,
        },
      })

      return buildIssue(
        { ...row, reconciledAt: updated.reconciledAt },
        'UNRECONCILED_PAYMENT',
        'INFO',
        'Payment has been acknowledged by a platform administrator.',
      )
    },

    async findUserSecurity(userId: string): Promise<UserSecurityRecord | null> {
      const user = await getPrismaClient().user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          mfaEnabled: true,
          mfaEnabledAt: true,
          mfaPendingSecret: true,
          mfaRecoveryCodes: true,
          lockedUntil: true,
          failedLoginCount: true,
          lastFailedLoginAt: true,
          lastLoginAt: true,
        },
      })

      if (!user) {
        return null
      }

      return {
        userId: user.id,
        email: user.email,
        mfaEnabled: user.mfaEnabled,
        mfaEnabledAt: toIso(user.mfaEnabledAt),
        pendingMfa: Boolean(user.mfaPendingSecret),
        recoveryCodeCount: Array.isArray(user.mfaRecoveryCodes)
          ? user.mfaRecoveryCodes.length
          : 0,
        lockedUntil: toIso(user.lockedUntil),
        failedLoginCount: user.failedLoginCount,
        lastFailedLoginAt: toIso(user.lastFailedLoginAt),
        lastLoginAt: toIso(user.lastLoginAt),
      }
    },

    async getMfaSecrets(userId: string) {
      const user = await getPrismaClient().user.findUnique({
        where: { id: userId },
        select: {
          mfaEnabled: true,
          mfaSecret: true,
          mfaPendingSecret: true,
          mfaRecoveryCodes: true,
        },
      })

      if (!user) {
        return null
      }

      return {
        enabled: user.mfaEnabled,
        secret: user.mfaSecret,
        pendingSecret: user.mfaPendingSecret,
        recoveryCodeHashes: Array.isArray(user.mfaRecoveryCodes)
          ? (user.mfaRecoveryCodes as string[])
          : [],
      }
    },

    async setMfaPendingSecret(userId: string, encryptedSecret: string | null) {
      await getPrismaClient().user.update({
        where: { id: userId },
        data: { mfaPendingSecret: encryptedSecret },
      })
    },

    async enableMfa(
      userId: string,
      encryptedSecret: string,
      recoveryCodeHashes: string[],
      enabledAt: Date,
    ) {
      await getPrismaClient().user.update({
        where: { id: userId },
        data: {
          mfaEnabled: true,
          mfaSecret: encryptedSecret,
          mfaPendingSecret: null,
          mfaRecoveryCodes: recoveryCodeHashes as Prisma.InputJsonValue,
          mfaEnabledAt: enabledAt,
        },
      })
    },

    async disableMfa(userId: string) {
      await getPrismaClient().user.update({
        where: { id: userId },
        data: {
          mfaEnabled: false,
          mfaSecret: null,
          mfaPendingSecret: null,
          mfaRecoveryCodes: Prisma.DbNull,
          mfaEnabledAt: null,
        },
      })
    },

    async updateRecoveryCodes(userId: string, hashes: string[]) {
      await getPrismaClient().user.update({
        where: { id: userId },
        data: { mfaRecoveryCodes: hashes as Prisma.InputJsonValue },
      })
    },

    async consumeRecoveryCode(userId: string, codeHash: string) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { mfaRecoveryCodes: true },
        })

        const codes = Array.isArray(user?.mfaRecoveryCodes)
          ? (user.mfaRecoveryCodes as string[])
          : []
        const index = codes.indexOf(codeHash)

        if (index === -1) {
          return false
        }

        const remaining = [...codes.slice(0, index), ...codes.slice(index + 1)]
        await tx.user.update({
          where: { id: userId },
          data: { mfaRecoveryCodes: remaining as Prisma.InputJsonValue },
        })

        return true
      })
    },

    async createReauthGrant(input: CreateReauthGrantInput) {
      await getPrismaClient().platformReauthGrant.create({
        data: {
          userId: input.userId,
          tokenHash: input.tokenHash,
          purpose: input.purpose,
          expiresAt: input.expiresAt,
        },
      })
    },

    async consumeReauthGrant(input) {
      const result = await getPrismaClient().platformReauthGrant.updateMany({
        where: {
          userId: input.userId,
          tokenHash: input.tokenHash,
          purpose: input.purpose,
          usedAt: null,
          expiresAt: { gt: input.now },
        },
        data: { usedAt: input.now },
      })

      return result.count === 1
    },

    async listSessions(userId: string): Promise<PlatformSessionRecord[]> {
      const sessions = await getPrismaClient().session.findMany({
        where: {
          userId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { lastUsedAt: 'desc' },
      })

      return sessions.map((session) => ({
        id: session.id,
        current: false,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        createdAt: session.createdAt.toISOString(),
        lastUsedAt: session.lastUsedAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
      }))
    },

    async revokeSession(userId: string, sessionId: string) {
      const result = await getPrismaClient().session.updateMany({
        where: { id: sessionId, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      })

      return result.count === 1
    },

    async listSecurityEvents(
      userId: string,
      limit: number,
    ): Promise<PlatformSecurityEvent[]> {
      const rows = await getPrismaClient().auditLog.findMany({
        where: {
          actorUserId: userId,
          action: { in: SECURITY_ACTIONS },
        },
        orderBy: { createdAt: 'desc' },
        take: Math.min(Math.max(limit, 1), 100),
      })

      return rows.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        metadata: row.metadata,
        ipAddress: row.ipAddress,
        createdAt: row.createdAt.toISOString(),
      }))
    },

    async countFailedLoginsSince(userId: string, since: Date) {
      return getPrismaClient().auditLog.count({
        where: {
          actorUserId: userId,
          action: 'LOGIN_FAILED',
          createdAt: { gte: since },
        },
      })
    },

    async countLockedAccounts(now: Date) {
      return getPrismaClient().user.count({
        where: { lockedUntil: { gt: now } },
      })
    },

    async exportDataset(
      dataset: ExportDatasetId,
      options?: { limit?: number },
    ): Promise<ExportDatasetResult> {
      const prisma = getPrismaClient()
      const take = Math.min(Math.max(options?.limit ?? 5000, 1), 10000)

      if (dataset === 'schools') {
        const rows = await prisma.school.findMany({
          orderBy: { name: 'asc' },
          take,
          select: {
            id: true,
            name: true,
            slug: true,
            email: true,
            phone: true,
            timezone: true,
            isActive: true,
            createdAt: true,
            _count: { select: { pupils: true, memberships: true } },
          },
        })

        return {
          rows: rows.map((row) => ({
            id: row.id,
            name: row.name,
            slug: row.slug,
            email: row.email,
            phone: row.phone,
            timezone: row.timezone,
            status: row.isActive ? 'ACTIVE' : 'SUSPENDED',
            pupils: row._count.pupils,
            members: row._count.memberships,
            createdAt: row.createdAt.toISOString(),
          })),
          truncated: rows.length === take,
        }
      }

      if (dataset === 'payments') {
        const rows = await prisma.payment.findMany({
          orderBy: { submittedAt: 'desc' },
          take,
          select: {
            id: true,
            status: true,
            source: true,
            method: true,
            amountMinor: true,
            appliedMinor: true,
            overpaymentMinor: true,
            currency: true,
            paymentReference: true,
            providerReference: true,
            submittedAt: true,
            verifiedAt: true,
            reconciledAt: true,
            school: { select: { name: true } },
            invoice: { select: { invoiceNumber: true } },
          },
        })

        return {
          rows: rows.map((row) => ({
            id: row.id,
            school: row.school.name,
            invoiceNumber: row.invoice.invoiceNumber,
            status: row.status,
            source: row.source,
            method: row.method,
            amountMinor: row.amountMinor,
            appliedMinor: row.appliedMinor,
            overpaymentMinor: row.overpaymentMinor,
            currency: row.currency,
            paymentReference: row.paymentReference,
            providerReference: row.providerReference,
            submittedAt: row.submittedAt.toISOString(),
            verifiedAt: toIso(row.verifiedAt),
            reconciledAt: toIso(row.reconciledAt),
          })),
          truncated: rows.length === take,
        }
      }

      if (dataset === 'invoices') {
        const rows = await prisma.schoolInvoice.findMany({
          orderBy: { createdAt: 'desc' },
          take,
          select: {
            invoiceNumber: true,
            status: true,
            currency: true,
            unitAmountMinor: true,
            billablePupilCount: true,
            totalMinor: true,
            paidMinor: true,
            outstandingMinor: true,
            issueDate: true,
            dueDate: true,
            createdAt: true,
            school: { select: { name: true } },
            academicYear: { select: { name: true } },
            academicTerm: { select: { name: true } },
          },
        })

        return {
          rows: rows.map((row) => ({
            invoiceNumber: row.invoiceNumber,
            school: row.school.name,
            academicYear: row.academicYear.name,
            academicTerm: row.academicTerm.name,
            status: row.status,
            currency: row.currency,
            unitAmountMinor: row.unitAmountMinor,
            billablePupils: row.billablePupilCount,
            totalMinor: row.totalMinor,
            paidMinor: row.paidMinor,
            outstandingMinor: row.outstandingMinor,
            issueDate: row.issueDate.toISOString().slice(0, 10),
            dueDate: toIso(row.dueDate)?.slice(0, 10) ?? null,
            createdAt: row.createdAt.toISOString(),
          })),
          truncated: rows.length === take,
        }
      }

      if (dataset === 'audit') {
        const rows = await prisma.auditLog.findMany({
          orderBy: { createdAt: 'desc' },
          take,
          select: {
            action: true,
            entityType: true,
            entityId: true,
            metadata: true,
            createdAt: true,
            actor: { select: { email: true } },
            school: { select: { name: true } },
          },
        })

        return {
          rows: rows.map((row) => ({
            createdAt: row.createdAt.toISOString(),
            action: row.action,
            entityType: row.entityType,
            entityId: row.entityId,
            actorEmail: row.actor?.email ?? null,
            school: row.school?.name ?? null,
            metadata: row.metadata ? JSON.stringify(row.metadata) : null,
          })),
          truncated: rows.length === take,
        }
      }

      const rows = await prisma.platformNotification.findMany({
        orderBy: { createdAt: 'desc' },
        take,
        select: {
          type: true,
          severity: true,
          title: true,
          body: true,
          readAt: true,
          createdAt: true,
          school: { select: { name: true } },
        },
      })

      return {
        rows: rows.map((row) => ({
          createdAt: row.createdAt.toISOString(),
          type: row.type,
          severity: row.severity,
          title: row.title,
          body: row.body,
          school: row.school?.name ?? null,
          read: row.readAt !== null,
        })),
        truncated: rows.length === take,
      }
    },

    async recordAudit(entry: AuditEntry) {
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

export { DEFAULT_CURRENCY }
