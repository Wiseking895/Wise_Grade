import type { SchoolRole } from './roles.js'

export type MembershipStatus = 'ACTIVE' | 'SUSPENDED'

/**
 * Internal user shape. `passwordHash` must never be serialized to a client;
 * routes map this to a public shape explicitly.
 */
export interface UserRecord {
  id: string
  email: string
  passwordHash: string
  firstName: string
  lastName: string
  phone: string | null
  isPlatformAdmin: boolean
  isActive: boolean
  /** Optional MFA state; secrets are never part of this public record. */
  mfaEnabled: boolean
  lockedUntil: Date | null
  failedLoginCount: number
  lastFailedLoginAt: Date | null
  lastLoginAt: Date | null
  createdAt: Date
}

export interface MfaChallengeRecord {
  enabled: boolean
  encryptedSecret: string | null
  recoveryCodeHashes: string[]
}

export interface RegisterFailedLoginInput {
  now: Date
  /** Consecutive failures before the account is temporarily locked. */
  lockAfter: number
  lockDurationMs: number
}

export interface SchoolSummary {
  id: string
  name: string
  slug: string
  email: string | null
  phone: string | null
  address: string | null
  landmark: string | null
  timezone: string
  isActive: boolean
  logoObjectKey: string | null
  logoMimeType: string | null
  logoUpdatedAt: Date | null
  createdAt: Date
}

export interface MembershipRecord {
  id: string
  schoolId: string
  schoolName: string
  schoolSlug: string
  role: SchoolRole
  status: MembershipStatus
  /**
   * Current status of the membership's school. Read from the database on every
   * request; never cached or supplied by the client, so suspension takes effect
   * immediately for sessions that were already authenticated.
   */
  schoolIsActive: boolean
  joinedAt: Date
}

export interface MemberSummary {
  userId: string
  firstName: string
  lastName: string
  email: string
  role: SchoolRole
  status: MembershipStatus
  joinedAt: Date
}

export interface SessionRecord {
  id: string
  userId: string
  expiresAt: Date
  revokedAt: Date | null
  user: UserRecord
}

export interface CreateSchoolAdminInput {
  school: {
    id: string
    name: string
    slug: string
    email?: string
    landmark: string
    address: string
    phone: string
    logoObjectKey: string
    logoMimeType: string
    logoUpdatedAt: Date
  }
  admin: {
    email: string
    passwordHash: string
    firstName: string
    lastName: string
  }
}

export interface CreateSessionInput {
  userId: string
  tokenHash: string
  expiresAt: Date
  ipAddress?: string
  userAgent?: string
}

export interface CreatePasswordResetTokenInput {
  userId: string
  tokenHash: string
  expiresAt: Date
  ipAddress?: string
}

export interface SubjectTeacherIdentity {
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
}

/**
 * Resolved, restricted subject-teacher identity. It is scoped to exactly one
 * active assignment and deliberately carries no User, Membership or role that
 * could be used elsewhere in the school workspace.
 */
export interface SubjectSessionRecord {
  id: string
  accessCodeId: string | null
  assignmentId: string
  schoolId: string
  schoolName: string
  schoolSlug: string
  classId: string
  className: string
  subjectId: string
  subjectName: string
  teacher: SubjectTeacherIdentity
  expiresAt: Date
  revokedAt: Date | null
}

export interface EnterSubjectAccessCodeInput {
  codeHash: string
  tokenHash: string
  expiresAt: Date
  now: Date
  ipAddress?: string
  userAgent?: string
}

export interface AuditEntry {
  schoolId?: string | null
  actorUserId?: string | null
  action: string
  entityType: string
  entityId?: string | null
  metadata?: Record<string, unknown> | null
  ipAddress?: string | null
  userAgent?: string | null
}

export interface AuthResult {
  user: UserRecord
  school: SchoolSummary
  membership: MembershipRecord
}

/**
 * Persistence boundary for authentication.
 *
 * Routes depend on this interface rather than Prisma directly, which keeps the
 * HTTP/auth logic testable without a live PostgreSQL instance. The production
 * implementation is `createPrismaAuthRepository`.
 */
export interface AuthRepository {
  /** Creates the school, the first administrator, and their membership atomically. */
  createSchoolWithAdmin(input: CreateSchoolAdminInput): Promise<AuthResult>

  findUserByEmail(email: string): Promise<UserRecord | null>

  /** Persistent brute-force state; called after a failed password check. */
  registerFailedLogin(
    userId: string,
    input: RegisterFailedLoginInput,
  ): Promise<{ lockedUntil: Date | null; failedLoginCount: number }>

  /** Clears failures and records the successful sign-in time. */
  recordSuccessfulLogin(userId: string, now: Date): Promise<void>

  /** Internal-only MFA material used by the login route. */
  findMfaChallenge(userId: string): Promise<MfaChallengeRecord | null>

  /** Removes one recovery code hash, returning true when it existed. */
  consumeMfaRecoveryCode(userId: string, codeHash: string): Promise<boolean>

  findUserWithMemberships(
    userId: string,
  ): Promise<{ user: UserRecord; memberships: MembershipRecord[] } | null>

  createSession(input: CreateSessionInput): Promise<void>

  findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null>

  touchSession(sessionId: string): Promise<void>

  revokeSession(sessionId: string): Promise<void>

  revokeAllSessionsForUser(userId: string): Promise<void>

  /** Returns an ACTIVE membership for the user/school pair, or null. */
  findMembership(
    userId: string,
    schoolId: string,
  ): Promise<MembershipRecord | null>

  findSchoolById(schoolId: string): Promise<SchoolSummary | null>

  listSchoolMembers(schoolId: string): Promise<MemberSummary[]>

  createPasswordResetToken(input: CreatePasswordResetTokenInput): Promise<void>

  /** Marks the token used, updates the password, and revokes sessions atomically. */
  consumePasswordResetToken(input: {
    tokenHash: string
    passwordHash: string
    now: Date
  }): Promise<boolean>

  /**
   * Resolves a reusable access code, creates a restricted subject-teacher
   * session bound to the exact assignment, and returns the scoped identity.
   * Returns null for unknown, revoked, expired, replaced or no-longer-active
   * codes. Codes are never consumed by use.
   */
  enterSubjectTeacherAccessCode(
    input: EnterSubjectAccessCodeInput,
  ): Promise<SubjectSessionRecord | null>

  findSubjectSessionByTokenHash(
    tokenHash: string,
  ): Promise<SubjectSessionRecord | null>

  touchSubjectSession(sessionId: string): Promise<void>

  revokeSubjectSession(sessionId: string): Promise<void>

  recordAudit(entry: AuditEntry): Promise<void>
}
