import { KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/use-auth'
import AuthLayout from '../components/AuthLayout'
import FormField from '../components/FormField'
import { SessionLoadingScreen } from '../components/ProtectedRoute'
import { apiErrorMessage } from '../lib/api-error-message'
import { ApiError } from '../lib/api'

const MIN_PASSWORD_LENGTH = 10

interface FieldErrors {
  currentPassword?: string
  newPassword?: string
  confirmPassword?: string
}

/**
 * Forced first-login password rotation for a teacher whose account was created
 * with an administrator-supplied temporary password, and a self-service change
 * for any other signed-in account. The API enforces the rotation; this page is
 * the friendly path through it.
 */
export default function ChangePasswordPage() {
  const { status, user, subjectSession, changePassword, logout } = useAuth()
  const navigate = useNavigate()
  const [values, setValues] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  if (status === 'loading') {
    return <SessionLoadingScreen />
  }

  if (status !== 'authenticated' || subjectSession) {
    return <Navigate to={subjectSession ? '/dashboard' : '/login'} replace />
  }

  function updateField(
    field: 'currentPassword' | 'newPassword' | 'confirmPassword',
    value: string,
  ) {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => {
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (submitting) {
      return
    }

    const nextErrors: FieldErrors = {}

    if (!values.currentPassword) {
      nextErrors.currentPassword = 'Enter your current password'
    }

    if (values.newPassword.length < MIN_PASSWORD_LENGTH) {
      nextErrors.newPassword = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
    } else if (values.newPassword === values.currentPassword) {
      nextErrors.newPassword = 'Choose a password you have not used for this account'
    }

    if (values.newPassword !== values.confirmPassword) {
      nextErrors.confirmPassword = 'Passwords do not match'
    }

    setErrors(nextErrors)
    setFormError(null)

    if (Object.keys(nextErrors).length > 0) {
      return
    }

    setSubmitting(true)

    try {
      await changePassword(values.currentPassword, values.newPassword)
      setSubmitted(true)
    } catch (cause) {
      if (cause instanceof ApiError) {
        setFormError(
          apiErrorMessage(
            cause,
            'The password could not be changed. Please try again.',
          ),
        )

        if (cause.details.length > 0) {
          setErrors(
            Object.fromEntries(
              cause.details.map((detail) => [detail.field, detail.message]),
            ) as FieldErrors,
          )
        }
      } else {
        setFormError('Something went wrong. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const destination = user?.isPlatformAdmin ? '/platform' : '/dashboard'

  if (submitted) {
    return (
      <AuthLayout
        title="Password updated"
        subtitle="Your account now uses the personal password you just chose."
        footer={
          <p className="text-sm text-gradely-muted">
            <Link
              to={destination}
              className="font-semibold text-gradely-navy underline decoration-gradely-blue/40 underline-offset-2 hover:text-gradely-blue"
            >
              Continue to {user?.isPlatformAdmin ? 'platform administration' : 'your dashboard'}
            </Link>
          </p>
        }
      >
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
          <ShieldCheck
            aria-hidden="true"
            className="mt-0.5 size-5 text-emerald-600"
          />
          <p className="text-sm leading-relaxed text-emerald-800">
            Other sessions were signed out for your security. Keep this password
            private and never share it with anyone.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate(destination, { replace: true })}
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradely-navy px-4 py-2.5 text-sm font-semibold text-gradely-white transition-colors hover:bg-[#123c80]"
        >
          Continue
        </button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Choose a personal password"
      subtitle="Your account was created with a temporary password. Replace it now before opening your workspace."
      footer={
        <button
          type="button"
          onClick={() => void logout()}
          className="text-sm font-semibold text-gradely-muted underline underline-offset-2 hover:text-gradely-navy"
        >
          Sign out
        </button>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        {formError ? (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            {formError}
          </div>
        ) : null}

        <FormField
          label="Current temporary password"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          value={values.currentPassword}
          error={errors.currentPassword}
          onChange={(event) => updateField('currentPassword', event.target.value)}
        />

        <FormField
          label="New password"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          value={values.newPassword}
          error={errors.newPassword}
          hint={`Use at least ${MIN_PASSWORD_LENGTH} characters. Do not reuse the temporary password.`}
          onChange={(event) => updateField('newPassword', event.target.value)}
        />

        <FormField
          label="Confirm new password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          value={values.confirmPassword}
          error={errors.confirmPassword}
          onChange={(event) => updateField('confirmPassword', event.target.value)}
        />

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradely-navy px-4 py-2.5 text-sm font-semibold text-gradely-white transition-colors hover:bg-[#123c80] disabled:cursor-wait disabled:opacity-70"
        >
          {submitting ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <KeyRound aria-hidden="true" className="size-4" />
          )}
          {submitting ? 'Updating password...' : 'Update password'}
        </button>
      </form>
    </AuthLayout>
  )
}
