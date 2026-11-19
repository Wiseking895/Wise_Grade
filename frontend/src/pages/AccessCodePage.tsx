import { KeyRound, Loader2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/use-auth'
import AuthLayout from '../components/AuthLayout'
import FormField from '../components/FormField'
import { ApiError } from '../lib/api'

const ACCESS_CODE_LENGTH = 7
const ACCESS_CODE_PATTERN = /^\d{4}[A-Za-z]{3}$/

/**
 * Canonicalises what the teacher typed into the exact `DDDDUll` shape the
 * server stores. Letters may be typed in any case, but the value must still be
 * four digits followed by three letters.
 */
function canonicalAccessCode(value: string): string | null {
  const compact = value.trim().replace(/\s+/g, '')

  if (!ACCESS_CODE_PATTERN.test(compact)) {
    return null
  }

  return `${compact.slice(0, 4)}${compact
    .slice(4, 5)
    .toUpperCase()}${compact.slice(5).toLowerCase()}`
}

/**
 * Opens a restricted subject-teacher workspace from a reusable access code.
 *
 * No account, membership or password is created. The code is bound to one
 * class and subject, and remains valid until the class teacher regenerates or
 * revokes it (or it expires).
 */
export default function AccessCodePage() {
  const { status, enterAccessCode } = useAuth()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (status === 'authenticated') {
    return <Navigate to="/dashboard" replace />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (submitting) {
      return
    }

    setFormError(null)
    setFieldError(null)

    const codeValue = canonicalAccessCode(code)

    if (!codeValue) {
      setFieldError(
        `Enter the ${ACCESS_CODE_LENGTH}-character access code, e.g. 4821Kmw.`,
      )
      return
    }

    setSubmitting(true)

    try {
      await enterAccessCode(codeValue)
      navigate('/dashboard', { replace: true })
    } catch (error) {
      setFormError(
        error instanceof ApiError
          ? error.message
          : 'Could not open the subject workspace. Please try again.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Enter your access code"
      subtitle="Subject teachers open a restricted workspace with the reusable access code their class teacher shared. No account or password is needed."
      footer={
        <p className="text-sm text-gradely-muted">
          <Link
            to="/login"
            className="font-semibold text-gradely-navy underline decoration-gradely-blue/40 underline-offset-2 hover:text-gradely-blue"
          >
            Back to login
          </Link>
        </p>
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

        {formError ? (
          <p className="text-xs leading-relaxed text-gradely-muted">
            Access codes are bound to one class and one subject. If your code has
            expired, been replaced, or belongs to a different assignment, ask the
            class teacher responsible for that class for a replacement code.
          </p>
        ) : null}

        <FormField
          label="Access code"
          name="code"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          maxLength={ACCESS_CODE_LENGTH}
          value={code}
          error={fieldError ?? undefined}
          hint={`${ACCESS_CODE_LENGTH} characters: 4 digits followed by 3 letters, e.g. 4821Kmw. Letter case does not matter.`}
          onChange={(event) => {
            setCode(event.target.value)
            if (fieldError) {
              setFieldError(null)
            }
          }}
        />

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradely-navy px-4 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-gradely-blue disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <KeyRound aria-hidden="true" className="size-4" />
          )}
          {submitting ? 'Checking code...' : 'Continue'}
        </button>

        <p className="text-center text-xs text-gradely-muted">
          Ask your class teacher for a new code if yours has expired or been
          revoked.
        </p>
      </form>
    </AuthLayout>
  )
}
