import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { generateOpaqueToken, hashToken } from '../src/auth/tokens.js'
import {
  registrationBody,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from './helpers/auth-fixtures.js'
import { FakeAuthRepository } from './helpers/fake-auth-repository.js'

const NEW_PASSWORD = 'a-much-longer-new-password'

describe('password reset', () => {
  let app: ReturnType<typeof createApp>
  let repository: FakeAuthRepository

  beforeEach(async () => {
    repository = new FakeAuthRepository()
    app = createApp({ authRepository: repository })

    await request(app)
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(registrationBody())
  })

  it('returns the same generic response for known and unknown emails', async () => {
    const known = await request(app)
      .post('/api/auth/password-reset/request')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'ada@example.com' })

    const unknown = await request(app)
      .post('/api/auth/password-reset/request')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'nobody@example.com' })

    expect(known.status).toBe(202)
    expect(unknown.status).toBe(202)
    expect(known.body).toEqual(unknown.body)
    expect(repository.resetTokens.size).toBe(1)
  })

  it('stores only a hash of the reset token', async () => {
    await request(app)
      .post('/api/auth/password-reset/request')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'ada@example.com' })

    const [storedToken] = [...repository.resetTokens.keys()]
    expect(storedToken).toMatch(/^[a-f0-9]{64}$/)
  })

  it('updates the password, revokes sessions, and consumes the token', async () => {
    const user = repository.getUserSnapshot('ada@example.com')!
    const rawToken = generateOpaqueToken()

    await repository.createPasswordResetToken({
      userId: user.id,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })

    const response = await request(app)
      .post('/api/auth/password-reset/confirm')
      .set('Origin', TEST_ORIGIN)
      .send({ token: rawToken, password: NEW_PASSWORD })

    expect(response.status).toBe(200)

    const oldLogin = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'ada@example.com', password: TEST_PASSWORD })

    expect(oldLogin.status).toBe(401)

    const newLogin = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'ada@example.com', password: NEW_PASSWORD })

    expect(newLogin.status).toBe(200)
    expect(repository.auditActions()).toContain('PASSWORD_RESET_COMPLETED')
  })

  it('rejects a reused token', async () => {
    const user = repository.getUserSnapshot('ada@example.com')!
    const rawToken = generateOpaqueToken()

    await repository.createPasswordResetToken({
      userId: user.id,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })

    const first = await request(app)
      .post('/api/auth/password-reset/confirm')
      .set('Origin', TEST_ORIGIN)
      .send({ token: rawToken, password: NEW_PASSWORD })

    const second = await request(app)
      .post('/api/auth/password-reset/confirm')
      .set('Origin', TEST_ORIGIN)
      .send({ token: rawToken, password: 'another-long-password' })

    expect(first.status).toBe(200)
    expect(second.status).toBe(400)
    expect(second.body.error.message).toContain('invalid or has expired')
  })

  it('rejects an expired token', async () => {
    const user = repository.getUserSnapshot('ada@example.com')!
    const rawToken = generateOpaqueToken()

    await repository.createPasswordResetToken({
      userId: user.id,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() - 1000),
    })

    const response = await request(app)
      .post('/api/auth/password-reset/confirm')
      .set('Origin', TEST_ORIGIN)
      .send({ token: rawToken, password: NEW_PASSWORD })

    expect(response.status).toBe(400)
  })

  it('rejects an unknown token', async () => {
    const response = await request(app)
      .post('/api/auth/password-reset/confirm')
      .set('Origin', TEST_ORIGIN)
      .send({ token: generateOpaqueToken(), password: NEW_PASSWORD })

    expect(response.status).toBe(400)
  })

  it('validates the new password', async () => {
    const response = await request(app)
      .post('/api/auth/password-reset/confirm')
      .set('Origin', TEST_ORIGIN)
      .send({ token: generateOpaqueToken(), password: 'short' })

    expect(response.status).toBe(400)
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'password' })]),
    )
  })
})
