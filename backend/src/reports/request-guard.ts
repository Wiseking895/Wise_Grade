import type { ReportBatchRecord } from './repository.js'

/**
 * A term request is a duplicate when the same reporting period already has a
 * batch that is waiting to generate, is generating, has completed, or produced
 * any report artifact.
 *
 * A batch that failed without generating or skipping a single pupil is not a
 * duplicate: the school corrected the underlying records (for example missing
 * attendance) and needs a genuinely new request. Keeping this rule in one place
 * means the service, PostgreSQL repository and test double cannot drift apart.
 */
export function blocksNewTermRequest(batch: ReportBatchRecord): boolean {
  if (batch.status === 'FAILED') {
    return batch.generatedCount > 0 || batch.skippedCount > 0
  }

  return true
}
