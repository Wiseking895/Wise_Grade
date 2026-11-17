import { createApp } from './app.js'
import type { CalendarService } from './calendar/service.js'
import { startCalendarScheduler } from './calendar/scheduler.js'
import {
  notifyCalendarSchedulerFailure,
  recordCalendarSchedulerRun,
} from './calendar/scheduler-run.js'
import { env } from './config/env.js'
import type { PlatformOperationsRepository } from './platform/operations-repository.js'
import type { PlatformNotifier } from './platform/notifications.js'

const app = createApp()

const calendarService = app.locals.calendarService as CalendarService | undefined
const platformOperations = app.locals
  .platformOperations as PlatformOperationsRepository
const platformNotifier = app.locals.platformNotifier as PlatformNotifier

/**
 * Local development uses a long-running interval scheduler. Serverless
 * production never imports this file; it triggers the same shared runner
 * through the protected `/api/internal/calendar` endpoint instead.
 *
 * Audit persistence and failure notification deliberately reuse the shared
 * helpers so local and production history cannot drift apart.
 */
async function onCalendarSchedulerRun(
  summary: Parameters<typeof recordCalendarSchedulerRun>[1],
): Promise<void> {
  await recordCalendarSchedulerRun(platformOperations, summary, 'SCHEDULER')

  if (summary.status === 'FAILED') {
    await notifyCalendarSchedulerFailure(platformNotifier, summary)
  }
}

const stopCalendarScheduler =
  env.CALENDAR_SCHEDULER_ENABLED && calendarService
    ? startCalendarScheduler({
        service: calendarService,
        intervalMs: env.CALENDAR_SCHEDULER_INTERVAL_MINUTES * 60 * 1000,
        runImmediately: false,
        logger: (message) => console.log(message),
        onRun: onCalendarSchedulerRun,
      })
    : () => undefined

const server = app.listen(env.PORT, () => {
  console.log(
    `[gradely-api] listening on http://localhost:${env.PORT} (${env.NODE_ENV})`,
  )
  console.log(
    '[gradely-api] no database connection is opened at startup; /api/health does not require PostgreSQL',
  )
})

function shutdown(signal: NodeJS.Signals): void {
  console.log(`[gradely-api] ${signal} received, closing the HTTP server`)
  stopCalendarScheduler()
  server.close((error) => {
    if (error) {
      console.error('[gradely-api] shutdown failed:', error)
      process.exitCode = 1
      return
    }

    console.log('[gradely-api] HTTP server closed')
  })
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
