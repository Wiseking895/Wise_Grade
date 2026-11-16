import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { registrationBody, TEST_ORIGIN } from './helpers/auth-fixtures.js'

describe.skipIf(Boolean(env.DATABASE_URL))(
  'database not configured',
  () => {
    const app = createApp()

    it('still serves the health endpoint', async () => {
      const response = await request(app).get('/api/health')

      expect(response.status).toBe(200)
      expect(response.body.database).toBe('not_checked')
    })

    it('returns a clear 503 for database-backed endpoints', async () => {
      const response = await request(app)
        .post('/api/auth/register-school')
        .set('Origin', TEST_ORIGIN)
        .send(registrationBody())

      expect(response.status).toBe(503)
      expect(response.body.error.message).toContain('Database is not configured')
    })

    it('still requires authentication for protected routes', async () => {
      const response = await request(app).get('/api/auth/me')

      expect(response.status).toBe(401)
    })
  },
)
