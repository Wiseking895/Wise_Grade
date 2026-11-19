import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { hashToken } from '../src/auth/tokens.js'
import { registrationBody, TEST_ORIGIN, TEST_PASSWORD } from './helpers/auth-fixtures.js'
import { CaptureEmailService } from './helpers/capture-email-service.js'
import { FakeAuthRepository } from './helpers/fake-auth-repository.js'
import { FakeSchoolRepository } from './helpers/fake-school-repository.js'

/**
 * Administrator email-verification behaviour.
 *
 * The HTTP layer, middleware, repository interface and email service are real.
 * Persistence and SMTP are deterministic test doubles, so no message leaves the
 * process and no plaintext token is ever exposed through an API response.
 */
describe('administrator email verification', () => {
  let auth: FakeAuthRepository
  let schools: FakeSchoolRepository
  let email: CaptureEmailService
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    auth = new FakeAuthRepository({ requireAdminEmailVerification: true })
    schools = new FakeSchoolRepository(auth)
    email = new CaptureEmailService()
    app = createApp({
      authRepository: auth,
      schoolRepository: schools,
      emailService: email,
      emailVerificationRateLimit: { windowMs: 60_000, max: 2 },
    })
  })

  async function register(overrides: Record<string, string> = {}) {
    const agent = request.agent(app)
    const response = await agent
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(
        registrationBody({
          email: 'admin@verification.test',
          schoolName: 'Verification Academy',
          ...overrides,
        }),
      )

    expect(response.status).toBe(201)
    const schoolId = response.body.data.school.id as string

    schools.seedSchool({
      id: schoolId,
      name: 'Verification Academy',
      slug: response.body.data.school.slug as string,
      email: response.body.data.user.email as string,
    })
    schools.seedDefaults(schoolId, response.body.data.user.id as string)

    return { agent, response, schoolId }
  }

  it('emails a hashed single-use link and verifies the administrator', async () => {
    const { agent, response, schoolId } = await register()

    expect(response.body.data.user.emailVerified).toBe(false)
    expect(response.body.data.user.emailVerificationRequired).toBe(true)
    expect(response.body.data.user.mustChangePassword).toBe(false)

    const welcome = email.last('admin-welcome')
    expect(welcome).toBeDefined()
    expect(welcome?.to).toBe('admin@verification.test')
    expect(String(welcome?.data.verificationUrl)).toContain('/verify-email?token=')

    const token = email.verificationToken('admin-welcome')
    const stored = auth.verificationTokens.get(hashToken(token))
    expect(stored).toBeDefined()
    // Only the SHA-256 hash is persisted; the raw token is never stored.
    expect(auth.verificationTokens.has(token)).toBe(false)
    expect(stored?.expiresAt.getTime()).toBeGreaterThan(Date.now())
    expect(stored!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(
      24 * 60 * 60 * 1000 + 1_000,
    )

    const confirm = await request(app)
      .post('/api/auth/email-verification/confirm')
      .set('Origin', TEST_ORIGIN)
      .send({ token })

    expect(confirm.status).toBe(200)
    expect(confirm.body.data.user.emailVerified).toBe(true)
    expect(confirm.body.data.user.emailVerificationRequired).toBe(false)
    expect(auth.getUserSnapshot('admin@verification.test')?.emailVerifiedAt).toBeTruthy()

    // A confirmation message is sent once, and it never contains the token.
    const verifiedEmail = email.last('admin-verified')
    expect(verifiedEmail).toBeDefined()
    expect(JSON.stringify(verifiedEmail?.data)).not.toContain(token)

    const profile = await agent.get(`/api/schools/${schoolId}/profile`)
    expect(profile.status).toBe(200)
  })

  it('rejects an invalid verification token', async () => {
    await register()

    const confirm = await request(app)
      .post('/api/auth/email-verification/confirm')
      .set('Origin', TEST_ORIGIN)
      .send({ token: 'x'.repeat(32) })

    expect(confirm.status).toBe(400)
    expect(confirm.body.error.message).toMatch(/invalid|expired|already been used/i)
  })

  it('rejects an expired verification token', async () => {
    await register()
    const token = email.verificationToken('admin-welcome')
    const stored = auth.verificationTokens.get(hashToken(token))
    stored!.expiresAt = new Date(Date.now() - 1_000)

    const confirm = await request(app)
      .post('/api/auth/email-verification/confirm')
      .set('Origin', TEST_ORIGIN)
      .send({ token })

    expect(confirm.status).toBe(400)
    expect(auth.getUserSnapshot('admin@verification.test')?.emailVerifiedAt).toBeNull()
  })

  it('rejects a reused verification token', async () => {
    await register()
    const token = email.verificationToken('admin-welcome')

    const first = await request(app)
      .post('/api/auth/email-verification/confirm')
      .set('Origin', TEST_ORIGIN)
      .send({ token })
    expect(first.status).toBe(200)

    const second = await request(app)
      .post('/api/auth/email-verification/confirm')
      .set('Origin', TEST_ORIGIN)
      .send({ token })
    expect(second.status).toBe(400)
  })

  it('invalidates the previous link when a new one is requested', async () => {
    const { agent } = await register()
    const firstToken = email.verificationToken('admin-welcome')

    const resend = await agent
      .post('/api/auth/email-verification/resend')
      .set('Origin', TEST_ORIGIN)
    expect(resend.status).toBe(202)

    const secondToken = email.verificationToken('admin-verification-resend')
    expect(secondToken).not.toBe(firstToken)

    const oldLink = await request(app)
      .post('/api/auth/email-verification/confirm')
      .set('Origin', TEST_ORIGIN)
      .send({ token: firstToken })
    expect(oldLink.status).toBe(400)

    const newLink = await request(app)
      .post('/api/auth/email-verification/confirm')
      .set('Origin', TEST_ORIGIN)
      .send({ token: secondToken })
    expect(newLink.status).toBe(200)
  })

  it('rate-limits repeated resend requests', async () => {
    const { agent } = await register()

    const first = await agent
      .post('/api/auth/email-verification/resend')
      .set('Origin', TEST_ORIGIN)
    const second = await agent
      .post('/api/auth/email-verification/resend')
      .set('Origin', TEST_ORIGIN)
    const third = await agent
      .post('/api/auth/email-verification/resend')
      .set('Origin', TEST_ORIGIN)

    expect(first.status).toBe(202)
    expect(second.status).toBe(202)
    expect(third.status).toBe(429)
  })

  it('blocks school administration until the administrator is verified', async () => {
    const { agent, schoolId } = await register()

    const blocked = await agent.get(`/api/schools/${schoolId}/profile`)
    expect(blocked.status).toBe(403)
    expect(blocked.body.error.message).toMatch(/verify your email/i)

    const token = email.verificationToken('admin-welcome')
    await request(app)
      .post('/api/auth/email-verification/confirm')
      .set('Origin', TEST_ORIGIN)
      .send({ token })

    const allowed = await agent.get(`/api/schools/${schoolId}/profile`)
    expect(allowed.status).toBe(200)
  })

  it('leaves an existing verified administrator and platform administrator unaffected', async () => {
    // A pre-existing account has no verification requirement, matching the
    // migration default for every current school administrator.
    const existing = await auth.createUser({
      email: 'existing@verification.test',
      password: TEST_PASSWORD,
      isPlatformAdmin: false,
    })
    expect(existing.emailVerificationRequired).toBe(false)

    const platform = await auth.createUser({
      email: 'platform@verification.test',
      password: TEST_PASSWORD,
      isPlatformAdmin: true,
    })
    expect(platform.emailVerificationRequired).toBe(false)

    const existingLogin = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'existing@verification.test', password: TEST_PASSWORD })
    expect(existingLogin.status).toBe(200)
    expect(existingLogin.body.data.user.emailVerificationRequired).toBe(false)

    const platformAgent = request.agent(app)
    const platformLogin = await platformAgent
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'platform@verification.test', password: TEST_PASSWORD })
    expect(platformLogin.status).toBe(200)

    // The platform SMTP test route is platform-admin-only and must not be
    // blocked by an email-verification gate that never applied to it.
    const smtpTest = await platformAgent
      .post('/api/platform/email/test')
      .set('Origin', TEST_ORIGIN)
      .send({})
    expect(smtpTest.status).toBe(200)
  })
})
