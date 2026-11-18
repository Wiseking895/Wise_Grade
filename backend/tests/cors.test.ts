import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { getAllowedOriginsFor } from '../src/config/env.js'
import { registrationBody, TEST_ORIGIN } from './helpers/auth-fixtures.js'
import { FakeAuthRepository } from './helpers/fake-auth-repository.js'

/**
 * CORS and credentialed-auth coverage against the real Express application and
 * the real `cors` middleware. Nothing here stubs the CORS layer; the only
 * substitution is the in-memory auth repository used by every HTTP test.
 */

const LOCAL_FRONTEND = 'http://localhost:5174'
// Reserved `.example` domain: a documentation origin, not a real deployment.
const DEPLOYED_FRONTEND = 'https://app.wise-grade.example'

const developmentOrigins = getAllowedOriginsFor({
  NODE_ENV: 'development',
  CORS_ORIGINS: 'http://localhost:5173',
  FRONTEND_URL: 'http://localhost:5173',
})

const productionOrigins = getAllowedOriginsFor({
  NODE_ENV: 'production',
  CORS_ORIGINS: DEPLOYED_FRONTEND,
  FRONTEND_URL: DEPLOYED_FRONTEND,
})

function preflight(app: ReturnType<typeof createApp>, origin: string, path = '/api/auth/login') {
  return request(app)
    .options(path)
    .set('Origin', origin)
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'content-type')
}

describe('origin allow-list configuration', () => {
  it('trusts both local Vite ports in development', () => {
    expect(developmentOrigins).toContain('http://localhost:5173')
    expect(developmentOrigins).toContain('http://localhost:5174')
    expect(developmentOrigins).toContain('http://127.0.0.1:5173')
    expect(developmentOrigins).toContain('http://127.0.0.1:5174')
  })

  it('uses only explicit deployed origins in production', () => {
    expect(productionOrigins).toEqual([DEPLOYED_FRONTEND])
    expect(productionOrigins.some((origin) => origin.includes('localhost'))).toBe(
      false,
    )
  })

  it('rejects a production localhost origin', () => {
    expect(() =>
      getAllowedOriginsFor({
        NODE_ENV: 'production',
        CORS_ORIGINS: 'http://localhost:5173',
        FRONTEND_URL: DEPLOYED_FRONTEND,
      }),
    ).toThrow(/https in production|localhost/i)
  })

  it('rejects a production FRONTEND_URL left at localhost', () => {
    expect(() =>
      getAllowedOriginsFor({
        NODE_ENV: 'production',
        CORS_ORIGINS: DEPLOYED_FRONTEND,
        FRONTEND_URL: 'http://localhost:5173',
      }),
    ).toThrow(/FRONTEND_URL/i)
  })

  it('rejects wildcards and paths in configured origins', () => {
    expect(() =>
      getAllowedOriginsFor({
        NODE_ENV: 'development',
        CORS_ORIGINS: '*',
        FRONTEND_URL: 'http://localhost:5173',
      }),
    ).toThrow(/wildcard/i)

    expect(() =>
      getAllowedOriginsFor({
        NODE_ENV: 'development',
        CORS_ORIGINS: 'http://localhost:5173/api',
        FRONTEND_URL: 'http://localhost:5173',
      }),
    ).toThrow(/origin only/i)
  })
})

describe('CORS preflight', () => {
  it('answers an allowed local origin with credentialed headers', async () => {
    const app = createApp({
      authRepository: new FakeAuthRepository(),
      allowedOrigins: developmentOrigins,
    })

    const response = await preflight(app, LOCAL_FRONTEND)

    expect(response.status).toBe(204)
    expect(response.headers['access-control-allow-origin']).toBe(LOCAL_FRONTEND)
    expect(response.headers['access-control-allow-credentials']).toBe('true')
    expect(response.headers['access-control-allow-methods']).toContain('POST')
    expect(response.headers['access-control-allow-headers']).toContain(
      'Content-Type',
    )
    // Never a wildcard, which browsers refuse to combine with credentials.
    expect(response.headers['access-control-allow-origin']).not.toBe('*')
  })

  it('answers the default development configuration on port 5174', async () => {
    // Uses the shipped configuration (no injected allow-list) to prove the
    // backend a developer actually runs trusts Vite's fallback port.
    const app = createApp({ authRepository: new FakeAuthRepository() })

    const response = await preflight(app, LOCAL_FRONTEND)

    expect(response.status).toBe(204)
    expect(response.headers['access-control-allow-origin']).toBe(LOCAL_FRONTEND)
  })

  it('answers the deployed frontend origin in production configuration', async () => {
    const app = createApp({
      authRepository: new FakeAuthRepository(),
      allowedOrigins: productionOrigins,
    })

    const response = await preflight(app, DEPLOYED_FRONTEND)

    expect(response.status).toBe(204)
    expect(response.headers['access-control-allow-origin']).toBe(
      DEPLOYED_FRONTEND,
    )
    expect(response.headers['access-control-allow-credentials']).toBe('true')
  })

  it('rejects an unauthorized origin without CORS headers', async () => {
    const app = createApp({
      authRepository: new FakeAuthRepository(),
      allowedOrigins: productionOrigins,
    })

    const response = await preflight(app, 'https://evil.example')

    expect(response.status).toBe(403)
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('exposes only the download filename header to the allowed frontend', async () => {
    const app = createApp({
      authRepository: new FakeAuthRepository(),
      allowedOrigins: productionOrigins,
    })

    const response = await request(app)
      .get('/api/auth/me')
      .set('Origin', DEPLOYED_FRONTEND)

    expect(response.headers['access-control-allow-origin']).toBe(
      DEPLOYED_FRONTEND,
    )
    expect(response.headers['access-control-expose-headers']).toContain(
      'Content-Disposition',
    )
  })

  it('rejects a localhost origin against the production configuration', async () => {
    const app = createApp({
      authRepository: new FakeAuthRepository(),
      allowedOrigins: productionOrigins,
    })

    const response = await preflight(app, TEST_ORIGIN)

    expect(response.status).toBe(403)
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('answers registration preflight for an allowed origin', async () => {
    const app = createApp({
      authRepository: new FakeAuthRepository(),
      allowedOrigins: productionOrigins,
    })

    const response = await preflight(
      app,
      DEPLOYED_FRONTEND,
      '/api/auth/register-school',
    )

    expect(response.status).toBe(204)
    expect(response.headers['access-control-allow-origin']).toBe(
      DEPLOYED_FRONTEND,
    )
  })
})

describe('credentialed authentication requests', () => {
  it('returns the session cookie and serves /api/auth/me with it', async () => {
    const app = createApp({
      authRepository: new FakeAuthRepository(),
      allowedOrigins: developmentOrigins,
    })
    const agent = request.agent(app)

    const registration = await agent
      .post('/api/auth/register-school')
      .set('Origin', LOCAL_FRONTEND)
      .send(registrationBody())

    expect(registration.status).toBe(201)
    expect(registration.headers['access-control-allow-origin']).toBe(
      LOCAL_FRONTEND,
    )
    expect(registration.headers['access-control-allow-credentials']).toBe('true')

    const me = await agent.get('/api/auth/me').set('Origin', LOCAL_FRONTEND)

    expect(me.status).toBe(200)
    expect(me.body.data.user.email).toBe('ada@example.com')
    expect(me.headers['access-control-allow-origin']).toBe(LOCAL_FRONTEND)
  })

  it('keeps the deployed frontend session across login and /api/auth/me', async () => {
    const app = createApp({
      authRepository: new FakeAuthRepository(),
      allowedOrigins: productionOrigins,
    })
    const agent = request.agent(app)

    await agent
      .post('/api/auth/register-school')
      .set('Origin', DEPLOYED_FRONTEND)
      .send(registrationBody())

    await agent.post('/api/auth/logout').set('Origin', DEPLOYED_FRONTEND)

    const login = await agent
      .post('/api/auth/login')
      .set('Origin', DEPLOYED_FRONTEND)
      .send({ email: 'ada@example.com', password: 'correct-horse-battery' })

    expect(login.status).toBe(200)
    expect(login.headers['access-control-allow-origin']).toBe(DEPLOYED_FRONTEND)
    expect(login.headers['set-cookie']).toBeTruthy()

    const me = await agent.get('/api/auth/me').set('Origin', DEPLOYED_FRONTEND)

    expect(me.status).toBe(200)
    expect(me.body.data.user.email).toBe('ada@example.com')

    const logout = await agent
      .post('/api/auth/logout')
      .set('Origin', DEPLOYED_FRONTEND)

    expect(logout.status).toBe(200)
    expect(logout.headers['access-control-allow-origin']).toBe(
      DEPLOYED_FRONTEND,
    )

    const afterLogout = await agent
      .get('/api/auth/me')
      .set('Origin', DEPLOYED_FRONTEND)

    expect(afterLogout.status).toBe(401)
  })
})
