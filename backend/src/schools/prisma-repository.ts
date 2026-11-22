import { HttpError } from '../errors/http-error.js'
import { getPrismaClient } from '../lib/prisma.js'
import { env } from '../config/env.js'
import type { Prisma } from '../generated/prisma/client.js'
import { isUniqueConstraintError } from '../auth/prisma-repository.js'
import { isSchoolRole, type SchoolRole } from '../auth/roles.js'
import {
  generateSubjectAccessCode,
  hashToken,
} from '../auth/tokens.js'
import {
  isSchoolIdentityComplete,
  schoolLogoUrl,
} from '../lib/school-branding.js'
import { DEFAULT_CLASSES } from './defaults.js'
import type {
  AcademicTermRecord,
  AcademicYearRecord,
  AssignSubjectTeacherInput,
  AuditContext,
  ClassRecord,
  ClassRegistrationResult,
  ClassSubjectCountRecord,
  ClassSubjectRecord,
  ClassTeacherAssignmentRecord,
  IssuedSubjectTeacherInvitation,
  MovePupilInput,
  PupilEnrollmentRecord,
  PupilRecord,
  RegisterClassWithTeacherInput,
  RegisterTeacherInput,
  RegisterTeacherResult,
  RemoveTeacherMembershipInput,
  RestoreTeacherMembershipInput,
  SchoolProfile,
  SchoolRepository,
  SubjectRecord,
  SubjectTeacherAssignmentRecord,
  SubjectTeacherDetailsInput,
  SubjectTeacherInvitationRecord,
  TeacherRecord,
  UpdateTeacherInput,
} from './repository.js'

type Tx = Prisma.TransactionClient

function dateOnly(value: Date | string): string {
  if (typeof value === 'string') {
    return value.slice(0, 10)
  }

  return value.toISOString().slice(0, 10)
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function normalizeAdmissionNumber(value: string): string {
  return value.trim().toUpperCase()
}

function mapSchool(school: {
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
}): SchoolProfile {
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
    logoUrl: schoolLogoUrl(school.id, school.logoUpdatedAt),
    logoUpdatedAt: school.logoUpdatedAt,
    profileComplete: isSchoolIdentityComplete(school),
    createdAt: school.createdAt,
  }
}

function mapTerm(term: {
  id: string
  schoolId: string
  academicYearId: string
  name: string
  sequence: number
  startsOn: Date
  endsOn: Date
  isCurrent: boolean
}): AcademicTermRecord {
  return {
    id: term.id,
    schoolId: term.schoolId,
    academicYearId: term.academicYearId,
    name: term.name,
    sequence: term.sequence,
    startsOn: dateOnly(term.startsOn),
    endsOn: dateOnly(term.endsOn),
    isCurrent: term.isCurrent,
  }
}

function mapYear(year: {
  id: string
  schoolId: string
  name: string
  startsOn: Date
  endsOn: Date
  isCurrent: boolean
  terms?: Parameters<typeof mapTerm>[0][]
}): AcademicYearRecord {
  return {
    id: year.id,
    schoolId: year.schoolId,
    name: year.name,
    startsOn: dateOnly(year.startsOn),
    endsOn: dateOnly(year.endsOn),
    isCurrent: year.isCurrent,
    terms: (year.terms ?? []).map(mapTerm),
  }
}

function mapClass(cls: {
  id: string
  schoolId: string
  academicYearId: string | null
  name: string
  level: string | null
  sortOrder: number
  isArchived: boolean
  createdAt: Date
  academicYear?: { name: string } | null
}): ClassRecord {
  return {
    id: cls.id,
    schoolId: cls.schoolId,
    academicYearId: cls.academicYearId,
    academicYearName: cls.academicYear?.name ?? null,
    name: cls.name,
    level: cls.level,
    sortOrder: cls.sortOrder,
    isArchived: cls.isArchived,
    createdAt: cls.createdAt,
  }
}

function mapClassSubject(item: {
  id: string
  schoolId: string
  classId: string
  subjectId: string
  isActive: boolean
  sortOrder: number
  subject: { name: string; code: string | null }
}): ClassSubjectRecord {
  return {
    id: item.id,
    schoolId: item.schoolId,
    classId: item.classId,
    subjectId: item.subjectId,
    subjectName: item.subject.name,
    subjectCode: item.subject.code,
    isActive: item.isActive,
    sortOrder: item.sortOrder,
  }
}

function mapEnrollment(item: {
  id: string
  schoolId: string
  pupilId: string
  classId: string
  academicYearId: string
  status: string
  startedOn: Date
  endedOn: Date | null
  class: { name: string }
  academicYear: { name: string }
}): PupilEnrollmentRecord {
  return {
    id: item.id,
    schoolId: item.schoolId,
    pupilId: item.pupilId,
    classId: item.classId,
    className: item.class.name,
    academicYearId: item.academicYearId,
    academicYearName: item.academicYear.name,
    status: item.status as PupilEnrollmentRecord['status'],
    startedOn: dateOnly(item.startedOn),
    endedOn: item.endedOn ? dateOnly(item.endedOn) : null,
  }
}

function mapPupil(pupil: {
  id: string
  schoolId: string
  firstName: string
  lastName: string
  otherNames: string | null
  admissionNumber: string
  gender: string | null
  dateOfBirth: Date | null
  photoReference: string | null
  photoUpdatedAt: Date | null
  status: string
  currentClassId: string | null
  createdAt: Date
  currentClass?: { name: string } | null
}): PupilRecord {
  return {
    id: pupil.id,
    schoolId: pupil.schoolId,
    firstName: pupil.firstName,
    lastName: pupil.lastName,
    otherNames: pupil.otherNames,
    admissionNumber: pupil.admissionNumber,
    gender: pupil.gender as PupilRecord['gender'],
    dateOfBirth: pupil.dateOfBirth ? dateOnly(pupil.dateOfBirth) : null,
    photoUrl:
      pupil.photoReference && pupil.photoUpdatedAt
        ? `/api/schools/${pupil.schoolId}/pupils/${pupil.id}/photo?v=${pupil.photoUpdatedAt.getTime()}`
        : null,
    photoUpdatedAt: pupil.photoUpdatedAt,
    status: pupil.status as PupilRecord['status'],
    currentClassId: pupil.currentClassId,
    currentClassName: pupil.currentClass?.name ?? null,
    createdAt: pupil.createdAt,
  }
}

function mapSubject(subject: {
  id: string
  schoolId: string
  name: string
  code: string | null
  isArchived: boolean
  createdAt: Date
}): SubjectRecord {
  return {
    id: subject.id,
    schoolId: subject.schoolId,
    name: subject.name,
    code: subject.code,
    isArchived: subject.isArchived,
    createdAt: subject.createdAt,
  }
}

function mapTeacher(membership: {
  id: string
  schoolId: string
  role: string
  status: string
  joinedAt: Date
  user: {
    id: string
    firstName: string
    lastName: string
    email: string
    phone?: string | null
  }
}): TeacherRecord {
  return {
    membershipId: membership.id,
    userId: membership.user.id,
    schoolId: membership.schoolId,
    firstName: membership.user.firstName,
    lastName: membership.user.lastName,
    email: membership.user.email,
    phone: membership.user.phone ?? null,
    role: membership.role as SchoolRole,
    status: membership.status as TeacherRecord['status'],
    joinedAt: membership.joinedAt,
  }
}

function mapClassTeacherAssignment(item: {
  id: string
  schoolId: string
  classId: string
  membershipId: string
  createdAt: Date
  endedAt: Date | null
  class: { name: string }
  membership: {
    user: { id: string; firstName: string; lastName: string; email: string }
  }
}): ClassTeacherAssignmentRecord {
  return {
    id: item.id,
    schoolId: item.schoolId,
    classId: item.classId,
    className: item.class.name,
    membershipId: item.membershipId,
    userId: item.membership.user.id,
    firstName: item.membership.user.firstName,
    lastName: item.membership.user.lastName,
    email: item.membership.user.email,
    createdAt: item.createdAt,
    endedAt: item.endedAt,
  }
}

type SubjectTeacherAssignmentRelations = {
  id: string
  schoolId: string
  classId: string
  subjectId: string
  membershipId: string | null
  firstName: string
  lastName: string
  email: string
  phone: string | null
  createdAt: Date
  endedAt: Date | null
  class: { name: string }
  subject: { name: string }
  membership: {
    userId: string
    user: {
      id: string
      firstName: string
      lastName: string
      email: string
      phone: string | null
    }
  } | null
}

/**
 * Subject-teacher identity lives on the assignment itself. Legacy rows that
 * predate access codes may still fall back to the linked membership.
 */
function mapSubjectTeacherAssignment(
  item: SubjectTeacherAssignmentRelations,
): SubjectTeacherAssignmentRecord {
  const teacher = item.membership
    ? item.membership.user
    : {
        id: null,
        firstName: item.firstName,
        lastName: item.lastName,
        email: item.email,
        phone: item.phone,
      }

  return {
    id: item.id,
    schoolId: item.schoolId,
    classId: item.classId,
    className: item.class.name,
    subjectId: item.subjectId,
    subjectName: item.subject.name,
    membershipId: item.membershipId,
    userId: item.membership?.userId ?? null,
    firstName: teacher.firstName,
    lastName: teacher.lastName,
    email: teacher.email,
    phone: teacher.phone ?? null,
    createdAt: item.createdAt,
    endedAt: item.endedAt,
  }
}

function invitationStatus(
  invitation: {
    usedAt: Date | null
    revokedAt: Date | null
    expiresAt: Date
  },
  now = new Date(),
): SubjectTeacherInvitationRecord['status'] {
  if (invitation.revokedAt) {
    return 'REVOKED'
  }

  if (invitation.usedAt) {
    return 'USED'
  }

  return invitation.expiresAt.getTime() <= now.getTime() ? 'EXPIRED' : 'PENDING'
}

type SubjectTeacherInvitationRelations = {
  id: string
  schoolId: string
  classId: string
  subjectId: string
  membershipId: string | null
  assignmentId: string | null
  createdByMembershipId: string | null
  expiresAt: Date
  usedAt: Date | null
  revokedAt: Date | null
  reissuedFromId: string | null
  createdAt: Date
  class: { name: string }
  subject: { name: string }
  assignment: SubjectTeacherAssignmentRelations | null
  membership: {
    userId: string
    user: {
      firstName: string
      lastName: string
      email: string
      phone: string | null
    }
  } | null
}

function mapSubjectTeacherInvitation(
  item: SubjectTeacherInvitationRelations,
): SubjectTeacherInvitationRecord {
  const identity = item.assignment
    ? {
        membershipId: item.assignment.membershipId,
        userId: item.assignment.membership?.userId ?? null,
        firstName: item.assignment.firstName,
        lastName: item.assignment.lastName,
        email: item.assignment.email,
        phone: item.assignment.phone,
      }
    : item.membership
      ? {
          membershipId: item.membershipId,
          userId: item.membership.userId,
          firstName: item.membership.user.firstName,
          lastName: item.membership.user.lastName,
          email: item.membership.user.email,
          phone: item.membership.user.phone,
        }
      : {
          membershipId: item.membershipId,
          userId: null,
          firstName: '',
          lastName: '',
          email: '',
          phone: null,
        }

  return {
    id: item.id,
    schoolId: item.schoolId,
    classId: item.classId,
    className: item.class.name,
    subjectId: item.subjectId,
    subjectName: item.subject.name,
    membershipId: identity.membershipId,
    userId: identity.userId,
    assignmentId: item.assignmentId ?? item.assignment?.id ?? null,
    firstName: identity.firstName,
    lastName: identity.lastName,
    email: identity.email,
    phone: identity.phone,
    status: invitationStatus(item),
    expiresAt: item.expiresAt,
    usedAt: item.usedAt,
    revokedAt: item.revokedAt,
    reissuedFromId: item.reissuedFromId,
    createdAt: item.createdAt,
  }
}

function auditData(
  schoolId: string,
  audit: AuditContext,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata?: Record<string, unknown>,
) {
  return {
    schoolId,
    actorUserId: audit.actorUserId,
    action,
    entityType,
    entityId,
    metadata: metadata as Prisma.InputJsonValue | undefined,
    ipAddress: audit.ipAddress ?? null,
    userAgent: audit.userAgent ?? null,
  }
}

async function recordAudit(
  tx: Tx,
  schoolId: string,
  audit: AuditContext,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await tx.auditLog.create({
    data: auditData(schoolId, audit, action, entityType, entityId, metadata),
  })
}

async function findSchoolOrThrow(tx: Tx, schoolId: string) {
  const school = await tx.school.findUnique({ where: { id: schoolId } })

  if (!school) {
    throw new HttpError(404, 'School not found')
  }

  return school
}

async function findClassOrThrow(tx: Tx, schoolId: string, classId: string) {
  const cls = await tx.schoolClass.findFirst({
    where: { id: classId, schoolId },
  })

  if (!cls) {
    throw new HttpError(404, 'Class not found')
  }

  return cls
}

async function findSubjectOrThrow(
  tx: Tx,
  schoolId: string,
  subjectId: string,
) {
  const subject = await tx.subject.findFirst({
    where: { id: subjectId, schoolId },
  })

  if (!subject) {
    throw new HttpError(404, 'Subject not found')
  }

  return subject
}

async function findYearOrThrow(tx: Tx, schoolId: string, yearId: string) {
  const year = await tx.academicYear.findFirst({
    where: { id: yearId, schoolId },
  })

  if (!year) {
    throw new HttpError(404, 'Academic year not found')
  }

  return year
}

/**
 * Resolves the class selected during class-teacher registration.
 *
 * A supported class is reused when it already exists for the school. The
 * advisory lock serialises concurrent registrations for the same class name so
 * two transactions cannot both observe a missing class and create duplicates.
 */
async function findOrCreateRegistrationClass(
  tx: Tx,
  schoolId: string,
  input: RegisterTeacherInput,
) {
  if (input.classId) {
    const existing = await tx.schoolClass.findFirst({
      where: { id: input.classId, schoolId },
    })

    if (!existing) {
      throw new HttpError(400, 'The selected class does not belong to this school')
    }

    return existing
  }

  const name = (input.className ?? '').trim()

  if (!name) {
    throw new HttpError(400, 'Select the class this class teacher will manage')
  }

  const template = DEFAULT_CLASSES.find(
    (item) => item.name.toLowerCase() === name.toLowerCase(),
  )

  await tx.$executeRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtext($1))',
    `${schoolId}:class:${name.toLowerCase()}`,
  )

  const existing = await tx.schoolClass.findFirst({
    where: {
      schoolId,
      academicYearId: null,
      name: template?.name ?? name,
    },
  })

  if (existing) {
    return existing
  }

  return tx.schoolClass.create({
    data: {
      schoolId,
      academicYearId: null,
      name: template?.name ?? name,
      level: template?.level ?? null,
      sortOrder: template?.sortOrder ?? 0,
    },
  })
}

async function assignRegisteredClassTeacher(
  tx: Tx,
  options: {
    schoolId: string
    membershipId: string
    input: RegisterTeacherInput
    audit: AuditContext
  },
): Promise<{ id: string; name: string }> {
  const { schoolId, membershipId, input, audit } = options
  const cls = await findOrCreateRegistrationClass(tx, schoolId, input)

  const active = await tx.classTeacherAssignment.findFirst({
    where: { schoolId, classId: cls.id, endedAt: null },
  })

  if (active && active.membershipId !== membershipId) {
    throw new HttpError(
      409,
      'This class already has an active class teacher. Revoke or reassign the existing assignment first.',
    )
  }

  // A class teacher is responsible for one class at a time. Ending the previous
  // assignment preserves pupils, assessment records and assignment history.
  const previous = await tx.classTeacherAssignment.findMany({
    where: { schoolId, membershipId, endedAt: null, NOT: { classId: cls.id } },
  })

  for (const assignment of previous) {
    await tx.classTeacherAssignment.update({
      where: { id: assignment.id },
      data: { endedAt: new Date() },
    })

    await recordAudit(
      tx,
      schoolId,
      audit,
      'CLASS_TEACHER_REASSIGNED',
      'ClassTeacherAssignment',
      assignment.id,
      {
        membershipId,
        fromClassId: assignment.classId,
        toClassId: cls.id,
      },
    )
  }

  const assignment = await tx.classTeacherAssignment.upsert({
    where: {
      classId_membershipId: { classId: cls.id, membershipId },
    },
    create: { schoolId, classId: cls.id, membershipId },
    update: { endedAt: null },
  })

  await recordAudit(
    tx,
    schoolId,
    audit,
    'CLASS_TEACHER_ASSIGNED',
    'ClassTeacherAssignment',
    assignment.id,
    { classId: cls.id, membershipId, className: cls.name },
  )

  return { id: cls.id, name: cls.name }
}

/**
 * Resolves a subject for a class offering. Existing catalogue subjects are
 * reused (case-insensitively) so retries and repeat offerings never create
 * duplicates. A new subject is created only when no catalogue entry matches.
 */
async function findOrCreateSubjectForClass(
  tx: Tx,
  schoolId: string,
  input: { subjectId?: string | null; name?: string | null; code?: string | null },
  audit: AuditContext,
) {
  if (input.subjectId) {
    const subject = await tx.subject.findFirst({
      where: { id: input.subjectId, schoolId },
    })

    if (!subject) {
      throw new HttpError(
        400,
        'The selected subject does not belong to this school',
      )
    }

    if (subject.isArchived) {
      throw new HttpError(409, 'Archived subjects cannot be assigned')
    }

    return subject
  }

  const name = normalizeName(input.name ?? '')

  if (!name) {
    throw new HttpError(400, 'Enter a subject name')
  }

  // Serialise creation for the same school/name so concurrent registrations
  // cannot both insert a duplicate subject.
  await tx.$executeRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtext($1))',
    `${schoolId}:subject:${name.toLowerCase()}`,
  )

  const existing = await tx.subject.findFirst({
    where: {
      schoolId,
      name: { equals: name, mode: 'insensitive' },
    },
  })

  if (existing) {
    if (existing.isArchived) {
      throw new HttpError(409, 'Archived subjects cannot be assigned')
    }

    return existing
  }

  const subject = await tx.subject.create({
    data: {
      schoolId,
      name,
      code: input.code?.trim() || null,
    },
  })

  await recordAudit(
    tx,
    schoolId,
    audit,
    'SUBJECT_CREATED',
    'Subject',
    subject.id,
    { name: subject.name },
  )

  return subject
}

async function upsertClassSubject(
  tx: Tx,
  schoolId: string,
  classId: string,
  subjectId: string,
  audit: AuditContext,
) {
  const item = await tx.classSubject.upsert({
    where: { classId_subjectId: { classId, subjectId } },
    create: {
      schoolId,
      classId,
      subjectId,
      sortOrder: await tx.classSubject.count({ where: { schoolId, classId } }),
    },
    update: { isActive: true },
    include: { subject: { select: { name: true, code: true } } },
  })

  await recordAudit(
    tx,
    schoolId,
    audit,
    'CLASS_SUBJECT_ASSIGNED',
    'ClassSubject',
    item.id,
    { classId, subjectId, subjectName: item.subject.name },
  )

  return item
}

async function upsertSubjectTeacherAssignment(
  tx: Tx,
  options: {
    schoolId: string
    classId: string
    subjectId: string
    membershipId: string
    audit: AuditContext
  },
) {
  const { schoolId, classId, subjectId, membershipId, audit } = options
  const membership = await findTeacherMembership(tx, schoolId, membershipId)

  if (membership.role !== 'SUBJECT_TEACHER') {
    throw new HttpError(
      409,
      'Only a subject teacher membership can hold a subject-teacher assignment',
    )
  }

  const classSubject = await tx.classSubject.findUnique({
    where: { classId_subjectId: { classId, subjectId } },
  })

  if (!classSubject || !classSubject.isActive) {
    throw new HttpError(
      409,
      'Assign the subject to the class before assigning a teacher',
    )
  }

  const identity = {
    firstName: membership.user.firstName,
    lastName: membership.user.lastName,
    email: membership.user.email,
    phone: membership.user.phone ?? null,
  }

  // Enforce one active subject teacher per class subject. The database unique
  // key cannot do this for assignments without a membership (NULLs differ).
  const active = await tx.subjectTeacherAssignment.findFirst({
    where: {
      schoolId,
      classId,
      subjectId,
      endedAt: null,
      NOT: { membershipId },
    },
  })

  if (active) {
    await tx.subjectTeacherAssignment.update({
      where: { id: active.id },
      data: { endedAt: new Date() },
    })
  }

  const assignment = await tx.subjectTeacherAssignment.upsert({
    where: {
      classId_subjectId_membershipId: {
        classId,
        subjectId,
        membershipId,
      },
    },
    create: { schoolId, classId, subjectId, membershipId, ...identity },
    update: { endedAt: null, ...identity },
    include: {
      class: { select: { name: true } },
      subject: { select: { name: true } },
      membership: { include: { user: true } },
    },
  })

  await recordAudit(
    tx,
    schoolId,
    audit,
    'SUBJECT_TEACHER_ASSIGNED',
    'SubjectTeacherAssignment',
    assignment.id,
    { classId, subjectId, membershipId },
  )

  return assignment
}

async function findTeacherMembership(
  tx: Tx,
  schoolId: string,
  membershipId: string,
) {
  const membership = await tx.schoolMembership.findFirst({
    where: { id: membershipId, schoolId },
    include: { user: true },
  })

  if (!membership || membership.status !== 'ACTIVE') {
    throw new HttpError(404, 'Active teacher membership not found')
  }

  return membership
}

const INVITATION_TTL_MS =
  Math.max(1, env.SUBJECT_TEACHER_ACCESS_CODE_EXPIRY_DAYS) *
  24 *
  60 *
  60 *
  1000

/**
 * Resolve a subject teacher's identity without creating a User, Membership or
 * password. The access code alone grants the restricted subject session.
 */
async function resolveSubjectTeacherIdentity(
  tx: Tx,
  schoolId: string,
  details: SubjectTeacherDetailsInput,
): Promise<{
  membershipId: string | null
  firstName: string
  lastName: string
  email: string
  phone: string | null
}> {
  const email = details.email.trim().toLowerCase()
  const firstName = normalizeName(details.firstName)
  const lastName = normalizeName(details.lastName)

  if (!email || !firstName || !lastName) {
    throw new HttpError(
      400,
      'Provide the subject teacher\u2019s first name, last name and email address',
    )
  }

  // A platform administrator must never be reachable through an access code.
  const existingUser = await tx.user.findUnique({ where: { email } })

  if (existingUser?.isPlatformAdmin) {
    throw new HttpError(
      409,
      'A platform administrator cannot be assigned as a subject teacher',
    )
  }

  void schoolId

  return {
    membershipId: null,
    firstName,
    lastName,
    email,
    phone: details.phone?.trim() || null,
  }
}

async function issueSubjectTeacherInvitation(
  tx: Tx,
  options: {
    schoolId: string
    classId: string
    subjectId: string
    assignmentId: string
    membershipId?: string | null
    createdByMembershipId: string | null
    audit: AuditContext
    reissuedFromId?: string | null
    now?: Date
  },
): Promise<IssuedSubjectTeacherInvitation> {
  const {
    schoolId,
    classId,
    subjectId,
    assignmentId,
    membershipId,
    createdByMembershipId,
    audit,
    reissuedFromId,
  } = options
  const now = options.now ?? new Date()

  // A new code supersedes every previous unused code for this class subject,
  // including codes issued to a teacher who has just been replaced.
  await tx.subjectTeacherInvitation.updateMany({
    where: {
      schoolId,
      classId,
      subjectId,
      usedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: now },
  })

  // Generate a code in the exact DDDDUll shape. The hash is unique in the
  // database; a pre-check makes an accidental collision retry rather than
  // surfacing a unique-constraint error. The space is ~175.8 million codes.
  let code = generateSubjectAccessCode()
  let codeHash = hashToken(code)

  for (
    let attempt = 0;
    attempt < 5 && (await tx.subjectTeacherInvitation.findUnique({
      where: { codeHash },
      select: { id: true },
    }));
    attempt += 1
  ) {
    code = generateSubjectAccessCode()
    codeHash = hashToken(code)
  }

  const invitation = await tx.subjectTeacherInvitation.create({
    data: {
      schoolId,
      classId,
      subjectId,
      assignmentId,
      membershipId: membershipId ?? null,
      createdByMembershipId,
      codeHash,
      expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
      reissuedFromId: reissuedFromId ?? null,
    },
    include: {
      class: { select: { name: true } },
      subject: { select: { name: true } },
      assignment: {
        include: {
          class: { select: { name: true } },
          subject: { select: { name: true } },
          membership: { include: { user: true } },
        },
      },
      membership: { include: { user: true } },
    },
  })

  await recordAudit(
    tx,
    schoolId,
    audit,
    reissuedFromId
      ? 'SUBJECT_TEACHER_INVITATION_REISSUED'
      : 'SUBJECT_TEACHER_INVITATION_CREATED',
    'SubjectTeacherInvitation',
    invitation.id,
    {
      classId,
      subjectId,
      assignmentId,
      membershipId: membershipId ?? null,
      reissuedFromId: reissuedFromId ?? null,
    },
  )

  return { ...mapSubjectTeacherInvitation(invitation), code }
}

async function assignSubjectTeacherForClassSubject(
  tx: Tx,
  options: {
    schoolId: string
    classId: string
    subjectId: string
    input: AssignSubjectTeacherInput
    createdByMembershipId: string | null
    audit: AuditContext
  },
): Promise<{
  assignment: SubjectTeacherAssignmentRecord
  invitation: IssuedSubjectTeacherInvitation
}> {
  const { schoolId, classId, subjectId, input, createdByMembershipId, audit } =
    options

  let identity: {
    membershipId: string | null
    firstName: string
    lastName: string
    email: string
    phone: string | null
  }

  if (input.membershipId) {
    const membership = await findTeacherMembership(
      tx,
      schoolId,
      input.membershipId,
    )

    if (membership.role !== 'SUBJECT_TEACHER') {
      throw new HttpError(
        409,
        'Only a subject teacher membership can hold a subject-teacher assignment',
      )
    }

    identity = {
      membershipId: membership.id,
      firstName: membership.user.firstName,
      lastName: membership.user.lastName,
      email: membership.user.email,
      phone: membership.user.phone ?? null,
    }
  } else if (input.teacher) {
    identity = await resolveSubjectTeacherIdentity(tx, schoolId, input.teacher)
  } else {
    throw new HttpError(
      400,
      'Provide the subject teacher\u2019s details to create an access code',
    )
  }

  const classSubject = await tx.classSubject.findUnique({
    where: { classId_subjectId: { classId, subjectId } },
  })

  if (!classSubject || !classSubject.isActive) {
    throw new HttpError(
      409,
      'Assign the subject to the class before assigning a teacher',
    )
  }

  // Replacing a subject teacher ends the previous assignment but preserves the
  // historical row, scores and audit trail.
  const active = await tx.subjectTeacherAssignment.findMany({
    where: { schoolId, classId, subjectId, endedAt: null },
  })

  const samePerson = (current: (typeof active)[number]) =>
    identity.membershipId
      ? current.membershipId === identity.membershipId
      : current.membershipId === null &&
        current.email.toLowerCase() === identity.email.toLowerCase()

  for (const current of active) {
    if (samePerson(current)) {
      continue
    }

    await tx.subjectTeacherAssignment.update({
      where: { id: current.id },
      data: { endedAt: new Date() },
    })

    await recordAudit(
      tx,
      schoolId,
      audit,
      'SUBJECT_TEACHER_REPLACED',
      'SubjectTeacherAssignment',
      current.id,
      {
        classId,
        subjectId,
        fromAssignmentId: current.id,
        fromEmail: current.email,
        toEmail: identity.email,
      },
    )
  }

  const existing = identity.membershipId
    ? await tx.subjectTeacherAssignment.findFirst({
        where: {
          classId,
          subjectId,
          membershipId: identity.membershipId,
        },
        orderBy: { createdAt: 'desc' },
      })
    : await tx.subjectTeacherAssignment.findFirst({
        where: {
          classId,
          subjectId,
          membershipId: null,
          email: { equals: identity.email, mode: 'insensitive' },
        },
        orderBy: { createdAt: 'desc' },
      })

  const assignment = existing
    ? await tx.subjectTeacherAssignment.update({
        where: { id: existing.id },
        data: { ...identity, endedAt: null },
        include: {
          class: { select: { name: true } },
          subject: { select: { name: true } },
          membership: { include: { user: true } },
        },
      })
    : await tx.subjectTeacherAssignment.create({
        data: { schoolId, classId, subjectId, ...identity },
        include: {
          class: { select: { name: true } },
          subject: { select: { name: true } },
          membership: { include: { user: true } },
        },
      })

  await recordAudit(
    tx,
    schoolId,
    audit,
    'SUBJECT_TEACHER_ASSIGNED',
    'SubjectTeacherAssignment',
    assignment.id,
    {
      classId,
      subjectId,
      membershipId: identity.membershipId,
      email: identity.email,
    },
  )

  const invitation = await issueSubjectTeacherInvitation(tx, {
    schoolId,
    classId,
    subjectId,
    assignmentId: assignment.id,
    membershipId: identity.membershipId,
    createdByMembershipId,
    audit,
  })

  return {
    assignment: mapSubjectTeacherAssignment(assignment),
    invitation,
  }
}

function conflictFromUnique(error: unknown, message: string): never {
  if (isUniqueConstraintError(error)) {
    throw new HttpError(409, message)
  }

  throw error
}

export function createPrismaSchoolRepository(): SchoolRepository {
  return {
    async getSchoolProfile(schoolId: string): Promise<SchoolProfile | null> {
      const school = await getPrismaClient().school.findUnique({
        where: { id: schoolId },
      })

      return school ? mapSchool(school) : null
    },

    async getSchoolLogo(schoolId: string) {
      const school = await getPrismaClient().school.findUnique({
        where: { id: schoolId },
        select: {
          logoObjectKey: true,
          logoMimeType: true,
          logoUpdatedAt: true,
        },
      })

      if (
        !school?.logoObjectKey ||
        !school.logoMimeType ||
        !school.logoUpdatedAt
      ) {
        return null
      }

      return {
        storageKey: school.logoObjectKey,
        mimeType: school.logoMimeType,
        updatedAt: school.logoUpdatedAt,
      }
    },

    async updateSchoolProfile(schoolId, input, audit) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        const existing = await findSchoolOrThrow(tx, schoolId)

        const school = await tx.school.update({
          where: { id: schoolId },
          data: {
            name: input.name === undefined ? undefined : normalizeName(input.name),
            email: input.email === undefined ? undefined : input.email,
            phone: input.phone === undefined ? undefined : input.phone,
            address: input.address === undefined ? undefined : input.address,
            landmark: input.landmark === undefined ? undefined : input.landmark,
            timezone: input.timezone,
          },
        })

        await recordAudit(
          tx,
          schoolId,
          audit,
          'SCHOOL_PROFILE_UPDATED',
          'School',
          schoolId,
          {
            previousName: existing.name,
            name: school.name,
          },
        )

        return mapSchool(school)
      })
    },

    async updateSchoolLogo(schoolId, input, audit) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        await findSchoolOrThrow(tx, schoolId)

        const school = await tx.school.update({
          where: { id: schoolId },
          data: {
            logoObjectKey: input.logoObjectKey,
            logoMimeType: input.logoMimeType,
            logoUpdatedAt: input.logoUpdatedAt,
          },
        })

        await recordAudit(
          tx,
          schoolId,
          audit,
          'SCHOOL_LOGO_UPDATED',
          'School',
          schoolId,
          { logoUpdatedAt: input.logoUpdatedAt.toISOString() },
        )

        return mapSchool(school)
      })
    },

    async getSchoolSignature(schoolId: string) {
      const school = await getPrismaClient().school.findUnique({
        where: { id: schoolId },
        select: {
          signatureObjectKey: true,
          signatureMimeType: true,
          signatureUpdatedAt: true,
          signatureName: true,
          signatureDesignation: true,
        },
      })

      if (
        !school?.signatureObjectKey ||
        !school.signatureMimeType ||
        !school.signatureUpdatedAt
      ) {
        return null
      }

      return {
        storageKey: school.signatureObjectKey,
        mimeType: school.signatureMimeType,
        updatedAt: school.signatureUpdatedAt,
        name: school.signatureName,
        designation: school.signatureDesignation,
      }
    },

    async updateSchoolSignature(schoolId, input, audit) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        await findSchoolOrThrow(tx, schoolId)

        const school = await tx.school.update({
          where: { id: schoolId },
          data: {
            signatureObjectKey: input.storageKey,
            signatureMimeType: input.mimeType,
            signatureUpdatedAt: input.updatedAt,
            signatureName:
              input.name === undefined ? undefined : input.name,
            signatureDesignation:
              input.designation === undefined ? undefined : input.designation,
          },
        })

        await recordAudit(
          tx,
          schoolId,
          audit,
          'SCHOOL_SIGNATURE_UPDATED',
          'School',
          schoolId,
          { signatureUpdatedAt: input.updatedAt.toISOString() },
        )

        return {
          storageKey: input.storageKey,
          mimeType: input.mimeType,
          updatedAt: input.updatedAt,
          name: school.signatureName,
          designation: school.signatureDesignation,
        }
      })
    },

    async updateSchoolSignatureDetails(schoolId, input, audit) {
      const prisma = getPrismaClient()

      await prisma.$transaction(async (tx) => {
        await findSchoolOrThrow(tx, schoolId)

        await tx.school.update({
          where: { id: schoolId },
          data: {
            signatureName: input.name === undefined ? undefined : input.name,
            signatureDesignation:
              input.designation === undefined ? undefined : input.designation,
          },
        })

        await recordAudit(
          tx,
          schoolId,
          audit,
          'SCHOOL_SIGNATURE_DETAILS_UPDATED',
          'School',
          schoolId,
          {},
        )
      })

      return this.getSchoolSignature(schoolId)
    },

    async removeSchoolSignature(schoolId, audit) {
      const prisma = getPrismaClient()

      await prisma.$transaction(async (tx) => {
        await findSchoolOrThrow(tx, schoolId)

        await tx.school.update({
          where: { id: schoolId },
          data: {
            signatureObjectKey: null,
            signatureMimeType: null,
            signatureUpdatedAt: null,
            signatureName: null,
            signatureDesignation: null,
          },
        })

        await recordAudit(
          tx,
          schoolId,
          audit,
          'SCHOOL_SIGNATURE_REMOVED',
          'School',
          schoolId,
          {},
        )
      })
    },

    async listAcademicYears(schoolId: string): Promise<AcademicYearRecord[]> {
      const years = await getPrismaClient().academicYear.findMany({
        where: { schoolId },
        include: { terms: { orderBy: { sequence: 'asc' } } },
        orderBy: [{ startsOn: 'desc' }, { name: 'asc' }],
      })

      return years.map(mapYear)
    },

    async createAcademicYear(schoolId, input, audit) {
      const prisma = getPrismaClient()

      try {
        return await prisma.$transaction(async (tx) => {
          await findSchoolOrThrow(tx, schoolId)

          if (input.isCurrent) {
            await tx.academicYear.updateMany({
              where: { schoolId, isCurrent: true },
              data: { isCurrent: false },
            })
          }

          const year = await tx.academicYear.create({
            data: {
              schoolId,
              name: normalizeName(input.name),
              startsOn: parseDate(input.startsOn),
              endsOn: parseDate(input.endsOn),
              isCurrent: input.isCurrent ?? false,
            },
            include: { terms: true },
          })

          await recordAudit(
            tx,
            schoolId,
            audit,
            'ACADEMIC_YEAR_CREATED',
            'AcademicYear',
            year.id,
            { name: year.name },
          )

          return mapYear(year)
        })
      } catch (error) {
        return conflictFromUnique(
          error,
          'An academic year with this name already exists',
        )
      }
    },

    async updateAcademicYear(schoolId, yearId, input, audit) {
      const prisma = getPrismaClient()

      try {
        return await prisma.$transaction(async (tx) => {
          await findYearOrThrow(tx, schoolId, yearId)

          const year = await tx.academicYear.update({
            where: { id: yearId },
            data: {
              name: input.name === undefined ? undefined : normalizeName(input.name),
              startsOn:
                input.startsOn === undefined
                  ? undefined
                  : parseDate(input.startsOn),
              endsOn:
                input.endsOn === undefined ? undefined : parseDate(input.endsOn),
            },
            include: { terms: { orderBy: { sequence: 'asc' } } },
          })

          await recordAudit(
            tx,
            schoolId,
            audit,
            'ACADEMIC_YEAR_UPDATED',
            'AcademicYear',
            year.id,
            { name: year.name },
          )

          return mapYear(year)
        })
      } catch (error) {
        return conflictFromUnique(
          error,
          'An academic year with this name already exists',
        )
      }
    },

    async setCurrentAcademicYear(schoolId, yearId, audit) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        await findYearOrThrow(tx, schoolId, yearId)

        await tx.academicYear.updateMany({
          where: { schoolId, isCurrent: true },
          data: { isCurrent: false },
        })

        const year = await tx.academicYear.update({
          where: { id: yearId },
          data: { isCurrent: true },
          include: { terms: { orderBy: { sequence: 'asc' } } },
        })

        await recordAudit(
          tx,
          schoolId,
          audit,
          'ACADEMIC_YEAR_ACTIVATED',
          'AcademicYear',
          year.id,
          { name: year.name },
        )

        return mapYear(year)
      })
    },

    async listAcademicTerms(schoolId, academicYearId) {
      const terms = await getPrismaClient().academicTerm.findMany({
        where: {
          schoolId,
          academicYearId: academicYearId || undefined,
        },
        orderBy: [{ academicYearId: 'asc' }, { sequence: 'asc' }],
      })

      return terms.map(mapTerm)
    },

    async createAcademicTerm(schoolId, academicYearId, input, audit) {
      const prisma = getPrismaClient()

      try {
        return await prisma.$transaction(async (tx) => {
          await findYearOrThrow(tx, schoolId, academicYearId)

          if (input.isCurrent) {
            await tx.academicTerm.updateMany({
              where: { schoolId, isCurrent: true },
              data: { isCurrent: false },
            })
            await tx.academicYear.updateMany({
              where: { schoolId, isCurrent: true },
              data: { isCurrent: false },
            })
            await tx.academicYear.update({
              where: { id: academicYearId },
              data: { isCurrent: true },
            })
          }

          const term = await tx.academicTerm.create({
            data: {
              schoolId,
              academicYearId,
              name: normalizeName(input.name),
              sequence: input.sequence,
              startsOn: parseDate(input.startsOn),
              endsOn: parseDate(input.endsOn),
              isCurrent: input.isCurrent ?? false,
            },
          })

          await recordAudit(
            tx,
            schoolId,
            audit,
            'ACADEMIC_TERM_CREATED',
            'AcademicTerm',
            term.id,
            { name: term.name, academicYearId },
          )

          return mapTerm(term)
        })
      } catch (error) {
        return conflictFromUnique(
          error,
          'A term with this name or sequence already exists in the academic year',
        )
      }
    },

    async updateAcademicTerm(schoolId, termId, input, audit) {
      const prisma = getPrismaClient()

      try {
        return await prisma.$transaction(async (tx) => {
          const existing = await tx.academicTerm.findFirst({
            where: { id: termId, schoolId },
          })

          if (!existing) {
            throw new HttpError(404, 'Academic term not found')
          }

          const term = await tx.academicTerm.update({
            where: { id: termId },
            data: {
              name: input.name === undefined ? undefined : normalizeName(input.name),
              sequence: input.sequence,
              startsOn:
                input.startsOn === undefined
                  ? undefined
                  : parseDate(input.startsOn),
              endsOn:
                input.endsOn === undefined ? undefined : parseDate(input.endsOn),
            },
          })

          await recordAudit(
            tx,
            schoolId,
            audit,
            'ACADEMIC_TERM_UPDATED',
            'AcademicTerm',
            term.id,
            { name: term.name },
          )

          return mapTerm(term)
        })
      } catch (error) {
        return conflictFromUnique(
          error,
          'A term with this name or sequence already exists in the academic year',
        )
      }
    },

    async setCurrentAcademicTerm(schoolId, termId, audit) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        const term = await tx.academicTerm.findFirst({
          where: { id: termId, schoolId },
        })

        if (!term) {
          throw new HttpError(404, 'Academic term not found')
        }

        await tx.academicYear.updateMany({
          where: { schoolId, isCurrent: true },
          data: { isCurrent: false },
        })
        await tx.academicTerm.updateMany({
          where: { schoolId, isCurrent: true },
          data: { isCurrent: false },
        })
        await tx.academicYear.update({
          where: { id: term.academicYearId },
          data: { isCurrent: true },
        })
        const updated = await tx.academicTerm.update({
          where: { id: termId },
          data: { isCurrent: true },
        })

        await recordAudit(
          tx,
          schoolId,
          audit,
          'ACADEMIC_TERM_ACTIVATED',
          'AcademicTerm',
          updated.id,
          { name: updated.name, academicYearId: updated.academicYearId },
        )

        return mapTerm(updated)
      })
    },

    async listClasses(schoolId, options) {
      const classes = await getPrismaClient().schoolClass.findMany({
        where: {
          schoolId,
          ...(options?.includeArchived ? {} : { isArchived: false }),
          ...(options?.accessibleClassIds
            ? { id: { in: options.accessibleClassIds } }
            : {}),
        },
        include: { academicYear: { select: { name: true } } },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      })

      return classes.map(mapClass)
    },

    async createClass(schoolId, input, audit) {
      const prisma = getPrismaClient()

      try {
        return await prisma.$transaction(async (tx) => {
          await findSchoolOrThrow(tx, schoolId)

          if (input.academicYearId) {
            await findYearOrThrow(tx, schoolId, input.academicYearId)
          }

          const duplicate = await tx.schoolClass.findFirst({
            where: {
              schoolId,
              name: { equals: normalizeName(input.name), mode: 'insensitive' },
              academicYearId: input.academicYearId ?? null,
            },
          })

          if (duplicate) {
            throw new HttpError(
              409,
              'A class with this name already exists for that academic year',
            )
          }

          const cls = await tx.schoolClass.create({
            data: {
              schoolId,
              academicYearId: input.academicYearId ?? null,
              name: normalizeName(input.name),
              level: input.level ?? null,
              sortOrder: input.sortOrder ?? 0,
            },
            include: { academicYear: { select: { name: true } } },
          })

          await recordAudit(
            tx,
            schoolId,
            audit,
            'CLASS_CREATED',
            'SchoolClass',
            cls.id,
            { name: cls.name },
          )

          return mapClass(cls)
        })
      } catch (error) {
        return conflictFromUnique(
          error,
          'A class with this name already exists for that academic year',
        )
      }
    },

    async updateClass(schoolId, classId, input, audit) {
      const prisma = getPrismaClient()

      try {
        return await prisma.$transaction(async (tx) => {
          const existing = await findClassOrThrow(tx, schoolId, classId)

          if (input.academicYearId) {
            await findYearOrThrow(tx, schoolId, input.academicYearId)
          }

          const nextName =
            input.name === undefined ? existing.name : normalizeName(input.name)
          const nextYearId =
            input.academicYearId === undefined
              ? existing.academicYearId
              : input.academicYearId ?? null

          if (input.name !== undefined || input.academicYearId !== undefined) {
            const duplicate = await tx.schoolClass.findFirst({
              where: {
                schoolId,
                id: { not: classId },
                name: { equals: nextName, mode: 'insensitive' },
                academicYearId: nextYearId,
              },
            })

            if (duplicate) {
              throw new HttpError(
                409,
                'A class with this name already exists for that academic year',
              )
            }
          }

          const data: Prisma.SchoolClassUpdateInput = {
            name: input.name === undefined ? undefined : nextName,
            level: input.level === undefined ? undefined : input.level,
            sortOrder: input.sortOrder,
            academicYear:
              input.academicYearId === undefined
                ? undefined
                : input.academicYearId
                  ? { connect: { id: input.academicYearId } }
                  : { disconnect: true },
            isArchived: input.isArchived,
            archivedAt:
              input.isArchived === undefined
                ? undefined
                : input.isArchived
                  ? new Date()
                  : null,
          }

          const cls = await tx.schoolClass.update({
            where: { id: classId },
            data,
            include: { academicYear: { select: { name: true } } },
          })

          await recordAudit(
            tx,
            schoolId,
            audit,
            cls.isArchived ? 'CLASS_ARCHIVED' : 'CLASS_UPDATED',
            'SchoolClass',
            cls.id,
            { name: cls.name, isArchived: cls.isArchived },
          )

          return mapClass(cls)
        })
      } catch (error) {
        return conflictFromUnique(
          error,
          'A class with this name already exists for that academic year',
        )
      }
    },

    async seedDefaultClasses(schoolId, audit) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        await findSchoolOrThrow(tx, schoolId)

        for (const item of DEFAULT_CLASSES) {
          const existing = await tx.schoolClass.findFirst({
            where: { schoolId, name: item.name, academicYearId: null },
          })

          if (!existing) {
            await tx.schoolClass.create({
              data: {
                schoolId,
                name: item.name,
                level: item.level,
                sortOrder: item.sortOrder,
              },
            })
          }
        }

        await recordAudit(
          tx,
          schoolId,
          audit,
          'DEFAULT_CLASSES_SEEDED',
          'SchoolClass',
          null,
          { count: DEFAULT_CLASSES.length },
        )

        const classes = await tx.schoolClass.findMany({
          where: { schoolId },
          include: { academicYear: { select: { name: true } } },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        })

        return classes.map(mapClass)
      })
    },

    async registerClassWithTeacher(
      schoolId,
      input: RegisterClassWithTeacherInput,
      audit,
    ): Promise<ClassRegistrationResult> {
      const prisma = getPrismaClient()

      try {
        return await prisma.$transaction(async (tx) => {
          await findSchoolOrThrow(tx, schoolId)

          if (input.academicYearId) {
            await findYearOrThrow(tx, schoolId, input.academicYearId)
          }

          const name = normalizeName(input.className)
          const template = DEFAULT_CLASSES.find(
            (item) => item.name.toLowerCase() === name.toLowerCase(),
          )

          // Serialise concurrent registration for the same class/year.
          await tx.$executeRawUnsafe(
            'SELECT pg_advisory_xact_lock(hashtext($1))',
            `${schoolId}:class:${name.toLowerCase()}:${input.academicYearId ?? 'none'}`,
          )

          const existing = await tx.schoolClass.findFirst({
            where: {
              schoolId,
              academicYearId: input.academicYearId ?? null,
              name: { equals: template?.name ?? name, mode: 'insensitive' },
            },
            include: { academicYear: { select: { name: true } } },
          })

          if (existing?.isArchived) {
            throw new HttpError(
              409,
              'This class is archived and cannot be registered again',
            )
          }

          if (existing) {
            const activeTeacher = await tx.classTeacherAssignment.findFirst({
              where: { schoolId, classId: existing.id, endedAt: null },
            })

            if (activeTeacher) {
              throw new HttpError(
                409,
                'This class already has an active class teacher',
              )
            }
          }

          const cls =
            existing ??
            (await tx.schoolClass.create({
              data: {
                schoolId,
                academicYearId: input.academicYearId ?? null,
                name: template?.name ?? name,
                level: input.level ?? template?.level ?? null,
                sortOrder: input.sortOrder ?? template?.sortOrder ?? 0,
              },
              include: { academicYear: { select: { name: true } } },
            }))

          if (!existing) {
            await recordAudit(
              tx,
              schoolId,
              audit,
              'CLASS_REGISTERED',
              'SchoolClass',
              cls.id,
              { name: cls.name, academicYearId: cls.academicYearId },
            )
          }

          const email = input.teacher.email.trim().toLowerCase()
          const userByEmail = await tx.user.findUnique({ where: { email } })

          if (userByEmail?.isPlatformAdmin) {
            throw new HttpError(
              409,
              'A platform administrator cannot be registered as a class teacher',
              undefined,
              'platform_admin_email',
            )
          }

          let user = userByEmail
          let accountCreated = false

          if (user) {
            // An email belongs to exactly one account. It may be reused only
            // inside the same school, where the administrator is explicitly
            // reassigning a known member. Attaching an account from another
            // school would silently grant cross-tenant access, so it is
            // rejected instead of reusing or updating that account.
            const existingMembership = await tx.schoolMembership.findUnique({
              where: { schoolId_userId: { schoolId, userId: user.id } },
            })

            if (!existingMembership) {
              throw new HttpError(
                409,
                'An account with this email address already exists. Use a different email address, or ask the other school administrator to follow the authorized membership process.',
                [
                  {
                    field: 'teacher.email',
                    message: 'This email is already associated with another account',
                  },
                ],
                'email_in_use',
              )
            }

            if (existingMembership.role !== 'CLASS_TEACHER') {
              throw new HttpError(
                409,
                'This person already has a different role in this school',
                undefined,
                'role_conflict',
              )
            }

            if (existingMembership.status !== 'ACTIVE') {
              throw new HttpError(
                409,
                'This class teacher membership is suspended',
                undefined,
                'teacher_inactive',
              )
            }
          } else {
            const phone = input.teacher.phone?.trim() || null

            if (phone) {
              const phoneOwner = await tx.user.findFirst({
                where: { phone },
                select: { id: true },
              })

              if (phoneOwner) {
                throw new HttpError(
                  409,
                  'This phone number is already registered to another account',
                  [
                    {
                      field: 'phone',
                      message: 'This phone number is already in use',
                    },
                  ],
                  'phone_in_use',
                )
              }
            }

            try {
              user = await tx.user.create({
                data: {
                  email,
                  passwordHash: input.teacher.passwordHash,
                  firstName: normalizeName(input.teacher.firstName),
                  lastName: normalizeName(input.teacher.lastName),
                  phone,
                  isPlatformAdmin: false,
                  // The administrator never chooses this password. The server
                  // generates it and the teacher must replace it at first sign-in.
                  mustChangePassword: true,
                },
              })
              accountCreated = true
            } catch (error) {
              // The database unique index is the final guard for simultaneous
              // registrations. Never reuse the other request's account.
              conflictFromUnique(
                error,
                'An account with this email address already exists',
              )
            }
          }

          if (!user) {
            throw new HttpError(500, 'Could not create the teacher account')
          }

          let membership = await tx.schoolMembership.findUnique({
            where: { schoolId_userId: { schoolId, userId: user.id } },
            include: { user: true },
          })

          if (membership) {
            if (membership.role !== 'CLASS_TEACHER') {
              throw new HttpError(
                409,
                'This person already has a different role in this school',
                undefined,
                'role_conflict',
              )
            }

            if (membership.status !== 'ACTIVE') {
              throw new HttpError(
                409,
                'This class teacher membership is suspended',
                undefined,
                'teacher_inactive',
              )
            }
          } else {
            membership = await tx.schoolMembership.create({
              data: {
                schoolId,
                userId: user.id,
                role: 'CLASS_TEACHER',
                status: 'ACTIVE',
              },
              include: { user: true },
            })

            await recordAudit(
              tx,
              schoolId,
              audit,
              'TEACHER_REGISTERED',
              'SchoolMembership',
              membership.id,
              { email, role: 'CLASS_TEACHER', userId: user.id },
            )
          }

          // A class teacher manages one class at a time. Ending the previous
          // assignment preserves pupils, scores and assignment history.
          const previous = await tx.classTeacherAssignment.findMany({
            where: {
              schoolId,
              membershipId: membership.id,
              endedAt: null,
              NOT: { classId: cls.id },
            },
          })

          for (const assignment of previous) {
            await tx.classTeacherAssignment.update({
              where: { id: assignment.id },
              data: { endedAt: new Date() },
            })

            await recordAudit(
              tx,
              schoolId,
              audit,
              'CLASS_TEACHER_REASSIGNED',
              'ClassTeacherAssignment',
              assignment.id,
              {
                membershipId: membership.id,
                fromClassId: assignment.classId,
                toClassId: cls.id,
              },
            )
          }

          const assignment = await tx.classTeacherAssignment.upsert({
            where: {
              classId_membershipId: {
                classId: cls.id,
                membershipId: membership.id,
              },
            },
            create: { schoolId, classId: cls.id, membershipId: membership.id },
            update: { endedAt: null },
            include: {
              class: { select: { name: true } },
              membership: { include: { user: true } },
            },
          })

          await recordAudit(
            tx,
            schoolId,
            audit,
            'CLASS_TEACHER_ASSIGNED',
            'ClassTeacherAssignment',
            assignment.id,
            { classId: cls.id, membershipId: membership.id, className: cls.name },
          )

          return {
            class: mapClass(cls),
            teacher: mapTeacher(membership),
            assignment: mapClassTeacherAssignment(assignment),
            accountCreated,
          }
        })
      } catch (error) {
        conflictFromUnique(
          error,
          'This class or teacher already exists. Refresh and try again.',
        )
      }
    },

    async listClassSubjects(schoolId, classId) {
      const prisma = getPrismaClient()
      await findClassOrThrow(prisma, schoolId, classId)

      const items = await prisma.classSubject.findMany({
        where: { schoolId, classId },
        include: { subject: { select: { name: true, code: true } } },
        orderBy: [{ sortOrder: 'asc' }, { subject: { name: 'asc' } }],
      })

      return items.map(mapClassSubject)
    },

    async getClassTeacherDashboard(schoolId, membershipId) {
      const prisma = getPrismaClient()

      // Resolve the class from the authenticated membership only. A request
      // parameter can never widen this query.
      const assignments = await prisma.classTeacherAssignment.findMany({
        where: {
          schoolId,
          membershipId,
          endedAt: null,
          class: { isArchived: false },
        },
        include: {
          class: {
            include: {
              academicYear: { select: { name: true } },
              subjects: {
                where: { isActive: true, subject: { isArchived: false } },
                include: {
                  subject: { select: { name: true, code: true } },
                },
                orderBy: [
                  { sortOrder: 'asc' },
                  { subject: { name: 'asc' } },
                ],
              },
            },
          },
        },
        orderBy: [{ createdAt: 'asc' }],
      })

      if (assignments.length === 0) {
        return []
      }

      const classIds = assignments.map((assignment) => assignment.classId)

      const subjectTeacherAssignments =
        await prisma.subjectTeacherAssignment.findMany({
          where: {
            schoolId,
            classId: { in: classIds },
            endedAt: null,
          },
          select: {
            classId: true,
            subjectId: true,
            firstName: true,
            lastName: true,
            membership: { include: { user: true } },
          },
        })

      const subjectTeacherByPair = new Map(
        subjectTeacherAssignments.map((assignment) => [
          `${assignment.classId}:${assignment.subjectId}`,
          assignment.membership
            ? `${assignment.membership.user.firstName} ${assignment.membership.user.lastName}`.trim()
            : `${assignment.firstName} ${assignment.lastName}`.trim(),
        ]),
      )

      // "On roll" means an ACTIVE pupil whose current class is this class and
      // whose active enrollment is also in this class. Withdrawn, transferred,
      // inactive and archived pupils therefore never contribute.
      const pupilCounts = await Promise.all(
        classIds.map((classId) =>
          prisma.pupil.count({
            where: {
              schoolId,
              currentClassId: classId,
              status: 'ACTIVE',
              enrollments: {
                some: { classId, status: 'ACTIVE' },
              },
            },
          }),
        ),
      )

      return assignments.map((assignment, index) => ({
        classId: assignment.classId,
        className: assignment.class.name,
        level: assignment.class.level,
        academicYearId: assignment.class.academicYearId,
        academicYearName: assignment.class.academicYear?.name ?? null,
        isArchived: assignment.class.isArchived,
        pupilsOnRoll: pupilCounts[index] ?? 0,
        subjects: assignment.class.subjects.map((item) => {
          const subjectTeacherName =
            subjectTeacherByPair.get(
              `${item.classId}:${item.subjectId}`,
            ) ?? null

          return {
            id: item.id,
            schoolId: item.schoolId,
            classId: item.classId,
            subjectId: item.subjectId,
            subjectName: item.subject.name,
            subjectCode: item.subject.code,
            isActive: item.isActive,
            sortOrder: item.sortOrder,
            subjectTeacherName,
            readOnly: Boolean(subjectTeacherName),
            canEnterScores: !subjectTeacherName,
          }
        }),
      }))
    },

    async getSubjectSessionDashboard(schoolId, assignmentId) {
      const prisma = getPrismaClient()

      // Resolve the class and subject from the assignment only. Neither the
      // URL nor the request body can widen this query.
      const assignment = await prisma.subjectTeacherAssignment.findFirst({
        where: {
          id: assignmentId,
          schoolId,
          endedAt: null,
          class: { isArchived: false },
          subject: { isArchived: false },
        },
        include: {
          membership: { include: { user: true } },
          class: {
            include: {
              academicYear: { select: { name: true } },
              subjects: {
                where: {
                  isActive: true,
                  subject: { isArchived: false },
                },
                include: {
                  subject: { select: { name: true, code: true } },
                },
                orderBy: [
                  { sortOrder: 'asc' },
                  { subject: { name: 'asc' } },
                ],
              },
            },
          },
        },
      })

      if (!assignment) {
        return []
      }

      const classSubject = await prisma.classSubject.findUnique({
        where: {
          classId_subjectId: {
            classId: assignment.classId,
            subjectId: assignment.subjectId,
          },
        },
      })

      if (!classSubject || !classSubject.isActive) {
        return []
      }

      const pupilsOnRoll = await prisma.pupil.count({
        where: {
          schoolId,
          currentClassId: assignment.classId,
          status: 'ACTIVE',
          enrollments: {
            some: { classId: assignment.classId, status: 'ACTIVE' },
          },
        },
      })

      const teacherName = assignment.membership
        ? `${assignment.membership.user.firstName} ${assignment.membership.user.lastName}`.trim()
        : `${assignment.firstName} ${assignment.lastName}`.trim()

      // Only the assigned subject is exposed to the restricted session.
      const subjects = assignment.class.subjects
        .filter((item) => item.subjectId === assignment.subjectId)
        .map((item) => ({
          ...mapClassSubject(item),
          subjectTeacherName: teacherName || null,
          readOnly: false,
          canEnterScores: true,
        }))

      return [
        {
          classId: assignment.classId,
          className: assignment.class.name,
          level: assignment.class.level,
          academicYearId: assignment.class.academicYearId,
          academicYearName: assignment.class.academicYear?.name ?? null,
          isArchived: assignment.class.isArchived,
          pupilsOnRoll,
          subjects,
        },
      ]
    },

    async listSubjectSessionClassSubjects(schoolId, assignmentId) {
      const prisma = getPrismaClient()
      const assignment = await prisma.subjectTeacherAssignment.findFirst({
        where: { id: assignmentId, schoolId, endedAt: null },
        select: { classId: true, subjectId: true },
      })

      if (!assignment) {
        return []
      }

      const item = await prisma.classSubject.findUnique({
        where: {
          classId_subjectId: {
            classId: assignment.classId,
            subjectId: assignment.subjectId,
          },
        },
        include: { subject: { select: { name: true, code: true } } },
      })

      if (!item || !item.isActive || item.schoolId !== schoolId) {
        return []
      }

      return [mapClassSubject(item)]
    },

    async listSubjectSessionAssignments(schoolId, assignmentId) {
      const assignment = await getPrismaClient().subjectTeacherAssignment.findFirst(
        {
          where: { id: assignmentId, schoolId, endedAt: null },
          include: {
            class: { select: { name: true } },
            subject: { select: { name: true } },
            membership: { include: { user: true } },
          },
        },
      )

      return assignment ? [mapSubjectTeacherAssignment(assignment)] : []
    },

    async listClassSubjectCounts(schoolId): Promise<ClassSubjectCountRecord[]> {
      const classes = await getPrismaClient().schoolClass.findMany({
        where: { schoolId },
        include: {
          classTeacherAssignments: {
            where: { endedAt: null },
            include: { membership: { include: { user: true } } },
            take: 1,
          },
          subjects: {
            where: { isActive: true, subject: { isArchived: false } },
            select: { id: true },
          },
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      })

      return classes.map((cls) => {
        const assignment = cls.classTeacherAssignments[0]

        return {
          classId: cls.id,
          className: cls.name,
          level: cls.level,
          classTeacherName: assignment
            ? `${assignment.membership.user.firstName} ${assignment.membership.user.lastName}`.trim()
            : null,
          subjectCount: cls.subjects.length,
          isArchived: cls.isArchived,
        }
      })
    },

    async assignSubjectToClass(schoolId, classId, input, audit) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        const cls = await findClassOrThrow(tx, schoolId, classId)
        const subject = await findOrCreateSubjectForClass(
          tx,
          schoolId,
          input,
          audit,
        )
        const item = await upsertClassSubject(
          tx,
          schoolId,
          cls.id,
          subject.id,
          audit,
        )

        if (input.subjectTeacherMembershipId) {
          await upsertSubjectTeacherAssignment(tx, {
            schoolId,
            classId: cls.id,
            subjectId: subject.id,
            membershipId: input.subjectTeacherMembershipId,
            audit,
          })
        }

        return mapClassSubject(item)
      })
    },

    async registerClassSubjectWithTeacher(schoolId, classId, input, audit) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        const cls = await findClassOrThrow(tx, schoolId, classId)
        const subject = await findOrCreateSubjectForClass(
          tx,
          schoolId,
          input,
          audit,
        )
        const item = await upsertClassSubject(
          tx,
          schoolId,
          cls.id,
          subject.id,
          audit,
        )

        let subjectTeacherAssignment: SubjectTeacherAssignmentRecord | null = null
        let invitation: IssuedSubjectTeacherInvitation | null = null

        if (input.subjectTeacherMembershipId) {
          const result = await assignSubjectTeacherForClassSubject(tx, {
            schoolId,
            classId: cls.id,
            subjectId: subject.id,
            input: { membershipId: input.subjectTeacherMembershipId },
            createdByMembershipId: audit.actorMembershipId ?? null,
            audit,
          })
          subjectTeacherAssignment = result.assignment
          invitation = result.invitation
        } else if (input.subjectTeacher) {
          const result = await assignSubjectTeacherForClassSubject(tx, {
            schoolId,
            classId: cls.id,
            subjectId: subject.id,
            input: { teacher: input.subjectTeacher },
            createdByMembershipId: audit.actorMembershipId ?? null,
            audit,
          })
          subjectTeacherAssignment = result.assignment
          invitation = result.invitation
        }

        return {
          assignment: mapClassSubject(item),
          subjectTeacherAssignment,
          invitation,
        }
      })
    },

    async removeSubjectFromClass(schoolId, classId, subjectId, audit) {
      const prisma = getPrismaClient()

      await prisma.$transaction(async (tx) => {
        const item = await tx.classSubject.findUnique({
          where: { classId_subjectId: { classId, subjectId } },
        })

        if (!item || item.schoolId !== schoolId || !item.isActive) {
          throw new HttpError(404, 'Active class subject assignment not found')
        }

        await tx.classSubject.update({
          where: { id: item.id },
          data: { isActive: false },
        })

        await recordAudit(
          tx,
          schoolId,
          audit,
          'CLASS_SUBJECT_REMOVED',
          'ClassSubject',
          item.id,
          { classId, subjectId },
        )
      })
    },

    async updateClassSubject(schoolId, classId, subjectId, input, audit) {
      const prisma = getPrismaClient()

      try {
        return await prisma.$transaction(async (tx) => {
          await findClassOrThrow(tx, schoolId, classId)

          const association = await tx.classSubject.findUnique({
            where: { classId_subjectId: { classId, subjectId } },
          })

          if (
            !association ||
            association.schoolId !== schoolId ||
            !association.isActive
          ) {
            throw new HttpError(
              404,
              'Subject is not offered by this class',
            )
          }

          const existing = await findSubjectOrThrow(tx, schoolId, subjectId)
          const subject = await tx.subject.update({
            where: { id: subjectId },
            data: {
              name:
                input.name === undefined ? undefined : normalizeName(input.name),
              code:
                input.code === undefined ? undefined : input.code?.trim() || null,
              isArchived: input.isArchived,
              archivedAt:
                input.isArchived === undefined
                  ? undefined
                  : input.isArchived
                    ? new Date()
                    : null,
            },
          })

          await recordAudit(
            tx,
            schoolId,
            audit,
            subject.isArchived ? 'SUBJECT_ARCHIVED' : 'SUBJECT_UPDATED',
            'Subject',
            subject.id,
            {
              classId,
              name: subject.name,
              previousName: existing.name,
            },
          )

          return mapSubject(subject)
        })
      } catch (error) {
        return conflictFromUnique(
          error,
          'A subject with this name already exists in this school',
        )
      }
    },

    async listPupils(filter) {
      const prisma = getPrismaClient()
      const conditions: Prisma.PupilWhereInput[] = [
        { schoolId: filter.schoolId },
        filter.status
          ? { status: filter.status }
          : { status: { not: 'ARCHIVED' } },
      ]

      if (filter.classId) {
        conditions.push({
          OR: [
            { currentClassId: filter.classId },
            {
              enrollments: {
                some: { classId: filter.classId, status: 'ACTIVE' },
              },
            },
          ],
        })
      }

      if (filter.academicYearId) {
        conditions.push({
          enrollments: {
            some: {
              academicYearId: filter.academicYearId,
              status: 'ACTIVE',
            },
          },
        })
      }

      if (filter.accessibleClassIds) {
        conditions.push({
          currentClassId: { in: filter.accessibleClassIds },
        })
      }

      if (filter.query) {
        conditions.push({
          OR: [
            {
              firstName: {
                contains: filter.query,
                mode: 'insensitive',
              },
            },
            {
              lastName: {
                contains: filter.query,
                mode: 'insensitive',
              },
            },
            {
              admissionNumber: {
                contains: filter.query,
                mode: 'insensitive',
              },
            },
          ],
        })
      }

      const where: Prisma.PupilWhereInput = { AND: conditions }

      const [total, pupils] = await Promise.all([
        prisma.pupil.count({ where }),
        prisma.pupil.findMany({
          where,
          include: { currentClass: { select: { name: true } } },
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
          skip: (filter.page - 1) * filter.pageSize,
          take: filter.pageSize,
        }),
      ])

      return { items: pupils.map(mapPupil), total }
    },

    async getPupil(schoolId, pupilId) {
      const pupil = await getPrismaClient().pupil.findFirst({
        where: { id: pupilId, schoolId },
        include: {
          currentClass: { select: { name: true } },
          enrollments: {
            include: {
              class: { select: { name: true } },
              academicYear: { select: { name: true } },
            },
            orderBy: [{ startedOn: 'desc' }, { createdAt: 'desc' }],
          },
        },
      })

      if (!pupil) {
        return null
      }

      return {
        ...mapPupil(pupil),
        enrollments: pupil.enrollments.map(mapEnrollment),
      }
    },

    async createPupil(schoolId, input, audit) {
      const prisma = getPrismaClient()

      try {
        return await prisma.$transaction(async (tx) => {
          await findSchoolOrThrow(tx, schoolId)

          if (Boolean(input.classId) !== Boolean(input.academicYearId)) {
            throw new HttpError(
              400,
              'Class and academic year must be supplied together',
            )
          }

          if (input.classId) {
            await findClassOrThrow(tx, schoolId, input.classId)
            await findYearOrThrow(tx, schoolId, input.academicYearId!)
          }

          const pupil = await tx.pupil.create({
            data: {
              schoolId,
              firstName: normalizeName(input.firstName),
              lastName: normalizeName(input.lastName),
              otherNames: input.otherNames ?? null,
              admissionNumber: normalizeAdmissionNumber(input.admissionNumber),
              gender: input.gender ?? null,
              dateOfBirth: input.dateOfBirth
                ? parseDate(input.dateOfBirth)
                : null,
              currentClassId: input.classId ?? null,
            },
          })

          if (input.classId && input.academicYearId) {
            await tx.pupilEnrollment.create({
              data: {
                schoolId,
                pupilId: pupil.id,
                classId: input.classId,
                academicYearId: input.academicYearId,
                startedOn: parseDate(
                  input.startedOn ?? new Date().toISOString().slice(0, 10),
                ),
              },
            })
          }

          await recordAudit(
            tx,
            schoolId,
            audit,
            'PUPIL_CREATED',
            'Pupil',
            pupil.id,
            {
              admissionNumber: pupil.admissionNumber,
              classId: input.classId ?? null,
            },
          )

          const created = await tx.pupil.findUniqueOrThrow({
            where: { id: pupil.id },
            include: {
              currentClass: { select: { name: true } },
              enrollments: {
                include: {
                  class: { select: { name: true } },
                  academicYear: { select: { name: true } },
                },
                orderBy: [{ startedOn: 'desc' }, { createdAt: 'desc' }],
              },
            },
          })

          return {
            ...mapPupil(created),
            enrollments: created.enrollments.map(mapEnrollment),
          }
        })
      } catch (error) {
        return conflictFromUnique(
          error,
          'A pupil with this admission number already exists in this school',
        )
      }
    },

    async updatePupil(schoolId, pupilId, input, audit) {
      const prisma = getPrismaClient()

      try {
        return await prisma.$transaction(async (tx) => {
          const existing = await tx.pupil.findFirst({
            where: { id: pupilId, schoolId },
          })

          if (!existing) {
            throw new HttpError(404, 'Pupil not found')
          }

          await tx.pupil.update({
            where: { id: pupilId },
            data: {
              firstName:
                input.firstName === undefined
                  ? undefined
                  : normalizeName(input.firstName),
              lastName:
                input.lastName === undefined
                  ? undefined
                  : normalizeName(input.lastName),
              otherNames:
                input.otherNames === undefined ? undefined : input.otherNames,
              admissionNumber:
                input.admissionNumber === undefined
                  ? undefined
                  : normalizeAdmissionNumber(input.admissionNumber),
              gender: input.gender === undefined ? undefined : input.gender,
              dateOfBirth:
                input.dateOfBirth === undefined
                  ? undefined
                  : input.dateOfBirth
                    ? parseDate(input.dateOfBirth)
                    : null,
              status: input.status,
            },
          })

          await recordAudit(
            tx,
            schoolId,
            audit,
            'PUPIL_UPDATED',
            'Pupil',
            pupilId,
            { admissionNumber: existing.admissionNumber },
          )

          const updated = await tx.pupil.findUniqueOrThrow({
            where: { id: pupilId },
            include: {
              currentClass: { select: { name: true } },
              enrollments: {
                include: {
                  class: { select: { name: true } },
                  academicYear: { select: { name: true } },
                },
                orderBy: [{ startedOn: 'desc' }, { createdAt: 'desc' }],
              },
            },
          })

          return {
            ...mapPupil(updated),
            enrollments: updated.enrollments.map(mapEnrollment),
          }
        })
      } catch (error) {
        return conflictFromUnique(
          error,
          'A pupil with this admission number already exists in this school',
        )
      }
    },

    async movePupil(schoolId, pupilId, input: MovePupilInput, audit) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        const pupil = await tx.pupil.findFirst({
          where: { id: pupilId, schoolId },
        })

        if (!pupil) {
          throw new HttpError(404, 'Pupil not found')
        }

        if (pupil.status === 'ARCHIVED') {
          throw new HttpError(409, 'Archived pupils cannot be enrolled')
        }

        await findClassOrThrow(tx, schoolId, input.classId)
        await findYearOrThrow(tx, schoolId, input.academicYearId)

        const startedOn = parseDate(
          input.startedOn ?? new Date().toISOString().slice(0, 10),
        )

        await tx.pupilEnrollment.updateMany({
          where: { schoolId, pupilId, status: 'ACTIVE' },
          data: { status: 'COMPLETED', endedOn: startedOn },
        })

        await tx.pupilEnrollment.create({
          data: {
            schoolId,
            pupilId,
            classId: input.classId,
            academicYearId: input.academicYearId,
            startedOn,
          },
        })

        await tx.pupil.update({
          where: { id: pupilId },
          data: { currentClassId: input.classId, status: 'ACTIVE' },
        })

        await recordAudit(
          tx,
          schoolId,
          audit,
          'PUPIL_ENROLLED',
          'Pupil',
          pupilId,
          {
            admissionNumber: pupil.admissionNumber,
            classId: input.classId,
            academicYearId: input.academicYearId,
            previousClassId: pupil.currentClassId,
          },
        )

        const updated = await tx.pupil.findUniqueOrThrow({
          where: { id: pupilId },
          include: {
            currentClass: { select: { name: true } },
            enrollments: {
              include: {
                class: { select: { name: true } },
                academicYear: { select: { name: true } },
              },
              orderBy: [{ startedOn: 'desc' }, { createdAt: 'desc' }],
            },
          },
        })

        return {
          ...mapPupil(updated),
          enrollments: updated.enrollments.map(mapEnrollment),
        }
      })
    },

    async archivePupil(schoolId, pupilId, audit) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        const pupil = await tx.pupil.findFirst({
          where: { id: pupilId, schoolId },
        })

        if (!pupil) {
          throw new HttpError(404, 'Pupil not found')
        }

        const endedOn = parseDate(new Date().toISOString().slice(0, 10))

        await tx.pupil.update({
          where: { id: pupilId },
          data: { status: 'ARCHIVED', currentClassId: null },
        })

        await tx.pupilEnrollment.updateMany({
          where: { schoolId, pupilId, status: 'ACTIVE' },
          data: { status: 'WITHDRAWN', endedOn },
        })

        await recordAudit(
          tx,
          schoolId,
          audit,
          'PUPIL_ARCHIVED',
          'Pupil',
          pupilId,
          { admissionNumber: pupil.admissionNumber },
        )

        const updated = await tx.pupil.findUniqueOrThrow({
          where: { id: pupilId },
          include: {
            currentClass: { select: { name: true } },
            enrollments: {
              include: {
                class: { select: { name: true } },
                academicYear: { select: { name: true } },
              },
              orderBy: [{ startedOn: 'desc' }, { createdAt: 'desc' }],
            },
          },
        })

        return {
          ...mapPupil(updated),
          enrollments: updated.enrollments.map(mapEnrollment),
        }
      })
    },

    async getPupilPhoto(schoolId, pupilId) {
      const pupil = await getPrismaClient().pupil.findFirst({
        where: { id: pupilId, schoolId },
        select: {
          photoReference: true,
          photoMimeType: true,
          photoChecksum: true,
          photoUpdatedAt: true,
        },
      })

      if (
        !pupil?.photoReference ||
        !pupil.photoMimeType ||
        !pupil.photoChecksum ||
        !pupil.photoUpdatedAt
      ) {
        return null
      }

      return {
        storageKey: pupil.photoReference,
        mimeType: pupil.photoMimeType,
        checksum: pupil.photoChecksum,
        updatedAt: pupil.photoUpdatedAt,
      }
    },

    async updatePupilPhoto(schoolId, pupilId, input, audit) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        const existing = await tx.pupil.findFirst({
          where: { id: pupilId, schoolId },
        })

        if (!existing) {
          throw new HttpError(404, 'Pupil not found')
        }

        await tx.pupil.update({
          where: { id: pupilId },
          data: {
            photoReference: input.storageKey,
            photoMimeType: input.mimeType,
            photoChecksum: input.checksum,
            photoUpdatedAt: input.updatedAt,
          },
        })

        await recordAudit(
          tx,
          schoolId,
          audit,
          'PUPIL_PHOTO_UPDATED',
          'Pupil',
          pupilId,
          { admissionNumber: existing.admissionNumber },
        )

        const updated = await tx.pupil.findUniqueOrThrow({
          where: { id: pupilId },
          include: {
            currentClass: { select: { name: true } },
            enrollments: {
              include: {
                class: { select: { name: true } },
                academicYear: { select: { name: true } },
              },
              orderBy: [{ startedOn: 'desc' }, { createdAt: 'desc' }],
            },
          },
        })

        return {
          ...mapPupil(updated),
          enrollments: updated.enrollments.map(mapEnrollment),
        }
      })
    },

    async removePupilPhoto(schoolId, pupilId, audit) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        const existing = await tx.pupil.findFirst({
          where: { id: pupilId, schoolId },
        })

        if (!existing) {
          throw new HttpError(404, 'Pupil not found')
        }

        await tx.pupil.update({
          where: { id: pupilId },
          data: {
            photoReference: null,
            photoMimeType: null,
            photoChecksum: null,
            photoUpdatedAt: null,
          },
        })

        await recordAudit(
          tx,
          schoolId,
          audit,
          'PUPIL_PHOTO_REMOVED',
          'Pupil',
          pupilId,
          { admissionNumber: existing.admissionNumber },
        )

        const updated = await tx.pupil.findUniqueOrThrow({
          where: { id: pupilId },
          include: {
            currentClass: { select: { name: true } },
            enrollments: {
              include: {
                class: { select: { name: true } },
                academicYear: { select: { name: true } },
              },
              orderBy: [{ startedOn: 'desc' }, { createdAt: 'desc' }],
            },
          },
        })

        return {
          ...mapPupil(updated),
          enrollments: updated.enrollments.map(mapEnrollment),
        }
      })
    },

    async listSubjects(schoolId, options) {
      const subjects = await getPrismaClient().subject.findMany({
        where: {
          schoolId,
          ...(options?.includeArchived ? {} : { isArchived: false }),
        },
        orderBy: { name: 'asc' },
      })

      return subjects.map(mapSubject)
    },

    async createSubject(schoolId, input, audit) {
      const prisma = getPrismaClient()

      try {
        return await prisma.$transaction(async (tx) => {
          await findSchoolOrThrow(tx, schoolId)

          const subject = await tx.subject.create({
            data: {
              schoolId,
              name: normalizeName(input.name),
              code: input.code?.trim() || null,
            },
          })

          await recordAudit(
            tx,
            schoolId,
            audit,
            'SUBJECT_CREATED',
            'Subject',
            subject.id,
            { name: subject.name },
          )

          return mapSubject(subject)
        })
      } catch (error) {
        return conflictFromUnique(
          error,
          'A subject with this name already exists in this school',
        )
      }
    },

    async updateSubject(schoolId, subjectId, input, audit) {
      const prisma = getPrismaClient()

      try {
        return await prisma.$transaction(async (tx) => {
          const existing = await findSubjectOrThrow(tx, schoolId, subjectId)

          const subject = await tx.subject.update({
            where: { id: subjectId },
            data: {
              name: input.name === undefined ? undefined : normalizeName(input.name),
              code:
                input.code === undefined ? undefined : input.code?.trim() || null,
              isArchived: input.isArchived,
              archivedAt:
                input.isArchived === undefined
                  ? undefined
                  : input.isArchived
                    ? new Date()
                    : null,
            },
          })

          await recordAudit(
            tx,
            schoolId,
            audit,
            subject.isArchived ? 'SUBJECT_ARCHIVED' : 'SUBJECT_UPDATED',
            'Subject',
            subject.id,
            { name: subject.name, previousName: existing.name },
          )

          return mapSubject(subject)
        })
      } catch (error) {
        return conflictFromUnique(
          error,
          'A subject with this name already exists in this school',
        )
      }
    },

    async listTeachers(schoolId) {
      const memberships = await getPrismaClient().schoolMembership.findMany({
        where: {
          schoolId,
          role: { in: ['CLASS_TEACHER', 'SUBJECT_TEACHER'] },
        },
        include: { user: true },
        orderBy: [{ joinedAt: 'asc' }],
      })

      return memberships.map(mapTeacher)
    },

    async listSubjectTeacherCandidates(schoolId) {
      const memberships = await getPrismaClient().schoolMembership.findMany({
        where: {
          schoolId,
          role: 'SUBJECT_TEACHER',
          status: 'ACTIVE',
        },
        include: { user: true },
        orderBy: [{ user: { firstName: 'asc' } }, { user: { lastName: 'asc' } }],
      })

      return memberships.map(mapTeacher)
    },

    async registerTeacher(
      schoolId,
      input: RegisterTeacherInput,
      audit,
    ): Promise<RegisterTeacherResult> {
      const prisma = getPrismaClient()

      try {
        return await prisma.$transaction(async (tx) => {
          await findSchoolOrThrow(tx, schoolId)

          const email = input.email.trim().toLowerCase()
          const existingUser = await tx.user.findUnique({ where: { email } })

          if (existingUser?.isPlatformAdmin) {
            throw new HttpError(
              409,
              'A platform administrator cannot be registered as a teacher',
              undefined,
              'platform_admin_email',
            )
          }

          // An email identifies exactly one global account. A teacher account
          // that already belongs to another school must never be silently
          // attached to this tenant, and it must never receive a second
          // generated password or a successful onboarding response.
          if (existingUser) {
            const existingMembership = await tx.schoolMembership.findUnique({
              where: {
                schoolId_userId: { schoolId, userId: existingUser.id },
              },
            })

            if (existingMembership) {
              throw new HttpError(
                409,
                'This person is already a member of this school; manage their assignment instead',
                undefined,
                'already_school_member',
              )
            }

            throw new HttpError(
              409,
              'An account with this email address already exists. Use a different email address, or ask the other school administrator to follow the authorized membership process.',
              [
                {
                  field: 'email',
                  message: 'This email is already associated with another account',
                },
              ],
              'email_in_use',
            )
          }

          const phone = input.phone?.trim() || null

          if (phone) {
            const phoneOwner = await tx.user.findFirst({
              where: { phone },
              select: { id: true },
            })

            if (phoneOwner) {
              throw new HttpError(
                409,
                'This phone number is already registered to another account',
                [{ field: 'phone', message: 'This phone number is already in use' }],
                'phone_in_use',
              )
            }
          }

          let accountCreated = false
          let user!: Awaited<ReturnType<typeof tx.user.create>>

          try {
            user = await tx.user.create({
              data: {
                email,
                passwordHash: input.passwordHash,
                firstName: normalizeName(input.firstName),
                lastName: normalizeName(input.lastName),
                phone,
                // Teacher creation can never grant platform administration.
                isPlatformAdmin: false,
                // A server-generated password is temporary for class teachers
                // and must be replaced before the account is usable.
                mustChangePassword: input.role === 'CLASS_TEACHER',
              },
            })
            accountCreated = true
          } catch (error) {
            // The database unique index is the final guard for simultaneous
            // registrations. Never reuse the other request's account.
            conflictFromUnique(
              error,
              'An account with this email address already exists',
            )
          }

          const membership = await tx.schoolMembership.create({
            data: {
              schoolId,
              userId: user.id,
              role: input.role,
              status: 'ACTIVE',
            },
            include: { user: true },
          })

          await recordAudit(
            tx,
            schoolId,
            audit,
            'TEACHER_REGISTERED',
            'SchoolMembership',
            membership.id,
            {
              email,
              role: input.role,
              userId: user.id,
              accountCreated,
            },
          )

          if (input.role === 'CLASS_TEACHER') {
            await assignRegisteredClassTeacher(tx, {
              schoolId,
              membershipId: membership.id,
              input,
              audit,
            })
          }

          return {
            teacher: mapTeacher(membership),
            accountCreated,
          }
        })
      } catch (error) {
        return conflictFromUnique(
          error,
          'This teacher already exists. Refresh and try again.',
        )
      }
    },

    async resetTeacherTemporaryPassword(
      schoolId,
      membershipId,
      passwordHash,
      audit,
    ) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        await findSchoolOrThrow(tx, schoolId)

        const membership = await tx.schoolMembership.findFirst({
          where: { id: membershipId, schoolId },
          include: { user: true },
        })

        if (!membership) {
          throw new HttpError(404, 'Class teacher not found')
        }

        if (membership.role !== 'CLASS_TEACHER') {
          throw new HttpError(
            409,
            'Only a class teacher account can receive replacement credentials',
          )
        }

        if (membership.status !== 'ACTIVE' || !membership.user.isActive) {
          throw new HttpError(
            409,
            'This teacher account is not active. Restore access before reissuing credentials.',
          )
        }

        const now = new Date()

        await tx.user.update({
          where: { id: membership.userId },
          data: {
            passwordHash,
            mustChangePassword: true,
            passwordChangedAt: null,
          },
        })

        // A new temporary password invalidates every existing session, so a
        // teacher who already signed in with the previous value is signed out.
        await tx.session.updateMany({
          where: { userId: membership.userId, revokedAt: null },
          data: { revokedAt: now },
        })

        await recordAudit(
          tx,
          schoolId,
          audit,
          'TEACHER_CREDENTIALS_REISSUED',
          'SchoolMembership',
          membership.id,
          { email: membership.user.email, userId: membership.userId },
        )

        return mapTeacher(membership)
      })
    },

    async updateTeacher(
      schoolId,
      membershipId: string,
      input: UpdateTeacherInput,
      audit,
    ): Promise<TeacherRecord> {
      const prisma = getPrismaClient()

      try {
        return await prisma.$transaction(async (tx) => {
          const membership = await tx.schoolMembership.findFirst({
            where: { id: membershipId, schoolId },
            include: { user: true },
          })

          if (!membership) {
            throw new HttpError(404, 'Teacher not found', undefined, 'teacher_not_found')
          }

          if (membership.user.isPlatformAdmin) {
            throw new HttpError(
              403,
              'Platform administrator accounts cannot be managed as school teachers',
              undefined,
              'platform_admin_target',
            )
          }

          if (
            membership.role !== 'CLASS_TEACHER' &&
            membership.role !== 'SUBJECT_TEACHER'
          ) {
            throw new HttpError(404, 'Teacher not found', undefined, 'teacher_not_found')
          }

          if (membership.status !== 'ACTIVE') {
            throw new HttpError(
              409,
              'Only an active teacher membership can be edited. Restore access first.',
              undefined,
              'teacher_inactive',
            )
          }

          // Defence in depth: the request schema already rejects an `email`
          // field, but a direct repository caller must not be able to change a
          // globally shared sign-in identity either. A school administrator
          // never owns the account of someone who may belong to another school.
          if ((input as { email?: unknown }).email !== undefined) {
            throw new HttpError(
              403,
              'School administrators cannot change a teacher’s email address. Contact the platform administrator.',
              [
                {
                  field: 'email',
                  message: 'Email addresses are managed by the platform administrator',
                },
              ],
              'email_change_forbidden',
            )
          }

          const nextPhone =
            input.phone === undefined
              ? membership.user.phone
              : input.phone?.trim() || null

          if (nextPhone && nextPhone !== membership.user.phone) {
            const phoneOwner = await tx.user.findFirst({
              where: {
                phone: nextPhone,
                NOT: { id: membership.userId },
              },
              select: { id: true },
            })

            if (phoneOwner) {
              throw new HttpError(
                409,
                'This phone number is already registered to another account',
                [{ field: 'phone', message: 'This phone number is already in use' }],
                'phone_in_use',
              )
            }
          }

          if (input.classId !== undefined) {
            if (membership.role !== 'CLASS_TEACHER') {
              throw new HttpError(
                409,
                'Only a class teacher can be assigned to a class',
                undefined,
                'role_mismatch',
              )
            }

            const cls = await tx.schoolClass.findFirst({
              where: { id: input.classId, schoolId },
            })

            if (!cls) {
              throw new HttpError(
                400,
                'The selected class does not belong to this school',
                undefined,
                'class_not_found',
              )
            }

            if (cls.isArchived) {
              throw new HttpError(
                409,
                'Archived classes cannot receive a class teacher',
                undefined,
                'class_archived',
              )
            }

            const active = await tx.classTeacherAssignment.findFirst({
              where: { schoolId, classId: cls.id, endedAt: null },
            })

            if (active && active.membershipId !== membershipId) {
              throw new HttpError(
                409,
                'This class already has an active class teacher. Revoke or reassign the existing assignment first.',
                undefined,
                'class_teacher_conflict',
              )
            }

            const previous = await tx.classTeacherAssignment.findMany({
              where: {
                schoolId,
                membershipId,
                endedAt: null,
                NOT: { classId: cls.id },
              },
            })

            for (const assignment of previous) {
              await tx.classTeacherAssignment.update({
                where: { id: assignment.id },
                data: { endedAt: new Date() },
              })

              await recordAudit(
                tx,
                schoolId,
                audit,
                'CLASS_TEACHER_REASSIGNED',
                'ClassTeacherAssignment',
                assignment.id,
                {
                  membershipId,
                  fromClassId: assignment.classId,
                  toClassId: cls.id,
                },
              )
            }

            const assignment = await tx.classTeacherAssignment.upsert({
              where: {
                classId_membershipId: { classId: cls.id, membershipId },
              },
              create: { schoolId, classId: cls.id, membershipId },
              update: { endedAt: null },
            })

            await recordAudit(
              tx,
              schoolId,
              audit,
              'CLASS_TEACHER_ASSIGNED',
              'ClassTeacherAssignment',
              assignment.id,
              { classId: cls.id, membershipId, className: cls.name },
            )
          }

          const user = await tx.user.update({
            where: { id: membership.userId },
            data: {
              firstName:
                input.firstName === undefined
                  ? undefined
                  : normalizeName(input.firstName),
              lastName:
                input.lastName === undefined
                  ? undefined
                  : normalizeName(input.lastName),
              phone: input.phone === undefined ? undefined : nextPhone,
            },
          })

          // Assignment rows carry an identity snapshot used by the class
          // workspace and report exports. Keep them consistent with the
          // authoritative User row.
          await tx.subjectTeacherAssignment.updateMany({
            where: { schoolId, membershipId, endedAt: null },
            data: {
              firstName: user.firstName,
              lastName: user.lastName,
              email: user.email,
              phone: user.phone,
            },
          })

          await recordAudit(
            tx,
            schoolId,
            audit,
            'TEACHER_UPDATED',
            'SchoolMembership',
            membership.id,
            {
              userId: membership.userId,
              classId: input.classId ?? null,
            },
          )

          return mapTeacher({ ...membership, user })
        })
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw new HttpError(
            409,
            'This email address or phone number is already in use',
            undefined,
            'identity_in_use',
          )
        }

        throw error
      }
    },

    async removeTeacherMembership(
      schoolId,
      membershipId: string,
      input: RemoveTeacherMembershipInput,
      audit,
    ): Promise<TeacherRecord> {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        const membership = await tx.schoolMembership.findFirst({
          where: { id: membershipId, schoolId },
          include: { user: true },
        })

        if (!membership) {
          throw new HttpError(404, 'Teacher not found', undefined, 'teacher_not_found')
        }

        if (membership.user.isPlatformAdmin) {
          throw new HttpError(
            403,
            'Platform administrator accounts cannot be removed as school teachers',
            undefined,
            'platform_admin_target',
          )
        }

        if (
          membership.role !== 'CLASS_TEACHER' &&
          membership.role !== 'SUBJECT_TEACHER'
        ) {
          throw new HttpError(404, 'Teacher not found', undefined, 'teacher_not_found')
        }

        if (membership.status !== 'ACTIVE') {
          throw new HttpError(
            409,
            'This teacher membership is already inactive',
            undefined,
            'teacher_inactive',
          )
        }

        if (
          input.confirmEmail.trim().toLowerCase() !==
          membership.user.email.toLowerCase()
        ) {
          throw new HttpError(
            400,
            'The confirmation email does not match this teacher account',
            [
              {
                field: 'confirmEmail',
                message: 'Type the teacher’s current email address exactly',
              },
            ],
            'email_confirmation_mismatch',
          )
        }

        const now = new Date()
        const classAssignments = await tx.classTeacherAssignment.findMany({
          where: { schoolId, membershipId, endedAt: null },
        })

        for (const assignment of classAssignments) {
          await tx.classTeacherAssignment.update({
            where: { id: assignment.id },
            data: { endedAt: now },
          })

          await recordAudit(
            tx,
            schoolId,
            audit,
            'CLASS_TEACHER_ASSIGNMENT_ENDED',
            'ClassTeacherAssignment',
            assignment.id,
            { membershipId, classId: assignment.classId, reason: 'membership_removed' },
          )
        }

        const subjectAssignments = await tx.subjectTeacherAssignment.findMany({
          where: { schoolId, membershipId, endedAt: null },
        })

        for (const assignment of subjectAssignments) {
          await tx.subjectTeacherAssignment.update({
            where: { id: assignment.id },
            data: { endedAt: now },
          })

          await recordAudit(
            tx,
            schoolId,
            audit,
            'SUBJECT_TEACHER_ASSIGNMENT_ENDED',
            'SubjectTeacherAssignment',
            assignment.id,
            {
              membershipId,
              classId: assignment.classId,
              subjectId: assignment.subjectId,
              reason: 'membership_removed',
            },
          )
        }

        // Soft removal only. The User row, pupils, scores, reports and audit
        // history stay intact, and any membership this person holds in another
        // school is untouched.
        const updated = await tx.schoolMembership.update({
          where: { id: membershipId },
          data: { status: 'SUSPENDED' },
          include: { user: true },
        })

        await recordAudit(
          tx,
          schoolId,
          audit,
          'TEACHER_MEMBERSHIP_REMOVED',
          'SchoolMembership',
          membership.id,
          {
            userId: membership.userId,
            email: membership.user.email,
            reason: input.reason?.trim() || null,
            endedClassAssignments: classAssignments.length,
            endedSubjectAssignments: subjectAssignments.length,
          },
        )

        return mapTeacher(updated)
      })
    },

    async listTeacherAssignments(schoolId) {
      const prisma = getPrismaClient()
      const [classTeachers, subjectTeachers] = await Promise.all([
        prisma.classTeacherAssignment.findMany({
          where: { schoolId, endedAt: null },
          include: {
            class: { select: { name: true } },
            membership: { include: { user: true } },
          },
          orderBy: [{ class: { sortOrder: 'asc' } }, { createdAt: 'asc' }],
        }),
        prisma.subjectTeacherAssignment.findMany({
          where: { schoolId, endedAt: null },
          include: {
            class: { select: { name: true } },
            subject: { select: { name: true } },
            membership: { include: { user: true } },
          },
          orderBy: [{ class: { sortOrder: 'asc' } }, { subject: { name: 'asc' } }],
        }),
      ])

      return {
        classTeachers: classTeachers.map(mapClassTeacherAssignment),
        subjectTeachers: subjectTeachers.map(mapSubjectTeacherAssignment),
      }
    },

    async listClassSubjectTeacherAssignments(schoolId, classId) {
      const prisma = getPrismaClient()
      await findClassOrThrow(prisma, schoolId, classId)

      const assignments = await prisma.subjectTeacherAssignment.findMany({
        where: { schoolId, classId, endedAt: null },
        include: {
          class: { select: { name: true } },
          subject: { select: { name: true } },
          membership: { include: { user: true } },
        },
        orderBy: [{ subject: { name: 'asc' } }, { createdAt: 'asc' }],
      })

      return assignments.map(mapSubjectTeacherAssignment)
    },

    async assignClassTeacher(schoolId, classId, membershipId, audit) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        await findClassOrThrow(tx, schoolId, classId)
        const membership = await findTeacherMembership(tx, schoolId, membershipId)

        if (membership.role !== 'CLASS_TEACHER') {
          throw new HttpError(
            409,
            'Only a class teacher membership can hold a class-teacher assignment',
          )
        }

        const active = await tx.classTeacherAssignment.findFirst({
          where: { schoolId, classId, endedAt: null },
          include: {
            class: { select: { name: true } },
            membership: { include: { user: true } },
          },
        })

        if (active && active.membershipId !== membershipId) {
          throw new HttpError(
            409,
            'This class already has an active class teacher',
          )
        }

        const assignment = await tx.classTeacherAssignment.upsert({
          where: {
            classId_membershipId: { classId, membershipId },
          },
          create: { schoolId, classId, membershipId },
          update: { endedAt: null },
          include: {
            class: { select: { name: true } },
            membership: { include: { user: true } },
          },
        })

        await recordAudit(
          tx,
          schoolId,
          audit,
          'CLASS_TEACHER_ASSIGNED',
          'ClassTeacherAssignment',
          assignment.id,
          { classId, membershipId },
        )

        return mapClassTeacherAssignment(assignment)
      })
    },

    async revokeClassTeacher(schoolId, classId, membershipId, audit) {
      const prisma = getPrismaClient()

      await prisma.$transaction(async (tx) => {
        const assignment = await tx.classTeacherAssignment.findFirst({
          where: { schoolId, classId, membershipId, endedAt: null },
        })

        if (!assignment) {
          throw new HttpError(404, 'Active class-teacher assignment not found')
        }

        await tx.classTeacherAssignment.update({
          where: { id: assignment.id },
          data: { endedAt: new Date() },
        })

        await recordAudit(
          tx,
          schoolId,
          audit,
          'CLASS_TEACHER_REVOKED',
          'ClassTeacherAssignment',
          assignment.id,
          { classId, membershipId },
        )
      })
    },

    async assignSubjectTeacher(
      schoolId,
      classId,
      subjectId,
      membershipId,
      audit,
    ) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        await findClassOrThrow(tx, schoolId, classId)
        await findSubjectOrThrow(tx, schoolId, subjectId)
        const assignment = await upsertSubjectTeacherAssignment(tx, {
          schoolId,
          classId,
          subjectId,
          membershipId,
          audit,
        })

        return mapSubjectTeacherAssignment(assignment)
      })
    },

    async revokeSubjectTeacher(
      schoolId,
      classId,
      subjectId,
      assignmentId,
      audit,
    ) {
      const prisma = getPrismaClient()

      await prisma.$transaction(async (tx) => {
        const assignment = await tx.subjectTeacherAssignment.findFirst({
          where: {
            id: assignmentId,
            schoolId,
            classId,
            subjectId,
            endedAt: null,
          },
        })

        if (!assignment) {
          throw new HttpError(404, 'Active subject-teacher assignment not found')
        }

        const now = new Date()

        await tx.subjectTeacherAssignment.update({
          where: { id: assignment.id },
          data: { endedAt: now },
        })

        // Any unused access code for this class subject is revoked; historical
        // consumed codes remain untouched.
        await tx.subjectTeacherInvitation.updateMany({
          where: {
            schoolId,
            classId,
            subjectId,
            usedAt: null,
            revokedAt: null,
          },
          data: { revokedAt: now },
        })

        // The restricted sessions belong to this assignment, so revoking the
        // assignment ends them immediately.
        await tx.subjectTeacherSession.updateMany({
          where: { assignmentId: assignment.id, revokedAt: null },
          data: { revokedAt: now },
        })

        await recordAudit(
          tx,
          schoolId,
          audit,
          'SUBJECT_TEACHER_REVOKED',
          'SubjectTeacherAssignment',
          assignment.id,
          { classId, subjectId, assignmentId },
        )
      })
    },

    async assignSubjectTeacherWithInvitation(
      schoolId,
      classId,
      subjectId,
      input: AssignSubjectTeacherInput,
      audit,
    ) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        await findClassOrThrow(tx, schoolId, classId)
        await findSubjectOrThrow(tx, schoolId, subjectId)

        return assignSubjectTeacherForClassSubject(tx, {
          schoolId,
          classId,
          subjectId,
          input,
          createdByMembershipId: audit.actorMembershipId ?? null,
          audit,
        })
      })
    },

    async listSubjectTeacherInvitations(schoolId, classId) {
      const prisma = getPrismaClient()
      await findClassOrThrow(prisma, schoolId, classId)

      const invitations = await prisma.subjectTeacherInvitation.findMany({
        where: { schoolId, classId },
        include: {
          class: { select: { name: true } },
          subject: { select: { name: true } },
          assignment: {
            include: {
              class: { select: { name: true } },
              subject: { select: { name: true } },
              membership: { include: { user: true } },
            },
          },
          membership: { include: { user: true } },
        },
        orderBy: { createdAt: 'desc' },
      })

      return invitations.map(mapSubjectTeacherInvitation)
    },

    async reissueSubjectTeacherInvitation(schoolId, invitationId, audit) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        const source = await tx.subjectTeacherInvitation.findFirst({
          where: { id: invitationId, schoolId },
        })

        if (!source) {
          throw new HttpError(404, 'Invitation not found')
        }

        if (source.usedAt) {
          throw new HttpError(
            409,
            'A historical access code cannot be reissued',
          )
        }

        // Only the currently assigned teacher can receive a new code.
        const assignment = source.assignmentId
          ? await tx.subjectTeacherAssignment.findFirst({
              where: {
                id: source.assignmentId,
                schoolId,
                endedAt: null,
              },
            })
          : await tx.subjectTeacherAssignment.findFirst({
              where: {
                schoolId,
                classId: source.classId,
                subjectId: source.subjectId,
                membershipId: source.membershipId,
                endedAt: null,
              },
            })

        if (!assignment) {
          throw new HttpError(
            409,
            'This teacher is no longer assigned to the class subject',
          )
        }

        return issueSubjectTeacherInvitation(tx, {
          schoolId,
          classId: source.classId,
          subjectId: source.subjectId,
          assignmentId: assignment.id,
          membershipId: assignment.membershipId,
          createdByMembershipId: audit.actorMembershipId ?? null,
          audit,
          reissuedFromId: source.id,
        })
      })
    },

    async revokeSubjectTeacherInvitation(schoolId, invitationId, audit) {
      const prisma = getPrismaClient()

      await prisma.$transaction(async (tx) => {
        const invitation = await tx.subjectTeacherInvitation.findFirst({
          where: { id: invitationId, schoolId },
        })

        if (!invitation) {
          throw new HttpError(404, 'Invitation not found')
        }

        if (invitation.usedAt) {
          throw new HttpError(
            409,
            'A historical access code cannot be revoked',
          )
        }

        if (invitation.revokedAt) {
          return
        }

        const now = new Date()

        await tx.subjectTeacherInvitation.update({
          where: { id: invitation.id },
          data: { revokedAt: now },
        })

        // Sessions opened with this code can no longer be trusted.
        await tx.subjectTeacherSession.updateMany({
          where: {
            OR: [
              { accessCodeId: invitation.id },
              ...(invitation.assignmentId
                ? [{ assignmentId: invitation.assignmentId }]
                : []),
            ],
            revokedAt: null,
          },
          data: { revokedAt: now },
        })

        await recordAudit(
          tx,
          schoolId,
          audit,
          'SUBJECT_TEACHER_INVITATION_REVOKED',
          'SubjectTeacherInvitation',
          invitation.id,
          {
            classId: invitation.classId,
            subjectId: invitation.subjectId,
            assignmentId: invitation.assignmentId,
            membershipId: invitation.membershipId,
          },
        )
      })
    },

    async hasClassTeacherAssignment(schoolId, classId, membershipId) {
      const count = await getPrismaClient().classTeacherAssignment.count({
        where: { schoolId, classId, membershipId, endedAt: null },
      })

      return count > 0
    },

    async hasSubjectTeacherAssignmentInClass(
      schoolId,
      classId,
      membershipId,
    ) {
      const count = await getPrismaClient().subjectTeacherAssignment.count({
        where: { schoolId, classId, membershipId, endedAt: null },
      })

      return count > 0
    },

    async listAccessibleClassIds(schoolId, membershipId) {
      const prisma = getPrismaClient()
      const [classTeachers, subjectTeachers] = await Promise.all([
        prisma.classTeacherAssignment.findMany({
          where: { schoolId, membershipId, endedAt: null },
          select: { classId: true },
        }),
        prisma.subjectTeacherAssignment.findMany({
          where: { schoolId, membershipId, endedAt: null },
          select: { classId: true },
        }),
      ])

      return [
        ...new Set([
          ...classTeachers.map((item) => item.classId),
          ...subjectTeachers.map((item) => item.classId),
        ]),
      ]
    },
  }
}

export function isSchoolRoleValue(value: string): value is SchoolRole {
  return isSchoolRole(value)
}
