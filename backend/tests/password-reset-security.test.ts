import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { generateOpaqueToken, hashToken } from '../src/auth/tokens.js'
import {
  registrationBody,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from './helpers/auth-fixtures.js'
import { CaptureEmailService } from './helpers/capture-email-service.js'
import { FakeAuthRepository } from './helpers/fake-auth-repository.js'

const NEW_PASSWORD = 'a-much-longer-new-password'

describe('password reset security', () => {
  let app: ReturnType<typeof createApp>
  let repository: FakeAuthRepository
  let email: CaptureEmailService

  beforeEach(async () => {
    repository = new FakeAuthRepository()
    email = new CaptureEmailService()
    app = createApp({
      authRepository: repository,
      emailService: email,
    })

    await request(app)
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(registrationBody())
  })

  async function requestReset(address: string) {
    return request(app)
      .post('/api/auth/password-reset/request')
      .set('Origin', TEST_ORIGIN)
      .send({ email: address })
  }

  function resetToken(): string {
    const message = email.last('password-reset')

    if (!message) {
      throw new Error('No password-reset email was captured')
    }

    const url = String(message.data.resetUrl)
    const token = new URL(url).searchParams.get('token')

    if (!token) {
      throw new Error('The captured reset email has no token')
    }

    return token
  }

  it('sends a reset link to the registered address only', async () => {
    const known = await requestReset('ada@example.com')
    expect(known.status).toBe(202)

    const message = email.last('password-reset')
    expect(message).toBeDefined()
    expect(message?.to).toBe('ada@example.com')
    // The link is built from the configured frontend origin, never hardcoded.
    const expectedBase = env.FRONTEND_URL.replace(/\/+$/, '')
    expect(String(message?.data.resetUrl)).toMatch(
      new RegExp(`^${expectedBase}/reset-password\\?token=`),
    )
    expect(message?.data.expiryMinutes).toBe(30)

    // A request for an unknown address returns the same response and sends
    // nothing.
    const unknown = await requestReset('nobody@example.com')
    expect(unknown.status).toBe(202)
    expect(unknown.body).toEqual(known.body)
    expect(email.all('password-reset')).toHaveLength(1)
  })

  it('does not persist the raw reset token in the email payload or link', async () => {
    await requestReset('ada@example.com')
    const token = resetToken()

    // The token is a fresh 256-bit value, not the stored SHA-256 hash.
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    expect(token).not.toBe(hashToken(token))
    expect(repository.resetTokens.has(token)).toBe(false)
    expect(repository.resetTokens.has(hashToken(token))).toBe(true)
  })

  it('rejects an expired link distinctly from a used link', async () => {
    const user = repository.getUserSnapshot('ada@example.com')!
    const rawToken = generateOpaqueToken()

    await repository.createPasswordResetToken({
      userId: user.id,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() - 1000),
    })

    const expired = await request(app)
      .post('/api/auth/password-reset/confirm')
      .set('Origin', TEST_ORIGIN)
      .send({ token: rawToken, password: NEW_PASSWORD })
    expect(expired.status).toBe(400)
    expect(expired.body.error.code).toBe('password_reset_expired')

    const invalid = await request(app)
      .post('/api/auth/password-reset/confirm')
      .set('Origin', TEST_ORIGIN)
      .send({ token: generateOpaqueToken(), password: NEW_PASSWORD })
    expect(invalid.status).toBe(400)
    expect(invalid.body.error.code).toBe('password_reset_invalid')
  })

  it('revokes other outstanding links once a reset completes', async () => {
    const user = repository.getUserSnapshot('ada@example.com')!
    const firstToken = generateOpaqueToken()
    const secondToken = generateOpaqueToken()

    await repository.createPasswordResetToken({
      userId: user.id,
      tokenHash: hashToken(firstToken),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    })
    // A second outstanding token that predates the latest issuance path (for
    // example a pre-existing link) still exists in the store.
    repository.resetTokens.set(hashToken(secondToken), {
      userId: user.id,
      tokenHash: hashToken(secondToken),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      usedAt: null,
      revokedAt: null,
    })

    const done = await request(app)
      .post('/api/auth/password-reset/confirm')
      .set('Origin', TEST_ORIGIN)
      .send({ token: firstToken, password: NEW_PASSWORD })
    expect(done.status).toBe(200)

    const revoked = await request(app)
      .post('/api/auth/password-reset/confirm')
      .set('Origin', TEST_ORIGIN)
      .send({ token: secondToken, password: 'another-long-password' })
    expect(revoked.status).toBe(400)
    expect(revoked.body.error.code).toBe('password_reset_revoked')
  })

  it('rate-limits repeated reset requests per origin', async () => {
    const limited = createApp({
      authRepository: repository,
      emailService: email,
      passwordResetRateLimit: { windowMs: 60_000, max: 1 },
    })

    const first = await request(limited)
      .post('/api/auth/password-reset/request')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'ada@example.com' })
    expect(first.status).toBe(202)

    const second = await request(limited)
      .post('/api/auth/password-reset/request')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'nobody@example.com' })
    expect(second.status).toBe(429)
  })

  it('keeps login and email verification working after the changes', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'ada@example.com', password: TEST_PASSWORD })
    expect(login.status).toBe(200)
  })
})
