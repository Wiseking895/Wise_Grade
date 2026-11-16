import { describe, expect, it } from 'vitest'
import {
  addUtcDays,
  applyPaymentToInvoice,
  assertInvoiceTransition,
  buildInvoiceSnapshot,
  invoiceNumberFor,
  invoiceStatusFor,
  parseDateOnly,
} from '../src/billing/domain.js'
import { calculatePreview } from '../src/billing/service.js'
import type {
  BillablePupilRecord,
  PricingRuleRecord,
} from '../src/billing/repository.js'

function pricingRule(
  overrides: Partial<PricingRuleRecord> = {},
): PricingRuleRecord {
  return {
    id: 'rule-1',
    currency: 'GHS',
    amountMinor: 500,
    effectiveFrom: parseDateOnly('2026-01-01'),
    effectiveTo: null,
    isActive: true,
    version: 1,
    createdByUserId: 'platform-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

function pupil(index: number): BillablePupilRecord {
  return {
    pupilId: `pupil-${index}`,
    reportCardId: `card-${index}`,
    reportVersion: 1,
    pupilName: `Pupil ${index}`,
    admissionNumber: `ADM-${index}`,
    classId: 'class-1',
    className: 'JHS 1',
  }
}

describe('billing domain: invoice status', () => {
  it('derives status from verified paid amount only', () => {
    expect(invoiceStatusFor(3000, 0)).toBe('ISSUED')
    expect(invoiceStatusFor(3000, 1)).toBe('PARTIALLY_PAID')
    expect(invoiceStatusFor(3000, 2999)).toBe('PARTIALLY_PAID')
    expect(invoiceStatusFor(3000, 3000)).toBe('PAID')
  })

  it('calculates subtotal and total in integer minor units', () => {
    expect(
      calculatePreview({
        unitAmountMinor: 500,
        billablePupilCount: 3,
        adjustmentMinor: -250,
      }),
    ).toEqual({ subtotalMinor: 1500, totalMinor: 1250 })
  })

  it('rejects a negative calculated total', () => {
    expect(() =>
      calculatePreview({
        unitAmountMinor: 500,
        billablePupilCount: 1,
        adjustmentMinor: -600,
      }),
    ).toThrow(/negative/i)
  })
})

describe('billing domain: payment application', () => {
  const base = {
    totalMinor: 3000,
    paidMinor: 0,
    outstandingMinor: 3000,
    status: 'ISSUED' as const,
  }

  it('applies a partial payment and keeps the invoice partially paid', () => {
    expect(applyPaymentToInvoice(base, 1000)).toEqual({
      appliedMinor: 1000,
      overpaymentMinor: 0,
      paidMinor: 1000,
      outstandingMinor: 2000,
      status: 'PARTIALLY_PAID',
    })
  })

  it('only marks an invoice PAID when the full balance is satisfied', () => {
    expect(
      applyPaymentToInvoice(
        { ...base, paidMinor: 2000, outstandingMinor: 1000, status: 'PARTIALLY_PAID' },
        1000,
      ),
    ).toEqual({
      appliedMinor: 1000,
      overpaymentMinor: 0,
      paidMinor: 3000,
      outstandingMinor: 0,
      status: 'PAID',
    })
  })

  it('caps applied amount at the outstanding balance and records overpayment', () => {
    expect(applyPaymentToInvoice(base, 4000)).toEqual({
      appliedMinor: 3000,
      overpaymentMinor: 1000,
      paidMinor: 3000,
      outstandingMinor: 0,
      status: 'PAID',
    })
  })

  it('never produces a negative outstanding balance', () => {
    const result = applyPaymentToInvoice(base, 10_000)

    expect(result.outstandingMinor).toBe(0)
    expect(result.paidMinor).toBeLessThanOrEqual(base.totalMinor)
  })

  it('refuses drafts, cancelled invoices and already-satisfied invoices', () => {
    expect(() =>
      applyPaymentToInvoice({ ...base, status: 'DRAFT' }, 100),
    ).toThrow(/draft/i)
    expect(() =>
      applyPaymentToInvoice({ ...base, status: 'CANCELLED' }, 100),
    ).toThrow(/cancelled/i)
    expect(() =>
      applyPaymentToInvoice(
        { ...base, paidMinor: 3000, outstandingMinor: 0, status: 'PAID' },
        100,
      ),
    ).toThrow(/outstanding/i)
  })

  it('rejects non-positive amounts', () => {
    expect(() => applyPaymentToInvoice(base, 0)).toThrow(/greater than zero/i)
    expect(() => applyPaymentToInvoice(base, -5)).toThrow(/greater than zero/i)
  })
})

describe('billing domain: invoice transitions', () => {
  it('allows DRAFT to ISSUED or CANCELLED', () => {
    expect(() => assertInvoiceTransition('DRAFT', 'ISSUED', 0)).not.toThrow()
    expect(() => assertInvoiceTransition('DRAFT', 'CANCELLED', 0)).not.toThrow()
  })

  it('allows cancelling an unpaid issued invoice only', () => {
    expect(() => assertInvoiceTransition('ISSUED', 'CANCELLED', 0)).not.toThrow()
    expect(() => assertInvoiceTransition('ISSUED', 'CANCELLED', 100)).toThrow(
      /not allowed/i,
    )
  })

  it('rejects re-issuing and cancelling paid invoices', () => {
    expect(() => assertInvoiceTransition('ISSUED', 'ISSUED', 0)).toThrow(
      /not allowed/i,
    )
    expect(() => assertInvoiceTransition('PAID', 'CANCELLED', 3000)).toThrow(
      /not allowed/i,
    )
    expect(() =>
      assertInvoiceTransition('PARTIALLY_PAID', 'CANCELLED', 1000),
    ).toThrow(/not allowed/i)
  })
})

describe('billing domain: snapshot and numbering', () => {
  it('freezes the pricing rule, unique pupil population and arithmetic', () => {
    const snapshot = buildInvoiceSnapshot({
      invoiceNumber: 'INV-1',
      school: { id: 'school-1', name: 'Green Valley' },
      academicYear: { id: 'year-1', name: '2026 Academic Year' },
      academicTerm: { id: 'term-1', name: 'Term 1', sequence: 1 },
      pricingRule: pricingRule(),
      billablePupils: [pupil(1), pupil(2), pupil(3)],
      adjustmentMinor: -100,
      adjustmentReason: 'Goodwill credit',
      issueDate: '2026-11-01',
      dueDate: '2026-11-30',
    }) as {
      price: { amountMinor: number; version: number }
      billablePopulation: { count: number; pupils: unknown[] }
      calculation: {
        unitAmountMinor: number
        billablePupilCount: number
        subtotalMinor: number
        adjustmentMinor: number
        totalMinor: number
      }
    }

    expect(snapshot.price).toMatchObject({ amountMinor: 500, version: 1 })
    expect(snapshot.billablePopulation.count).toBe(3)
    expect(snapshot.billablePopulation.pupils).toHaveLength(3)
    expect(snapshot.calculation).toMatchObject({
      unitAmountMinor: 500,
      billablePupilCount: 3,
      subtotalMinor: 1500,
      adjustmentMinor: -100,
      totalMinor: 1400,
    })
  })

  it('creates distinct invoice numbers for different year/term scopes', () => {
    const first = invoiceNumberFor({
      schoolId: '11111111-1111-1111-1111-111111111111',
      academicYearId: 'year-a',
      academicTermId: 'term-a',
      academicYearName: '2026 Academic Year',
      termSequence: 1,
    })
    const second = invoiceNumberFor({
      schoolId: '11111111-1111-1111-1111-111111111111',
      academicYearId: 'year-b',
      academicTermId: 'term-b',
      academicYearName: '2026 Academic Year',
      termSequence: 1,
    })

    expect(first).not.toBe(second)
    expect(first).toMatch(/^INV-2026-T1-/)
  })

  it('uses UTC date-only arithmetic for pricing intervals', () => {
    const start = parseDateOnly('2026-02-01')
    expect(addUtcDays(start, -1).toISOString().slice(0, 10)).toBe('2026-01-31')
  })
})
