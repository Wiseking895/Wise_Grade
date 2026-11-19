import type { ReportBatchRecord } from './repository.js'

/**
 * A second term request is only blocked while an earlier request for the same
 * reporting period is still in flight.
 *
 * Reports are consolidated per pupil per term: a later request may cover pupils
 * who do not yet have a released final report without duplicating the pupils
 * who already do. The service refuses a request when every pupil is already
 * reported, and generation reuses an identical released final report instead of
 * creating a new version. Keeping the concurrency rule in one place means the
 * PostgreSQL repository and the test double cannot drift apart.
 */
export function blocksNewTermRequest(batch: ReportBatchRecord): boolean {
  return batch.status === 'PENDING' || batch.status === 'RUNNING'
}
