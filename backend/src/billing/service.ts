import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { HttpError } from '../errors/http-error.js'
import type { StorageAdapter } from '../storage/storage.js'
import { sha256 } from '../storage/storage.js'
import {
  applyPaymentToInvoice,
  dateOnly,
  invoiceNumberFor,
  parseDateOnly,
  todayUtc,
} from './domain.js'
import type {
  BillingAuditContext,
  BillingRepository,
  CreateInvoiceResult,
  CreatePricingRuleInput,
  ManualPaymentInput,
  PaymentDetail,
  PaymentVerificationResult,
  PlatformBillingActor,
  SchoolBillingActor,
  VerifyManualPaymentInput,
} from './repository.js'
import type { PaymentProvider, ProviderWebhookEvent } from './provider.js'

const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024

function hasMagic(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === 'image/png') {
    return buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  }

  if (mimeType === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  }

  if (mimeType === 'application/pdf') {
    return buffer.subarray(0, 5).toString('ascii') === '%PDF-'
  }

  return false
}

function safeOriginalName(name: string): string {
  const base = basename(name).replace(/[^A-Za-z0-9._-]/g, '_')
  return base.slice(0, 200) || 'payment-evidence'
}

function redactPayment<T extends PaymentDetail>(payment: T): T {
  return {
    ...payment,
    evidence: payment.evidence.map((item) => ({
      ...item,
      storageKey: '[private]',
    })),
  }
}

export interface BillingServiceOptions {
  repository: BillingRepository
  storage: StorageAdapter
  provider: PaymentProvider | null
}

export interface InvoiceWebhookResult {
  status: 'processed' | 'duplicate' | 'ignored'
  paymentId?: string
  invoiceId?: string
}

/**
 * Billing orchestration. Payment verification only changes billing state; it
 * never calls report generation, approval, release, or public-link code.
 */
export class BillingService {
  constructor(private readonly options: BillingServiceOptions) {}

  get onlinePaymentsEnabled(): boolean {
    return this.options.provider !== null
  }

  get providerName(): string | null {
    return this.options.provider?.name ?? null
  }

  async listBillingSchools() {
    return this.options.repository.listBillingSchools()
  }

  async listPricingRules() {
    return this.options.repository.listPricingRules()
  }

  async createPricingRule(
    actor: PlatformBillingActor,
    input: CreatePricingRuleInput,
    audit: BillingAuditContext,
  ) {
    const effectiveFrom = parseDateOnly(input.effectiveFrom)

    if (Number.isNaN(effectiveFrom.getTime())) {
      throw new HttpError(400, 'Effective date is invalid')
    }

    return this.options.repository.createPricingRule(actor, input, audit)
  }

  async setPricingRuleActive(
    actor: PlatformBillingActor,
    ruleId: string,
    isActive: boolean,
    audit: BillingAuditContext,
  ) {
    return this.options.repository.setPricingRuleActive(
      actor,
      ruleId,
      isActive,
      audit,
    )
  }

  async listSchoolInvoices(actor: SchoolBillingActor) {
    return this.options.repository.listSchoolInvoices(actor)
  }

  async getSchoolInvoice(actor: SchoolBillingActor, invoiceId: string) {
    this.assertSchoolAdmin(actor)
    const detail = await this.options.repository.getSchoolInvoice(actor, invoiceId)

    if (!detail) {
      throw new HttpError(404, 'Invoice not found')
    }

    return detail
  }

  async listSchoolPayments(
    actor: SchoolBillingActor,
    filter: { invoiceId?: string },
  ) {
    return this.options.repository.listPayments(actor, filter)
  }

  async listPlatformInvoices() {
    return this.options.repository.listPlatformInvoices()
  }

  async getPlatformInvoice(invoiceId: string) {
    const detail = await this.options.repository.getPlatformInvoice(invoiceId)

    if (!detail) {
      throw new HttpError(404, 'Invoice not found')
    }

    return detail
  }

  async createInvoice(
    actor: PlatformBillingActor,
    input: {
      schoolId: string
      academicYearId: string
      academicTermId: string
      currency?: string
      issueDate?: string | null
      dueDate?: string | null
      adjustmentMinor?: number
      adjustmentReason?: string | null
    },
    audit: BillingAuditContext,
  ): Promise<CreateInvoiceResult> {
    const adjustmentMinor = input.adjustmentMinor ?? 0

    if (adjustmentMinor !== 0 && !input.adjustmentReason?.trim()) {
      throw new HttpError(
        400,
        'An adjustment reason is required when an invoice adjustment is applied',
      )
    }

    if (input.issueDate && input.dueDate && input.dueDate < input.issueDate) {
      throw new HttpError(400, 'Due date cannot be before the issue date')
    }

    const result = await this.options.repository.createOrRefreshDraftInvoice(
      actor,
      {
        ...input,
        currency: input.currency ?? 'GHS',
        adjustmentMinor,
        adjustmentReason: input.adjustmentReason ?? null,
      },
      audit,
    )

    if (result.detail.invoice.totalMinor <= 0) {
      throw new HttpError(
        400,
        'The invoice total must be greater than zero after adjustments',
      )
    }

    return result
  }

  async issueInvoice(
    actor: PlatformBillingActor,
    invoiceId: string,
    audit: BillingAuditContext,
  ) {
    return this.options.repository.issueInvoice(actor, invoiceId, audit)
  }

  async cancelInvoice(
    actor: PlatformBillingActor,
    invoiceId: string,
    audit: BillingAuditContext,
  ) {
    return this.options.repository.cancelInvoice(actor, invoiceId, audit)
  }

  async initiateOnlinePayment(
    actor: SchoolBillingActor,
    invoiceId: string,
    input: { idempotencyKey: string; method: 'MOBILE_MONEY' | 'CARD' },
    audit: BillingAuditContext,
  ) {
    this.assertSchoolAdmin(actor)
    const provider = this.options.provider

    if (!provider) {
      throw new HttpError(
        503,
        'Online payments are not configured. Use the manual payment workflow or ask the platform administrator to configure a provider.',
      )
    }

    const detail = await this.options.repository.getSchoolInvoice(actor, invoiceId)

    if (!detail) {
      throw new HttpError(404, 'Invoice not found')
    }

    const invoice = detail.invoice

    if (invoice.status !== 'ISSUED' && invoice.status !== 'PARTIALLY_PAID') {
      throw new HttpError(409, 'This invoice cannot receive an online payment')
    }

    if (invoice.outstandingMinor <= 0) {
      throw new HttpError(409, 'This invoice has no outstanding balance')
    }

    const existing = await this.options.repository.findPaymentByIdempotencyKey(
      actor.schoolId,
      input.idempotencyKey,
    )

    if (existing) {
      if (existing.invoiceId !== invoice.id) {
        throw new HttpError(
          409,
          'The idempotency key is already attached to another invoice',
        )
      }

      if (existing.status === 'VERIFIED') {
        throw new HttpError(409, 'This payment has already been verified')
      }

      if (existing.status === 'FAILED' || existing.status === 'CANCELLED') {
        throw new HttpError(409, 'This payment attempt is no longer active')
      }

      const checkout = await provider.createCheckout({
        paymentId: existing.id,
        paymentReference: existing.paymentReference,
        invoiceNumber: invoice.invoiceNumber,
        schoolId: actor.schoolId,
        amountMinor: existing.amountMinor,
        currency: existing.currency,
        description: `Wise Grade invoice ${invoice.invoiceNumber}`,
      })

      return { payment: existing, checkout, reused: true }
    }

    // The amount is always derived server-side; the client cannot submit it.
    const amountMinor = invoice.outstandingMinor
    const paymentId = randomUUID()
    const paymentReference = `GRD-${dateOnly(todayUtc()).replace(/-/g, '')}-${paymentId
      .replace(/-/g, '')
      .slice(0, 12)
      .toUpperCase()}`

    const checkout = await provider.createCheckout({
      paymentId,
      paymentReference,
      invoiceNumber: invoice.invoiceNumber,
      schoolId: actor.schoolId,
      amountMinor,
      currency: invoice.currency,
      description: `Wise Grade invoice ${invoice.invoiceNumber}`,
    })

    const payment = await this.options.repository.createOnlinePayment(
      actor,
      {
        paymentId,
        invoiceId: invoice.id,
        amountMinor,
        currency: invoice.currency,
        method: input.method,
        paymentReference,
        provider: provider.name,
        providerReference: checkout.providerReference,
        idempotencyKey: input.idempotencyKey,
        paidAt: dateOnly(todayUtc()),
      },
      audit,
    )

    return { payment, checkout, reused: false }
  }

  async submitManualPayment(
    actor: SchoolBillingActor,
    invoiceId: string,
    input: {
      amountMinor: number
      currency: string
      method: 'MOBILE_MONEY' | 'BANK_TRANSFER' | 'CASH' | 'OTHER'
      paymentReference: string
      paidAt: string
      payerName?: string | null
      notes?: string | null
      evidence?: {
        mimeType: 'image/png' | 'image/jpeg' | 'application/pdf'
        originalName: string
        base64: string
      }
    },
    audit: BillingAuditContext,
  ): Promise<PaymentDetail> {
    this.assertSchoolAdmin(actor)
    const detail = await this.options.repository.getSchoolInvoice(actor, invoiceId)

    if (!detail) {
      throw new HttpError(404, 'Invoice not found')
    }

    const invoice = detail.invoice

    if (invoice.status !== 'ISSUED' && invoice.status !== 'PARTIALLY_PAID') {
      throw new HttpError(409, 'This invoice cannot receive a manual payment')
    }

    if (input.currency !== invoice.currency) {
      throw new HttpError(
        400,
        `Payment currency must match the invoice currency (${invoice.currency})`,
      )
    }

    if (input.paidAt > dateOnly(todayUtc())) {
      throw new HttpError(400, 'Payment date cannot be in the future')
    }

    const paymentId = randomUUID()
    let evidence: ManualPaymentInput['evidence'] = null
    let storageKey: string | null = null

    if (input.evidence) {
      let buffer: Buffer

      try {
        buffer = Buffer.from(input.evidence.base64, 'base64')
      } catch {
        throw new HttpError(400, 'Payment evidence is not valid base64 data')
      }

      if (buffer.length === 0 || buffer.length > MAX_EVIDENCE_BYTES) {
        throw new HttpError(
          400,
          'Payment evidence must be between 1 byte and 2 MB',
        )
      }

      if (!hasMagic(buffer, input.evidence.mimeType)) {
        throw new HttpError(
          400,
          'Payment evidence content does not match its declared file type',
        )
      }

      const originalName = safeOriginalName(input.evidence.originalName)
      storageKey = `billing/evidence/${actor.schoolId}/${paymentId}/${randomUUID()}-${originalName}`

      try {
        const stored = await this.options.storage.putObject(
          storageKey,
          buffer,
          input.evidence.mimeType,
        )
        evidence = {
          storageKey: stored.key,
          mimeType: input.evidence.mimeType,
          byteSize: stored.byteSize,
          checksum: stored.checksum ?? sha256(buffer),
          originalName,
        }
      } catch {
        throw new HttpError(
          503,
          'Private payment evidence storage is not available',
        )
      }
    }

    const inputRecord: ManualPaymentInput = {
      paymentId,
      invoiceId: invoice.id,
      amountMinor: input.amountMinor,
      currency: input.currency,
      method: input.method,
      paymentReference: input.paymentReference,
      paidAt: input.paidAt,
      payerName: input.payerName ?? null,
      notes: input.notes ?? null,
      evidence,
    }

    try {
      return redactPayment(
        await this.options.repository.createManualPayment(
          actor,
          inputRecord,
          audit,
        ),
      )
    } catch (error) {
      if (storageKey) {
        await this.options.storage.deleteObject(storageKey).catch(() => undefined)
      }

      throw error
    }
  }

  async getSchoolPayment(
    actor: SchoolBillingActor,
    paymentId: string,
  ): Promise<PaymentDetail> {
    const detail = await this.options.repository.getPaymentForSchool(
      actor,
      paymentId,
    )

    if (!detail) {
      throw new HttpError(404, 'Payment not found')
    }

    return redactPayment(detail)
  }

  async listPendingPayments() {
    const payments = await this.options.repository.listPendingPayments({
      userId: 'platform',
    })

    return payments.map(redactPayment)
  }

  async listVerifiedPayments() {
    const payments = await this.options.repository.listVerifiedPayments({
      userId: 'platform',
    })

    return payments.map(redactPayment)
  }

  async getPlatformPayment(paymentId: string): Promise<PaymentDetail> {
    const detail = await this.options.repository.getPaymentForPlatform(
      { userId: 'platform' },
      paymentId,
    )

    if (!detail) {
      throw new HttpError(404, 'Payment not found')
    }

    return redactPayment(detail)
  }

  async verifyPayment(
    actor: PlatformBillingActor,
    paymentId: string,
    input: VerifyManualPaymentInput,
    audit: BillingAuditContext,
  ): Promise<PaymentVerificationResult> {
    if (input.decision === 'REJECTED' && !input.reason?.trim()) {
      throw new HttpError(400, 'A rejection reason is required')
    }

    const existing = await this.options.repository.getPaymentForPlatform(
      actor,
      paymentId,
    )

    if (!existing) {
      throw new HttpError(404, 'Payment not found')
    }

    if (existing.initiatedByUserId === actor.userId) {
      throw new HttpError(403, 'A payment cannot be verified by its submitter')
    }

    return this.options.repository.verifyManualPayment(
      actor,
      paymentId,
      input,
      audit,
    )
  }

  async getEvidence(
    scope: { schoolId: string } | { platform: true },
    paymentId: string,
    evidenceId: string,
  ) {
    const detail =
      'platform' in scope
        ? await this.options.repository.getPaymentForPlatform(
            { userId: 'platform' },
            paymentId,
          )
        : await this.options.repository.getPaymentForSchool(
            {
              schoolId: scope.schoolId,
              userId: '',
              membershipId: '',
              role: 'SCHOOL_ADMIN',
            },
            paymentId,
          )

    if (!detail) {
      throw new HttpError(404, 'Payment not found')
    }

    const evidence = detail.evidence.find((item) => item.id === evidenceId)

    if (!evidence) {
      throw new HttpError(404, 'Payment evidence not found')
    }

    const data = await this.options.storage.getObject(evidence.storageKey)

    if (!data) {
      throw new HttpError(404, 'Payment evidence file is unavailable')
    }

    return {
      data,
      mimeType: evidence.mimeType,
      fileName: evidence.originalName,
      checksum: evidence.checksum,
    }
  }

  async listAuditHistory(filter: {
    schoolId?: string
    invoiceId?: string
    paymentId?: string
  }) {
    return this.options.repository.listAuditHistory(filter)
  }

  async handleProviderWebhook(
    providerName: string,
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<InvoiceWebhookResult> {
    const provider = this.options.provider

    if (!provider || provider.name !== providerName) {
      throw new HttpError(404, 'Unknown payment provider')
    }

    const event = await provider.verifyWebhook({ rawBody, headers })
    const eventRow = await this.options.repository.beginProviderEvent({
      provider: provider.name,
      providerEventId: event.eventId,
      eventType: event.type,
      providerReference: event.providerReference,
      payload: event.rawPayload,
      signatureValid: true,
      outcome: 'RECEIVED',
    })

    if (!eventRow) {
      return { status: 'duplicate' }
    }

    try {
      const result = await this.processProviderEvent(event)
      await this.options.repository.completeProviderEvent(eventRow.id, {
        outcome: result.status,
        paymentId: result.paymentId ?? null,
      })

      return result
    } catch (error) {
      await this.options.repository
        .completeProviderEvent(eventRow.id, { outcome: 'REJECTED' })
        .catch(() => undefined)
      throw error
    }
  }

  private async processProviderEvent(
    event: ProviderWebhookEvent,
  ): Promise<InvoiceWebhookResult> {
    const payment = await this.options.repository.findPaymentByProviderReference(
      event.providerReference,
    )

    if (!payment) {
      return { status: 'ignored' }
    }

    if (payment.provider !== this.options.provider?.name) {
      throw new HttpError(400, 'Provider reference belongs to another provider')
    }

    if (event.amountMinor !== null && event.amountMinor !== payment.amountMinor) {
      throw new HttpError(400, 'Webhook amount does not match the payment')
    }

    if (event.currency !== null && event.currency !== payment.currency) {
      throw new HttpError(400, 'Webhook currency does not match the payment')
    }

    if (event.schoolId !== null && event.schoolId !== payment.schoolId) {
      throw new HttpError(400, 'Webhook school does not match the payment')
    }

    if (payment.status === 'VERIFIED') {
      return { status: 'duplicate', paymentId: payment.id, invoiceId: payment.invoiceId }
    }

    if (payment.status !== 'PENDING' && payment.status !== 'UNDER_REVIEW') {
      return { status: 'ignored', paymentId: payment.id, invoiceId: payment.invoiceId }
    }

    if (event.type === 'PAYMENT_FAILED') {
      await this.options.repository.failPayment(
        payment.id,
        'Provider reported the payment as failed',
        {
          actorUserId: null,
          ipAddress: null,
          userAgent: 'provider-webhook',
        },
      )

      return {
        status: 'processed',
        paymentId: payment.id,
        invoiceId: payment.invoiceId,
      }
    }

    if (event.type !== 'PAYMENT_SUCCEEDED') {
      return {
        status: 'ignored',
        paymentId: payment.id,
        invoiceId: payment.invoiceId,
      }
    }

    const result = await this.options.repository.applyOnlinePayment(
      payment.id,
      {
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        providerReference: event.providerReference,
      },
      {
        actorUserId: null,
        ipAddress: null,
        userAgent: 'provider-webhook',
      },
    )

    return {
      status: 'processed',
      paymentId: result.payment.id,
      invoiceId: result.invoice.id,
    }
  }

  private assertSchoolAdmin(actor: SchoolBillingActor): void {
    if (actor.role !== 'SCHOOL_ADMIN') {
      throw new HttpError(
        403,
        'Only school administrators can manage billing and payments',
      )
    }
  }
}

export function calculatePreview(input: {
  unitAmountMinor: number
  billablePupilCount: number
  adjustmentMinor: number
}) {
  const subtotalMinor = input.unitAmountMinor * input.billablePupilCount
  const totalMinor = subtotalMinor + input.adjustmentMinor

  if (totalMinor < 0) {
    throw new HttpError(400, 'Invoice total cannot be negative')
  }

  return { subtotalMinor, totalMinor }
}

export { applyPaymentToInvoice, invoiceNumberFor }
