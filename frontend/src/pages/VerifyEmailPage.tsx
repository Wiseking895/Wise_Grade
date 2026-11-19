import { CheckCircle2, Loader2, MailCheck, Send, ShieldAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/use-auth'
import AuthLayout from '../components/AuthLayout'
import { ApiError } from '../lib/api'

type VerificationState = 'idle' | 'verifying' | 'verified' | 'error'

/**
 * Handles both sides of administrator email verification:
 *
 * 1. A verification link (`/verify-email?token=...`) confirms the token once.
 * 2. A signed-in, unverified administrator can request a fresh link here.
 *
 * The token is never stored in application state beyond the request and is
 * never rendered. The previous link is invalidated by the API on resend.
 */
export default function VerifyEmailPage() {
  const { status, user, confirmEmailVerification, resendEmailVerification, logout } =
    useAuth()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const [state, setState] = useState<VerificationState>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resendState, setResendState] = useState<'idle' | 'sending'>('idle')
  const [resendMessage, setResendMessage] = useState<string | null>(null)
  const [resendError, setResendError] = useState<string | null>(null)
  const submittedToken = useRef<string | null>(null)

  const needsVerification =
    status === 'authenticated' &&
    user !== null &&
    !user.isPlatformAdmin &&
    user.emailVerificationRequired &&
    !user.emailVerified

  useEffect(() => {
    if (!token || submittedToken.current === token) {
      return
    }

    submittedToken.current = token
    setState('verifying')
    setError(null)

    void confirmEmailVerification(token)
      .then((result) => {
        setMessage(result)
        setState('verified')
      })
      .catch((cause: unknown) => {
        setError(
          cause instanceof ApiError
            ? cause.message
            : 'We could not verify this link. Please try again.',
        )
        setState('error')
      })
  }, [confirmEmailVerification, token])

  async function handleResend() {
    if (resendState === 'sending') {
      return
    }

    setResendState('sending')
    setResendError(null)
    setResendMessage(null)

    try {
      setResendMessage(await resendEmailVerification())
    } catch (cause) {
      setResendError(
        cause instanceof ApiError
          ? cause.message
          : 'We could not send a new link. Please try again.',
      )
    } finally {
      setResendState('idle')
    }
  }

  if (state === 'verifying') {
    return (
      <AuthLayout
        title="Verifying your email"
        subtitle="Please wait while we confirm this single-use verification link."
      >
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-3 rounded-xl border border-slate-200 bg-gradely-light px-4 py-4 text-sm font-medium text-gradely-muted"
        >
          <Loader2 aria-hidden="true" className="size-5 animate-spin text-gradely-blue" />
          Confirming your verification link...
        </div>
      </AuthLayout>
    )
  }

  if (state === 'verified') {
    return (
      <AuthLayout
        title="Email verified"
        subtitle="Your Wise Grade administrator account is now fully active."
        footer={
          <p className="text-sm text-gradely-muted">
            <Link
              to={status === 'authenticated' ? '/dashboard' : '/login'}
              className="font-semibold text-gradely-navy underline decoration-gradely-blue/40 underline-offset-2 hover:text-gradely-blue"
            >
              {status === 'authenticated' ? 'Continue to your dashboard' : 'Sign in'}
            </Link>
          </p>
        }
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
            <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 text-emerald-600" />
            <div>
              <p className="text-sm font-semibold text-emerald-900">
                Verification complete
              </p>
              <p className="mt-1 text-sm text-emerald-800">
                {message ?? 'Your email address is verified.'}
              </p>
            </div>
          </div>
          <p className="text-sm leading-relaxed text-gradely-muted">
            You can now register classes and class teachers, review results and
            prepare report cards.
          </p>
        </div>
      </AuthLayout>
    )
  }

  if (token && state === 'error') {
    return (
      <AuthLayout
        title="This link did not work"
        subtitle="Verification links are single-use and expire 24 hours after they are sent."
        footer={
          <p className="text-sm text-gradely-muted">
            <Link
              to={status === 'authenticated' ? '/dashboard' : '/login'}
              className="font-semibold text-gradely-navy underline decoration-gradely-blue/40 underline-offset-2 hover:text-gradely-blue"
            >
              {status === 'authenticated' ? 'Back to your dashboard' : 'Back to login'}
            </Link>
          </p>
        }
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-4">
            <ShieldAlert aria-hidden="true" className="mt-0.5 size-5 text-red-600" />
            <div>
              <p className="text-sm font-semibold text-red-900">
                Verification failed
              </p>
              <p className="mt-1 text-sm text-red-800">
                {error ??
                  'This link is invalid, has expired, or has already been used.'}
              </p>
            </div>
          </div>

          {needsVerification ? (
            <ResendPanel
              email={user.email}
              sending={resendState === 'sending'}
              message={resendMessage}
              error={resendError}
              onResend={handleResend}
            />
          ) : (
            <p className="text-sm leading-relaxed text-gradely-muted">
              Sign in to your administrator account and choose{' '}
              <span className="font-semibold text-gradely-text">
                Resend verification email
              </span>{' '}
              to receive a new link.
            </p>
          )}
        </div>
      </AuthLayout>
    )
  }

  if (needsVerification) {
    return (
      <AuthLayout
        title="Verify your email address"
        subtitle="School administration stays locked until you confirm that this email address belongs to you."
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
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
            <MailCheck aria-hidden="true" className="mt-0.5 size-5 text-amber-600" />
            <div>
              <p className="text-sm font-semibold text-amber-900">
                Check your inbox
              </p>
              <p className="mt-1 text-sm text-amber-800">
                We sent a verification link to{' '}
                <span className="font-semibold break-all">{user.email}</span>.
                Open it to finish setting up your school. The link expires after
                24 hours.
              </p>
            </div>
          </div>

          <ResendPanel
            email={user.email}
            sending={resendState === 'sending'}
            message={resendMessage}
            error={resendError}
            onResend={handleResend}
          />

          <p className="text-xs leading-relaxed text-gradely-muted">
            Resending creates a new link and immediately invalidates the previous
            one. You can safely request another link if the first email did not
            arrive.
          </p>
        </div>
      </AuthLayout>
    )
  }

  if (status === 'authenticated' && user) {
    return (
      <AuthLayout
        title="Email already verified"
        subtitle="Your administrator account has full access to your school."
        footer={
          <p className="text-sm text-gradely-muted">
            <Link
              to={user.isPlatformAdmin ? '/platform' : '/dashboard'}
              className="font-semibold text-gradely-navy underline decoration-gradely-blue/40 underline-offset-2 hover:text-gradely-blue"
            >
              Continue
            </Link>
          </p>
        }
      >
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 text-emerald-600" />
          <p className="text-sm text-emerald-800">
            This email address is verified. There is nothing else to do.
          </p>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Open your verification link"
      subtitle="Verification links are sent to the email address used when the school was registered."
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
      <div className="rounded-xl border border-slate-200 bg-gradely-light px-4 py-4 text-sm leading-relaxed text-gradely-muted">
        Open the verification link from your inbox on this device, or sign in to
        your administrator account and request a new link.
      </div>
    </AuthLayout>
  )
}

function ResendPanel({
  email,
  sending,
  message,
  error,
  onResend,
}: {
  email: string
  sending: boolean
  message: string | null
  error: string | null
  onResend: () => void
}) {
  return (
    <div className="space-y-3">
      {message ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          {message}
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onResend}
        disabled={sending}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradely-navy px-4 py-2.5 text-sm font-semibold text-gradely-white transition-colors hover:bg-[#123c80] disabled:cursor-wait disabled:opacity-70"
      >
        {sending ? (
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        ) : (
          <Send aria-hidden="true" className="size-4" />
        )}
        {sending ? 'Sending a new link...' : 'Resend verification email'}
      </button>

      <p className="text-center text-xs text-gradely-muted">
        Sending to <span className="font-medium break-all">{email}</span>
      </p>
    </div>
  )
}
