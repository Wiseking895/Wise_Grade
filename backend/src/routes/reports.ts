import {
  Router,
  type Request,
  type RequestHandler,
  type Response,
} from 'express'
import type { z } from 'zod'
import { parseBody } from '../auth/validation.js'
import type {
  AuthRepository,
  MembershipRecord,
} from '../auth/repository.js'
import { HttpError } from '../errors/http-error.js'
import { createAuthenticate } from '../middleware/authenticate.js'
import { requireRole, requireSchoolAccess } from '../middleware/authorize.js'
import { requireTrustedOrigin } from '../middleware/csrf.js'
import {
  toPublicReportAsset,
  type ReportActor,
  type ReportAuditContext,
} from '../reports/repository.js'
import type { ReportReleaseActor } from '../reports/release-repository.js'
import type { ReportService } from '../reports/service.js'
import type { ReportWorkflowService } from '../reports/workflow-service.js'
import {
  reportAssetSchema,
  reportClassesQuerySchema,
  reportEligibilityQuerySchema,
  reportInputQuerySchema,
  reportInputSchema,
  reportRequestQuerySchema,
  reportRequestSchema,
  reportSettingsSchema,
  reportTermQuerySchema,
} from '../reports/validation.js'

function requireAccess(req: Request): MembershipRecord {
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

function actorFromRequest(req: Request): ReportActor {
  const access = requireAccess(req)

  if (!req.auth) {
    throw new HttpError(401, 'Authentication required')
  }

  return {
    schoolId: access.schoolId,
    userId: req.auth.user.id,
    membershipId: access.id,
    role: access.role,
  }
}

function auditFromRequest(req: Request): ReportAuditContext {
  const access = requireAccess(req)

  if (!req.auth) {
    throw new HttpError(401, 'Authentication required')
  }

  return {
    actorUserId: req.auth.user.id,
    actorMembershipId: access.id,
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  }
}

function releaseActorFromRequest(req: Request): ReportReleaseActor {
  const access = requireAccess(req)

  return {
    schoolId: access.schoolId,
    userId: req.auth!.user.id,
    membershipId: access.id,
    role: access.role,
  }
}

function parseQuery<T>(schema: z.ZodType<T>, query: unknown): T {
  const result = schema.safeParse(query)

  if (!result.success) {
    throw new HttpError(
      400,
      'Validation failed',
      result.error.issues.map((issue) => ({
        field: issue.path.map(String).join('.') || 'query',
        message: issue.message,
      })),
    )
  }

  return result.data
}

function parseVersion(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }

  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new HttpError(400, 'Report version must be a positive integer')
  }

  return parsed
}

function sendPdf(res: Response, data: Buffer, fileName: string): void {
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${fileName.replace(/["\\]/g, '')}"`,
  )
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.status(200).send(data)
}

/**
 * Phase 5 internal report routes.
 *
 * All routes are school-scoped. School administrators manage settings and run
 * generation; class teachers may edit authorized report inputs; every report
 * read is additionally checked against the caller's class assignment inside the
 * service. There is deliberately no public pupil or parent endpoint.
 */
export function createReportsRouter(
  authRepository: AuthRepository,
  service: ReportService,
  trustedOrigins: string[],
  workflow: ReportWorkflowService,
): Router {
  const router = Router()
  const authenticate = createAuthenticate(authRepository)
  const schoolAccess = requireSchoolAccess(authRepository)
  const trustedOrigin = requireTrustedOrigin(trustedOrigins)
  const admin = requireRole('SCHOOL_ADMIN')
  const classTeacher = requireRole('CLASS_TEACHER')
  const recordsReader = requireRole('SCHOOL_ADMIN', 'CLASS_TEACHER')

  const platformOnly: RequestHandler = (_req, _res, next) => {
    next(
      new HttpError(
        403,
        'Report generation, batch management and release are performed by the Wise Grade platform, not the school workspace.',
      ),
    )
  }

  router.use(
    '/:schoolId/reports',
    authenticate,
    schoolAccess,
    trustedOrigin,
  )

  // -----------------------------------------------------------------------
  // Settings and private branding assets
  // -----------------------------------------------------------------------

  router.get(
    '/:schoolId/reports/settings',
    admin,
    async (req, res, next) => {
      try {
        const query = parseQuery(reportTermQuerySchema, req.query)
        const settings = await service.getSettings(
          actorFromRequest(req),
          query.academicTermId,
        )
        res.status(200).json({ data: { settings } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.put(
    '/:schoolId/reports/settings',
    admin,
    async (req, res, next) => {
      try {
        const input = parseBody(reportSettingsSchema, req.body)
        const settings = await service.updateSettings(
          actorFromRequest(req),
          input,
          auditFromRequest(req),
        )
        res.status(200).json({ data: { settings } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/:schoolId/reports/assets',
    admin,
    async (req, res, next) => {
      try {
        const assets = await service.listAssets(actorFromRequest(req))
        res.status(200).json({
          data: { assets: assets.map(toPublicReportAsset) },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/:schoolId/reports/assets',
    admin,
    async (req, res, next) => {
      try {
        const input = parseBody(reportAssetSchema, req.body)
        const asset = await service.uploadAsset(
          actorFromRequest(req),
          input,
          auditFromRequest(req),
        )
        res.status(201).json({
          data: { asset: toPublicReportAsset(asset) },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/:schoolId/reports/assets/:assetId/file',
    admin,
    async (req, res, next) => {
      try {
        const file = await service.getAssetBytes(
          actorFromRequest(req),
          routeParam(req, 'assetId'),
        )
        res.setHeader('Content-Type', file.mimeType)
        res.setHeader(
          'Content-Disposition',
          `inline; filename="${file.fileName.replace(/["\\]/g, '')}"`,
        )
        res.setHeader('Cache-Control', 'private, no-store')
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.status(200).send(file.data)
      } catch (error) {
        next(error)
      }
    },
  )

  // -----------------------------------------------------------------------
  // Classes, authorized inputs and eligibility
  // -----------------------------------------------------------------------

  router.get('/:schoolId/reports/classes', async (req, res, next) => {
    try {
      const query = parseQuery(reportClassesQuerySchema, req.query)
      const classes = await service.listClasses(
        actorFromRequest(req),
        query.academicYearId,
        query.academicTermId,
      )
      res.status(200).json({ data: { classes } })
    } catch (error) {
      next(error)
    }
  })

  router.get(
    '/:schoolId/reports/classes/:classId/collection',
    admin,
    async (req, res, next) => {
      try {
        const query = parseQuery(reportTermQuerySchema, req.query)
        const collection = await service.getClassCollection(
          actorFromRequest(req),
          {
            academicTermId: query.academicTermId,
            classId: routeParam(req, 'classId'),
          },
          auditFromRequest(req),
        )
        sendPdf(res, collection.data, collection.fileName)
      } catch (error) {
        next(error)
      }
    },
  )

  router.get('/:schoolId/reports/inputs', recordsReader, async (req, res, next) => {
    try {
      const query = parseQuery(reportInputQuerySchema, req.query)
      const inputs = await service.listInputs(actorFromRequest(req), query)
      res.status(200).json({ data: { inputs } })
    } catch (error) {
      next(error)
    }
  })

  router.put('/:schoolId/reports/inputs', classTeacher, async (req, res, next) => {
    try {
      const input = parseBody(reportInputSchema, req.body)
      const record = await service.upsertInput(
        actorFromRequest(req),
        input,
        auditFromRequest(req),
      )
      res.status(200).json({ data: { input: record } })
    } catch (error) {
      next(error)
    }
  })

  router.get('/:schoolId/reports/eligibility', recordsReader, async (req, res, next) => {
    try {
      const query = parseQuery(reportEligibilityQuerySchema, req.query)
      const eligibility = await service.checkEligibility(
        actorFromRequest(req),
        query,
      )
      res.status(200).json({ data: { eligibility } })
    } catch (error) {
      next(error)
    }
  })

  // -----------------------------------------------------------------------
  // School report-generation requests (one term-wide request per term)
  // -----------------------------------------------------------------------

  router.post(
    '/:schoolId/reports/requests',
    admin,
    async (req, res, next) => {
      try {
        const input = parseBody(reportRequestSchema, req.body)
        const result = await workflow.submitRequest(
          releaseActorFromRequest(req),
          input,
          auditFromRequest(req),
        )
        res.status(201).json({ data: result })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/:schoolId/reports/requests',
    admin,
    async (req, res, next) => {
      try {
        const query = parseQuery(reportRequestQuerySchema, req.query)
        const requests = await workflow.listSchoolRequests(
          releaseActorFromRequest(req),
          query,
        )
        res.status(200).json({ data: { requests } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/:schoolId/reports/requests/:batchId',
    admin,
    async (req, res, next) => {
      try {
        const request = await workflow.getSchoolRequest(
          releaseActorFromRequest(req),
          routeParam(req, 'batchId'),
        )
        res.status(200).json({ data: request })
      } catch (error) {
        next(error)
      }
    },
  )

  // -----------------------------------------------------------------------
  // Generation and failure recovery
  // -----------------------------------------------------------------------

  router.post(
    '/:schoolId/reports/generate',
    platformOnly,
    (_req, _res) => undefined,
  )

  router.get(
    '/:schoolId/reports/batches',
    platformOnly,
    (_req, _res) => undefined,
  )

  router.get(
    '/:schoolId/reports/batches/:batchId',
    platformOnly,
    (_req, _res) => undefined,
  )

  router.post(
    '/:schoolId/reports/batches/:batchId/retry',
    platformOnly,
    (_req, _res) => undefined,
  )

  // -----------------------------------------------------------------------
  // Phase 6B platform review submission (platform-owned)
  // -----------------------------------------------------------------------

  router.get(
    '/:schoolId/reports/release/batches',
    platformOnly,
    (_req, _res) => undefined,
  )

  router.get(
    '/:schoolId/reports/release/batches/:batchId',
    platformOnly,
    (_req, _res) => undefined,
  )

  router.post(
    '/:schoolId/reports/release/batches/:batchId/submit',
    platformOnly,
    (_req, _res) => undefined,
  )

  // -----------------------------------------------------------------------
  // Report list, preview and immutable versions
  // -----------------------------------------------------------------------

  router.get('/:schoolId/reports/cards', admin, async (req, res, next) => {
    try {
      const query = parseQuery(reportTermQuerySchema, req.query)
      const cards = await service.listCards(actorFromRequest(req), query)
      res.status(200).json({ data: { cards } })
    } catch (error) {
      next(error)
    }
  })

  router.get(
    '/:schoolId/reports/cards/:reportCardId',
    admin,
    async (req, res, next) => {
      try {
        const card = await service.getCard(
          actorFromRequest(req),
          routeParam(req, 'reportCardId'),
        )
        res.status(200).json({ data: card })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/:schoolId/reports/cards/:reportCardId/preview',
    admin,
    async (req, res, next) => {
      try {
        const version = parseVersion(
          typeof req.query.version === 'string' ? req.query.version : undefined,
        )
        const preview = await service.preview(
          actorFromRequest(req),
          routeParam(req, 'reportCardId'),
          version,
          auditFromRequest(req),
        )
        sendPdf(res, preview.data, preview.fileName)
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/:schoolId/reports/cards/:reportCardId/versions/:version/pdf',
    admin,
    async (req, res, next) => {
      try {
        const version = parseVersion(routeParam(req, 'version'))

        if (version === undefined) {
          throw new HttpError(400, 'Report version is required')
        }

        const pdf = await service.getStoredPdf(
          actorFromRequest(req),
          routeParam(req, 'reportCardId'),
          version,
          auditFromRequest(req),
        )
        sendPdf(res, pdf.data, pdf.fileName)
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}
