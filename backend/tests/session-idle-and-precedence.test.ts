import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { hashToken } from '../src/auth/tokens.js'
import { SESSION_COOKIE_NAME, SUBJECT_SESSION_COOKIE_NAME } from '../src/lib/cookies.js'
import { createAuthenticate } from '../src/middleware/authenticate.js'
import { createAuthenticateEither } from '../src/middleware/subject-authenticate.js'
import { HttpError } from '../src/errors/http-error.js'
import { registrationBody, TEST_ORIGIN } from './helpers/auth-fixtures.js'
import { FakeAuthRepository } from './helpers/fake-auth-repository.js'
import { createApp } from '../src/app.js'

/**
 * Regression coverage for the two production failures that shared a cause:
 *
 * - A stale restricted-subject cookie must never hide a valid account session,
 *   which previously made attendance, attitude and teacher remarks fail with a
 *   403 before the reports router saw the request.
 * - The server, not a browser timer, enforces inactivity for both identities.
 */

function identityProbe(repository: FakeAuthRepository, either: boolean): Express {
  const app = express()

  app.get(
    '/probe',
    either
      ? createAuthenticateEither(repository, createAuthenticate(repository))
      : createAuthenticate(repository),
    (req: Request, res: Response) => {
      res.status(200).json({
        data: {
          accountUserId: req.auth?.user.id ?? null,
          subjectSessionId: req.subjectAuth?.sessionId ?? null,
        },
      })
    },
  )

  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      const status = error instanceof HttpError ? error.statusCode : 500
      const code = error instanceof HttpError ? error.code ?? null : null
      res.status(status).json({ error: { code } })
    },
  )

  return app
}

async function registerAccount(app: ReturnType<typeof createApp>) {
  const response = await request(app)
    .post('/api/auth/register-school')
    .set('Origin', TEST_ORIGIN)
    .send(registrationBody())

  expect(response.status).toBe(201)

  const cookies = (response.headers['set-cookie'] ?? []) as unknown as string[]
  const sessionCookie = cookies.find((cookie) =>
    cookie.startsWith(`${SESSION_COOKIE_NAME}=`),
  )

  expect(sessionCookie).toBeDefined()

  return sessionCookie!.split(';')[0]!
}

function addSubjectSession(
  repository: FakeAuthRepository,
  schoolId: string,
  token: string,
  overrides: { lastUsedAt?: Date } = {},
) {
  const now = new Date()

  repository.subjectSessions.set(hashToken(token), {
    id: crypto.randomUUID(),
    tokenHash: hashToken(token),
    accessCodeId: null,
    assignmentId: crypto.randomUUID(),
    schoolId,
    classId: crypto.randomUUID(),
    subjectId: crypto.randomUUID(),
    className: 'Basic 4',
    subjectName: 'Mathematics',
    firstName: 'Ama',
    lastName: 'Mensah',
    email: 'ama@example.com',
    phone: null,
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    revokedAt: null,
    lastUsedAt: overrides.lastUsedAt ?? now,
  })
}

describe('session identity precedence', () => {
  it('keeps a valid account session when a stale subject cookie is also present', async () => {
    const repository = new FakeAuthRepository()
    const app = createApp({ authRepository: repository })
    const accountCookie = await registerAccount(app)
    const schoolId = [...repository.schools.values()][0]!.id
    const subjectToken = 'subject-token-precedence'

    addSubjectSession(repository, schoolId, subjectToken)
    const accountSession = [...repository.sessions.values()][0]!

    const response = await request(identityProbe(repository, true))
      .get('/probe')
      .set(
        'Cookie',
        `${accountCookie}; ${SUBJECT_SESSION_COOKIE_NAME}=${subjectToken}`,
      )

    expect(response.status).toBe(200)
    expect(response.body.data.accountUserId).toBe(accountSession.userId)
    expect(response.body.data.subjectSessionId).toBeNull()
  })

  it('falls back to a valid subject session when the account cookie is rejected', async () => {
    const repository = new FakeAuthRepository()
    const app = createApp({ authRepository: repository })
    await registerAccount(app)
    const schoolId = [...repository.schools.values()][0]!.id
    const subjectToken = 'subject-token-fallback'

    addSubjectSession(repository, schoolId, subjectToken)

    const response = await request(identityProbe(repository, true))
      .get('/probe')
      .set(
        'Cookie',
        `${SESSION_COOKIE_NAME}=expired-or-unknown; ${SUBJECT_SESSION_COOKIE_NAME}=${subjectToken}`,
      )

    expect(response.status).toBe(200)
    expect(response.body.data.accountUserId).toBeNull()
    expect(response.body.data.subjectSessionId).not.toBeNull()
  })
})

describe('server-enforced inactivity', () => {
  it('rejects an account session that has been idle beyond the limit', async () => {
    const repository = new FakeAuthRepository()
    const app = createApp({ authRepository: repository })
    const accountCookie = await registerAccount(app)
    const session = [...repository.sessions.values()][0]!

    session.lastUsedAt = new Date(Date.now() - 61_000)

    const response = await request(identityProbe(repository, false))
      .get('/probe')
      .set('Cookie', accountCookie)

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('session_idle_timeout')
  })

  it('accepts an account session used within the limit', async () => {
    const repository = new FakeAuthRepository()
    const app = createApp({ authRepository: repository })
    const accountCookie = await registerAccount(app)
    const session = [...repository.sessions.values()][0]!

    session.lastUsedAt = new Date(Date.now() - 30_000)

    const response = await request(identityProbe(repository, false))
      .get('/probe')
      .set('Cookie', accountCookie)

    expect(response.status).toBe(200)
  })

  it('rejects an idle restricted subject session too', async () => {
    const repository = new FakeAuthRepository()
    const app = createApp({ authRepository: repository })
    await registerAccount(app)
    const schoolId = [...repository.schools.values()][0]!.id
    const subjectToken = 'idle-subject-token'

    addSubjectSession(repository, schoolId, subjectToken, {
      lastUsedAt: new Date(Date.now() - 61_000),
    })

    const response = await request(identityProbe(repository, true))
      .get('/probe')
      .set('Cookie', `${SUBJECT_SESSION_COOKIE_NAME}=${subjectToken}`)

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('session_idle_timeout')
  })
})
