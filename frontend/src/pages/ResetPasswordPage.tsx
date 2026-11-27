import { ArrowLeft, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import AuthLayout from '../components/AuthLayout'
import FormField from '../components/FormField'
import { ApiError, resetPassword } from '../lib/api'

const MIN_PASSWORD_LENGTH = 10

type ResetState = 'form' | 'done' | 'error'

/**
 * Password-reset link page.
 *
 * The token is read from the URL, validated server-side, and never rendered or
 * stored beyond the single request. A successful reset does not sign the user
 * in; they are sent back to the login page with their new password.
 */
export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{
    password?: string
    confirmPassword?: string
  }>({})
  const [submitting, setSubmitting] = useState(false)
  const [state, setState] = useState<ResetState>('form')
  const [message, setMessage] = useState<string | null>(null)

  function validate(): boolean {
    const errors: { password?: string; confirmPassword?: string } = {}

    if (password.length < MIN_PASSWORD_LENGTH) {
      errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
    }

    if (password !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match'
    }

    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (submitting) {
      return
    }

    if (!validate()) {
      return
    }

    setSubmitting(true)
    setMessage(null)

    try {
      await resetPassword(token, password)
      setState('done')
    } catch (cause) {
      setState('error')
      setMessage(
        cause instanceof ApiError
          ? cause.message
          : 'We could not reset your password. Please try again.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (state === 'done') {
    return (
      <AuthLayout
        title="Password updated"
        subtitle="Your password has been changed. Sign in with your new password."
        footer={
          <p className="text-sm text-gradely-muted">
            <Link
              to="/login"
              className="font-semibold text-gradely-navy underline decoration-gradely-blue/40 underline-offset-2 hover:text-gradely-blue"
            >
              Sign in
            </Link>
          </p>
        }
      >
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 text-emerald-600" />
          <p className="text-sm text-emerald-800">
            Password updated. Sign in with your new password.
          </p>
        </div>
      </AuthLayout>
    )
  }

  if (state === 'error') {
    return (
      <AuthLayout
        title="This link did not work"
        subtitle="Password-reset links are single-use and expire 30 minutes after they are sent."
        footer={
          <p className="text-sm text-gradely-muted">
            <Link
              to="/forgot-password"
              className="inline-flex items-center gap-1 font-semibold text-gradely-navy underline decoration-gradely-blue/40 underline-offset-2 hover:text-gradely-blue"
            >
              <ArrowLeft aria-hidden="true" className="size-3.5" />
              Request a new link
            </Link>
          </p>
        }
      >
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-4">
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-5 text-red-600" />
          <div>
            <p className="text-sm font-semibold text-red-900">
              Password reset failed
            </p>
            <p className="mt-1 text-sm text-red-800">
              {message ??
                'This link is invalid, has expired, or has already been used.'}
            </p>
          </div>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Choose a new password"
      subtitle="Enter a new password for your account. You will need to sign in again afterwards."
      footer={
        <p className="text-sm text-gradely-muted">
          <Link
            to="/login"
            className="inline-flex items-center gap-1 font-semibold text-gradely-navy underline decoration-gradely-blue/40 underline-offset-2 hover:text-gradely-blue"
          >
            <ArrowLeft aria-hidden="true" className="size-3.5" />
            Back to login
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <FormField
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          maxLength={128}
          value={password}
          error={fieldErrors.password}
          onChange={(event) => {
            setPassword(event.target.value)
            setFieldErrors((current) => ({ ...current, password: undefined }))
          }}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        />

        <FormField
          label="Confirm new password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          maxLength={128}
          value={confirmPassword}
          error={fieldErrors.confirmPassword}
          onChange={(event) => {
            setConfirmPassword(event.target.value)
            setFieldErrors((current) => ({
              ...current,
              confirmPassword: undefined,
            }))
          }}
        />

        <button
          type="submit"
          disabled={submitting || token === ''}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradely-navy px-4 py-2.5 text-sm font-semibold text-gradely-white transition-colors hover:bg-[#123c80] disabled:cursor-wait disabled:opacity-70"
        >
          {submitting ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : null}
          {submitting ? 'Updating...' : 'Update password'}
        </button>
      </form>
    </AuthLayout>
  )
}
