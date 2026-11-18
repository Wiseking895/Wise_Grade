import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { getPrismaClient } from '../src/lib/prisma.js'
import type { DatabaseReadinessCheck } from '../src/routes/readiness.js'

function appWith(check: DatabaseReadinessCheck) {
  return createApp({ databaseReadinessCheck: check })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GET /api/health liveness', () => {
  it('stays healthy and no-store even when the database probe fails', async () => {
    const response = await request(
      appWith(async () => {
        throw new Error('database offline')
      }),
    ).get('/api/health')

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

describe('GET /api/ready', () => {
  it('returns 200 and connected when the database probe succeeds', async () => {
    const check = vi.fn(async () => {})
    const response = await request(appWith(check)).get('/api/ready')

    expect(check).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      status: 'ok',
      service: 'gradely-api',
      database: 'connected',
      timestamp: expect.any(String),
    })
    expect(Number.isNaN(Date.parse(response.body.timestamp))).toBe(false)
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('returns a sanitized 503 when the database probe fails', async () => {
    const connection =
      'postgresql://gradely:super-secret@db.internal.example:5432/gradely'
    const failure = Object.assign(
      new Error(`connect ECONNREFUSED ${connection}`),
      { code: 'P1001' },
    )
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await request(
      appWith(async () => {
        throw failure
      }),
    ).get('/api/ready')

    expect(response.status).toBe(503)
    expect(response.body).toEqual({
      status: 'error',
      service: 'gradely-api',
      database: 'unavailable',
      timestamp: expect.any(String),
    })
    expect(response.headers['cache-control']).toBe('no-store')

    const publicBody = JSON.stringify(response.body)
    expect(publicBody).not.toContain('super-secret')
    expect(publicBody).not.toContain('db.internal.example')
    expect(publicBody).not.toContain('ECONNREFUSED')
    expect(publicBody).not.toContain('P1001')

    expect(log).toHaveBeenCalledTimes(1)
    const logged = JSON.stringify(log.mock.calls)
    expect(logged).toContain('P1001')
    expect(logged).not.toContain('super-secret')
    expect(logged).not.toContain('db.internal.example')
  })
})

describe('root route', () => {
  it('keeps the structured 404 for the API-only root', async () => {
    const response = await request(createApp()).get('/')

    expect(response.status).toBe(404)
    expect(response.body).toEqual({
      error: {
        message: 'Route not found',
        path: '/',
      },
    })
  })
})

describe.skipIf(!env.DATABASE_URL)('shared Prisma client', () => {
  it('reuses the existing client instead of creating one per request', () => {
    expect(getPrismaClient()).toBe(getPrismaClient())
  })
})
