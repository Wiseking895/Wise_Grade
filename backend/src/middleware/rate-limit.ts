import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { HttpError } from '../errors/http-error.js'

export interface RateLimitOptions {
  /** Window length in milliseconds. */
  windowMs: number
  /** Maximum attempts allowed per key per window. */
  max: number
  /** Prefix used in the error message, e.g. "login". */
  scope: string
  keyGenerator?: (req: Request) => string
}

export interface RateLimiter {
  middleware: RequestHandler
  reset(key: string): void
}

const MAX_TRACKED_KEYS = 10_000

function defaultKey(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown'
}

/**
 * Small in-process fixed-window limiter for authentication endpoints.
 *
 * This is intentionally dependency-free and is sufficient for a single API
 * instance. A multi-instance deployment should back the same interface with
 * Redis rather than relying on per-process memory.
 */
export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const hits = new Map<string, { count: number; resetAt: number }>()
  const keyGenerator = options.keyGenerator ?? defaultKey

  function prune(now: number): void {
    if (hits.size < MAX_TRACKED_KEYS) {
      return
    }

    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) {
        hits.delete(key)
      }
    }
  }

  const middleware: RequestHandler = function rateLimit(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const now = Date.now()
    const key = keyGenerator(req)
    const existing = hits.get(key)

    if (!existing || existing.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + options.windowMs })
      next()
      return
    }

    if (existing.count >= options.max) {
      prune(now)

      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((existing.resetAt - now) / 1000),
      )

      res.setHeader('Retry-After', String(retryAfterSeconds))
      next(
        new HttpError(
          429,
          `Too many ${options.scope} attempts. Try again later.`,
        ),
      )
      return
    }

    existing.count += 1
    next()
  }

  return {
    middleware,
    reset(key: string): void {
      hits.delete(key)
    },
  }
}
