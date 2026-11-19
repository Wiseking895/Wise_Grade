import type {
  EligibilityFailure,
  ReportReleaseBatchSummary,
  ReportReleaseStatus,
} from './types'

/**
 * Eligibility is decided by the backend. This helper only explains why the
 * submit button is unavailable; the API remains the source of truth.
 */
export function schoolCanSubmit(
  status: ReportReleaseStatus,
  eligible: boolean,
): boolean {
  return eligible && (status === 'GENERATED' || status === 'RETURNED')
}

export function isResubmission(status: ReportReleaseStatus): boolean {
  return status === 'RETURNED'
}

/**
 * A report is only readable by the school after the platform generate action
 * has produced and released it. There is no separate developer approval step.
 */
export function releaseAllowsPreview(
  status: ReportReleaseStatus | null | undefined,
): boolean {
  return status === 'RELEASED'
}

export function releaseReasonError(reason: string): string | null {
  const trimmed = reason.trim()

  if (trimmed.length < 3) {
    return 'Enter a reason of at least 3 characters.'
  }

  if (trimmed.length > 1000) {
    return 'Keep the reason to 1000 characters or fewer.'
  }

  return null
}

export function eligibilityMessages(
  issues: EligibilityFailure[],
): string[] {
  return issues.map((issue) => issue.message)
}

export interface ReleaseCounts {
  total: number
  generated: number
  pendingReview: number
  returned: number
  approvedUnreleased: number
  released: number
  onHold: number
}

export function countReleaseBatches(
  batches: ReportReleaseBatchSummary[],
): ReleaseCounts {
  const counts: ReleaseCounts = {
    total: batches.length,
    generated: 0,
    pendingReview: 0,
    returned: 0,
    approvedUnreleased: 0,
    released: 0,
    onHold: 0,
  }

  for (const batch of batches) {
    switch (batch.releaseStatus) {
      case 'GENERATED':
        counts.generated += 1
        break
      case 'PENDING_PLATFORM_REVIEW':
        counts.pendingReview += 1
        break
      case 'RETURNED':
        counts.returned += 1
        break
      case 'APPROVED':
        counts.approvedUnreleased += 1
        break
      case 'RELEASED':
        counts.released += 1
        break
      case 'ON_HOLD':
        counts.onHold += 1
        break
    }
  }

  return counts
}
