import type { CalendarService } from './service.js'

export interface CalendarSchedulerRunSummary {
  status: 'COMPLETED' | 'FAILED'
  startedAt: Date
  completedAt: Date
  durationMs: number
  schoolCount: number
  failureCount: number
  message: string | null
}

export interface CalendarSchedulerOptions {
  service: CalendarService
  intervalMs?: number
  /** When false, the first run happens after one interval. */
  runImmediately?: boolean
  logger?: (message: string) => void
  /**
   * Optional persistence/notification hook invoked after every tick. It must
   * never throw in a way that stops the scheduler; failures are logged.
   */
  onRun?: (summary: CalendarSchedulerRunSummary) => Promise<void>
}

/**
 * Periodically processes due calendar transitions for every active school.
 * A single in-flight run is enforced so a slow report-preparation batch cannot
 * overlap with the next tick. Errors are logged and retried on the next tick.
 */
export function startCalendarScheduler(
  options: CalendarSchedulerOptions,
): () => void {
  const intervalMs = options.intervalMs ?? 60 * 60 * 1000
  const logger = options.logger ?? (() => undefined)
  let running = false
  let stopped = false

  async function tick(): Promise<void> {
    if (running || stopped) {
      return
    }

    running = true
    const startedAt = new Date()

    try {
      const results = await options.service.runAll()
      const failures = results.filter((result) => result.status === 'FAILED')

      for (const result of failures) {
        logger(
          `[calendar] school ${result.schoolId} failed: ${result.message ?? 'unknown error'}`,
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

      if (options.onRun) {
        try {
          await options.onRun(summary)
        } catch (error) {
          logger(
            `[calendar] failed to persist scheduler run: ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
        }
      }
    } catch (error) {
      const completedAt = new Date()
      const message =
        error instanceof Error ? error.message : String(error)

      logger(`[calendar] scheduler run failed: ${message}`)

      if (options.onRun) {
        try {
          await options.onRun({
            status: 'FAILED',
            startedAt,
            completedAt,
            durationMs: completedAt.getTime() - startedAt.getTime(),
            schoolCount: 0,
            failureCount: 1,
            message: message.slice(0, 1000),
          })
        } catch (hookError) {
          logger(
            `[calendar] failed to persist scheduler run: ${
              hookError instanceof Error ? hookError.message : String(hookError)
            }`,
          )
        }
      }
    } finally {
      running = false
    }
  }

  const timer = setInterval(() => {
    void tick()
  }, intervalMs)
  timer.unref?.()

  if (options.runImmediately ?? false) {
    void tick()
  }

  return () => {
    stopped = true
    clearInterval(timer)
  }
}
