import { Router } from 'express'
import { z } from 'zod'
import type { AuthRepository } from '../auth/repository.js'
import { parseBody } from '../auth/validation.js'
import { createAuthenticate } from '../middleware/authenticate.js'
import { createRateLimiter } from '../middleware/rate-limit.js'
import type { ReverseGeocoder } from './types.js'

function coordinate(min: number, max: number) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() !== '' ? Number(value) : value),
    z
      .number({ message: 'Coordinate is required' })
      .finite('Coordinate must be a finite number')
      .min(min, `Coordinate must be at least ${min}`)
      .max(max, `Coordinate must be at most ${max}`),
  )
}

const reverseQuerySchema = z
  .object({
    latitude: coordinate(-90, 90),
    longitude: coordinate(-180, 180),
  })
  .strict()

export interface LocationRouterOptions {
  /** Fixed window for reverse-geocoding lookups, per signed-in user. */
  rateLimit?: { windowMs?: number; max?: number }
}

/**
 * One-shot reverse geocoding for the dashboard's location indicator.
 *
 * The browser only sends coordinates to this authenticated API; the configured
 * provider is contacted server-side so its key (if any) never reaches the
 * client. Coordinates are not logged, cached or persisted. The response is a
 * place name only — never the coordinates.
 */
export function createLocationRouter(
  authRepository: AuthRepository,
  reverseGeocoder: ReverseGeocoder,
  options: LocationRouterOptions = {},
): Router {
  const router = Router()
  const authenticate = createAuthenticate(authRepository)
  const limiter = createRateLimiter({
    windowMs: options.rateLimit?.windowMs ?? 60_000,
    max: options.rateLimit?.max ?? 20,
    scope: 'location lookup',
    keyGenerator: (req) => req.auth?.user.id ?? req.ip ?? 'unknown',
  })

  router.use(authenticate)

  router.get('/reverse', limiter.middleware, async (req, res, next) => {
    try {
      const { latitude, longitude } = parseBody(reverseQuerySchema, req.query)
      const location = await reverseGeocoder(latitude, longitude)

      res.status(200).json({ data: { location } })
    } catch (error) {
      next(error)
    }
  })

  return router
}
