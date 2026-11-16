import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { HttpError } from '../errors/http-error.js'
import { parseCookies, SESSION_COOKIE_NAME } from '../lib/cookies.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * CSRF defence for cookie-authenticated state changes.
 *
 * Browsers attach cookies to cross-site form posts, so a mutating request that
 * authenticates via the session cookie must come from an allowed Origin.
 * Bearer-token clients are exempt because browsers do not attach those
 * automatically, and requests without a session cookie (login/register) are
 * unaffected.
 */
export function requireTrustedOrigin(allowedOrigins: string[]): RequestHandler {
  return function trustedOrigin(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): void {
    if (SAFE_METHODS.has(req.method)) {
      next()
      return
    }

    const hasSessionCookie = Boolean(
      parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME],
    )
    const usesBearerToken = Boolean(req.headers.authorization?.startsWith('Bearer '))

    if (!hasSessionCookie || usesBearerToken) {
      next()
      return
    }

    const origin = req.headers.origin

    if (!origin) {
      next(
        new HttpError(
          403,
          'Origin header is required for cookie-authenticated requests',
        ),
      )
      return
    }

    if (!allowedOrigins.includes(origin)) {
      next(new HttpError(403, `Origin is not allowed: ${origin}`))
      return
    }

    next()
  }
}
