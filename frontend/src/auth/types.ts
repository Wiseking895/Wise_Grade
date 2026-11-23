export type SchoolRole =
  | 'SCHOOL_ADMIN'
  | 'CLASS_TEACHER'
  | 'SUBJECT_TEACHER'

export interface AuthUser {
  id: string
  email: string
  firstName: string
  lastName: string
  isPlatformAdmin: boolean
  /** True once an administrator has confirmed ownership of the email address. */
  emailVerified: boolean
  /** True only for accounts the API requires to verify before administration. */
  emailVerificationRequired: boolean
  /** True while a temporary first-login password must be replaced. */
  mustChangePassword: boolean
  createdAt: string
}

export interface Membership {
  id: string
  schoolId: string
  schoolName: string
  schoolSlug: string
  role: SchoolRole
  status: 'ACTIVE' | 'SUSPENDED'
  joinedAt: string
}

export interface School {
  id: string
  name: string
  slug: string
  email?: string | null
  phone?: string | null
  address?: string | null
  landmark?: string | null
  timezone: string
  isActive: boolean
  logoUrl?: string | null
  profileComplete?: boolean
  createdAt: string
}

export interface SchoolLogoInput {
  mimeType: string
  base64: string
  originalName?: string
}

export interface AuthSession {
  user: AuthUser
  memberships: Membership[]
}

/**
 * A restricted subject-teacher session is a separate identity. It is bound to
 * one active assignment and has no User account, membership, password or role
 * inherited from the class teacher.
 */
export interface SubjectTeacherIdentity {
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
}

export interface SubjectSession {
  sessionId: string
  schoolId: string
  schoolName: string
  schoolSlug: string
  classId: string
  className: string
  subjectId: string
  subjectName: string
  teacher: SubjectTeacherIdentity
  expiresAt: string
}

export interface RegisterSchoolResult extends AuthSession {
  school: School
}

export interface RegisterSchoolInput {
  schoolName: string
  firstName: string
  lastName: string
  email: string
  password: string
  landmark: string
  address: string
  phone: string
  logo: SchoolLogoInput
}

export interface LoginInput {
  email: string
  password: string
}

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'error'

export type SessionEndReason = 'manual' | 'idle' | 'expired'

export interface AuthState {
  status: AuthStatus
  user: AuthUser | null
  memberships: Membership[]
  /** Present only for a restricted subject-teacher access-code session. */
  subjectSession: SubjectSession | null
}

export const ROLE_LABELS: Record<SchoolRole, string> = {
  SCHOOL_ADMIN: 'School administrator',
  CLASS_TEACHER: 'Class teacher',
  SUBJECT_TEACHER: 'Subject teacher',
}
