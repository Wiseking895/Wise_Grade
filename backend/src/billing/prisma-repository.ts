import { HttpError } from '../errors/http-error.js'
import { getPrismaClient } from '../lib/prisma.js'
import type { Prisma } from '../generated/prisma/client.js'
import {
  addUtcDays,
  applyPaymentToInvoice,
  assertInvoiceTransition,
  buildInvoiceSnapshot,
  dateOnly,
  invoiceNumberFor,
  parseDateOnly,
  todayUtc,
} from './domain.js'
import type {
  BillingAuditContext,
  BillingAuditRecord,
  BillingRepository,
  BillingSchoolScope,
  CreateInvoiceInput,
  CreatePricingRuleInput,
  InvoiceDetail,
  InvoiceRecord,
  ManualPaymentInput,
  OnlinePaymentInput,
  PaymentDetail,
  PaymentRecord,
  PaymentVerificationResult,
  PlatformBillingActor,
  PricingRuleRecord,
  ProviderEventInput,
  ProviderEventRecord,
  SchoolBillingActor,
  VerifyManualPaymentInput,
} from './repository.js'

type Tx = Prisma.TransactionClient

type DecimalLike = { toString(): string }

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function isUniqueError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  )
}

/**
 * Serialize reconciliation for one payment. Verification and failure handling
 * lock the payment row first so only one decision can win.
 */
async function lockPaymentRow(tx: Tx, paymentId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = CAST(${paymentId} AS uuid) FOR UPDATE`
}

/**
 * Serialize every balance-changing operation for one invoice. Payment
 * verification locks the invoice after its payment row, then re-reads the
 * committed balance before applying money. This prevents lost updates and
 * double application when two payments settle at the same time.
 */
async function lockInvoiceRow(tx: Tx, invoiceId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "SchoolInvoice" WHERE "id" = CAST(${invoiceId} AS uuid) FOR UPDATE`
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

function decimalString(value: DecimalLike | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toString()
}

void decimalString

const invoiceInclude = {
  school: { select: { name: true } },
  academicYear: { select: { name: true } },
  academicTerm: { select: { name: true, sequence: true } },
} satisfies Prisma.SchoolInvoiceInclude

type InvoiceRow = Prisma.SchoolInvoiceGetPayload<{
  include: typeof invoiceInclude
}>

const paymentDetailInclude = {
  school: { select: { name: true } },
  invoice: { select: { invoiceNumber: true } },
  evidence: { orderBy: { createdAt: 'asc' } },
  verifications: {
    orderBy: { createdAt: 'asc' },
    include: {
      verifiedBy: { select: { firstName: true, lastName: true } },
    },
  },
} satisfies Prisma.PaymentInclude

type PaymentDetailRow = Prisma.PaymentGetPayload<{
  include: typeof paymentDetailInclude
}>

function mapPricingRule(row: {
  id: string
  currency: string
  amountMinor: number
  effectiveFrom: Date
  effectiveTo: Date | null
  isActive: boolean
  version: number
  createdByUserId: string
  createdAt: Date
  updatedAt: Date
}): PricingRuleRecord {
  return {
    id: row.id,
    currency: row.currency,
    amountMinor: row.amountMinor,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    isActive: row.isActive,
    version: row.version,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function mapInvoice(row: InvoiceRow): InvoiceRecord {
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    schoolId: row.schoolId,
    schoolName: row.school.name,
    academicYearId: row.academicYearId,
    academicYearName: row.academicYear.name,
    academicTermId: row.academicTermId,
    academicTermName: row.academicTerm.name,
    academicTermSequence: row.academicTerm.sequence,
    pricingRuleId: row.pricingRuleId,
    currency: row.currency,
    unitAmountMinor: row.unitAmountMinor,
    billablePupilCount: row.billablePupilCount,
    subtotalMinor: row.subtotalMinor,
    adjustmentMinor: row.adjustmentMinor,
    totalMinor: row.totalMinor,
    paidMinor: row.paidMinor,
    outstandingMinor: row.outstandingMinor,
    status: row.status,
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    issuedAt: row.issuedAt,
    cancelledAt: row.cancelledAt,
    snapshot: row.snapshot,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function mapPayment(row: {
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
  provider: string | null
  providerReference: string | null
  idempotencyKey: string | null
  payerName: string | null
  paidAt: Date
  notes: string | null
  submittedByMembershipId: string | null
  initiatedByUserId: string | null
  verifiedByUserId: string | null
  submittedAt: Date
  verifiedAt: Date | null
  rejectionReason: string | null
  createdAt: Date
  updatedAt: Date
}): PaymentRecord {
  return {
    id: row.id,
    schoolId: row.schoolId,
    invoiceId: row.invoiceId,
    source: row.source as PaymentRecord['source'],
    method: row.method as PaymentRecord['method'],
    status: row.status as PaymentRecord['status'],
    amountMinor: row.amountMinor,
    appliedMinor: row.appliedMinor,
    overpaymentMinor: row.overpaymentMinor,
    currency: row.currency,
    paymentReference: row.paymentReference,
    provider: row.provider,
    providerReference: row.providerReference,
    idempotencyKey: row.idempotencyKey,
    payerName: row.payerName,
    paidAt: row.paidAt,
    notes: row.notes,
    submittedByMembershipId: row.submittedByMembershipId,
    initiatedByUserId: row.initiatedByUserId,
    verifiedByUserId: row.verifiedByUserId,
    submittedAt: row.submittedAt,
    verifiedAt: row.verifiedAt,
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function mapPaymentDetail(row: PaymentDetailRow): PaymentDetail {
  return {
    ...mapPayment(row),
    invoiceNumber: row.invoice.invoiceNumber,
    schoolName: row.school.name,
    evidence: row.evidence.map((item) => ({
      id: item.id,
      paymentId: item.paymentId,
      storageKey: item.storageKey,
      mimeType: item.mimeType,
      byteSize: item.byteSize,
      checksum: item.checksum,
      originalName: item.originalName,
      createdAt: item.createdAt,
    })),
    verifications: row.verifications.map((item) => ({
      id: item.id,
      paymentId: item.paymentId,
      invoiceId: item.invoiceId,
      decision: item.decision,
      fromStatus: item.fromStatus,
      toStatus: item.toStatus,
      reason: item.reason,
      verifiedByUserId: item.verifiedByUserId,
      verifiedByName:
        `${item.verifiedBy.firstName} ${item.verifiedBy.lastName}`.trim(),
      createdAt: item.createdAt,
    })),
  }
}

async function audit(
  tx: Tx,
  input: {
    schoolId?: string | null
    invoiceId?: string | null
    paymentId?: string | null
    context: BillingAuditContext
    action: string
    entityType: string
    entityId?: string | null
    beforeState?: unknown
    afterState?: unknown
    metadata?: unknown
  },
): Promise<void> {
  await tx.billingAuditHistory.create({
    data: {
      schoolId: input.schoolId ?? null,
      invoiceId: input.invoiceId ?? null,
      paymentId: input.paymentId ?? null,
      actorUserId: input.context.actorUserId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      beforeState:
        input.beforeState === undefined
          ? undefined
          : jsonValue(input.beforeState),
      afterState:
        input.afterState === undefined ? undefined : jsonValue(input.afterState),
      metadata:
        input.metadata === undefined ? undefined : jsonValue(input.metadata),
      ipAddress: input.context.ipAddress ?? null,
      userAgent: input.context.userAgent ?? null,
    },
  })
}

async function loadInvoiceDetail(
  tx: Tx,
  where: Prisma.SchoolInvoiceWhereUniqueInput,
): Promise<InvoiceDetail | null> {
  const row = await tx.schoolInvoice.findUnique({
    where,
    include: invoiceInclude,
  })

  if (!row) {
    return null
  }

  const [pupils, lines, payments] = await Promise.all([
    tx.invoicePupil.findMany({
      where: { invoiceId: row.id },
      orderBy: [{ pupilName: 'asc' }],
    }),
    tx.invoiceLine.findMany({
      where: { invoiceId: row.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
    tx.payment.findMany({
      where: { invoiceId: row.id },
      orderBy: [{ submittedAt: 'desc' }],
    }),
  ])

  return {
    invoice: mapInvoice(row),
    pupils: pupils.map((pupil) => ({
      id: pupil.id,
      invoiceId: pupil.invoiceId,
      pupilId: pupil.pupilId,
      reportCardId: pupil.reportCardId,
      classId: pupil.classId,
      pupilName: pupil.pupilName,
      admissionNumber: pupil.admissionNumber,
      reportVersion: pupil.reportVersion,
    })),
    lines: lines.map((line) => ({
      id: line.id,
      invoiceId: line.invoiceId,
      kind: line.kind,
      description: line.description,
      quantity: line.quantity,
      unitAmountMinor: line.unitAmountMinor,
      amountMinor: line.amountMinor,
      sortOrder: line.sortOrder,
    })),
    payments: payments.map(mapPayment),
  }
}

async function loadPaymentDetail(
  tx: Tx | ReturnType<typeof getPrismaClient>,
  where: Prisma.PaymentWhereUniqueInput,
): Promise<PaymentDetail | null> {
  const row = await tx.payment.findUnique({
    where,
    include: paymentDetailInclude,
  })

  return row ? mapPaymentDetail(row) : null
}

export function createPrismaBillingRepository(): BillingRepository {
  const repository: BillingRepository = {
    async listBillingSchools(): Promise<BillingSchoolScope[]> {
      const prisma = getPrismaClient()
      const rows = await prisma.school.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          isActive: true,
          academicYears: {
            orderBy: [{ startsOn: 'desc' }],
            select: {
              id: true,
              name: true,
              isCurrent: true,
              terms: {
                orderBy: [{ sequence: 'asc' }],
                select: {
                  id: true,
                  name: true,
                  sequence: true,
                  isCurrent: true,
                },
              },
            },
          },
        },
        orderBy: [{ name: 'asc' }],
      })

      return rows.map((school) => ({
        id: school.id,
        name: school.name,
        isActive: school.isActive,
        academicYears: school.academicYears.map((year) => ({
          id: year.id,
          name: year.name,
          isCurrent: year.isCurrent,
          terms: year.terms.map((term) => ({
            id: term.id,
            name: term.name,
            sequence: term.sequence,
            isCurrent: term.isCurrent,
          })),
        })),
      }))
    },

    async listPricingRules() {
      const prisma = getPrismaClient()
      const rows = await prisma.pricingRule.findMany({
        orderBy: [{ currency: 'asc' }, { effectiveFrom: 'desc' }],
      })

      return rows.map(mapPricingRule)
    },

    async createPricingRule(
      actor: PlatformBillingActor,
      input: CreatePricingRuleInput,
      auditContext: BillingAuditContext,
    ) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        const currency = input.currency.toUpperCase()
        const effectiveFrom = parseDateOnly(input.effectiveFrom)

        if (Number.isNaN(effectiveFrom.getTime())) {
          throw new HttpError(400, 'Effective date is invalid')
        }

        const latest = await tx.pricingRule.findFirst({
          where: { currency },
          orderBy: [{ version: 'desc' }],
        })

        if (latest && effectiveFrom <= latest.effectiveFrom) {
          throw new HttpError(
            409,
            'A pricing rule already covers this effective date. Create a later version instead of rewriting history.',
          )
        }

        if (
          latest?.effectiveTo &&
          effectiveFrom <= latest.effectiveTo
        ) {
          throw new HttpError(
            409,
            'The new pricing interval overlaps the previous rule',
          )
        }

        if (latest) {
          await tx.pricingRule.update({
            where: { id: latest.id },
            data: {
              effectiveTo: addUtcDays(effectiveFrom, -1),
            },
          })
        }

        const row = await tx.pricingRule.create({
          data: {
            currency,
            amountMinor: input.amountMinor,
            effectiveFrom,
            version: (latest?.version ?? 0) + 1,
            isActive: true,
            createdByUserId: actor.userId,
          },
        })

        await audit(tx, {
          context: auditContext,
          action: 'PRICING_RULE_CREATED',
          entityType: 'PricingRule',
          entityId: row.id,
          afterState: mapPricingRule(row),
        })

        return mapPricingRule(row)
      })
    },

    async setPricingRuleActive(
      _actor: PlatformBillingActor,
      ruleId: string,
      isActive: boolean,
      auditContext: BillingAuditContext,
    ) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        const existing = await tx.pricingRule.findUnique({
          where: { id: ruleId },
        })

        if (!existing) {
          throw new HttpError(404, 'Pricing rule not found')
        }

        const row = await tx.pricingRule.update({
          where: { id: ruleId },
          data: { isActive },
        })

        await audit(tx, {
          context: auditContext,
          action: isActive
            ? 'PRICING_RULE_ACTIVATED'
            : 'PRICING_RULE_DEACTIVATED',
          entityType: 'PricingRule',
          entityId: row.id,
          beforeState: { isActive: existing.isActive },
          afterState: { isActive: row.isActive },
        })

        return mapPricingRule(row)
      })
    },

    async resolvePricingRule(currency: string, onDate: Date) {
      const prisma = getPrismaClient()
      const row = await prisma.pricingRule.findFirst({
        where: {
          currency: currency.toUpperCase(),
          isActive: true,
          effectiveFrom: { lte: onDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: onDate } }],
        },
        orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
      })

      return row ? mapPricingRule(row) : null
    },

    async listSchoolInvoices(actor: SchoolBillingActor) {
      const prisma = getPrismaClient()
      const rows = await prisma.schoolInvoice.findMany({
        where: { schoolId: actor.schoolId },
        include: invoiceInclude,
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
      })

      return rows.map(mapInvoice)
    },

    async getSchoolInvoice(actor: SchoolBillingActor, invoiceId: string) {
      const prisma = getPrismaClient()
      return loadInvoiceDetail(prisma, { id: invoiceId, schoolId: actor.schoolId })
    },

    async listPlatformInvoices() {
      const prisma = getPrismaClient()
      const rows = await prisma.schoolInvoice.findMany({
        include: invoiceInclude,
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
      })

      return rows.map(mapInvoice)
    },

    async getPlatformInvoice(invoiceId: string) {
      const prisma = getPrismaClient()
      return loadInvoiceDetail(prisma, { id: invoiceId })
    },

    async createOrRefreshDraftInvoice(
      actor: PlatformBillingActor,
      input: CreateInvoiceInput,
      auditContext: BillingAuditContext,
    ) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        const [school, year, term] = await Promise.all([
          tx.school.findUnique({
            where: { id: input.schoolId },
            select: { id: true, name: true, isActive: true },
          }),
          tx.academicYear.findFirst({
            where: { id: input.academicYearId, schoolId: input.schoolId },
            select: { id: true, name: true },
          }),
          tx.academicTerm.findFirst({
            where: {
              id: input.academicTermId,
              schoolId: input.schoolId,
              academicYearId: input.academicYearId,
            },
            select: { id: true, name: true, sequence: true },
          }),
        ])

        if (!school || !school.isActive) {
          throw new HttpError(404, 'School not found')
        }

        if (!year || !term) {
          throw new HttpError(
            400,
            'The selected academic year and term must belong to this school',
          )
        }

        const issueDate = input.issueDate
          ? parseDateOnly(input.issueDate)
          : todayUtc()
        const dueDate = input.dueDate ? parseDateOnly(input.dueDate) : null

        if (dueDate && dueDate < issueDate) {
          throw new HttpError(400, 'Due date cannot be before the issue date')
        }

        const currency = (input.currency ?? 'GHS').toUpperCase()
        const pricingRule = await tx.pricingRule.findFirst({
          where: {
            currency,
            isActive: true,
            effectiveFrom: { lte: issueDate },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: issueDate } }],
          },
          orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
        })

        if (!pricingRule) {
          throw new HttpError(
            400,
            `No active ${currency} per-pupil pricing rule covers the invoice issue date`,
          )
        }

        const cards = await tx.reportCard.findMany({
          where: {
            schoolId: input.schoolId,
            academicYearId: input.academicYearId,
            academicTermId: input.academicTermId,
            versions: { some: {} },
          },
          include: {
            pupil: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                otherNames: true,
                admissionNumber: true,
              },
            },
            class: { select: { id: true, name: true } },
            versions: {
              orderBy: { version: 'desc' },
              take: 1,
              select: { version: true, generatedAt: true },
            },
          },
          orderBy: [
            { class: { sortOrder: 'asc' } },
            { pupil: { lastName: 'asc' } },
            { pupil: { firstName: 'asc' } },
          ],
        })

        const uniquePupils = new Map<
          string,
          {
            pupilId: string
            reportCardId: string
            reportVersion: number
            pupilName: string
            admissionNumber: string
            classId: string
            className: string
          }
        >()

        for (const card of cards) {
          const latest = card.versions[0]

          if (!latest || uniquePupils.has(card.pupilId)) {
            continue
          }

          uniquePupils.set(card.pupilId, {
            pupilId: card.pupilId,
            reportCardId: card.id,
            reportVersion: latest.version,
            pupilName: fullName(card.pupil),
            admissionNumber: card.pupil.admissionNumber,
            classId: card.classId,
            className: card.class.name,
          })
        }

        const billablePupils = [...uniquePupils.values()]

        if (billablePupils.length === 0) {
          throw new HttpError(
            400,
            'No unique eligible pupil reports were found for this school, academic year and term',
          )
        }

        const adjustmentMinor = input.adjustmentMinor ?? 0
        const subtotalMinor = pricingRule.amountMinor * billablePupils.length
        const totalMinor = subtotalMinor + adjustmentMinor

        if (totalMinor <= 0) {
          throw new HttpError(
            400,
            'The invoice total must be greater than zero after adjustments',
          )
        }

        let existing = await tx.schoolInvoice.findUnique({
          where: {
            schoolId_academicYearId_academicTermId: {
              schoolId: input.schoolId,
              academicYearId: input.academicYearId,
              academicTermId: input.academicTermId,
            },
          },
          include: invoiceInclude,
        })

        if (existing) {
          // A concurrent issue/cancel may change this row while the draft is
          // being recalculated. Lock and re-read before deciding it is a draft.
          await lockInvoiceRow(tx, existing.id)
          existing = await tx.schoolInvoice.findUnique({
            where: { id: existing.id },
            include: invoiceInclude,
          })
        }

        if (existing && existing.status !== 'DRAFT') {
          throw new HttpError(
            409,
            'An issued invoice is immutable. Record a correction or adjustment through the audited billing workflow instead of recalculating it.',
          )
        }

        const invoiceNumber =
          existing?.invoiceNumber ??
          invoiceNumberFor({
            schoolId: school.id,
            academicYearId: year.id,
            academicTermId: term.id,
            academicYearName: year.name,
            termSequence: term.sequence,
          })

        const snapshot = buildInvoiceSnapshot({
          invoiceNumber,
          school: { id: school.id, name: school.name },
          academicYear: year,
          academicTerm: term,
          pricingRule: mapPricingRule(pricingRule),
          billablePupils,
          adjustmentMinor,
          adjustmentReason: input.adjustmentReason ?? null,
          issueDate: dateOnly(issueDate),
          dueDate: dueDate ? dateOnly(dueDate) : null,
        })

        const row = existing
          ? await tx.schoolInvoice.update({
              where: { id: existing.id },
              data: {
                pricingRuleId: pricingRule.id,
                currency,
                unitAmountMinor: pricingRule.amountMinor,
                billablePupilCount: billablePupils.length,
                subtotalMinor,
                adjustmentMinor,
                totalMinor,
                paidMinor: 0,
                outstandingMinor: totalMinor,
                issueDate,
                dueDate,
                snapshot: jsonValue(snapshot),
                createdByUserId: actor.userId,
              },
              include: invoiceInclude,
            })
          : await tx.schoolInvoice.create({
              data: {
                invoiceNumber,
                schoolId: school.id,
                academicYearId: year.id,
                academicTermId: term.id,
                pricingRuleId: pricingRule.id,
                currency,
                unitAmountMinor: pricingRule.amountMinor,
                billablePupilCount: billablePupils.length,
                subtotalMinor,
                adjustmentMinor,
                totalMinor,
                paidMinor: 0,
                outstandingMinor: totalMinor,
                status: 'DRAFT',
                issueDate,
                dueDate,
                snapshot: jsonValue(snapshot),
                createdByUserId: actor.userId,
              },
              include: invoiceInclude,
            })

        await tx.invoiceLine.deleteMany({ where: { invoiceId: row.id } })
        await tx.invoicePupil.deleteMany({ where: { invoiceId: row.id } })

        await tx.invoiceLine.create({
          data: {
            invoiceId: row.id,
            schoolId: school.id,
            kind: 'PUPIL_CHARGE',
            description: `Report card fee — ${billablePupils.length} eligible pupil${
              billablePupils.length === 1 ? '' : 's'
            } × ${currency} ${(pricingRule.amountMinor / 100).toFixed(2)}`,
            quantity: billablePupils.length,
            unitAmountMinor: pricingRule.amountMinor,
            amountMinor: subtotalMinor,
            sortOrder: 0,
          },
        })

        if (adjustmentMinor !== 0) {
          await tx.invoiceLine.create({
            data: {
              invoiceId: row.id,
              schoolId: school.id,
              kind: 'ADJUSTMENT',
              description: input.adjustmentReason ?? 'Invoice adjustment',
              quantity: 1,
              unitAmountMinor: adjustmentMinor,
              amountMinor: adjustmentMinor,
              sortOrder: 1,
            },
          })
        }

        for (const pupil of billablePupils) {
          await tx.invoicePupil.create({
            data: {
              invoiceId: row.id,
              schoolId: school.id,
              academicYearId: year.id,
              academicTermId: term.id,
              classId: pupil.classId,
              pupilId: pupil.pupilId,
              reportCardId: pupil.reportCardId,
              pupilName: pupil.pupilName,
              admissionNumber: pupil.admissionNumber,
              reportVersion: pupil.reportVersion,
            },
          })
        }

        await audit(tx, {
          schoolId: school.id,
          invoiceId: row.id,
          context: auditContext,
          action: existing
            ? 'INVOICE_DRAFT_RECALCULATED'
            : 'INVOICE_DRAFT_CREATED',
          entityType: 'SchoolInvoice',
          entityId: row.id,
          beforeState: existing
            ? {
                status: existing.status,
                totalMinor: existing.totalMinor,
                billablePupilCount: existing.billablePupilCount,
              }
            : undefined,
          afterState: {
            status: row.status,
            totalMinor,
            billablePupilCount: billablePupils.length,
            pricingRuleId: pricingRule.id,
            pricingRuleVersion: pricingRule.version,
          },
          metadata: {
            uniquePupilCount: billablePupils.length,
            reportCardIds: billablePupils.map((pupil) => pupil.reportCardId),
          },
        })

        const detail = await loadInvoiceDetail(tx, { id: row.id })

        if (!detail) {
          throw new HttpError(500, 'Invoice could not be loaded after saving')
        }

        return { detail, reusedDraft: Boolean(existing) }
      })
    },

    async issueInvoice(
      actor: PlatformBillingActor,
      invoiceId: string,
      auditContext: BillingAuditContext,
    ) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        await lockInvoiceRow(tx, invoiceId)
        const existing = await tx.schoolInvoice.findUnique({
          where: { id: invoiceId },
        })

        if (!existing) {
          throw new HttpError(404, 'Invoice not found')
        }

        try {
          assertInvoiceTransition(existing.status, 'ISSUED', existing.paidMinor)
        } catch (error) {
          throw new HttpError(409, (error as Error).message)
        }

        if (existing.billablePupilCount <= 0 || existing.totalMinor <= 0) {
          throw new HttpError(409, 'Invoice has no billable amount to issue')
        }

        const row = await tx.schoolInvoice.update({
          where: { id: invoiceId },
          data: {
            status: 'ISSUED',
            issuedAt: new Date(),
            createdByUserId: actor.userId,
          },
          include: invoiceInclude,
        })

        await audit(tx, {
          schoolId: row.schoolId,
          invoiceId: row.id,
          context: auditContext,
          action: 'INVOICE_ISSUED',
          entityType: 'SchoolInvoice',
          entityId: row.id,
          beforeState: { status: existing.status },
          afterState: {
            status: row.status,
            totalMinor: row.totalMinor,
            billablePupilCount: row.billablePupilCount,
          },
        })

        const detail = await loadInvoiceDetail(tx, { id: row.id })

        if (!detail) {
          throw new HttpError(500, 'Invoice could not be loaded after issuing')
        }

        return detail
      })
    },

    async cancelInvoice(
      _actor: PlatformBillingActor,
      invoiceId: string,
      auditContext: BillingAuditContext,
    ) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        await lockInvoiceRow(tx, invoiceId)
        const existing = await tx.schoolInvoice.findUnique({
          where: { id: invoiceId },
        })

        if (!existing) {
          throw new HttpError(404, 'Invoice not found')
        }

        try {
          assertInvoiceTransition(existing.status, 'CANCELLED', existing.paidMinor)
        } catch (error) {
          throw new HttpError(409, (error as Error).message)
        }

        const row = await tx.schoolInvoice.update({
          where: { id: invoiceId },
          data: { status: 'CANCELLED', cancelledAt: new Date() },
          include: invoiceInclude,
        })

        await audit(tx, {
          schoolId: row.schoolId,
          invoiceId: row.id,
          context: auditContext,
          action: 'INVOICE_CANCELLED',
          entityType: 'SchoolInvoice',
          entityId: row.id,
          beforeState: { status: existing.status },
          afterState: { status: row.status },
        })

        const detail = await loadInvoiceDetail(tx, { id: row.id })

        if (!detail) {
          throw new HttpError(500, 'Invoice could not be loaded after cancelling')
        }

        return detail
      })
    },

    async listPayments(
      actor: SchoolBillingActor,
      filter: { invoiceId?: string } = {},
    ) {
      const prisma = getPrismaClient()
      const rows = await prisma.payment.findMany({
        where: {
          schoolId: actor.schoolId,
          ...(filter.invoiceId ? { invoiceId: filter.invoiceId } : {}),
        },
        orderBy: [{ submittedAt: 'desc' }],
      })

      return rows.map(mapPayment)
    },

    async getPaymentForSchool(
      actor: SchoolBillingActor,
      paymentId: string,
    ) {
      const prisma = getPrismaClient()
      const row = await prisma.payment.findFirst({
        where: { id: paymentId, schoolId: actor.schoolId },
        include: paymentDetailInclude,
      })

      return row ? mapPaymentDetail(row) : null
    },

    async listPendingPayments(_actor: PlatformBillingActor) {
      const prisma = getPrismaClient()
      const rows = await prisma.payment.findMany({
        where: {
          source: 'MANUAL',
          status: { in: ['PENDING', 'UNDER_REVIEW'] },
        },
        include: paymentDetailInclude,
        orderBy: [{ submittedAt: 'asc' }],
      })

      return rows.map(mapPaymentDetail)
    },

    async listVerifiedPayments(_actor: PlatformBillingActor) {
      const prisma = getPrismaClient()
      const rows = await prisma.payment.findMany({
        where: { status: 'VERIFIED' },
        include: paymentDetailInclude,
        orderBy: [{ verifiedAt: 'desc' }, { submittedAt: 'desc' }],
      })

      return rows.map(mapPaymentDetail)
    },

    async getPaymentForPlatform(
      _actor: PlatformBillingActor,
      paymentId: string,
    ) {
      const prisma = getPrismaClient()
      return loadPaymentDetail(prisma, { id: paymentId })
    },

    async findPaymentByIdempotencyKey(
      schoolId: string,
      idempotencyKey: string,
    ) {
      const prisma = getPrismaClient()
      const row = await prisma.payment.findFirst({
        where: { schoolId, idempotencyKey },
      })

      return row ? mapPayment(row) : null
    },

    async findPaymentByProviderReference(providerReference: string) {
      const prisma = getPrismaClient()
      const row = await prisma.payment.findUnique({
        where: { providerReference },
      })

      return row ? mapPayment(row) : null
    },

    async createOnlinePayment(
      actor: SchoolBillingActor,
      input: OnlinePaymentInput,
      auditContext: BillingAuditContext,
    ) {
      const prisma = getPrismaClient()

      try {
        return await prisma.$transaction(async (tx) => {
          await lockInvoiceRow(tx, input.invoiceId)
          const invoice = await tx.schoolInvoice.findFirst({
            where: { id: input.invoiceId, schoolId: actor.schoolId },
          })

          if (!invoice) {
            throw new HttpError(404, 'Invoice not found')
          }

          if (
            invoice.status !== 'ISSUED' &&
            invoice.status !== 'PARTIALLY_PAID'
          ) {
            throw new HttpError(409, 'This invoice cannot receive an online payment')
          }

          if (
            input.amountMinor !== invoice.outstandingMinor ||
            input.currency !== invoice.currency
          ) {
            throw new HttpError(
              409,
              'The invoice balance changed. Refresh and initiate the payment again.',
            )
          }

          const row = await tx.payment.create({
            data: {
              id: input.paymentId,
              schoolId: actor.schoolId,
              invoiceId: invoice.id,
              source: 'ONLINE',
              method: input.method,
              status: 'PENDING',
              amountMinor: input.amountMinor,
              currency: input.currency,
              paymentReference: input.paymentReference,
              provider: input.provider,
              providerReference: input.providerReference,
              idempotencyKey: input.idempotencyKey,
              paidAt: parseDateOnly(input.paidAt),
              initiatedByUserId: actor.userId,
            },
          })

          await audit(tx, {
            schoolId: actor.schoolId,
            invoiceId: invoice.id,
            paymentId: row.id,
            context: auditContext,
            action: 'ONLINE_PAYMENT_INITIATED',
            entityType: 'Payment',
            entityId: row.id,
            afterState: {
              status: row.status,
              amountMinor: row.amountMinor,
              currency: row.currency,
              provider: row.provider,
              providerReference: row.providerReference,
            },
          })

          return mapPayment(row)
        })
      } catch (error) {
        if (isUniqueError(error) && input.idempotencyKey) {
          const existing = await repository.findPaymentByIdempotencyKey(
            actor.schoolId,
            input.idempotencyKey,
          )

          if (existing && existing.invoiceId === input.invoiceId) {
            return existing
          }
        }

        if (isUniqueError(error)) {
          throw new HttpError(409, 'Payment reference is already in use')
        }

        throw error
      }
    },

    async attachProviderReference(
      paymentId: string,
      providerReference: string,
      auditContext: BillingAuditContext,
    ) {
      const prisma = getPrismaClient()
      const row = await prisma.payment.update({
        where: { id: paymentId },
        data: { providerReference },
      })

      await prisma.billingAuditHistory.create({
        data: {
          schoolId: row.schoolId,
          paymentId: row.id,
          actorUserId: auditContext.actorUserId ?? null,
          action: 'PAYMENT_PROVIDER_REFERENCE_SET',
          entityType: 'Payment',
          entityId: row.id,
          metadata: jsonValue({ provider: row.provider }),
          ipAddress: auditContext.ipAddress ?? null,
          userAgent: auditContext.userAgent ?? null,
        },
      })

      return mapPayment(row)
    },

    async failPayment(
      paymentId: string,
      reason: string,
      auditContext: BillingAuditContext,
    ) {
      const prisma = getPrismaClient()

      await prisma.$transaction(async (tx) => {
        await lockPaymentRow(tx, paymentId)
        const payment = await tx.payment.findUnique({ where: { id: paymentId } })

        if (
          !payment ||
          (payment.status !== 'PENDING' && payment.status !== 'UNDER_REVIEW')
        ) {
          return
        }

        const row = await tx.payment.update({
          where: { id: paymentId },
          data: {
            status: 'FAILED',
            rejectionReason: reason,
            verifiedAt: new Date(),
          },
        })

        await audit(tx, {
          schoolId: row.schoolId,
          invoiceId: row.invoiceId,
          paymentId: row.id,
          context: auditContext,
          action: 'PAYMENT_FAILED',
          entityType: 'Payment',
          entityId: row.id,
          beforeState: { status: payment.status },
          afterState: { status: row.status, reason },
        })
      })
    },

    async createManualPayment(
      actor: SchoolBillingActor,
      input: ManualPaymentInput,
      auditContext: BillingAuditContext,
    ) {
      const prisma = getPrismaClient()

      try {
        return await prisma.$transaction(async (tx) => {
          await lockInvoiceRow(tx, input.invoiceId)
          const invoice = await tx.schoolInvoice.findFirst({
            where: { id: input.invoiceId, schoolId: actor.schoolId },
          })

          if (!invoice) {
            throw new HttpError(404, 'Invoice not found')
          }

          if (
            invoice.status !== 'ISSUED' &&
            invoice.status !== 'PARTIALLY_PAID'
          ) {
            throw new HttpError(
              409,
              'This invoice cannot receive a manual payment',
            )
          }

          if (input.currency !== invoice.currency) {
            throw new HttpError(
              400,
              `Payment currency must match the invoice currency (${invoice.currency})`,
            )
          }

          const row = await tx.payment.create({
            data: {
              id: input.paymentId,
              schoolId: actor.schoolId,
              invoiceId: invoice.id,
              source: 'MANUAL',
              method: input.method,
              status: 'PENDING',
              amountMinor: input.amountMinor,
              currency: input.currency,
              paymentReference: input.paymentReference,
              payerName: input.payerName ?? null,
              paidAt: parseDateOnly(input.paidAt),
              notes: input.notes ?? null,
              submittedByMembershipId: actor.membershipId,
              initiatedByUserId: actor.userId,
            },
          })

          if (input.evidence) {
            await tx.paymentEvidence.create({
              data: {
                schoolId: actor.schoolId,
                paymentId: row.id,
                storageKey: input.evidence.storageKey,
                mimeType: input.evidence.mimeType,
                byteSize: input.evidence.byteSize,
                checksum: input.evidence.checksum,
                originalName: input.evidence.originalName,
                uploadedByMembershipId: actor.membershipId,
              },
            })
          }

          await audit(tx, {
            schoolId: actor.schoolId,
            invoiceId: invoice.id,
            paymentId: row.id,
            context: auditContext,
            action: 'MANUAL_PAYMENT_SUBMITTED',
            entityType: 'Payment',
            entityId: row.id,
            afterState: {
              status: row.status,
              amountMinor: row.amountMinor,
              currency: row.currency,
              method: row.method,
              paymentReference: row.paymentReference,
              hasEvidence: Boolean(input.evidence),
            },
          })

          const detail = await loadPaymentDetail(tx, { id: row.id })

          if (!detail) {
            throw new HttpError(500, 'Payment could not be loaded after saving')
          }

          return detail
        })
      } catch (error) {
        if (isUniqueError(error)) {
          throw new HttpError(
            409,
            'That payment reference has already been submitted for this school',
          )
        }

        throw error
      }
    },

    async verifyManualPayment(
      actor: PlatformBillingActor,
      paymentId: string,
      input: VerifyManualPaymentInput,
      auditContext: BillingAuditContext,
    ): Promise<PaymentVerificationResult> {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        await lockPaymentRow(tx, paymentId)
        const payment = await tx.payment.findUnique({
          where: { id: paymentId },
        })

        if (!payment || payment.source !== 'MANUAL') {
          throw new HttpError(404, 'Manual payment not found')
        }

        if (
          payment.status !== 'PENDING' &&
          payment.status !== 'UNDER_REVIEW'
        ) {
          throw new HttpError(409, 'This payment is no longer awaiting verification')
        }

        if (payment.initiatedByUserId === actor.userId) {
          throw new HttpError(403, 'A payment cannot be verified by its submitter')
        }

        // Lock the invoice after the payment so concurrent verifications are
        // serialized and each one reads the latest committed balance.
        await lockInvoiceRow(tx, payment.invoiceId)
        const invoice = await tx.schoolInvoice.findFirst({
          where: { id: payment.invoiceId, schoolId: payment.schoolId },
        })

        if (!invoice) {
          throw new HttpError(
            409,
            'The payment invoice does not belong to the payment school',
          )
        }

        if (
          invoice.status !== 'ISSUED' &&
          invoice.status !== 'PARTIALLY_PAID'
        ) {
          throw new HttpError(
            409,
            'The invoice is not in a state that can receive payment',
          )
        }

        const now = new Date()

        if (input.decision === 'REJECTED') {
          const rejected = await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: 'REJECTED',
              rejectionReason: input.reason ?? null,
              verifiedAt: now,
              verifiedByUserId: actor.userId,
            },
          })

          await tx.paymentVerification.create({
            data: {
              schoolId: payment.schoolId,
              paymentId: payment.id,
              invoiceId: invoice.id,
              decision: 'REJECTED',
              fromStatus: payment.status,
              toStatus: 'REJECTED',
              reason: input.reason ?? null,
              verifiedByUserId: actor.userId,
            },
          })

          await audit(tx, {
            schoolId: payment.schoolId,
            invoiceId: invoice.id,
            paymentId: payment.id,
            context: auditContext,
            action: 'MANUAL_PAYMENT_REJECTED',
            entityType: 'Payment',
            entityId: payment.id,
            beforeState: { status: payment.status },
            afterState: { status: rejected.status, reason: input.reason ?? null },
          })

          return {
            payment: mapPayment(rejected),
            invoice: mapInvoice(
              await tx.schoolInvoice.findUniqueOrThrow({
                where: { id: invoice.id },
                include: invoiceInclude,
              }),
            ),
          }
        }

        let application

        try {
          application = applyPaymentToInvoice(
            {
              totalMinor: invoice.totalMinor,
              paidMinor: invoice.paidMinor,
              outstandingMinor: invoice.outstandingMinor,
              status: invoice.status,
            },
            payment.amountMinor,
          )
        } catch (error) {
          throw new HttpError(409, (error as Error).message)
        }

        const verified = await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: 'VERIFIED',
            appliedMinor: application.appliedMinor,
            overpaymentMinor: application.overpaymentMinor,
            verifiedAt: now,
            verifiedByUserId: actor.userId,
            rejectionReason: null,
          },
        })

        const updatedInvoice = await tx.schoolInvoice.update({
          where: { id: invoice.id },
          data: {
            paidMinor: application.paidMinor,
            outstandingMinor: application.outstandingMinor,
            status: application.status,
          },
          include: invoiceInclude,
        })

        await tx.paymentVerification.create({
          data: {
            schoolId: payment.schoolId,
            paymentId: payment.id,
            invoiceId: invoice.id,
            decision: 'VERIFIED',
            fromStatus: payment.status,
            toStatus: 'VERIFIED',
            reason: input.reason ?? null,
            verifiedByUserId: actor.userId,
          },
        })

        await audit(tx, {
          schoolId: payment.schoolId,
          invoiceId: invoice.id,
          paymentId: payment.id,
          context: auditContext,
          action: 'MANUAL_PAYMENT_VERIFIED',
          entityType: 'Payment',
          entityId: payment.id,
          beforeState: {
            paymentStatus: payment.status,
            paidMinor: invoice.paidMinor,
            outstandingMinor: invoice.outstandingMinor,
          },
          afterState: {
            paymentStatus: verified.status,
            appliedMinor: verified.appliedMinor,
            overpaymentMinor: verified.overpaymentMinor,
            paidMinor: updatedInvoice.paidMinor,
            outstandingMinor: updatedInvoice.outstandingMinor,
            invoiceStatus: updatedInvoice.status,
          },
          metadata: {
            releaseBoundary:
              'Payment verification updates billing only; report cards remain internal drafts.',
          },
        })

        return {
          payment: mapPayment(verified),
          invoice: mapInvoice(updatedInvoice),
        }
      })
    },

    async applyOnlinePayment(
      paymentId: string,
      input: {
        amountMinor: number
        currency: string
        providerReference: string
      },
      auditContext: BillingAuditContext,
    ): Promise<PaymentVerificationResult> {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        await lockPaymentRow(tx, paymentId)
        const payment = await tx.payment.findUnique({ where: { id: paymentId } })

        if (!payment || payment.source !== 'ONLINE') {
          throw new HttpError(404, 'Online payment not found')
        }

        if (payment.providerReference !== input.providerReference) {
          throw new HttpError(400, 'Provider reference does not match the payment')
        }

        if (payment.amountMinor !== input.amountMinor) {
          throw new HttpError(400, 'Verified amount does not match the payment')
        }

        if (payment.currency !== input.currency) {
          throw new HttpError(400, 'Verified currency does not match the payment')
        }

        if (
          payment.status !== 'PENDING' &&
          payment.status !== 'UNDER_REVIEW'
        ) {
          throw new HttpError(409, 'This payment is no longer awaiting settlement')
        }

        // Lock the invoice after the payment so concurrent callbacks are
        // serialized and each one reads the latest committed balance.
        await lockInvoiceRow(tx, payment.invoiceId)
        const invoice = await tx.schoolInvoice.findFirst({
          where: { id: payment.invoiceId, schoolId: payment.schoolId },
        })

        if (!invoice) {
          throw new HttpError(
            409,
            'The payment invoice does not belong to the payment school',
          )
        }

        if (
          invoice.status !== 'ISSUED' &&
          invoice.status !== 'PARTIALLY_PAID'
        ) {
          throw new HttpError(
            409,
            'The invoice is not in a state that can receive payment',
          )
        }

        let application

        try {
          application = applyPaymentToInvoice(
            {
              totalMinor: invoice.totalMinor,
              paidMinor: invoice.paidMinor,
              outstandingMinor: invoice.outstandingMinor,
              status: invoice.status,
            },
            payment.amountMinor,
          )
        } catch (error) {
          throw new HttpError(409, (error as Error).message)
        }

        const now = new Date()
        const verified = await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: 'VERIFIED',
            appliedMinor: application.appliedMinor,
            overpaymentMinor: application.overpaymentMinor,
            verifiedAt: now,
            rejectionReason: null,
          },
        })

        const updatedInvoice = await tx.schoolInvoice.update({
          where: { id: invoice.id },
          data: {
            paidMinor: application.paidMinor,
            outstandingMinor: application.outstandingMinor,
            status: application.status,
          },
          include: invoiceInclude,
        })

        await audit(tx, {
          schoolId: payment.schoolId,
          invoiceId: invoice.id,
          paymentId: payment.id,
          context: auditContext,
          action: 'ONLINE_PAYMENT_VERIFIED',
          entityType: 'Payment',
          entityId: payment.id,
          beforeState: {
            paymentStatus: payment.status,
            paidMinor: invoice.paidMinor,
            outstandingMinor: invoice.outstandingMinor,
          },
          afterState: {
            paymentStatus: verified.status,
            appliedMinor: verified.appliedMinor,
            overpaymentMinor: verified.overpaymentMinor,
            paidMinor: updatedInvoice.paidMinor,
            outstandingMinor: updatedInvoice.outstandingMinor,
            invoiceStatus: updatedInvoice.status,
          },
          metadata: {
            verifiedBy: 'signed provider webhook',
            releaseBoundary:
              'Payment verification updates billing only; report cards remain internal drafts.',
          },
        })

        return {
          payment: mapPayment(verified),
          invoice: mapInvoice(updatedInvoice),
        }
      })
    },

    async beginProviderEvent(input: ProviderEventInput) {
      const prisma = getPrismaClient()

      try {
        const row = await prisma.paymentProviderEvent.create({
          data: {
            provider: input.provider,
            providerEventId: input.providerEventId,
            eventType: input.eventType,
            providerReference: input.providerReference ?? null,
            schoolId: input.schoolId ?? null,
            paymentId: input.paymentId ?? null,
            payload: jsonValue(input.payload),
            signatureValid: input.signatureValid,
            outcome: input.outcome,
          },
        })

        return {
          id: row.id,
          provider: row.provider,
          providerEventId: row.providerEventId,
          outcome: row.outcome,
          createdAt: row.receivedAt,
        } satisfies ProviderEventRecord
      } catch (error) {
        if (isUniqueError(error)) {
          return null
        }

        throw error
      }
    },

    async completeProviderEvent(
      eventId: string,
      input: { outcome: string; schoolId?: string | null; paymentId?: string | null },
    ) {
      const prisma = getPrismaClient()
      await prisma.paymentProviderEvent.update({
        where: { id: eventId },
        data: {
          outcome: input.outcome,
          schoolId: input.schoolId ?? null,
          paymentId: input.paymentId ?? null,
          processedAt: new Date(),
        },
      })
    },

    async listAuditHistory(filter: {
      schoolId?: string
      invoiceId?: string
      paymentId?: string
    }) {
      const prisma = getPrismaClient()
      const rows = await prisma.billingAuditHistory.findMany({
        where: {
          ...(filter.schoolId ? { schoolId: filter.schoolId } : {}),
          ...(filter.invoiceId ? { invoiceId: filter.invoiceId } : {}),
          ...(filter.paymentId ? { paymentId: filter.paymentId } : {}),
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 500,
      })

      return rows.map(
        (row): BillingAuditRecord => ({
          id: row.id,
          schoolId: row.schoolId,
          invoiceId: row.invoiceId,
          paymentId: row.paymentId,
          actorUserId: row.actorUserId,
          action: row.action,
          entityType: row.entityType,
          entityId: row.entityId,
          beforeState: row.beforeState,
          afterState: row.afterState,
          metadata: row.metadata,
          createdAt: row.createdAt,
        }),
      )
    },
  }

  return repository
}
