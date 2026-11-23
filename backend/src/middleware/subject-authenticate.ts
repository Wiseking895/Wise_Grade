import type { NextFunction, Request, RequestHandler, Response } from 'express'
import type {
  AuthRepository,
  SubjectSessionRecord,
} from '../auth/repository.js'
import { hashToken } from '../auth/tokens.js'
import { env } from '../config/env.js'
import { HttpError } from '../errors/http-error.js'
import {
  parseCookies,
  SUBJECT_SESSION_COOKIE_NAME,
} from '../lib/cookies.js'
import {
  extractSessionToken,
  resolveAccountAuth,
} from './authenticate.js'

export interface SubjectAuthContext {
  sessionId: string
  accessCodeId: string | null
  assignmentId: string
  schoolId: string
  schoolName: string
  schoolSlug: string
  classId: string
  className: string
  subjectId: string
  subjectName: string
  teacher: SubjectSessionRecord['teacher']
  expiresAt: Date
}

export function extractSubjectSessionToken(req: Request): string | null {
  const token = parseCookies(req.headers.cookie)[SUBJECT_SESSION_COOKIE_NAME]

  return token || null
}

export function subjectAuthContext(
  session: SubjectSessionRecord,
): SubjectAuthContext {
  return {
    sessionId: session.id,
    accessCodeId: session.accessCodeId,
    assignmentId: session.assignmentId,
    schoolId: session.schoolId,
    schoolName: session.schoolName,
    schoolSlug: session.schoolSlug,
    classId: session.classId,
    className: session.className,
    subjectId: session.subjectId,
    subjectName: session.subjectName,
    teacher: session.teacher,
    expiresAt: session.expiresAt,
  }
}

function subjectIdleError(): HttpError {
  return new HttpError(
    401,
    'Your session expired after a period of inactivity',
    undefined,
    'session_idle_timeout',
  )
}

/**
 * Resolves the distinct, restricted subject-session cookie. This cookie can
 * never authenticate a school membership or a User session.
 */
export async function resolveSubjectAuth(
  repository: AuthRepository,
  req: Request,
): Promise<SubjectAuthContext> {
  const token = extractSubjectSessionToken(req)

  if (!token) {
    throw new HttpError(401, 'Authentication required', undefined, 'auth_missing')
  }

  const session = await repository.findSubjectSessionByTokenHash(
    hashToken(token),
  )
  const now = new Date()
  const idleTimeoutMs = env.AUTH_IDLE_TIMEOUT_SECONDS * 1000

  if (!session || session.revokedAt !== null || session.expiresAt <= now) {
    throw new HttpError(
      401,
      'Session is invalid or has expired',
      undefined,
      'session_expired',
    )
  }

  if (
    !session.lastUsedAt ||
    now.getTime() - session.lastUsedAt.getTime() >= idleTimeoutMs
  ) {
    throw subjectIdleError()
  }

  // Activity tracking must never block or fail a valid request.
  void repository.touchSubjectSession(session.id).catch(() => undefined)

  return subjectAuthContext(session)
}

/**
 * Resolves the restricted subject-session cookie into `req.subjectAuth`.
 */
export function createAuthenticateSubjectTeacher(
  repository: AuthRepository,
): RequestHandler {
  return async function authenticateSubjectTeacher(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      req.subjectAuth = await resolveSubjectAuth(repository, req)
      next()
    } catch (error) {
      next(error)
    }
  }
}

/**
 * Accepts either a normal school session or a restricted subject session.
 *
 * A normal account session always wins when both cookies are present. A stale
 * subject cookie left in the browser must never mask a valid class-teacher
 * account session; doing so previously made attendance, attitude and teacher
 * remarks fail with a 403 because the request was scoped to the restricted
 * subject identity. Only when the account session is genuinely absent or
 * rejected do we fall back to the subject cookie.
 *
 * `requireSchoolAccess` still verifies that the session is scoped to the exact
 * school, and routes that do not support the restricted identity are protected
 * by `denySubjectSessions`.
 */
export function createAuthenticateEither(
  repository: AuthRepository,
  _authenticateUser: RequestHandler,
): RequestHandler {
  return async function authenticateEither(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const hasAccountSession = extractSessionToken(req) !== null
      const hasSubjectSession = extractSubjectSessionToken(req) !== null

      if (hasAccountSession) {
        try {
          req.auth = await resolveAccountAuth(repository, req)
          next()
          return
        } catch (error) {
          // An expired/revoked account cookie should not block a still-valid
          // restricted session. Any other failure (for example a required
          // password change) is a real refusal and must not be bypassed.
          if (
            !hasSubjectSession ||
            !(error instanceof HttpError) ||
            error.statusCode !== 401
          ) {
            throw error
          }
        }
      }

      if (hasSubjectSession) {
        req.subjectAuth = await resolveSubjectAuth(repository, req)
        next()
        return
      }

      throw new HttpError(
        401,
        'Authentication required',
        undefined,
        'auth_missing',
      )
    } catch (error) {
      next(error)
    }
  }
}

/** Rejects the restricted identity on every route that is not explicitly scoped for it. */
export function denySubjectSessions(): RequestHandler {
  return function denySubjectSession(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): void {
    if (req.subjectAuth) {
      next(new HttpError(403, 'Your subject-teacher session cannot access this resource'))
      return
    }

    next()
  }
}
