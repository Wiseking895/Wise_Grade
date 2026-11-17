import { describe, expect, it, vi } from 'vitest'
import {
  createCalendarSchedulerRunner,
  notifyCalendarSchedulerFailure,
  recordCalendarSchedulerRun,
  type SchedulerTrigger,
} from '../src/calendar/scheduler-run.js'
import type { CalendarRunResult } from '../src/calendar/types.js'
import type { SchedulerLock } from '../src/calendar/scheduler-lock.js'
import { FakeOperationsRepository } from './helpers/fake-operations-repository.js'
import { createPlatformNotifier } from '../src/platform/notifications.js'

const silentLogger = () => undefined

function completedRun(schoolId = 'school-1'): CalendarRunResult {
  return {
    schoolId,
    trigger: 'SCHEDULER',
    runAt: new Date(),
    status: 'UP_TO_DATE',
    steps: [],
  }
}

function failedRun(schoolId = 'school-1'): CalendarRunResult {
  return {
    schoolId,
    trigger: 'SCHEDULER',
    runAt: new Date(),
    status: 'FAILED',
    steps: [],
    message: 'report preparation failed',
  }
}

/** In-memory lock that behaves like the PostgreSQL lease for one process. */
function memoryLock(): SchedulerLock & { held: boolean } {
  const lock = {
    held: false,
    async acquire() {
      if (lock.held) {
        return false
      }

      lock.held = true
      return true
    },
    async release() {
      lock.held = false
    },
  }

  return lock
}

describe('serverless calendar scheduler runner', () => {
  it('runs once, records CRON history and releases the lock', async () => {
    const operations = new FakeOperationsRepository()
    const lock = memoryLock()
    const runAll = vi.fn(async () => [completedRun(), completedRun('school-2')])
    const runner = createCalendarSchedulerRunner({
      service: { runAll },
      lock,
      recordRun: (summary, trigger) =>
        recordCalendarSchedulerRun(operations, summary, trigger),
      logger: silentLogger,
    })

    const outcome = await runner.run()

    expect(outcome.executed).toBe(true)
    expect(outcome.summary).toMatchObject({
      status: 'COMPLETED',
      schoolCount: 2,
      failureCount: 0,
      message: null,
    })
    expect(runAll).toHaveBeenCalledTimes(1)
    expect(operations.schedulerRuns).toHaveLength(1)
    expect(operations.schedulerRuns[0]).toMatchObject({
      trigger: 'CRON',
      status: 'COMPLETED',
      schoolCount: 2,
      failureCount: 0,
    })
    expect(lock.held).toBe(false)
  })

  it('records a FAILED run and sends one CRITICAL notification for failures', async () => {
    const operations = new FakeOperationsRepository()
    const notifier = createPlatformNotifier(operations, silentLogger)
    const runner = createCalendarSchedulerRunner({
      service: { runAll: async () => [completedRun(), failedRun('school-2')] },
      lock: memoryLock(),
      recordRun: (summary, trigger) =>
        recordCalendarSchedulerRun(operations, summary, trigger),
      notifyFailure: (summary) =>
        notifyCalendarSchedulerFailure(notifier, summary),
      logger: silentLogger,
    })

    const outcome = await runner.run()

    expect(outcome.summary).toMatchObject({
      status: 'FAILED',
      schoolCount: 2,
      failureCount: 1,
    })
    expect(operations.schedulerRuns[0]?.status).toBe('FAILED')
    expect(operations.notifications).toHaveLength(1)
    expect(operations.notifications[0]).toMatchObject({
      type: 'CALENDAR_SCHEDULER_FAILED',
      severity: 'CRITICAL',
      entityType: 'SchedulerRun',
    })
  })

  it('records and notifies when the whole batch throws, then rethrows', async () => {
    const operations = new FakeOperationsRepository()
    const notifier = createPlatformNotifier(operations, silentLogger)
    const lock = memoryLock()
    const runner = createCalendarSchedulerRunner({
      service: {
        runAll: async () => {
          throw new Error('database unavailable')
        },
      },
      lock,
      recordRun: (summary, trigger) =>
        recordCalendarSchedulerRun(operations, summary, trigger),
      notifyFailure: (summary) =>
        notifyCalendarSchedulerFailure(notifier, summary),
      logger: silentLogger,
    })

    await expect(runner.run()).rejects.toThrow('database unavailable')

    expect(operations.schedulerRuns[0]).toMatchObject({
      trigger: 'CRON',
      status: 'FAILED',
      failureCount: 1,
      message: 'database unavailable',
    })
    expect(operations.notifications).toHaveLength(1)
    expect(lock.held).toBe(false)
  })

  it('refuses a concurrent run while the lock lease is held', async () => {
    const operations = new FakeOperationsRepository()
    const lock = memoryLock()
    let releaseFirst: (() => void) | undefined
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const runner = createCalendarSchedulerRunner({
      service: {
        runAll: async () => {
          await firstGate
          return [completedRun()]
        },
      },
      lock,
      recordRun: (summary, trigger) =>
        recordCalendarSchedulerRun(operations, summary, trigger),
      logger: silentLogger,
    })

    const first = runner.run()
    const second = await runner.run()

    expect(second).toEqual({ executed: false, reason: 'LOCKED' })

    releaseFirst?.()
    const firstOutcome = await first

    expect(firstOutcome.executed).toBe(true)
    expect(operations.schedulerRuns).toHaveLength(1)
    expect(lock.held).toBe(false)
  })

  it('does not run or record when the scheduler is disabled', async () => {
    const operations = new FakeOperationsRepository()
    const runAll = vi.fn(async () => [completedRun()])
    const runner = createCalendarSchedulerRunner({
      service: { runAll },
      lock: memoryLock(),
      enabled: false,
      recordRun: (summary, trigger) =>
        recordCalendarSchedulerRun(operations, summary, trigger),
      logger: silentLogger,
    })

    const outcome = await runner.run()

    expect(outcome).toEqual({ executed: false, reason: 'DISABLED' })
    expect(runAll).not.toHaveBeenCalled()
    expect(operations.schedulerRuns).toHaveLength(0)
  })

  it('maps the trigger supplied by the caller', async () => {
    const operations = new FakeOperationsRepository()
    const runner = createCalendarSchedulerRunner({
      service: { runAll: async () => [completedRun()] },
      lock: memoryLock(),
      recordRun: (summary, trigger: SchedulerTrigger) =>
        recordCalendarSchedulerRun(operations, summary, trigger),
      logger: silentLogger,
    })

    await runner.run('MANUAL')

    expect(operations.schedulerRuns[0]?.trigger).toBe('MANUAL')
  })
})
