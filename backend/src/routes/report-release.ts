import { Router, type Request, type RequestHandler, type Response } from 'express'
import type { z } from 'zod'
import { parseBody } from '../auth/validation.js'
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
  ReportAuditContext,
} from '../reports/repository.js'
import type { ReportReleaseAuditContext } from '../reports/release-repository.js'
import type {
  ReportReleaseBatchDetail,
  ReportReleaseService,
} from '../reports/release-service.js'
import type { ReportService } from '../reports/service.js'
import type { ReportWorkflowService } from '../reports/workflow-service.js'
import {
  generateReportsSchema,
  platformReportBatchesQuerySchema,
  reportClassesQuerySchema,
  reportEligibilityQuerySchema,
  reportReleaseReasonSchema,
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

function platformReportAudit(req: Request): ReportAuditContext {
  const auth = requireAuth(req)

  return {
    actorUserId: auth.user.id,
    actorMembershipId: null,
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
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
 * Platform-super-admin report review and release routes.
 *
 * Approval and release are separate operations. Every action is audited and
 * every preview streams private bytes through the backend; no object key or
 * public storage URL is ever returned.
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

  router.post(
    '/schools/:schoolId/reports/generate',
    writeLimiter,
    async (req, res, next) => {
      try {
        const schoolId = routeParam(req, 'schoolId')
        const input = parseBody(generateReportsSchema, req.body)
        const generated = await reportService.generate(
          platformReportActor(req, schoolId),
          input,
          platformReportAudit(req),
        )
        const batch = await service.submitGenerated(
          generated.batch.id,
          schoolId,
          auditFromRequest(req),
        )

        await notifyBatch(
          'REPORT_BATCH_SUBMITTED',
          'INFO',
          `Report batch submitted by ${batch.schoolName}`,
          batch,
          String(batch.submittedAt),
        )

        res.status(201).json({
          data: { batch, results: generated.results },
        })
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

  router.post(
    '/batches/:batchId/queue',
    writeLimiter,
    async (req, res, next) => {
      try {
        const existing = await service.getPlatformBatch(
          routeParam(req, 'batchId'),
        )
        const batch = await service.submitGenerated(
          existing.id,
          existing.schoolId,
          auditFromRequest(req),
        )
        await notifyBatch(
          'REPORT_BATCH_SUBMITTED',
          'INFO',
          `Report batch submitted by ${batch.schoolName}`,
          batch,
          String(batch.submittedAt),
        )
        res.status(200).json({ data: { batch } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/batches/:batchId/approve',
    writeLimiter,
    reauth,
    async (req, res, next) => {
      try {
        const outcome = await workflow.approve(
          { userId: requireAuth(req).user.id },
          routeParam(req, 'batchId'),
          auditFromRequest(req),
        )
        await notifyBatch(
          'REPORT_REQUEST_APPROVED',
          outcome.batch.releaseStatus === 'RELEASED' ? 'SUCCESS' : 'WARNING',
          outcome.batch.releaseStatus === 'RELEASED'
            ? `Reports generated and released for ${outcome.batch.schoolName}`
            : `Report generation needs attention for ${outcome.batch.schoolName}`,
          outcome.batch,
          String(outcome.batch.reviewedAt),
        )
        res.status(200).json({ data: outcome })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/batches/:batchId/reject',
    writeLimiter,
    reauth,
    async (req, res, next) => {
      try {
        const input = parseBody(reportReleaseReasonSchema, req.body)
        const batch = await workflow.reject(
          { userId: requireAuth(req).user.id },
          routeParam(req, 'batchId'),
          input.reason,
          auditFromRequest(req),
        )
        await notifyBatch(
          'REPORT_REQUEST_REJECTED',
          'WARNING',
          `Report request rejected for ${batch.schoolName}`,
          batch,
          String(batch.reviewedAt),
        )
        res.status(200).json({ data: { batch } })
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

  router.post(
    '/batches/:batchId/return',
    writeLimiter,
    reauth,
    async (req, res, next) => {
      try {
        const input = parseBody(reportReleaseReasonSchema, req.body)
        const batch = await service.returnBatch(
          { userId: requireAuth(req).user.id },
          routeParam(req, 'batchId'),
          input.reason,
          auditFromRequest(req),
        )
        await notifyBatch(
          'REPORT_BATCH_RETURNED',
          'WARNING',
          `Report batch returned to ${batch.schoolName}`,
          batch,
          String(batch.reviewedAt),
        )
        res.status(200).json({ data: { batch } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/batches/:batchId/hold',
    writeLimiter,
    reauth,
    async (req, res, next) => {
      try {
        const input = parseBody(reportReleaseReasonSchema, req.body)
        const batch = await service.hold(
          { userId: requireAuth(req).user.id },
          routeParam(req, 'batchId'),
          input.reason,
          auditFromRequest(req),
        )
        await notifyBatch(
          'REPORT_BATCH_HELD',
          'WARNING',
          `Report batch placed on hold for ${batch.schoolName}`,
          batch,
          String(batch.heldAt),
        )
        res.status(200).json({ data: { batch } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/batches/:batchId/unhold',
    writeLimiter,
    reauth,
    async (req, res, next) => {
      try {
        const batch = await service.unhold(
          routeParam(req, 'batchId'),
          auditFromRequest(req),
        )
        await notifyBatch(
          'REPORT_BATCH_UNHELD',
          'INFO',
          `Report batch returned to review for ${batch.schoolName}`,
          batch,
          String(batch.releaseStatus),
        )
        res.status(200).json({ data: { batch } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/batches/:batchId/release',
    writeLimiter,
    reauth,
    async (req, res, next) => {
      try {
        const batch = await service.release(
          { userId: requireAuth(req).user.id },
          routeParam(req, 'batchId'),
          auditFromRequest(req),
        )
        await notifyBatch(
          'REPORT_BATCH_RELEASED',
          'SUCCESS',
          `Reports released for ${batch.schoolName}`,
          batch,
          String(batch.releasedAt),
        )
        res.status(200).json({ data: { batch } })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}
