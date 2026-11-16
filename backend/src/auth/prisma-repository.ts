import { getPrismaClient } from '../lib/prisma.js'
import type { Prisma } from '../generated/prisma/client.js'
import {
  academicStartYearFor,
  buildAcademicYearPlan,
  initialTermLifecycles,
  todayInCalendar,
} from '../calendar/logic.js'
import {
  DEFAULT_CLASSES,
  DEFAULT_SCHOOL_TIMEZONE,
} from '../schools/defaults.js'
import type {
  AuditEntry,
  AuthRepository,
  AuthResult,
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
} from './repository.js'
import { isSchoolRole, type SchoolRole } from './roles.js'

interface DbUser {
  id: string
  email: string
  passwordHash: string
  firstName: string
  lastName: string
  phone?: string | null
  isPlatformAdmin: boolean
  isActive: boolean
  mfaEnabled?: boolean
  lockedUntil?: Date | null
  failedLoginCount?: number
  lastFailedLoginAt?: Date | null
  lastLoginAt?: Date | null
  createdAt: Date
}

interface DbSchool {
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

interface DbMembership {
  id: string
  schoolId: string
  role: string
  status: string
  joinedAt: Date
  school: DbSchool
}

function mapUser(user: DbUser): UserRecord {
  return {
    id: user.id,
    email: user.email,
    passwordHash: user.passwordHash,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone ?? null,
    isPlatformAdmin: user.isPlatformAdmin,
    isActive: user.isActive,
    mfaEnabled: user.mfaEnabled ?? false,
    lockedUntil: user.lockedUntil ?? null,
    failedLoginCount: user.failedLoginCount ?? 0,
    lastFailedLoginAt: user.lastFailedLoginAt ?? null,
    lastLoginAt: user.lastLoginAt ?? null,
    createdAt: user.createdAt,
  }
}

function mapSchool(school: DbSchool): SchoolSummary {
  return {
    id: school.id,
    name: school.name,
    slug: school.slug,
    email: school.email,
    phone: school.phone,
    address: school.address,
    landmark: school.landmark,
    timezone: school.timezone,
    isActive: school.isActive,
    logoObjectKey: school.logoObjectKey,
    logoMimeType: school.logoMimeType,
    logoUpdatedAt: school.logoUpdatedAt,
    createdAt: school.createdAt,
  }
}

function mapMembership(membership: DbMembership): MembershipRecord | null {  // Only the three tenant roles may appear on a membership. Anything else is
  // treated as no membership at all rather than being silently upgraded.
  if (!isSchoolRole(membership.role)) {
    return null
  }

  return {
    id: membership.id,
    schoolId: membership.schoolId,
    schoolName: membership.school.name,
    schoolSlug: membership.school.slug,
    role: membership.role,
    status: membership.status as MembershipStatus,
    schoolIsActive: membership.school.isActive,
    joinedAt: membership.joinedAt,
  }
}

/**
 * Maps a restricted subject session. The direct assignment identity is
 * authoritative; the membership/user fallback exists only for assignments
 * created before subject teachers stopped receiving accounts.
 */
function mapSubjectSession(session: {
  id: string
  accessCodeId: string | null
  assignmentId: string
  schoolId: string
  classId: string
  subjectId: string
  expiresAt: Date
  revokedAt: Date | null
  assignment: {
    firstName: string
    lastName: string
    email: string
    phone: string | null
    membership: {
      user: {
        firstName: string
        lastName: string
        email: string
        phone: string | null
      }
    } | null
    school: { name: string; slug: string }
    class: { name: string }
    subject: { name: string }
  }
}): SubjectSessionRecord {
  const teacher = session.assignment.membership
    ? session.assignment.membership.user
    : session.assignment

  return {
    id: session.id,
    accessCodeId: session.accessCodeId,
    assignmentId: session.assignmentId,
    schoolId: session.schoolId,
    schoolName: session.assignment.school.name,
    schoolSlug: session.assignment.school.slug,
    classId: session.classId,
    className: session.assignment.class.name,
    subjectId: session.subjectId,
    subjectName: session.assignment.subject.name,
    teacher: {
      firstName: teacher.firstName,
      lastName: teacher.lastName,
      email: teacher.email || null,
      phone: teacher.phone ?? null,
    },
    expiresAt: session.expiresAt,
    revokedAt: session.revokedAt,
  }
}

const subjectAssignmentInclude = {
  school: { select: { name: true, slug: true, isActive: true } },
  class: { select: { name: true, isArchived: true } },
  subject: { select: { name: true, isArchived: true } },
  membership: {
    include: {
      user: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
    },
  },
} as const

/**
 * True when Prisma reports a unique-constraint violation (P2002). Used to turn
 * duplicate emails into a 409 without leaking database details.
 */
export function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  )
}

export function createPrismaAuthRepository(): AuthRepository {
  return {
    async createSchoolWithAdmin(
      input: CreateSchoolAdminInput,
    ): Promise<AuthResult> {
      const prisma = getPrismaClient()

      // One transaction: a school can never exist without its first
      // administrator, and an administrator can never be orphaned.
      return prisma.$transaction(async (tx) => {
        const school = await tx.school.create({
          data: {
            id: input.school.id,
            name: input.school.name,
            slug: input.school.slug,
            email: input.school.email ?? input.admin.email,
            landmark: input.school.landmark,
            address: input.school.address,
            phone: input.school.phone,
            logoObjectKey: input.school.logoObjectKey,
            logoMimeType: input.school.logoMimeType,
            logoUpdatedAt: input.school.logoUpdatedAt,
            timezone: DEFAULT_SCHOOL_TIMEZONE,
          },
        })

        const user = await tx.user.create({
          data: {
            email: input.admin.email.toLowerCase(),
            passwordHash: input.admin.passwordHash,
            firstName: input.admin.firstName,
            lastName: input.admin.lastName,
            isPlatformAdmin: false,
          },
        })

        const membership = await tx.schoolMembership.create({
          data: {
            schoolId: school.id,
            userId: user.id,
            role: 'SCHOOL_ADMIN',
            status: 'ACTIVE',
          },
          include: { school: true },
        })

        await tx.auditLog.create({
          data: {
            schoolId: school.id,
            actorUserId: user.id,
            action: 'SCHOOL_REGISTERED',
            entityType: 'School',
            entityId: school.id,
            metadata: { schoolName: school.name },
          },
        })

        // New schools start with the standard Ghanaian class structure. Subjects
        // are never created automatically: each class teacher deliberately adds
        // the subjects offered by their own class.
        await tx.schoolClass.createMany({
          data: DEFAULT_CLASSES.map((item) => ({
            schoolId: school.id,
            name: item.name,
            level: item.level,
            sortOrder: item.sortOrder,
          })),
        })

        // The academic calendar is centrally managed. Every school starts with
        // the current academic year and all three terms; the term containing
        // today opens immediately, while future terms remain PLANNED.
        const now = new Date()
        const today = todayInCalendar(now)
        const plan = buildAcademicYearPlan(academicStartYearFor(today))
        const lifecycles = initialTermLifecycles(plan, today)
        const activeTerm = plan.terms.find(
          (term) => term.startsOn <= today && today <= term.endsOn,
        )

        await tx.academicYear.create({
          data: {
            schoolId: school.id,
            name: plan.name,
            startsOn: new Date(`${plan.startsOn}T00:00:00.000Z`),
            endsOn: new Date(`${plan.endsOn}T00:00:00.000Z`),
            isCurrent: true,
            terms: {
              create: plan.terms.map((term, index) => {
                const lifecycle = lifecycles[index]!

                return {
                  schoolId: school.id,
                  name: term.name,
                  sequence: term.sequence,
                  startsOn: new Date(`${term.startsOn}T00:00:00.000Z`),
                  endsOn: new Date(`${term.endsOn}T00:00:00.000Z`),
                  isCurrent: lifecycle.isCurrent,
                  status: lifecycle.status,
                  openedAt: lifecycle.openedAt
                    ? new Date(`${lifecycle.openedAt}T00:00:00.000Z`)
                    : null,
                  closedAt: lifecycle.closedAt
                    ? new Date(`${lifecycle.closedAt}T00:00:00.000Z`)
                    : null,
                  reportsPreparedAt: lifecycle.reportsPreparedAt
                    ? new Date(
                        `${lifecycle.reportsPreparedAt}T00:00:00.000Z`,
                      )
                    : null,
                }
              }),
            },
          },
        })

        await tx.auditLog.create({
          data: {
            schoolId: school.id,
            actorUserId: user.id,
            action: 'ACADEMIC_YEAR_INITIALIZED',
            entityType: 'AcademicYear',
            metadata: {
              name: plan.name,
              currentTerm: activeTerm?.name ?? null,
            },
          },
        })

        const mappedMembership = mapMembership(membership)

        if (!mappedMembership) {
          throw new Error('Created membership has an invalid role')
        }

        return {
          user: mapUser(user),
          school: mapSchool(school),
          membership: mappedMembership,
        }
      })
    },

    async findUserByEmail(email: string): Promise<UserRecord | null> {
      const user = await getPrismaClient().user.findUnique({
        where: { email: email.toLowerCase() },
      })

      return user ? mapUser(user) : null
    },

    async registerFailedLogin(userId: string, input) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        const user = await tx.user.update({
          where: { id: userId },
          data: {
            failedLoginCount: { increment: 1 },
            lastFailedLoginAt: input.now,
          },
          select: { failedLoginCount: true, lockedUntil: true },
        })

        if (user.failedLoginCount >= input.lockAfter) {
          const lockedUntil = new Date(input.now.getTime() + input.lockDurationMs)
          await tx.user.update({
            where: { id: userId },
            data: { lockedUntil },
          })

          return { lockedUntil, failedLoginCount: user.failedLoginCount }
        }

        return {
          lockedUntil: user.lockedUntil,
          failedLoginCount: user.failedLoginCount,
        }
      })
    },

    async recordSuccessfulLogin(userId: string, now: Date) {
      await getPrismaClient().user.update({
        where: { id: userId },
        data: {
          failedLoginCount: 0,
          lastFailedLoginAt: null,
          lockedUntil: null,
          lastLoginAt: now,
        },
      })
    },

    async findMfaChallenge(userId: string) {
      const user = await getPrismaClient().user.findUnique({
        where: { id: userId },
        select: {
          mfaEnabled: true,
          mfaSecret: true,
          mfaRecoveryCodes: true,
        },
      })

      if (!user) {
        return null
      }

      return {
        enabled: user.mfaEnabled,
        encryptedSecret: user.mfaSecret,
        recoveryCodeHashes: Array.isArray(user.mfaRecoveryCodes)
          ? (user.mfaRecoveryCodes as string[])
          : [],
      }
    },

    async consumeMfaRecoveryCode(userId: string, codeHash: string) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { mfaRecoveryCodes: true },
        })
        const codes = Array.isArray(user?.mfaRecoveryCodes)
          ? (user.mfaRecoveryCodes as string[])
          : []
        const index = codes.indexOf(codeHash)

        if (index === -1) {
          return false
        }

        const remaining = [...codes.slice(0, index), ...codes.slice(index + 1)]
        await tx.user.update({
          where: { id: userId },
          data: {
            mfaRecoveryCodes: remaining as Prisma.InputJsonValue,
          },
        })

        return true
      })
    },

    async findUserWithMemberships(userId: string) {
      const user = await getPrismaClient().user.findUnique({
        where: { id: userId },
        include: {
          memberships: {
            include: { school: true },
            orderBy: { joinedAt: 'asc' },
          },
        },
      })

      if (!user) {
        return null
      }

      return {
        user: mapUser(user),
        memberships: user.memberships
          .map(mapMembership)
          .filter((membership): membership is MembershipRecord => membership !== null),
      }
    },

    async createSession(input: CreateSessionInput): Promise<void> {
      await getPrismaClient().session.create({
        data: {
          userId: input.userId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        },
      })
    },

    async findSessionByTokenHash(
      tokenHash: string,
    ): Promise<SessionRecord | null> {
      const session = await getPrismaClient().session.findUnique({
        where: { tokenHash },
        include: { user: true },
      })

      if (!session) {
        return null
      }

      return {
        id: session.id,
        userId: session.userId,
        expiresAt: session.expiresAt,
        revokedAt: session.revokedAt,
        user: mapUser(session.user),
      }
    },

    async touchSession(sessionId: string): Promise<void> {
      await getPrismaClient().session.update({
        where: { id: sessionId },
        data: { lastUsedAt: new Date() },
      })
    },

    async revokeSession(sessionId: string): Promise<void> {
      await getPrismaClient().session.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
    },

    async revokeAllSessionsForUser(userId: string): Promise<void> {
      await getPrismaClient().session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
    },

    async findMembership(
      userId: string,
      schoolId: string,
    ): Promise<MembershipRecord | null> {
      const membership = await getPrismaClient().schoolMembership.findUnique({
        where: { schoolId_userId: { schoolId, userId } },
        include: { school: true },
      })

      // School status is part of the access decision: a suspended school is
      // treated exactly like no membership at all, so every caller of
      // `findMembership` (including `requireSchoolAccess`) fails closed.
      if (
        !membership ||
        membership.status !== 'ACTIVE' ||
        !membership.school.isActive
      ) {
        return null
      }

      return mapMembership(membership)
    },

    async findSchoolById(schoolId: string): Promise<SchoolSummary | null> {
      const school = await getPrismaClient().school.findUnique({
        where: { id: schoolId },
      })

      return school ? mapSchool(school) : null
    },

    async listSchoolMembers(schoolId: string): Promise<MemberSummary[]> {
      const memberships = await getPrismaClient().schoolMembership.findMany({
        where: { schoolId },
        include: { user: true },
        orderBy: [{ joinedAt: 'asc' }],
      })

      return memberships.flatMap((membership) => {
        if (!isSchoolRole(membership.role)) {
          return []
        }

        const role: SchoolRole = membership.role

        return [
          {
            userId: membership.userId,
            firstName: membership.user.firstName,
            lastName: membership.user.lastName,
            email: membership.user.email,
            role,
            status: membership.status as MembershipStatus,
            joinedAt: membership.joinedAt,
          },
        ]
      })
    },

    async createPasswordResetToken(
      input: CreatePasswordResetTokenInput,
    ): Promise<void> {
      await getPrismaClient().passwordResetToken.create({
        data: {
          userId: input.userId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
          ipAddress: input.ipAddress,
        },
      })
    },

    async consumePasswordResetToken(input): Promise<boolean> {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        const token = await tx.passwordResetToken.findFirst({
          where: {
            tokenHash: input.tokenHash,
            usedAt: null,
            expiresAt: { gt: input.now },
          },
        })

        if (!token) {
          return false
        }

        const consumed = await tx.passwordResetToken.updateMany({
          where: { id: token.id, usedAt: null },
          data: { usedAt: input.now },
        })

        if (consumed.count !== 1) {
          return false
        }

        await tx.user.update({
          where: { id: token.userId },
          data: { passwordHash: input.passwordHash },
        })

        // A reset revokes every existing session for the account.
        await tx.session.updateMany({
          where: { userId: token.userId, revokedAt: null },
          data: { revokedAt: input.now },
        })

        await tx.auditLog.create({
          data: {
            actorUserId: token.userId,
            action: 'PASSWORD_RESET_COMPLETED',
            entityType: 'User',
            entityId: token.userId,
          },
        })

        return true
      })
    },

    async enterSubjectTeacherAccessCode(input) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        const invitation = await tx.subjectTeacherInvitation.findFirst({
          where: {
            codeHash: input.codeHash,
            revokedAt: null,
            expiresAt: { gt: input.now },
            // Legacy one-time codes that were already consumed must not be
            // turned back into reusable access codes.
            usedAt: null,
          },
        })

        if (!invitation) {
          return null
        }

        // New codes are bound to one exact assignment. Legacy codes fall back
        // to the currently active assignment for their class/subject/teacher.
        const assignment = invitation.assignmentId
          ? await tx.subjectTeacherAssignment.findFirst({
              where: {
                id: invitation.assignmentId,
                schoolId: invitation.schoolId,
                classId: invitation.classId,
                subjectId: invitation.subjectId,
                endedAt: null,
              },
              include: subjectAssignmentInclude,
            })
          : await tx.subjectTeacherAssignment.findFirst({
              where: {
                schoolId: invitation.schoolId,
                classId: invitation.classId,
                subjectId: invitation.subjectId,
                endedAt: null,
                ...(invitation.membershipId
                  ? { membershipId: invitation.membershipId }
                  : {}),
              },
              include: subjectAssignmentInclude,
            })

        if (
          !assignment ||
          !assignment.school.isActive ||
          assignment.class.isArchived ||
          assignment.subject.isArchived
        ) {
          return null
        }

        const classSubject = await tx.classSubject.findUnique({
          where: {
            classId_subjectId: {
              classId: invitation.classId,
              subjectId: invitation.subjectId,
            },
          },
          select: { isActive: true },
        })

        if (!classSubject?.isActive) {
          return null
        }

        const session = await tx.subjectTeacherSession.create({
          data: {
            schoolId: invitation.schoolId,
            classId: invitation.classId,
            subjectId: invitation.subjectId,
            assignmentId: assignment.id,
            accessCodeId: invitation.id,
            tokenHash: input.tokenHash,
            expiresAt: input.expiresAt,
            ipAddress: input.ipAddress,
            userAgent: input.userAgent,
          },
          include: {
            assignment: { include: subjectAssignmentInclude },
          },
        })

        await tx.auditLog.create({
          data: {
            schoolId: invitation.schoolId,
            actorUserId: null,
            action: 'SUBJECT_TEACHER_ACCESS_CODE_USED',
            entityType: 'SubjectTeacherAssignment',
            entityId: assignment.id,
            metadata: {
              accessCodeId: invitation.id,
              classId: invitation.classId,
              subjectId: invitation.subjectId,
            },
            ipAddress: input.ipAddress ?? null,
            userAgent: input.userAgent ?? null,
          },
        })

        return mapSubjectSession(session)
      })
    },

    async findSubjectSessionByTokenHash(tokenHash) {
      const session = await getPrismaClient().subjectTeacherSession.findUnique({
        where: { tokenHash },
        include: {
          assignment: { include: subjectAssignmentInclude },
          accessCode: {
            select: { revokedAt: true, usedAt: true, assignmentId: true },
          },
        },
      })

      if (!session) {
        return null
      }

      const now = new Date()

      if (
        session.revokedAt !== null ||
        session.expiresAt <= now ||
        session.assignment.endedAt !== null ||
        // A suspended school immediately invalidates every subject session
        // scoped to it, including sessions issued before the suspension.
        !session.assignment.school.isActive ||
        session.assignment.class.isArchived ||
        session.assignment.subject.isArchived ||
        // Revoking or regenerating a code must end sessions started with it,
        // even if a revocation sweep ever failed.
        session.accessCode?.revokedAt != null
      ) {
        return null
      }

      return mapSubjectSession(session)
    },

    async touchSubjectSession(sessionId) {
      await getPrismaClient().subjectTeacherSession.update({
        where: { id: sessionId },
        data: { lastUsedAt: new Date() },
      })
    },

    async revokeSubjectSession(sessionId) {
      await getPrismaClient().subjectTeacherSession.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
    },

    async recordAudit(entry: AuditEntry): Promise<void> {
      await getPrismaClient().auditLog.create({
        data: {
          schoolId: entry.schoolId ?? null,
          actorUserId: entry.actorUserId ?? null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          metadata: entry.metadata as Prisma.InputJsonValue | undefined,
          ipAddress: entry.ipAddress ?? null,
          userAgent: entry.userAgent ?? null,
        },
      })
    },
  }
}
