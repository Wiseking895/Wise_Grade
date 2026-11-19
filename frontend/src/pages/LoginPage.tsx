import { Loader2, LogIn } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import type { AuthUser } from '../auth/types'
import { useAuth } from '../auth/use-auth'
import AuthLayout from '../components/AuthLayout'
import FormField from '../components/FormField'
import { ApiError } from '../lib/api'
import {
  hasErrors,
  validateLogin,
  type FieldErrors,
} from '../lib/validation'

interface LoginLocationState {
  from?: string
}

function safeRedirectTarget(value: unknown): string {
  if (typeof value !== 'string') {
    return '/dashboard'
  }

  // Only same-application paths, never protocol-relative or absolute URLs.
  if (!value.startsWith('/') || value.startsWith('//')) {
    return '/dashboard'
  }

  return value
}

function landingFor(user: AuthUser, from: unknown): string {
  if (user.mustChangePassword) {
    return '/change-password'
  }

  if (user.isPlatformAdmin) {
    const requested = safeRedirectTarget(from)
    return requested.startsWith('/platform') ? requested : '/platform'
  }

  if (user.emailVerificationRequired && !user.emailVerified) {
    return '/verify-email'
  }

  return safeRedirectTarget(from)
}

export default function LoginPage() {
  const { status, user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [values, setValues] = useState({ email: '', password: '' })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (status === 'authenticated') {
    return (
      <Navigate
        to={
          user
            ? landingFor(user, null)
            : '/dashboard'
        }
        replace
      />
    )
  }

  function updateField(field: 'email' | 'password', value: string) {
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

    const clientErrors = validateLogin(values)
    setErrors(clientErrors)
    setFormError(null)

    if (hasErrors(clientErrors)) {
      return
    }

    setSubmitting(true)

    try {
      const session = await login(values.email.trim(), values.password)
      const from = (location.state as LoginLocationState | null)?.from
      navigate(landingFor(session.user, from), { replace: true })
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(error.message)

        if (error.details.length > 0) {
          setErrors(
            Object.fromEntries(
              error.details.map((detail) => [detail.field, detail.message]),
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

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to your Wise Grade account to continue to your school."
      footer={
        <div className="space-y-2 text-sm text-gradely-muted">
          <p>
            New to Wise Grade?{' '}
            <Link
              to="/register"
              className="font-semibold text-gradely-navy underline decoration-gradely-blue/40 underline-offset-2 hover:text-gradely-blue"
            >
              Register your school
            </Link>
          </p>
          <p>
            Subject teacher with an access code?{' '}
            <Link
              to="/access-code"
              className="font-semibold text-gradely-navy underline decoration-gradely-blue/40 underline-offset-2 hover:text-gradely-blue"
            >
              Enter access code
            </Link>
          </p>
        </div>
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
          label="Email address"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          value={values.email}
          error={errors.email}
          onChange={(event) => updateField('email', event.target.value)}
        />

        <FormField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={values.password}
          error={errors.password}
          onChange={(event) => updateField('password', event.target.value)}
        />

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradely-navy px-4 py-2.5 text-sm font-semibold text-gradely-white transition-colors hover:bg-[#123c80] disabled:cursor-wait disabled:opacity-70"
        >
          {submitting ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <LogIn aria-hidden="true" className="size-4" />
          )}
          {submitting ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </AuthLayout>
  )
}
