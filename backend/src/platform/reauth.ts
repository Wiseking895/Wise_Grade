import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { hashToken } from '../auth/tokens.js'
import { env } from '../config/env.js'
import { HttpError } from '../errors/http-error.js'
import type { PlatformOperationsRepository } from './operations-repository.js'

export const REAUTH_HEADER = 'X-Platform-Reauth'

/**
 * Sensitive platform actions require a short-lived, single-use grant obtained by
 * re-entering the password (and MFA when enabled). Tests can opt in to the same
 * enforcement with PLATFORM_REAUTH_ENFORCED=true; otherwise credential-free
 * HTTP tests would need to mint a grant for every action.
 */
export function createRequireReauth(
  operations: PlatformOperationsRepository,
  purpose: string,
): RequestHandler {
  return async function requireReauth(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (
        env.NODE_ENV === 'test' &&
        process.env.PLATFORM_REAUTH_ENFORCED !== 'true'
      ) {
        next()
        return
      }

      if (!req.auth) {
        throw new HttpError(401, 'Authentication required')
      }

      const raw = req.get(REAUTH_HEADER)

      if (!raw || raw.trim() === '') {
        throw new HttpError(
          428,
          'Reauthentication required. Confirm your password before continuing.',
        )
      }

      const valid = await operations.consumeReauthGrant({
        userId: req.auth.user.id,
        tokenHash: hashToken(raw.trim()),
        purpose,
        now: new Date(),
      })

      if (!valid) {
        throw new HttpError(
          403,
          'Reauthentication has expired or was already used. Confirm your password again.',
        )
      }

      next()
    } catch (error) {
      next(error)
    }
  }
}
