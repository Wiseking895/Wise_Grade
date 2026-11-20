import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { SESSION_COOKIE_NAME } from '../src/lib/cookies.js'
import {
  registrationBody,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from './helpers/auth-fixtures.js'
import { FakeAuthRepository } from './helpers/fake-auth-repository.js'

async function register(
  app: ReturnType<typeof createApp>,
  agent = request(app),
) {
  return agent
    .post('/api/auth/register-school')
    .set('Origin', TEST_ORIGIN)
    .send(registrationBody())
}

describe('POST /api/auth/login', () => {
  let app: ReturnType<typeof createApp>
  let repository: FakeAuthRepository

  beforeEach(() => {
    repository = new FakeAuthRepository()
    app = createApp({ authRepository: repository })
  })

  it('signs in with valid credentials', async () => {
    await register(app)

    const response = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'ada@example.com', password: TEST_PASSWORD })

    expect(response.status).toBe(200)
    expect(response.body.data.user.email).toBe('ada@example.com')
    expect(response.body.data.memberships[0].role).toBe('SCHOOL_ADMIN')
    expect(response.body.data.user).not.toHaveProperty('passwordHash')
    expect(
      (response.headers['set-cookie'] as unknown as string[]).some((cookie) =>
        cookie.startsWith(`${SESSION_COOKIE_NAME}=`),
      ),
    ).toBe(true)
    expect(repository.auditActions()).toContain('LOGIN_SUCCEEDED')
  })

  it('accepts a case-insensitive email', async () => {
    await register(app)

    const response = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'ADA@EXAMPLE.COM', password: TEST_PASSWORD })

    expect(response.status).toBe(200)
  })

  it('rejects a wrong password with a generic message', async () => {
    await register(app)

    const response = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'ada@example.com', password: 'wrong-password-123' })

    expect(response.status).toBe(401)
    expect(response.body.error.message).toBe('Invalid email or password')
    expect(repository.sessions.size).toBe(1) // only the registration session
    expect(repository.auditActions()).toContain('LOGIN_FAILED')
  })

  it('returns the same message for an unknown email', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'nobody@example.com', password: TEST_PASSWORD })

    expect(response.status).toBe(401)
    expect(response.body.error.message).toBe('Invalid email or password')
  })

  it('rejects inactive accounts', async () => {
    const user = await repository.createUser({
      email: 'inactive@example.com',
      password: TEST_PASSWORD,
      isActive: false,
    })

    expect(user.isActive).toBe(false)

    const response = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'inactive@example.com', password: TEST_PASSWORD })

    expect(response.status).toBe(401)
    expect(response.body.error.message).toBe('Invalid email or password')
  })

  it('validates the request body', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'not-an-email' })

    expect(response.status).toBe(400)
    expect(response.body.error.message).toBe('Validation failed')
  })
})

describe('login rate limiting', () => {
  it('blocks repeated failed attempts for the same IP and email', async () => {
    const repository = new FakeAuthRepository()
    const app = createApp({
      authRepository: repository,
      loginRateLimit: { windowMs: 60_000, max: 3 },
    })

    await register(app)

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await request(app)
        .post('/api/auth/login')
        .set('Origin', TEST_ORIGIN)
        .send({ email: 'ada@example.com', password: 'wrong-password-123' })

      expect(response.status).toBe(401)
    }

    const limited = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'ada@example.com', password: 'wrong-password-123' })

    expect(limited.status).toBe(429)
    expect(limited.body.error.message).toContain('Too many login attempts')
    expect(limited.headers['retry-after']).toBeDefined()
  })

  it('clears the counter after a successful login', async () => {
    const repository = new FakeAuthRepository()
    const app = createApp({
      authRepository: repository,
      loginRateLimit: { windowMs: 60_000, max: 3 },
    })

    await register(app)

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await request(app)
        .post('/api/auth/login')
        .set('Origin', TEST_ORIGIN)
        .send({ email: 'ada@example.com', password: 'wrong-password-123' })
    }

    const success = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'ada@example.com', password: TEST_PASSWORD })

    expect(success.status).toBe(200)

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const response = await request(app)
        .post('/api/auth/login')
        .set('Origin', TEST_ORIGIN)
        .send({ email: 'ada@example.com', password: 'wrong-password-123' })

      expect(response.status).toBe(401)
    }
  })
})

describe('GET /api/auth/me', () => {
  let app: ReturnType<typeof createApp>
  let repository: FakeAuthRepository

  beforeEach(() => {
    repository = new FakeAuthRepository()
    app = createApp({ authRepository: repository })
  })

  it('requires authentication', async () => {
    const response = await request(app).get('/api/auth/me')

    expect(response.status).toBe(401)
    expect(response.body.error.message).toBe('Authentication required')
    expect(response.body.error.code).toBe('auth_missing')
  })

  it('returns the authenticated profile and memberships', async () => {
    const agent = request.agent(app)
    await register(app, agent)

    const response = await agent.get('/api/auth/me')

    expect(response.status).toBe(200)
    expect(response.body.data.user.email).toBe('ada@example.com')
    expect(response.body.data.memberships).toHaveLength(1)
    expect(response.body.data.memberships[0].role).toBe('SCHOOL_ADMIN')
  })

  it('accepts a Bearer token as an alternative to the cookie', async () => {
    await register(app)
    const user = repository.getUserSnapshot('ada@example.com')
    const token = await repository.issueSessionFor(user!.id)

    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)

    expect(response.status).toBe(200)
    expect(response.body.data.user.email).toBe('ada@example.com')
  })

  it('rejects an expired session', async () => {
    await register(app)
    const user = repository.getUserSnapshot('ada@example.com')
    const token = await repository.issueSessionFor(user!.id, {
      expiresAt: new Date(Date.now() - 1000),
    })

    const response = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`)

    expect(response.status).toBe(401)
    expect(response.body.error.message).toBe(
      'Session is invalid or has expired',
    )
    expect(response.body.error.code).toBe('session_expired')
  })

  it('rejects a revoked session', async () => {
    await register(app)
    const user = repository.getUserSnapshot('ada@example.com')
    const token = await repository.issueSessionFor(user!.id)

    for (const session of repository.sessions.values()) {
      session.revokedAt = new Date()
    }

    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)

    expect(response.status).toBe(401)
  })
})

describe('POST /api/auth/logout', () => {
  let app: ReturnType<typeof createApp>
  let repository: FakeAuthRepository

  beforeEach(() => {
    repository = new FakeAuthRepository()
    app = createApp({ authRepository: repository })
  })

  it('revokes the session, clears the cookie, and blocks reuse', async () => {
    const agent = request.agent(app)
    await register(app, agent)

    const logout = await agent
      .post('/api/auth/logout')
      .set('Origin', TEST_ORIGIN)

    expect(logout.status).toBe(200)
    expect(logout.body.data.message).toBe('Signed out')

    const clearedCookie = (
      logout.headers['set-cookie'] as unknown as string[]
    ).find((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`))

    expect(clearedCookie).toContain('Expires=Thu, 01 Jan 1970')

    const me = await agent.get('/api/auth/me')
    expect(me.status).toBe(401)

    const sessions = [...repository.sessions.values()]
    expect(sessions.every((session) => session.revokedAt !== null)).toBe(true)
  })

  it('rejects cookie-authenticated logout without a trusted Origin', async () => {
    const agent = request.agent(app)
    await register(app, agent)

    const response = await agent.post('/api/auth/logout')

    expect(response.status).toBe(403)
    expect(response.body.error.message).toContain('Origin header is required')
  })

  it('rejects cookie-authenticated logout from an untrusted Origin', async () => {
    const agent = request.agent(app)
    await register(app, agent)

    const response = await agent
      .post('/api/auth/logout')
      .set('Origin', 'http://evil.example')

    expect(response.status).toBe(403)
    expect(response.body.error.message).toBe(
      'Origin is not allowed: http://evil.example',
    )
  })

  it('allows Bearer-token clients without an Origin header', async () => {
    await register(app)
    const user = repository.getUserSnapshot('ada@example.com')
    const token = await repository.issueSessionFor(user!.id)

    const response = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`)

    expect(response.status).toBe(200)
  })
})
