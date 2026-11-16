import type { NextFunction, Request, Response } from 'express'
import type {
  AuthRepository,
  MembershipRecord,
  UserRecord,
} from '../auth/repository.js'
import { usableMemberships } from '../auth/membership-access.js'
import { hashToken } from '../auth/tokens.js'
import { HttpError } from '../errors/http-error.js'
import { parseCookies, SESSION_COOKIE_NAME } from '../lib/cookies.js'

export interface AuthContext {
  user: UserRecord
  memberships: MembershipRecord[]
  sessionId: string
  /** True when the request authenticated with the HttpOnly session cookie. */
  viaCookie: boolean
}

export function extractSessionToken(
  req: Request,
): { token: string; viaCookie: boolean } | null {
  const header = req.headers.authorization

  if (header?.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim()

    if (token) {
      return { token, viaCookie: false }
    }
  }

  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME]

  if (token) {
    return { token, viaCookie: true }
  }

  return null
}

/**
 * Resolves the session cookie (or Bearer token) into `req.auth`.
 *
 * Sessions are opaque, server-side, and stored as hashes. Expired, revoked,
 * unknown, or inactive-user sessions all produce the same generic 401 so
 * clients cannot probe account state.
 */
export function createAuthenticate(repository: AuthRepository) {
  return async function authenticate(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const extracted = extractSessionToken(req)

      if (!extracted) {
        throw new HttpError(401, 'Authentication required')
      }

      const session = await repository.findSessionByTokenHash(
        hashToken(extracted.token),
      )
      const now = new Date()

      if (
        !session ||
        session.revokedAt !== null ||
        session.expiresAt <= now ||
        !session.user.isActive
      ) {
        throw new HttpError(401, 'Session is invalid or has expired')
      }

      const context = await repository.findUserWithMemberships(session.user.id)

      if (!context || !context.user.isActive) {
        throw new HttpError(401, 'Session is invalid or has expired')
      }

      // Activity tracking must never block or fail a valid request.
      void repository.touchSession(session.id).catch(() => undefined)

      req.auth = {
        user: context.user,
        // Only memberships that currently grant access are exposed. A user who
        // belongs to several schools keeps the ones whose school is active; a
        // suspended school simply disappears from the list instead of leaking
        // suspension state or disabling the whole account.
        memberships: usableMemberships(context.memberships),
        sessionId: session.id,
        viaCookie: extracted.viaCookie,
      }

      next()
    } catch (error) {
      next(error)
    }
  }
}
