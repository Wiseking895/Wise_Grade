import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'

function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8')
}

describe('administrator email verification UI', () => {
  it('exposes the verification and rotation flags on the session user', async () => {
    const types = await source('../src/auth/types.ts')

    assert.match(types, /emailVerified: boolean/)
    assert.match(types, /emailVerificationRequired: boolean/)
    assert.match(types, /mustChangePassword: boolean/)
  })

  it('calls the confirm and resend endpoints through the shared client', async () => {
    const api = await source('../src/lib/api.ts')

    assert.match(api, /'\/api\/auth\/email-verification\/confirm'/)
    assert.match(api, /'\/api\/auth\/email-verification\/resend'/)
    assert.match(api, /body: \{ token \}/)
  })

  it('renders a single-use verification link and a resend path', async () => {
    const page = await source('../src/pages/VerifyEmailPage.tsx')

    assert.match(page, /useSearchParams/)
    assert.match(page, /searchParams\.get\('token'\)/)
    assert.match(page, /confirmEmailVerification\(token\)/)
    assert.match(page, /resendEmailVerification/)
    // The token is never rendered or written to storage.
    assert.doesNotMatch(page, /localStorage/)
    assert.doesNotMatch(page, /sessionStorage/)
    assert.match(page, /This link is invalid, has expired, or has already been used/)
  })
})

describe('forced first-login password change UI', () => {
  it('collects the current and new password with the same minimum as the API', async () => {
    const page = await source('../src/pages/ChangePasswordPage.tsx')

    assert.match(page, /const MIN_PASSWORD_LENGTH = 10/)
    assert.match(page, /currentPassword/)
    assert.match(page, /newPassword/)
    assert.match(page, /confirmPassword/)
    assert.match(page, /await changePassword\(/)
  })

  it('blocks the dashboard until the password is replaced', async () => {
    const guard = await source('../src/components/ProtectedRoute.tsx')

    assert.match(guard, /user\?\.mustChangePassword/)
    assert.match(guard, /Navigate to="\/change-password"/)
    assert.match(guard, /user\.emailVerificationRequired/)
    assert.match(guard, /!user\.emailVerified/)
    assert.match(guard, /Navigate to="\/verify-email"/)
  })

  it('sends the user to the right page after signing in or registering', async () => {
    const login = await source('../src/pages/LoginPage.tsx')
    const register = await source('../src/pages/RegisterSchoolPage.tsx')

    assert.match(login, /user\.mustChangePassword/)
    assert.match(login, /'\/change-password'/)
    assert.match(login, /user\.emailVerificationRequired && !user\.emailVerified/)
    assert.match(login, /'\/verify-email'/)

    assert.match(register, /navigate\('\/verify-email'/)
  })

  it('registers the new routes without disturbing the existing ones', async () => {
    const app = await source('../src/App.tsx')

    assert.match(app, /path="\/verify-email"/)
    assert.match(app, /path="\/change-password"/)
    assert.match(app, /path="\/login"/)
    assert.match(app, /path="\/access-code"/)
    assert.match(app, /path="\/register"/)
  })
})

describe('subject access-code feedback', () => {
  it('explains invalid, expired and replaced codes', async () => {
    const page = await source('../src/pages/AccessCodePage.tsx')

    assert.match(page, /Access codes are bound to one class and one subject/)
    assert.match(page, /expired, been replaced, or belongs to a different assignment/)
    assert.match(page, /ask the\s+class teacher responsible/)
  })
})

describe('class teacher onboarding messaging', () => {
  it('reports mail-server acceptance without claiming inbox delivery', async () => {
    const page = await source('../src/pages/dashboard/TeachersPage.tsx')

    assert.match(page, /accepted by the mail server/)
    assert.match(page, /Delivery to the inbox cannot be confirmed here/)
    assert.match(page, /must choose a personal password/)
    assert.match(page, /Gradely generates a strong temporary password/)
    assert.match(page, /never shown in this dashboard/)
    assert.match(page, /must create a personal\s+password at first sign-in/)
  })
})
