import { Router, type Request, type RequestHandler } from 'express'
import { randomUUID } from 'node:crypto'
import { hashPassword, verifyPassword } from '../auth/password.js'
import { toPublicSchool } from '../auth/presenter.js'
import { isUniqueConstraintError } from '../auth/prisma-repository.js'
import type { AuthRepository } from '../auth/repository.js'
import { registerSchoolSchema } from '../auth/validation.js'
import { parseBody } from '../auth/validation.js'
import { env } from '../config/env.js'
import { HttpError } from '../errors/http-error.js'
import {
  decodeSchoolLogo,
  schoolLogoStorageKey,
} from '../lib/school-branding.js'
import { buildSchoolSlug } from '../lib/slug.js'
import { createAuthenticate, type AuthContext } from '../middleware/authenticate.js'
import { requirePlatformAdmin } from '../middleware/authorize.js'
import { requireTrustedOrigin } from '../middleware/csrf.js'
import { createRateLimiter } from '../middleware/rate-limit.js'
import type { StorageAdapter } from '../storage/storage.js'
import {
  silentNotifier,
  type PlatformNotifier,
} from './notifications.js'
import type { PlatformRepository } from './repository.js'
import {
  platformAccountEmailSchema,
  platformAccountPasswordSchema,
  platformAccountProfileSchema,
  platformAuditQuerySchema,
  platformSchoolListQuerySchema,
  platformSchoolStatusSchema,
  platformSchoolUpdateSchema,
  platformSettingsUpdateSchema,
} from './validation.js'

export interface PlatformRouterOptions {
  storage: StorageAdapter
  accountRateLimit?: { windowMs: number; max: number }
  schoolCreationRateLimit?: { windowMs: number; max: number }
  /** Best-effort platform notification sink. */
  notifier?: PlatformNotifier
  /** Reauthentication gate for school creation, status, settings and session changes. */
  requireReauth?: RequestHandler
}

function requireAuth(req: Request): AuthContext {
  if (!req.auth) {
    throw new HttpError(401, 'Authentication required')
  }

  return req.auth
}

function routeParam(req: Request, name: string): string {
  const value = req.params[name]

  if (Array.isArray(value)) {
    return value[0] ?? ''
  }

  return value ?? ''
}

function notFound(message: string): HttpError {
  return new HttpError(404, message)
}

/**
 * Central Platform Super Admin API.
 *
 * Every route requires an authenticated session whose user is a platform
 * administrator. No route reads `req.schoolAccess`, so a school membership can
 * never satisfy these guards, and a restricted subject-teacher session (which
 * has no `req.auth`) is rejected by `authenticate` before any handler runs.
 */
export function createPlatformRouter(
  authRepository: AuthRepository,
  platformRepository: PlatformRepository,
  allowedOrigins: string[],
  options: PlatformRouterOptions,
): Router {
  const router = Router()
  const authenticate = createAuthenticate(authRepository)
  const trustedOrigin = requireTrustedOrigin(allowedOrigins)
  const notifier = options.notifier ?? silentNotifier
  const reauth: RequestHandler =
    options.requireReauth ?? ((_req, _res, next) => next())

  const accountLimiter = createRateLimiter({
    windowMs: options.accountRateLimit?.windowMs ?? 15 * 60 * 1000,
    max: options.accountRateLimit?.max ?? 8,
    scope: 'platform account security',
    keyGenerator: (req) => `${req.ip ?? 'unknown'}|${req.auth?.user.id ?? 'anonymous'}`,
  })

  const schoolCreationLimiter = createRateLimiter({
    windowMs: options.schoolCreationRateLimit?.windowMs ?? 60 * 60 * 1000,
    max: options.schoolCreationRateLimit?.max ?? 20,
    scope: 'platform school registration',
    keyGenerator: (req) => req.auth?.user.id ?? req.ip ?? 'unknown',
  })

  router.use(authenticate, requirePlatformAdmin(), trustedOrigin)

  router.get('/overview', async (_req, res, next) => {
    try {
      res.status(200).json({ data: await platformRepository.overview() })
    } catch (error) {
      next(error)
    }
  })

  router.get('/schools', async (req, res, next) => {
    try {
      const query = platformSchoolListQuerySchema.parse(req.query)
      const schools = await platformRepository.listSchools({
        search: query.search,
        status: query.status,
      })

      res.status(200).json({ data: { schools } })
    } catch (error) {
      next(error)
    }
  })

  router.post(
    '/schools',
    schoolCreationLimiter.middleware,
    reauth,
    async (req, res, next) => {
      try {
        const auth = requireAuth(req)
        const input = parseBody(registerSchoolSchema, req.body)
        const passwordHash = await hashPassword(input.password)
        const logo = decodeSchoolLogo(input.logo)
        const schoolId = randomUUID()
        const logoObjectKey = schoolLogoStorageKey(schoolId, logo.extension)

        await options.storage.putObject(logoObjectKey, logo.data, logo.mimeType)

        let result

        try {
          result = await authRepository.createSchoolWithAdmin({
            school: {
              id: schoolId,
              name: input.schoolName,
              slug: buildSchoolSlug(input.schoolName),
              landmark: input.landmark,
              address: input.address,
              phone: input.phone,
              logoObjectKey,
              logoMimeType: logo.mimeType,
              logoUpdatedAt: new Date(),
            },
            admin: {
              email: input.email,
              passwordHash,
              firstName: input.firstName,
              lastName: input.lastName,
            },
          })
        } catch (error) {
          await options.storage.deleteObject(logoObjectKey).catch(() => undefined)

          if (isUniqueConstraintError(error)) {
            throw new HttpError(409, 'An account with this email already exists')
          }

          throw error
        }

        await platformRepository.recordAudit({
          schoolId: result.school.id,
          actorUserId: auth.user.id,
          action: 'SCHOOL_REGISTERED_BY_PLATFORM',
          entityType: 'School',
          entityId: result.school.id,
          metadata: {
            schoolName: result.school.name,
            administratorEmail: result.user.email,
          },
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        })

        await notifier.notify({
          type: 'SCHOOL_REGISTERED',
          severity: 'SUCCESS',
          title: `School onboarded: ${result.school.name}`,
          body: `A platform administrator created ${result.school.name} with administrator ${result.user.email}.`,
          schoolId: result.school.id,
          entityType: 'School',
          entityId: result.school.id,
          link: `/platform/schools/${result.school.id}`,
          dedupeKey: `school-registered:${result.school.id}`,
        })

        res.status(201).json({
          data: {
            school: toPublicSchool(result.school),
            administrator: {
              email: result.user.email,
              firstName: result.user.firstName,
              lastName: result.user.lastName,
            },
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get('/schools/:schoolId', async (req, res, next) => {
    try {
      const schoolId = routeParam(req, 'schoolId')
      const school = await platformRepository.getSchool(schoolId)

      if (!school) {
        throw notFound('School not found')
      }

      res.status(200).json({ data: { school } })
    } catch (error) {
      next(error)
    }
  })

  router.get('/schools/:schoolId/logo', async (req, res, next) => {
    try {
      const schoolId = routeParam(req, 'schoolId')
      const logo = await platformRepository.getSchoolLogo(schoolId)

      if (!logo) {
        throw notFound('This school has not uploaded a logo')
      }

      const data = await options.storage.getObject(logo.storageKey)

      if (!data) {
        throw notFound('The school logo file is missing from storage')
      }

      res.setHeader('Content-Type', logo.mimeType)
      res.setHeader('Content-Length', String(data.length))
      res.setHeader('Cache-Control', 'private, max-age=300')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      // The platform dashboard is served from a different origin than the API.
      // Helmet's default same-origin CORP header would block this authenticated
      // image response; the route stays private behind the platform-admin guard.
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
      res.status(200).send(data)
    } catch (error) {
      next(error)
    }
  })

  router.patch('/schools/:schoolId', async (req, res, next) => {
    try {
      const auth = requireAuth(req)
      const schoolId = routeParam(req, 'schoolId')
      const input = parseBody(platformSchoolUpdateSchema, req.body)

      try {
        const school = await platformRepository.updateSchool(
          auth.user.id,
          schoolId,
          input,
          { ipAddress: req.ip, userAgent: req.get('user-agent') },
        )

        res.status(200).json({ data: { school } })
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          (error as { code?: string }).code === 'NOT_FOUND'
        ) {
          throw notFound('School not found')
        }

        throw error
      }
    } catch (error) {
      next(error)
    }
  })

  router.post('/schools/:schoolId/status', reauth, async (req, res, next) => {
    try {
      const auth = requireAuth(req)
      const schoolId = routeParam(req, 'schoolId')
      const input = parseBody(platformSchoolStatusSchema, req.body)

      try {
        const school = await platformRepository.setSchoolActive(
          auth.user.id,
          schoolId,
          input.isActive,
          { ipAddress: req.ip, userAgent: req.get('user-agent') },
        )

        await notifier.notify({
          type: input.isActive ? 'SCHOOL_REACTIVATED' : 'SCHOOL_SUSPENDED',
          severity: input.isActive ? 'SUCCESS' : 'WARNING',
          title: input.isActive
            ? `School reactivated: ${school.name}`
            : `School suspended: ${school.name}`,
          body: input.isActive
            ? 'A platform administrator restored tenant access.'
            : 'A platform administrator suspended tenant access. Historical records are preserved.',
          schoolId: school.id,
          entityType: 'School',
          entityId: school.id,
          link: `/platform/schools/${school.id}`,
          dedupeKey: `school-status:${school.id}:${input.isActive}:${Date.now()}`,
        })

        res.status(200).json({ data: { school } })
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          (error as { code?: string }).code === 'NOT_FOUND'
        ) {
          throw notFound('School not found')
        }

        throw error
      }
    } catch (error) {
      next(error)
    }
  })

  router.get('/audit', async (req, res, next) => {
    try {
      const query = platformAuditQuerySchema.parse(req.query)
      const page = await platformRepository.listAudit({
        search: query.search,
        action: query.action,
        schoolId: query.schoolId,
        source: query.source,
        from: query.from,
        to: query.to,
        limit: query.limit,
        offset: query.offset,
      })

      res.status(200).json({ data: page })
    } catch (error) {
      next(error)
    }
  })

  router.get('/monitoring', async (_req, res, next) => {
    try {
      res.status(200).json({ data: await platformRepository.monitoring() })
    } catch (error) {
      next(error)
    }
  })

  router.get('/settings', async (_req, res, next) => {
    try {
      const settings = await platformRepository.getSettings()

      res.status(200).json({
        data: {
          ...settings,
          // Read-only operational status. Secrets and infrastructure
          // credentials are never returned.
          paymentProvider: env.PAYMENT_PROVIDER ?? null,
          calendarSchedulerEnabled: env.CALENDAR_SCHEDULER_ENABLED,
        },
      })
    } catch (error) {
      next(error)
    }
  })

  router.patch('/settings', reauth, async (req, res, next) => {
    try {
      const auth = requireAuth(req)
      const input = parseBody(platformSettingsUpdateSchema, req.body)
      const settings = await platformRepository.updateSettings(
        auth.user.id,
        {
          supportEmail: input.supportEmail,
          registrationEnabled: input.registrationEnabled,
        },
        { ipAddress: req.ip, userAgent: req.get('user-agent') },
      )

      res.status(200).json({
        data: {
          ...settings,
          paymentProvider: env.PAYMENT_PROVIDER ?? null,
          calendarSchedulerEnabled: env.CALENDAR_SCHEDULER_ENABLED,
        },
      })
    } catch (error) {
      next(error)
    }
  })

  router.get('/account', async (req, res, next) => {
    try {
      const auth = requireAuth(req)
      const account = await platformRepository.getAccount(auth.user.id)

      if (!account) {
        throw new HttpError(404, 'Platform account not found')
      }

      res.status(200).json({ data: { account } })
    } catch (error) {
      next(error)
    }
  })

  router.patch('/account', async (req, res, next) => {
    try {
      const auth = requireAuth(req)
      const input = parseBody(platformAccountProfileSchema, req.body)
      const account = await platformRepository.updateAccountProfile(
        auth.user.id,
        input,
        { ipAddress: req.ip, userAgent: req.get('user-agent') },
      )

      res.status(200).json({ data: { account } })
    } catch (error) {
      next(error)
    }
  })

  router.post(
    '/account/email',
    accountLimiter.middleware,
    async (req, res, next) => {
      try {
        const auth = requireAuth(req)
        const input = parseBody(platformAccountEmailSchema, req.body)

        if (!(await verifyPassword(input.currentPassword, auth.user.passwordHash))) {
          throw new HttpError(403, 'Current password is incorrect')
        }

        if (input.email === auth.user.email) {
          throw new HttpError(400, 'That is already your email address')
        }

        const existing = await authRepository.findUserByEmail(input.email)

        if (existing && existing.id !== auth.user.id) {
          throw new HttpError(409, 'An account with this email already exists')
        }

        const account = await platformRepository.updateAccountEmail(
          auth.user.id,
          input.email,
          { ipAddress: req.ip, userAgent: req.get('user-agent') },
        )

        // Changing the sign-in identity invalidates other sessions while the
        // current session remains usable.
        await platformRepository.revokeOtherAccountSessions(
          auth.user.id,
          auth.sessionId,
          { ipAddress: req.ip, userAgent: req.get('user-agent') },
        )

        res.status(200).json({ data: { account } })
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          next(new HttpError(409, 'An account with this email already exists'))
          return
        }

        next(error)
      }
    },
  )

  router.post(
    '/account/password',
    accountLimiter.middleware,
    async (req, res, next) => {
      try {
        const auth = requireAuth(req)
        const input = parseBody(platformAccountPasswordSchema, req.body)

        if (!(await verifyPassword(input.currentPassword, auth.user.passwordHash))) {
          throw new HttpError(403, 'Current password is incorrect')
        }

        if (await verifyPassword(input.newPassword, auth.user.passwordHash)) {
          throw new HttpError(400, 'Choose a password you have not used before')
        }

        const passwordHash = await hashPassword(input.newPassword)

        await platformRepository.updateAccountPassword(auth.user.id, passwordHash, {
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        })

        await platformRepository.revokeOtherAccountSessions(
          auth.user.id,
          auth.sessionId,
          { ipAddress: req.ip, userAgent: req.get('user-agent') },
        )

        res.status(200).json({
          data: {
            message:
              'Password updated. Other sessions have been signed out; this session remains active.',
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get('/account/sessions', async (req, res, next) => {
    try {
      const auth = requireAuth(req)
      const sessions = await platformRepository.listAccountSessions(
        auth.user.id,
        auth.sessionId,
      )

      res.status(200).json({ data: { sessions } })
    } catch (error) {
      next(error)
    }
  })

  router.post('/account/sessions/revoke-others', async (req, res, next) => {
    try {
      const auth = requireAuth(req)
      const revoked = await platformRepository.revokeOtherAccountSessions(
        auth.user.id,
        auth.sessionId,
        { ipAddress: req.ip, userAgent: req.get('user-agent') },
      )

      res.status(200).json({ data: { revoked } })
    } catch (error) {
      next(error)
    }
  })

  return router
}
