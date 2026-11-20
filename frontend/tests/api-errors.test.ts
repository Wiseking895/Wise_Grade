import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { apiErrorMessage } from '../src/lib/api-error-message.ts'

function failure(status: number, code: string | null, message = 'server text') {
  return { status, code, message }
}

describe('API error messages', () => {
  it('distinguishes a missing cookie from an expired session', () => {
    const missing = apiErrorMessage(failure(401, 'auth_missing'))
    const expired = apiErrorMessage(failure(401, 'session_expired'))

    assert.match(missing, /sign-in cookie was not sent/i)
    assert.match(expired, /session has expired/i)
    assert.notEqual(missing, expired)
  })

  it('explains CSRF origin failures instead of claiming authentication is missing', () => {
    for (const code of ['csrf_origin_missing', 'csrf_origin_not_allowed']) {
      const message = apiErrorMessage(failure(403, code))

      assert.match(message, /blocked/i)
      assert.doesNotMatch(message, /authentication required/i)
    }
  })

  it('keeps password validation actionable', () => {
    assert.match(
      apiErrorMessage(failure(401, 'password_invalid')),
      /current password is incorrect/i,
    )
    assert.match(
      apiErrorMessage(failure(403, 'password_change_required')),
      /choose a new password/i,
    )
  })

  it('reports a blocked login cookie', () => {
    assert.match(
      apiErrorMessage(failure(401, 'session_cookie_blocked')),
      /did not keep the session cookie/i,
    )
  })

  it('separates network and server failures from credential failures', () => {
    assert.match(
      apiErrorMessage(failure(0, null, 'Could not reach the server.')),
      /Could not reach the server/i,
    )
    assert.match(
      apiErrorMessage(failure(503, null, 'Internal server error')),
      /server could not complete/i,
    )
  })

  it('falls back to the server message when no code is known', () => {
    assert.equal(
      apiErrorMessage(failure(409, null, 'This invoice is already paid.')),
      'This invoice is already paid.',
    )
  })

  it('uses the supplied fallback for non-API errors', () => {
    assert.equal(
      apiErrorMessage(new Error('boom'), 'Please try again.'),
      'Please try again.',
    )
  })
})
