import { getPrismaClient } from '../lib/prisma.js'

/**
 * Cross-invocation lock for the academic calendar scheduler.
 *
 * Vercel may invoke the scheduled endpoint more than once concurrently, and a
 * retried Cron delivery can overlap with a still-running invocation. A single
 * in-process boolean is not enough across serverless instances, so the lock is
 * stored in PostgreSQL and acquired with one atomic UPDATE.
 */
export interface SchedulerLock {
  /**
   * Attempts to take the lock for `owner`. Returns false when another live
   * owner holds it. An expired lease is treated as free so a crashed function
   * can never block the scheduler forever.
   */
  acquire(owner: string, ttlMs: number): Promise<boolean>
  /** Releases the lock only when `owner` still owns it. */
  release(owner: string): Promise<void>
}

/** The single scheduler lock row. Seeded by the Phase 2 serverless migration. */
export const SCHEDULER_LOCK_KEY = 'calendar-scheduler'

export function createPrismaSchedulerLock(): SchedulerLock {
  return {
    async acquire(owner, ttlMs) {
      const now = new Date()
      const expiresAt = new Date(now.getTime() + ttlMs)
      const updated = await getPrismaClient().$executeRaw`
        UPDATE "SchedulerLock"
        SET
          "lockedBy" = ${owner},
          "lockedAt" = ${now},
          "expiresAt" = ${expiresAt},
          "updatedAt" = ${now}
        WHERE "key" = ${SCHEDULER_LOCK_KEY}
          AND (
            "lockedAt" IS NULL
            OR "expiresAt" IS NULL
            OR "expiresAt" < ${now}
          )
      `

      return updated === 1
    },

    async release(owner) {
      const now = new Date()
      await getPrismaClient().$executeRaw`
        UPDATE "SchedulerLock"
        SET
          "lockedBy" = NULL,
          "lockedAt" = NULL,
          "expiresAt" = NULL,
          "updatedAt" = ${now}
        WHERE "key" = ${SCHEDULER_LOCK_KEY}
          AND "lockedBy" = ${owner}
      `
    },
  }
}
