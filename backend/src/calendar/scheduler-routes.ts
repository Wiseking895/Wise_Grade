import { timingSafeEqual } from 'node:crypto'
import { Router, type NextFunction, type Request, type Response } from 'express'
import { HttpError } from '../errors/http-error.js'
import type { CalendarSchedulerRunner } from './scheduler-run.js'

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)

  if (a.length !== b.length) {
    return false
  }

  return timingSafeEqual(a, b)
}

export interface CalendarSchedulerRouterOptions {
  /**
   * Shared secret from `CRON_SECRET`. Vercel Cron automatically sends
   * `Authorization: Bearer $CRON_SECRET` when this variable is configured.
   */
  secret?: string
}

/**
 * Protected endpoint for scheduled calendar processing.
 *
 * Both GET and POST are accepted because Vercel Cron issues GET requests while
 * an external worker may prefer POST. The endpoint is deliberately outside the
 * cookie-authenticated namespace: it uses a bearer secret and never creates a
 * user session. When no secret is configured it fails closed with 503 instead
 * of exposing an unauthenticated scheduler trigger.
 */
export function createCalendarSchedulerRouter(
  runner: CalendarSchedulerRunner,
  options: CalendarSchedulerRouterOptions,
): Router {
  const router = Router()

  async function handle(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (!options.secret) {
      res.status(503).json({
        error: {
          message:
            'The scheduled calendar endpoint is disabled because CRON_SECRET is not configured.',
        },
      })
      return
    }

    const authorization = req.get('authorization') ?? ''

    if (!safeEqual(authorization, `Bearer ${options.secret}`)) {
      next(new HttpError(401, 'Scheduled calendar authentication failed'))
      return
    }

    try {
      const outcome = await runner.run('CRON')
      res.status(200).json({ data: outcome })
    } catch (error) {
      next(error)
    }
  }

  router.get('/', handle)
  router.post('/', handle)

  return router
}
