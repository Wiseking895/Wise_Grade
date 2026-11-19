import type {
  MembershipRecord,
  SchoolSummary,
  UserRecord,
} from './repository.js'
import {
  isSchoolIdentityComplete,
  schoolLogoUrl,
} from '../lib/school-branding.js'

export interface PublicUser {
  id: string
  email: string
  firstName: string
  lastName: string
  isPlatformAdmin: boolean
  /** False only when the account still has to confirm its email address. */
  emailVerified: boolean
  emailVerificationRequired: boolean
  mustChangePassword: boolean
  createdAt: string
}

export interface PublicMembership {
  id: string
  schoolId: string
  schoolName: string
  schoolSlug: string
  role: string
  status: string
  joinedAt: string
}

export interface PublicSchool {
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
  profileComplete: boolean
  createdAt: string
}

/** Explicit allow-list mapping: password hashes never leave the server. */
export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    isPlatformAdmin: user.isPlatformAdmin,
    emailVerified: user.emailVerifiedAt != null,
    emailVerificationRequired: user.emailVerificationRequired === true,
    mustChangePassword: user.mustChangePassword === true,
    createdAt: user.createdAt.toISOString(),
  }
}

export function toPublicMembership(
  membership: MembershipRecord,
): PublicMembership {
  return {
    id: membership.id,
    schoolId: membership.schoolId,
    schoolName: membership.schoolName,
    schoolSlug: membership.schoolSlug,
    role: membership.role,
    status: membership.status,
    joinedAt: membership.joinedAt.toISOString(),
  }
}

export function toPublicSchool(school: SchoolSummary): PublicSchool {
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
    profileComplete: isSchoolIdentityComplete(school),
    createdAt: school.createdAt.toISOString(),
  }
}
