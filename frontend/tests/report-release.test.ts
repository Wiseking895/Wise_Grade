import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  countReleaseBatches,
  eligibilityMessages,
  isResubmission,
  platformActionAllowed,
  platformActionsFor,
  releaseAllowsPreview,
  releaseReasonError,
  schoolCanSubmit,
} from '../src/reports/release-logic.ts'
import {
  BATCH_STATUS_LABELS,
  RELEASE_STATUS_DESCRIPTIONS,
  RELEASE_STATUS_LABELS,
  RELEASE_STATUS_SHORT_LABELS,
  batchTone,
  releaseTone,
} from '../src/reports/labels.ts'
import type {
  ReportBatchStatus,
  ReportReleaseBatchSummary,
  ReportReleaseStatus,
} from '../src/reports/types.ts'

const ALL_RELEASE_STATUSES: ReportReleaseStatus[] = [
  'GENERATED',
  'PENDING_PLATFORM_REVIEW',
  'RETURNED',
  'APPROVED',
  'RELEASED',
  'ON_HOLD',
]

function releaseBatch(
  releaseStatus: ReportReleaseStatus,
  overrides: Partial<ReportReleaseBatchSummary> = {},
): ReportReleaseBatchSummary {
  return {
    id: `batch-${releaseStatus}`,
    schoolId: 'school-a',
    schoolName: 'Gradely Academy',
    academicYearId: 'year-a',
    academicYearName: '2026',
    academicTermId: 'term-a',
    academicTermName: 'Term 1',
    classId: 'class-a',
    className: 'Basic 5',
    scope: 'CLASS',
    generationStatus: 'COMPLETED',
    requestedPupilCount: 1,
    generatedCount: 1,
    skippedCount: 0,
    failedCount: 0,
    reportCount: 1,
    fatalError: null,
    failureCodes: [],
    retryableFailureCount: 0,
    releaseStatus,
    previousReleaseStatus: null,
    submittedAt: null,
    submittedByName: null,
    reviewedAt: null,
    reviewedByName: null,
    returnedReason: null,
    holdReason: null,
    heldAt: null,
    heldByName: null,
    releasedAt: null,
    releasedByName: null,
    invoice: null,
    eligibility: { eligible: true, issues: [] },
    createdAt: '2026-11-01T10:00:00.000Z',
    completedAt: '2026-11-01T10:01:00.000Z',
    ...overrides,
  }
}

describe('school release submission helpers', () => {
  it('allows submission only for generated or returned eligible batches', () => {
    assert.equal(schoolCanSubmit('GENERATED', true), true)
    assert.equal(schoolCanSubmit('RETURNED', true), true)

    assert.equal(schoolCanSubmit('GENERATED', false), false)
    assert.equal(schoolCanSubmit('RETURNED', false), false)
    assert.equal(schoolCanSubmit('PENDING_PLATFORM_REVIEW', true), false)
    assert.equal(schoolCanSubmit('APPROVED', true), false)
    assert.equal(schoolCanSubmit('RELEASED', true), false)
    assert.equal(schoolCanSubmit('ON_HOLD', true), false)
  })

  it('treats only a returned batch as a resubmission', () => {
    for (const status of ALL_RELEASE_STATUSES) {
      assert.equal(isResubmission(status), status === 'RETURNED')
    }
  })

  it('explains eligibility failures from the backend', () => {
    assert.deepEqual(
      eligibilityMessages([
        { code: 'INVOICE_NOT_PAID', message: 'The invoice is not fully paid.' },
        { code: 'REPORT_FILE_MISSING', message: 'A PDF is missing.' },
      ]),
      ['The invoice is not fully paid.', 'A PDF is missing.'],
    )
    assert.deepEqual(eligibilityMessages([]), [])
  })
})

describe('platform release actions', () => {
  it('offers separate approve, return, hold and release actions', () => {
    assert.deepEqual(platformActionsFor('PENDING_PLATFORM_REVIEW'), [
      'approve',
      'return',
      'hold',
    ])
    assert.deepEqual(platformActionsFor('APPROVED'), [
      'release',
      'return',
      'hold',
    ])
    assert.deepEqual(platformActionsFor('GENERATED'), ['queue', 'hold'])
    assert.deepEqual(platformActionsFor('RETURNED'), ['hold'])
    assert.deepEqual(platformActionsFor('ON_HOLD'), ['unhold'])
    assert.deepEqual(platformActionsFor('RELEASED'), [])
  })

  it('never allows approval to act as release', () => {
    assert.equal(
      platformActionAllowed('approve', 'PENDING_PLATFORM_REVIEW', true),
      true,
    )
    assert.equal(platformActionAllowed('release', 'PENDING_PLATFORM_REVIEW', true), false)
    assert.equal(platformActionAllowed('release', 'APPROVED', true), true)
    assert.equal(platformActionAllowed('approve', 'APPROVED', true), false)
  })

  it('requires backend eligibility for approve and release only', () => {
    assert.equal(platformActionAllowed('approve', 'PENDING_PLATFORM_REVIEW', false), false)
    assert.equal(platformActionAllowed('release', 'APPROVED', false), false)
    assert.equal(platformActionAllowed('return', 'PENDING_PLATFORM_REVIEW', false), true)
    assert.equal(platformActionAllowed('hold', 'APPROVED', false), true)
  })

  it('allows return only from a pending or approved batch', () => {
    for (const status of ALL_RELEASE_STATUSES) {
      assert.equal(
        platformActionAllowed('return', status, true),
        status === 'PENDING_PLATFORM_REVIEW' || status === 'APPROVED',
      )
    }
  })

  it('allows hold on every state except released and already held', () => {
    for (const status of ALL_RELEASE_STATUSES) {
      assert.equal(
        platformActionAllowed('hold', status, true),
        status !== 'RELEASED' && status !== 'ON_HOLD',
      )
    }
    assert.equal(platformActionAllowed('unhold', 'ON_HOLD', true), true)
    assert.equal(platformActionAllowed('unhold', 'APPROVED', true), false)
  })
})

describe('report visibility', () => {
  it('opens private previews only after an explicit release', () => {
    for (const status of ALL_RELEASE_STATUSES) {
      assert.equal(releaseAllowsPreview(status), status === 'RELEASED')
    }
    assert.equal(releaseAllowsPreview(null), false)
    assert.equal(releaseAllowsPreview(undefined), false)
  })
})

describe('release reason validation', () => {
  it('requires a trimmed reason of at least three characters', () => {
    assert.match(releaseReasonError('') ?? '', /at least 3/)
    assert.match(releaseReasonError('  ') ?? '', /at least 3/)
    assert.match(releaseReasonError('  ab  ') ?? '', /at least 3/)
    assert.equal(releaseReasonError(' abc '), null)
    assert.equal(releaseReasonError('Finance is verifying the transfer.'), null)
  })

  it('rejects reasons longer than 1000 characters', () => {
    assert.equal(releaseReasonError('a'.repeat(1000)), null)
    assert.match(releaseReasonError('a'.repeat(1001)) ?? '', /1000/)
  })
})

describe('platform queue counts', () => {
  it('counts every release state including approved but unreleased', () => {
    const counts = countReleaseBatches([
      releaseBatch('GENERATED'),
      releaseBatch('PENDING_PLATFORM_REVIEW'),
      releaseBatch('PENDING_PLATFORM_REVIEW'),
      releaseBatch('RETURNED'),
      releaseBatch('APPROVED'),
      releaseBatch('RELEASED'),
      releaseBatch('ON_HOLD'),
    ])

    assert.deepEqual(counts, {
      total: 7,
      generated: 1,
      pendingReview: 2,
      returned: 1,
      approvedUnreleased: 1,
      released: 1,
      onHold: 1,
    })
  })

  it('returns zero counts for an empty queue', () => {
    assert.deepEqual(countReleaseBatches([]), {
      total: 0,
      generated: 0,
      pendingReview: 0,
      returned: 0,
      approvedUnreleased: 0,
      released: 0,
      onHold: 0,
    })
  })
})

describe('release labels and tones', () => {
  it('labels every release state distinctly', () => {
    const labels = Object.values(RELEASE_STATUS_SHORT_LABELS)
    assert.equal(new Set(labels).size, ALL_RELEASE_STATUSES.length)

    for (const status of ALL_RELEASE_STATUSES) {
      assert.ok(RELEASE_STATUS_LABELS[status].length > 0)
      assert.ok(RELEASE_STATUS_DESCRIPTIONS[status].length > 0)
    }

    assert.equal(RELEASE_STATUS_LABELS.APPROVED, 'Approved — not released')
    assert.equal(RELEASE_STATUS_SHORT_LABELS.RELEASED, 'Released')
  })

  it('treats only released as a success and never as neutral', () => {
    assert.equal(releaseTone('RELEASED'), 'success')
    assert.equal(releaseTone('APPROVED'), 'info')
    assert.equal(releaseTone('PENDING_PLATFORM_REVIEW'), 'info')
    assert.equal(releaseTone('RETURNED'), 'warning')
    assert.equal(releaseTone('ON_HOLD'), 'warning')
    assert.equal(releaseTone('GENERATED'), 'neutral')
  })

  it('keeps generation status labels and tones consistent', () => {
    const statuses = Object.keys(BATCH_STATUS_LABELS) as ReportBatchStatus[]
    assert.deepEqual(statuses.sort(), [
      'COMPLETED',
      'COMPLETED_WITH_FAILURES',
      'FAILED',
      'PENDING',
      'RUNNING',
    ])
    assert.equal(batchTone('COMPLETED'), 'success')
    assert.equal(batchTone('COMPLETED_WITH_FAILURES'), 'warning')
    assert.equal(batchTone('FAILED'), 'warning')
    assert.equal(batchTone('RUNNING'), 'info')
    assert.equal(batchTone('PENDING'), 'neutral')
  })
})
