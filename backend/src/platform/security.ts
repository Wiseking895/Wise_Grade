import { HttpError } from '../errors/http-error.js'
import type { AuthRepository } from '../auth/repository.js'
import {
  buildOtpAuthUri,
  decryptMfaSecret,
  encryptMfaSecret,
  generateMfaSecret,
  generateRecoveryCodes,
  isMfaConfigured,
  mfaConfigurationMessage,
  recoveryCodeHashes,
  verifyRecoveryCodeHash,
  verifyTotp,
} from '../auth/mfa.js'
import { verifyPassword } from '../auth/password.js'
import { generateOpaqueToken, hashToken } from '../auth/tokens.js'
import type { PlatformOperationsRepository } from './operations-repository.js'
import type {
  PlatformReauthGrant,
  PlatformSecurityOverview,
  PlatformSessionRecord,
} from './operations-types.js'

const REAUTH_GRANT_TTL_MS = 5 * 60 * 1000
const MAX_FAILED_ATTEMPTS = 5

export interface PlatformSecurityService {
  overview(userId: string, currentSessionId: string): Promise<PlatformSecurityOverview>
  startMfaEnrollment(
    userId: string,
    email: string,
  ): Promise<{ secret: string; otpauthUri: string; issuer: string }>
  confirmMfaEnrollment(
    userId: string,
    code: string,
    audit: { ipAddress?: string | null; userAgent?: string | null },
  ): Promise<{ recoveryCodes: string[]; enabledAt: string }>
  disableMfa(
    userId: string,
    password: string,
    code: string,
    audit: { ipAddress?: string | null; userAgent?: string | null },
  ): Promise<void>
  regenerateRecoveryCodes(
    userId: string,
    code: string,
    audit: { ipAddress?: string | null; userAgent?: string | null },
  ): Promise<string[]>
  issueReauthGrant(
    userId: string,
    input: { password: string; code?: string; purpose: string },
    audit: { ipAddress?: string | null; userAgent?: string | null },
  ): Promise<PlatformReauthGrant>
  verifySecondFactor(userId: string, code: string | undefined): Promise<boolean>
  listSessions(
    userId: string,
    currentSessionId: string,
  ): Promise<PlatformSessionRecord[]>
  revokeSession(
    userId: string,
    sessionId: string,
    currentSessionId: string,
    audit: { ipAddress?: string | null; userAgent?: string | null },
  ): Promise<boolean>
}

export interface PlatformSecurityOptions {
  authRepository: AuthRepository
  operations: PlatformOperationsRepository
}

export function createPlatformSecurityService(
  options: PlatformSecurityOptions,
): PlatformSecurityService {
  const { authRepository, operations } = options

  async function audit(
    entry: {
      actorUserId: string
      action: string
      entityType?: string
      entityId?: string | null
      metadata?: Record<string, unknown> | null
      ipAddress?: string | null
      userAgent?: string | null
    },
  ): Promise<void> {
    try {
      await operations.recordAudit({
        actorUserId: entry.actorUserId,
        action: entry.action,
        entityType: entry.entityType ?? 'User',
        entityId: entry.entityId ?? entry.actorUserId,
        metadata: entry.metadata ?? null,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
      })
    } catch (error) {
      console.error('[gradely-api] failed to record security audit:', error)
    }
  }

  async function verifySecondFactor(
    userId: string,
    code: string | undefined,
  ): Promise<boolean> {
    if (!code || code.trim() === '') {
      return false
    }

    const secrets = await operations.getMfaSecrets(userId)

    if (!secrets?.enabled || !secrets.secret) {
      return false
    }

    const decrypted = decryptMfaSecret(secrets.secret)

    if (decrypted && verifyTotp(decrypted, code)) {
      return true
    }

    const recoveryHash = verifyRecoveryCodeHash(
      code,
      secrets.recoveryCodeHashes,
    )

    if (recoveryHash) {
      return operations.consumeRecoveryCode(userId, recoveryHash)
    }

    return false
  }

  async function requirePasswordAndSecondFactor(
    userId: string,
    password: string,
    code: string | undefined,
    action: string,
  ): Promise<void> {
    const context = await authRepository.findUserWithMemberships(userId)

    if (!context) {
      throw new HttpError(404, 'Platform account not found')
    }

    if (!(await verifyPassword(password, context.user.passwordHash))) {
      await audit({
        actorUserId: userId,
        action: `${action}_FAILED`,
        metadata: { reason: 'PASSWORD_MISMATCH' },
      })
      throw new HttpError(403, 'Current password is incorrect')
    }

    const security = await operations.findUserSecurity(userId)

    if (security?.mfaEnabled) {
      if (!(await verifySecondFactor(userId, code))) {
        await audit({
          actorUserId: userId,
          action: `${action}_FAILED`,
          metadata: { reason: 'MFA_MISMATCH' },
        })
        throw new HttpError(403, 'A valid authenticator or recovery code is required')
      }
    }
  }

  return {
    async overview(userId, _currentSessionId) {
      const security = await operations.findUserSecurity(userId)

      if (!security) {
        throw new HttpError(404, 'Platform account not found')
      }

      const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const [events, failedLogins24h, lockedAccounts] = await Promise.all([
        operations.listSecurityEvents(userId, 25),
        operations.countFailedLoginsSince(userId, since),
        operations.countLockedAccounts(new Date()),
      ])

      return {
        mfa: {
          enabled: security.mfaEnabled,
          enabledAt: security.mfaEnabledAt,
          recoveryCodesRemaining: security.recoveryCodeCount,
          configured: isMfaConfigured(),
          configurationMessage: mfaConfigurationMessage(),
        },
        lockout: {
          lockedUntil: security.lockedUntil,
          failedLoginCount: security.failedLoginCount,
          lastFailedLoginAt: security.lastFailedLoginAt,
        },
        lastLoginAt: security.lastLoginAt,
        failedLogins24h,
        lockedAccounts,
        events,
      }
    },

    async startMfaEnrollment(userId, email) {
      if (!isMfaConfigured()) {
        throw new HttpError(409, mfaConfigurationMessage() ?? 'MFA is not configured')
      }

      const security = await operations.findUserSecurity(userId)

      if (security?.mfaEnabled) {
        throw new HttpError(409, 'Multi-factor authentication is already enabled')
      }

      const secret = generateMfaSecret()
      await operations.setMfaPendingSecret(userId, encryptMfaSecret(secret))

      return {
        secret,
        issuer: 'Wise Grade',
        otpauthUri: buildOtpAuthUri({
          secret,
          accountName: email,
          issuer: 'Wise Grade',
        }),
      }
    },

    async confirmMfaEnrollment(userId, code, requestAudit) {
      const secrets = await operations.getMfaSecrets(userId)

      if (!secrets?.pendingSecret) {
        throw new HttpError(409, 'Start multi-factor authentication setup first')
      }

      const decrypted = decryptMfaSecret(secrets.pendingSecret)

      if (!decrypted || !verifyTotp(decrypted, code)) {
        throw new HttpError(400, 'That authenticator code is not valid')
      }

      const codes = generateRecoveryCodes()
      const enabledAt = new Date()
      await operations.enableMfa(
        userId,
        secrets.pendingSecret,
        recoveryCodeHashes(codes),
        enabledAt,
      )
      await audit({
        actorUserId: userId,
        action: 'PLATFORM_MFA_ENABLED',
        metadata: { recoveryCodeCount: codes.length },
        ...requestAudit,
      })

      return { recoveryCodes: codes, enabledAt: enabledAt.toISOString() }
    },

    async disableMfa(userId, password, code, requestAudit) {
      const security = await operations.findUserSecurity(userId)

      if (!security?.mfaEnabled) {
        throw new HttpError(409, 'Multi-factor authentication is not enabled')
      }

      await requirePasswordAndSecondFactor(
        userId,
        password,
        code,
        'PLATFORM_MFA_DISABLE',
      )
      await operations.disableMfa(userId)
      await audit({
        actorUserId: userId,
        action: 'PLATFORM_MFA_DISABLED',
        ...requestAudit,
      })
    },

    async regenerateRecoveryCodes(userId, code, requestAudit) {
      const secrets = await operations.getMfaSecrets(userId)

      if (!secrets?.enabled) {
        throw new HttpError(409, 'Multi-factor authentication is not enabled')
      }

      if (!(await verifySecondFactor(userId, code))) {
        throw new HttpError(403, 'A valid authenticator or recovery code is required')
      }

      const codes = generateRecoveryCodes()
      await operations.updateRecoveryCodes(userId, recoveryCodeHashes(codes))
      await audit({
        actorUserId: userId,
        action: 'PLATFORM_MFA_RECOVERY_REGENERATED',
        metadata: { recoveryCodeCount: codes.length },
        ...requestAudit,
      })

      return codes
    },

    async issueReauthGrant(userId, input, requestAudit) {
      const purpose = input.purpose.trim()

      if (!/^[A-Z_]{3,80}$/.test(purpose)) {
        throw new HttpError(400, 'Invalid reauthentication purpose')
      }

      await requirePasswordAndSecondFactor(
        userId,
        input.password,
        input.code,
        'PLATFORM_REAUTH',
      )

      const token = generateOpaqueToken()
      const expiresAt = new Date(Date.now() + REAUTH_GRANT_TTL_MS)
      await operations.createReauthGrant({
        userId,
        tokenHash: hashToken(token),
        purpose,
        expiresAt,
      })
      await audit({
        actorUserId: userId,
        action: 'PLATFORM_REAUTH_GRANTED',
        metadata: { purpose },
        ...requestAudit,
      })

      return { token, purpose, expiresAt: expiresAt.toISOString() }
    },

    verifySecondFactor,

    async listSessions(userId, currentSessionId) {
      const sessions = await operations.listSessions(userId)
      return sessions.map((session) => ({
        ...session,
        current: session.id === currentSessionId,
      }))
    },

    async revokeSession(userId, sessionId, currentSessionId, requestAudit) {
      if (sessionId === currentSessionId) {
        throw new HttpError(
          400,
          'Use sign out to end the session you are currently using',
        )
      }

      const revoked = await operations.revokeSession(userId, sessionId)

      if (revoked) {
        await audit({
          actorUserId: userId,
          action: 'PLATFORM_SESSION_REVOKED',
          entityType: 'Session',
          entityId: sessionId,
          ...requestAudit,
        })
      }

      return revoked
    },
  }
}

export { MAX_FAILED_ATTEMPTS }
