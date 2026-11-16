import type {
  ReportAggregatePolicy,
  ReportBatchStatus,
  ReportGenerationScope,
  ReportReleaseStatus,
  ReportTiePolicy,
} from './types'

export const BATCH_STATUS_LABELS: Record<ReportBatchStatus, string> = {
  PENDING: 'Pending',
  RUNNING: 'Running',
  COMPLETED: 'Completed',
  COMPLETED_WITH_FAILURES: 'Completed with failures',
  FAILED: 'Failed',
}

export function batchTone(
  status: ReportBatchStatus,
): 'neutral' | 'success' | 'warning' | 'info' {
  switch (status) {
    case 'COMPLETED':
      return 'success'
    case 'COMPLETED_WITH_FAILURES':
      return 'warning'
    case 'FAILED':
      return 'warning'
    case 'RUNNING':
      return 'info'
    default:
      return 'neutral'
  }
}

export const TIE_POLICY_LABELS: Record<ReportTiePolicy, string> = {
  COMPETITION: 'Competition (1, 2, 2, 4)',
  DENSE: 'Dense (1, 2, 2, 3)',
  ORDINAL: 'Ordinal (1, 2, 3, 4)',
}

export const AGGREGATE_POLICY_LABELS: Record<ReportAggregatePolicy, string> = {
  NONE: 'No aggregate',
  SUM_ALL_SUBJECTS: 'Sum of all subjects',
  BEST_SIX_TOTAL: 'Best six subjects - total',
  BEST_SIX_AVERAGE: 'Best six subjects - average',
}

export const GENERATION_SCOPE_LABELS: Record<ReportGenerationScope, string> = {
  INDIVIDUAL: 'One pupil',
  CLASS: 'Whole class',
  TERM: 'Whole term (all accessible classes)',
}

export const REPORT_CARD_DRAFT_LABEL = 'INTERNAL DRAFT — NOT RELEASED'

export const RELEASE_STATUS_LABELS: Record<ReportReleaseStatus, string> = {
  GENERATED: 'Generated — not submitted',
  PENDING_PLATFORM_REVIEW: 'Pending platform review',
  RETURNED: 'Returned for correction',
  APPROVED: 'Approved — not released',
  RELEASED: 'Released',
  ON_HOLD: 'On hold',
}

export const RELEASE_STATUS_SHORT_LABELS: Record<ReportReleaseStatus, string> = {
  GENERATED: 'Not submitted',
  PENDING_PLATFORM_REVIEW: 'Pending review',
  RETURNED: 'Returned',
  APPROVED: 'Approved',
  RELEASED: 'Released',
  ON_HOLD: 'On hold',
}

export function releaseTone(
  status: ReportReleaseStatus,
): 'neutral' | 'success' | 'warning' | 'info' {
  switch (status) {
    case 'RELEASED':
      return 'success'
    case 'RETURNED':
    case 'ON_HOLD':
      return 'warning'
    case 'PENDING_PLATFORM_REVIEW':
    case 'APPROVED':
      return 'info'
    default:
      return 'neutral'
  }
}

export const RELEASE_STATUS_DESCRIPTIONS: Record<
  ReportReleaseStatus,
  string
> = {
  GENERATED:
    'The batch exists only inside the school. Submit it for platform review when it is eligible.',
  PENDING_PLATFORM_REVIEW:
    'The school has submitted this batch. A platform super administrator must review it.',
  RETURNED:
    'The platform administrator returned this batch for correction. Fix the issue and resubmit.',
  APPROVED:
    'Approved for release but still private. Approval alone does not grant the school access.',
  RELEASED:
    'Released by a platform super administrator. Authorized school users may now open the private PDFs.',
  ON_HOLD:
    'Access is blocked while the platform administrator investigates. The batch must be unheld first.',
}
