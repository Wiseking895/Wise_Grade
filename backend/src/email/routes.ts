import { timingSafeEqual } from 'node:crypto'
import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import type { AuthRepository } from '../auth/repository.js'
import { emailSchema, parseBody } from '../auth/validation.js'
import { env } from '../config/env.js'
import { HttpError } from '../errors/http-error.js'
import { createAuthenticate } from '../middleware/authenticate.js'
import { requirePlatformAdmin } from '../middleware/authorize.js'
import { requireTrustedOrigin } from '../middleware/csrf.js'
import { createRateLimiter } from '../middleware/rate-limit.js'
import { formatEmailDateTime } from './templates.js'
import type { EmailService } from './service.js'

const testEmailSchema = z
  .object({ to: emailSchema.optional() })
  .strict()

export interface PlatformEmailRouterOptions {
  testRateLimit?: { windowMs: number; max: number }
}

/**
 * Administrator-only SMTP diagnostics.
 *
 * Authentication plus `isPlatformAdmin` are both required, the recipient is
 * restricted to the configured test address (or the caller's own address), and
 * every result is sanitized. It never exposes credentials and is never mounted
 * on a public path.
 */
export function createPlatformEmailRouter(
  authRepository: AuthRepository,
  email: EmailService,
  trustedOrigins: string[],
  options: PlatformEmailRouterOptions = {},
): Router {
  const router = Router()
  const authenticate = createAuthenticate(authRepository)
  const trustedOrigin = requireTrustedOrigin(trustedOrigins)
  const platformAdmin = requirePlatformAdmin()
  const limiter = createRateLimiter({
    windowMs: options.testRateLimit?.windowMs ?? 15 * 60 * 1000,
    max: options.testRateLimit?.max ?? 3,
    scope: 'SMTP test',
    keyGenerator: (req) => req.auth?.user.id ?? req.ip ?? 'unknown',
  })

  router.post(
    '/test',
    trustedOrigin,
    authenticate,
    platformAdmin,
    limiter.middleware,
    async (req, res, next) => {
      try {
        const auth = req.auth

        if (!auth) {
          throw new HttpError(401, 'Authentication required')
        }

        const input = parseBody(testEmailSchema, req.body ?? {})
        const allowedRecipient = (
          env.EMAIL_TEST_RECIPIENT ?? auth.user.email
        ).toLowerCase()

        if (
          input.to &&
          input.to.toLowerCase() !== allowedRecipient
        ) {
          throw new HttpError(
            403,
            'The SMTP test can only be sent to the configured test recipient',
          )
        }

        const connection = await email.verifyConnection()

        if (!connection.ok) {
          await authRepository
            .recordAudit({
              actorUserId: auth.user.id,
              action: 'SMTP_TEST_FAILED',
              entityType: 'Email',
              metadata: {
                stage: 'CONNECTION',
                errorCode: connection.errorCode ?? 'UNKNOWN',
              },
            })
            .catch(() => undefined)

          res.status(502).json({
            data: {
              connection: 'failed',
              errorCode: connection.errorCode ?? 'SMTP_CONNECTION_FAILED',
              missing: connection.missing ?? [],
              problems: connection.problems ?? [],
            },
          })
          return
        }

        const dispatch = await email.send({
          template: 'smtp-test',
          to: allowedRecipient,
          dedupeKey: `smtp-test:${auth.user.id}:${Date.now()}`,
          data: {
            recipientName: auth.user.firstName,
            sentAt: formatEmailDateTime(new Date()),
            smtpHost: env.SMTP_HOST ?? 'configured SMTP relay',
          },
        })

        const accepted =
          dispatch.status === 'sent' || dispatch.status === 'queued'

        await authRepository
          .recordAudit({
            actorUserId: auth.user.id,
            action: accepted ? 'SMTP_TEST_SENT' : 'SMTP_TEST_FAILED',
            entityType: 'Email',
            metadata: {
              stage: 'DELIVERY',
              status: dispatch.status,
              errorCode:
                dispatch.status === 'queued' || dispatch.status === 'failed'
                  ? dispatch.errorCode
                  : null,
            },
          })
          .catch(() => undefined)

        res.status(accepted ? 200 : 502).json({
          data: {
            connection: 'ok',
            dispatch: dispatch.status,
            message: accepted
              ? 'The SMTP relay accepted the message. Check the recipient inbox to confirm delivery.'
              : 'The SMTP relay rejected the message. Check the sender address and relay configuration.',
            errorCode:
              dispatch.status === 'queued' || dispatch.status === 'failed'
                ? dispatch.errorCode
                : undefined,
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)

  if (a.length !== b.length) {
    return false
  }

  return timingSafeEqual(a, b)
}

/**
 * Protected outbox drain for serverless deployments. Mirrors the calendar cron
 * endpoint: it fails closed without CRON_SECRET, accepts the same bearer secret
 * and runs the same retry logic used inline after each business operation.
 */
export function createEmailOutboxRouter(
  email: EmailService,
  options: { secret?: string },
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
            'The email outbox endpoint is disabled because CRON_SECRET is not configured.',
        },
      })
      return
    }

    if (!safeEqual(req.get('authorization') ?? '', `Bearer ${options.secret}`)) {
      next(new HttpError(401, 'Email outbox authentication failed'))
      return
    }

    try {
      const summary = await email.processOutbox()
      res.status(200).json({ data: summary })
    } catch (error) {
      next(error)
    }
  }

  router.get('/', handle)
  router.post('/', handle)

  return router
}
