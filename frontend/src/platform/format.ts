/** Formats an integer minor-unit amount as currency for platform views. */
export function formatMoney(minor: number, currency = 'GHS'): string {
  return new Intl.NumberFormat('en-GH', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(minor / 100)
}
