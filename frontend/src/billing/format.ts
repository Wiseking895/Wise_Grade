import type {
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
} from './types'

const moneyFormatterCache = new Map<string, Intl.NumberFormat>()

function moneyFormatter(currency: string): Intl.NumberFormat {
  const key = currency.toUpperCase()
  const existing = moneyFormatterCache.get(key)

  if (existing) return existing

  const formatter = new Intl.NumberFormat('en-GH', {
    style: 'currency',
    currency: key,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  moneyFormatterCache.set(key, formatter)
  return formatter
}

/** Formats an integer amount of minor units (pesewas) for display. */
export function formatMoneyMinor(
  amountMinor: number,
  currency = 'GHS',
): string {
  return moneyFormatter(currency).format(amountMinor / 100)
}

/** Converts a user-entered major-unit amount into integer minor units. */
export function toMinorUnits(value: string): number | null {
  const trimmed = value.trim()

  if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) {
    return null
  }

  const [whole, fraction = ''] = trimmed.split('.')
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
}

export function minorToMajorInput(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2)
}

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: 'Draft',
  ISSUED: 'Issued',
  PARTIALLY_PAID: 'Partially paid',
  PAID: 'Paid',
  CANCELLED: 'Cancelled',
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING: 'Pending',
  UNDER_REVIEW: 'Under review',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  MOBILE_MONEY: 'Mobile money',
  BANK_TRANSFER: 'Bank transfer',
  CARD: 'Card',
  CASH: 'Cash',
  OTHER: 'Other',
}

export function invoiceStatusTone(
  status: InvoiceStatus,
): 'neutral' | 'success' | 'warning' | 'info' {
  switch (status) {
    case 'PAID':
      return 'success'
    case 'PARTIALLY_PAID':
      return 'warning'
    case 'ISSUED':
      return 'info'
    case 'CANCELLED':
      return 'neutral'
    default:
      return 'neutral'
  }
}

export function paymentStatusTone(
  status: PaymentStatus,
): 'neutral' | 'success' | 'warning' | 'info' {
  switch (status) {
    case 'VERIFIED':
      return 'success'
    case 'PENDING':
    case 'UNDER_REVIEW':
      return 'warning'
    case 'REJECTED':
    case 'FAILED':
      return 'neutral'
    default:
      return 'neutral'
  }
}

export function isPayableInvoice(status: InvoiceStatus): boolean {
  return status === 'ISSUED' || status === 'PARTIALLY_PAID'
}
