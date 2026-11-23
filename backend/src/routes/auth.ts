import { Router, type Request, type Response } from 'express'
import { randomUUID } from 'node:crypto'
import { env } from '../config/env.js'
import { HttpError } from '../errors/http-error.js'
import { noStore } from '../middleware/cache.js'
import { requireTrustedOrigin } from '../middleware/csrf.js'
import { createRateLimiter } from '../middleware/rate-limit.js'
import { createAuthenticate, type AuthContext } from '../middleware/authenticate.js'
import { verifyPassword, hashPassword } from '../auth/password.js'
import {
  decryptMfaSecret,
  verifyRecoveryCodeHash,
  verifyTotp,
} from '../auth/mfa.js'
import { toPublicMembership, toPublicSchool, toPublicUser } from '../auth/presenter.js'
import { isUniqueConstraintError } from '../auth/prisma-repository.js'
import { usableMemberships } from '../auth/membership-access.js'
import type { AuthRepository } from '../auth/repository.js'
import { clearSessionCookieOptions, sessionCookieOptions, subjectSessionCookieOptions, SESSION_COOKIE_NAME, SUBJECT_SESSION_COOKIE_NAME } from '../auth/session.js'
import { generateOpaqueToken, hashToken } from '../auth/tokens.js'
import { createAuthenticateSubjectTeacher, createAuthenticateEither } from '../middleware/subject-authenticate.js'
import {
  silentNotifier,
  type PlatformNotifier,
} from '../platform/notifications.js'
import {
  changePasswordSchema,
  emailVerificationConfirmSchema,
  loginSchema,
  parseBody,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  registerSchoolSchema,
  subjectTeacherAccessCodeSchema,
} from '../auth/validation.js'
import { buildSchoolSlug } from '../lib/slug.js'
import {
  decodeSchoolLogo,
  schoolLogoStorageKey,
} from '../lib/school-branding.js'
import type { StorageAdapter } from '../storage/storage.js'
import {
  NoopEmailService,
  type EmailService,
} from '../email/service.js'
import { formatEmailDateTime } from '../email/templates.js'
import {
  changePasswordUrl,
  dashboardUrl,
  verificationUrl,
} from '../email/links.js'

const PASSWORD_RESET_TTL_MINUTES = 60
const LOGIN_LOCK_THRESHOLD = 5
const LOGIN_LOCK_DURATION_MS = 15 * 60 * 1000

let dummyPasswordHash: Promise<string> | undefined

/**
 * A real hash used to equalize response time when the email is unknown, so
 * login timing does not reveal which accounts exist.
 */
function getDummyPasswordHash(): Promise<string> {
  if (!dummyPasswordHash) {
    dummyPasswordHash = hashPassword('not-a-real-account-password')
  }

  return dummyPasswordHash
}

export interface AuthRouterOptions {
  trustedOrigins: string[]
  storage: StorageAdapter
  sessionTtlMinutes?: number
  loginRateLimit?: { windowMs: number; max: number }
  registrationRateLimit?: { windowMs: number; max: number }
  passwordResetRateLimit?: { windowMs: number; max: number }
  emailVerificationRateLimit?: { windowMs: number; max: number }
  passwordChangeRateLimit?: { windowMs: number; max: number }
  /** Injectable transactional email service. Tests use a no-op or capture double. */
  email?: EmailService
  emailVerificationExpiryHours?: number
  /**
   * Optional central registration switch. It is supplied by the platform
   * settings service in production and omitted in credential-free unit tests,
   * where registration must keep working without a database.
   */
  registrationGuard?: () => Promise<boolean>
  /** Best-effort platform notification sink for lockouts and registrations. */
  notifier?: PlatformNotifier
}

export function loginRateLimitKey(req: {
  ip?: string
  body?: unknown
}): string {
  const body = req.body
  const email =
    typeof body === 'object' && body !== null && 'email' in body
      ? String((body as { email?: unknown }).email ?? '').trim().toLowerCase()
      : ''

  return `${req.ip ?? 'unknown'}|${email}`
}

function getClientIp(req: { ip?: string }): string | undefined {
  return req.ip
}

export function createAuthRouter(
  repository: AuthRepository,
  options: AuthRouterOptions,
): Router {
  const router = Router()
  const authenticate = createAuthenticate(repository)
  const authenticateSubject = createAuthenticateSubjectTeacher(repository)
  const authenticateEither = createAuthenticateEither(repository, authenticate)
  const notifier = options.notifier ?? silentNotifier
  const sessionTtlMinutes = options.sessionTtlMinutes ?? env.AUTH_SESSION_TTL_MINUTES
  const email = options.email ?? new NoopEmailService()
  const verificationExpiryHours =
    options.emailVerificationExpiryHours ?? env.EMAIL_VERIFICATION_EXPIRY_HOURS

  const loginLimiter = createRateLimiter({
    windowMs: options.loginRateLimit?.windowMs ?? 15 * 60 * 1000,
    max: options.loginRateLimit?.max ?? 10,
    scope: 'login',
    keyGenerator: loginRateLimitKey,
  })

  const resetLimiter = createRateLimiter({
    windowMs: options.passwordResetRateLimit?.windowMs ?? 60 * 60 * 1000,
    max: options.passwordResetRateLimit?.max ?? 5,
    scope: 'password reset',
    keyGenerator: (req) => getClientIp(req) ?? 'unknown',
  })

  // Public school registration creates a tenant, a user, and a membership in
  // one transaction, so it is a meaningful abuse target. The default is
  // deliberately more permissive than login to accommodate shared school
  // networks, while still capping automated mass sign-ups per process.
  const registrationLimiter = createRateLimiter({
    windowMs: options.registrationRateLimit?.windowMs ?? 60 * 60 * 1000,
    max: options.registrationRateLimit?.max ?? 20,
    scope: 'registration',
    keyGenerator: (req) => getClientIp(req) ?? 'unknown',
  })

  const verificationLimiter = createRateLimiter({
    windowMs: options.emailVerificationRateLimit?.windowMs ?? 15 * 60 * 1000,
    max: options.emailVerificationRateLimit?.max ?? 5,
    scope: 'email verification',
    keyGenerator: (req) => req.auth?.user.id ?? getClientIp(req) ?? 'unknown',
  })

  const changePasswordLimiter = createRateLimiter({
    windowMs: options.passwordChangeRateLimit?.windowMs ?? 15 * 60 * 1000,
    max: options.passwordChangeRateLimit?.max ?? 10,
    scope: 'password change',
    keyGenerator: (req) => req.auth?.user.id ?? getClientIp(req) ?? 'unknown',
  })

  const trustedOrigin = requireTrustedOrigin(options.trustedOrigins)

  // Every auth response carries a session, a session hint or account identity.
  // None of it may be stored by a browser or intermediary cache.
  router.use(noStore)

  async function issueSession(
    userId: string,
    req: Request,
    res: Response,
  ): Promise<void> {
    const token = generateOpaqueToken()
    const expiresAt = new Date(Date.now() + sessionTtlMinutes * 60 * 1000)

    await repository.createSession({
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ipAddress: getClientIp(req),
      userAgent: req.get('user-agent'),
    })

    res.cookie(SESSION_COOKIE_NAME, token, sessionCookieOptions(expiresAt))
    // An account session is the authoritative identity. Drop any stale
    // restricted subject cookie so it cannot be chosen by mistake on routes
    // that accept either identity.
    res.clearCookie(
      SUBJECT_SESSION_COOKIE_NAME,
      clearSessionCookieOptions(),
    )
  }

  async function recordAuditSafely(
    entry: Parameters<AuthRepository['recordAudit']>[0],
  ): Promise<void> {
    try {
      await repository.recordAudit(entry)
    } catch (error) {
      // Auditing must never turn a successful authentication into a failure.
      console.error('[gradely-api] failed to record audit event:', error)
    }
  }

  /**
   * Records a failed credential attempt and, when it locks a platform
   * administrator account, raises a platform notification. School-account
   * failures are audited but do not flood the platform inbox.
   */
  /**
   * Issues a fresh single-use verification token and emails the link. The
   * repository revokes every outstanding token first, so an older link stops
   * working the moment a resend succeeds. Email and token failures never fail
   * school registration: the administrator can request another email.
   */
  async function issueVerificationEmail(input: {
    user: { id: string; email: string; firstName: string }
    schoolName: string
    ipAddress?: string
    userAgent?: string
    resend: boolean
  }): Promise<void> {
    try {
      const token = generateOpaqueToken()
      const expiresAt = new Date(
        Date.now() + verificationExpiryHours * 60 * 60 * 1000,
      )
      const record = await repository.createEmailVerificationToken({
        userId: input.user.id,
        tokenHash: hashToken(token),
        expiresAt,
        ipAddress: input.ipAddress,
      })

      await recordAuditSafely({
        actorUserId: input.user.id,
        action: input.resend
          ? 'EMAIL_VERIFICATION_RESENT'
          : 'EMAIL_VERIFICATION_SENT',
        entityType: 'User',
        entityId: input.user.id,
        metadata: { expiresAt: expiresAt.toISOString() },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      })

      await email.send({
        template: input.resend
          ? 'admin-verification-resend'
          : 'admin-welcome',
        to: input.user.email,
        dedupeKey: `verify-email:${record.id}`,
        data: {
          firstName: input.user.firstName,
          schoolName: input.schoolName,
          verificationUrl: verificationUrl(token),
          expiresAt: formatEmailDateTime(expiresAt),
          expiryHours: verificationExpiryHours,
        },
      })
    } catch {
      // Never surface a token, SMTP error or provider detail to the caller.
      console.error(
        '[gradely-api] could not issue an email verification message',
      )
    }
  }

  async function registerFailure(
    user: { id: string; email: string; isPlatformAdmin: boolean },
    now: Date,
  ): Promise<void> {
    try {
      const result = await repository.registerFailedLogin(user.id, {
        now,
        lockAfter: LOGIN_LOCK_THRESHOLD,
        lockDurationMs: LOGIN_LOCK_DURATION_MS,
      })

      if (result.lockedUntil && user.isPlatformAdmin) {
        await notifier.notify({
          type: 'PLATFORM_ACCOUNT_LOCKED',
          severity: 'CRITICAL',
          title: `Platform account locked: ${user.email}`,
          body: `The account was locked until ${result.lockedUntil.toISOString()} after ${result.failedLoginCount} failed sign-in attempts.`,
          entityType: 'User',
          entityId: user.id,
          link: '/platform/security',
          dedupeKey: `platform-account-locked:${user.id}:${result.lockedUntil.toISOString()}`,
        })
      }
    } catch (error) {
      console.error('[gradely-api] failed to record login failure:', error)
    }
  }

  function requireAuth(req: { auth?: AuthContext }): AuthContext {
    if (!req.auth) {
      throw new HttpError(401, 'Authentication required')
    }

    return req.auth
  }

  router.post(
    '/register-school',
    registrationLimiter.middleware,
    trustedOrigin,
    async (req, res, next) => {
    try {
      if (options.registrationGuard && !(await options.registrationGuard())) {
        throw new HttpError(
          403,
          'School registration is currently closed by the platform administrator',
        )
      }

      const input = parseBody(registerSchoolSchema, req.body)
      const passwordHash = await hashPassword(input.password)
      const logo = decodeSchoolLogo(input.logo)
      const schoolId = randomUUID()
      const logoObjectKey = schoolLogoStorageKey(schoolId, logo.extension)

      // Platform-wide account uniqueness. The database unique indexes remain
      // the final guard for concurrent requests; this pre-check returns a clear
      // field-level message for the ordinary case.
      if (await repository.findUserByEmail(input.email)) {
        throw new HttpError(
          409,
          'An account with this email address already exists',
          [{ field: 'email', message: 'This email address is already registered' }],
        )
      }

      if (await repository.findUserByPhone(input.phone)) {
        throw new HttpError(
          409,
          'An account with this phone number already exists',
          [{ field: 'phone', message: 'This phone number is already registered' }],
        )
      }

      // Upload the logo before creating the tenant. If the transaction fails
      // the object is removed so an orphaned upload cannot accumulate.
      await options.storage.putObject(
        logoObjectKey,
        logo.data,
        logo.mimeType,
      )

      let result

      try {
        result = await repository.createSchoolWithAdmin({
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
            phone: input.phone,
          },
        })
      } catch (error) {
        await options.storage.deleteObject(logoObjectKey).catch(() => undefined)

        if (isUniqueConstraintError(error)) {
          throw new HttpError(
            409,
            'An account with this email already exists',
          )
        }

        throw error
      }

      await issueSession(result.user.id, req, res)

      // New administrators receive a verification link. The account exists and
      // is signed in, but school administration stays locked until verification.
      await issueVerificationEmail({
        user: result.user,
        schoolName: result.school.name,
        ipAddress: getClientIp(req),
        userAgent: req.get('user-agent'),
        resend: false,
      })

      await notifier.notify({
        type: 'SCHOOL_REGISTERED',
        severity: 'INFO',
        title: `School registered: ${result.school.name}`,
        body: `A new tenant was registered with administrator ${result.user.email}.`,
        schoolId: result.school.id,
        entityType: 'School',
        entityId: result.school.id,
        link: `/platform/schools/${result.school.id}`,
        dedupeKey: `school-registered:${result.school.id}`,
      })

      res.status(201).json({
        data: {
          user: toPublicUser(result.user),
          school: toPublicSchool(result.school),
          memberships: [toPublicMembership(result.membership)],
        },
      })
    } catch (error) {
      next(error)
    }
  })

  router.post('/login', loginLimiter.middleware, async (req, res, next) => {
    try {
      const input = parseBody(loginSchema, req.body)
      const user = await repository.findUserByEmail(input.email)
      const storedHash = user?.passwordHash ?? (await getDummyPasswordHash())
      const passwordMatches = await verifyPassword(input.password, storedHash)
      const now = new Date()

      // Persistent lockout survives an API restart and complements the
      // in-process per-IP rate limiter.
      if (user?.lockedUntil && user.lockedUntil > now) {
        await recordAuditSafely({
          actorUserId: user.id,
          action: 'LOGIN_LOCKED',
          entityType: 'User',
          entityId: user.id,
          ipAddress: getClientIp(req),
          userAgent: req.get('user-agent'),
        })

        throw new HttpError(
          423,
          'This account is temporarily locked after repeated failed sign-in attempts. Try again later.',
        )
      }

      if (!user || !passwordMatches || !user.isActive || user.deletedAt) {
        if (user && !user.deletedAt) {
          await registerFailure(user, now)
        }

        await recordAuditSafely({
          actorUserId: user?.id ?? null,
          action: 'LOGIN_FAILED',
          entityType: 'User',
          ipAddress: getClientIp(req),
          userAgent: req.get('user-agent'),
        })

        throw new HttpError(
          401,
          'Invalid email or password',
          undefined,
          'invalid_credentials',
        )
      }

      // Optional MFA. When enabled, a missing or wrong code never issues a
      // session, and a recovery code is consumed only on success.
      if (user.mfaEnabled) {
        const challenge = await repository.findMfaChallenge(user.id)
        let secondFactorValid = false

        if (challenge && input.mfaCode) {
          const decrypted = challenge.encryptedSecret
            ? decryptMfaSecret(challenge.encryptedSecret)
            : null

          if (decrypted && verifyTotp(decrypted, input.mfaCode)) {
            secondFactorValid = true
          } else {
            const recoveryHash = verifyRecoveryCodeHash(
              input.mfaCode,
              challenge.recoveryCodeHashes,
            )

            if (recoveryHash) {
              secondFactorValid = await repository.consumeMfaRecoveryCode(
                user.id,
                recoveryHash,
              )
            }
          }
        }

        if (!secondFactorValid) {
          await registerFailure(user, now)

          await recordAuditSafely({
            actorUserId: user.id,
            action: 'LOGIN_MFA_FAILED',
            entityType: 'User',
            entityId: user.id,
            ipAddress: getClientIp(req),
            userAgent: req.get('user-agent'),
          })

          throw new HttpError(
            401,
            input.mfaCode
              ? 'That authentication code is not valid'
              : 'Authentication code required',
            [
              {
                field: 'mfaCode',
                message: 'Enter the 6-digit authenticator or a recovery code',
              },
            ],
          )
        }
      }

      const context = await repository.findUserWithMemberships(user.id)
      const memberships = context
        ? usableMemberships(context.memberships)
        : []

      // A school account whose every membership belongs to a suspended school
      // cannot start a new session. Credentials were valid, so this is not
      // counted as a failed sign-in (it must never lock the account), and the
      // response is generic so suspension state is not disclosed. Accounts with
      // no memberships and platform administrators keep their existing
      // behaviour; a user with at least one usable school can still sign in.
      const onlySuspendedSchools =
        context !== null &&
        context.memberships.length > 0 &&
        memberships.length === 0 &&
        context.memberships.every((membership) => !membership.schoolIsActive)

      if (!user.isPlatformAdmin && onlySuspendedSchools) {
        await recordAuditSafely({
          actorUserId: user.id,
          action: 'LOGIN_DENIED',
          entityType: 'User',
          entityId: user.id,
          metadata: { reason: 'SCHOOL_SUSPENDED' },
          ipAddress: getClientIp(req),
          userAgent: req.get('user-agent'),
        })

        throw new HttpError(403, 'Access denied')
      }

      await repository.recordSuccessfulLogin(user.id, now)
      await issueSession(user.id, req, res)

      // A teacher who has not replaced their temporary password receives one
      // reminder per account. The forced-change middleware still enforces the
      // restriction even if this message never arrives.
      if (user.mustChangePassword === true) {
        await email.send({
          template: 'teacher-first-login',
          to: user.email,
          dedupeKey: `teacher-first-login:${user.id}`,
          data: {
            firstName: user.firstName,
            schoolName: context?.memberships[0]?.schoolName ?? 'your school',
            loginEmail: user.email,
            changePasswordUrl: changePasswordUrl(),
          },
        })
      }

      loginLimiter.reset(loginRateLimitKey(req))

      await recordAuditSafely({
        actorUserId: user.id,
        action: 'LOGIN_SUCCEEDED',
        entityType: 'User',
        entityId: user.id,
        ipAddress: getClientIp(req),
        userAgent: req.get('user-agent'),
      })

      res.status(200).json({
        data: {
          user: toPublicUser(user),
          memberships: memberships.map(toPublicMembership),
        },
      })
    } catch (error) {
      next(error)
    }
  })

  router.post('/logout', trustedOrigin, authenticate, async (req, res, next) => {
    try {
      const auth = requireAuth(req)

      await repository.revokeSession(auth.sessionId)
      res.clearCookie(SESSION_COOKIE_NAME, clearSessionCookieOptions())
      // A sign-out clears both identities so a later page load cannot fall back
      // to an older restricted subject session.
      res.clearCookie(
        SUBJECT_SESSION_COOKIE_NAME,
        clearSessionCookieOptions(),
      )

      res.status(200).json({ data: { message: 'Signed out' } })
    } catch (error) {
      next(error)
    }
  })

  router.get('/me', authenticate, (req, res, next) => {
    try {
      const auth = requireAuth(req)

      res.status(200).json({
        data: {
          user: toPublicUser(auth.user),
          memberships: auth.memberships.map(toPublicMembership),
        },
      })
    } catch (error) {
      next(error)
    }
  })

  /**
   * Lightweight activity ping. The session middleware already records activity
   * on every authenticated request; this endpoint lets an open tab that is
   * genuinely active (mouse/keyboard/scroll) keep the server-side idle window
   * current without fetching a full resource. It never extends the absolute
   * session expiry (`expiresAt`).
   */
  router.post(
    '/heartbeat',
    trustedOrigin,
    authenticateEither,
    (_req, res) => {
      res.status(200).json({ data: { ok: true } })
    },
  )

  router.post(
    '/email-verification/confirm',
    trustedOrigin,
    verificationLimiter.middleware,
    async (req, res, next) => {
      try {
        const input = parseBody(emailVerificationConfirmSchema, req.body)
        const consumed = await repository.consumeEmailVerificationToken({
          tokenHash: hashToken(input.token),
          now: new Date(),
        })

        if (!consumed) {
          throw new HttpError(
            400,
            'This verification link is invalid, has expired, or has already been used',
          )
        }

        const context = await repository.findUserWithMemberships(consumed.userId)
        const schoolName =
          context?.memberships[0]?.schoolName ?? 'your school'

        if (context) {
          await email.send({
            template: 'admin-verified',
            to: context.user.email,
            dedupeKey: `admin-verified:${context.user.id}`,
            data: {
              firstName: context.user.firstName,
              schoolName,
              dashboardUrl: dashboardUrl(),
            },
          })
        }

        res.status(200).json({
          data: {
            message: 'Your email address is verified.',
            user: context ? toPublicUser(context.user) : null,
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/email-verification/resend',
    trustedOrigin,
    authenticate,
    verificationLimiter.middleware,
    async (req, res, next) => {
      try {
        const auth = requireAuth(req)

        if (
          auth.user.emailVerificationRequired !== true ||
          auth.user.emailVerifiedAt != null
        ) {
          res.status(200).json({
            data: { message: 'This email address is already verified.' },
          })
          return
        }

        await issueVerificationEmail({
          user: auth.user,
          schoolName: auth.memberships[0]?.schoolName ?? 'your school',
          ipAddress: getClientIp(req),
          userAgent: req.get('user-agent'),
          resend: true,
        })

        res.status(202).json({
          data: {
            message:
              'A new verification email has been sent. The previous link is no longer valid.',
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/change-password',
    trustedOrigin,
    authenticate,
    changePasswordLimiter.middleware,
    async (req, res, next) => {
      try {
        const auth = requireAuth(req)
        const input = parseBody(changePasswordSchema, req.body)
        const matches = await verifyPassword(
          input.currentPassword,
          auth.user.passwordHash,
        )

        if (!matches) {
          throw new HttpError(
            401,
            'Your current password is incorrect',
            [
              {
                field: 'currentPassword',
                message: 'Check your current password',
              },
            ],
            'password_invalid',
          )
        }

        const passwordHash = await hashPassword(input.newPassword)
        const changed = await repository.changePassword({
          userId: auth.user.id,
          passwordHash,
          now: new Date(),
          currentSessionId: auth.sessionId,
          forceChangeCleared: auth.user.mustChangePassword === true,
        })

        if (!changed) {
          throw new HttpError(401, 'Your session is no longer valid')
        }

        const context = await repository.findUserWithMemberships(auth.user.id)

        res.status(200).json({
          data: {
            message: 'Your password has been updated.',
            user: context ? toPublicUser(context.user) : null,
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/password-reset/request',
    trustedOrigin,
    resetLimiter.middleware,
    async (req, res, next) => {
      try {
        const input = parseBody(passwordResetRequestSchema, req.body)
        const user = await repository.findUserByEmail(input.email)

        if (user && user.isActive) {
          const token = generateOpaqueToken()

          await repository.createPasswordResetToken({
            userId: user.id,
            tokenHash: hashToken(token),
            expiresAt: new Date(
              Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000,
            ),
            ipAddress: getClientIp(req),
          })

          // Email delivery is a future integration. Outside production the
          // link is logged so the flow can be exercised locally.
          if (env.NODE_ENV !== 'production') {
            console.info(
              `[gradely-api] password reset link for ${input.email}: ${env.FRONTEND_URL}/reset-password?token=${token}`,
            )
          }
        }

        // Always the same response: no account enumeration.
        res.status(202).json({
          data: {
            message:
              'If an account with that email exists, a password reset link has been created.',
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/password-reset/confirm',
    trustedOrigin,
    async (req, res, next) => {
      try {
        const input = parseBody(passwordResetConfirmSchema, req.body)
        const passwordHash = await hashPassword(input.password)

        const consumed = await repository.consumePasswordResetToken({
          tokenHash: hashToken(input.token),
          passwordHash,
          now: new Date(),
        })

        if (!consumed) {
          throw new HttpError(
            400,
            'This password reset link is invalid or has expired',
          )
        }

        res.status(200).json({
          data: {
            message: 'Password updated. Sign in with your new password.',
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/subject-teacher/access-code',
    trustedOrigin,
    resetLimiter.middleware,
    async (req, res, next) => {
      try {
        const input = parseBody(subjectTeacherAccessCodeSchema, req.body)
        const token = generateOpaqueToken()
        const expiresAt = new Date(
          Date.now() + sessionTtlMinutes * 60 * 1000,
        )

        const session = await repository.enterSubjectTeacherAccessCode({
          codeHash: hashToken(input.code),
          tokenHash: hashToken(token),
          expiresAt,
          now: new Date(),
          ipAddress: getClientIp(req),
          userAgent: req.get('user-agent'),
        })

        if (!session) {
          throw new HttpError(
            401,
            'This access code is invalid, has expired, or has been revoked',
          )
        }

        res.cookie(
          SUBJECT_SESSION_COOKIE_NAME,
          token,
          subjectSessionCookieOptions(expiresAt),
        )

        res.status(200).json({
          data: {
            subjectSession: {
              sessionId: session.id,
              schoolId: session.schoolId,
              schoolName: session.schoolName,
              schoolSlug: session.schoolSlug,
              classId: session.classId,
              className: session.className,
              subjectId: session.subjectId,
              subjectName: session.subjectName,
              teacher: session.teacher,
              expiresAt: session.expiresAt,
            },
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/subject-teacher/me',
    authenticateSubject,
    (req, res, next) => {
      try {
        if (!req.subjectAuth) {
          throw new HttpError(401, 'Authentication required')
        }

        res.status(200).json({
          data: {
            subjectSession: {
              sessionId: req.subjectAuth.sessionId,
              schoolId: req.subjectAuth.schoolId,
              schoolName: req.subjectAuth.schoolName,
              schoolSlug: req.subjectAuth.schoolSlug,
              classId: req.subjectAuth.classId,
              className: req.subjectAuth.className,
              subjectId: req.subjectAuth.subjectId,
              subjectName: req.subjectAuth.subjectName,
              teacher: req.subjectAuth.teacher,
              expiresAt: req.subjectAuth.expiresAt,
            },
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/subject-teacher/logout',
    trustedOrigin,
    authenticateSubject,
    async (req, res, next) => {
      try {
        if (!req.subjectAuth) {
          throw new HttpError(401, 'Authentication required')
        }

        await repository.revokeSubjectSession(req.subjectAuth.sessionId)
        res.clearCookie(
          SUBJECT_SESSION_COOKIE_NAME,
          clearSessionCookieOptions(),
        )

        res.status(200).json({ data: { message: 'Signed out' } })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}
