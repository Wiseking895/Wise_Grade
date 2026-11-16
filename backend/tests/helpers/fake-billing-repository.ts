import { randomUUID } from 'node:crypto'
import { HttpError } from '../../src/errors/http-error.js'
import {
  addUtcDays,
  applyPaymentToInvoice,
  assertInvoiceTransition,
  dateOnly,
  invoiceNumberFor,
  parseDateOnly,
  todayUtc,
} from '../../src/billing/domain.js'
import type {
  BillablePupilRecord,
  BillingAuditContext,
  BillingAuditRecord,
  BillingRepository,
  BillingSchoolScope,
  CreateInvoiceInput,
  CreateInvoiceResult,
  CreatePricingRuleInput,
  InvoiceDetail,
  InvoiceLineRecord,
  InvoicePupilRecord,
  InvoiceRecord,
  ManualPaymentInput,
  OnlinePaymentInput,
  PaymentDetail,
  PaymentEvidenceRecord,
  PaymentRecord,
  PaymentVerificationResult,
  PlatformBillingActor,
  PricingRuleRecord,
  ProviderEventInput,
  ProviderEventRecord,
  SchoolBillingActor,
  VerifyManualPaymentInput,
} from '../../src/billing/repository.js'

export interface FakeBillingScope {
  schoolId: string
  schoolName: string
  academicYearId: string
  academicYearName: string
  academicTermId: string
  academicTermName: string
  academicTermSequence: number
}

interface StoredEvidence extends PaymentEvidenceRecord {
  schoolId: string
}

interface StoredVerification {
  id: string
  schoolId: string
  paymentId: string
  invoiceId: string
  decision: 'VERIFIED' | 'REJECTED'
  fromStatus: PaymentRecord['status']
  toStatus: PaymentRecord['status']
  reason: string | null
  verifiedByUserId: string
  verifiedByName: string | null
  createdAt: Date
}

interface StoredProviderEvent extends ProviderEventRecord {
  providerEventId: string
  payload: unknown
  signatureValid: boolean
  schoolId: string | null
  paymentId: string | null
  processedAt: Date | null
  outcome: string
}

function scopeKey(scope: Pick<FakeBillingScope, 'schoolId' | 'academicYearId' | 'academicTermId'>): string {
  return `${scope.schoolId}:${scope.academicYearId}:${scope.academicTermId}`
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * In-memory Phase 6A billing repository for credential-free HTTP and service
 * tests. It mirrors the Prisma repository's tenant scoping and monetary
 * invariants closely enough to exercise authorization, idempotency and audit
 * behaviour without a database.
 */
export class FakeBillingRepository implements BillingRepository {
  readonly pricingRules: PricingRuleRecord[] = []
  readonly invoices: InvoiceRecord[] = []
  readonly invoicePupils: InvoicePupilRecord[] = []
  readonly invoiceLines: InvoiceLineRecord[] = []
  readonly payments: PaymentRecord[] = []
  readonly evidence: StoredEvidence[] = []
  readonly verifications: StoredVerification[] = []
  readonly providerEvents: StoredProviderEvent[] = []
  readonly audits: BillingAuditRecord[] = []

  private readonly scopes = new Map<string, FakeBillingScope>()
  private readonly billablePupils = new Map<string, BillablePupilRecord[]>()

  seedScope(scope: FakeBillingScope): void {
    this.scopes.set(scopeKey(scope), { ...scope })
  }

  setBillablePupils(scope: FakeBillingScope, pupils: BillablePupilRecord[]): void {
    this.seedScope(scope)
    this.billablePupils.set(scopeKey(scope), pupils.map((pupil) => ({ ...pupil })))
  }

  private audit(input: {
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
  }): void {
    this.audits.push({
      id: randomUUID(),
      schoolId: input.schoolId ?? null,
      invoiceId: input.invoiceId ?? null,
      paymentId: input.paymentId ?? null,
      actorUserId: input.context.actorUserId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      beforeState: input.beforeState === undefined ? null : clone(input.beforeState),
      afterState: input.afterState === undefined ? null : clone(input.afterState),
      metadata: input.metadata === undefined ? null : clone(input.metadata),
      createdAt: new Date(),
    })
  }

  private invoiceDetail(invoice: InvoiceRecord): InvoiceDetail {
    return {
      invoice: clone(invoice),
      pupils: this.invoicePupils
        .filter((pupil) => pupil.invoiceId === invoice.id)
        .map((pupil) => clone(pupil))
        .sort((a, b) => a.pupilName.localeCompare(b.pupilName)),
      lines: this.invoiceLines
        .filter((line) => line.invoiceId === invoice.id)
        .map((line) => clone(line))
        .sort((a, b) => a.sortOrder - b.sortOrder),
      payments: this.payments
        .filter((payment) => payment.invoiceId === invoice.id)
        .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime())
        .map((payment) => clone(payment)),
    }
  }

  private paymentDetail(payment: PaymentRecord): PaymentDetail {
    const invoice = this.invoices.find((item) => item.id === payment.invoiceId)
    const school = [...this.scopes.values()].find(
      (scope) => scope.schoolId === payment.schoolId,
    )

    return {
      ...clone(payment),
      invoiceNumber: invoice?.invoiceNumber ?? '',
      schoolName: school?.schoolName ?? '',
      evidence: this.evidence
        .filter((item) => item.paymentId === payment.id)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((item) => ({
          id: item.id,
          paymentId: item.paymentId,
          storageKey: item.storageKey,
          mimeType: item.mimeType,
          byteSize: item.byteSize,
          checksum: item.checksum,
          originalName: item.originalName,
          createdAt: item.createdAt,
        })),
      verifications: this.verifications
        .filter((item) => item.paymentId === payment.id)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((item) => ({
          id: item.id,
          paymentId: item.paymentId,
          invoiceId: item.invoiceId,
          decision: item.decision,
          fromStatus: item.fromStatus,
          toStatus: item.toStatus,
          reason: item.reason,
          verifiedByUserId: item.verifiedByUserId,
          verifiedByName: item.verifiedByName,
          createdAt: item.createdAt,
        })),
    }
  }

  async listBillingSchools(): Promise<BillingSchoolScope[]> {
    const schools = new Map<string, BillingSchoolScope>()

    for (const scope of this.scopes.values()) {
      const school = schools.get(scope.schoolId) ?? {
        id: scope.schoolId,
        name: scope.schoolName,
        isActive: true,
        academicYears: [],
      }

      let year = school.academicYears.find(
        (item) => item.id === scope.academicYearId,
      )

      if (!year) {
        year = {
          id: scope.academicYearId,
          name: scope.academicYearName,
          isCurrent: true,
          terms: [],
        }
        school.academicYears.push(year)
      }

      if (!year.terms.some((term) => term.id === scope.academicTermId)) {
        year.terms.push({
          id: scope.academicTermId,
          name: scope.academicTermName,
          sequence: scope.academicTermSequence,
          isCurrent: true,
        })
      }

      schools.set(scope.schoolId, school)
    }

    return [...schools.values()]
      .map((school) => ({
        ...school,
        academicYears: school.academicYears
          .map((year) => ({
            ...year,
            terms: [...year.terms].sort((a, b) => a.sequence - b.sequence),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async listPricingRules(): Promise<PricingRuleRecord[]> {
    return this.pricingRules.map((rule) => clone(rule))
  }

  async createPricingRule(
    actor: PlatformBillingActor,
    input: CreatePricingRuleInput,
    auditContext: BillingAuditContext,
  ): Promise<PricingRuleRecord> {
    const currency = input.currency.toUpperCase()
    const effectiveFrom = parseDateOnly(input.effectiveFrom)

    if (Number.isNaN(effectiveFrom.getTime())) {
      throw new HttpError(400, 'Effective date is invalid')
    }

    const latest = this.pricingRules
      .filter((rule) => rule.currency === currency)
      .sort((a, b) => b.version - a.version)[0]

    if (latest && effectiveFrom <= latest.effectiveFrom) {
      throw new HttpError(
        409,
        'A pricing rule already covers this effective date. Create a later version instead of rewriting history.',
      )
    }

    if (latest?.effectiveTo && effectiveFrom <= latest.effectiveTo) {
      throw new HttpError(409, 'The new pricing interval overlaps the previous rule')
    }

    if (latest) {
      latest.effectiveTo = addUtcDays(effectiveFrom, -1)
      latest.updatedAt = new Date()
    }

    const rule: PricingRuleRecord = {
      id: randomUUID(),
      currency,
      amountMinor: input.amountMinor,
      effectiveFrom,
      effectiveTo: null,
      isActive: true,
      version: (latest?.version ?? 0) + 1,
      createdByUserId: actor.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    this.pricingRules.push(rule)
    this.audit({
      context: auditContext,
      action: 'PRICING_RULE_CREATED',
      entityType: 'PricingRule',
      entityId: rule.id,
      afterState: rule,
    })

    return clone(rule)
  }

  async setPricingRuleActive(
    _actor: PlatformBillingActor,
    ruleId: string,
    isActive: boolean,
    auditContext: BillingAuditContext,
  ): Promise<PricingRuleRecord> {
    const rule = this.pricingRules.find((item) => item.id === ruleId)

    if (!rule) {
      throw new HttpError(404, 'Pricing rule not found')
    }

    const before = rule.isActive
    rule.isActive = isActive
    rule.updatedAt = new Date()

    this.audit({
      context: auditContext,
      action: isActive ? 'PRICING_RULE_ACTIVATED' : 'PRICING_RULE_DEACTIVATED',
      entityType: 'PricingRule',
      entityId: rule.id,
      beforeState: { isActive: before },
      afterState: { isActive },
    })

    return clone(rule)
  }

  async resolvePricingRule(
    currency: string,
    onDate: Date,
  ): Promise<PricingRuleRecord | null> {
    const rule = this.pricingRules
      .filter(
        (item) =>
          item.currency === currency.toUpperCase() &&
          item.isActive &&
          item.effectiveFrom <= onDate &&
          (item.effectiveTo === null || item.effectiveTo >= onDate),
      )
      .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0]

    return rule ? clone(rule) : null
  }

  async listSchoolInvoices(actor: SchoolBillingActor): Promise<InvoiceRecord[]> {
    return this.invoices
      .filter((invoice) => invoice.schoolId === actor.schoolId)
      .sort((a, b) => b.issueDate.getTime() - a.issueDate.getTime())
      .map((invoice) => clone(invoice))
  }

  async getSchoolInvoice(
    actor: SchoolBillingActor,
    invoiceId: string,
  ): Promise<InvoiceDetail | null> {
    const invoice = this.invoices.find(
      (item) => item.id === invoiceId && item.schoolId === actor.schoolId,
    )

    return invoice ? this.invoiceDetail(invoice) : null
  }

  async listPlatformInvoices(): Promise<InvoiceRecord[]> {
    return this.invoices
      .sort((a, b) => b.issueDate.getTime() - a.issueDate.getTime())
      .map((invoice) => clone(invoice))
  }

  async getPlatformInvoice(invoiceId: string): Promise<InvoiceDetail | null> {
    const invoice = this.invoices.find((item) => item.id === invoiceId)
    return invoice ? this.invoiceDetail(invoice) : null
  }

  async createOrRefreshDraftInvoice(
    _actor: PlatformBillingActor,
    input: CreateInvoiceInput,
    auditContext: BillingAuditContext,
  ): Promise<CreateInvoiceResult> {
    const key = scopeKey({
      schoolId: input.schoolId,
      academicYearId: input.academicYearId,
      academicTermId: input.academicTermId,
    })
    const scope = this.scopes.get(key)

    if (!scope) {
      throw new HttpError(
        400,
        'The selected academic year and term must belong to this school',
      )
    }

    const issueDate = input.issueDate ? parseDateOnly(input.issueDate) : todayUtc()
    const dueDate = input.dueDate ? parseDateOnly(input.dueDate) : null

    if (dueDate && dueDate < issueDate) {
      throw new HttpError(400, 'Due date cannot be before the issue date')
    }

    const currency = (input.currency ?? 'GHS').toUpperCase()
    const pricingRule = await this.resolvePricingRule(currency, issueDate)

    if (!pricingRule) {
      throw new HttpError(
        400,
        `No active ${currency} per-pupil pricing rule covers the invoice issue date`,
      )
    }

    const seen = new Set<string>()
    const billablePupils = (this.billablePupils.get(key) ?? []).filter((pupil) => {
      if (seen.has(pupil.pupilId)) {
        return false
      }

      seen.add(pupil.pupilId)
      return true
    })

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

    const existing = this.invoices.find(
      (invoice) =>
        invoice.schoolId === input.schoolId &&
        invoice.academicYearId === input.academicYearId &&
        invoice.academicTermId === input.academicTermId,
    )

    if (existing && existing.status !== 'DRAFT') {
      throw new HttpError(
        409,
        'An issued invoice is immutable. Record a correction or adjustment through the audited billing workflow instead of recalculating it.',
      )
    }

    const invoiceNumber =
      existing?.invoiceNumber ??
      invoiceNumberFor({
        schoolId: scope.schoolId,
        academicYearId: scope.academicYearId,
        academicTermId: scope.academicTermId,
        academicYearName: scope.academicYearName,
        termSequence: scope.academicTermSequence,
      })

    const invoice: InvoiceRecord = {
      id: existing?.id ?? randomUUID(),
      invoiceNumber,
      schoolId: scope.schoolId,
      schoolName: scope.schoolName,
      academicYearId: scope.academicYearId,
      academicYearName: scope.academicYearName,
      academicTermId: scope.academicTermId,
      academicTermName: scope.academicTermName,
      academicTermSequence: scope.academicTermSequence,
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
      issuedAt: null,
      cancelledAt: null,
      snapshot: {
        schemaVersion: 1,
        invoiceNumber,
        school: { id: scope.schoolId, name: scope.schoolName },
        academicYear: {
          id: scope.academicYearId,
          name: scope.academicYearName,
        },
        academicTerm: {
          id: scope.academicTermId,
          name: scope.academicTermName,
          sequence: scope.academicTermSequence,
        },
        price: {
          pricingRuleId: pricingRule.id,
          version: pricingRule.version,
          currency,
          amountMinor: pricingRule.amountMinor,
          effectiveFrom: dateOnly(pricingRule.effectiveFrom),
          effectiveTo: pricingRule.effectiveTo
            ? dateOnly(pricingRule.effectiveTo)
            : null,
        },
        billablePopulation: {
          count: billablePupils.length,
          pupils: clone(billablePupils),
        },
        calculation: {
          unitAmountMinor: pricingRule.amountMinor,
          billablePupilCount: billablePupils.length,
          subtotalMinor,
          adjustmentMinor,
          adjustmentReason: input.adjustmentReason ?? null,
          totalMinor,
        },
        dates: {
          issueDate: dateOnly(issueDate),
          dueDate: dueDate ? dateOnly(dueDate) : null,
        },
      },
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    }

    if (existing) {
      Object.assign(existing, invoice)
    } else {
      this.invoices.push(invoice)
    }

    this.invoiceLines.splice(
      0,
      this.invoiceLines.length,
      ...this.invoiceLines.filter((line) => line.invoiceId !== invoice.id),
    )
    this.invoicePupils.splice(
      0,
      this.invoicePupils.length,
      ...this.invoicePupils.filter((pupil) => pupil.invoiceId !== invoice.id),
    )

    this.invoiceLines.push({
      id: randomUUID(),
      invoiceId: invoice.id,
      kind: 'PUPIL_CHARGE',
      description: `Report card fee — ${billablePupils.length} eligible pupil${
        billablePupils.length === 1 ? '' : 's'
      } × ${currency} ${(pricingRule.amountMinor / 100).toFixed(2)}`,
      quantity: billablePupils.length,
      unitAmountMinor: pricingRule.amountMinor,
      amountMinor: subtotalMinor,
      sortOrder: 0,
    })

    if (adjustmentMinor !== 0) {
      this.invoiceLines.push({
        id: randomUUID(),
        invoiceId: invoice.id,
        kind: 'ADJUSTMENT',
        description: input.adjustmentReason ?? 'Invoice adjustment',
        quantity: 1,
        unitAmountMinor: adjustmentMinor,
        amountMinor: adjustmentMinor,
        sortOrder: 1,
      })
    }

    for (const pupil of billablePupils) {
      this.invoicePupils.push({
        id: randomUUID(),
        invoiceId: invoice.id,
        pupilId: pupil.pupilId,
        reportCardId: pupil.reportCardId,
        classId: pupil.classId,
        pupilName: pupil.pupilName,
        admissionNumber: pupil.admissionNumber,
        reportVersion: pupil.reportVersion,
      })
    }

    this.audit({
      schoolId: invoice.schoolId,
      invoiceId: invoice.id,
      context: auditContext,
      action: existing ? 'INVOICE_DRAFT_RECALCULATED' : 'INVOICE_DRAFT_CREATED',
      entityType: 'SchoolInvoice',
      entityId: invoice.id,
      beforeState: existing
        ? {
            status: existing.status,
            totalMinor: existing.totalMinor,
            billablePupilCount: existing.billablePupilCount,
          }
        : undefined,
      afterState: {
        status: invoice.status,
        totalMinor: invoice.totalMinor,
        billablePupilCount: invoice.billablePupilCount,
      },
    })

    return { detail: this.invoiceDetail(invoice), reusedDraft: Boolean(existing) }
  }

  async issueInvoice(
    actor: PlatformBillingActor,
    invoiceId: string,
    auditContext: BillingAuditContext,
  ): Promise<InvoiceDetail> {
    const invoice = this.invoices.find((item) => item.id === invoiceId)

    if (!invoice) {
      throw new HttpError(404, 'Invoice not found')
    }

    try {
      assertInvoiceTransition(invoice.status, 'ISSUED', invoice.paidMinor)
    } catch (error) {
      throw new HttpError(409, (error as Error).message)
    }

    invoice.status = 'ISSUED'
    invoice.issuedAt = new Date()
    invoice.updatedAt = new Date()

    this.audit({
      schoolId: invoice.schoolId,
      invoiceId: invoice.id,
      context: auditContext,
      action: 'INVOICE_ISSUED',
      entityType: 'SchoolInvoice',
      entityId: invoice.id,
      afterState: { status: invoice.status, issuedBy: actor.userId },
    })

    return this.invoiceDetail(invoice)
  }

  async cancelInvoice(
    _actor: PlatformBillingActor,
    invoiceId: string,
    auditContext: BillingAuditContext,
  ): Promise<InvoiceDetail> {
    const invoice = this.invoices.find((item) => item.id === invoiceId)

    if (!invoice) {
      throw new HttpError(404, 'Invoice not found')
    }

    try {
      assertInvoiceTransition(invoice.status, 'CANCELLED', invoice.paidMinor)
    } catch (error) {
      throw new HttpError(409, (error as Error).message)
    }

    const before = invoice.status
    invoice.status = 'CANCELLED'
    invoice.cancelledAt = new Date()
    invoice.updatedAt = new Date()

    this.audit({
      schoolId: invoice.schoolId,
      invoiceId: invoice.id,
      context: auditContext,
      action: 'INVOICE_CANCELLED',
      entityType: 'SchoolInvoice',
      entityId: invoice.id,
      beforeState: { status: before },
      afterState: { status: invoice.status },
    })

    return this.invoiceDetail(invoice)
  }

  async listPayments(
    actor: SchoolBillingActor,
    filter: { invoiceId?: string } = {},
  ): Promise<PaymentRecord[]> {
    return this.payments
      .filter(
        (payment) =>
          payment.schoolId === actor.schoolId &&
          (!filter.invoiceId || payment.invoiceId === filter.invoiceId),
      )
      .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime())
      .map((payment) => clone(payment))
  }

  async getPaymentForSchool(
    actor: SchoolBillingActor,
    paymentId: string,
  ): Promise<PaymentDetail | null> {
    const payment = this.payments.find(
      (item) => item.id === paymentId && item.schoolId === actor.schoolId,
    )

    return payment ? this.paymentDetail(payment) : null
  }

  async listPendingPayments(_actor: PlatformBillingActor): Promise<PaymentDetail[]> {
    return this.payments
      .filter(
        (payment) =>
          payment.source === 'MANUAL' &&
          (payment.status === 'PENDING' || payment.status === 'UNDER_REVIEW'),
      )
      .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime())
      .map((payment) => this.paymentDetail(payment))
  }

  async listVerifiedPayments(_actor: PlatformBillingActor): Promise<PaymentDetail[]> {
    return this.payments
      .filter((payment) => payment.status === 'VERIFIED')
      .sort((a, b) => (b.verifiedAt?.getTime() ?? 0) - (a.verifiedAt?.getTime() ?? 0))
      .map((payment) => this.paymentDetail(payment))
  }

  async getPaymentForPlatform(
    _actor: PlatformBillingActor,
    paymentId: string,
  ): Promise<PaymentDetail | null> {
    const payment = this.payments.find((item) => item.id === paymentId)
    return payment ? this.paymentDetail(payment) : null
  }

  async findPaymentByIdempotencyKey(
    schoolId: string,
    idempotencyKey: string,
  ): Promise<PaymentRecord | null> {
    const payment = this.payments.find(
      (item) =>
        item.schoolId === schoolId && item.idempotencyKey === idempotencyKey,
    )

    return payment ? clone(payment) : null
  }

  async findPaymentByProviderReference(
    providerReference: string,
  ): Promise<PaymentRecord | null> {
    const payment = this.payments.find(
      (item) => item.providerReference === providerReference,
    )

    return payment ? clone(payment) : null
  }

  async createOnlinePayment(
    actor: SchoolBillingActor,
    input: OnlinePaymentInput,
    auditContext: BillingAuditContext,
  ): Promise<PaymentRecord> {
    const invoice = this.invoices.find(
      (item) => item.id === input.invoiceId && item.schoolId === actor.schoolId,
    )

    if (!invoice) {
      throw new HttpError(404, 'Invoice not found')
    }

    if (invoice.status !== 'ISSUED' && invoice.status !== 'PARTIALLY_PAID') {
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

    if (
      this.payments.some(
        (payment) =>
          payment.schoolId === actor.schoolId &&
          payment.idempotencyKey === input.idempotencyKey,
      )
    ) {
      const existing = this.payments.find(
        (payment) =>
          payment.schoolId === actor.schoolId &&
          payment.idempotencyKey === input.idempotencyKey,
      )

      if (existing) {
        return clone(existing)
      }
    }

    if (
      this.payments.some(
        (payment) => payment.providerReference === input.providerReference,
      )
    ) {
      throw new HttpError(409, 'Payment reference is already in use')
    }

    const payment: PaymentRecord = {
      id: input.paymentId,
      schoolId: actor.schoolId,
      invoiceId: invoice.id,
      source: 'ONLINE',
      method: input.method,
      status: 'PENDING',
      amountMinor: input.amountMinor,
      appliedMinor: 0,
      overpaymentMinor: 0,
      currency: input.currency,
      paymentReference: input.paymentReference,
      provider: input.provider,
      providerReference: input.providerReference,
      idempotencyKey: input.idempotencyKey,
      payerName: null,
      paidAt: parseDateOnly(input.paidAt),
      notes: null,
      submittedByMembershipId: null,
      initiatedByUserId: actor.userId,
      verifiedByUserId: null,
      submittedAt: new Date(),
      verifiedAt: null,
      rejectionReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    this.payments.push(payment)

    this.audit({
      schoolId: actor.schoolId,
      invoiceId: invoice.id,
      paymentId: payment.id,
      context: auditContext,
      action: 'ONLINE_PAYMENT_INITIATED',
      entityType: 'Payment',
      entityId: payment.id,
      afterState: {
        status: payment.status,
        amountMinor: payment.amountMinor,
        provider: payment.provider,
        providerReference: payment.providerReference,
      },
    })

    return clone(payment)
  }

  async attachProviderReference(
    paymentId: string,
    providerReference: string,
    auditContext: BillingAuditContext,
  ): Promise<PaymentRecord> {
    const payment = this.payments.find((item) => item.id === paymentId)

    if (!payment) {
      throw new HttpError(404, 'Payment not found')
    }

    payment.providerReference = providerReference
    payment.updatedAt = new Date()

    this.audit({
      schoolId: payment.schoolId,
      invoiceId: payment.invoiceId,
      paymentId: payment.id,
      context: auditContext,
      action: 'PAYMENT_PROVIDER_REFERENCE_SET',
      entityType: 'Payment',
      entityId: payment.id,
    })

    return clone(payment)
  }

  async failPayment(
    paymentId: string,
    reason: string,
    auditContext: BillingAuditContext,
  ): Promise<void> {
    const payment = this.payments.find((item) => item.id === paymentId)

    if (
      !payment ||
      (payment.status !== 'PENDING' && payment.status !== 'UNDER_REVIEW')
    ) {
      return
    }

    const before = payment.status
    payment.status = 'FAILED'
    payment.rejectionReason = reason
    payment.verifiedAt = new Date()
    payment.updatedAt = new Date()

    this.audit({
      schoolId: payment.schoolId,
      invoiceId: payment.invoiceId,
      paymentId: payment.id,
      context: auditContext,
      action: 'PAYMENT_FAILED',
      entityType: 'Payment',
      entityId: payment.id,
      beforeState: { status: before },
      afterState: { status: payment.status, reason },
    })
  }

  async createManualPayment(
    actor: SchoolBillingActor,
    input: ManualPaymentInput,
    auditContext: BillingAuditContext,
  ): Promise<PaymentDetail> {
    const invoice = this.invoices.find(
      (item) => item.id === input.invoiceId && item.schoolId === actor.schoolId,
    )

    if (!invoice) {
      throw new HttpError(404, 'Invoice not found')
    }

    if (invoice.status !== 'ISSUED' && invoice.status !== 'PARTIALLY_PAID') {
      throw new HttpError(409, 'This invoice cannot receive a manual payment')
    }

    if (input.currency !== invoice.currency) {
      throw new HttpError(
        400,
        `Payment currency must match the invoice currency (${invoice.currency})`,
      )
    }

    if (
      this.payments.some(
        (payment) =>
          payment.schoolId === actor.schoolId &&
          payment.paymentReference === input.paymentReference,
      )
    ) {
      throw new HttpError(
        409,
        'That payment reference has already been submitted for this school',
      )
    }

    const payment: PaymentRecord = {
      id: input.paymentId,
      schoolId: actor.schoolId,
      invoiceId: invoice.id,
      source: 'MANUAL',
      method: input.method,
      status: 'PENDING',
      amountMinor: input.amountMinor,
      appliedMinor: 0,
      overpaymentMinor: 0,
      currency: input.currency,
      paymentReference: input.paymentReference,
      provider: null,
      providerReference: null,
      idempotencyKey: null,
      payerName: input.payerName ?? null,
      paidAt: parseDateOnly(input.paidAt),
      notes: input.notes ?? null,
      submittedByMembershipId: actor.membershipId,
      initiatedByUserId: actor.userId,
      verifiedByUserId: null,
      submittedAt: new Date(),
      verifiedAt: null,
      rejectionReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    this.payments.push(payment)

    if (input.evidence) {
      this.evidence.push({
        id: randomUUID(),
        schoolId: actor.schoolId,
        paymentId: payment.id,
        storageKey: input.evidence.storageKey,
        mimeType: input.evidence.mimeType,
        byteSize: input.evidence.byteSize,
        checksum: input.evidence.checksum,
        originalName: input.evidence.originalName,
        createdAt: new Date(),
      })
    }

    this.audit({
      schoolId: actor.schoolId,
      invoiceId: invoice.id,
      paymentId: payment.id,
      context: auditContext,
      action: 'MANUAL_PAYMENT_SUBMITTED',
      entityType: 'Payment',
      entityId: payment.id,
      afterState: {
        status: payment.status,
        amountMinor: payment.amountMinor,
        hasEvidence: Boolean(input.evidence),
      },
    })

    return this.paymentDetail(payment)
  }

  async verifyManualPayment(
    actor: PlatformBillingActor,
    paymentId: string,
    input: VerifyManualPaymentInput,
    auditContext: BillingAuditContext,
  ): Promise<PaymentVerificationResult> {
    const payment = this.payments.find((item) => item.id === paymentId)

    if (!payment || payment.source !== 'MANUAL') {
      throw new HttpError(404, 'Manual payment not found')
    }

    if (payment.status !== 'PENDING' && payment.status !== 'UNDER_REVIEW') {
      throw new HttpError(409, 'This payment is no longer awaiting verification')
    }

    if (payment.initiatedByUserId === actor.userId) {
      throw new HttpError(403, 'A payment cannot be verified by its submitter')
    }

    const invoice = this.invoices.find(
      (item) => item.id === payment.invoiceId && item.schoolId === payment.schoolId,
    )

    if (!invoice) {
      throw new HttpError(
        409,
        'The payment invoice does not belong to the payment school',
      )
    }

    if (invoice.status !== 'ISSUED' && invoice.status !== 'PARTIALLY_PAID') {
      throw new HttpError(
        409,
        'The invoice is not in a state that can receive payment',
      )
    }

    const now = new Date()

    if (input.decision === 'REJECTED') {
      if (!input.reason?.trim()) {
        throw new HttpError(400, 'A rejection reason is required')
      }

      const fromStatus = payment.status
      payment.status = 'REJECTED'
      payment.rejectionReason = input.reason
      payment.verifiedAt = now
      payment.verifiedByUserId = actor.userId
      payment.updatedAt = now

      this.verifications.push({
        id: randomUUID(),
        schoolId: payment.schoolId,
        paymentId: payment.id,
        invoiceId: invoice.id,
        decision: 'REJECTED',
        fromStatus,
        toStatus: 'REJECTED',
        reason: input.reason,
        verifiedByUserId: actor.userId,
        verifiedByName: 'Platform Admin',
        createdAt: now,
      })

      this.audit({
        schoolId: payment.schoolId,
        invoiceId: invoice.id,
        paymentId: payment.id,
        context: auditContext,
        action: 'MANUAL_PAYMENT_REJECTED',
        entityType: 'Payment',
        entityId: payment.id,
      })

      return {
        payment: clone(payment),
        invoice: clone(invoice),
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

    const fromStatus = payment.status
    payment.status = 'VERIFIED'
    payment.appliedMinor = application.appliedMinor
    payment.overpaymentMinor = application.overpaymentMinor
    payment.verifiedAt = now
    payment.verifiedByUserId = actor.userId
    payment.rejectionReason = null
    payment.updatedAt = now

    invoice.paidMinor = application.paidMinor
    invoice.outstandingMinor = application.outstandingMinor
    invoice.status = application.status
    invoice.updatedAt = now

    this.verifications.push({
      id: randomUUID(),
      schoolId: payment.schoolId,
      paymentId: payment.id,
      invoiceId: invoice.id,
      decision: 'VERIFIED',
      fromStatus,
      toStatus: 'VERIFIED',
      reason: input.reason ?? null,
      verifiedByUserId: actor.userId,
      verifiedByName: 'Platform Admin',
      createdAt: now,
    })

    this.audit({
      schoolId: payment.schoolId,
      invoiceId: invoice.id,
      paymentId: payment.id,
      context: auditContext,
      action: 'MANUAL_PAYMENT_VERIFIED',
      entityType: 'Payment',
      entityId: payment.id,
      beforeState: {
        paymentStatus: fromStatus,
        paidMinor: invoice.paidMinor - application.appliedMinor,
      },
      afterState: {
        paymentStatus: payment.status,
        appliedMinor: payment.appliedMinor,
        overpaymentMinor: payment.overpaymentMinor,
        invoiceStatus: invoice.status,
      },
      metadata: {
        releaseBoundary:
          'Payment verification updates billing only; report cards remain internal drafts.',
      },
    })

    return { payment: clone(payment), invoice: clone(invoice) }
  }

  async applyOnlinePayment(
    paymentId: string,
    input: { amountMinor: number; currency: string; providerReference: string },
    auditContext: BillingAuditContext,
  ): Promise<PaymentVerificationResult> {
    const payment = this.payments.find((item) => item.id === paymentId)

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

    if (payment.status !== 'PENDING' && payment.status !== 'UNDER_REVIEW') {
      throw new HttpError(409, 'This payment is no longer awaiting settlement')
    }

    const invoice = this.invoices.find(
      (item) => item.id === payment.invoiceId && item.schoolId === payment.schoolId,
    )

    if (!invoice) {
      throw new HttpError(
        409,
        'The payment invoice does not belong to the payment school',
      )
    }

    if (invoice.status !== 'ISSUED' && invoice.status !== 'PARTIALLY_PAID') {
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
    payment.status = 'VERIFIED'
    payment.appliedMinor = application.appliedMinor
    payment.overpaymentMinor = application.overpaymentMinor
    payment.verifiedAt = now
    payment.rejectionReason = null
    payment.updatedAt = now

    invoice.paidMinor = application.paidMinor
    invoice.outstandingMinor = application.outstandingMinor
    invoice.status = application.status
    invoice.updatedAt = now

    this.audit({
      schoolId: payment.schoolId,
      invoiceId: invoice.id,
      paymentId: payment.id,
      context: auditContext,
      action: 'ONLINE_PAYMENT_VERIFIED',
      entityType: 'Payment',
      entityId: payment.id,
      afterState: {
        paymentStatus: payment.status,
        appliedMinor: payment.appliedMinor,
        overpaymentMinor: payment.overpaymentMinor,
        invoiceStatus: invoice.status,
      },
      metadata: {
        releaseBoundary:
          'Payment verification updates billing only; report cards remain internal drafts.',
      },
    })

    return { payment: clone(payment), invoice: clone(invoice) }
  }

  async beginProviderEvent(
    input: ProviderEventInput,
  ): Promise<ProviderEventRecord | null> {
    if (
      this.providerEvents.some(
        (event) =>
          event.provider === input.provider &&
          event.providerEventId === input.providerEventId,
      )
    ) {
      return null
    }

    const event: StoredProviderEvent = {
      id: randomUUID(),
      provider: input.provider,
      providerEventId: input.providerEventId,
      outcome: input.outcome,
      createdAt: new Date(),
      payload: input.payload,
      signatureValid: input.signatureValid,
      schoolId: input.schoolId ?? null,
      paymentId: input.paymentId ?? null,
      processedAt: null,
    }

    this.providerEvents.push(event)

    return {
      id: event.id,
      provider: event.provider,
      providerEventId: event.providerEventId,
      outcome: event.outcome,
      createdAt: event.createdAt,
    }
  }

  async completeProviderEvent(
    eventId: string,
    input: { outcome: string; schoolId?: string | null; paymentId?: string | null },
  ): Promise<void> {
    const event = this.providerEvents.find((item) => item.id === eventId)

    if (!event) {
      return
    }

    event.outcome = input.outcome
    event.schoolId = input.schoolId ?? event.schoolId
    event.paymentId = input.paymentId ?? event.paymentId
    event.processedAt = new Date()
  }

  async listAuditHistory(filter: {
    schoolId?: string
    invoiceId?: string
    paymentId?: string
  }): Promise<BillingAuditRecord[]> {
    return this.audits
      .filter(
        (entry) =>
          (!filter.schoolId || entry.schoolId === filter.schoolId) &&
          (!filter.invoiceId || entry.invoiceId === filter.invoiceId) &&
          (!filter.paymentId || entry.paymentId === filter.paymentId),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((entry) => clone(entry))
  }
}
