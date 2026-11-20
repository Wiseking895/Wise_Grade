/**
 * Converts an API failure into a message a person can act on.
 *
 * HTTP status alone is not enough: a missing session cookie, an expired
 * session, a CSRF origin rejection and an incorrect current password can all
 * share a 401/403. The backend therefore sends a stable `code`, and this helper
 * uses it before falling back to the server's prose. Network failures and 5xx
 * responses also get their own wording so an outage never looks like a login
 * problem.
 */

export interface ApiErrorLike {
  status: number
  code: string | null
  message: string
}

const CODE_MESSAGES: Record<string, string> = {
  auth_missing:
    'Your sign-in cookie was not sent with this request, so you are not signed in for this action. Sign in again. If this keeps happening on an iPhone or iPad, allow cookies for this site and use the same-origin version of the app.',
  session_cookie_blocked:
    'Sign-in succeeded, but this browser did not keep the session cookie. Allow cookies for this site and try again. On iPhone or iPad, Safari may block cookies when the app and API are on different sites.',
  session_expired:
    'Your session has expired or was signed out for security. Sign in again to continue.',
  csrf_origin_missing:
    'This request was blocked because the browser did not send its origin. Reload the page and try again.',
  csrf_origin_not_allowed:
    'This request came from an unrecognised site and was blocked for your security. Reload the page and try again.',
  password_invalid: 'Your current password is incorrect.',
  password_change_required:
    'Choose a new password before continuing to your workspace.',
  email_verification_required:
    'Verify your email address before continuing. Check your inbox for the verification link.',
  email_in_use:
    'That email address already belongs to another account. Use a different address or ask the account owner to sign in.',
  phone_in_use:
    'That phone number is already registered to another account. Use a different number.',
  invalid_credentials: 'The email address or password is incorrect.',
  self_target_forbidden: 'You cannot use this action on your own account.',
  teacher_not_found: 'That teacher could not be found in this school.',
  teacher_inactive:
    "That teacher's access has already been removed. It cannot be edited until access is restored.",
  platform_admin_target:
    'Platform administrator accounts cannot be managed from a school.',
  role_mismatch: 'Only a class teacher can be assigned to a class.',
  role_conflict:
    'This person already has a different role in this school. Manage their existing account instead.',
  class_not_found: 'That class does not belong to this school.',
  class_archived: 'Archived classes cannot receive a class teacher.',
  class_teacher_conflict:
    'That class already has a class teacher. Reassign the existing teacher first.',
  email_change_verification_failed:
    'The profile was saved, but the email-change verification message could not be sent. Use Resend verification from the teacher account before relying on the new address.',
}

function isApiErrorLike(error: unknown): error is ApiErrorLike {
  if (!error || typeof error !== 'object') {
    return false
  }

  const candidate = error as Partial<ApiErrorLike>

  return (
    typeof candidate.status === 'number' &&
    typeof candidate.message === 'string' &&
    (candidate.code === null || typeof candidate.code === 'string')
  )
}

export function apiErrorMessage(
  error: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (!isApiErrorLike(error)) {
    return fallback
  }

  if (error.code && CODE_MESSAGES[error.code]) {
    return CODE_MESSAGES[error.code]
  }

  if (error.status === 0) {
    return error.message || 'Could not reach the server. Check your connection and try again.'
  }

  if (error.status >= 500) {
    return 'The server could not complete the request. Try again shortly.'
  }

  return error.message || fallback
}
