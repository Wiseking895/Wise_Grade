import { z } from 'zod'

const uuid = z.string().uuid('Enter a valid identifier')

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in YYYY-MM-DD format')

const optionalDateOnly = z.union([dateOnly, z.null()]).optional()

const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Use a three-letter ISO currency code')

const moneyMinor = z
  .number()
  .int('Amounts must be whole minor units')
  .min(0, 'Amount cannot be negative')
  .max(1_000_000_000, 'Amount is too large')

const positiveMoneyMinor = moneyMinor.min(1, 'Amount must be greater than zero')

const reference = z
  .string()
  .trim()
  .min(3, 'Reference must be at least 3 characters')
  .max(120, 'Reference must be 120 characters or fewer')

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer`)
    .optional()
    .nullable()
    .transform((value) => (value === undefined || value === '' ? null : value))

const evidenceSchema = z
  .object({
    mimeType: z.enum(['image/png', 'image/jpeg', 'application/pdf']),
    originalName: z
      .string()
      .trim()
      .min(1, 'A file name is required')
      .max(255, 'File name is too long'),
    base64: z
      .string()
      .min(1, 'Evidence data is required')
      .max(3_000_000, 'Evidence file is too large'),
  })
  .strict()

export const pricingRuleSchema = z
  .object({
    currency: currency.default('GHS'),
    amountMinor: positiveMoneyMinor,
    effectiveFrom: dateOnly,
  })
  .strict()

export const pricingRuleStatusSchema = z
  .object({ isActive: z.boolean() })
  .strict()

export const createInvoiceSchema = z
  .object({
    schoolId: uuid,
    academicYearId: uuid,
    academicTermId: uuid,
    currency: currency.optional(),
    issueDate: optionalDateOnly,
    dueDate: optionalDateOnly,
    adjustmentMinor: z
      .number()
      .int('Adjustments must be whole minor units')
      .min(-1_000_000_000)
      .max(1_000_000_000)
      .optional(),
    adjustmentReason: optionalText(400),
  })
  .strict()

export const platformInvoiceQuerySchema = z
  .object({
    status: z
      .enum(['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'])
      .optional(),
    schoolId: uuid.optional(),
  })
  .strict()

export const manualPaymentSchema = z
  .object({
    amountMinor: positiveMoneyMinor,
    currency,
    method: z.enum(['MOBILE_MONEY', 'BANK_TRANSFER', 'CASH', 'OTHER']),
    paymentReference: reference,
    paidAt: dateOnly,
    payerName: optionalText(160),
    notes: optionalText(1000),
    // Manual payments must carry private evidence for platform verification.
    evidence: evidenceSchema,
  })
  .strict()

export const onlinePaymentSchema = z
  .object({
    idempotencyKey: z
      .string()
      .trim()
      .min(8, 'Idempotency key is too short')
      .max(120, 'Idempotency key is too long'),
    method: z.enum(['MOBILE_MONEY', 'CARD']).default('MOBILE_MONEY'),
  })
  .strict()

export const paymentDecisionSchema = z
  .object({
    decision: z.enum(['VERIFIED', 'REJECTED']),
    reason: optionalText(1000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.decision === 'REJECTED' && !value.reason) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'A rejection reason is required',
      })
    }
  })

export const schoolPaymentQuerySchema = z
  .object({
    invoiceId: uuid.optional(),
  })
  .strict()

export const platformPaymentQuerySchema = z
  .object({
    invoiceId: uuid.optional(),
  })
  .strict()

export const billingAuditQuerySchema = z
  .object({
    schoolId: uuid.optional(),
    invoiceId: uuid.optional(),
    paymentId: uuid.optional(),
  })
  .strict()

export const invoiceIdParamSchema = z.object({ invoiceId: uuid })
export const paymentIdParamSchema = z.object({ paymentId: uuid })
export const evidenceIdParamSchema = z.object({
  paymentId: uuid,
  evidenceId: uuid,
})
