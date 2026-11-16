import { createApp } from './app.js'
import type { CalendarService } from './calendar/service.js'
import {
  startCalendarScheduler,
  type CalendarSchedulerRunSummary,
} from './calendar/scheduler.js'
import { env } from './config/env.js'
import type { PlatformOperationsRepository } from './platform/operations-repository.js'
import type { PlatformNotifier } from './platform/notifications.js'

const app = createApp()

const calendarService = app.locals.calendarService as CalendarService | undefined
const platformOperations = app.locals
  .platformOperations as PlatformOperationsRepository
const platformNotifier = app.locals.platformNotifier as PlatformNotifier

async function recordSchedulerRun(
  summary: CalendarSchedulerRunSummary,
): Promise<void> {
  await platformOperations.recordSchedulerRun({
    trigger: 'SCHEDULER',
    status: summary.status,
    startedAt: summary.startedAt,
    completedAt: summary.completedAt,
    durationMs: summary.durationMs,
    schoolCount: summary.schoolCount,
    failureCount: summary.failureCount,
    message: summary.message,
  })

  if (summary.status === 'FAILED') {
    await platformNotifier.notify({
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
}

const stopCalendarScheduler =
  env.CALENDAR_SCHEDULER_ENABLED && calendarService
    ? startCalendarScheduler({
        service: calendarService,
        intervalMs: env.CALENDAR_SCHEDULER_INTERVAL_MINUTES * 60 * 1000,
        runImmediately: false,
        logger: (message) => console.log(message),
        onRun: recordSchedulerRun,
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
