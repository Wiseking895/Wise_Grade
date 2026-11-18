import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'

const app = createApp()

describe('GET /api/health', () => {
  it('reports that the API is running without checking the database', async () => {
    const response = await request(app).get('/api/health')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      status: 'ok',
      service: 'gradely-api',
      database: 'not_checked',
    })
    expect(typeof response.body.timestamp).toBe('string')
    expect(typeof response.body.uptimeSeconds).toBe('number')
    expect(response.headers['cache-control']).toBe('no-store')
  })
})

describe('unknown routes', () => {
  it('returns a structured 404 response', async () => {
    const response = await request(app).get('/api/does-not-exist')

    expect(response.status).toBe(404)
    expect(response.body).toEqual({
      error: {
        message: 'Route not found',
        path: '/api/does-not-exist',
      },
    })
  })
})

describe('JSON parsing', () => {
  it('returns a 400 response for malformed JSON', async () => {
    const response = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{"invalid"')

    expect(response.status).toBe(400)
    expect(response.body).toEqual({
      error: {
        message: 'Invalid JSON payload',
      },
    })
  })
})

describe('CORS configuration', () => {
  it('allows the configured local frontend origin', async () => {
    const response = await request(app)
      .get('/api/health')
      .set('Origin', 'http://localhost:5173')

    expect(response.status).toBe(200)
    expect(response.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    )
  })

  it('rejects an origin that is not in the allowlist', async () => {
    const response = await request(app)
      .get('/api/health')
      .set('Origin', 'http://untrusted.example')

    expect(response.status).toBe(403)
    expect(response.body).toEqual({
      error: {
        message: 'Origin is not allowed: http://untrusted.example',
      },
    })
  })
})
