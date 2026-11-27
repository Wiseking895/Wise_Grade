import { ArrowLeft, Loader2, MailCheck, Send } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import AuthLayout from '../components/AuthLayout'
import FormField from '../components/FormField'
import { requestPasswordReset } from '../lib/api'

/**
 * Forgotten-password request page.
 *
 * The response is deliberately identical whether or not the submitted address
 * is registered, so the page never reveals account existence. It always shows
 * the same generic confirmation after a syntactically valid submission.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  function validate(value: string): string | null {
    const trimmed = value.trim()

    if (trimmed === '') {
      return 'Enter your email address'
    }

    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(trimmed)) {
      return 'Enter a valid email address'
    }

    return null
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (submitting) {
      return
    }

    const error = validate(email)
    setEmailError(error)

    if (error) {
      return
    }

    setSubmitting(true)

    try {
      await requestPasswordReset(email.trim())
      setSent(true)
    } catch {
      // The backend never reveals whether the address exists. Even on an
      // unexpected failure we show the generic confirmation so the caller can
      // simply try again.
      setSent(true)
    } finally {
      setSubmitting(false)
    }
  }

  if (sent) {
    return (
      <AuthLayout
        title="Check your inbox"
        subtitle="If an account is associated with the email address provided, you will receive a password-reset link shortly."
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
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
            <MailCheck aria-hidden="true" className="mt-0.5 size-5 text-emerald-600" />
            <p className="text-sm text-emerald-800">
              If an account is associated with the email address provided, you
              will receive a password-reset link shortly. Please check your inbox
              and spam folder.
            </p>
          </div>
          <p className="text-xs leading-relaxed text-gradely-muted">
            The link is valid for 30 minutes and can only be used once. If you did
            not request a password reset, you can safely ignore it.
          </p>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Forgot your password?"
      subtitle="Enter the email address registered to your account. If an account is associated with this email address, we will send you a link to reset your password."
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
          label="Email address"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          error={emailError ?? undefined}
          onChange={(event) => {
            setEmail(event.target.value)
            setEmailError(null)
          }}
        />

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradely-navy px-4 py-2.5 text-sm font-semibold text-gradely-white transition-colors hover:bg-[#123c80] disabled:cursor-wait disabled:opacity-70"
        >
          {submitting ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Send aria-hidden="true" className="size-4" />
          )}
          {submitting ? 'Sending...' : 'Send Reset Link'}
        </button>
      </form>
    </AuthLayout>
  )
}
