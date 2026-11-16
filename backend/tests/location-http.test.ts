import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { HttpError } from '../src/errors/http-error.js'
import type { ReverseGeocoder } from '../src/location/types.js'
import {
  registrationBody,
  TEST_ORIGIN,
} from './helpers/auth-fixtures.js'
import { FakeAuthRepository } from './helpers/fake-auth-repository.js'
import { FakeSchoolRepository } from './helpers/fake-school-repository.js'

const KUMASI = {
  city: 'Kumasi',
  region: 'Ashanti Region',
  country: 'Ghana',
  countryCode: 'GH',
  displayName: 'Kumasi, Ashanti Region, Ghana',
}

async function setup(
  geocoder: ReverseGeocoder,
  locationRateLimit?: { windowMs?: number; max?: number },
) {
  const auth = new FakeAuthRepository()
  const schools = new FakeSchoolRepository(auth)
  const app = createApp({
    authRepository: auth,
    schoolRepository: schools,
    reverseGeocoder: geocoder,
    locationRateLimit,
  })
  const agent = request.agent(app)
  const registered = await agent
    .post('/api/auth/register-school')
    .set('Origin', TEST_ORIGIN)
    .send(
      registrationBody({
        schoolName: 'Kumasi Demo School',
        email: 'admin@kumasi-demo.test',
      }),
    )

  expect(registered.status).toBe(201)

  return { app, agent }
}

describe('location reverse geocoding HTTP surface', () => {
  it('requires an authenticated session', async () => {
    const auth = new FakeAuthRepository()
    const app = createApp({
      authRepository: auth,
      schoolRepository: new FakeSchoolRepository(auth),
      reverseGeocoder: async () => KUMASI,
    })

    const response = await request(app).get(
      '/api/location/reverse?latitude=6.6885&longitude=-1.6244',
    )

    expect(response.status).toBe(401)
  })

  it('returns the resolved place for the signed-in user', async () => {
    const calls: Array<{ latitude: number; longitude: number }> = []
    const { agent } = await setup(async (latitude, longitude) => {
      calls.push({ latitude, longitude })
      return KUMASI
    })

    const response = await agent.get(
      '/api/location/reverse?latitude=6.6885&longitude=-1.6244',
    )

    expect(response.status).toBe(200)
    expect(response.body.data.location).toEqual(KUMASI)
    expect(calls).toEqual([{ latitude: 6.6885, longitude: -1.6244 }])
    // The response must never echo precise coordinates back.
    expect(JSON.stringify(response.body)).not.toContain('6.6885')
  })

  it('rejects missing or out-of-range coordinates without calling the provider', async () => {
    let called = false
    const { agent } = await setup(async () => {
      called = true
      return KUMASI
    })

    for (const query of [
      'latitude=120&longitude=-1.6244',
      'latitude=6.6885&longitude=-200',
      'latitude=&longitude=',
      'latitude=6.6885',
      'latitude=abc&longitude=-1.6244',
    ]) {
      const response = await agent.get(`/api/location/reverse?${query}`)
      expect(response.status).toBe(400)
      expect(response.body.error.message).toBe('Validation failed')
    }

    expect(called).toBe(false)
  })

  it('reports an unavailable provider as a bad gateway', async () => {
    const { agent } = await setup(async () => {
      throw new HttpError(502, 'Reverse geocoding service is unavailable')
    })

    const response = await agent.get(
      '/api/location/reverse?latitude=6.6885&longitude=-1.6244',
    )

    expect(response.status).toBe(502)
  })

  it('rate-limits repeated lookups per user', async () => {
    const { agent } = await setup(
      async () => KUMASI,
      { windowMs: 60_000, max: 1 },
    )

    const first = await agent.get(
      '/api/location/reverse?latitude=6.6885&longitude=-1.6244',
    )
    const second = await agent.get(
      '/api/location/reverse?latitude=6.6885&longitude=-1.6244',
    )

    expect(first.status).toBe(200)
    expect(second.status).toBe(429)
  })
})
