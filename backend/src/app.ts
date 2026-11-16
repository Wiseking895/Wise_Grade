import cors from 'cors'
import express, { type Express } from 'express'
import helmet from 'helmet'
import type { AuthRepository } from './auth/repository.js'
import { createPrismaAuthRepository } from './auth/prisma-repository.js'
import { getAllowedOrigins } from './config/env.js'
import { HttpError } from './errors/http-error.js'
import {
  errorHandler,
  notFoundHandler,
} from './middleware/error-handler.js'
import { createAuthRouter } from './routes/auth.js'
import { healthRouter } from './routes/health.js'
import { createSchoolsRouter } from './routes/schools.js'
import type { CalendarRepository } from './calendar/types.js'
import type { CalendarService } from './calendar/service.js'
import { createCalendarService } from './calendar/service.js'
import { createPrismaCalendarRepository } from './calendar/prisma-repository.js'
import { createReportPreparation } from './calendar/report-preparation.js'
import {
  createPlatformCalendarRouter,
  createSchoolCalendarRouter,
} from './calendar/routes.js'
import {
  createAssessmentsRouter,
  createPlatformAssessmentsRouter,
} from './routes/assessments.js'
import { createReportsRouter } from './routes/reports.js'
import {
  createPlatformReportsRouter,
  type PlatformReportsRouterOptions,
} from './routes/report-release.js'
import type { SchoolRepository } from './schools/repository.js'
import { createPrismaSchoolRepository } from './schools/prisma-repository.js'
import type { AssessmentRepository } from './assessment/repository.js'
import { createPrismaAssessmentRepository } from './assessment/prisma-repository.js'
import type { ReportRepository } from './reports/repository.js'
import { createPrismaReportRepository } from './reports/prisma-repository.js'
import { ReportService } from './reports/service.js'
import type { ReportReleaseRepository } from './reports/release-repository.js'
import { createPrismaReportReleaseRepository } from './reports/release-prisma-repository.js'
import { ReportReleaseService } from './reports/release-service.js'
import { ReportWorkflowService } from './reports/workflow-service.js'
import type { BillingRepository } from './billing/repository.js'
import { createPrismaBillingRepository } from './billing/prisma-repository.js'
import { BillingService } from './billing/service.js'
import type { PaymentProvider } from './billing/provider.js'
import { paymentProviderFromEnvironment } from './billing/provider.js'
import {
  createBillingRouter,
  createPaymentWebhookRouter,
  createPlatformBillingRouter,
  type BillingRouterOptions,
} from './routes/billing.js'
import type { StorageAdapter } from './storage/storage.js'
import { createStorageAdapter } from './storage/storage.js'
import type { PlatformRepository } from './platform/repository.js'
import { createPrismaPlatformRepository } from './platform/prisma-repository.js'
import {
  createPlatformRouter,
  type PlatformRouterOptions,
} from './platform/routes.js'
import type { PlatformOperationsRepository } from './platform/operations-repository.js'
import { createPrismaOperationsRepository } from './platform/prisma-operations-repository.js'
import { createPlatformNotifier, type PlatformNotifier } from './platform/notifications.js'
import { createPlatformHealthService, type PlatformHealthService } from './platform/health.js'
import {
  createPlatformSecurityService,
  type PlatformSecurityService,
} from './platform/security.js'
import { createPlatformOperationsRouter } from './platform/operations-routes.js'
import { createRequireReauth } from './platform/reauth.js'
import { env } from './config/env.js'
import type { ReverseGeocoder } from './location/types.js'
import { reverseGeocoderFromEnvironment } from './location/reverse-geocoder.js'
import {
  createLocationRouter,
  type LocationRouterOptions,
} from './location/routes.js'

export interface AppOptions {
  /**
   * Injectable persistence for tests. Production uses the Prisma-backed
   * repository, which opens no database connection until a request needs one.
   */
  authRepository?: AuthRepository
  /** Injectable Phase 3 persistence for credential-free HTTP tests. */
  schoolRepository?: SchoolRepository
  /** Injectable Phase 4 persistence for credential-free HTTP tests. */
  assessmentRepository?: AssessmentRepository
  /** Injectable Phase 5 persistence and private storage for HTTP tests. */
  reportRepository?: ReportRepository
  reportStorage?: StorageAdapter
  reportService?: ReportService
  /** Injectable Phase 6B release persistence for HTTP tests. */
  reportReleaseRepository?: ReportReleaseRepository
  reportReleaseService?: ReportReleaseService
  reportWorkflowService?: ReportWorkflowService
  platformReportRateLimits?: PlatformReportsRouterOptions
  /** Injectable Phase 6A persistence, private storage and payment provider. */
  billingRepository?: BillingRepository
  billingStorage?: StorageAdapter
  billingService?: BillingService
  paymentProvider?: PaymentProvider | null
  /** Injectable automatic academic calendar persistence and service. */
  calendarRepository?: CalendarRepository
  calendarService?: CalendarService
  /** Injectable Phase 9 platform administration persistence. */
  platformRepository?: PlatformRepository
  /** Injectable platform operations persistence, health, security and notifier. */
  platformOperationsRepository?: PlatformOperationsRepository
  platformHealthService?: PlatformHealthService
  platformSecurityService?: PlatformSecurityService
  platformNotifier?: PlatformNotifier
  platformRateLimits?: Pick<
    PlatformRouterOptions,
    'accountRateLimit' | 'schoolCreationRateLimit'
  >
  /** Optional override for the central school-registration switch. */
  registrationGuard?: () => Promise<boolean>
  /** Injectable reverse geocoder for deterministic location tests. */
  reverseGeocoder?: ReverseGeocoder
  locationRateLimit?: LocationRouterOptions['rateLimit']
  /** Optional overrides for sensitive billing endpoint rate limits. */
  billingRateLimits?: BillingRouterOptions
  loginRateLimit?: { windowMs: number; max: number }
  registrationRateLimit?: { windowMs: number; max: number }
  passwordResetRateLimit?: { windowMs: number; max: number }
  /**
   * Injectable origin allow-list for tests. Production and development both
   * derive it from configuration via `getAllowedOrigins()`.
   */
  allowedOrigins?: string[]
}

export function createApp(options: AppOptions = {}): Express {
  const app = express()
  const allowedOrigins = options.allowedOrigins ?? getAllowedOrigins()
  const authRepository = options.authRepository ?? createPrismaAuthRepository()
  const schoolRepository =
    options.schoolRepository ?? createPrismaSchoolRepository()
  const assessmentRepository =
    options.assessmentRepository ?? createPrismaAssessmentRepository()
  const reportRepository =
    options.reportRepository ?? createPrismaReportRepository()
  const reportStorage = options.reportStorage ?? createStorageAdapter()
  const reportService =
    options.reportService ??
    new ReportService({ repository: reportRepository, storage: reportStorage })
  const reportReleaseRepository =
    options.reportReleaseRepository ?? createPrismaReportReleaseRepository()
  const reportReleaseService =
    options.reportReleaseService ??
    new ReportReleaseService({
      repository: reportReleaseRepository,
      storage: reportStorage,
    })
  const reportWorkflowService =
    options.reportWorkflowService ??
    new ReportWorkflowService({
      reports: reportService,
      releases: reportReleaseService,
    })
  const billingRepository =
    options.billingRepository ?? createPrismaBillingRepository()
  const billingStorage = options.billingStorage ?? reportStorage
  const billingService =
    options.billingService ??
    new BillingService({
      repository: billingRepository,
      storage: billingStorage,
      provider:
        options.paymentProvider !== undefined
          ? options.paymentProvider
          : paymentProviderFromEnvironment(),
    })
  const calendarRepository =
    options.calendarRepository ?? createPrismaCalendarRepository()
  const calendarService =
    options.calendarService ??
    createCalendarService({
      repository: calendarRepository,
      prepareReports: createReportPreparation(reportService, calendarRepository),
    })
  const platformRepository =
    options.platformRepository ?? createPrismaPlatformRepository()
  const platformOperations =
    options.platformOperationsRepository ?? createPrismaOperationsRepository()
  const platformNotifier =
    options.platformNotifier ?? createPlatformNotifier(platformOperations)
  const platformHealth =
    options.platformHealthService ??
    createPlatformHealthService({
      storage: reportStorage,
      operations: platformOperations,
    })
  const platformSecurity =
    options.platformSecurityService ??
    createPlatformSecurityService({
      authRepository,
      operations: platformOperations,
    })
  const requireSensitiveReauth = createRequireReauth(
    platformOperations,
    'SENSITIVE_ACTION',
  )
  // Credential-free unit tests must not open a database just to read the
  // registration switch. Production and development use the persisted value.
  const registrationGuard =
    options.registrationGuard ??
    (env.NODE_ENV === 'test'
      ? undefined
      : () => platformRepository.isRegistrationEnabled())
  const reverseGeocoder =
    options.reverseGeocoder ?? reverseGeocoderFromEnvironment()

  app.disable('x-powered-by')

  app.use(helmet())
  // CORS must run before every route, body parser and error handler so that
  // both preflight and actual responses carry the correct headers. Allowed
  // origins are an explicit list; credentials are enabled because the session
  // is an HttpOnly cookie, so a wildcard is never used.
  app.use(
    cors({
      origin(origin, callback) {
        // Requests without an Origin header (curl, server-to-server,
        // same-origin) are not browser cross-origin requests.
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true)
          return
        }

        callback(new HttpError(403, `Origin is not allowed: ${origin}`))
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Platform-Reauth'],
      // Answer preflights directly with 204 and cache the result for 10 minutes.
      preflightContinue: false,
      optionsSuccessStatus: 204,
      maxAge: 600,
    }),
  )
  // Webhooks must see the exact raw bytes, so this mount runs before the JSON
  // body parser. Signatures are verified against the unmodified payload.
  app.use(
    '/api/webhooks',
    express.raw({ type: 'application/json', limit: '1mb' }),
    createPaymentWebhookRouter(billingService, options.billingRateLimits),
  )

  // Pupil photographs are compressed in the browser, but a 5 MB JPEG/PNG is
  // still roughly 6.7 MB once base64-encoded. Allow that envelope while keeping
  // the hard decoded limits in the school-image validators.
  app.use(express.json({ limit: '8mb' }))
  app.use(express.urlencoded({ extended: false, limit: '1mb' }))

  app.use('/api/health', healthRouter)
  app.use(
    '/api/auth',
    createAuthRouter(authRepository, {
      trustedOrigins: allowedOrigins,
      storage: reportStorage,
      loginRateLimit: options.loginRateLimit,
      registrationRateLimit: options.registrationRateLimit,
      passwordResetRateLimit: options.passwordResetRateLimit,
      registrationGuard,
      notifier: platformNotifier,
    }),
  )
  app.use('/api/schools', createSchoolsRouter(authRepository, schoolRepository, allowedOrigins, reportStorage))
  // One-shot, authenticated reverse geocoding for the location indicator. It is
  // not school-scoped because it only resolves the signed-in user's own view.
  app.use(
    '/api/location',
    createLocationRouter(authRepository, reverseGeocoder, {
      rateLimit: options.locationRateLimit,
    }),
  )
  // The assessments router accepts restricted subject sessions, so it must run
  // before the calendar router, whose normal-user middleware would reject them
  // before they reach their assignment-scoped endpoints.
  app.use(
    '/api/schools',
    createAssessmentsRouter(
      authRepository,
      assessmentRepository,
      allowedOrigins,
    ),
  )
  app.use(
    '/api/schools',
    createSchoolCalendarRouter(
      authRepository,
      calendarService,
      allowedOrigins,
    ),
  )
  app.use(
    '/api/schools',
    createReportsRouter(
      authRepository,
      reportService,
      allowedOrigins,
      reportWorkflowService,
    ),
  )
  app.use(
    '/api/schools',
    createBillingRouter(
      authRepository,
      billingService,
      allowedOrigins,
      {
        ...options.billingRateLimits,
        notifier: options.billingRateLimits?.notifier ?? platformNotifier,
        requireReauth:
          options.billingRateLimits?.requireReauth ?? requireSensitiveReauth,
      },
    ),
  )
  app.use(
    '/api/platform/assessments',
    createPlatformAssessmentsRouter(
      authRepository,
      assessmentRepository,
      allowedOrigins,
    ),
  )
  app.use(
    '/api/platform/billing',
    createPlatformBillingRouter(
      authRepository,
      billingService,
      allowedOrigins,
      {
        ...options.billingRateLimits,
        notifier: options.billingRateLimits?.notifier ?? platformNotifier,
        requireReauth:
          options.billingRateLimits?.requireReauth ?? requireSensitiveReauth,
      },
    ),
  )
  app.use(
    '/api/platform/reports',
    createPlatformReportsRouter(
      authRepository,
      reportReleaseService,
      reportService,
      reportWorkflowService,
      allowedOrigins,
      {
        ...options.platformReportRateLimits,
        notifier: options.platformReportRateLimits?.notifier ?? platformNotifier,
        requireReauth:
          options.platformReportRateLimits?.requireReauth ??
          requireSensitiveReauth,
      },
    ),
  )
  app.use(
    '/api/platform/calendar',
    createPlatformCalendarRouter(
      authRepository,
      calendarService,
      allowedOrigins,
    ),
  )
  // Operational platform surfaces run before the generic router so their
  // specific paths keep precedence and share the same authentication guards.
  app.use(
    '/api/platform',
    createPlatformOperationsRouter(authRepository, {
      operations: platformOperations,
      health: platformHealth,
      security: platformSecurity,
      trustedOrigins: allowedOrigins,
    }),
  )
  // Mounted last so the more specific platform routers above keep precedence.
  app.use(
    '/api/platform',
    createPlatformRouter(
      authRepository,
      platformRepository,
      allowedOrigins,
      {
        storage: reportStorage,
        notifier: platformNotifier,
        requireReauth: requireSensitiveReauth,
        ...options.platformRateLimits,
      },
    ),
  )

  app.locals.calendarService = calendarService
  app.locals.platformOperations = platformOperations
  app.locals.platformNotifier = platformNotifier

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
