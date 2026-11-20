import type { SchoolRole } from '../auth/roles.js'

export type PupilGender = 'MALE' | 'FEMALE' | 'OTHER'
export type PupilStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED'
export type EnrollmentStatus = 'ACTIVE' | 'COMPLETED' | 'WITHDRAWN'

export interface AuditContext {
  actorUserId: string
  actorMembershipId?: string | null
  ipAddress?: string | null
  userAgent?: string | null
}

export interface SchoolProfile {
  id: string
  name: string
  slug: string
  email: string | null
  phone: string | null
  address: string | null
  landmark: string | null
  timezone: string
  isActive: boolean
  logoUrl: string | null
  logoUpdatedAt: Date | null
  profileComplete: boolean
  createdAt: Date
}

export interface SchoolSignatureRecord {
  storageKey: string
  mimeType: string
  updatedAt: Date
  name: string | null
  designation: string | null
}

export interface UpdateSchoolSignatureInput {
  storageKey: string
  mimeType: string
  updatedAt: Date
  name?: string | null
  designation?: string | null
}

export interface SchoolSignatureDetailsInput {
  name?: string | null
  designation?: string | null
}

export interface PupilPhotoRecord {
  storageKey: string
  mimeType: string
  checksum: string
  updatedAt: Date
}

export interface UpdatePupilPhotoInput {
  storageKey: string
  mimeType: string
  checksum: string
  updatedAt: Date
}

export interface AcademicTermRecord {
  id: string
  schoolId: string
  academicYearId: string
  name: string
  sequence: number
  startsOn: string
  endsOn: string
  isCurrent: boolean
}

export interface AcademicYearRecord {
  id: string
  schoolId: string
  name: string
  startsOn: string
  endsOn: string
  isCurrent: boolean
  terms: AcademicTermRecord[]
}

export interface ClassRecord {
  id: string
  schoolId: string
  academicYearId: string | null
  academicYearName: string | null
  name: string
  level: string | null
  sortOrder: number
  isArchived: boolean
  createdAt: Date
}

export interface ClassSubjectRecord {
  id: string
  schoolId: string
  classId: string
  subjectId: string
  subjectName: string
  subjectCode: string | null
  isActive: boolean
  sortOrder: number
}

/**
 * Administrator-facing summary only. It deliberately carries no subject names,
 * codes or ids, so the school administrator can see how many subjects a class
 * offers without gaining access to the subject catalogue.
 */
export interface ClassSubjectCountRecord {
  classId: string
  className: string
  level: string | null
  classTeacherName: string | null
  subjectCount: number
  isArchived: boolean
}

/** A subject offered by the authenticated class teacher's own class. */
export interface ClassDashboardSubjectRecord extends ClassSubjectRecord {
  subjectTeacherName: string | null
  /** True when an assigned subject teacher owns this score sheet. */
  readOnly: boolean
  canEnterScores: boolean
}

/**
 * Authoritative class-teacher dashboard context. The backend resolves the
 * class from the teacher's active assignment; the browser never supplies it.
 */
export interface ClassDashboardRecord {
  classId: string
  className: string
  level: string | null
  academicYearId: string | null
  academicYearName: string | null
  isArchived: boolean
  pupilsOnRoll: number
  subjects: ClassDashboardSubjectRecord[]
}

export interface PupilEnrollmentRecord {
  id: string
  schoolId: string
  pupilId: string
  classId: string
  className: string
  academicYearId: string
  academicYearName: string
  status: EnrollmentStatus
  startedOn: string
  endedOn: string | null
}

export interface PupilRecord {
  id: string
  schoolId: string
  firstName: string
  lastName: string
  otherNames: string | null
  admissionNumber: string
  gender: PupilGender | null
  dateOfBirth: string | null
  /** Authorized streaming URL, or null when no photograph has been uploaded. */
  photoUrl: string | null
  photoUpdatedAt: Date | null
  status: PupilStatus
  currentClassId: string | null
  currentClassName: string | null
  createdAt: Date
}

export interface PupilDetail extends PupilRecord {
  enrollments: PupilEnrollmentRecord[]
}

export interface SubjectRecord {
  id: string
  schoolId: string
  name: string
  code: string | null
  isArchived: boolean
  createdAt: Date
}

export interface TeacherRecord {
  membershipId: string
  userId: string
  schoolId: string
  firstName: string
  lastName: string
  email: string
  phone: string | null
  role: SchoolRole
  status: 'ACTIVE' | 'SUSPENDED'
  joinedAt: Date
}

export interface ClassTeacherAssignmentRecord {
  id: string
  schoolId: string
  classId: string
  className: string
  membershipId: string
  userId: string
  firstName: string
  lastName: string
  email: string
  createdAt: Date
  endedAt: Date | null
}

export interface SubjectTeacherAssignmentRecord {
  id: string
  schoolId: string
  classId: string
  className: string
  subjectId: string
  subjectName: string
  membershipId: string | null
  userId: string | null
  firstName: string
  lastName: string
  email: string
  phone: string | null
  createdAt: Date
  endedAt: Date | null
}

export interface TeacherAssignments {
  classTeachers: ClassTeacherAssignmentRecord[]
  subjectTeachers: SubjectTeacherAssignmentRecord[]
}

export interface CreateAcademicYearInput {
  name: string
  startsOn: string
  endsOn: string
  isCurrent?: boolean
}

export interface UpdateAcademicYearInput {
  name?: string
  startsOn?: string
  endsOn?: string
}

export interface CreateAcademicTermInput {
  name: string
  sequence: number
  startsOn: string
  endsOn: string
  isCurrent?: boolean
}

export interface UpdateAcademicTermInput {
  name?: string
  sequence?: number
  startsOn?: string
  endsOn?: string
}

export interface CreateClassInput {
  name: string
  level?: string | null
  sortOrder?: number
  academicYearId?: string | null
}

export interface UpdateClassInput {
  name?: string
  level?: string | null
  sortOrder?: number
  academicYearId?: string | null
  isArchived?: boolean
}

export interface PupilListFilter {
  schoolId: string
  query?: string
  classId?: string
  academicYearId?: string
  status?: PupilStatus
  accessibleClassIds?: string[]
  page: number
  pageSize: number
}

export interface PupilListResult {
  items: PupilRecord[]
  total: number
}

export interface CreatePupilInput {
  firstName: string
  lastName: string
  otherNames?: string | null
  admissionNumber: string
  gender?: PupilGender | null
  dateOfBirth?: string | null
  classId?: string | null
  academicYearId?: string | null
  startedOn?: string
}

export interface UpdatePupilInput {
  firstName?: string
  lastName?: string
  otherNames?: string | null
  admissionNumber?: string
  gender?: PupilGender | null
  dateOfBirth?: string | null
  status?: PupilStatus
}

export interface MovePupilInput {
  classId: string
  academicYearId: string
  startedOn?: string
}

export interface CreateSubjectInput {
  name: string
  code?: string | null
}

export interface UpdateSubjectInput {
  name?: string
  code?: string | null
  isArchived?: boolean
}

export interface SubjectTeacherDetailsInput {
  firstName: string
  lastName: string
  email: string
  phone?: string | null
}

export interface AssignSubjectTeacherInput {
  /** Existing eligible SUBJECT_TEACHER membership in this school. */
  membershipId?: string | null
  /** Details for a new (or existing same-school) subject teacher. */
  teacher?: SubjectTeacherDetailsInput | null
}

export interface SubjectTeacherInvitationRecord {
  id: string
  schoolId: string
  classId: string
  className: string
  subjectId: string
  subjectName: string
  membershipId: string | null
  userId: string | null
  assignmentId: string | null
  firstName: string
  lastName: string
  email: string
  phone: string | null
  status: 'PENDING' | 'USED' | 'EXPIRED' | 'REVOKED' | 'REISSUED'
  expiresAt: Date
  usedAt: Date | null
  revokedAt: Date | null
  reissuedFromId: string | null
  createdAt: Date
}

export interface IssuedSubjectTeacherInvitation
  extends SubjectTeacherInvitationRecord {
  /** Plaintext access code. Returned exactly once at creation/regeneration. */
  code: string
}

export interface SubjectTeacherAssignmentResult {
  assignment: SubjectTeacherAssignmentRecord
  invitation: IssuedSubjectTeacherInvitation
}

export interface RegisterClassWithTeacherInput {
  className: string
  level?: string | null
  academicYearId?: string | null
  sortOrder?: number
  teacher: {
    firstName: string
    lastName: string
    email: string
    phone?: string | null
    passwordHash: string
  }
}

export interface ClassRegistrationResult {
  class: ClassRecord
  teacher: TeacherRecord
  assignment: ClassTeacherAssignmentRecord
  /**
   * False when an existing member of this same school was reassigned. The
   * caller must not send temporary credentials in that case because no new
   * password was stored.
   */
  accountCreated: boolean
}

export interface RegisterTeacherResult {
  teacher: TeacherRecord
  /** False when an existing member of this same school was reused. */
  accountCreated: boolean
}

export interface UpdateTeacherInput {
  firstName?: string
  lastName?: string
  email?: string
  phone?: string | null
  /** Reassign a class teacher to an existing class in the same school. */
  classId?: string
}

export interface RemoveTeacherMembershipInput {
  /** Must match the teacher's current email to prevent a wrong-account removal. */
  confirmEmail: string
  reason?: string | null
}

export interface RegisterTeacherInput {
  email: string
  firstName: string
  lastName: string
  phone?: string | null
  role: 'CLASS_TEACHER' | 'SUBJECT_TEACHER'
  passwordHash: string
  /** Supported class name selected during class-teacher registration. */
  className?: string | null
  /** Existing class id selected during class-teacher registration. */
  classId?: string | null
}

export interface AssignSubjectToClassInput {
  subjectId?: string | null
  name?: string | null
  code?: string | null
  subjectTeacherMembershipId?: string | null
  /** New/existing subject-teacher details; creates an invitation code. */
  subjectTeacher?: SubjectTeacherDetailsInput | null
}

/**
 * Persistence boundary for Phase 3 school management.
 *
 * Every method is tenant-scoped by schoolId. Routes never pass a school id
 * taken from a request body into these methods without first resolving the
 * caller's ACTIVE membership.
 */
export interface SchoolRepository {
  getSchoolProfile(schoolId: string): Promise<SchoolProfile | null>
  getSchoolLogo(schoolId: string): Promise<{
    storageKey: string
    mimeType: string
    updatedAt: Date
  } | null>
  updateSchoolProfile(
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
  ): Promise<SchoolProfile>
  updateSchoolLogo(
    schoolId: string,
    input: {
      logoObjectKey: string
      logoMimeType: string
      logoUpdatedAt: Date
    },
    audit: AuditContext,
  ): Promise<SchoolProfile>
  getSchoolSignature(schoolId: string): Promise<SchoolSignatureRecord | null>
  updateSchoolSignature(
    schoolId: string,
    input: UpdateSchoolSignatureInput,
    audit: AuditContext,
  ): Promise<SchoolSignatureRecord>
  updateSchoolSignatureDetails(
    schoolId: string,
    input: SchoolSignatureDetailsInput,
    audit: AuditContext,
  ): Promise<SchoolSignatureRecord | null>
  removeSchoolSignature(schoolId: string, audit: AuditContext): Promise<void>

  listAcademicYears(schoolId: string): Promise<AcademicYearRecord[]>
  createAcademicYear(
    schoolId: string,
    input: CreateAcademicYearInput,
    audit: AuditContext,
  ): Promise<AcademicYearRecord>
  updateAcademicYear(
    schoolId: string,
    yearId: string,
    input: UpdateAcademicYearInput,
    audit: AuditContext,
  ): Promise<AcademicYearRecord>
  setCurrentAcademicYear(
    schoolId: string,
    yearId: string,
    audit: AuditContext,
  ): Promise<AcademicYearRecord>

  listAcademicTerms(
    schoolId: string,
    academicYearId?: string,
  ): Promise<AcademicTermRecord[]>
  createAcademicTerm(
    schoolId: string,
    academicYearId: string,
    input: CreateAcademicTermInput,
    audit: AuditContext,
  ): Promise<AcademicTermRecord>
  updateAcademicTerm(
    schoolId: string,
    termId: string,
    input: UpdateAcademicTermInput,
    audit: AuditContext,
  ): Promise<AcademicTermRecord>
  setCurrentAcademicTerm(
    schoolId: string,
    termId: string,
    audit: AuditContext,
  ): Promise<AcademicTermRecord>

  listClasses(
    schoolId: string,
    options?: { includeArchived?: boolean; accessibleClassIds?: string[] },
  ): Promise<ClassRecord[]>
  createClass(
    schoolId: string,
    input: CreateClassInput,
    audit: AuditContext,
  ): Promise<ClassRecord>
  /** Admin-only: register a class together with its class teacher atomically. */
  registerClassWithTeacher(
    schoolId: string,
    input: RegisterClassWithTeacherInput,
    audit: AuditContext,
  ): Promise<ClassRegistrationResult>
  updateClass(
    schoolId: string,
    classId: string,
    input: UpdateClassInput,
    audit: AuditContext,
  ): Promise<ClassRecord>
  seedDefaultClasses(
    schoolId: string,
    audit: AuditContext,
  ): Promise<ClassRecord[]>

  listClassSubjects(
    schoolId: string,
    classId: string,
  ): Promise<ClassSubjectRecord[]>
  /** Authoritative dashboard context for the authenticated class teacher. */
  getClassTeacherDashboard(
    schoolId: string,
    membershipId: string,
  ): Promise<ClassDashboardRecord[]>
  /**
   * Authoritative, single-assignment context for a restricted subject session.
   * Only the assigned class and subject are returned.
   */
  getSubjectSessionDashboard(
    schoolId: string,
    assignmentId: string,
  ): Promise<ClassDashboardRecord[]>
  /** Class subjects visible to a restricted subject session (exactly one). */
  listSubjectSessionClassSubjects(
    schoolId: string,
    assignmentId: string,
  ): Promise<ClassSubjectRecord[]>
  /** Active subject-teacher assignments visible to a restricted session. */
  listSubjectSessionAssignments(
    schoolId: string,
    assignmentId: string,
  ): Promise<SubjectTeacherAssignmentRecord[]>
  /** Administrator summary: per-class counts without any subject identifiers. */
  listClassSubjectCounts(
    schoolId: string,
  ): Promise<ClassSubjectCountRecord[]>
  assignSubjectToClass(
    schoolId: string,
    classId: string,
    input: AssignSubjectToClassInput,
    audit: AuditContext,
  ): Promise<ClassSubjectRecord>
  /** Class-teacher setup: add a subject and optionally invite its teacher atomically. */
  registerClassSubjectWithTeacher(
    schoolId: string,
    classId: string,
    input: AssignSubjectToClassInput,
    audit: AuditContext,
  ): Promise<{
    assignment: ClassSubjectRecord
    subjectTeacherAssignment: SubjectTeacherAssignmentRecord | null
    invitation: IssuedSubjectTeacherInvitation | null
  }>
  removeSubjectFromClass(
    schoolId: string,
    classId: string,
    subjectId: string,
    audit: AuditContext,
  ): Promise<void>
  /** Edit a subject only through an active association with the teacher's class. */
  updateClassSubject(
    schoolId: string,
    classId: string,
    subjectId: string,
    input: UpdateSubjectInput,
    audit: AuditContext,
  ): Promise<SubjectRecord>

  listPupils(filter: PupilListFilter): Promise<PupilListResult>
  getPupil(schoolId: string, pupilId: string): Promise<PupilDetail | null>
  createPupil(
    schoolId: string,
    input: CreatePupilInput,
    audit: AuditContext,
  ): Promise<PupilDetail>
  updatePupil(
    schoolId: string,
    pupilId: string,
    input: UpdatePupilInput,
    audit: AuditContext,
  ): Promise<PupilDetail>
  movePupil(
    schoolId: string,
    pupilId: string,
    input: MovePupilInput,
    audit: AuditContext,
  ): Promise<PupilDetail>
  archivePupil(
    schoolId: string,
    pupilId: string,
    audit: AuditContext,
  ): Promise<PupilDetail>
  getPupilPhoto(
    schoolId: string,
    pupilId: string,
  ): Promise<PupilPhotoRecord | null>
  updatePupilPhoto(
    schoolId: string,
    pupilId: string,
    input: UpdatePupilPhotoInput,
    audit: AuditContext,
  ): Promise<PupilDetail>
  removePupilPhoto(
    schoolId: string,
    pupilId: string,
    audit: AuditContext,
  ): Promise<PupilDetail>

  listSubjects(
    schoolId: string,
    options?: { includeArchived?: boolean },
  ): Promise<SubjectRecord[]>
  createSubject(
    schoolId: string,
    input: CreateSubjectInput,
    audit: AuditContext,
  ): Promise<SubjectRecord>
  updateSubject(
    schoolId: string,
    subjectId: string,
    input: UpdateSubjectInput,
    audit: AuditContext,
  ): Promise<SubjectRecord>

  listTeachers(schoolId: string): Promise<TeacherRecord[]>
  /** Active SUBJECT_TEACHER memberships that a class teacher may assign. */
  listSubjectTeacherCandidates(schoolId: string): Promise<TeacherRecord[]>
  registerTeacher(
    schoolId: string,
    input: RegisterTeacherInput,
    audit: AuditContext,
  ): Promise<RegisterTeacherResult>

  /**
   * Updates a teacher's editable profile and, for a class teacher, their class
   * assignment. Tenant-scoped and restricted to CLASS_TEACHER/SUBJECT_TEACHER
   * memberships. Email changes are normalized and uniquely constrained.
   */
  updateTeacher(
    schoolId: string,
    membershipId: string,
    input: UpdateTeacherInput,
    audit: AuditContext,
  ): Promise<TeacherRecord>

  /**
   * Soft-removes a teacher membership by suspending it and ending active
   * assignments. User accounts and academic/audit history are preserved.
   */
  removeTeacherMembership(
    schoolId: string,
    membershipId: string,
    input: RemoveTeacherMembershipInput,
    audit: AuditContext,
  ): Promise<TeacherRecord>
  /**
   * Replaces a class teacher's temporary password and revokes their existing
   * sessions. Used by the secure resend-credentials flow; the caller generates
   * and hashes the password and emails it once.
   */
  resetTeacherTemporaryPassword(
    schoolId: string,
    membershipId: string,
    passwordHash: string,
    audit: AuditContext,
  ): Promise<TeacherRecord>

  listTeacherAssignments(schoolId: string): Promise<TeacherAssignments>
  listClassSubjectTeacherAssignments(
    schoolId: string,
    classId: string,
  ): Promise<SubjectTeacherAssignmentRecord[]>
  assignClassTeacher(
    schoolId: string,
    classId: string,
    membershipId: string,
    audit: AuditContext,
  ): Promise<ClassTeacherAssignmentRecord>
  revokeClassTeacher(
    schoolId: string,
    classId: string,
    membershipId: string,
    audit: AuditContext,
  ): Promise<void>
  assignSubjectTeacher(
    schoolId: string,
    classId: string,
    subjectId: string,
    membershipId: string,
    audit: AuditContext,
  ): Promise<SubjectTeacherAssignmentRecord>
  revokeSubjectTeacher(
    schoolId: string,
    classId: string,
    subjectId: string,
    assignmentId: string,
    audit: AuditContext,
  ): Promise<void>

  /** Assign a subject teacher by details or membership and issue a one-time code. */
  assignSubjectTeacherWithInvitation(
    schoolId: string,
    classId: string,
    subjectId: string,
    input: AssignSubjectTeacherInput,
    audit: AuditContext,
  ): Promise<SubjectTeacherAssignmentResult>
  listSubjectTeacherInvitations(
    schoolId: string,
    classId: string,
  ): Promise<SubjectTeacherInvitationRecord[]>
  reissueSubjectTeacherInvitation(
    schoolId: string,
    invitationId: string,
    audit: AuditContext,
  ): Promise<IssuedSubjectTeacherInvitation>
  revokeSubjectTeacherInvitation(
    schoolId: string,
    invitationId: string,
    audit: AuditContext,
  ): Promise<void>

  hasClassTeacherAssignment(
    schoolId: string,
    classId: string,
    membershipId: string,
  ): Promise<boolean>
  hasSubjectTeacherAssignmentInClass(
    schoolId: string,
    classId: string,
    membershipId: string,
  ): Promise<boolean>
  listAccessibleClassIds(
    schoolId: string,
    membershipId: string,
  ): Promise<string[]>
}
