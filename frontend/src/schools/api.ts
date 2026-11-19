import { apiRequest } from '../lib/api'
import type { SchoolLogoInput } from '../auth/types'
import type {
  AcademicYear,
  ClassInput,
  ClassRegistrationResult,
  ClassSubject,
  ClassSubjectCount,
  ClassSubjectInput,
  ClassDashboardClass,
  ClassTeacherAssignment,
  IssuedSubjectTeacherInvitation,
  OnboardingEmailStatus,
  PupilDetail,
  PupilInput,
  PupilListResult,
  PupilStatus,
  RegisterClassWithTeacherInput,
  RegisterTeacherInput,
  ImageUploadInput,
  SchoolCalendar,
  SchoolClass,
  SchoolProfile,
  SchoolProfileInput,
  SchoolSignature,
  Subject,
  SubjectInput,
  SubjectTeacherAssignment,
  SubjectTeacherDetailsInput,
  SubjectTeacherInvitation,
  Teacher,
  TeacherAssignments,
} from './types'

function schoolPath(schoolId: string, suffix = ''): string {
  return `/api/schools/${schoolId}${suffix}`
}

export function getSchoolProfile(schoolId: string) {
  return apiRequest<{ school: SchoolProfile }>(
    schoolPath(schoolId, '/profile'),
  )
}

export function updateSchoolProfile(
  schoolId: string,
  input: SchoolProfileInput,
) {
  return apiRequest<{ school: SchoolProfile }>(schoolPath(schoolId), {
    method: 'PATCH',
    body: input,
  })
}

export function uploadSchoolLogo(
  schoolId: string,
  logo: SchoolLogoInput,
) {
  return apiRequest<{ school: SchoolProfile }>(
    schoolPath(schoolId, '/profile/logo'),
    {
      method: 'POST',
      body: { logo },
    },
  )
}

export function getSchoolSignature(schoolId: string) {
  return apiRequest<{ signature: SchoolSignature }>(
    schoolPath(schoolId, '/profile/signature'),
  )
}

export function uploadSchoolSignature(
  schoolId: string,
  signature: ImageUploadInput,
  details: { name?: string | null; designation?: string | null } = {},
) {
  return apiRequest<{ signature: SchoolSignature }>(
    schoolPath(schoolId, '/profile/signature'),
    {
      method: 'POST',
      body: { signature, ...details },
    },
  )
}

export function updateSchoolSignatureDetails(
  schoolId: string,
  details: { name?: string | null; designation?: string | null },
) {
  return apiRequest<{ signature: SchoolSignature }>(
    schoolPath(schoolId, '/profile/signature'),
    { method: 'PATCH', body: details },
  )
}

export function removeSchoolSignature(schoolId: string) {
  return apiRequest<{ signature: SchoolSignature }>(
    schoolPath(schoolId, '/profile/signature'),
    { method: 'DELETE' },
  )
}

export function uploadPupilPhoto(
  schoolId: string,
  pupilId: string,
  photo: ImageUploadInput,
) {
  return apiRequest<{ pupil: PupilDetail }>(
    schoolPath(schoolId, `/pupils/${pupilId}/photo`),
    { method: 'POST', body: { photo } },
  )
}

export function removePupilPhoto(schoolId: string, pupilId: string) {
  return apiRequest<{ pupil: PupilDetail }>(
    schoolPath(schoolId, `/pupils/${pupilId}/photo`),
    { method: 'DELETE' },
  )
}

export function listAcademicYears(schoolId: string) {
  return apiRequest<{ academicYears: AcademicYear[] }>(
    schoolPath(schoolId, '/academic-years'),
  )
}

export function getSchoolCalendar(schoolId: string) {
  return apiRequest<{ calendar: SchoolCalendar }>(
    schoolPath(schoolId, '/calendar'),
  )
}

export function listClasses(
  schoolId: string,
  options: { includeArchived?: boolean } = {},
) {
  const query = options.includeArchived ? '?includeArchived=true' : ''
  return apiRequest<{ classes: SchoolClass[] }>(
    schoolPath(schoolId, `/classes${query}`),
  )
}

/**
 * Authoritative Class Dashboard context. The backend resolves the class from
 * the authenticated teacher's active assignment.
 */
export function getClassDashboard(schoolId: string) {
  return apiRequest<{ classes: ClassDashboardClass[] }>(
    schoolPath(schoolId, '/class-dashboard'),
  )
}

export function createClass(schoolId: string, input: ClassInput) {
  return apiRequest<{ class: SchoolClass }>(schoolPath(schoolId, '/classes'), {
    method: 'POST',
    body: input,
  })
}

/** Registers a class and its class teacher in one transaction. */
export function registerClassWithTeacher(
  schoolId: string,
  input: RegisterClassWithTeacherInput,
) {
  return apiRequest<ClassRegistrationResult>(
    schoolPath(schoolId, '/classes/register'),
    { method: 'POST', body: input },
  )
}

export function updateClass(
  schoolId: string,
  classId: string,
  input: Partial<ClassInput>,
) {
  return apiRequest<{ class: SchoolClass }>(
    schoolPath(schoolId, `/classes/${classId}`),
    { method: 'PATCH', body: input },
  )
}

export function listClassSubjects(schoolId: string, classId: string) {
  return apiRequest<{ subjects: ClassSubject[] }>(
    schoolPath(schoolId, `/classes/${classId}/subjects`),
  )
}

export function assignSubjectToClass(
  schoolId: string,
  classId: string,
  input: ClassSubjectInput,
) {
  return apiRequest<{
    assignment: ClassSubject
    subjectTeacherAssignment: SubjectTeacherAssignment | null
    invitation: IssuedSubjectTeacherInvitation | null
  }>(schoolPath(schoolId, `/classes/${classId}/subjects`), {
    method: 'POST',
    body: input,
  })
}

export function removeSubjectFromClass(
  schoolId: string,
  classId: string,
  subjectId: string,
) {
  return apiRequest<{ message: string }>(
    schoolPath(schoolId, `/classes/${classId}/subjects/${subjectId}`),
    { method: 'DELETE' },
  )
}

export interface PupilQuery {
  q?: string
  classId?: string
  academicYearId?: string
  status?: PupilStatus
  page?: number
  pageSize?: number
}

export function listPupils(schoolId: string, query: PupilQuery = {}) {
  const params = new URLSearchParams()

  if (query.q) params.set('q', query.q)
  if (query.classId) params.set('classId', query.classId)
  if (query.academicYearId) params.set('academicYearId', query.academicYearId)
  if (query.status) params.set('status', query.status)
  if (query.page) params.set('page', String(query.page))
  if (query.pageSize) params.set('pageSize', String(query.pageSize))

  const suffix = params.size > 0 ? `?${params.toString()}` : ''
  return apiRequest<PupilListResult>(
    schoolPath(schoolId, `/pupils${suffix}`),
  )
}

export function getPupil(schoolId: string, pupilId: string) {
  return apiRequest<{ pupil: PupilDetail }>(
    schoolPath(schoolId, `/pupils/${pupilId}`),
  )
}

export function createPupil(schoolId: string, input: PupilInput) {
  return apiRequest<{ pupil: PupilDetail }>(schoolPath(schoolId, '/pupils'), {
    method: 'POST',
    body: input,
  })
}

export function updatePupil(
  schoolId: string,
  pupilId: string,
  input: PupilInput,
) {
  return apiRequest<{ pupil: PupilDetail }>(
    schoolPath(schoolId, `/pupils/${pupilId}`),
    { method: 'PATCH', body: input },
  )
}

export function movePupil(
  schoolId: string,
  pupilId: string,
  input: { classId: string; academicYearId: string; startedOn?: string },
) {
  return apiRequest<{ pupil: PupilDetail }>(
    schoolPath(schoolId, `/pupils/${pupilId}/enrollments`),
    { method: 'POST', body: input },
  )
}

export function archivePupil(schoolId: string, pupilId: string) {
  return apiRequest<{ pupil: PupilDetail }>(
    schoolPath(schoolId, `/pupils/${pupilId}/archive`),
    { method: 'POST', body: {} },
  )
}

export function listSubjects(
  schoolId: string,
  options: { includeArchived?: boolean } = {},
) {
  const query = options.includeArchived ? '?includeArchived=true' : ''
  return apiRequest<{ subjects: Subject[] }>(
    schoolPath(schoolId, `/subjects${query}`),
  )
}

export function updateClassSubject(
  schoolId: string,
  classId: string,
  subjectId: string,
  input: Partial<SubjectInput>,
) {
  return apiRequest<{ subject: Subject }>(
    schoolPath(schoolId, `/classes/${classId}/subjects/${subjectId}`),
    { method: 'PATCH', body: input },
  )
}

export function getClassSubjectCounts(schoolId: string) {
  return apiRequest<{ classSubjectCounts: ClassSubjectCount[] }>(
    schoolPath(schoolId, '/class-subject-counts'),
  )
}

export function listTeachers(schoolId: string) {
  return apiRequest<{ teachers: Teacher[] }>(
    schoolPath(schoolId, '/teachers'),
  )
}

export function registerTeacher(
  schoolId: string,
  input: RegisterTeacherInput,
) {
  return apiRequest<{ teacher: Teacher }>(schoolPath(schoolId, '/teachers'), {
    method: 'POST',
    body: input,
  })
}

/**
 * Issues a fresh temporary password for a class teacher and emails it once.
 * The password is never returned to the caller.
 */
export function resendTeacherCredentials(
  schoolId: string,
  membershipId: string,
) {
  return apiRequest<{
    teacher: Teacher
    onboardingEmail: OnboardingEmailStatus
  }>(
    schoolPath(
      schoolId,
      `/teachers/${encodeURIComponent(membershipId)}/resend-credentials`,
    ),
    { method: 'POST' },
  )
}

export function listTeacherAssignments(schoolId: string) {
  return apiRequest<{ assignments: TeacherAssignments }>(
    schoolPath(schoolId, '/teacher-assignments'),
  )
}

export function listSubjectTeacherCandidates(schoolId: string) {
  return apiRequest<{ teachers: Teacher[] }>(
    schoolPath(schoolId, '/subject-teacher-candidates'),
  )
}

export function listClassSubjectTeacherAssignments(
  schoolId: string,
  classId: string,
) {
  return apiRequest<{ assignments: SubjectTeacherAssignment[] }>(
    schoolPath(schoolId, `/classes/${classId}/subject-teacher-assignments`),
  )
}

export function assignClassTeacher(
  schoolId: string,
  classId: string,
  membershipId: string,
) {
  return apiRequest<{ assignment: ClassTeacherAssignment }>(
    schoolPath(schoolId, `/classes/${classId}/class-teacher`),
    { method: 'POST', body: { membershipId } },
  )
}

export function revokeClassTeacher(
  schoolId: string,
  classId: string,
  membershipId: string,
) {
  return apiRequest<{ message: string }>(
    schoolPath(
      schoolId,
      `/classes/${classId}/class-teacher/${membershipId}`,
    ),
    { method: 'DELETE' },
  )
}

export function assignSubjectTeacher(
  schoolId: string,
  classId: string,
  subjectId: string,
  input: { membershipId: string } | { teacher: SubjectTeacherDetailsInput },
) {
  return apiRequest<{
    assignment: SubjectTeacherAssignment
    invitation: IssuedSubjectTeacherInvitation
  }>(
    schoolPath(schoolId, `/classes/${classId}/subjects/${subjectId}/teacher`),
    { method: 'POST', body: input },
  )
}

export function revokeSubjectTeacher(
  schoolId: string,
  classId: string,
  subjectId: string,
  assignmentId: string,
) {
  return apiRequest<{ message: string }>(
    schoolPath(
      schoolId,
      `/classes/${classId}/subjects/${subjectId}/teacher/${assignmentId}`,
    ),
    { method: 'DELETE' },
  )
}

export function listSubjectTeacherInvitations(
  schoolId: string,
  classId: string,
) {
  return apiRequest<{ invitations: SubjectTeacherInvitation[] }>(
    schoolPath(schoolId, `/classes/${classId}/subject-teacher-invitations`),
  )
}

export function reissueSubjectTeacherInvitation(
  schoolId: string,
  classId: string,
  invitationId: string,
) {
  return apiRequest<{ invitation: IssuedSubjectTeacherInvitation }>(
    schoolPath(
      schoolId,
      `/classes/${classId}/subject-teacher-invitations/${invitationId}/reissue`,
    ),
    { method: 'POST', body: {} },
  )
}

export function revokeSubjectTeacherInvitation(
  schoolId: string,
  classId: string,
  invitationId: string,
) {
  return apiRequest<{ message: string }>(
    schoolPath(
      schoolId,
      `/classes/${classId}/subject-teacher-invitations/${invitationId}`,
    ),
    { method: 'DELETE' },
  )
}
