import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import type {
  CalendarSchedulerRunner,
  CalendarSchedulerRunOutcome,
} from '../src/calendar/scheduler-run.js'
import { FakeAuthRepository } from './helpers/fake-auth-repository.js'

const CRON_SECRET = 'test-cron-secret-value-1234'
const FRONTEND_ORIGIN = 'https://frontend-esf6.vercel.app'

function stubRunner(
  outcome: CalendarSchedulerRunOutcome = {
    executed: true,
    summary: {
      status: 'COMPLETED',
      startedAt: new Date('2026-11-17T01:00:00.000Z'),
      completedAt: new Date('2026-11-17T01:00:01.000Z'),
      durationMs: 1000,
      schoolCount: 3,
      failureCount: 0,
      message: null,
    },
  },
) {
  const run = vi.fn(async () => outcome)

  return { run, runner: { run } as CalendarSchedulerRunner }
}

function appWith(
  runner: CalendarSchedulerRunner,
  cronSecret: string | undefined = CRON_SECRET,
) {
  return createApp({
    authRepository: new FakeAuthRepository(),
    calendarScheduler: runner,
    cronSecret,
    allowedOrigins: [FRONTEND_ORIGIN],
  })
}

describe('protected scheduled calendar endpoint', () => {
  it('fails closed with 503 when CRON_SECRET is not configured', async () => {
    const { run, runner } = stubRunner()
    const app = appWith(runner, '')

    const response = await request(app).get('/api/internal/calendar')

    expect(response.status).toBe(503)
    expect(response.body.error.message).toMatch(/CRON_SECRET/)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects a missing or wrong bearer token without running the scheduler', async () => {
    const { run, runner } = stubRunner()
    const app = appWith(runner)

    const missing = await request(app).get('/api/internal/calendar')
    const wrong = await request(app)
      .get('/api/internal/calendar')
      .set('Authorization', 'Bearer not-the-secret')

    expect(missing.status).toBe(401)
    expect(wrong.status).toBe(401)
    expect(run).not.toHaveBeenCalled()
  })

  it('runs through GET for Vercel Cron and reports the outcome', async () => {
    const { run, runner } = stubRunner()
    const app = appWith(runner)

    const response = await request(app)
      .get('/api/internal/calendar')
      .set('Authorization', `Bearer ${CRON_SECRET}`)

    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({
      executed: true,
      summary: { status: 'COMPLETED', schoolCount: 3, failureCount: 0 },
    })
    expect(run).toHaveBeenCalledWith('CRON')
  })

  it('also accepts POST for an external worker', async () => {
    const { run, runner } = stubRunner()
    const app = appWith(runner)

    const response = await request(app)
      .post('/api/internal/calendar')
      .set('Authorization', `Bearer ${CRON_SECRET}`)

    expect(response.status).toBe(200)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('reports a locked or disabled scheduled run without pretending it ran', async () => {
    const locked = stubRunner({ executed: false, reason: 'LOCKED' })
    const lockedResponse = await request(appWith(locked.runner))
      .get('/api/internal/calendar')
      .set('Authorization', `Bearer ${CRON_SECRET}`)

    expect(lockedResponse.status).toBe(200)
    expect(lockedResponse.body.data).toEqual({
      executed: false,
      reason: 'LOCKED',
    })

    const disabled = stubRunner({ executed: false, reason: 'DISABLED' })
    const disabledResponse = await request(appWith(disabled.runner))
      .get('/api/internal/calendar')
      .set('Authorization', `Bearer ${CRON_SECRET}`)

    expect(disabledResponse.status).toBe(200)
    expect(disabledResponse.body.data).toEqual({
      executed: false,
      reason: 'DISABLED',
    })
  })

  it('surfaces a failed run as a structured 500 instead of a silent success', async () => {
    const runner: CalendarSchedulerRunner = {
      async run() {
        throw new Error('calendar batch failed')
      },
    }
    const app = appWith(runner)

    const response = await request(app)
      .get('/api/internal/calendar')
      .set('Authorization', `Bearer ${CRON_SECRET}`)

    expect(response.status).toBe(500)
    expect(response.body.error.message).toBe('calendar batch failed')
  })

  it('does not require the frontend origin for server-to-server cron calls', async () => {
    const { runner } = stubRunner()
    const app = appWith(runner)

    const response = await request(app)
      .get('/api/internal/calendar')
      .set('Authorization', `Bearer ${CRON_SECRET}`)

    expect(response.headers['access-control-allow-origin']).toBeUndefined()
    expect(response.status).toBe(200)
  })
})
