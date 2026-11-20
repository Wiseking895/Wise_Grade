import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { registrationBody, TEST_ORIGIN } from './helpers/auth-fixtures.js'
import { FakeAuthRepository } from './helpers/fake-auth-repository.js'

/**
 * Stable API error codes let the browser distinguish causes that share an HTTP
 * status. In particular, a blocked third-party cookie must not be described as
 * a normal expired session, and an origin rejection must not be described as
 * "Authentication required".
 */
describe('authentication error codes', () => {
  let app: ReturnType<typeof createApp>
  let agent: ReturnType<typeof request.agent>

  beforeEach(async () => {
    app = createApp({ authRepository: new FakeAuthRepository() })
    agent = request.agent(app)

    const registration = await agent
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(registrationBody())

    expect(registration.status).toBe(201)
  })

  it('distinguishes a missing session cookie from an expired session', async () => {
    const missing = await request(app)
      .post('/api/auth/change-password')
      .set('Origin', TEST_ORIGIN)
      .send({
        currentPassword: 'anything-long-enough',
        newPassword: 'AnotherPass123',
      })

    expect(missing.status).toBe(401)
    expect(missing.body.error.code).toBe('auth_missing')
    expect(missing.body.error.message).toBe('Authentication required')
  })

  it('reports a missing CSRF origin as an origin failure, not authentication', async () => {
    const response = await agent.post('/api/auth/logout')

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('csrf_origin_missing')
    expect(response.body.error.message).not.toBe('Authentication required')
  })

  it('reports an incorrect current password separately from an expired session', async () => {
    const response = await agent
      .post('/api/auth/change-password')
      .set('Origin', TEST_ORIGIN)
      .send({
        currentPassword: 'not-the-current-password',
        newPassword: 'AnotherPass123',
      })

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('password_invalid')
    expect(response.body.error.details).toEqual([
      expect.objectContaining({ field: 'currentPassword' }),
    ])
  })
})
