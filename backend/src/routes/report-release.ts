import { Router, type Request, type RequestHandler, type Response } from 'express'
import type { z } from 'zod'
import type { AuthRepository } from '../auth/repository.js'
import { HttpError } from '../errors/http-error.js'
import { createAuthenticate } from '../middleware/authenticate.js'
import { requirePlatformAdmin } from '../middleware/authorize.js'
import { requireTrustedOrigin } from '../middleware/csrf.js'
import { createRateLimiter } from '../middleware/rate-limit.js'
import {
  silentNotifier,
  type PlatformNotifier,
} from '../platform/notifications.js'
import type {
  ReportActor,
} from '../reports/repository.js'
import type { ReportReleaseAuditContext } from '../reports/release-repository.js'
import type {
  ReportReleaseBatchDetail,
  ReportReleaseService,
} from '../reports/release-service.js'
import type { ReportService } from '../reports/service.js'
import type { ReportWorkflowService } from '../reports/workflow-service.js'
import {
  platformReportBatchesQuerySchema,
  reportClassesQuerySchema,
  reportEligibilityQuerySchema,
} from '../reports/validation.js'

export interface PlatformReportsRouterOptions {
  writeRateLimit?: { windowMs: number; max: number }
  /** Best-effort platform notification sink. */
  notifier?: PlatformNotifier
  /** Reauthentication gate for release decisions. */
  requireReauth?: RequestHandler
}

function actorKey(req: Request): string {
  return `${req.ip ?? 'unknown'}|${req.auth?.user.id ?? 'anonymous'}`
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

function auditFromRequest(req: Request): ReportReleaseAuditContext {
  const auth = requireAuth(req)

  return {
    actorUserId: auth.user.id,
    actorMembershipId: null,
    actorRole: 'PLATFORM_SUPER_ADMIN',
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  }
}

function platformReportActor(req: Request, schoolId: string): ReportActor {
  const auth = requireAuth(req)

  return {
    schoolId,
    userId: auth.user.id,
    membershipId: null,
    role: 'PLATFORM_SUPER_ADMIN',
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
 * Platform-super-admin report generation routes.
 *
 * An accepted request has exactly two operational actions: Generate Reports and,
 * after a partial or fatal failure, Retry. Generation consumes only accepted
 * academic results and the completed batch becomes available automatically.
 * There is no platform academic review, second approval or manual release route.
 * Every action is audited and previews stream private bytes through the backend.
 */
export function createPlatformReportsRouter(
  authRepository: AuthRepository,
  service: ReportReleaseService,
  reportService: ReportService,
  workflow: ReportWorkflowService,
  trustedOrigins: string[],
  options: PlatformReportsRouterOptions = {},
): Router {
  const router = Router()
  const authenticate = createAuthenticate(authRepository)
  const platformAdmin = requirePlatformAdmin()
  const trustedOrigin = requireTrustedOrigin(trustedOrigins)
  const notifier = options.notifier ?? silentNotifier
  const reauth: RequestHandler =
    options.requireReauth ?? ((_req, _res, next) => next())

  async function notifyBatch(
    type: string,
    severity: 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL',
    title: string,
    batch: ReportReleaseBatchDetail,
    dedupeSuffix: string,
  ): Promise<void> {
    await notifier.notify({
      type,
      severity,
      title,
      body: `${batch.schoolName} · ${batch.academicTermName} · ${batch.reportCount} report(s)`,
      schoolId: batch.schoolId,
      entityType: 'ReportGenerationBatch',
      entityId: batch.id,
      link: '/platform/reports',
      dedupeKey: `${type.toLowerCase()}:${batch.id}:${dedupeSuffix}`,
    })
  }

  const writeLimiter = createRateLimiter({
    windowMs: options.writeRateLimit?.windowMs ?? 15 * 60 * 1000,
    max: options.writeRateLimit?.max ?? 60,
    scope: 'platform-report-release',
    keyGenerator: actorKey,
  }).middleware

  router.use(authenticate, platformAdmin, trustedOrigin)

  router.get('/overview', async (_req, res, next) => {
    try {
      const overview = await service.overview()
      res.status(200).json({ data: { overview } })
    } catch (error) {
      next(error)
    }
  })

  router.get('/schools', async (_req, res, next) => {
    try {
      const schools = await service.listPlatformSchools()
      res.status(200).json({ data: { schools } })
    } catch (error) {
      next(error)
    }
  })

  router.get('/schools/:schoolId/report-classes', async (req, res, next) => {
    try {
      const query = parseQuery(reportClassesQuerySchema, req.query)
      const classes = await reportService.listClasses(
        platformReportActor(req, routeParam(req, 'schoolId')),
        query.academicYearId,
        query.academicTermId,
      )
      res.status(200).json({ data: { classes } })
    } catch (error) {
      next(error)
    }
  })

  router.get(
    '/schools/:schoolId/report-eligibility',
    async (req, res, next) => {
      try {
        const query = parseQuery(reportEligibilityQuerySchema, req.query)
        const eligibility = await reportService.checkEligibility(
          platformReportActor(req, routeParam(req, 'schoolId')),
          query,
        )
        res.status(200).json({ data: { eligibility } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get('/batches', async (req, res, next) => {
    try {
      const query = parseQuery(platformReportBatchesQuerySchema, req.query)
      const batches = await service.listPlatformBatches({
        schoolId: query.schoolId,
        academicYearId: query.academicYearId,
        academicTermId: query.academicTermId,
        status: query.status,
        submittedFrom: query.submittedFrom
          ? new Date(`${query.submittedFrom}T00:00:00.000Z`)
          : undefined,
        submittedTo: query.submittedTo
          ? new Date(`${query.submittedTo}T23:59:59.999Z`)
          : undefined,
      })

      res.status(200).json({ data: { batches } })
    } catch (error) {
      next(error)
    }
  })

  router.get('/batches/:batchId', async (req, res, next) => {
    try {
      const batch = await workflow.getPlatformRequest(
        routeParam(req, 'batchId'),
      )
      res.status(200).json({ data: { batch } })
    } catch (error) {
      next(error)
    }
  })

  router.get(
    '/batches/:batchId/versions/:versionId/preview',
    async (req, res, next) => {
      try {
        const preview = await service.previewPlatformVersion(
          routeParam(req, 'batchId'),
          routeParam(req, 'versionId'),
        )
        sendPdf(res, preview.data, preview.fileName)
      } catch (error) {
        next(error)
      }
    },
  )

  // The developer's only operational action for an accepted request.
  router.post(
    '/batches/:batchId/generate',
    writeLimiter,
    reauth,
    async (req, res, next) => {
      try {
        const outcome = await workflow.generate(
          { userId: requireAuth(req).user.id },
          routeParam(req, 'batchId'),
          auditFromRequest(req),
        )
        await notifyBatch(
          'REPORT_REQUEST_GENERATED',
          outcome.batch.releaseStatus === 'RELEASED' ? 'SUCCESS' : 'WARNING',
          outcome.batch.releaseStatus === 'RELEASED'
            ? `Reports generated for ${outcome.batch.schoolName}`
            : `Report generation needs attention for ${outcome.batch.schoolName}`,
          outcome.batch,
          `${outcome.batch.generatedCount}:${outcome.batch.failedCount}`,
        )
        res.status(200).json({ data: outcome })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/batches/:batchId/retry',
    writeLimiter,
    reauth,
    async (req, res, next) => {
      try {
        const outcome = await workflow.retry(
          { userId: requireAuth(req).user.id },
          routeParam(req, 'batchId'),
          auditFromRequest(req),
        )
        await notifyBatch(
          'REPORT_GENERATION_RETRIED',
          outcome.batch.releaseStatus === 'RELEASED' ? 'SUCCESS' : 'WARNING',
          `Report generation retried for ${outcome.batch.schoolName}`,
          outcome.batch,
          `${outcome.batch.generatedCount}:${outcome.batch.failedCount}`,
        )
        res.status(200).json({ data: outcome })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}
