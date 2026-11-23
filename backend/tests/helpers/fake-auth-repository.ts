import { randomUUID } from 'node:crypto'
import { hashPassword } from '../../src/auth/password.js'
import { hashToken } from '../../src/auth/tokens.js'
import type {
  AuditEntry,
  AuthRepository,
  AuthResult,
  ChangePasswordInput,
  CreateEmailVerificationTokenInput,
  CreatePasswordResetTokenInput,
  CreateSchoolAdminInput,
  CreateSessionInput,
  MemberSummary,
  MembershipRecord,
  MembershipStatus,
  SchoolSummary,
  SessionRecord,
  SubjectSessionRecord,
  UserRecord,
} from '../../src/auth/repository.js'
import type { SchoolRole } from '../../src/auth/roles.js'

type StoredSchool = SchoolSummary

interface StoredMembership {
  id: string
  schoolId: string
  userId: string
  role: SchoolRole
  status: MembershipStatus
  joinedAt: Date
}

interface StoredSession {
  id: string
  userId: string
  tokenHash: string
  expiresAt: Date
  revokedAt: Date | null
  lastUsedAt: Date
}

interface StoredResetToken {
  userId: string
  tokenHash: string
  expiresAt: Date
  usedAt: Date | null
}

interface StoredVerificationToken {
  id: string
  userId: string
  tokenHash: string
  expiresAt: Date
  usedAt: Date | null
  revokedAt: Date | null
}

interface StoredInvitation {
  id: string
  codeHash: string
  schoolId: string
  membershipId: string | null
  assignmentId: string
  classId: string
  subjectId: string
  className: string
  subjectName: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  expiresAt: Date
  usedAt: Date | null
  revokedAt: Date | null
}

interface StoredSubjectSession {
  id: string
  tokenHash: string
  accessCodeId: string | null
  assignmentId: string
  schoolId: string
  classId: string
  subjectId: string
  className: string
  subjectName: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  expiresAt: Date
  revokedAt: Date | null
  lastUsedAt: Date
}

/**
 * In-memory AuthRepository for HTTP/auth tests.
 *
 * This is a mock, not a database. The Prisma repository is the production
 * implementation; transaction guarantees below only simulate all-or-nothing
 * behaviour so route-level tests can assert there are no partial writes.
 */
export class FakeAuthRepository implements AuthRepository {
  readonly users = new Map<string, UserRecord>()
  readonly schools = new Map<string, StoredSchool>()
  readonly memberships = new Map<string, StoredMembership>()
  readonly sessions = new Map<string, StoredSession>()
  readonly resetTokens = new Map<string, StoredResetToken>()
  readonly verificationTokens = new Map<string, StoredVerificationToken>()
  readonly invitations = new Map<string, StoredInvitation>()
  readonly subjectSessions = new Map<string, StoredSubjectSession>()
  readonly mfaSecrets = new Map<
    string,
    {
      enabled: boolean
      encryptedSecret: string | null
      recoveryCodeHashes: string[]
    }
  >()
  readonly audits: AuditEntry[] = []

  failNextSchoolCreation = false

  private emailIndex = new Map<string, string>()
  private phoneIndex = new Map<string, string>()

  /**
   * Existing route suites treat a freshly registered administrator as an
   * already-verified operator so they can exercise their own concern. Tests
   * that specifically cover email verification opt in to the production
   * behaviour with `new FakeAuthRepository({ requireAdminEmailVerification:
   * true })`.
   */
  private readonly requireAdminEmailVerification: boolean

  /**
   * Likewise, most suites register a class teacher and immediately use the
   * workspace. First-login password rotation is covered by its own suite, which
   * opts in with `{ requireTeacherPasswordChange: true }`.
   */
  readonly requireTeacherPasswordChange: boolean

  constructor(
    options: {
      requireAdminEmailVerification?: boolean
      requireTeacherPasswordChange?: boolean
    } = {},
  ) {
    this.requireAdminEmailVerification =
      options.requireAdminEmailVerification ?? false
    this.requireTeacherPasswordChange =
      options.requireTeacherPasswordChange ?? false
  }

  async createSchoolWithAdmin(
    input: CreateSchoolAdminInput,
  ): Promise<AuthResult> {
    if (this.failNextSchoolCreation) {
      this.failNextSchoolCreation = false
      throw new Error('Simulated database failure')
    }

    const email = input.admin.email.toLowerCase()

    if (this.emailIndex.has(email)) {
      throw Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
      })
    }

    if (input.admin.phone && this.phoneIndex.has(input.admin.phone)) {
      throw Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
      })
    }

    const school: StoredSchool = {
      id: input.school.id,
      name: input.school.name,
      slug: input.school.slug,
      email: input.school.email ?? null,
      phone: input.school.phone,
      address: input.school.address,
      landmark: input.school.landmark,
      timezone: 'Africa/Accra',
      isActive: true,
      logoObjectKey: input.school.logoObjectKey,
      logoMimeType: input.school.logoMimeType,
      logoUpdatedAt: input.school.logoUpdatedAt,
      createdAt: new Date(),
    }

    const user: UserRecord = {
      id: randomUUID(),
      email,
      passwordHash: input.admin.passwordHash,
      firstName: input.admin.firstName,
      lastName: input.admin.lastName,
      phone: input.admin.phone,
      isPlatformAdmin: false,
      isActive: true,
      mfaEnabled: false,
      lockedUntil: null,
      failedLoginCount: 0,
      lastFailedLoginAt: null,
      lastLoginAt: null,
      emailVerifiedAt: this.requireAdminEmailVerification ? null : new Date(),
      emailVerificationRequired: this.requireAdminEmailVerification,
      mustChangePassword: false,
      createdAt: new Date(),
    }

    const membership: StoredMembership = {
      id: randomUUID(),
      schoolId: school.id,
      userId: user.id,
      role: 'SCHOOL_ADMIN',
      status: 'ACTIVE',
      joinedAt: new Date(),
    }

    // Commit only after every piece succeeds.
    this.schools.set(school.id, school)
    this.users.set(user.id, user)
    this.emailIndex.set(email, user.id)
    if (user.phone) {
      this.phoneIndex.set(user.phone, user.id)
    }
    this.memberships.set(`${school.id}:${user.id}`, membership)
    this.audits.push({
      schoolId: school.id,
      actorUserId: user.id,
      action: 'SCHOOL_REGISTERED',
      entityType: 'School',
      entityId: school.id,
    })

    return {
      user,
      school,
      membership: this.toMembershipRecord(membership),
    }
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const id = this.emailIndex.get(email.toLowerCase())
    const user = id ? this.users.get(id) : undefined
    return user ? { ...user } : null
  }

  async findUserByPhone(phone: string): Promise<UserRecord | null> {
    const id = this.phoneIndex.get(phone)
    const user = id ? this.users.get(id) : undefined
    return user ? { ...user } : null
  }

  async registerFailedLogin(
    userId: string,
    input: { now: Date; lockAfter: number; lockDurationMs: number },
  ): Promise<{ lockedUntil: Date | null; failedLoginCount: number }> {
    const user = this.users.get(userId)

    if (!user) {
      return { lockedUntil: null, failedLoginCount: 0 }
    }

    user.failedLoginCount += 1
    user.lastFailedLoginAt = input.now

    if (user.failedLoginCount >= input.lockAfter) {
      user.lockedUntil = new Date(input.now.getTime() + input.lockDurationMs)
    }

    return {
      lockedUntil: user.lockedUntil,
      failedLoginCount: user.failedLoginCount,
    }
  }

  async recordSuccessfulLogin(userId: string, now: Date): Promise<void> {
    const user = this.users.get(userId)

    if (!user) {
      return
    }

    user.failedLoginCount = 0
    user.lastFailedLoginAt = null
    user.lockedUntil = null
    user.lastLoginAt = now
  }

  async findMfaChallenge(userId: string) {
    const stored = this.mfaSecrets.get(userId)
    const user = this.users.get(userId)

    if (!user) {
      return null
    }

    return {
      enabled: stored?.enabled ?? user.mfaEnabled,
      encryptedSecret: stored?.encryptedSecret ?? null,
      recoveryCodeHashes: stored?.recoveryCodeHashes ?? [],
    }
  }

  async consumeMfaRecoveryCode(
    userId: string,
    codeHash: string,
  ): Promise<boolean> {
    const stored = this.mfaSecrets.get(userId)

    if (!stored) {
      return false
    }

    const index = stored.recoveryCodeHashes.indexOf(codeHash)

    if (index === -1) {
      return false
    }

    stored.recoveryCodeHashes.splice(index, 1)
    return true
  }

  async findUserWithMemberships(
    userId: string,
  ): Promise<{ user: UserRecord; memberships: MembershipRecord[] } | null> {
    const user = this.users.get(userId)

    if (!user) {
      return null
    }

    const memberships = [...this.memberships.values()]
      .filter((membership) => membership.userId === userId)
      .map((membership) => this.toMembershipRecord(membership))

    return { user: { ...user }, memberships }
  }

  async createSession(input: CreateSessionInput): Promise<void> {
    this.sessions.set(input.tokenHash, {
      id: randomUUID(),
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      revokedAt: null,
      lastUsedAt: new Date(),
    })
  }

  async findSessionByTokenHash(
    tokenHash: string,
  ): Promise<SessionRecord | null> {
    const session = this.sessions.get(tokenHash)

    if (!session) {
      return null
    }

    const user = this.users.get(session.userId)

    if (!user) {
      return null
    }

    return {
      id: session.id,
      userId: session.userId,
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
      lastUsedAt: session.lastUsedAt,
      user: { ...user },
    }
  }

  async touchSession(sessionId: string): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.id === sessionId) {
        session.lastUsedAt = new Date()
      }
    }
  }

  async revokeSession(sessionId: string): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.id === sessionId && session.revokedAt === null) {
        session.revokedAt = new Date()
      }
    }
  }

  async revokeAllSessionsForUser(userId: string): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.revokedAt === null) {
        session.revokedAt = new Date()
      }
    }
  }

  async findMembership(
    userId: string,
    schoolId: string,
  ): Promise<MembershipRecord | null> {
    const membership = this.memberships.get(`${schoolId}:${userId}`)
    const school = this.schools.get(schoolId)

    // Mirror the production repository: a suspended school is treated exactly
    // like no membership at all.
    if (!membership || membership.status !== 'ACTIVE' || !school?.isActive) {
      return null
    }

    return this.toMembershipRecord(membership)
  }

  async findSchoolById(schoolId: string): Promise<SchoolSummary | null> {
    const school = this.schools.get(schoolId)
    return school ? { ...school } : null
  }

  async listSchoolMembers(schoolId: string): Promise<MemberSummary[]> {
    return [...this.memberships.values()]
      .filter((membership) => membership.schoolId === schoolId)
      .flatMap((membership) => {
        const user = this.users.get(membership.userId)

        if (!user) {
          return []
        }

        return [
          {
            userId: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            role: membership.role,
            status: membership.status,
            joinedAt: membership.joinedAt,
          },
        ]
      })
  }

  async createPasswordResetToken(
    input: CreatePasswordResetTokenInput,
  ): Promise<void> {
    this.resetTokens.set(input.tokenHash, {
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      usedAt: null,
    })
  }

  async consumePasswordResetToken(input: {
    tokenHash: string
    passwordHash: string
    now: Date
  }): Promise<boolean> {
    const token = this.resetTokens.get(input.tokenHash)

    if (
      !token ||
      token.usedAt !== null ||
      token.expiresAt <= input.now
    ) {
      return false
    }

    const user = this.users.get(token.userId)

    if (!user) {
      return false
    }

    token.usedAt = input.now
    user.passwordHash = input.passwordHash

    await this.revokeAllSessionsForUser(user.id)
    this.audits.push({
      actorUserId: user.id,
      action: 'PASSWORD_RESET_COMPLETED',
      entityType: 'User',
      entityId: user.id,
    })

    return true
  }

  async createEmailVerificationToken(
    input: CreateEmailVerificationTokenInput,
  ): Promise<{ id: string }> {
    const now = new Date()

    for (const token of this.verificationTokens.values()) {
      if (
        token.userId === input.userId &&
        token.usedAt === null &&
        token.revokedAt === null
      ) {
        token.revokedAt = now
      }
    }

    const id = randomUUID()
    this.verificationTokens.set(input.tokenHash, {
      id,
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      usedAt: null,
      revokedAt: null,
    })

    return { id }
  }

  async consumeEmailVerificationToken(input: {
    tokenHash: string
    now: Date
  }): Promise<{ userId: string } | null> {
    const token = this.verificationTokens.get(input.tokenHash)

    if (
      !token ||
      token.usedAt !== null ||
      token.revokedAt !== null ||
      token.expiresAt <= input.now
    ) {
      return null
    }

    const user = this.users.get(token.userId)

    if (!user) {
      return null
    }

    token.usedAt = input.now
    user.emailVerifiedAt = input.now
    user.emailVerificationRequired = false

    this.audits.push({
      actorUserId: user.id,
      action: 'EMAIL_VERIFIED',
      entityType: 'User',
      entityId: user.id,
    })

    return { userId: user.id }
  }

  async changePassword(input: ChangePasswordInput): Promise<boolean> {
    const user = this.users.get(input.userId)

    if (!user || !user.isActive) {
      return false
    }

    user.passwordHash = input.passwordHash
    user.mustChangePassword = false

    for (const session of this.sessions.values()) {
      if (
        session.userId === input.userId &&
        session.revokedAt === null &&
        session.id !== input.currentSessionId
      ) {
        session.revokedAt = input.now
      }
    }

    this.audits.push({
      actorUserId: user.id,
      action: 'PASSWORD_CHANGED',
      entityType: 'User',
      entityId: user.id,
    })

    return true
  }

  async enterSubjectTeacherAccessCode(input: {
    codeHash: string
    tokenHash: string
    expiresAt: Date
    now: Date
    ipAddress?: string
    userAgent?: string
  }): Promise<SubjectSessionRecord | null> {
    const invitation = this.invitations.get(input.codeHash)

    if (
      !invitation ||
      invitation.revokedAt !== null ||
      invitation.usedAt !== null ||
      invitation.expiresAt <= input.now
    ) {
      return null
    }

    const school = this.schools.get(invitation.schoolId)

    // Access-code entry is refused while the school is suspended.
    if (!school?.isActive) {
      return null
    }

    const session: StoredSubjectSession = {
      id: randomUUID(),
      tokenHash: input.tokenHash,
      accessCodeId: invitation.id,
      assignmentId: invitation.assignmentId,
      schoolId: invitation.schoolId,
      classId: invitation.classId,
      subjectId: invitation.subjectId,
      className: invitation.className,
      subjectName: invitation.subjectName,
      firstName: invitation.firstName,
      lastName: invitation.lastName,
      email: invitation.email,
      phone: invitation.phone,
      expiresAt: input.expiresAt,
      revokedAt: null,
      lastUsedAt: input.now,
    }

    this.subjectSessions.set(session.tokenHash, session)

    this.audits.push({
      schoolId: invitation.schoolId,
      actorUserId: null,
      action: 'SUBJECT_TEACHER_ACCESS_CODE_USED',
      entityType: 'SubjectTeacherInvitation',
      entityId: invitation.id,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    })

    return this.toSubjectSessionRecord(session)
  }

  async findSubjectSessionByTokenHash(
    tokenHash: string,
  ): Promise<SubjectSessionRecord | null> {
    const session = this.subjectSessions.get(tokenHash)

    if (!session) {
      return null
    }

    const school = this.schools.get(session.schoolId)

    // Existing subject sessions lose access immediately when their school is
    // suspended, exactly like a revoked or expired session.
    if (!school?.isActive) {
      return null
    }

    return this.toSubjectSessionRecord(session)
  }

  async touchSubjectSession(sessionId: string): Promise<void> {
    for (const session of this.subjectSessions.values()) {
      if (session.id === sessionId) {
        session.lastUsedAt = new Date()
      }
    }
  }

  async revokeSubjectSession(sessionId: string): Promise<void> {
    for (const session of this.subjectSessions.values()) {
      if (session.id === sessionId && session.revokedAt === null) {
        session.revokedAt = new Date()
      }
    }
  }

  /** Test helper: revoke every restricted session bound to an assignment. */
  revokeSubjectSessionsForAssignment(assignmentId: string): void {
    for (const session of this.subjectSessions.values()) {
      if (session.assignmentId === assignmentId && session.revokedAt === null) {
        session.revokedAt = new Date()
      }
    }
  }

  async recordAudit(entry: AuditEntry): Promise<void> {
    this.audits.push(entry)
  }

  // -----------------------------------------------------------------------
  // Test helpers (not part of AuthRepository)
  // -----------------------------------------------------------------------

  private toMembershipRecord(membership: StoredMembership): MembershipRecord {
    const school = this.schools.get(membership.schoolId)

    return {
      id: membership.id,
      schoolId: membership.schoolId,
      schoolName: school?.name ?? 'Unknown school',
      schoolSlug: school?.slug ?? 'unknown',
      role: membership.role,
      status: membership.status,
      schoolIsActive: school?.isActive ?? false,
      joinedAt: membership.joinedAt,
    }
  }

  private toSubjectSessionRecord(
    session: StoredSubjectSession,
  ): SubjectSessionRecord {
    const school = this.schools.get(session.schoolId)

    return {
      id: session.id,
      accessCodeId: session.accessCodeId,
      assignmentId: session.assignmentId,
      schoolId: session.schoolId,
      schoolName: school?.name ?? 'Unknown school',
      schoolSlug: school?.slug ?? 'unknown',
      classId: session.classId,
      className: session.className,
      subjectId: session.subjectId,
      subjectName: session.subjectName,
      teacher: {
        firstName: session.firstName,
        lastName: session.lastName,
        email: session.email,
        phone: session.phone,
      },
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
      lastUsedAt: session.lastUsedAt,
    }
  }

  /** Registers a reusable access code for subject-session tests. */
  addSubjectTeacherInvitation(input: {
    codeHash: string
    schoolId: string
    membershipId?: string | null
    assignmentId?: string
    classId?: string
    subjectId?: string
    className?: string
    subjectName?: string
    firstName?: string
    lastName?: string
    email?: string | null
    phone?: string | null
    expiresAt?: Date
  }): string {
    const id = randomUUID()

    this.invitations.set(input.codeHash, {
      id,
      codeHash: input.codeHash,
      schoolId: input.schoolId,
      membershipId: input.membershipId ?? null,
      assignmentId: input.assignmentId ?? randomUUID(),
      classId: input.classId ?? randomUUID(),
      subjectId: input.subjectId ?? randomUUID(),
      className: input.className ?? 'Test Class',
      subjectName: input.subjectName ?? 'Test Subject',
      firstName: input.firstName ?? 'Subject',
      lastName: input.lastName ?? 'Teacher',
      email: input.email ?? 'subject.teacher@example.com',
      phone: input.phone ?? null,
      expiresAt:
        input.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      usedAt: null,
      revokedAt: null,
    })

    return id
  }

  /**
   * Test helper: mirror the production account-archive write. The user row is
   * kept, memberships are suspended (never removed) and every session is
   * revoked. Academic/report/audit data lives outside this fake.
   */
  markUserDeleted(userId: string, deletedAt: Date = new Date()): void {
    const user = this.users.get(userId)

    if (!user) {
      return
    }

    user.deletedAt = deletedAt
    user.isActive = false

    for (const membership of this.memberships.values()) {
      if (membership.userId === userId) {
        membership.status = 'SUSPENDED'
      }
    }

    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.revokedAt === null) {
        session.revokedAt = deletedAt
      }
    }
  }

  /**
   * Test helper: mirror restoration. The account becomes active again, but no
   * session is recreated, memberships stay suspended and email verification is
   * not granted.
   */
  markUserRestored(userId: string): void {
    const user = this.users.get(userId)

    if (!user) {
      return
    }

    user.deletedAt = null
    user.isActive = true
    user.lockedUntil = null
    user.failedLoginCount = 0
  }

  /**
   * Test helper: mirror a revocation or expiry write into the access-code
   * lookup table used by `enterSubjectTeacherAccessCode`.
   */
  updateSubjectTeacherInvitation(
    codeHash: string,
    updates: { expiresAt?: Date; revokedAt?: Date | null },
  ): void {
    const invitation = this.invitations.get(codeHash)

    if (invitation) {
      Object.assign(invitation, updates)
    }
  }

  async addMembership(
    userId: string,
    schoolId: string,
    role: SchoolRole,
    status: MembershipStatus = 'ACTIVE',
  ): Promise<string> {
    const key = `${schoolId}:${userId}`
    const existing = this.memberships.get(key)

    if (existing) {
      existing.role = role
      existing.status = status
      return existing.id
    }

    const membership: StoredMembership = {
      id: randomUUID(),
      schoolId,
      userId,
      role,
      status,
      joinedAt: new Date(),
    }

    this.memberships.set(key, membership)

    return membership.id
  }

  getMembershipById(membershipId: string) {
    const membership = [...this.memberships.values()].find(
      (item) => item.id === membershipId,
    )

    if (!membership) {
      return null
    }

    const user = this.users.get(membership.userId)

    if (!user) {
      return null
    }

    return { ...membership, user: { ...user } }
  }

  listMembershipsForSchool(schoolId: string) {
    return [...this.memberships.values()]
      .filter((membership) => membership.schoolId === schoolId)
      .flatMap((membership) => {
        const user = this.users.get(membership.userId)

        return user ? [{ ...membership, user: { ...user } }] : []
      })
  }

  /**
   * Test helper: applies the same normalized-email and unique-phone rules as
   * the Prisma repository. A changed email also clears verification.
   */
  updateTeacherProfile(input: {
    userId: string
    firstName?: string
    lastName?: string
    email?: string
    phone?: string | null
  }): UserRecord {
    const user = this.users.get(input.userId)

    if (!user) {
      throw new Error('Unknown user')
    }

    const previousEmail = user.email
    const nextEmail =
      input.email === undefined ? user.email : input.email.trim().toLowerCase()
    const nextPhone =
      input.phone === undefined ? user.phone : input.phone?.trim() || null

    if (nextEmail !== user.email) {
      const owner = this.emailIndex.get(nextEmail)

      if (owner && owner !== user.id) {
        throw Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
        })
      }
    }

    if (nextPhone && nextPhone !== user.phone) {
      const owner = this.phoneIndex.get(nextPhone)

      if (owner && owner !== user.id) {
        throw Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
        })
      }
    }

    if (this.emailIndex.get(user.email) === user.id) {
      this.emailIndex.delete(user.email)
    }

    if (user.phone && this.phoneIndex.get(user.phone) === user.id) {
      this.phoneIndex.delete(user.phone)
    }

    user.firstName = input.firstName ?? user.firstName
    user.lastName = input.lastName ?? user.lastName
    user.email = nextEmail
    user.phone = nextPhone

    if (nextEmail !== previousEmail) {
      user.emailVerifiedAt = null
      user.emailVerificationRequired = true
    }

    this.emailIndex.set(user.email, user.id)

    if (user.phone) {
      this.phoneIndex.set(user.phone, user.id)
    }

    return { ...user }
  }

  /** Test helper: mirrors the soft-removal membership update. */
  setMembershipStatus(
    membershipId: string,
    status: MembershipStatus,
  ): boolean {
    const membership = [...this.memberships.values()].find(
      (item) => item.id === membershipId,
    )

    if (!membership) {
      return false
    }

    membership.status = status
    return true
  }

  /**
   * Test helper: mirrors the platform suspension/reactivation write so tests
   * can exercise enforcement without a live platform repository.
   */
  setSchoolActive(schoolId: string, isActive: boolean): void {
    const school = this.schools.get(schoolId)

    if (school) {
      school.isActive = isActive
    }
  }

  async createUserWithPasswordHash(input: {
    email: string
    passwordHash: string
    firstName: string
    lastName: string
    phone?: string | null
    isActive?: boolean
    isPlatformAdmin?: boolean
  }): Promise<UserRecord> {
    const email = input.email.toLowerCase()

    if (this.emailIndex.has(email)) {
      throw Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
      })
    }

    const user: UserRecord = {
      id: randomUUID(),
      email,
      passwordHash: input.passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone ?? null,
      isPlatformAdmin: input.isPlatformAdmin ?? false,
      isActive: input.isActive ?? true,
      mfaEnabled: false,
      lockedUntil: null,
      failedLoginCount: 0,
      lastFailedLoginAt: null,
      lastLoginAt: null,
      // Mirrors the database defaults: a directly-created account is not
      // required to verify its email and is never forced to rotate a password.
      emailVerifiedAt: null,
      emailVerificationRequired: false,
      mustChangePassword: false,
      passwordChangedAt: null,
      createdAt: new Date(),
    }

    this.users.set(user.id, user)
    this.emailIndex.set(email, user.id)

    return { ...user }
  }

  async createUser(input: {
    email: string
    password: string
    firstName?: string
    lastName?: string
    phone?: string | null
    isActive?: boolean
    isPlatformAdmin?: boolean
  }): Promise<UserRecord> {
    const user: UserRecord = {
      id: randomUUID(),
      email: input.email.toLowerCase(),
      passwordHash: await hashPassword(input.password),
      firstName: input.firstName ?? 'Test',
      lastName: input.lastName ?? 'User',
      phone: input.phone ?? null,
      isPlatformAdmin: input.isPlatformAdmin ?? false,
      isActive: input.isActive ?? true,
      mfaEnabled: false,
      lockedUntil: null,
      failedLoginCount: 0,
      lastFailedLoginAt: null,
      lastLoginAt: null,
      emailVerifiedAt: null,
      emailVerificationRequired: false,
      mustChangePassword: false,
      passwordChangedAt: null,
      createdAt: new Date(),
    }

    this.users.set(user.id, user)
    this.emailIndex.set(user.email, user.id)

    return { ...user }
  }

  /** Creates a valid session and returns the raw token (as a cookie would). */
  async issueSessionFor(
    userId: string,
    options: { expiresAt?: Date } = {},
  ): Promise<string> {
    const token = `test-token-${randomUUID()}`
    const expiresAt =
      options.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000)

    await this.createSession({
      userId,
      tokenHash: hashToken(token),
      expiresAt,
    })

    return token
  }

  getUserSnapshot(email: string): UserRecord | undefined {
    const id = this.emailIndex.get(email.toLowerCase())
    return id ? this.users.get(id) : undefined
  }

  /** Test helper: enable MFA with an already-encrypted secret and code hashes. */
  enableMfaFor(
    userId: string,
    encryptedSecret: string,
    recoveryCodeHashes: string[] = [],
  ): void {
    const user = this.users.get(userId)

    if (user) {
      user.mfaEnabled = true
    }

    this.mfaSecrets.set(userId, {
      enabled: true,
      encryptedSecret,
      recoveryCodeHashes: [...recoveryCodeHashes],
    })
  }

  /** Test helper: force a persistent account lock. */
  lockUserFor(userId: string, lockedUntil: Date): void {
    const user = this.users.get(userId)

    if (user) {
      user.lockedUntil = lockedUntil
    }
  }

  /**
   * Test helper: register an active school without an administrator so tenant
   * isolation tests can attach an existing account to "another school".
   */
  seedSchool(input: {
    id: string
    name: string
    slug: string
    isActive?: boolean
  }): void {
    this.schools.set(input.id, {
      id: input.id,
      name: input.name,
      slug: input.slug,
      email: null,
      phone: null,
      address: null,
      landmark: null,
      timezone: 'UTC',
      isActive: input.isActive ?? true,
      logoObjectKey: null,
      logoMimeType: null,
      logoUpdatedAt: null,
      createdAt: new Date(),
    })
  }

  /** Test helper: mark a registered administrator's email verified. */
  verifyEmailFor(userIdOrEmail: string): void {
    const user =
      this.users.get(userIdOrEmail) ??
      this.users.get(this.emailIndex.get(userIdOrEmail.toLowerCase()) ?? '')

    if (user) {
      user.emailVerifiedAt = new Date()
      user.emailVerificationRequired = false
    }
  }

  /** Test helper: simulate a teacher created with a temporary password. */
  requirePasswordChangeFor(userId: string, required = true): void {
    const user = this.users.get(userId)

    if (user) {
      user.mustChangePassword = required
    }
  }

  /**
   * Test helper: replace an account's password hash as the credential reissue
   * flow does, revoking active sessions and forcing a password change.
   */
  async replacePasswordHashFor(
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    const user = this.users.get(userId)

    if (!user) {
      return
    }

    user.passwordHash = passwordHash
    user.mustChangePassword = true
    user.passwordChangedAt = null
    await this.revokeAllSessionsForUser(userId)
  }

  /**
   * Test helper: give an existing account a known password without forcing a
   * rotation. Used by suites that exercise features after teacher onboarding.
   */
  async setPasswordForTesting(email: string, password: string): Promise<void> {
    const id = this.emailIndex.get(email.trim().toLowerCase())
    const user = id ? this.users.get(id) : undefined

    if (user) {
      user.passwordHash = await hashPassword(password)
      user.mustChangePassword = false
    }
  }

  auditActions(): string[] {
    return this.audits.map((entry) => entry.action)
  }
}
