import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import type {
  EmailService,
  OutboxRunResult,
} from '../src/email/service.js'
import { FakeAuthRepository } from './helpers/fake-auth-repository.js'

const CRON_SECRET = 'test-email-cron-secret-1234'
const FRONTEND_ORIGIN = 'https://frontend.example.test'

function fakeEmailService(summary: OutboxRunResult) {
  const processOutbox = vi.fn(async () => summary)
  const service: EmailService = {
    async send() {
      return { status: 'disabled' }
    },
    async verifyConnection() {
      return { enabled: false, configured: false, ok: false }
    },
    processOutbox,
  }

  return { service, processOutbox }
}

function appWith(
  service: EmailService,
  cronSecret: string | undefined = CRON_SECRET,
) {
  return createApp({
    authRepository: new FakeAuthRepository(),
    emailService: service,
    cronSecret,
    allowedOrigins: [FRONTEND_ORIGIN],
  })
}

describe('protected email outbox endpoint', () => {
  it('fails closed with 503 when CRON_SECRET is not configured', async () => {
    const { service, processOutbox } = fakeEmailService({
      sent: 1,
      failed: 0,
      skipped: 0,
    })

    const response = await request(appWith(service, '')).get(
      '/api/internal/email',
    )

    expect(response.status).toBe(503)
    expect(response.body.error.message).toMatch(/CRON_SECRET/)
    expect(processOutbox).not.toHaveBeenCalled()
  })

  it('rejects a missing or wrong bearer token without draining the outbox', async () => {
    const { service, processOutbox } = fakeEmailService({
      sent: 0,
      failed: 0,
      skipped: 0,
    })
    const app = appWith(service)

    const missing = await request(app).get('/api/internal/email')
    const wrong = await request(app)
      .get('/api/internal/email')
      .set('Authorization', 'Bearer not-the-secret')

    expect(missing.status).toBe(401)
    expect(wrong.status).toBe(401)
    expect(processOutbox).not.toHaveBeenCalled()
  })

  it('drains through GET for Vercel Cron and returns the sanitized summary', async () => {
    const summary = { sent: 2, failed: 1, skipped: 3 }
    const { service, processOutbox } = fakeEmailService(summary)

    const response = await request(appWith(service))
      .get('/api/internal/email')
      .set('Authorization', `Bearer ${CRON_SECRET}`)

    expect(response.status).toBe(200)
    expect(response.body.data).toEqual(summary)
    expect(processOutbox).toHaveBeenCalledTimes(1)
    // No CORS origin is required for a server-to-server cron call.
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('also accepts POST for an external worker', async () => {
    const { service, processOutbox } = fakeEmailService({
      sent: 0,
      failed: 0,
      skipped: 0,
    })

    const response = await request(appWith(service))
      .post('/api/internal/email')
      .set('Authorization', `Bearer ${CRON_SECRET}`)

    expect(response.status).toBe(200)
    expect(processOutbox).toHaveBeenCalledTimes(1)
  })
})
