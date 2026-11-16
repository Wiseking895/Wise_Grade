import type { NextFunction, Request, RequestHandler, Response } from 'express'
import type {
  AuthRepository,
  SubjectSessionRecord,
} from '../auth/repository.js'
import { hashToken } from '../auth/tokens.js'
import { HttpError } from '../errors/http-error.js'
import {
  parseCookies,
  SUBJECT_SESSION_COOKIE_NAME,
} from '../lib/cookies.js'

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

/**
 * Resolves the distinct, restricted subject-session cookie into
 * `req.subjectAuth`.
 *
 * This cookie can never authenticate a school membership or a User session.
 * Only routes that explicitly mount this middleware accept it.
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
      const token = extractSubjectSessionToken(req)

      if (!token) {
        throw new HttpError(401, 'Authentication required')
      }

      const session = await repository.findSubjectSessionByTokenHash(
        hashToken(token),
      )

      if (!session || session.revokedAt !== null || session.expiresAt <= new Date()) {
        throw new HttpError(401, 'Session is invalid or has expired')
      }

      // Activity tracking must never block or fail a valid request.
      void repository.touchSubjectSession(session.id).catch(() => undefined)

      req.subjectAuth = subjectAuthContext(session)
      next()
    } catch (error) {
      next(error)
    }
  }
}

/**
 * Accepts either a normal school session or a restricted subject session.
 * `requireSchoolAccess` still verifies that the session is scoped to the exact
 * school, and routes that do not support the restricted identity are protected
 * by `denySubjectSessions`.
 */
export function createAuthenticateEither(
  repository: AuthRepository,
  authenticateUser: RequestHandler,
): RequestHandler {
  const authenticateSubject = createAuthenticateSubjectTeacher(repository)

  return function authenticateEither(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    if (extractSubjectSessionToken(req)) {
      void authenticateSubject(req, res, next)
      return
    }

    void authenticateUser(req, res, next)
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
