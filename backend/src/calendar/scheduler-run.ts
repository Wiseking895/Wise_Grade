import { randomUUID } from 'node:crypto'
import type { PlatformNotifier } from '../platform/notifications.js'
import type { PlatformOperationsRepository } from '../platform/operations-repository.js'
import type { CalendarSchedulerRunSummary } from './scheduler.js'
import type { CalendarService } from './service.js'
import type { SchedulerLock } from './scheduler-lock.js'

export type SchedulerTrigger = 'SCHEDULER' | 'CRON' | 'MANUAL'

export interface CalendarSchedulerRunOutcome {
  executed: boolean
  /** Present when no run happened. Never silently swallowed by the endpoint. */
  reason?: 'DISABLED' | 'LOCKED'
  summary?: CalendarSchedulerRunSummary
}

export interface CalendarSchedulerRunner {
  run(trigger?: SchedulerTrigger): Promise<CalendarSchedulerRunOutcome>
}

export interface CalendarSchedulerRunnerOptions {
  /** Only `runAll` is required, so tests can provide a tiny deterministic stub. */
  service: Pick<CalendarService, 'runAll'>
  /** Persists the append-only scheduler history. */
  recordRun?: (
    summary: CalendarSchedulerRunSummary,
    trigger: SchedulerTrigger,
  ) => Promise<void>
  /** Sends the CRITICAL failure notification. Must never throw. */
  notifyFailure?: (summary: CalendarSchedulerRunSummary) => Promise<void>
  /** Cross-instance lock. Defaults to an always-acquired in-process lock. */
  lock?: SchedulerLock
  /** Mirrors CALENDAR_SCHEDULER_ENABLED. */
  enabled?: boolean
  /** Lease duration; must comfortably exceed the longest expected run. */
  lockTtlMs?: number
  logger?: (message: string) => void
}

const DEFAULT_LOCK_TTL_MS = 15 * 60 * 1000

/**
 * Serialises one calendar scheduler execution behind the database lock and
 * records the outcome exactly like the long-running local scheduler does.
 *
 * The runner never starts a timer and never calls `listen`, so it is safe to
 * invoke from a Vercel serverless function.
 */
export function createCalendarSchedulerRunner(
  options: CalendarSchedulerRunnerOptions,
): CalendarSchedulerRunner {
  const logger = options.logger ?? ((message) => console.error(message))
  const lockTtlMs = options.lockTtlMs ?? DEFAULT_LOCK_TTL_MS
  const lock: SchedulerLock =
    options.lock ?? {
      async acquire() {
        return true
      },
      async release() {
        // No cross-instance coordination requested.
      },
    }

  async function record(
    summary: CalendarSchedulerRunSummary,
    trigger: SchedulerTrigger,
  ): Promise<void> {
    if (!options.recordRun) {
      return
    }

    try {
      await options.recordRun(summary, trigger)
    } catch (error) {
      logger(
        `[calendar] failed to persist scheduler run: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  async function notifyFailure(
    summary: CalendarSchedulerRunSummary,
  ): Promise<void> {
    if (!options.notifyFailure) {
      return
    }

    try {
      await options.notifyFailure(summary)
    } catch (error) {
      logger(
        `[calendar] failed to send scheduler failure notification: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  return {
    async run(trigger = 'CRON') {
      if (options.enabled === false) {
        return { executed: false, reason: 'DISABLED' }
      }

      const owner = randomUUID()

      if (!(await lock.acquire(owner, lockTtlMs))) {
        logger('[calendar] scheduler skipped: another run holds the lock')
        return { executed: false, reason: 'LOCKED' }
      }

      const startedAt = new Date()

      try {
        const results = await options.service.runAll()
        const failures = results.filter((result) => result.status === 'FAILED')

        for (const result of failures) {
          logger(
            `[calendar] school ${result.schoolId} failed: ${
              result.message ?? 'unknown error'
            }`,
          )
        }

        const completedAt = new Date()
        const summary: CalendarSchedulerRunSummary = {
          status: failures.length > 0 ? 'FAILED' : 'COMPLETED',
          startedAt,
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
          schoolCount: results.length,
          failureCount: failures.length,
          message:
            failures.length > 0
              ? failures
                  .map(
                    (result) =>
                      `${result.schoolId}: ${result.message ?? 'unknown error'}`,
                  )
                  .join('; ')
                  .slice(0, 1000)
              : null,
        }

        await record(summary, trigger)

        if (summary.status === 'FAILED') {
          await notifyFailure(summary)
        }

        return { executed: true, summary }
      } catch (error) {
        const completedAt = new Date()
        const message = error instanceof Error ? error.message : String(error)

        logger(`[calendar] scheduler run failed: ${message}`)

        const summary: CalendarSchedulerRunSummary = {
          status: 'FAILED',
          startedAt,
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
          schoolCount: 0,
          failureCount: 1,
          message: message.slice(0, 1000),
        }

        await record(summary, trigger)
        await notifyFailure(summary)
        throw error
      } finally {
        try {
          await lock.release(owner)
        } catch (error) {
          logger(
            `[calendar] failed to release scheduler lock: ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
        }
      }
    },
  }
}

/**
 * Shared persistence helper used by both the local interval scheduler and the
 * serverless Cron endpoint, so audit history and notifications cannot drift.
 */
export async function recordCalendarSchedulerRun(
  operations: PlatformOperationsRepository,
  summary: CalendarSchedulerRunSummary,
  trigger: SchedulerTrigger = 'SCHEDULER',
): Promise<void> {
  await operations.recordSchedulerRun({
    trigger,
    status: summary.status,
    startedAt: summary.startedAt,
    completedAt: summary.completedAt,
    durationMs: summary.durationMs,
    schoolCount: summary.schoolCount,
    failureCount: summary.failureCount,
    message: summary.message,
  })
}

export async function notifyCalendarSchedulerFailure(
  notifier: PlatformNotifier,
  summary: CalendarSchedulerRunSummary,
): Promise<void> {
  await notifier.notify({
    type: 'CALENDAR_SCHEDULER_FAILED',
    severity: 'CRITICAL',
    title: 'Academic calendar scheduler run failed',
    body:
      summary.message ??
      `The scheduler failed while processing ${summary.schoolCount} school(s).`,
    entityType: 'SchedulerRun',
    link: '/platform/health',
    dedupeKey: `calendar-scheduler-failed:${summary.startedAt.toISOString()}`,
  })
}
