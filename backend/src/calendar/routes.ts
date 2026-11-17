import { Router, type Request, type RequestHandler } from 'express'
import { parseBody } from '../auth/validation.js'
import type { AuthRepository } from '../auth/repository.js'
import { HttpError } from '../errors/http-error.js'
import { createAuthenticate } from '../middleware/authenticate.js'
import {
  requirePlatformAdmin,
  requireSchoolAccess,
} from '../middleware/authorize.js'
import { requireTrustedOrigin } from '../middleware/csrf.js'
import type { CalendarService } from './service.js'
import type { CalendarAuditActor } from './types.js'
import {
  academicYearCreateSchema,
  academicYearResetSchema,
  academicYearUpdateSchema,
  calendarApplyPreviewSchema,
  calendarApplySchema,
  calendarSchoolQuerySchema,
  calendarTermUpdateSchema,
  termDatesCorrectionSchema,
  transitionListQuerySchema,
} from './validation.js'

function requireAuth(req: Request) {
  if (!req.auth) {
    throw new HttpError(401, 'Authentication required')
  }

  return req.auth
}

function requireAccess(req: Request) {
  if (!req.schoolAccess) {
    throw new HttpError(403, 'You do not have access to this school')
  }

  return req.schoolAccess
}

function routeParam(req: Request, name: string): string {
  const value = req.params[name]

  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(400, 'Invalid route parameter')
  }

  return value
}

function sequenceParam(req: Request): number {
  const sequence = Number(routeParam(req, 'sequence'))

  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 3) {
    throw new HttpError(400, 'Term sequence must be 1, 2 or 3')
  }

  return sequence
}

function auditActor(req: Request): CalendarAuditActor {
  return {
    actorUserId: requireAuth(req).user.id,
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  }
}

/**
 * Read-only calendar for every active school member. School administrators and
 * teachers see the centrally managed academic year, term dates, assessment
 * deadlines, examination periods and report preparation status.
 */
export function createSchoolCalendarRouter(
  authRepository: AuthRepository,
  service: CalendarService,
  trustedOrigins: string[],
): Router {
  const router = Router()
  const authenticate = createAuthenticate(authRepository)
  const schoolAccess = requireSchoolAccess(authRepository)
  const trustedOrigin = requireTrustedOrigin(trustedOrigins)

  router.use('/:schoolId', authenticate, schoolAccess, trustedOrigin)

  const show: RequestHandler = async (req, res, next) => {
    try {
      const access = requireAccess(req)
      const calendar = await service.getSchoolCalendar(access.schoolId)

      res.status(200).json({ data: { calendar } })
    } catch (error) {
      next(error)
    }
  }

  router.get('/:schoolId/calendar', show)

  return router
}

export interface PlatformCalendarRouterOptions {
  /** Sensitive reauthentication for reset and archive. */
  requireReauth?: RequestHandler
}

/**
 * Platform-super-admin calendar operations. These are the only routes that can
 * create or correct central calendar configuration, distribute it to schools,
 * or archive a completed academic year. School administrators and teachers
 * never receive a write route.
 */
export function createPlatformCalendarRouter(
  authRepository: AuthRepository,
  service: CalendarService,
  trustedOrigins: string[],
  options: PlatformCalendarRouterOptions = {},
): Router {
  const router = Router()
  const authenticate = createAuthenticate(authRepository)
  const platformAdmin = requirePlatformAdmin()
  const trustedOrigin = requireTrustedOrigin(trustedOrigins)
  const requireReauth: RequestHandler =
    options.requireReauth ?? ((_req, _res, next) => next())

  router.use(authenticate, platformAdmin, trustedOrigin)

  router.get('/schools', async (_req, res, next) => {
    try {
      const schools = await service.listEligibleSchools()
      res.status(200).json({ data: { schools } })
    } catch (error) {
      next(error)
    }
  })

  router.get('/', async (req, res, next) => {
    try {
      const query = parseBody(calendarSchoolQuerySchema, req.query)

      if (query.schoolId) {
        const calendar = await service.getSchoolCalendar(query.schoolId)
        res.status(200).json({ data: { calendars: [calendar] } })
        return
      }

      const calendars = await service.listSchoolCalendars()
      res.status(200).json({ data: { calendars } })
    } catch (error) {
      next(error)
    }
  })

  router.post('/:schoolId/years', async (req, res, next) => {
    try {
      const schoolId = routeParam(req, 'schoolId')
      const input = parseBody(academicYearCreateSchema, req.body)
      const year = await service.createYear(auditActor(req), schoolId, input)

      res.status(201).json({ data: { year } })
    } catch (error) {
      next(error)
    }
  })

  router.put('/:schoolId/years/:yearId', async (req, res, next) => {
    try {
      const schoolId = routeParam(req, 'schoolId')
      const yearId = routeParam(req, 'yearId')
      const input = parseBody(academicYearUpdateSchema, req.body)
      const year = await service.updateYear(
        auditActor(req),
        schoolId,
        yearId,
        input,
      )

      res.status(200).json({ data: { year } })
    } catch (error) {
      next(error)
    }
  })

  router.put(
    '/:schoolId/years/:yearId/terms/:sequence',
    async (req, res, next) => {
      try {
        const schoolId = routeParam(req, 'schoolId')
        const yearId = routeParam(req, 'yearId')
        const sequence = sequenceParam(req)
        const input = parseBody(calendarTermUpdateSchema, req.body)
        const term = await service.upsertTerm(
          auditActor(req),
          schoolId,
          yearId,
          sequence,
          input,
        )

        res.status(200).json({ data: { term } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post('/:schoolId/years/:yearId/activate', async (req, res, next) => {
    try {
      const schoolId = routeParam(req, 'schoolId')
      const yearId = routeParam(req, 'yearId')
      const year = await service.activateYear(auditActor(req), schoolId, yearId)

      res.status(200).json({ data: { year } })
    } catch (error) {
      next(error)
    }
  })

  router.post(
    '/:schoolId/years/:yearId/deactivate',
    async (req, res, next) => {
      try {
        const schoolId = routeParam(req, 'schoolId')
        const yearId = routeParam(req, 'yearId')
        const year = await service.deactivateYear(
          auditActor(req),
          schoolId,
          yearId,
        )

        res.status(200).json({ data: { year } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/:schoolId/years/:yearId/reset',
    requireReauth,
    async (req, res, next) => {
      try {
        const schoolId = routeParam(req, 'schoolId')
        const yearId = routeParam(req, 'yearId')
        const input = parseBody(academicYearResetSchema, req.body)
        const result = await service.resetYear(
          auditActor(req),
          schoolId,
          yearId,
          input,
        )

        res.status(200).json({ data: result })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/:schoolId/years/:yearId/archive',
    requireReauth,
    async (req, res, next) => {
      try {
        const schoolId = routeParam(req, 'schoolId')
        const yearId = routeParam(req, 'yearId')
        const year = await service.archiveYear(
          auditActor(req),
          schoolId,
          yearId,
        )

        res.status(200).json({ data: { year } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post('/apply/preview', async (req, res, next) => {
    try {
      const input = parseBody(calendarApplyPreviewSchema, req.body)
      const preview = await service.previewApply(
        auditActor(req),
        input.sourceSchoolId,
        input.yearId,
        input.schoolIds,
      )

      res.status(200).json({ data: { preview } })
    } catch (error) {
      next(error)
    }
  })

  router.post('/apply', async (req, res, next) => {
    try {
      const input = parseBody(calendarApplySchema, req.body)
      const result = await service.applyCalendar(
        auditActor(req),
        input.sourceSchoolId,
        input.yearId,
        input.schoolIds,
      )

      res.status(200).json({ data: { result } })
    } catch (error) {
      next(error)
    }
  })

  router.get('/:schoolId', async (req, res, next) => {
    try {
      const schoolId = routeParam(req, 'schoolId')
      const query = parseBody(transitionListQuerySchema, req.query)
      const calendar = await service.getSchoolCalendar(schoolId)
      const transitions = await service.listTransitions(
        schoolId,
        query.limit ?? 50,
      )

      res.status(200).json({ data: { calendar, transitions } })
    } catch (error) {
      next(error)
    }
  })

  router.post('/run', async (_req, res, next) => {
    try {
      const results = await service.runAll()
      res.status(200).json({ data: { results } })
    } catch (error) {
      next(error)
    }
  })

  router.post('/:schoolId/run', async (req, res, next) => {
    try {
      const schoolId = routeParam(req, 'schoolId')
      const result = await service.runSchool(schoolId, 'PLATFORM')
      res.status(200).json({ data: { result } })
    } catch (error) {
      next(error)
    }
  })

  router.post('/:schoolId/sync', async (req, res, next) => {
    try {
      const schoolId = routeParam(req, 'schoolId')
      const result = await service.runSchool(schoolId, 'PLATFORM')
      const calendar = await service.getSchoolCalendar(schoolId)

      res.status(200).json({ data: { calendar, result } })
    } catch (error) {
      next(error)
    }
  })

  router.post('/:schoolId/terms/:termId/dates', async (req, res, next) => {
    try {
      const auth = requireAuth(req)
      const schoolId = routeParam(req, 'schoolId')
      const termId = routeParam(req, 'termId')
      const input = parseBody(termDatesCorrectionSchema, req.body)
      const term = await service.updateTermDates(
        auth.user.id,
        schoolId,
        termId,
        input,
      )

      res.status(200).json({ data: { term } })
    } catch (error) {
      next(error)
    }
  })

  router.post('/:schoolId/terms/:termId/close', async (req, res, next) => {
    try {
      const auth = requireAuth(req)
      const schoolId = routeParam(req, 'schoolId')
      const termId = routeParam(req, 'termId')
      const result = await service.closeTermNow(
        auth.user.id,
        schoolId,
        termId,
      )

      if (!result.closed) {
        throw new HttpError(
          409,
          'This term cannot close until every required result submission is accepted',
          {
            term: result.term,
            completion: result.completion,
          },
        )
      }

      res.status(200).json({ data: { term: result.term } })
    } catch (error) {
      next(error)
    }
  })

  return router
}
