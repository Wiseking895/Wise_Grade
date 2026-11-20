import type { NextFunction, Request, RequestHandler, Response } from 'express'
import type { AuthRepository } from '../auth/repository.js'
import { isUsableMembership } from '../auth/membership-access.js'
import { isSchoolRole, type SchoolRole } from '../auth/roles.js'
import { HttpError } from '../errors/http-error.js'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Verifies that the authenticated user has an ACTIVE membership in a school
 * that is currently active (not suspended), for the school referenced by
 * `paramName`. Attaches the membership to `req.schoolAccess`.
 *
 * School status is re-read from the database on every request, so suspension
 * takes effect immediately for existing sessions. A suspended school, a
 * non-member and an unknown school id all produce the same 403, so the response
 * neither reveals that the school exists nor that it has been suspended. A
 * syntactically invalid id is rejected before any database lookup so it can
 * never surface as a 500.
 */
export function requireSchoolAccess(
  repository: AuthRepository,
  paramName = 'schoolId',
): RequestHandler {
  return async function schoolAccess(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.auth && !req.subjectAuth) {
        throw new HttpError(
          401,
          'Authentication required',
          undefined,
          'auth_missing',
        )
      }

      const rawSchoolId = req.params[paramName]
      const schoolId = Array.isArray(rawSchoolId)
        ? rawSchoolId[0]
        : rawSchoolId

      if (!schoolId) {
        throw new HttpError(400, 'School identifier is required')
      }

      if (!UUID_PATTERN.test(schoolId)) {
        throw new HttpError(400, 'Invalid school identifier')
      }

      // A restricted subject session is scoped to exactly one school. It is
      // represented as a synthetic subject-teacher membership so existing
      // role guards keep working, but it never resolves a real User session.
      if (req.subjectAuth) {
        if (req.subjectAuth.schoolId !== schoolId) {
          throw new HttpError(403, 'You do not have access to this school')
        }

        req.schoolAccess = {
          id: `subject-session:${req.subjectAuth.sessionId}`,
          schoolId,
          schoolName: req.subjectAuth.schoolName,
          schoolSlug: req.subjectAuth.schoolSlug,
          role: 'SUBJECT_TEACHER',
          status: 'ACTIVE',
          // The subject session is only resolved while its school is active
          // (see `findSubjectSessionByTokenHash`), so it is usable here.
          schoolIsActive: true,
          joinedAt: new Date(),
        }
        next()
        return
      }

      const membership = await repository.findMembership(
        req.auth!.user.id,
        schoolId,
      )

      if (
        !membership ||
        !isUsableMembership(membership) ||
        !isSchoolRole(membership.role)
      ) {
        throw new HttpError(403, 'You do not have access to this school')
      }

      // An account whose address was changed by an administrator must confirm
      // the new address before school administration or a teacher workspace is
      // unlocked. The flag defaults to false, so existing accounts are never
      // retroactively blocked. Platform administrators hold no membership and
      // are therefore unaffected.
      if (
        req.auth?.user.emailVerificationRequired === true &&
        req.auth.user.emailVerifiedAt == null
      ) {
        throw new HttpError(
          403,
          'Verify your email address before accessing this school.',
          undefined,
          'email_verification_required',
        )
      }

      req.schoolAccess = membership
      next()
    } catch (error) {
      next(error)
    }
  }
}

/**
 * Restricts a school-scoped route to one of the given roles. Must run after
 * `requireSchoolAccess`. PLATFORM_SUPER_ADMIN is never a membership role, so it
 * is deliberately not accepted here.
 */
export function requireRole(...roles: SchoolRole[]): RequestHandler {
  return function roleGuard(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): void {
    if (!req.schoolAccess) {
      next(new HttpError(403, 'You do not have access to this school'))
      return
    }

    if (!roles.includes(req.schoolAccess.role)) {
      next(new HttpError(403, 'Your role does not allow this action'))
      return
    }

    next()
  }
}

/** For future platform-wide administration routes. */
export function requirePlatformAdmin(): RequestHandler {
  return function platformAdminGuard(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): void {
    if (!req.auth?.user.isPlatformAdmin) {
      next(new HttpError(403, 'Platform administrator access is required'))
      return
    }

    next()
  }
}
