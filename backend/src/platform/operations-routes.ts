import { Router, type Request } from 'express'
import { parseBody } from '../auth/validation.js'
import type { AuthRepository } from '../auth/repository.js'
import { HttpError } from '../errors/http-error.js'
import { createAuthenticate } from '../middleware/authenticate.js'
import { requirePlatformAdmin } from '../middleware/authorize.js'
import { requireTrustedOrigin } from '../middleware/csrf.js'
import { createRateLimiter } from '../middleware/rate-limit.js'
import { buildExport, EXPORT_DATASETS, isExportDataset } from './exports.js'
import type { PlatformHealthService } from './health.js'
import type { PlatformOperationsRepository } from './operations-repository.js'
import type { PlatformSecurityService } from './security.js'
import { createRequireReauth } from './reauth.js'
import {
  platformMfaConfirmSchema,
  platformMfaDisableSchema,
  platformNotificationListQuerySchema,
  platformReauthSchema,
  platformReconciliationAcknowledgeSchema,
  platformReconciliationQuerySchema,
  platformRecoveryCodesSchema,
} from './validation.js'

export interface PlatformOperationsRouterOptions {
  operations: PlatformOperationsRepository
  health: PlatformHealthService
  security: PlatformSecurityService
  trustedOrigins: string[]
  securityRateLimit?: { windowMs: number; max: number }
  exportRateLimit?: { windowMs: number; max: number }
}

function requireAuth(req: Request) {
  if (!req.auth) {
    throw new HttpError(401, 'Authentication required')
  }

  return req.auth
}

function routeParam(req: Request, name: string): string {
  const value = req.params[name]

  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(400, 'Invalid route parameter')
  }

  return value
}

function auditContext(req: Request) {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  }
}

export function createPlatformOperationsRouter(
  authRepository: AuthRepository,
  options: PlatformOperationsRouterOptions,
): Router {
  const router = Router()
  const authenticate = createAuthenticate(authRepository)
  const trustedOrigin = requireTrustedOrigin(options.trustedOrigins ?? [])

  const securityLimiter = createRateLimiter({
    windowMs: options.securityRateLimit?.windowMs ?? 15 * 60 * 1000,
    max: options.securityRateLimit?.max ?? 20,
    scope: 'platform security',
    keyGenerator: (req) =>
      `${req.ip ?? 'unknown'}|${req.auth?.user.id ?? 'anonymous'}`,
  }).middleware

  const exportLimiter = createRateLimiter({
    windowMs: options.exportRateLimit?.windowMs ?? 60 * 60 * 1000,
    max: options.exportRateLimit?.max ?? 20,
    scope: 'platform export',
    keyGenerator: (req) => req.auth?.user.id ?? req.ip ?? 'unknown',
  }).middleware

  const requireSecurityReauth = createRequireReauth(
    options.operations,
    'SECURITY_SETTINGS',
  )
  const requireExportReauth = createRequireReauth(
    options.operations,
    'DATA_EXPORT',
  )
  const requireReconciliationReauth = createRequireReauth(
    options.operations,
    'PAYMENT_RECONCILIATION',
  )
  const requireSessionReauth = createRequireReauth(
    options.operations,
    'SESSION_REVOKE',
  )

  router.use(authenticate, requirePlatformAdmin(), trustedOrigin)

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------

  router.get('/health', async (_req, res, next) => {
    try {
      res.status(200).json({ data: await options.health.check() })
    } catch (error) {
      next(error)
    }
  })

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------

  router.get('/notifications', async (req, res, next) => {
    try {
      const query = platformNotificationListQuerySchema.parse(req.query)
      const page = await options.operations.listNotifications({
        unreadOnly: query.unreadOnly,
        severity: query.severity,
        type: query.type,
        schoolId: query.schoolId,
        search: query.search,
        limit: query.limit,
        offset: query.offset,
      })

      res.status(200).json({ data: page })
    } catch (error) {
      next(error)
    }
  })

  router.get('/notifications/unread-count', async (_req, res, next) => {
    try {
      const count = await options.operations.unreadNotificationCount()
      res.status(200).json({ data: { unreadCount: count } })
    } catch (error) {
      next(error)
    }
  })

  router.post('/notifications/read-all', async (req, res, next) => {
    try {
      const auth = requireAuth(req)
      const updated = await options.operations.markAllNotificationsRead(
        auth.user.id,
      )
      res.status(200).json({ data: { updated } })
    } catch (error) {
      next(error)
    }
  })

  router.post('/notifications/:notificationId/read', async (req, res, next) => {
    try {
      const auth = requireAuth(req)
      const notification = await options.operations.markNotificationRead(
        routeParam(req, 'notificationId'),
        auth.user.id,
      )

      if (!notification) {
        throw new HttpError(404, 'Notification not found')
      }

      res.status(200).json({ data: { notification } })
    } catch (error) {
      next(error)
    }
  })

  // -------------------------------------------------------------------------
  // Security and sessions
  // -------------------------------------------------------------------------

  router.get('/security', async (req, res, next) => {
    try {
      const auth = requireAuth(req)
      const [overview, sessions] = await Promise.all([
        options.security.overview(auth.user.id, auth.sessionId),
        options.security.listSessions(auth.user.id, auth.sessionId),
      ])

      res.status(200).json({ data: { ...overview, sessions } })
    } catch (error) {
      next(error)
    }
  })

  router.post(
    '/security/reauth',
    securityLimiter,
    async (req, res, next) => {
      try {
        const auth = requireAuth(req)
        const input = parseBody(platformReauthSchema, req.body)
        const grant = await options.security.issueReauthGrant(
          auth.user.id,
          input,
          auditContext(req),
        )

        res.status(200).json({ data: grant })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/security/mfa/enroll',
    securityLimiter,
    async (req, res, next) => {
      try {
        const auth = requireAuth(req)
        const enrollment = await options.security.startMfaEnrollment(
          auth.user.id,
          auth.user.email,
        )

        res.status(200).json({ data: enrollment })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/security/mfa/confirm',
    securityLimiter,
    async (req, res, next) => {
      try {
        const auth = requireAuth(req)
        const input = parseBody(platformMfaConfirmSchema, req.body)
        const result = await options.security.confirmMfaEnrollment(
          auth.user.id,
          input.code,
          auditContext(req),
        )

        res.status(200).json({ data: result })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/security/mfa/disable',
    securityLimiter,
    requireSecurityReauth,
    async (req, res, next) => {
      try {
        const auth = requireAuth(req)
        const input = parseBody(platformMfaDisableSchema, req.body)
        await options.security.disableMfa(
          auth.user.id,
          input.password,
          input.code,
          auditContext(req),
        )

        res.status(200).json({
          data: { message: 'Multi-factor authentication has been disabled.' },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/security/mfa/recovery-codes',
    securityLimiter,
    requireSecurityReauth,
    async (req, res, next) => {
      try {
        const auth = requireAuth(req)
        const input = parseBody(platformRecoveryCodesSchema, req.body)
        const codes = await options.security.regenerateRecoveryCodes(
          auth.user.id,
          input.code,
          auditContext(req),
        )

        res.status(200).json({ data: { recoveryCodes: codes } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get('/security/sessions', async (req, res, next) => {
    try {
      const auth = requireAuth(req)
      const sessions = await options.security.listSessions(
        auth.user.id,
        auth.sessionId,
      )
      res.status(200).json({ data: { sessions } })
    } catch (error) {
      next(error)
    }
  })

  router.post(
    '/security/sessions/:sessionId/revoke',
    securityLimiter,
    requireSessionReauth,
    async (req, res, next) => {
      try {
        const auth = requireAuth(req)
        const revoked = await options.security.revokeSession(
          auth.user.id,
          routeParam(req, 'sessionId'),
          auth.sessionId,
          auditContext(req),
        )

        if (!revoked) {
          throw new HttpError(404, 'Session not found or already revoked')
        }

        res.status(200).json({ data: { revoked: true } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get('/security/events', async (req, res, next) => {
    try {
      const auth = requireAuth(req)
      const events = await options.operations.listSecurityEvents(
        auth.user.id,
        100,
      )
      res.status(200).json({ data: { events } })
    } catch (error) {
      next(error)
    }
  })

  // -------------------------------------------------------------------------
  // Exports
  // -------------------------------------------------------------------------

  router.get('/exports', async (_req, res, next) => {
    try {
      res.status(200).json({ data: { datasets: EXPORT_DATASETS } })
    } catch (error) {
      next(error)
    }
  })

  router.get(
    '/exports/:dataset',
    exportLimiter,
    requireExportReauth,
    async (req, res, next) => {
      try {
        const auth = requireAuth(req)
        const dataset = routeParam(req, 'dataset')

        if (!isExportDataset(dataset)) {
          throw new HttpError(404, 'Unknown export dataset')
        }

        const result = await buildExport(options.operations, dataset)

        await options.operations.recordAudit({
          actorUserId: auth.user.id,
          action: 'PLATFORM_EXPORT_DOWNLOADED',
          entityType: 'Export',
          entityId: dataset,
          metadata: {
            dataset,
            rowCount: result.rowCount,
            truncated: result.truncated,
          },
          ...auditContext(req),
        })

        res.setHeader('Content-Type', 'text/csv; charset=utf-8')
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${result.fileName}"`,
        )
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.status(200).send(result.csv)
      } catch (error) {
        next(error)
      }
    },
  )

  // -------------------------------------------------------------------------
  // Payment reconciliation
  // -------------------------------------------------------------------------

  router.get('/reconciliation', async (req, res, next) => {
    try {
      const query = platformReconciliationQuerySchema.parse(req.query)
      const page = await options.operations.reconciliation()
      const issues = page.issues.filter((issue) => {
        if (query.code && issue.code !== query.code) {
          return false
        }

        if (query.severity && issue.severity !== query.severity) {
          return false
        }

        if (query.schoolId && issue.schoolId !== query.schoolId) {
          return false
        }

        return true
      })

      res.status(200).json({
        data: {
          ...page,
          issues,
        },
      })
    } catch (error) {
      next(error)
    }
  })

  router.post(
    '/reconciliation/:paymentId/acknowledge',
    requireReconciliationReauth,
    async (req, res, next) => {
      try {
        const auth = requireAuth(req)
        const input = parseBody(
          platformReconciliationAcknowledgeSchema,
          req.body,
        )
        const issue = await options.operations.acknowledgePayment(
          routeParam(req, 'paymentId'),
          input,
          auth.user.id,
          auditContext(req),
        )

        res.status(200).json({ data: { payment: issue } })
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          (error as { code?: string }).code === 'NOT_FOUND'
        ) {
          next(new HttpError(404, 'Payment not found'))
          return
        }

        next(error)
      }
    },
  )

  return router
}
