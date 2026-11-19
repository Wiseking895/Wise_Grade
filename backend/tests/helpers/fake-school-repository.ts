import { randomUUID } from 'node:crypto'
import { HttpError } from '../../src/errors/http-error.js'
import { generateOpaqueToken, hashToken } from '../../src/auth/tokens.js'
import { DEFAULT_CLASSES } from '../../src/schools/defaults.js'
import { env } from '../../src/config/env.js'
import type {
  AcademicTermRecord,
  AcademicYearRecord,
  AssignSubjectTeacherInput,
  AssignSubjectToClassInput,
  AuditContext,
  ClassDashboardRecord,
  ClassRecord,
  ClassRegistrationResult,
  ClassSubjectCountRecord,
  ClassSubjectRecord,
  ClassTeacherAssignmentRecord,
  CreateAcademicTermInput,
  CreateAcademicYearInput,
  CreateClassInput,
  CreatePupilInput,
  CreateSubjectInput,
  IssuedSubjectTeacherInvitation,
  MovePupilInput,
  PupilDetail,
  PupilEnrollmentRecord,
  PupilListFilter,
  PupilListResult,
  PupilPhotoRecord,
  PupilRecord,
  RegisterClassWithTeacherInput,
  RegisterTeacherInput,
  SchoolProfile,
  SchoolRepository,
  SchoolSignatureDetailsInput,
  SchoolSignatureRecord,
  SubjectRecord,
  SubjectTeacherAssignmentRecord,
  SubjectTeacherDetailsInput,
  SubjectTeacherInvitationRecord,
  TeacherAssignments,
  TeacherRecord,
  UpdateAcademicTermInput,
  UpdateAcademicYearInput,
  UpdateClassInput,
  UpdatePupilInput,
  UpdatePupilPhotoInput,
  UpdateSchoolSignatureInput,
  UpdateSubjectInput,
} from '../../src/schools/repository.js'
import type { FakeAuthRepository } from './fake-auth-repository.js'

export interface FakeSchoolAuditEntry {
  schoolId: string
  actorUserId: string
  action: string
  entityType: string
  entityId: string | null
  metadata?: Record<string, unknown>
}

interface StoredEnrollment extends PupilEnrollmentRecord {
  createdAt: Date
}

interface StoredInvitation extends SubjectTeacherInvitationRecord {
  codeHash: string
  createdByMembershipId: string | null
}

interface SubjectTeacherIdentity {
  membershipId: string | null
  userId: string | null
  firstName: string
  lastName: string
  email: string
  phone: string | null
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function clean(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

/**
 * In-memory SchoolRepository for Phase 3 HTTP tests.
 *
 * The Prisma repository remains the authoritative implementation. This fake
 * mirrors its observable behaviour, including tenant scoping, duplicate
 * detection, enrollment history, and audit actions, without a database.
 */
export class FakeSchoolRepository implements SchoolRepository {
  readonly profiles = new Map<string, SchoolProfile>()
  readonly logos = new Map<
    string,
    { storageKey: string; mimeType: string; updatedAt: Date }
  >()
  readonly signatures = new Map<string, SchoolSignatureRecord>()
  readonly pupilPhotos = new Map<string, PupilPhotoRecord>()
  readonly years = new Map<string, AcademicYearRecord>()
  readonly terms = new Map<string, AcademicTermRecord>()
  readonly classes = new Map<string, ClassRecord>()
  readonly classSubjects = new Map<string, ClassSubjectRecord>()
  readonly pupils = new Map<string, PupilRecord>()
  readonly enrollments = new Map<string, StoredEnrollment>()
  readonly subjects = new Map<string, SubjectRecord>()
  readonly classTeacherAssignments = new Map<
    string,
    ClassTeacherAssignmentRecord
  >()
  readonly subjectTeacherAssignments = new Map<
    string,
    SubjectTeacherAssignmentRecord
  >()
  readonly subjectTeacherInvitations = new Map<string, StoredInvitation>()
  readonly audits: FakeSchoolAuditEntry[] = []

  constructor(private readonly auth: FakeAuthRepository) {}

  // -----------------------------------------------------------------------
  // Test helpers
  // -----------------------------------------------------------------------

  seedSchool(input: {
    id: string
    name: string
    slug: string
    email?: string | null
    phone?: string | null
    address?: string | null
    landmark?: string | null
    logoObjectKey?: string | null
    logoMimeType?: string | null
    logoUpdatedAt?: Date | null
  }): SchoolProfile {
    const logoUpdatedAt = input.logoUpdatedAt ?? null
    const logoUrl = logoUpdatedAt
      ? `/api/schools/${input.id}/profile/logo?v=${logoUpdatedAt.getTime()}`
      : null
    const phone = input.phone ?? null
    const address = input.address ?? null
    const landmark = input.landmark ?? null

    const profile: SchoolProfile = {
      id: input.id,
      name: input.name,
      slug: input.slug,
      email: input.email ?? null,
      phone,
      address,
      landmark,
      timezone: 'Africa/Accra',
      isActive: true,
      logoUrl,
      logoUpdatedAt,
      profileComplete: Boolean(logoUrl && phone && address && landmark),
      createdAt: new Date(),
    }

    if (input.logoObjectKey && input.logoMimeType && logoUpdatedAt) {
      this.logos.set(input.id, {
        storageKey: input.logoObjectKey,
        mimeType: input.logoMimeType,
        updatedAt: logoUpdatedAt,
      })
    }

    this.profiles.set(profile.id, profile)
    return { ...profile }
  }

  seedDefaults(schoolId: string, actorUserId: string): void {
    this.requireProfile(schoolId)

    for (const item of DEFAULT_CLASSES) {
      const id = randomUUID()
      this.classes.set(id, {
        id,
        schoolId,
        academicYearId: null,
        academicYearName: null,
        name: item.name,
        level: item.level,
        sortOrder: item.sortOrder,
        isArchived: false,
        createdAt: new Date(),
      })
    }

    void actorUserId
  }

  /**
   * Test-only helper that deliberately adds a school-level subject record. It
   * is never called by registration; tests use it to model a class teacher's
   * explicit subject setup.
   */
  seedSubject(schoolId: string, name: string, code?: string): SubjectRecord {
    this.requireProfile(schoolId)

    const subject: SubjectRecord = {
      id: randomUUID(),
      schoolId,
      name: clean(name),
      code: code ?? null,
      isArchived: false,
      createdAt: new Date(),
    }

    this.subjects.set(subject.id, subject)
    return subject
  }

  auditActions(): string[] {
    return this.audits.map((entry) => entry.action)
  }

  classByName(schoolId: string, name: string): ClassRecord {
    const found = [...this.classes.values()].find(
      (item) => item.schoolId === schoolId && item.name === name,
    )

    if (!found) {
      throw new Error(`Class ${name} was not seeded`)
    }

    return found
  }

  subjectByName(schoolId: string, name: string): SubjectRecord {
    const found = [...this.subjects.values()].find(
      (item) => item.schoolId === schoolId && item.name === name,
    )

    if (!found) {
      throw new Error(`Subject ${name} was not seeded`)
    }

    return found
  }

  private record(
    schoolId: string,
    audit: AuditContext,
    action: string,
    entityType: string,
    entityId: string | null,
    metadata?: Record<string, unknown>,
  ): void {
    this.audits.push({
      schoolId,
      actorUserId: audit.actorUserId,
      action,
      entityType,
      entityId,
      metadata,
    })
  }

  private requireProfile(schoolId: string): SchoolProfile {
    const profile = this.profiles.get(schoolId)

    if (!profile) {
      throw new HttpError(404, 'School not found')
    }

    return profile
  }

  private requireYear(schoolId: string, yearId: string): AcademicYearRecord {
    const year = this.years.get(yearId)

    if (!year || year.schoolId !== schoolId) {
      throw new HttpError(404, 'Academic year not found')
    }

    return year
  }

  private requireTerm(schoolId: string, termId: string): AcademicTermRecord {
    const term = this.terms.get(termId)

    if (!term || term.schoolId !== schoolId) {
      throw new HttpError(404, 'Academic term not found')
    }

    return term
  }

  private requireClass(schoolId: string, classId: string): ClassRecord {
    const cls = this.classes.get(classId)

    if (!cls || cls.schoolId !== schoolId) {
      throw new HttpError(404, 'Class not found')
    }

    return cls
  }

  /**
   * Mirrors the Prisma repository's transactional class find-or-create used
   * during class-teacher registration. Existing supported classes are reused
   * so pupils and assessment records attached to them are preserved.
   */
  private findOrCreateRegistrationClass(
    schoolId: string,
    input: RegisterTeacherInput,
  ): ClassRecord {
    const existing = this.peekRegistrationClass(schoolId, input)

    if (existing) {
      return existing
    }

    const name = clean(input.className ?? '')
    const template = DEFAULT_CLASSES.find(
      (item) => item.name.toLowerCase() === name.toLowerCase(),
    )
    const resolvedName = template?.name ?? name

    const cls: ClassRecord = {
      id: randomUUID(),
      schoolId,
      academicYearId: null,
      academicYearName: null,
      name: resolvedName,
      level: template?.level ?? null,
      sortOrder: template?.sortOrder ?? 0,
      isArchived: false,
      createdAt: new Date(),
    }

    this.classes.set(cls.id, cls)
    return cls
  }

  /**
   * Resolves the class selected during registration without creating it, so
   * validation failures can be detected before any records are written.
   */
  private peekRegistrationClass(
    schoolId: string,
    input: RegisterTeacherInput,
  ): ClassRecord | null {
    if (input.classId) {
      return this.requireClass(schoolId, input.classId)
    }

    const name = clean(input.className ?? '')

    if (!name) {
      throw new HttpError(
        400,
        'Select the class this class teacher will manage',
      )
    }

    const template = DEFAULT_CLASSES.find(
      (item) => item.name.toLowerCase() === name.toLowerCase(),
    )
    const resolvedName = template?.name ?? name

    return (
      [...this.classes.values()].find(
        (cls) =>
          cls.schoolId === schoolId &&
          cls.academicYearId === null &&
          cls.name === resolvedName,
      ) ?? null
    )
  }

  /**
   * Mirrors the Prisma repository's subject find-or-create. Catalogue subjects
   * are reused case-insensitively so retries never duplicate a subject.
   */
  private findOrCreateSubjectForClass(
    schoolId: string,
    input: { subjectId?: string | null; name?: string | null; code?: string | null },
    audit: AuditContext,
  ): SubjectRecord {
    if (input.subjectId) {
      const subject = this.requireSubject(schoolId, input.subjectId)

      if (subject.isArchived) {
        throw new HttpError(409, 'Archived subjects cannot be assigned')
      }

      return subject
    }

    const name = clean(input.name ?? '')

    if (!name) {
      throw new HttpError(400, 'Enter a subject name')
    }

    const existing = [...this.subjects.values()].find(
      (subject) =>
        subject.schoolId === schoolId &&
        subject.name.toLowerCase() === name.toLowerCase(),
    )

    if (existing) {
      if (existing.isArchived) {
        throw new HttpError(409, 'Archived subjects cannot be assigned')
      }

      return existing
    }

    const subject: SubjectRecord = {
      id: randomUUID(),
      schoolId,
      name,
      code: input.code?.trim() || null,
      isArchived: false,
      createdAt: new Date(),
    }

    this.subjects.set(subject.id, subject)
    this.record(schoolId, audit, 'SUBJECT_CREATED', 'Subject', subject.id, {
      name,
    })

    return subject
  }

  private upsertClassSubject(
    schoolId: string,
    classId: string,
    subject: SubjectRecord,
    audit: AuditContext,
  ): ClassSubjectRecord {
    const key = `${classId}:${subject.id}`
    const existing = this.classSubjects.get(key)
    const item: ClassSubjectRecord = existing
      ? { ...existing, isActive: true }
      : {
          id: randomUUID(),
          schoolId,
          classId,
          subjectId: subject.id,
          subjectName: subject.name,
          subjectCode: subject.code,
          isActive: true,
          sortOrder: [...this.classSubjects.values()].filter(
            (item) => item.schoolId === schoolId && item.classId === classId,
          ).length,
        }

    this.classSubjects.set(key, item)
    this.record(
      schoolId,
      audit,
      'CLASS_SUBJECT_ASSIGNED',
      'ClassSubject',
      item.id,
      { classId, subjectId: subject.id, subjectName: subject.name },
    )

    return item
  }

  private requireSubjectTeacherMembership(
    schoolId: string,
    membershipId: string,
  ) {
    const membership = this.teacherMembership(schoolId, membershipId)

    if (membership.role !== 'SUBJECT_TEACHER') {
      throw new HttpError(
        409,
        'Only a subject teacher membership can hold a subject-teacher assignment',
      )
    }

    return membership
  }

  private identityFromMembership(
    schoolId: string,
    membershipId: string,
  ): SubjectTeacherIdentity {
    const membership = this.requireSubjectTeacherMembership(
      schoolId,
      membershipId,
    )

    return {
      membershipId: membership.id,
      userId: membership.user.id,
      firstName: membership.user.firstName,
      lastName: membership.user.lastName,
      email: membership.user.email,
      phone: membership.user.phone ?? null,
    }
  }

  private upsertSubjectTeacherAssignment(
    schoolId: string,
    classId: string,
    subject: SubjectRecord,
    identity: SubjectTeacherIdentity,
    audit: AuditContext,
  ): SubjectTeacherAssignmentRecord {
    const cls = this.requireClass(schoolId, classId)
    const classSubject = this.classSubjects.get(`${classId}:${subject.id}`)

    if (!classSubject || !classSubject.isActive) {
      throw new HttpError(
        409,
        'Assign the subject to the class before assigning a teacher',
      )
    }

    const key = identity.membershipId
      ? `${classId}:${subject.id}:${identity.membershipId}`
      : `${classId}:${subject.id}:email:${identity.email.toLowerCase()}`
    const existing = this.subjectTeacherAssignments.get(key)
    const assignment: SubjectTeacherAssignmentRecord = existing
      ? { ...existing, ...identity, endedAt: null }
      : {
          id: randomUUID(),
          schoolId,
          classId,
          className: cls.name,
          subjectId: subject.id,
          subjectName: subject.name,
          ...identity,
          createdAt: new Date(),
          endedAt: null,
        }

    this.subjectTeacherAssignments.set(key, assignment)
    this.record(
      schoolId,
      audit,
      'SUBJECT_TEACHER_ASSIGNED',
      'SubjectTeacherAssignment',
      assignment.id,
      {
        classId,
        subjectId: subject.id,
        membershipId: identity.membershipId,
      },
    )

    return assignment
  }

  private requireSubject(schoolId: string, subjectId: string): SubjectRecord {
    const subject = this.subjects.get(subjectId)

    if (!subject || subject.schoolId !== schoolId) {
      throw new HttpError(404, 'Subject not found')
    }

    return subject
  }

  private requirePupil(schoolId: string, pupilId: string): PupilRecord {
    const pupil = this.pupils.get(pupilId)

    if (!pupil || pupil.schoolId !== schoolId) {
      throw new HttpError(404, 'Pupil not found')
    }

    return pupil
  }

  private teacherMembership(
    schoolId: string,
    membershipId: string,
  ): NonNullable<ReturnType<FakeAuthRepository['getMembershipById']>> {
    const membership = this.auth.getMembershipById(membershipId)

    if (!membership || membership.schoolId !== schoolId) {
      throw new HttpError(404, 'Active teacher membership not found')
    }

    if (membership.status !== 'ACTIVE') {
      throw new HttpError(404, 'Active teacher membership not found')
    }

    return membership
  }

  private detail(pupil: PupilRecord): PupilDetail {
    const history = [...this.enrollments.values()]
      .filter((item) => item.pupilId === pupil.id)
      .sort((a, b) => b.startedOn.localeCompare(a.startedOn))

    return { ...pupil, enrollments: history.map(({ ...item }) => item) }
  }

  private teacherRecord(
    schoolId: string,
    membershipId: string,
  ): TeacherRecord {
    const membership = this.teacherMembership(schoolId, membershipId)

    if (
      membership.role !== 'CLASS_TEACHER' &&
      membership.role !== 'SUBJECT_TEACHER'
    ) {
      throw new HttpError(404, 'Active teacher membership not found')
    }

    return {
      membershipId: membership.id,
      userId: membership.user.id,
      schoolId,
      firstName: membership.user.firstName,
      lastName: membership.user.lastName,
      email: membership.user.email,
      phone: membership.user.phone ?? null,
      role: membership.role,
      status: membership.status,
      joinedAt: membership.joinedAt,
    }
  }

  // -----------------------------------------------------------------------
  // School profile
  // -----------------------------------------------------------------------

  async getSchoolProfile(schoolId: string): Promise<SchoolProfile | null> {
    const profile = this.profiles.get(schoolId)
    return profile ? { ...profile } : null
  }

  async getSchoolLogo(schoolId: string) {
    const logo = this.logos.get(schoolId)
    return logo ? { ...logo } : null
  }

  async updateSchoolLogo(
    schoolId: string,
    input: {
      logoObjectKey: string
      logoMimeType: string
      logoUpdatedAt: Date
    },
    audit: AuditContext,
  ): Promise<SchoolProfile> {
    const profile = this.requireProfile(schoolId)

    this.logos.set(schoolId, {
      storageKey: input.logoObjectKey,
      mimeType: input.logoMimeType,
      updatedAt: input.logoUpdatedAt,
    })
    profile.logoUrl = `/api/schools/${schoolId}/profile/logo?v=${input.logoUpdatedAt.getTime()}`
    profile.logoUpdatedAt = input.logoUpdatedAt
    profile.profileComplete = Boolean(
      profile.phone && profile.address && profile.landmark,
    )

    this.record(schoolId, audit, 'SCHOOL_LOGO_UPDATED', 'School', schoolId)

    return { ...profile }
  }

  async getSchoolSignature(
    schoolId: string,
  ): Promise<SchoolSignatureRecord | null> {
    const signature = this.signatures.get(schoolId)
    return signature ? { ...signature } : null
  }

  async updateSchoolSignature(
    schoolId: string,
    input: UpdateSchoolSignatureInput,
    audit: AuditContext,
  ): Promise<SchoolSignatureRecord> {
    this.requireProfile(schoolId)
    const existing = this.signatures.get(schoolId)
    const signature: SchoolSignatureRecord = {
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      updatedAt: input.updatedAt,
      name: input.name === undefined ? existing?.name ?? null : input.name,
      designation:
        input.designation === undefined
          ? existing?.designation ?? null
          : input.designation,
    }

    this.signatures.set(schoolId, signature)
    this.record(schoolId, audit, 'SCHOOL_SIGNATURE_UPDATED', 'School', schoolId, {
      signatureUpdatedAt: input.updatedAt.toISOString(),
    })

    return { ...signature }
  }

  async updateSchoolSignatureDetails(
    schoolId: string,
    input: SchoolSignatureDetailsInput,
    audit: AuditContext,
  ): Promise<SchoolSignatureRecord | null> {
    this.requireProfile(schoolId)
    const signature = this.signatures.get(schoolId)

    if (!signature) {
      return null
    }

    if (input.name !== undefined) signature.name = input.name
    if (input.designation !== undefined) signature.designation = input.designation

    this.record(
      schoolId,
      audit,
      'SCHOOL_SIGNATURE_DETAILS_UPDATED',
      'School',
      schoolId,
    )

    return { ...signature }
  }

  async removeSchoolSignature(
    schoolId: string,
    audit: AuditContext,
  ): Promise<void> {
    this.requireProfile(schoolId)
    this.signatures.delete(schoolId)
    this.record(schoolId, audit, 'SCHOOL_SIGNATURE_REMOVED', 'School', schoolId)
  }

  async updateSchoolProfile(
    schoolId: string,
    input: {
      name?: string
      email?: string | null
      phone?: string | null
      address?: string | null
      landmark?: string | null
      timezone?: string
    },
    audit: AuditContext,
  ): Promise<SchoolProfile> {
    const profile = this.requireProfile(schoolId)

    if (input.name !== undefined) profile.name = clean(input.name)
    if (input.email !== undefined) profile.email = input.email
    if (input.phone !== undefined) profile.phone = input.phone
    if (input.address !== undefined) profile.address = input.address
    if (input.landmark !== undefined) profile.landmark = input.landmark
    if (input.timezone !== undefined) profile.timezone = input.timezone
    profile.profileComplete = Boolean(
      profile.logoUrl &&
        profile.phone &&
        profile.address &&
        profile.landmark,
    )

    this.record(schoolId, audit, 'SCHOOL_PROFILE_UPDATED', 'School', schoolId)

    return { ...profile }
  }

  // -----------------------------------------------------------------------
  // Academic years and terms
  // -----------------------------------------------------------------------

  async listAcademicYears(schoolId: string): Promise<AcademicYearRecord[]> {
    return [...this.years.values()]
      .filter((year) => year.schoolId === schoolId)
      .sort((a, b) => b.startsOn.localeCompare(a.startsOn))
      .map((year) => this.yearView(year))
  }

  private yearView(year: AcademicYearRecord): AcademicYearRecord {
    return {
      ...year,
      terms: [...this.terms.values()]
        .filter((term) => term.academicYearId === year.id)
        .sort((a, b) => a.sequence - b.sequence)
        .map((term) => ({ ...term })),
    }
  }

  async createAcademicYear(
    schoolId: string,
    input: CreateAcademicYearInput,
    audit: AuditContext,
  ): Promise<AcademicYearRecord> {
    this.requireProfile(schoolId)
    const name = clean(input.name)
    const duplicate = [...this.years.values()].some(
      (year) =>
        year.schoolId === schoolId &&
        year.name.toLowerCase() === name.toLowerCase(),
    )

    if (duplicate) {
      throw new HttpError(409, 'An academic year with this name already exists')
    }

    if (input.isCurrent) {
      for (const year of this.years.values()) {
        if (year.schoolId === schoolId) year.isCurrent = false
      }
    }

    const year: AcademicYearRecord = {
      id: randomUUID(),
      schoolId,
      name,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      isCurrent: input.isCurrent ?? false,
      terms: [],
    }

    this.years.set(year.id, year)
    this.record(schoolId, audit, 'ACADEMIC_YEAR_CREATED', 'AcademicYear', year.id)

    return this.yearView(year)
  }

  async updateAcademicYear(
    schoolId: string,
    yearId: string,
    input: UpdateAcademicYearInput,
    audit: AuditContext,
  ): Promise<AcademicYearRecord> {
    const year = this.requireYear(schoolId, yearId)

    if (input.name !== undefined) {
      const duplicate = [...this.years.values()].some(
        (item) =>
          item.id !== yearId &&
          item.schoolId === schoolId &&
          item.name.toLowerCase() === input.name!.toLowerCase(),
      )

      if (duplicate) {
        throw new HttpError(
          409,
          'An academic year with this name already exists',
        )
      }

      year.name = clean(input.name)
    }

    if (input.startsOn !== undefined) year.startsOn = input.startsOn
    if (input.endsOn !== undefined) year.endsOn = input.endsOn

    this.record(schoolId, audit, 'ACADEMIC_YEAR_UPDATED', 'AcademicYear', year.id)
    return this.yearView(year)
  }

  async setCurrentAcademicYear(
    schoolId: string,
    yearId: string,
    audit: AuditContext,
  ): Promise<AcademicYearRecord> {
    const year = this.requireYear(schoolId, yearId)

    for (const item of this.years.values()) {
      if (item.schoolId === schoolId) item.isCurrent = item.id === yearId
    }

    this.record(
      schoolId,
      audit,
      'ACADEMIC_YEAR_ACTIVATED',
      'AcademicYear',
      year.id,
    )

    return this.yearView(year)
  }

  async listAcademicTerms(
    schoolId: string,
    academicYearId?: string,
  ): Promise<AcademicTermRecord[]> {
    return [...this.terms.values()]
      .filter(
        (term) =>
          term.schoolId === schoolId &&
          (academicYearId === undefined ||
            term.academicYearId === academicYearId),
      )
      .sort((a, b) => a.sequence - b.sequence)
      .map((term) => ({ ...term }))
  }

  async createAcademicTerm(
    schoolId: string,
    academicYearId: string,
    input: CreateAcademicTermInput,
    audit: AuditContext,
  ): Promise<AcademicTermRecord> {
    const year = this.requireYear(schoolId, academicYearId)
    const name = clean(input.name)
    const duplicate = [...this.terms.values()].some(
      (term) =>
        term.schoolId === schoolId &&
        term.academicYearId === academicYearId &&
        (term.name.toLowerCase() === name.toLowerCase() ||
          term.sequence === input.sequence),
    )

    if (duplicate) {
      throw new HttpError(
        409,
        'A term with this name or sequence already exists in the academic year',
      )
    }

    if (input.isCurrent) {
      for (const term of this.terms.values()) {
        if (term.schoolId === schoolId) term.isCurrent = false
      }
      for (const item of this.years.values()) {
        if (item.schoolId === schoolId) item.isCurrent = item.id === year.id
      }
    }

    const term: AcademicTermRecord = {
      id: randomUUID(),
      schoolId,
      academicYearId,
      name,
      sequence: input.sequence,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      isCurrent: input.isCurrent ?? false,
    }

    this.terms.set(term.id, term)
    this.record(schoolId, audit, 'ACADEMIC_TERM_CREATED', 'AcademicTerm', term.id)

    return { ...term }
  }

  async updateAcademicTerm(
    schoolId: string,
    termId: string,
    input: UpdateAcademicTermInput,
    audit: AuditContext,
  ): Promise<AcademicTermRecord> {
    const term = this.requireTerm(schoolId, termId)

    if (input.name !== undefined) {
      const duplicate = [...this.terms.values()].some(
        (item) =>
          item.id !== termId &&
          item.academicYearId === term.academicYearId &&
          item.name.toLowerCase() === input.name!.toLowerCase(),
      )

      if (duplicate) {
        throw new HttpError(
          409,
          'A term with this name or sequence already exists in the academic year',
        )
      }

      term.name = clean(input.name)
    }

    if (input.sequence !== undefined) {
      const duplicate = [...this.terms.values()].some(
        (item) =>
          item.id !== termId &&
          item.academicYearId === term.academicYearId &&
          item.sequence === input.sequence,
      )

      if (duplicate) {
        throw new HttpError(
          409,
          'A term with this name or sequence already exists in the academic year',
        )
      }

      term.sequence = input.sequence
    }

    if (input.startsOn !== undefined) term.startsOn = input.startsOn
    if (input.endsOn !== undefined) term.endsOn = input.endsOn

    this.record(schoolId, audit, 'ACADEMIC_TERM_UPDATED', 'AcademicTerm', term.id)
    return { ...term }
  }

  async setCurrentAcademicTerm(
    schoolId: string,
    termId: string,
    audit: AuditContext,
  ): Promise<AcademicTermRecord> {
    const term = this.requireTerm(schoolId, termId)

    for (const item of this.terms.values()) {
      if (item.schoolId === schoolId) item.isCurrent = item.id === termId
    }

    for (const year of this.years.values()) {
      if (year.schoolId === schoolId) {
        year.isCurrent = year.id === term.academicYearId
      }
    }

    this.record(
      schoolId,
      audit,
      'ACADEMIC_TERM_ACTIVATED',
      'AcademicTerm',
      term.id,
    )

    return { ...term }
  }

  // -----------------------------------------------------------------------
  // Classes
  // -----------------------------------------------------------------------

  async listClasses(
    schoolId: string,
    options?: { includeArchived?: boolean; accessibleClassIds?: string[] },
  ): Promise<ClassRecord[]> {
    return [...this.classes.values()]
      .filter((cls) => cls.schoolId === schoolId)
      .filter((cls) => options?.includeArchived || !cls.isArchived)
      .filter(
        (cls) =>
          !options?.accessibleClassIds ||
          options.accessibleClassIds.includes(cls.id),
      )
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((cls) => ({ ...cls }))
  }

  async createClass(
    schoolId: string,
    input: CreateClassInput,
    audit: AuditContext,
  ): Promise<ClassRecord> {
    this.requireProfile(schoolId)
    const name = clean(input.name)
    const academicYearId = input.academicYearId ?? null
    const year = academicYearId
      ? this.requireYear(schoolId, academicYearId)
      : null
    const duplicate = [...this.classes.values()].some(
      (cls) =>
        cls.schoolId === schoolId &&
        cls.name.toLowerCase() === name.toLowerCase() &&
        cls.academicYearId === academicYearId,
    )

    if (duplicate) {
      throw new HttpError(
        409,
        'A class with this name already exists for that academic year',
      )
    }

    const cls: ClassRecord = {
      id: randomUUID(),
      schoolId,
      academicYearId,
      academicYearName: year?.name ?? null,
      name,
      level: input.level ?? null,
      sortOrder: input.sortOrder ?? 0,
      isArchived: false,
      createdAt: new Date(),
    }

    this.classes.set(cls.id, cls)
    this.record(schoolId, audit, 'CLASS_CREATED', 'SchoolClass', cls.id, {
      name: cls.name,
    })

    return { ...cls }
  }

  async registerClassWithTeacher(
    schoolId: string,
    input: RegisterClassWithTeacherInput,
    audit: AuditContext,
  ): Promise<ClassRegistrationResult> {
    this.requireProfile(schoolId)
    const name = clean(input.className)
    const academicYearId = input.academicYearId ?? null
    const year = academicYearId
      ? this.requireYear(schoolId, academicYearId)
      : null
    const template = DEFAULT_CLASSES.find(
      (item) => item.name.toLowerCase() === name.toLowerCase(),
    )
    const existing = [...this.classes.values()].find(
      (cls) =>
        cls.schoolId === schoolId &&
        cls.academicYearId === academicYearId &&
        cls.name.toLowerCase() === (template?.name ?? name).toLowerCase(),
    )

    if (existing?.isArchived) {
      throw new HttpError(
        409,
        'This class is archived and cannot be registered again',
      )
    }

    if (existing) {
      const active = [...this.classTeacherAssignments.values()].find(
        (item) =>
          item.schoolId === schoolId &&
          item.classId === existing.id &&
          item.endedAt === null,
      )

      if (active) {
        throw new HttpError(
          409,
          'This class already has an active class teacher',
        )
      }
    }

    const cls: ClassRecord =
      existing ??
      {
        id: randomUUID(),
        schoolId,
        academicYearId,
        academicYearName: year?.name ?? null,
        name: template?.name ?? name,
        level: input.level ?? template?.level ?? null,
        sortOrder: input.sortOrder ?? template?.sortOrder ?? 0,
        isArchived: false,
        createdAt: new Date(),
      }

    if (!existing) {
      this.classes.set(cls.id, cls)
      this.record(schoolId, audit, 'CLASS_REGISTERED', 'SchoolClass', cls.id)
    }

    const email = input.teacher.email.trim().toLowerCase()
    let user = await this.auth.findUserByEmail(email)

    if (user?.isPlatformAdmin) {
      throw new HttpError(
        409,
        'A platform administrator cannot be registered as a class teacher',
      )
    }

    if (!user) {
      user = await this.auth.createUserWithPasswordHash({
        email,
        passwordHash: input.teacher.passwordHash,
        firstName: clean(input.teacher.firstName),
        lastName: clean(input.teacher.lastName),
        phone: input.teacher.phone ?? null,
      })
      // Mirror the Prisma repository: the administrator chose this temporary
      // password, so the teacher must replace it at first sign-in. Suites that
      // are not about first-login rotation opt out (see FakeAuthRepository).
      if (this.auth.requireTeacherPasswordChange) {
        this.auth.requirePasswordChangeFor(user.id)
      }
    }

    let membership = this.auth
      .listMembershipsForSchool(schoolId)
      .find((item) => item.userId === user?.id)

    if (membership) {
      if (membership.role !== 'CLASS_TEACHER') {
        throw new HttpError(
          409,
          'This person already has a different role in this school',
        )
      }

      if (membership.status !== 'ACTIVE') {
        throw new HttpError(409, 'This class teacher membership is suspended')
      }
    } else {
      const membershipId = await this.auth.addMembership(
        user.id,
        schoolId,
        'CLASS_TEACHER',
      )
      membership = this.auth
        .listMembershipsForSchool(schoolId)
        .find((item) => item.id === membershipId)

      this.record(
        schoolId,
        audit,
        'TEACHER_REGISTERED',
        'SchoolMembership',
        membershipId,
        { email, role: 'CLASS_TEACHER', userId: user.id },
      )
    }

    if (!membership) {
      throw new HttpError(500, 'Could not create the class-teacher membership')
    }

    for (const item of this.classTeacherAssignments.values()) {
      if (
        item.schoolId === schoolId &&
        item.membershipId === membership.id &&
        item.endedAt === null &&
        item.classId !== cls.id
      ) {
        item.endedAt = new Date()
        this.record(
          schoolId,
          audit,
          'CLASS_TEACHER_REASSIGNED',
          'ClassTeacherAssignment',
          item.id,
        )
      }
    }

    const existingAssignment = [...this.classTeacherAssignments.values()].find(
      (item) => item.classId === cls.id && item.membershipId === membership.id,
    )
    const assignment: ClassTeacherAssignmentRecord = existingAssignment ?? {
      id: randomUUID(),
      schoolId,
      classId: cls.id,
      className: cls.name,
      membershipId: membership.id,
      userId: membership.user.id,
      firstName: membership.user.firstName,
      lastName: membership.user.lastName,
      email: membership.user.email,
      createdAt: new Date(),
      endedAt: null,
    }

    assignment.endedAt = null
    this.classTeacherAssignments.set(assignment.id, assignment)
    this.record(
      schoolId,
      audit,
      'CLASS_TEACHER_ASSIGNED',
      'ClassTeacherAssignment',
      assignment.id,
      { classId: cls.id, membershipId: membership.id },
    )

    return {
      class: { ...cls },
      teacher: this.teacherRecord(schoolId, membership.id),
      assignment: { ...assignment },
    }
  }

  async updateClass(
    schoolId: string,
    classId: string,
    input: UpdateClassInput,
    audit: AuditContext,
  ): Promise<ClassRecord> {
    const cls = this.requireClass(schoolId, classId)
    const name = input.name === undefined ? cls.name : clean(input.name)
    const academicYearId =
      input.academicYearId === undefined
        ? cls.academicYearId
        : input.academicYearId ?? null
    const year = academicYearId
      ? this.requireYear(schoolId, academicYearId)
      : null

    if (input.name !== undefined || input.academicYearId !== undefined) {
      const duplicate = [...this.classes.values()].some(
        (item) =>
          item.id !== classId &&
          item.schoolId === schoolId &&
          item.name.toLowerCase() === name.toLowerCase() &&
          item.academicYearId === academicYearId,
      )

      if (duplicate) {
        throw new HttpError(
          409,
          'A class with this name already exists for that academic year',
        )
      }
    }

    cls.name = name
    cls.academicYearId = academicYearId
    cls.academicYearName = year?.name ?? null
    if (input.level !== undefined) cls.level = input.level
    if (input.sortOrder !== undefined) cls.sortOrder = input.sortOrder
    if (input.isArchived !== undefined) cls.isArchived = input.isArchived

    this.record(
      schoolId,
      audit,
      cls.isArchived ? 'CLASS_ARCHIVED' : 'CLASS_UPDATED',
      'SchoolClass',
      cls.id,
      { name: cls.name, isArchived: cls.isArchived },
    )

    return { ...cls }
  }

  async seedDefaultClasses(
    schoolId: string,
    audit: AuditContext,
  ): Promise<ClassRecord[]> {
    this.requireProfile(schoolId)

    for (const item of DEFAULT_CLASSES) {
      const exists = [...this.classes.values()].some(
        (cls) =>
          cls.schoolId === schoolId &&
          cls.academicYearId === null &&
          cls.name === item.name,
      )

      if (!exists) {
        const id = randomUUID()
        this.classes.set(id, {
          id,
          schoolId,
          academicYearId: null,
          academicYearName: null,
          name: item.name,
          level: item.level,
          sortOrder: item.sortOrder,
          isArchived: false,
          createdAt: new Date(),
        })
      }
    }

    this.record(schoolId, audit, 'DEFAULT_CLASSES_SEEDED', 'SchoolClass', null)

    return this.listClasses(schoolId)
  }

  // -----------------------------------------------------------------------
  // Class subjects
  // -----------------------------------------------------------------------

  async listClassSubjects(
    schoolId: string,
    classId: string,
  ): Promise<ClassSubjectRecord[]> {
    this.requireClass(schoolId, classId)

    return [...this.classSubjects.values()]
      .filter((item) => item.schoolId === schoolId && item.classId === classId)
      .sort(
        (a, b) =>
          a.sortOrder - b.sortOrder ||
          a.subjectName.localeCompare(b.subjectName),
      )
      .map((item) => ({ ...item }))
  }

  async getClassTeacherDashboard(
    schoolId: string,
    membershipId: string,
  ): Promise<ClassDashboardRecord[]> {
    return [...this.classTeacherAssignments.values()]
      .filter(
        (assignment) =>
          assignment.schoolId === schoolId &&
          assignment.membershipId === membershipId &&
          assignment.endedAt === null,
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .flatMap((assignment) => {
        const cls = this.classes.get(assignment.classId)

        if (!cls || cls.schoolId !== schoolId || cls.isArchived) {
          return []
        }

        const subjects = [...this.classSubjects.values()]
          .filter(
            (item) =>
              item.schoolId === schoolId &&
              item.classId === cls.id &&
              item.isActive &&
              !this.subjects.get(item.subjectId)?.isArchived,
          )
          .sort(
            (a, b) =>
              a.sortOrder - b.sortOrder ||
              a.subjectName.localeCompare(b.subjectName),
          )
          .map((item) => {
            const teacher = [...this.subjectTeacherAssignments.values()].find(
              (candidate) =>
                candidate.schoolId === schoolId &&
                candidate.classId === item.classId &&
                candidate.subjectId === item.subjectId &&
                candidate.endedAt === null,
            )
            const subjectTeacherName = teacher
              ? `${teacher.firstName} ${teacher.lastName}`.trim()
              : null

            return {
              ...item,
              subjectTeacherName,
              readOnly: Boolean(subjectTeacherName),
              canEnterScores: !subjectTeacherName,
            }
          })

        const pupilsOnRoll = [...this.pupils.values()].filter(
          (pupil) =>
            pupil.schoolId === schoolId &&
            pupil.currentClassId === cls.id &&
            pupil.status === 'ACTIVE' &&
            [...this.enrollments.values()].some(
              (enrollment) =>
                enrollment.pupilId === pupil.id &&
                enrollment.classId === cls.id &&
                enrollment.status === 'ACTIVE',
            ),
        ).length

        return [
          {
            classId: cls.id,
            className: cls.name,
            level: cls.level,
            academicYearId: cls.academicYearId,
            academicYearName: cls.academicYearName,
            isArchived: cls.isArchived,
            pupilsOnRoll,
            subjects,
          },
        ]
      })
  }

  async getSubjectSessionDashboard(
    schoolId: string,
    assignmentId: string,
  ): Promise<ClassDashboardRecord[]> {
    const assignment = [...this.subjectTeacherAssignments.values()].find(
      (item) =>
        item.id === assignmentId &&
        item.schoolId === schoolId &&
        item.endedAt === null,
    )

    if (!assignment) {
      return []
    }

    const cls = this.classes.get(assignment.classId)

    if (!cls || cls.schoolId !== schoolId || cls.isArchived) {
      return []
    }

    const classSubject = this.classSubjects.get(
      `${assignment.classId}:${assignment.subjectId}`,
    )

    if (!classSubject || !classSubject.isActive) {
      return []
    }

    const subjectRecord = this.subjects.get(assignment.subjectId)

    if (!subjectRecord || subjectRecord.isArchived) {
      return []
    }

    const pupilsOnRoll = [...this.pupils.values()].filter(
      (pupil) =>
        pupil.schoolId === schoolId &&
        pupil.currentClassId === cls.id &&
        pupil.status === 'ACTIVE' &&
        [...this.enrollments.values()].some(
          (enrollment) =>
            enrollment.pupilId === pupil.id &&
            enrollment.classId === cls.id &&
            enrollment.status === 'ACTIVE',
        ),
    ).length

    return [
      {
        classId: cls.id,
        className: cls.name,
        level: cls.level,
        academicYearId: cls.academicYearId,
        academicYearName: cls.academicYearName,
        isArchived: cls.isArchived,
        pupilsOnRoll,
        subjects: [
          {
            ...classSubject,
            subjectTeacherName:
              `${assignment.firstName} ${assignment.lastName}`.trim() || null,
            readOnly: false,
            canEnterScores: true,
          },
        ],
      },
    ]
  }

  async listSubjectSessionClassSubjects(
    schoolId: string,
    assignmentId: string,
  ): Promise<ClassSubjectRecord[]> {
    const assignment = [...this.subjectTeacherAssignments.values()].find(
      (item) =>
        item.id === assignmentId &&
        item.schoolId === schoolId &&
        item.endedAt === null,
    )

    if (!assignment) {
      return []
    }

    const item = this.classSubjects.get(
      `${assignment.classId}:${assignment.subjectId}`,
    )

    return item && item.isActive ? [{ ...item }] : []
  }

  async listSubjectSessionAssignments(
    schoolId: string,
    assignmentId: string,
  ): Promise<SubjectTeacherAssignmentRecord[]> {
    const assignment = [...this.subjectTeacherAssignments.values()].find(
      (item) =>
        item.id === assignmentId &&
        item.schoolId === schoolId &&
        item.endedAt === null,
    )

    return assignment ? [{ ...assignment }] : []
  }

  async listClassSubjectCounts(
    schoolId: string,
  ): Promise<ClassSubjectCountRecord[]> {
    return [...this.classes.values()]
      .filter((cls) => cls.schoolId === schoolId)
      .sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
      )
      .map((cls) => {
        const assignment = [...this.classTeacherAssignments.values()].find(
          (item) =>
            item.schoolId === schoolId &&
            item.classId === cls.id &&
            item.endedAt === null,
        )

        const subjectCount = [...this.classSubjects.values()].filter(
          (item) =>
            item.schoolId === schoolId &&
            item.classId === cls.id &&
            item.isActive &&
            !this.subjects.get(item.subjectId)?.isArchived,
        ).length

        return {
          classId: cls.id,
          className: cls.name,
          level: cls.level,
          classTeacherName: assignment
            ? `${assignment.firstName} ${assignment.lastName}`.trim()
            : null,
          subjectCount,
          isArchived: cls.isArchived,
        }
      })
  }

  async assignSubjectToClass(
    schoolId: string,
    classId: string,
    input: AssignSubjectToClassInput,
    audit: AuditContext,
  ): Promise<ClassSubjectRecord> {
    this.requireClass(schoolId, classId)
    const subject = this.findOrCreateSubjectForClass(schoolId, input, audit)
    const item = this.upsertClassSubject(schoolId, classId, subject, audit)

    if (input.subjectTeacherMembershipId) {
      this.upsertSubjectTeacherAssignment(
        schoolId,
        classId,
        subject,
        this.identityFromMembership(
          schoolId,
          input.subjectTeacherMembershipId,
        ),
        audit,
      )
    }

    return { ...item }
  }

  async registerClassSubjectWithTeacher(
    schoolId: string,
    classId: string,
    input: AssignSubjectToClassInput,
    audit: AuditContext,
  ): Promise<{
    assignment: ClassSubjectRecord
    subjectTeacherAssignment: SubjectTeacherAssignmentRecord | null
    invitation: IssuedSubjectTeacherInvitation | null
  }> {
    this.requireClass(schoolId, classId)

    // Mirror the transactional production implementation: validate the
    // subject teacher before creating the subject or class-subject row so a
    // failure cannot leave partial records behind.
    if (input.subjectTeacherMembershipId) {
      this.requireSubjectTeacherMembership(
        schoolId,
        input.subjectTeacherMembershipId,
      )
    } else if (input.subjectTeacher) {
      const email = input.subjectTeacher.email.trim().toLowerCase()
      const existing = await this.auth.findUserByEmail(email)

      if (existing?.isPlatformAdmin) {
        throw new HttpError(
          409,
          'A platform administrator cannot be assigned as a subject teacher',
        )
      }

      if (existing) {
        const membership = this.auth
          .listMembershipsForSchool(schoolId)
          .find((item) => item.userId === existing.id)

        if (membership && membership.role !== 'SUBJECT_TEACHER') {
          throw new HttpError(
            409,
            'This person already has a different role in this school',
          )
        }
      }
    }

    const subject = this.findOrCreateSubjectForClass(schoolId, input, audit)
    const item = this.upsertClassSubject(schoolId, classId, subject, audit)

    let subjectTeacherAssignment: SubjectTeacherAssignmentRecord | null = null
    let invitation: IssuedSubjectTeacherInvitation | null = null

    if (input.subjectTeacherMembershipId || input.subjectTeacher) {
      const result = await this.assignSubjectTeacherWithInvitation(
        schoolId,
        classId,
        subject.id,
        input.subjectTeacherMembershipId
          ? { membershipId: input.subjectTeacherMembershipId }
          : { teacher: input.subjectTeacher },
        audit,
      )
      subjectTeacherAssignment = result.assignment
      invitation = result.invitation
    }

    return {
      assignment: { ...item },
      subjectTeacherAssignment,
      invitation,
    }
  }

  async assignSubjectTeacherWithInvitation(
    schoolId: string,
    classId: string,
    subjectId: string,
    input: AssignSubjectTeacherInput,
    audit: AuditContext,
  ): Promise<{
    assignment: SubjectTeacherAssignmentRecord
    invitation: IssuedSubjectTeacherInvitation
  }> {
    const cls = this.requireClass(schoolId, classId)
    const subject = this.requireSubject(schoolId, subjectId)

    const identity = input.membershipId
      ? this.identityFromMembership(schoolId, input.membershipId)
      : input.teacher
        ? await this.resolveSubjectTeacher(schoolId, input.teacher, audit)
        : null

    if (!identity) {
      throw new HttpError(
        400,
        'Provide the subject teacher\u2019s details to create an access code',
      )
    }

    const samePerson = (existing: SubjectTeacherAssignmentRecord) =>
      identity.membershipId
        ? existing.membershipId === identity.membershipId
        : existing.membershipId === null &&
          existing.email.toLowerCase() === identity.email.toLowerCase()

    // Replacing a teacher ends the previous assignment but keeps its history.
    for (const existing of this.subjectTeacherAssignments.values()) {
      if (
        existing.schoolId === schoolId &&
        existing.classId === classId &&
        existing.subjectId === subjectId &&
        existing.endedAt === null &&
        !samePerson(existing)
      ) {
        existing.endedAt = new Date()
        this.record(
          schoolId,
          audit,
          'SUBJECT_TEACHER_REPLACED',
          'SubjectTeacherAssignment',
          existing.id,
        )
      }
    }

    const assignment = this.upsertSubjectTeacherAssignment(
      schoolId,
      classId,
      subject,
      identity,
      audit,
    )
    const invitation = this.issueInvitation({
      schoolId,
      classId,
      subjectId,
      subjectName: subject.name,
      className: cls.name,
      assignmentId: assignment.id,
      identity,
      createdByMembershipId: audit.actorMembershipId ?? null,
      audit,
    })

    return { assignment, invitation }
  }

  async listSubjectTeacherInvitations(
    schoolId: string,
    classId: string,
  ): Promise<SubjectTeacherInvitationRecord[]> {
    this.requireClass(schoolId, classId)
    const now = new Date()

    return [...this.subjectTeacherInvitations.values()]
      .filter(
        (item) => item.schoolId === schoolId && item.classId === classId,
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((item) => ({
        id: item.id,
        schoolId: item.schoolId,
        classId: item.classId,
        className: item.className,
        subjectId: item.subjectId,
        subjectName: item.subjectName,
        membershipId: item.membershipId,
        userId: item.userId,
        assignmentId: item.assignmentId,
        firstName: item.firstName,
        lastName: item.lastName,
        email: item.email,
        phone: item.phone,
        // Derive the status so an invitation becomes EXPIRED exactly when the
        // database would report it, without a background job.
        status: item.usedAt
          ? 'USED'
          : item.revokedAt
            ? 'REVOKED'
            : item.expiresAt <= now
              ? 'EXPIRED'
              : 'PENDING',
        expiresAt: item.expiresAt,
        usedAt: item.usedAt,
        revokedAt: item.revokedAt,
        reissuedFromId: item.reissuedFromId,
        createdAt: item.createdAt,
      }))
  }

  /** Test helper: make an invitation look expired without waiting seven days. */
  expireInvitation(invitationId: string): void {
    const invitation = this.subjectTeacherInvitations.get(invitationId)

    if (invitation) {
      invitation.expiresAt = new Date(Date.now() - 1_000)
      this.auth.updateSubjectTeacherInvitation(invitation.codeHash, {
        expiresAt: invitation.expiresAt,
      })
    }
  }

  async reissueSubjectTeacherInvitation(
    schoolId: string,
    invitationId: string,
    audit: AuditContext,
  ): Promise<IssuedSubjectTeacherInvitation> {
    const source = [...this.subjectTeacherInvitations.values()].find(
      (item) => item.id === invitationId && item.schoolId === schoolId,
    )

    if (!source) {
      throw new HttpError(404, 'Invitation not found')
    }

    if (source.usedAt) {
      throw new HttpError(
        409,
        'A historical activation code cannot be reissued',
      )
    }

    const assignment = [...this.subjectTeacherAssignments.values()].find(
      (item) =>
        item.schoolId === schoolId &&
        item.id === source.assignmentId &&
        item.endedAt === null,
    )

    if (!assignment) {
      throw new HttpError(
        409,
        'This teacher is no longer assigned to the class subject',
      )
    }

    return this.issueInvitation({
      schoolId,
      classId: source.classId,
      subjectId: source.subjectId,
      subjectName: source.subjectName,
      className: source.className,
      assignmentId: assignment.id,
      identity: {
        membershipId: assignment.membershipId,
        userId: assignment.userId,
        firstName: assignment.firstName,
        lastName: assignment.lastName,
        email: assignment.email,
        phone: assignment.phone,
      },
      createdByMembershipId: audit.actorMembershipId ?? null,
      audit,
      reissuedFromId: source.id,
    })
  }

  async revokeSubjectTeacherInvitation(
    schoolId: string,
    invitationId: string,
    audit: AuditContext,
  ): Promise<void> {
    const invitation = [...this.subjectTeacherInvitations.values()].find(
      (item) => item.id === invitationId && item.schoolId === schoolId,
    )

    if (!invitation) {
      throw new HttpError(404, 'Invitation not found')
    }

    if (invitation.usedAt) {
      throw new HttpError(
        409,
        'This activation code has already been used and cannot be revoked',
      )
    }

    if (invitation.revokedAt) {
      return
    }

    invitation.revokedAt = new Date()
    invitation.status = 'REVOKED'
    this.auth.updateSubjectTeacherInvitation(invitation.codeHash, {
      revokedAt: invitation.revokedAt,
    })
    this.record(
      schoolId,
      audit,
      'SUBJECT_TEACHER_INVITATION_REVOKED',
      'SubjectTeacherInvitation',
      invitation.id,
    )
  }

  private async resolveSubjectTeacher(
    _schoolId: string,
    details: SubjectTeacherDetailsInput,
    _audit: AuditContext,
  ): Promise<SubjectTeacherIdentity> {
    const email = details.email.trim().toLowerCase()
    const user = await this.auth.findUserByEmail(email)

    if (user?.isPlatformAdmin) {
      throw new HttpError(
        409,
        'A platform administrator cannot be assigned as a subject teacher',
      )
    }

    return {
      membershipId: null,
      userId: null,
      firstName: clean(details.firstName),
      lastName: clean(details.lastName),
      email,
      phone: details.phone?.trim() || null,
    }
  }

  private issueInvitation(input: {
    schoolId: string
    classId: string
    subjectId: string
    className: string
    subjectName: string
    assignmentId: string
    identity: SubjectTeacherIdentity
    createdByMembershipId: string | null
    audit: AuditContext
    reissuedFromId?: string
  }): IssuedSubjectTeacherInvitation {
    const now = new Date()

    for (const item of this.subjectTeacherInvitations.values()) {
      if (
        item.schoolId === input.schoolId &&
        item.classId === input.classId &&
        item.subjectId === input.subjectId &&
        item.usedAt === null &&
        item.revokedAt === null
      ) {
        item.revokedAt = now
        item.status = 'REVOKED'
        this.auth.updateSubjectTeacherInvitation(item.codeHash, {
          revokedAt: now,
        })
      }
    }

    const code = generateOpaqueToken()
    const codeHash = hashToken(code)
    const invitation: StoredInvitation = {
      id: randomUUID(),
      schoolId: input.schoolId,
      classId: input.classId,
      className: input.className,
      subjectId: input.subjectId,
      subjectName: input.subjectName,
      membershipId: input.identity.membershipId,
      userId: input.identity.userId,
      assignmentId: input.assignmentId,
      firstName: input.identity.firstName,
      lastName: input.identity.lastName,
      email: input.identity.email,
      phone: input.identity.phone,
      status: 'PENDING',
      expiresAt: new Date(
        now.getTime() +
          Math.max(1, env.SUBJECT_TEACHER_ACCESS_CODE_EXPIRY_DAYS) *
            24 *
            60 *
            60 *
            1000,
      ),
      usedAt: null,
      revokedAt: null,
      reissuedFromId: input.reissuedFromId ?? null,
      createdAt: now,
      codeHash,
      createdByMembershipId: input.createdByMembershipId,
    }

    this.subjectTeacherInvitations.set(invitation.id, invitation)
    this.auth.addSubjectTeacherInvitation({
      codeHash,
      schoolId: input.schoolId,
      membershipId: input.identity.membershipId,
      assignmentId: input.assignmentId,
      classId: input.classId,
      subjectId: input.subjectId,
      className: input.className,
      subjectName: input.subjectName,
      firstName: input.identity.firstName,
      lastName: input.identity.lastName,
      email: input.identity.email,
      phone: input.identity.phone,
      expiresAt: invitation.expiresAt,
    })
    this.record(
      input.schoolId,
      input.audit,
      input.reissuedFromId
        ? 'SUBJECT_TEACHER_INVITATION_REISSUED'
        : 'SUBJECT_TEACHER_INVITATION_CREATED',
      'SubjectTeacherInvitation',
      invitation.id,
    )

    const record: SubjectTeacherInvitationRecord = {
      id: invitation.id,
      schoolId: invitation.schoolId,
      classId: invitation.classId,
      className: invitation.className,
      subjectId: invitation.subjectId,
      subjectName: invitation.subjectName,
      membershipId: invitation.membershipId,
      userId: invitation.userId,
      assignmentId: invitation.assignmentId,
      firstName: invitation.firstName,
      lastName: invitation.lastName,
      email: invitation.email,
      phone: invitation.phone,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      usedAt: invitation.usedAt,
      revokedAt: invitation.revokedAt,
      reissuedFromId: invitation.reissuedFromId,
      createdAt: invitation.createdAt,
    }

    return { ...record, code }
  }

  async removeSubjectFromClass(
    schoolId: string,
    classId: string,
    subjectId: string,
    audit: AuditContext,
  ): Promise<void> {
    const key = `${classId}:${subjectId}`
    const item = this.classSubjects.get(key)

    if (!item || item.schoolId !== schoolId || !item.isActive) {
      throw new HttpError(404, 'Active class subject assignment not found')
    }

    item.isActive = false
    this.record(schoolId, audit, 'CLASS_SUBJECT_REMOVED', 'ClassSubject', item.id, {
      classId,
      subjectId,
    })
  }

  async updateClassSubject(
    schoolId: string,
    classId: string,
    subjectId: string,
    input: UpdateSubjectInput,
    audit: AuditContext,
  ): Promise<SubjectRecord> {
    this.requireClass(schoolId, classId)
    const association = this.classSubjects.get(`${classId}:${subjectId}`)

    if (
      !association ||
      association.schoolId !== schoolId ||
      !association.isActive
    ) {
      throw new HttpError(404, 'Subject is not offered by this class')
    }

    const subject = this.requireSubject(schoolId, subjectId)

    if (input.name !== undefined) {
      const name = clean(input.name)
      const duplicate = [...this.subjects.values()].some(
        (item) =>
          item.id !== subjectId &&
          item.schoolId === schoolId &&
          item.name.toLowerCase() === name.toLowerCase(),
      )

      if (duplicate) {
        throw new HttpError(
          409,
          'A subject with this name already exists in this school',
        )
      }

      subject.name = name
    }

    if (input.code !== undefined) subject.code = input.code?.trim() || null
    if (input.isArchived !== undefined) subject.isArchived = input.isArchived

    for (const item of this.classSubjects.values()) {
      if (item.schoolId === schoolId && item.subjectId === subjectId) {
        item.subjectName = subject.name
        item.subjectCode = subject.code
      }
    }

    this.record(
      schoolId,
      audit,
      subject.isArchived ? 'SUBJECT_ARCHIVED' : 'SUBJECT_UPDATED',
      'Subject',
      subject.id,
      { classId, name: subject.name },
    )

    return { ...subject }
  }

  // -----------------------------------------------------------------------
  // Pupils
  // -----------------------------------------------------------------------

  async listPupils(filter: PupilListFilter): Promise<PupilListResult> {
    const query = filter.query?.toLowerCase()
    const items = [...this.pupils.values()]
      .filter((pupil) => pupil.schoolId === filter.schoolId)
      .filter((pupil) =>
        filter.status
          ? pupil.status === filter.status
          : pupil.status !== 'ARCHIVED',
      )
      .filter((pupil) => {
        if (!filter.classId) return true

        return (
          pupil.currentClassId === filter.classId ||
          [...this.enrollments.values()].some(
            (enrollment) =>
              enrollment.pupilId === pupil.id &&
              enrollment.classId === filter.classId &&
              enrollment.status === 'ACTIVE',
          )
        )
      })
      .filter((pupil) => {
        if (!filter.academicYearId) return true

        return [...this.enrollments.values()].some(
          (enrollment) =>
            enrollment.pupilId === pupil.id &&
            enrollment.academicYearId === filter.academicYearId &&
            enrollment.status === 'ACTIVE',
        )
      })
      .filter(
        (pupil) =>
          !filter.accessibleClassIds ||
          (pupil.currentClassId !== null &&
            filter.accessibleClassIds.includes(pupil.currentClassId)),
      )
      .filter((pupil) => {
        if (!query) return true

        return [pupil.firstName, pupil.lastName, pupil.admissionNumber].some(
          (value) => value.toLowerCase().includes(query),
        )
      })
      .sort(
        (a, b) =>
          a.lastName.localeCompare(b.lastName) ||
          a.firstName.localeCompare(b.firstName),
      )

    const start = (filter.page - 1) * filter.pageSize
    return {
      total: items.length,
      items: items
        .slice(start, start + filter.pageSize)
        .map((pupil) => ({ ...pupil })),
    }
  }

  async getPupil(
    schoolId: string,
    pupilId: string,
  ): Promise<PupilDetail | null> {
    const pupil = this.pupils.get(pupilId)

    if (!pupil || pupil.schoolId !== schoolId) {
      return null
    }

    return this.detail(pupil)
  }

  async createPupil(
    schoolId: string,
    input: CreatePupilInput,
    audit: AuditContext,
  ): Promise<PupilDetail> {
    this.requireProfile(schoolId)

    if (Boolean(input.classId) !== Boolean(input.academicYearId)) {
      throw new HttpError(
        400,
        'Class and academic year must be supplied together',
      )
    }

    if (input.classId) {
      this.requireClass(schoolId, input.classId)
      this.requireYear(schoolId, input.academicYearId!)
    }

    const admissionNumber = input.admissionNumber.trim().toUpperCase()
    const duplicate = [...this.pupils.values()].some(
      (pupil) =>
        pupil.schoolId === schoolId &&
        pupil.admissionNumber === admissionNumber,
    )

    if (duplicate) {
      throw new HttpError(
        409,
        'A pupil with this admission number already exists in this school',
      )
    }

    const pupil: PupilRecord = {
      id: randomUUID(),
      schoolId,
      firstName: clean(input.firstName),
      lastName: clean(input.lastName),
      otherNames: input.otherNames ?? null,
      admissionNumber,
      gender: input.gender ?? null,
      dateOfBirth: input.dateOfBirth ?? null,
      photoUrl: null,
      photoUpdatedAt: null,
      status: 'ACTIVE',
      currentClassId: input.classId ?? null,
      currentClassName: input.classId
        ? this.requireClass(schoolId, input.classId).name
        : null,
      createdAt: new Date(),
    }

    this.pupils.set(pupil.id, pupil)

    if (input.classId && input.academicYearId) {
      const classRecord = this.requireClass(schoolId, input.classId)
      const year = this.requireYear(schoolId, input.academicYearId)
      const enrollment: StoredEnrollment = {
        id: randomUUID(),
        schoolId,
        pupilId: pupil.id,
        classId: classRecord.id,
        className: classRecord.name,
        academicYearId: year.id,
        academicYearName: year.name,
        status: 'ACTIVE',
        startedOn: input.startedOn ?? today(),
        endedOn: null,
        createdAt: new Date(),
      }

      this.enrollments.set(enrollment.id, enrollment)
    }

    this.record(schoolId, audit, 'PUPIL_CREATED', 'Pupil', pupil.id, {
      admissionNumber,
    })

    return this.detail(pupil)
  }

  async updatePupil(
    schoolId: string,
    pupilId: string,
    input: UpdatePupilInput,
    audit: AuditContext,
  ): Promise<PupilDetail> {
    const pupil = this.requirePupil(schoolId, pupilId)

    if (input.admissionNumber !== undefined) {
      const admissionNumber = input.admissionNumber.trim().toUpperCase()
      const duplicate = [...this.pupils.values()].some(
        (item) =>
          item.id !== pupilId &&
          item.schoolId === schoolId &&
          item.admissionNumber === admissionNumber,
      )

      if (duplicate) {
        throw new HttpError(
          409,
          'A pupil with this admission number already exists in this school',
        )
      }

      pupil.admissionNumber = admissionNumber
    }

    if (input.firstName !== undefined) pupil.firstName = clean(input.firstName)
    if (input.lastName !== undefined) pupil.lastName = clean(input.lastName)
    if (input.otherNames !== undefined) pupil.otherNames = input.otherNames
    if (input.gender !== undefined) pupil.gender = input.gender
    if (input.dateOfBirth !== undefined) pupil.dateOfBirth = input.dateOfBirth
    if (input.status !== undefined) pupil.status = input.status

    this.record(schoolId, audit, 'PUPIL_UPDATED', 'Pupil', pupil.id, {
      admissionNumber: pupil.admissionNumber,
    })

    return this.detail(pupil)
  }

  async movePupil(
    schoolId: string,
    pupilId: string,
    input: MovePupilInput,
    audit: AuditContext,
  ): Promise<PupilDetail> {
    const pupil = this.requirePupil(schoolId, pupilId)

    if (pupil.status === 'ARCHIVED') {
      throw new HttpError(409, 'Archived pupils cannot be enrolled')
    }

    const classRecord = this.requireClass(schoolId, input.classId)
    const year = this.requireYear(schoolId, input.academicYearId)
    const startedOn = input.startedOn ?? today()
    const previousClassId = pupil.currentClassId

    for (const enrollment of this.enrollments.values()) {
      if (enrollment.pupilId === pupilId && enrollment.status === 'ACTIVE') {
        enrollment.status = 'COMPLETED'
        enrollment.endedOn = startedOn
      }
    }

    const enrollment: StoredEnrollment = {
      id: randomUUID(),
      schoolId,
      pupilId,
      classId: classRecord.id,
      className: classRecord.name,
      academicYearId: year.id,
      academicYearName: year.name,
      status: 'ACTIVE',
      startedOn,
      endedOn: null,
      createdAt: new Date(),
    }

    this.enrollments.set(enrollment.id, enrollment)
    pupil.currentClassId = classRecord.id
    pupil.currentClassName = classRecord.name
    pupil.status = 'ACTIVE'

    this.record(schoolId, audit, 'PUPIL_ENROLLED', 'Pupil', pupil.id, {
      admissionNumber: pupil.admissionNumber,
      classId: classRecord.id,
      academicYearId: year.id,
      previousClassId,
    })

    return this.detail(pupil)
  }

  async archivePupil(
    schoolId: string,
    pupilId: string,
    audit: AuditContext,
  ): Promise<PupilDetail> {
    const pupil = this.requirePupil(schoolId, pupilId)
    const endedOn = today()

    pupil.status = 'ARCHIVED'
    pupil.currentClassId = null
    pupil.currentClassName = null

    for (const enrollment of this.enrollments.values()) {
      if (enrollment.pupilId === pupilId && enrollment.status === 'ACTIVE') {
        enrollment.status = 'WITHDRAWN'
        enrollment.endedOn = endedOn
      }
    }

    this.record(schoolId, audit, 'PUPIL_ARCHIVED', 'Pupil', pupil.id, {
      admissionNumber: pupil.admissionNumber,
    })

    return this.detail(pupil)
  }

  async getPupilPhoto(
    schoolId: string,
    pupilId: string,
  ): Promise<PupilPhotoRecord | null> {
    this.requirePupil(schoolId, pupilId)
    const photo = this.pupilPhotos.get(pupilId)
    return photo ? { ...photo } : null
  }

  async updatePupilPhoto(
    schoolId: string,
    pupilId: string,
    input: UpdatePupilPhotoInput,
    audit: AuditContext,
  ): Promise<PupilDetail> {
    const pupil = this.requirePupil(schoolId, pupilId)
    this.pupilPhotos.set(pupilId, {
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      checksum: input.checksum,
      updatedAt: input.updatedAt,
    })
    pupil.photoUrl = `/api/schools/${schoolId}/pupils/${pupilId}/photo?v=${input.updatedAt.getTime()}`
    pupil.photoUpdatedAt = input.updatedAt

    this.record(schoolId, audit, 'PUPIL_PHOTO_UPDATED', 'Pupil', pupilId, {
      admissionNumber: pupil.admissionNumber,
    })

    return this.detail(pupil)
  }

  async removePupilPhoto(
    schoolId: string,
    pupilId: string,
    audit: AuditContext,
  ): Promise<PupilDetail> {
    const pupil = this.requirePupil(schoolId, pupilId)
    this.pupilPhotos.delete(pupilId)
    pupil.photoUrl = null
    pupil.photoUpdatedAt = null

    this.record(schoolId, audit, 'PUPIL_PHOTO_REMOVED', 'Pupil', pupilId, {
      admissionNumber: pupil.admissionNumber,
    })

    return this.detail(pupil)
  }

  // -----------------------------------------------------------------------
  // Subjects
  // -----------------------------------------------------------------------

  async listSubjects(
    schoolId: string,
    options?: { includeArchived?: boolean },
  ): Promise<SubjectRecord[]> {
    return [...this.subjects.values()]
      .filter((subject) => subject.schoolId === schoolId)
      .filter((subject) => options?.includeArchived || !subject.isArchived)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((subject) => ({ ...subject }))
  }

  async createSubject(
    schoolId: string,
    input: CreateSubjectInput,
    audit: AuditContext,
  ): Promise<SubjectRecord> {
    this.requireProfile(schoolId)
    const name = clean(input.name)
    const duplicate = [...this.subjects.values()].some(
      (subject) =>
        subject.schoolId === schoolId &&
        subject.name.toLowerCase() === name.toLowerCase(),
    )

    if (duplicate) {
      throw new HttpError(
        409,
        'A subject with this name already exists in this school',
      )
    }

    const subject: SubjectRecord = {
      id: randomUUID(),
      schoolId,
      name,
      code: input.code?.trim() || null,
      isArchived: false,
      createdAt: new Date(),
    }

    this.subjects.set(subject.id, subject)
    this.record(schoolId, audit, 'SUBJECT_CREATED', 'Subject', subject.id, {
      name,
    })

    return { ...subject }
  }

  async updateSubject(
    schoolId: string,
    subjectId: string,
    input: UpdateSubjectInput,
    audit: AuditContext,
  ): Promise<SubjectRecord> {
    const subject = this.requireSubject(schoolId, subjectId)

    if (input.name !== undefined) {
      const name = clean(input.name)
      const duplicate = [...this.subjects.values()].some(
        (item) =>
          item.id !== subjectId &&
          item.schoolId === schoolId &&
          item.name.toLowerCase() === name.toLowerCase(),
      )

      if (duplicate) {
        throw new HttpError(
          409,
          'A subject with this name already exists in this school',
        )
      }

      subject.name = name
    }

    if (input.code !== undefined) subject.code = input.code?.trim() || null
    if (input.isArchived !== undefined) subject.isArchived = input.isArchived

    this.record(
      schoolId,
      audit,
      subject.isArchived ? 'SUBJECT_ARCHIVED' : 'SUBJECT_UPDATED',
      'Subject',
      subject.id,
      { name: subject.name },
    )

    return { ...subject }
  }

  // -----------------------------------------------------------------------
  // Teachers
  // -----------------------------------------------------------------------

  async listTeachers(schoolId: string): Promise<TeacherRecord[]> {
    return this.auth
      .listMembershipsForSchool(schoolId)
      .filter(
        (membership) =>
          membership.role === 'CLASS_TEACHER' ||
          membership.role === 'SUBJECT_TEACHER',
      )
      .map((membership) => ({
        membershipId: membership.id,
        userId: membership.user.id,
        schoolId,
        firstName: membership.user.firstName,
        lastName: membership.user.lastName,
        email: membership.user.email,
        phone: membership.user.phone ?? null,
        role: membership.role,
        status: membership.status,
        joinedAt: membership.joinedAt,
      }))
  }

  async listSubjectTeacherCandidates(
    schoolId: string,
  ): Promise<TeacherRecord[]> {
    const teachers = await this.listTeachers(schoolId)

    return teachers.filter(
      (teacher) => teacher.role === 'SUBJECT_TEACHER' && teacher.status === 'ACTIVE',
    )
  }

  async registerTeacher(
    schoolId: string,
    input: RegisterTeacherInput,
    audit: AuditContext,
  ): Promise<TeacherRecord> {
    this.requireProfile(schoolId)
    const email = input.email.trim().toLowerCase()
    const user = await this.auth.findUserByEmail(email)

    const alreadyMember = this.auth
      .listMembershipsForSchool(schoolId)
      .some((membership) => membership.userId === user?.id)

    if (alreadyMember) {
      throw new HttpError(
        409,
        'This person is already a member of this school; manage their assignment instead',
      )
    }

    // Preflight the class and subject setup before writing anything. This keeps
    // the fake transactional: a failed registration cannot leave a partial
    // teacher, class, subject or assignment behind.
    if (input.role === 'CLASS_TEACHER') {
      const cls = this.peekRegistrationClass(schoolId, input)
      const active = cls
        ? [...this.classTeacherAssignments.values()].find(
            (item) =>
              item.schoolId === schoolId &&
              item.classId === cls.id &&
              item.endedAt === null,
          )
        : undefined

      if (active) {
        throw new HttpError(
          409,
          'This class already has an active class teacher. Revoke or reassign the existing assignment first.',
        )
      }
    }

    let teacher = user

    if (!teacher) {
      teacher = await this.auth.createUserWithPasswordHash({
        email,
        passwordHash: input.passwordHash,
        firstName: clean(input.firstName),
        lastName: clean(input.lastName),
        // Mirror the Prisma repository: a registered teacher's optional phone
        // number is persisted on the new user account.
        phone: input.phone ?? null,
      })

      if (input.role === 'CLASS_TEACHER' && this.auth.requireTeacherPasswordChange) {
        this.auth.requirePasswordChangeFor(teacher.id)
      }
    }

    const membershipId = await this.auth.addMembership(
      teacher.id,
      schoolId,
      input.role,
    )

    this.record(schoolId, audit, 'TEACHER_REGISTERED', 'SchoolMembership', membershipId, {
      email,
      role: input.role,
      userId: teacher.id,
    })

    if (input.role === 'CLASS_TEACHER') {
      const cls = this.findOrCreateRegistrationClass(schoolId, input)
      const active = [...this.classTeacherAssignments.values()].find(
        (item) =>
          item.schoolId === schoolId &&
          item.classId === cls.id &&
          item.endedAt === null,
      )

      if (active && active.membershipId !== membershipId) {
        throw new HttpError(
          409,
          'This class already has an active class teacher. Revoke or reassign the existing assignment first.',
        )
      }

      // A class teacher owns one class at a time. Ending the previous
      // assignment preserves pupils, assessment records and history.
      for (const assignment of this.classTeacherAssignments.values()) {
        if (
          assignment.schoolId === schoolId &&
          assignment.membershipId === membershipId &&
          assignment.endedAt === null &&
          assignment.classId !== cls.id
        ) {
          assignment.endedAt = new Date()
          this.record(
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
      }

      const membership = this.teacherMembership(schoolId, membershipId)
      const key = `${cls.id}:${membershipId}`
      const existing = this.classTeacherAssignments.get(key)
      const assignment: ClassTeacherAssignmentRecord = existing
        ? { ...existing, endedAt: null }
        : {
            id: randomUUID(),
            schoolId,
            classId: cls.id,
            className: cls.name,
            membershipId,
            userId: membership.user.id,
            firstName: membership.user.firstName,
            lastName: membership.user.lastName,
            email: membership.user.email,
            createdAt: new Date(),
            endedAt: null,
          }

      this.classTeacherAssignments.set(key, assignment)
      this.record(
        schoolId,
        audit,
        'CLASS_TEACHER_ASSIGNED',
        'ClassTeacherAssignment',
        assignment.id,
        { classId: cls.id, membershipId, className: cls.name },
      )
    }

    return this.teacherRecord(schoolId, membershipId)
  }

  async listTeacherAssignments(
    schoolId: string,
  ): Promise<TeacherAssignments> {
    return {
      classTeachers: [...this.classTeacherAssignments.values()]
        .filter(
          (item) => item.schoolId === schoolId && item.endedAt === null,
        )
        .map((item) => ({ ...item })),
      subjectTeachers: [...this.subjectTeacherAssignments.values()]
        .filter(
          (item) => item.schoolId === schoolId && item.endedAt === null,
        )
        .map((item) => ({ ...item })),
    }
  }

  async listClassSubjectTeacherAssignments(
    schoolId: string,
    classId: string,
  ): Promise<SubjectTeacherAssignmentRecord[]> {
    this.requireClass(schoolId, classId)

    return [...this.subjectTeacherAssignments.values()]
      .filter(
        (item) =>
          item.schoolId === schoolId &&
          item.classId === classId &&
          item.endedAt === null,
      )
      .map((item) => ({ ...item }))
  }

  async assignClassTeacher(
    schoolId: string,
    classId: string,
    membershipId: string,
    audit: AuditContext,
  ): Promise<ClassTeacherAssignmentRecord> {
    const cls = this.requireClass(schoolId, classId)
    const membership = this.teacherMembership(schoolId, membershipId)

    if (membership.role !== 'CLASS_TEACHER') {
      throw new HttpError(
        409,
        'Only a class teacher membership can hold a class-teacher assignment',
      )
    }

    const active = [...this.classTeacherAssignments.values()].find(
      (item) =>
        item.schoolId === schoolId &&
        item.classId === classId &&
        item.endedAt === null,
    )

    if (active && active.membershipId !== membershipId) {
      throw new HttpError(409, 'This class already has an active class teacher')
    }

    const key = `${classId}:${membershipId}`
    const existing = this.classTeacherAssignments.get(key)
    const assignment: ClassTeacherAssignmentRecord = existing
      ? { ...existing, endedAt: null }
      : {
          id: randomUUID(),
          schoolId,
          classId,
          className: cls.name,
          membershipId,
          userId: membership.user.id,
          firstName: membership.user.firstName,
          lastName: membership.user.lastName,
          email: membership.user.email,
          createdAt: new Date(),
          endedAt: null,
        }

    this.classTeacherAssignments.set(key, assignment)
    this.record(
      schoolId,
      audit,
      'CLASS_TEACHER_ASSIGNED',
      'ClassTeacherAssignment',
      assignment.id,
      { classId, membershipId },
    )

    return { ...assignment }
  }

  async revokeClassTeacher(
    schoolId: string,
    classId: string,
    membershipId: string,
    audit: AuditContext,
  ): Promise<void> {
    const key = `${classId}:${membershipId}`
    const assignment = this.classTeacherAssignments.get(key)

    if (
      !assignment ||
      assignment.schoolId !== schoolId ||
      assignment.endedAt !== null
    ) {
      throw new HttpError(404, 'Active class-teacher assignment not found')
    }

    assignment.endedAt = new Date()
    this.record(
      schoolId,
      audit,
      'CLASS_TEACHER_REVOKED',
      'ClassTeacherAssignment',
      assignment.id,
      { classId, membershipId },
    )
  }

  async assignSubjectTeacher(
    schoolId: string,
    classId: string,
    subjectId: string,
    membershipId: string,
    audit: AuditContext,
  ): Promise<SubjectTeacherAssignmentRecord> {
    const subject = this.requireSubject(schoolId, subjectId)
    const identity = this.identityFromMembership(schoolId, membershipId)

    for (const existing of this.subjectTeacherAssignments.values()) {
      if (
        existing.schoolId === schoolId &&
        existing.classId === classId &&
        existing.subjectId === subjectId &&
        existing.endedAt === null &&
        existing.membershipId !== membershipId
      ) {
        existing.endedAt = new Date()
        this.record(
          schoolId,
          audit,
          'SUBJECT_TEACHER_REPLACED',
          'SubjectTeacherAssignment',
          existing.id,
        )
      }
    }

    const assignment = this.upsertSubjectTeacherAssignment(
      schoolId,
      classId,
      subject,
      identity,
      audit,
    )

    return { ...assignment }
  }

  async revokeSubjectTeacher(
    schoolId: string,
    classId: string,
    subjectId: string,
    assignmentId: string,
    audit: AuditContext,
  ): Promise<void> {
    const assignment = [...this.subjectTeacherAssignments.values()].find(
      (item) =>
        item.id === assignmentId &&
        item.schoolId === schoolId &&
        item.classId === classId &&
        item.subjectId === subjectId &&
        item.endedAt === null,
    )

    if (!assignment) {
      throw new HttpError(404, 'Active subject-teacher assignment not found')
    }

    assignment.endedAt = new Date()

    for (const invitation of this.subjectTeacherInvitations.values()) {
      if (
        invitation.schoolId === schoolId &&
        invitation.classId === classId &&
        invitation.subjectId === subjectId &&
        invitation.usedAt === null &&
        invitation.revokedAt === null
      ) {
        invitation.revokedAt = assignment.endedAt
        invitation.status = 'REVOKED'
        this.auth.updateSubjectTeacherInvitation(invitation.codeHash, {
          revokedAt: assignment.endedAt,
        })
      }
    }

    this.auth.revokeSubjectSessionsForAssignment(assignment.id)

    this.record(
      schoolId,
      audit,
      'SUBJECT_TEACHER_REVOKED',
      'SubjectTeacherAssignment',
      assignment.id,
      { classId, subjectId, assignmentId },
    )
  }

  async hasClassTeacherAssignment(
    schoolId: string,
    classId: string,
    membershipId: string,
  ): Promise<boolean> {
    return [...this.classTeacherAssignments.values()].some(
      (item) =>
        item.schoolId === schoolId &&
        item.classId === classId &&
        item.membershipId === membershipId &&
        item.endedAt === null,
    )
  }

  async hasSubjectTeacherAssignmentInClass(
    schoolId: string,
    classId: string,
    membershipId: string,
  ): Promise<boolean> {
    return [...this.subjectTeacherAssignments.values()].some(
      (item) =>
        item.schoolId === schoolId &&
        item.classId === classId &&
        item.membershipId === membershipId &&
        item.endedAt === null,
    )
  }

  async listAccessibleClassIds(
    schoolId: string,
    membershipId: string,
  ): Promise<string[]> {
    const classTeacher = [...this.classTeacherAssignments.values()]
      .filter(
        (item) =>
          item.schoolId === schoolId &&
          item.membershipId === membershipId &&
          item.endedAt === null,
      )
      .map((item) => item.classId)
    const subjectTeacher = [...this.subjectTeacherAssignments.values()]
      .filter(
        (item) =>
          item.schoolId === schoolId &&
          item.membershipId === membershipId &&
          item.endedAt === null,
      )
      .map((item) => item.classId)

    return [...new Set([...classTeacher, ...subjectTeacher])]
  }
}
