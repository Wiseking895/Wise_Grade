import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import {
  clearSessionCookieOptions,
  sessionCookieOptions,
  subjectSessionCookieOptions,
} from '../src/auth/session.js'
import {
  MockPaymentProvider,
  signMockWebhook,
} from '../src/billing/provider.js'
import { createServerlessHandler, getServerlessApp } from '../src/serverless.js'
import { MemoryStorageAdapter } from '../src/storage/storage.js'
import { registrationBody } from './helpers/auth-fixtures.js'
import { FakeAuthRepository } from './helpers/fake-auth-repository.js'

const FRONTEND_ORIGIN = 'https://frontend-esf6.vercel.app'
const WEBHOOK_SECRET = 'serverless-raw-body-test-secret'

function createTestApp() {
  return createApp({
    authRepository: new FakeAuthRepository(),
    reportStorage: new MemoryStorageAdapter(),
    paymentProvider: new MockPaymentProvider({
      webhookSecret: WEBHOOK_SECRET,
      maxSkewSeconds: 300,
    }),
    allowedOrigins: [FRONTEND_ORIGIN],
    calendarScheduler: {
      async run() {
        return { executed: false, reason: 'DISABLED' }
      },
    },
    cronSecret: '',
  })
}

describe('Vercel serverless entry point', () => {
  it('serves /api/health through the handler without listen or a database', async () => {
    const handler = createServerlessHandler(createTestApp)

    const response = await request(handler).get('/api/health')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      status: 'ok',
      service: 'gradely-api',
      database: 'not_checked',
    })
  })

  it('reuses one Express instance per warm function instance', () => {
    const first = getServerlessApp()
    const second = getServerlessApp()

    expect(first).toBe(second)
  })

  it('keeps the production CORS allow-list and credentials in the handler', async () => {
    const handler = createServerlessHandler(createTestApp)

    const response = await request(handler)
      .options('/api/auth/login')
      .set('Origin', FRONTEND_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type')

    expect(response.status).toBe(204)
    expect(response.headers['access-control-allow-origin']).toBe(FRONTEND_ORIGIN)
    expect(response.headers['access-control-allow-credentials']).toBe('true')
    expect(response.headers['access-control-allow-origin']).not.toBe('*')
  })

  it('issues the session cookie through the handler', async () => {
    const handler = createServerlessHandler(createTestApp)

    const registration = await request(handler)
      .post('/api/auth/register-school')
      .set('Origin', FRONTEND_ORIGIN)
      .send(registrationBody())

    expect(registration.status).toBe(201)

    const cookies = registration.headers['set-cookie'] as unknown as string[]
    const session = cookies.find((value) =>
      value.startsWith('gradely_session='),
    )

    expect(session).toContain('HttpOnly')
    expect(session).toContain('SameSite=Lax')
  })

  it('preserves the raw webhook body before JSON parsing', async () => {
    const handler = createServerlessHandler(createTestApp)
    // Deliberately malformed JSON. The signature must be computed over these
    // exact bytes, and the provider must be the component that reports the
    // parse error ("not valid JSON"). If express.json() ran first, the body
    // parser would instead answer "Invalid JSON payload".
    const rawBody = '{"id": "evt-serverless", "type": '
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = signMockWebhook({
      webhookSecret: WEBHOOK_SECRET,
      timestamp,
      rawBody,
    })

    const response = await request(handler)
      .post('/api/webhooks/payments/mock')
      .set('Content-Type', 'application/json')
      .set('x-gradely-timestamp', timestamp)
      .set('x-gradely-signature', signature)
      .send(rawBody)

    expect(response.status).toBe(400)
    expect(response.body.error.message).toBe('Webhook payload is not valid JSON')
  })

  it('keeps unknown routes on the structured 404 handler', async () => {
    const handler = createServerlessHandler(createTestApp)

    const response = await request(handler).get('/api/does-not-exist')

    expect(response.status).toBe(404)
    expect(response.body.error.message).toBe('Route not found')
  })
})

describe('session cookie attributes by environment', () => {
  const expiresAt = new Date('2026-11-17T12:00:00.000Z')

  it('uses HttpOnly, Secure and SameSite=None in production for cross-site auth', () => {
    expect(sessionCookieOptions(expiresAt, 'production')).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
    })
    expect(subjectSessionCookieOptions(expiresAt, 'production')).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'none',
    })
    expect(clearSessionCookieOptions('production')).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'none',
    })
  })

  it('keeps local development usable over http://localhost', () => {
    const options = sessionCookieOptions(expiresAt, 'development')

    expect(options.httpOnly).toBe(true)
    expect(options.secure).toBe(false)
    expect(options.sameSite).toBe('lax')
  })
})
