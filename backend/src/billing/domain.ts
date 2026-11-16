import { createHash } from 'node:crypto'
import type {
  BillablePupilRecord,
  InvoiceStatus,
  PricingRuleRecord,
} from './repository.js'

export function dateOnly(value: Date | string): string {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10)
}

export function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

export function todayUtc(): Date {
  return parseDateOnly(new Date().toISOString().slice(0, 10))
}

export function addUtcDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000)
}

export function invoiceNumberFor(input: {
  schoolId: string
  academicYearId: string
  academicTermId: string
  academicYearName: string
  termSequence: number
}): string {
  const year =
    input.academicYearName.match(/\d{4}/)?.[0] ??
    String(new Date().getUTCFullYear())
  const school = input.schoolId.replace(/-/g, '').slice(0, 8).toUpperCase()
  const scope = createHash('sha1')
    .update(`${input.academicYearId}:${input.academicTermId}`)
    .digest('hex')
    .slice(0, 6)
    .toUpperCase()

  return `INV-${year}-T${input.termSequence}-${school}-${scope}`
}

export function invoiceStatusFor(totalMinor: number, paidMinor: number): InvoiceStatus {
  if (paidMinor <= 0) {
    return 'ISSUED'
  }

  return paidMinor >= totalMinor ? 'PAID' : 'PARTIALLY_PAID'
}

export interface InvoiceMoney {
  totalMinor: number
  paidMinor: number
  outstandingMinor: number
  status: InvoiceStatus
}

export interface PaymentApplication {
  appliedMinor: number
  overpaymentMinor: number
  paidMinor: number
  outstandingMinor: number
  status: InvoiceStatus
}

/**
 * Overpayment policy: the invoice is never credited above its total. The full
 * submitted amount stays on the payment record; the portion beyond the amount
 * outstanding is retained as `overpaymentMinor` for an explicit credit/refund
 * decision rather than being silently lost.
 */
export function applyPaymentToInvoice(
  invoice: InvoiceMoney,
  amountMinor: number,
): PaymentApplication {
  if (amountMinor <= 0) {
    throw new Error('Payment amount must be greater than zero')
  }

  if (invoice.status === 'DRAFT') {
    throw new Error('A draft invoice cannot receive payments')
  }

  if (invoice.status === 'CANCELLED') {
    throw new Error('A cancelled invoice cannot receive payments')
  }

  if (invoice.status === 'PAID' || invoice.outstandingMinor <= 0) {
    throw new Error('The invoice has no outstanding balance')
  }

  const appliedMinor = Math.min(amountMinor, invoice.outstandingMinor)
  const paidMinor = invoice.paidMinor + appliedMinor
  const outstandingMinor = invoice.totalMinor - paidMinor

  return {
    appliedMinor,
    overpaymentMinor: amountMinor - appliedMinor,
    paidMinor,
    outstandingMinor,
    status: invoiceStatusFor(invoice.totalMinor, paidMinor),
  }
}

export function assertInvoiceTransition(
  from: InvoiceStatus,
  to: InvoiceStatus,
  paidMinor: number,
): void {
  if (from === 'DRAFT' && (to === 'ISSUED' || to === 'CANCELLED')) {
    return
  }

  if (from === 'ISSUED' && to === 'CANCELLED' && paidMinor === 0) {
    return
  }

  throw new Error(`Invoice transition ${from} → ${to} is not allowed`)
}

export interface InvoiceSnapshotInput {
  invoiceNumber: string
  school: { id: string; name: string }
  academicYear: { id: string; name: string }
  academicTerm: { id: string; name: string; sequence: number }
  pricingRule: PricingRuleRecord
  billablePupils: BillablePupilRecord[]
  adjustmentMinor: number
  adjustmentReason: string | null
  issueDate: string
  dueDate: string | null
}

export function buildInvoiceSnapshot(input: InvoiceSnapshotInput): unknown {
  const count = input.billablePupils.length
  const subtotalMinor = input.pricingRule.amountMinor * count
  const totalMinor = subtotalMinor + input.adjustmentMinor

  return {
    schemaVersion: 1,
    invoiceNumber: input.invoiceNumber,
    capturedAt: new Date().toISOString(),
    school: input.school,
    academicYear: input.academicYear,
    academicTerm: input.academicTerm,
    price: {
      pricingRuleId: input.pricingRule.id,
      version: input.pricingRule.version,
      currency: input.pricingRule.currency,
      amountMinor: input.pricingRule.amountMinor,
      effectiveFrom: dateOnly(input.pricingRule.effectiveFrom),
      effectiveTo: input.pricingRule.effectiveTo
        ? dateOnly(input.pricingRule.effectiveTo)
        : null,
    },
    billablePopulation: {
      count,
      pupils: input.billablePupils.map((pupil) => ({
        pupilId: pupil.pupilId,
        reportCardId: pupil.reportCardId,
        reportVersion: pupil.reportVersion,
        pupilName: pupil.pupilName,
        admissionNumber: pupil.admissionNumber,
        classId: pupil.classId,
        className: pupil.className,
      })),
    },
    calculation: {
      unitAmountMinor: input.pricingRule.amountMinor,
      billablePupilCount: count,
      subtotalMinor,
      adjustmentMinor: input.adjustmentMinor,
      adjustmentReason: input.adjustmentReason,
      totalMinor,
      formula: 'subtotal = perPupilPrice × uniqueEligiblePupils; total = subtotal + adjustment',
    },
    dates: {
      issueDate: input.issueDate,
      dueDate: input.dueDate,
    },
    releaseBoundary:
      'Billing verification does not release report cards. Phase 6B remains the separate approval and release workflow.',
  }
}
