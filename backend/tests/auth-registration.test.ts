import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { verifyPassword } from '../src/auth/password.js'
import { SESSION_COOKIE_NAME } from '../src/lib/cookies.js'
import { registrationBody, TEST_ORIGIN } from './helpers/auth-fixtures.js'
import { FakeAuthRepository } from './helpers/fake-auth-repository.js'

describe('POST /api/auth/register-school', () => {
  let app: ReturnType<typeof createApp>
  let repository: FakeAuthRepository

  beforeEach(() => {
    repository = new FakeAuthRepository()
    app = createApp({ authRepository: repository })
  })

  it('creates the school, administrator, and membership together', async () => {
    const response = await request(app)
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(registrationBody())

    expect(response.status).toBe(201)
    expect(response.body.data.user).toMatchObject({
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Obi',
      isPlatformAdmin: false,
    })
    expect(response.body.data.school).toMatchObject({
      name: 'Green Valley Academy',
      isActive: true,
    })
    expect(response.body.data.memberships).toHaveLength(1)
    expect(response.body.data.memberships[0]).toMatchObject({
      schoolId: response.body.data.school.id,
      role: 'SCHOOL_ADMIN',
      status: 'ACTIVE',
    })

    expect(repository.schools.size).toBe(1)
    expect(repository.users.size).toBe(1)
    expect(repository.memberships.size).toBe(1)
    expect(repository.sessions.size).toBe(1)
    expect(repository.auditActions()).toContain('SCHOOL_REGISTERED')
  })

  it('hashes the password and never returns it', async () => {
    const body = registrationBody()
    const response = await request(app)
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(body)

    expect(JSON.stringify(response.body)).not.toContain(body.password)
    expect(response.body.data.user).not.toHaveProperty('passwordHash')

    const stored = repository.getUserSnapshot(body.email)

    expect(stored).toBeDefined()
    expect(stored?.passwordHash).not.toBe(body.password)
    expect(stored?.passwordHash.startsWith('scrypt$')).toBe(true)
    expect(await verifyPassword(body.password, stored!.passwordHash)).toBe(true)
  })

  it('sets an HttpOnly session cookie', async () => {
    const response = await request(app)
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(registrationBody())

    const cookies = response.headers['set-cookie'] as unknown as string[]
    const sessionCookie = cookies.find((cookie) =>
      cookie.startsWith(`${SESSION_COOKIE_NAME}=`),
    )

    expect(sessionCookie).toBeDefined()
    expect(sessionCookie).toContain('HttpOnly')
    expect(sessionCookie).toContain('Path=/')
    expect(sessionCookie).not.toContain('Secure')
  })

  it('normalizes the email to lowercase', async () => {
    const response = await request(app)
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(registrationBody({ email: 'ADA@Example.COM' }))

    expect(response.status).toBe(201)
    expect(response.body.data.user.email).toBe('ada@example.com')
  })

  it('rejects privileged fields such as role and isPlatformAdmin', async () => {
    const response = await request(app)
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send({
        ...registrationBody(),
        role: 'PLATFORM_SUPER_ADMIN',
        isPlatformAdmin: true,
      })

    expect(response.status).toBe(400)
    expect(response.body.error.message).toBe('Validation failed')
    expect(repository.users.size).toBe(0)
    expect(repository.schools.size).toBe(0)
  })

  it('rejects duplicate email addresses without creating another school', async () => {
    await request(app)
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(registrationBody())

    const duplicate = await request(app)
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(registrationBody({ schoolName: 'Second School' }))

    expect(duplicate.status).toBe(409)
    expect(duplicate.body.error.message).toBe(
      'An account with this email already exists',
    )
    expect(repository.schools.size).toBe(1)
    expect(repository.users.size).toBe(1)
  })

  it('returns field-level validation details', async () => {
    const response = await request(app)
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(registrationBody({ email: 'not-an-email', password: 'short' }))

    expect(response.status).toBe(400)
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'email' }),
        expect.objectContaining({ field: 'password' }),
      ]),
    )
  })

  it('leaves no partial records when school creation fails', async () => {
    repository.failNextSchoolCreation = true

    const response = await request(app)
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(registrationBody())

    expect(response.status).toBe(500)
    expect(repository.schools.size).toBe(0)
    expect(repository.users.size).toBe(0)
    expect(repository.memberships.size).toBe(0)
    expect(repository.sessions.size).toBe(0)
  })

  it('rate limits public school registration per client', async () => {
    const limitedApp = createApp({
      authRepository: repository,
      registrationRateLimit: { windowMs: 60_000, max: 2 },
    })

    const first = await request(limitedApp)
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(
        registrationBody({
          schoolName: 'Rate Limit One',
          email: 'one@example.com',
        }),
      )
    const second = await request(limitedApp)
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(
        registrationBody({
          schoolName: 'Rate Limit Two',
          email: 'two@example.com',
        }),
      )
    const third = await request(limitedApp)
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(
        registrationBody({
          schoolName: 'Rate Limit Three',
          email: 'three@example.com',
        }),
      )

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(third.status).toBe(429)
    expect(third.body.error.message).toContain('Too many registration attempts')
    expect(third.headers['retry-after']).toBeDefined()
    expect(repository.schools.size).toBe(2)
  })
})
