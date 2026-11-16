export const SCHOOL_ROLES = [
  'SCHOOL_ADMIN',
  'CLASS_TEACHER',
  'SUBJECT_TEACHER',
] as const

export type SchoolRole = (typeof SCHOOL_ROLES)[number]

export type PlatformRole = 'PLATFORM_SUPER_ADMIN'

export type Role = PlatformRole | SchoolRole

export function isSchoolRole(value: string): value is SchoolRole {
  return (SCHOOL_ROLES as readonly string[]).includes(value)
}
