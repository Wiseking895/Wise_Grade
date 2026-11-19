import type { SchoolRole } from '../auth/types'

export type PupilGender = 'MALE' | 'FEMALE' | 'OTHER'
export type PupilStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED'
export type EnrollmentStatus = 'ACTIVE' | 'COMPLETED' | 'WITHDRAWN'
export type TeacherRole = Extract<SchoolRole, 'CLASS_TEACHER' | 'SUBJECT_TEACHER'>

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
  logoUpdatedAt: string | null
  profileComplete: boolean
  createdAt: string
}

/** School administrator signature shown on terminal reports. */
export interface SchoolSignature {
  hasSignature: boolean
  /** Private, authenticated streaming URL; never a public object URL. */
  url: string | null
  mimeType: string | null
  updatedAt: string | null
  name: string | null
  designation: string | null
}

export interface AcademicTerm {
  id: string
  schoolId: string
  academicYearId: string
  name: string
  sequence: number
  startsOn: string
  endsOn: string
  isCurrent: boolean
}

export interface AcademicYear {
  id: string
  schoolId: string
  name: string
  startsOn: string
  endsOn: string
  isCurrent: boolean
  terms: AcademicTerm[]
}

export type AcademicTermStatus = 'PLANNED' | 'OPEN' | 'CLOSED'
export type ReportPreparationStatus =
  | 'NOT_PREPARED'
  | 'PREPARED'
  | 'CLOSED'

export interface CalendarTerm extends AcademicTerm {
  status: AcademicTermStatus
  openedAt: string | null
  closedAt: string | null
  reportsPreparedAt: string | null
  assessmentDeadline: string
  examinationStartsOn: string
  examinationEndsOn: string
  datesConfirmedAt: string | null
  datesConfirmed: boolean
  reportStatus: ReportPreparationStatus
}

export interface CalendarYear
  extends Omit<AcademicYear, 'terms'> {
  isArchived: boolean
  archivedAt: string | null
  terms: CalendarTerm[]
}

export interface SchoolCalendar {
  schoolId: string
  schoolName: string
  timezone: string
  serverDate: string
  currentYear: CalendarYear | null
  currentTerm: CalendarTerm | null
  nextTerm: CalendarTerm | null
  years: CalendarYear[]
}

export interface SchoolClass {
  id: string
  schoolId: string
  academicYearId: string | null
  academicYearName: string | null
  name: string
  level: string | null
  sortOrder: number
  isArchived: boolean
  createdAt: string
}

export interface ClassSubject {
  id: string
  schoolId: string
  classId: string
  subjectId: string
  subjectName: string
  subjectCode: string | null
  isActive: boolean
}

/** Administrator-facing summary: no subject names, codes or ids. */
export interface ClassSubjectCount {
  classId: string
  className: string
  level: string | null
  classTeacherName: string | null
  subjectCount: number
  isArchived: boolean
}

/** A subject offered by the authenticated class teacher's own class. */
export interface ClassDashboardSubject extends ClassSubject {
  subjectTeacherName: string | null
  readOnly: boolean
  canEnterScores: boolean
}

/** Authoritative class context resolved from the teacher's active assignment. */
export interface ClassDashboardClass {
  classId: string
  className: string
  level: string | null
  academicYearId: string | null
  academicYearName: string | null
  isArchived: boolean
  pupilsOnRoll: number
  subjects: ClassDashboardSubject[]
}

export interface PupilEnrollment {
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

export interface Pupil {
  id: string
  schoolId: string
  firstName: string
  lastName: string
  otherNames: string | null
  admissionNumber: string
  gender: PupilGender | null
  dateOfBirth: string | null
  /** Private, authenticated streaming URL for the profile photograph. */
  photoUrl: string | null
  photoUpdatedAt: string | null
  status: PupilStatus
  currentClassId: string | null
  currentClassName: string | null
  createdAt: string
}

export interface PupilDetail extends Pupil {
  enrollments: PupilEnrollment[]
}

export interface Subject {
  id: string
  schoolId: string
  name: string
  code: string | null
  isArchived: boolean
  createdAt: string
}

export interface Teacher {
  membershipId: string
  userId: string
  schoolId: string
  firstName: string
  lastName: string
  email: string
  phone: string | null
  role: TeacherRole
  status: 'ACTIVE' | 'SUSPENDED'
  joinedAt: string
}

export interface ClassTeacherAssignment {
  id: string
  schoolId: string
  classId: string
  className: string
  membershipId: string
  userId: string
  firstName: string
  lastName: string
  email: string
  createdAt: string
  endedAt: string | null
}

export interface SubjectTeacherAssignment {
  id: string
  schoolId: string
  classId: string
  className: string
  subjectId: string
  subjectName: string
  /** Null for access-code assignments created without a User account. */
  membershipId: string | null
  userId: string | null
  firstName: string
  lastName: string
  email: string
  phone: string | null
  createdAt: string
  endedAt: string | null
}

export interface TeacherAssignments {
  classTeachers: ClassTeacherAssignment[]
  subjectTeachers: SubjectTeacherAssignment[]
}

export interface PupilListResult {
  pupils: Pupil[]
  total: number
  page: number
  pageSize: number
}

export interface ImageUploadInput {
  mimeType: string
  base64: string
  originalName?: string | null
}

export interface SchoolProfileInput {
  name?: string
  email?: string | null
  phone?: string | null
  address?: string | null
  landmark?: string | null
  timezone?: string
}

export interface ClassInput {
  name: string
  level?: string | null
  sortOrder?: number
  academicYearId?: string | null
  isArchived?: boolean
}

export interface PupilInput {
  firstName: string
  lastName: string
  otherNames?: string | null
  admissionNumber: string
  gender?: PupilGender | null
  dateOfBirth?: string | null
  classId?: string | null
  academicYearId?: string | null
  startedOn?: string
  status?: PupilStatus
}

export interface SubjectInput {
  name: string
  code?: string | null
  isArchived?: boolean
}

/**
 * A subject offered by a class. Select an existing catalogue subject by id or
 * provide a new name; optionally attach a subject teacher's details, which
 * creates an assignment and returns a reusable access code. No account or
 * password is created for the subject teacher.
 */
export interface SubjectTeacherDetailsInput {
  firstName: string
  lastName: string
  email: string
  phone?: string | null
}

export interface ClassSubjectInput {
  subjectId?: string
  name?: string
  code?: string | null
  subjectTeacherMembershipId?: string
  subjectTeacher?: SubjectTeacherDetailsInput | null
}

export type SubjectTeacherInvitationStatus =
  | 'PENDING'
  | 'USED'
  | 'EXPIRED'
  | 'REVOKED'
  | 'REISSUED'

/**
 * A reusable subject-teacher access code. The code is bound to one exact
 * assignment and remains valid until it is revoked, regenerated or expires.
 * Legacy rows may still be marked USED.
 */
export interface SubjectTeacherInvitation {
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
  status: SubjectTeacherInvitationStatus
  expiresAt: string
  usedAt: string | null
  revokedAt: string | null
  reissuedFromId: string | null
  createdAt: string
}

/** The plaintext code is returned exactly once, at creation or regeneration. */
export interface IssuedSubjectTeacherInvitation
  extends SubjectTeacherInvitation {
  code: string
}

export type OnboardingEmailStatus = 'sent' | 'queued' | 'not_sent'

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
  }
}

export interface ClassRegistrationResult {
  class: SchoolClass
  teacher: Teacher
  assignment: ClassTeacherAssignment
  /** Actual dispatch outcome of the generated-password onboarding email. */
  onboardingEmail?: OnboardingEmailStatus
}

export type RegisterTeacherSubjectInput = ClassSubjectInput

export interface RegisterTeacherInput {
  firstName: string
  lastName: string
  email: string
  phone?: string | null
  role: TeacherRole
  /** Required for class teachers: the class they will manage. */
  className?: string
  /** Optional existing class id, used instead of className. */
  classId?: string
  /** Legacy field accepted only when empty; subjects are set up later. */
  subjects?: RegisterTeacherSubjectInput[]
}
