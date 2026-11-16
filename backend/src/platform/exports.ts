import type { PlatformOperationsRepository } from './operations-repository.js'
import type {
  ExportDatasetDefinition,
  ExportDatasetId,
} from './operations-types.js'

export const EXPORT_DATASETS: ExportDatasetDefinition[] = [
  {
    id: 'schools',
    label: 'Schools',
    description:
      'Tenant directory with status, timezone and aggregate pupil and member counts.',
    columns: [
      'id',
      'name',
      'slug',
      'email',
      'phone',
      'timezone',
      'status',
      'pupils',
      'members',
      'createdAt',
    ],
  },
  {
    id: 'payments',
    label: 'Payments',
    description:
      'Payment submission and settlement records. Evidence files, payer phone numbers and secrets are excluded.',
    columns: [
      'id',
      'school',
      'invoiceNumber',
      'status',
      'source',
      'method',
      'amountMinor',
      'appliedMinor',
      'overpaymentMinor',
      'currency',
      'paymentReference',
      'providerReference',
      'submittedAt',
      'verifiedAt',
      'reconciledAt',
    ],
  },
  {
    id: 'invoices',
    label: 'Invoices',
    description:
      'Per-term invoices with the historical unit price, billable population and totals.',
    columns: [
      'invoiceNumber',
      'school',
      'academicYear',
      'academicTerm',
      'status',
      'currency',
      'unitAmountMinor',
      'billablePupils',
      'totalMinor',
      'paidMinor',
      'outstandingMinor',
      'issueDate',
      'dueDate',
      'createdAt',
    ],
  },
  {
    id: 'audit',
    label: 'Audit trail',
    description:
      'Append-only operational audit events. IP addresses and user agents are excluded.',
    columns: [
      'createdAt',
      'action',
      'entityType',
      'entityId',
      'actorEmail',
      'school',
      'metadata',
    ],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    description:
      'Platform notification inbox history with read state and school reference.',
    columns: [
      'createdAt',
      'type',
      'severity',
      'title',
      'body',
      'school',
      'read',
    ],
  },
]

export function isExportDataset(value: string): value is ExportDatasetId {
  return EXPORT_DATASETS.some((dataset) => dataset.id === value)
}

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }

  const raw = typeof value === 'object' ? JSON.stringify(value) : String(value)

  // Neutralize spreadsheet formula injection while preserving readability.
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw

  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`
  }

  return safe
}

export function toCsv(
  columns: string[],
  rows: Array<Record<string, unknown>>,
): string {
  const lines = [columns.map(escapeCell).join(',')]

  for (const row of rows) {
    lines.push(columns.map((column) => escapeCell(row[column])).join(','))
  }

  return `${lines.join('\r\n')}\r\n`
}

export function exportFileName(dataset: ExportDatasetId, now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  return `wise-grade-${dataset}-${stamp}.csv`
}

export async function buildExport(
  operations: PlatformOperationsRepository,
  dataset: ExportDatasetId,
): Promise<{ csv: string; fileName: string; rowCount: number; truncated: boolean }> {
  const definition = EXPORT_DATASETS.find((item) => item.id === dataset)

  if (!definition) {
    throw new Error(`Unknown export dataset: ${dataset}`)
  }

  const result = await operations.exportDataset(dataset)
  const csv = toCsv(definition.columns, result.rows)

  return {
    csv,
    fileName: exportFileName(dataset),
    rowCount: result.rows.length,
    truncated: result.truncated,
  }
}
