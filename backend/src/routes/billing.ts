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
import type { BillingAuditContext } from '../billing/repository.js'
import type { BillingService } from '../billing/service.js'
import {
  billingAuditQuerySchema,
  createInvoiceSchema,
  manualPaymentSchema,
  onlinePaymentSchema,
  paymentDecisionSchema,
  platformInvoiceQuerySchema,
  pricingRuleSchema,
  pricingRuleStatusSchema,
  schoolPaymentQuerySchema,
} from '../billing/validation.js'
import { HttpError } from '../errors/http-error.js'
import { createAuthenticate } from '../middleware/authenticate.js'
import { requirePlatformAdmin, requireRole, requireSchoolAccess } from '../middleware/authorize.js'
import { requireTrustedOrigin } from '../middleware/csrf.js'
import { createRateLimiter } from '../middleware/rate-limit.js'
import {
  silentNotifier,
  type PlatformNotifier,
} from '../platform/notifications.js'

export interface BillingRouterOptions {
  /** Window for school-side payment initiation and submission. */
  paymentRateLimit?: { windowMs: number; max: number }
  /** Window for platform-side invoice, pricing and verification actions. */
  platformRateLimit?: { windowMs: number; max: number }
  /** Window for provider callbacks. */
  webhookRateLimit?: { windowMs: number; max: number }
  /** Best-effort platform notification sink. */
  notifier?: PlatformNotifier
  /**
   * Reauthentication gate for platform money-moving actions (pricing, invoice
   * issue/cancel and payment verification). Omitted in tests that do not opt in.
   */
  requireReauth?: RequestHandler
}

function actorKey(req: Request): string {
  return `${req.ip ?? 'unknown'}|${req.auth?.user.id ?? 'anonymous'}`
}

function requireAccess(req: Request): MembershipRecord {
  if (!req.schoolAccess) {
    throw new HttpError(403, 'You do not have access to this school')
  }

  return req.schoolAccess
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

function auditFromSchoolRequest(req: Request): BillingAuditContext {
  const access = requireAccess(req)
  const auth = requireAuth(req)

  return {
    actorUserId: auth.user.id,
    actorMembershipId: access.id,
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  }
}

function auditFromPlatformRequest(req: Request): BillingAuditContext {
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

function sendEvidence(res: Response, file: {
  data: Buffer
  mimeType: string
  fileName: string
}): void {
  res.setHeader('Content-Type', file.mimeType)
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${file.fileName.replace(/["\\]/g, '')}"`,
  )
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.status(200).send(file.data)
}

/**
 * School-scoped billing routes. Only active school administrators may read
 * invoices or submit payment evidence. Every call is additionally scoped to
 * the authenticated membership's schoolId.
 */
export function createBillingRouter(
  authRepository: AuthRepository,
  service: BillingService,
  trustedOrigins: string[],
  options: BillingRouterOptions = {},
): Router {
  const router = Router()
  const authenticate = createAuthenticate(authRepository)
  const schoolAccess = requireSchoolAccess(authRepository)
  const trustedOrigin = requireTrustedOrigin(trustedOrigins)
  const notifier = options.notifier ?? silentNotifier
  const admin = requireRole('SCHOOL_ADMIN')
  const paymentLimiter = createRateLimiter({
    windowMs: options.paymentRateLimit?.windowMs ?? 15 * 60 * 1000,
    max: options.paymentRateLimit?.max ?? 20,
    scope: 'payment',
    keyGenerator: actorKey,
  }).middleware

  router.use(
    '/:schoolId/billing',
    authenticate,
    schoolAccess,
    trustedOrigin,
  )

  router.get('/:schoolId/billing/invoices', admin, async (req, res, next) => {
    try {
      const invoices = await service.listSchoolInvoices({
        schoolId: requireAccess(req).schoolId,
        userId: requireAuth(req).user.id,
        membershipId: requireAccess(req).id,
        role: requireAccess(req).role,
      })

      res.status(200).json({
        data: {
          invoices,
          onlinePaymentsEnabled: service.onlinePaymentsEnabled,
          provider: service.providerName,
        },
      })
    } catch (error) {
      next(error)
    }
  })

  router.get(
    '/:schoolId/billing/invoices/:invoiceId',
    admin,
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const detail = await service.getSchoolInvoice(
          {
            schoolId: access.schoolId,
            userId: requireAuth(req).user.id,
            membershipId: access.id,
            role: access.role,
          },
          routeParam(req, 'invoiceId'),
        )

        res.status(200).json({ data: detail })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/:schoolId/billing/invoices/:invoiceId/audit',
    admin,
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const detail = await service.getSchoolInvoice(
          {
            schoolId: access.schoolId,
            userId: requireAuth(req).user.id,
            membershipId: access.id,
            role: access.role,
          },
          routeParam(req, 'invoiceId'),
        )
        const audit = await service.listAuditHistory({
          schoolId: access.schoolId,
          invoiceId: detail.invoice.id,
        })

        res.status(200).json({ data: { audit } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get('/:schoolId/billing/payments', admin, async (req, res, next) => {
    try {
      const query = parseQuery(schoolPaymentQuerySchema, req.query)
      const access = requireAccess(req)
      const payments = await service.listSchoolPayments(
        {
          schoolId: access.schoolId,
          userId: requireAuth(req).user.id,
          membershipId: access.id,
          role: access.role,
        },
        query,
      )

      res.status(200).json({ data: { payments } })
    } catch (error) {
      next(error)
    }
  })

  router.get(
    '/:schoolId/billing/payments/:paymentId',
    admin,
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const payment = await service.getSchoolPayment(
          {
            schoolId: access.schoolId,
            userId: requireAuth(req).user.id,
            membershipId: access.id,
            role: access.role,
          },
          routeParam(req, 'paymentId'),
        )

        res.status(200).json({ data: { payment } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/:schoolId/billing/payments/:paymentId/evidence/:evidenceId',
    admin,
    async (req, res, next) => {
      try {
        const file = await service.getEvidence(
          { schoolId: requireAccess(req).schoolId },
          routeParam(req, 'paymentId'),
          routeParam(req, 'evidenceId'),
        )

        sendEvidence(res, file)
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/:schoolId/billing/invoices/:invoiceId/payments/manual',
    admin,
    paymentLimiter,
    async (req, res, next) => {
      try {
        const input = parseBody(manualPaymentSchema, req.body)
        const access = requireAccess(req)
        const payment = await service.submitManualPayment(
          {
            schoolId: access.schoolId,
            userId: requireAuth(req).user.id,
            membershipId: access.id,
            role: access.role,
          },
          routeParam(req, 'invoiceId'),
          input,
          auditFromSchoolRequest(req),
        )

        await notifier.notify({
          type: 'PAYMENT_SUBMITTED',
          severity: 'INFO',
          title: `Payment submitted by ${payment.schoolName}`,
          body: `Invoice ${payment.invoiceNumber} received a manual payment of ${payment.amountMinor} ${payment.currency} (${payment.paymentReference}).`,
          schoolId: payment.schoolId,
          entityType: 'Payment',
          entityId: payment.id,
          link: '/platform/billing',
          dedupeKey: `payment-submitted:${payment.id}`,
        })

        res.status(201).json({ data: { payment } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/:schoolId/billing/invoices/:invoiceId/payments/online',
    admin,
    paymentLimiter,
    async (req, res, next) => {
      try {
        const input = parseBody(onlinePaymentSchema, req.body)
        const access = requireAccess(req)
        const result = await service.initiateOnlinePayment(
          {
            schoolId: access.schoolId,
            userId: requireAuth(req).user.id,
            membershipId: access.id,
            role: access.role,
          },
          routeParam(req, 'invoiceId'),
          input,
          auditFromSchoolRequest(req),
        )

        if (!result.reused) {
          await notifier.notify({
            type: 'PAYMENT_ONLINE_INITIATED',
            severity: 'INFO',
            title: `Online payment initiated for ${result.payment.schoolId}`,
            body: `Payment ${result.payment.paymentReference} was initiated for ${result.payment.amountMinor} ${result.payment.currency}.`,
            schoolId: result.payment.schoolId,
            entityType: 'Payment',
            entityId: result.payment.id,
            link: '/platform/billing',
            dedupeKey: `payment-online-initiated:${result.payment.id}`,
          })
        }

        res.status(201).json({ data: result })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}

/**
 * Platform-super-admin billing routes. A school administrator session is
 * rejected by `requirePlatformAdmin` even when they also hold a school role.
 */
export function createPlatformBillingRouter(
  authRepository: AuthRepository,
  service: BillingService,
  trustedOrigins: string[],
  options: BillingRouterOptions = {},
): Router {
  const router = Router()
  const authenticate = createAuthenticate(authRepository)
  const platformAdmin = requirePlatformAdmin()
  const trustedOrigin = requireTrustedOrigin(trustedOrigins)
  const notifier = options.notifier ?? silentNotifier
  const reauth: RequestHandler =
    options.requireReauth ?? ((_req, _res, next) => next())
  const platformWriteLimiter = createRateLimiter({
    windowMs: options.platformRateLimit?.windowMs ?? 15 * 60 * 1000,
    max: options.platformRateLimit?.max ?? 60,
    scope: 'platform billing',
    keyGenerator: actorKey,
  }).middleware

  router.use(authenticate, platformAdmin, trustedOrigin)

  router.get('/schools', async (_req, res, next) => {
    try {
      const schools = await service.listBillingSchools()
      res.status(200).json({ data: { schools } })
    } catch (error) {
      next(error)
    }
  })

  router.get('/pricing-rules', async (_req, res, next) => {
    try {
      const rules = await service.listPricingRules()
      res.status(200).json({ data: { rules } })
    } catch (error) {
      next(error)
    }
  })

  router.post('/pricing-rules', platformWriteLimiter, reauth, async (req, res, next) => {
    try {
      const input = parseBody(pricingRuleSchema, req.body)
      const actor = { userId: requireAuth(req).user.id }
      const rule = await service.createPricingRule(
        actor,
        input,
        auditFromPlatformRequest(req),
      )

      res.status(201).json({ data: { rule } })
    } catch (error) {
      next(error)
    }
  })

  router.patch('/pricing-rules/:ruleId', platformWriteLimiter, reauth, async (req, res, next) => {
    try {
      const input = parseBody(pricingRuleStatusSchema, req.body)
      const actor = { userId: requireAuth(req).user.id }
      const rule = await service.setPricingRuleActive(
        actor,
        routeParam(req, 'ruleId'),
        input.isActive,
        auditFromPlatformRequest(req),
      )

      res.status(200).json({ data: { rule } })
    } catch (error) {
      next(error)
    }
  })

  router.get('/invoices', async (req, res, next) => {
    try {
      const query = parseQuery(platformInvoiceQuerySchema, req.query)
      const invoices = await service.listPlatformInvoices()
      const filtered = query.status
        ? invoices.filter((invoice) => invoice.status === query.status)
        : invoices
      const scoped = query.schoolId
        ? filtered.filter((invoice) => invoice.schoolId === query.schoolId)
        : filtered

      res.status(200).json({ data: { invoices: scoped } })
    } catch (error) {
      next(error)
    }
  })

  router.get('/invoices/:invoiceId', async (req, res, next) => {
    try {
      const detail = await service.getPlatformInvoice(
        routeParam(req, 'invoiceId'),
      )
      res.status(200).json({ data: detail })
    } catch (error) {
      next(error)
    }
  })

  router.post('/invoices', platformWriteLimiter, reauth, async (req, res, next) => {
    try {
      const input = parseBody(createInvoiceSchema, req.body)
      const actor = { userId: requireAuth(req).user.id }
      const result = await service.createInvoice(
        actor,
        input,
        auditFromPlatformRequest(req),
      )

      res.status(result.reusedDraft ? 200 : 201).json({
        data: {
          invoice: result.detail.invoice,
          pupils: result.detail.pupils,
          lines: result.detail.lines,
          reusedDraft: result.reusedDraft,
        },
      })
    } catch (error) {
      next(error)
    }
  })

  router.post('/invoices/:invoiceId/issue', platformWriteLimiter, reauth, async (req, res, next) => {
    try {
      const actor = { userId: requireAuth(req).user.id }
      const detail = await service.issueInvoice(
        actor,
        routeParam(req, 'invoiceId'),
        auditFromPlatformRequest(req),
      )

      res.status(200).json({ data: detail })
    } catch (error) {
      next(error)
    }
  })

  router.post('/invoices/:invoiceId/cancel', platformWriteLimiter, reauth, async (req, res, next) => {
    try {
      const actor = { userId: requireAuth(req).user.id }
      const detail = await service.cancelInvoice(
        actor,
        routeParam(req, 'invoiceId'),
        auditFromPlatformRequest(req),
      )

      res.status(200).json({ data: detail })
    } catch (error) {
      next(error)
    }
  })

  router.get('/payments/pending', async (_req, res, next) => {
    try {
      const payments = await service.listPendingPayments()
      res.status(200).json({ data: { payments } })
    } catch (error) {
      next(error)
    }
  })

  router.get('/payments/verified', async (_req, res, next) => {
    try {
      const payments = await service.listVerifiedPayments()
      res.status(200).json({ data: { payments } })
    } catch (error) {
      next(error)
    }
  })

  router.get('/payments/:paymentId', async (req, res, next) => {
    try {
      const payment = await service.getPlatformPayment(
        routeParam(req, 'paymentId'),
      )
      res.status(200).json({ data: { payment } })
    } catch (error) {
      next(error)
    }
  })

  router.get(
    '/payments/:paymentId/evidence/:evidenceId',
    async (req, res, next) => {
      try {
        const file = await service.getEvidence(
          { platform: true },
          routeParam(req, 'paymentId'),
          routeParam(req, 'evidenceId'),
        )

        sendEvidence(res, file)
      } catch (error) {
        next(error)
      }
    },
  )

  router.post('/payments/:paymentId/verify', platformWriteLimiter, reauth, async (req, res, next) => {
    try {
      const input = parseBody(paymentDecisionSchema, req.body)
      const actor = { userId: requireAuth(req).user.id }
      const result = await service.verifyPayment(
        actor,
        routeParam(req, 'paymentId'),
        input,
        auditFromPlatformRequest(req),
      )

      await notifier.notify({
        type:
          input.decision === 'VERIFIED'
            ? 'PAYMENT_VERIFIED'
            : 'PAYMENT_REJECTED',
        severity: input.decision === 'VERIFIED' ? 'SUCCESS' : 'WARNING',
        title:
          input.decision === 'VERIFIED'
            ? `Payment verified for ${result.invoice.schoolName}`
            : `Payment rejected for ${result.invoice.schoolName}`,
        body: `Invoice ${result.invoice.invoiceNumber}: ${result.payment.amountMinor} ${result.payment.currency} (${result.payment.paymentReference}).`,
        schoolId: result.payment.schoolId,
        entityType: 'Payment',
        entityId: result.payment.id,
        link: '/platform/billing',
        dedupeKey: `payment-decision:${result.payment.id}:${input.decision}`,
      })

      res.status(200).json({ data: result })
    } catch (error) {
      next(error)
    }
  })

  router.get('/audit', async (req, res, next) => {
    try {
      const query = parseQuery(billingAuditQuerySchema, req.query)
      const auditHistory = await service.listAuditHistory(query)
      res.status(200).json({ data: { audit: auditHistory } })
    } catch (error) {
      next(error)
    }
  })

  return router
}

/**
 * Provider-neutral webhook endpoint.
 *
 * This router is mounted before `express.json()` so the signature can be
 * verified against the exact raw bytes the provider sent. No session cookie is
 * accepted here: the provider authenticates with its signature only.
 */
export function createPaymentWebhookRouter(
  service: BillingService,
  options: BillingRouterOptions = {},
): Router {
  const router = Router()
  const webhookLimiter = createRateLimiter({
    windowMs: options.webhookRateLimit?.windowMs ?? 60 * 1000,
    max: options.webhookRateLimit?.max ?? 120,
    scope: 'payment webhook',
    keyGenerator: (req) =>
      `${req.ip ?? 'unknown'}|${req.params.provider ?? 'unknown'}`,
  }).middleware

  router.post('/payments/:provider', webhookLimiter, async (req, res, next) => {
    try {
      if (!Buffer.isBuffer(req.body)) {
        throw new HttpError(
          415,
          'The payment webhook requires a raw application/json body',
        )
      }

      const result = await service.handleProviderWebhook(
        routeParam(req, 'provider'),
        req.body,
        req.headers,
      )

      res.status(200).json({ data: result })
    } catch (error) {
      next(error)
    }
  })

  return router
}
