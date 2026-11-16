import type { MembershipRecord } from './repository.js'

/**
 * A membership grants access to a school only when the membership itself is
 * ACTIVE and the school has not been suspended.
 *
 * This is the single definition used by authentication, `/api/auth/me`, login
 * and `requireSchoolAccess`. `schoolIsActive` is read from the database on
 * every request, so a suspended school loses access immediately even for
 * sessions that were issued before the suspension. Reactivation restores
 * access without reviving sessions that were independently revoked or expired.
 */
export function isUsableMembership(membership: MembershipRecord): boolean {
  return membership.status === 'ACTIVE' && membership.schoolIsActive
}

/** Filters a membership list down to the memberships that currently grant access. */
export function usableMemberships(
  memberships: MembershipRecord[],
): MembershipRecord[] {
  return memberships.filter(isUsableMembership)
}
