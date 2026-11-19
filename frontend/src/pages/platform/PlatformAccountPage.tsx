import {
  CheckCircle2,
  KeyRound,
  Laptop,
  Mail,
  RefreshCw,
  Save,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import AutoSaveIndicator from '../../components/AutoSaveIndicator'
import FormField from '../../components/FormField'
import {
  Badge,
  Button,
  ConfirmDialog,
  ErrorNotice,
  LoadingPanel,
  PageHeader,
  Panel,
} from '../../components/ui'
import { useAuth } from '../../auth/use-auth'
import { formatDateTime } from '../../lib/format'
import { useAutoSave } from '../../lib/use-auto-save'
import {
  changePlatformAccountEmail,
  changePlatformAccountPassword,
  getPlatformAccount,
  listPlatformAccountSessions,
  revokeOtherPlatformAccountSessions,
  updatePlatformAccountProfile,
} from '../../platform/api'
import type {
  PlatformAccount,
  PlatformAccountSession,
} from '../../platform/types'

type Busy = 'email' | 'password' | 'sessions' | null

export default function PlatformAccountPage() {
  const { refresh } = useAuth()
  const [account, setAccount] = useState<PlatformAccount | null>(null)
  const [sessions, setSessions] = useState<PlatformAccountSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<Busy>(null)

  const [profile, setProfile] = useState({ firstName: '', lastName: '' })

  const [emailForm, setEmailForm] = useState({ email: '', currentPassword: '' })
  const [emailError, setEmailError] = useState<string | null>(null)

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })
  const [passwordError, setPasswordError] = useState<string | null>(null)

  const [revokeOpen, setRevokeOpen] = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)

  const apply = useCallback((next: PlatformAccount) => {
    setAccount(next)
    setProfile({ firstName: next.firstName, lastName: next.lastName })
    setEmailForm((current) => ({ ...current, email: next.email }))
  }, [])

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const [accountResponse, sessionResponse] = await Promise.all([
        getPlatformAccount(),
        listPlatformAccountSessions(),
      ])
      apply(accountResponse.account)
      setSessions(sessionResponse.sessions)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load your platform account.',
      )
    } finally {
      setLoading(false)
    }
  }, [apply])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const profileAutoSave = useAutoSave({
    value: profile,
    enabled: account !== null && !loading,
    canSave:
      profile.firstName.trim().length >= 2 &&
      profile.lastName.trim().length >= 2,
    save: async (next) => {
      const response = await updatePlatformAccountProfile({
        firstName: next.firstName.trim(),
        lastName: next.lastName.trim(),
      })
      setAccount(response.account)
      await refresh()
    },
  })

  async function saveEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (busy) return

    setBusy('email')
    setEmailError(null)
    setNotice(null)

    try {
      const response = await changePlatformAccountEmail({
        email: emailForm.email.trim(),
        currentPassword: emailForm.currentPassword,
      })
      apply(response.account)
      setEmailForm((current) => ({ ...current, currentPassword: '' }))
      await Promise.all([refresh(), load()])
      setNotice(
        'Sign-in email updated. Other sessions were signed out; this session remains active.',
      )
    } catch (cause) {
      setEmailError(
        cause instanceof Error ? cause.message : 'Could not update your email.',
      )
    } finally {
      setBusy(null)
    }
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (busy) return

    setPasswordError(null)
    setNotice(null)

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('The new passwords do not match.')
      return
    }

    setBusy('password')

    try {
      const response = await changePlatformAccountPassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      })
      setPasswordForm({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      })
      await load()
      setNotice(response.message)
    } catch (cause) {
      setPasswordError(
        cause instanceof Error
          ? cause.message
          : 'Could not change your password.',
      )
    } finally {
      setBusy(null)
    }
  }

  async function revokeOthers() {
    setBusy('sessions')
    setSessionError(null)
    setNotice(null)

    try {
      const response = await revokeOtherPlatformAccountSessions()
      setRevokeOpen(false)
      await load()
      setNotice(
        response.revoked === 0
          ? 'No other active sessions were found.'
          : `${response.revoked} other session(s) revoked. This session remains active.`,
      )
    } catch (cause) {
      setSessionError(
        cause instanceof Error
          ? cause.message
          : 'Could not revoke other sessions.',
      )
    } finally {
      setBusy(null)
    }
  }

  const otherSessions = sessions.filter((session) => !session.current)

  return (
    <div className="space-y-6">
      <PageHeader
        title="My account"
        description="Your Platform Super Admin identity. This account has no school membership and cannot be used for school-scoped features."
        actions={
          <Button variant="secondary" onClick={() => void load()} loading={loading}>
            <RefreshCw aria-hidden="true" className="size-4" />
            Refresh
          </Button>
        }
      />

      {error ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}
      {notice ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-2xl border border-gradely-green/30 bg-gradely-green/10 p-4 text-sm text-[#137026]"
        >
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {notice}
        </div>
      ) : null}

      {loading && !account ? (
        <LoadingPanel label="Loading your account…" />
      ) : null}

      {account ? (
        <>
          <Panel>
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-gradely-light text-gradely-navy">
                <UserRound aria-hidden="true" className="size-7" />
              </span>
              <div className="flex-1">
                <h2 className="text-lg font-bold text-gradely-text">
                  {account.firstName} {account.lastName}
                </h2>
                <p className="text-sm text-gradely-muted">{account.email}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone="info">
                  <ShieldCheck aria-hidden="true" className="mr-1 size-3.5" />
                  PLATFORM_SUPER_ADMIN
                </Badge>
                <Badge tone={account.isActive ? 'success' : 'warning'}>
                  {account.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </div>
            </div>
            <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
              <div className="rounded-xl bg-gradely-light p-3">
                <dt className="uppercase tracking-wide text-gradely-muted">
                  Account created
                </dt>
                <dd className="mt-1 font-semibold text-gradely-text">
                  {formatDateTime(account.createdAt)}
                </dd>
              </div>
              <div className="rounded-xl bg-gradely-light p-3">
                <dt className="uppercase tracking-wide text-gradely-muted">
                  Last sign-in
                </dt>
                <dd className="mt-1 font-semibold text-gradely-text">
                  {account.lastLoginAt
                    ? formatDateTime(account.lastLoginAt)
                    : 'Not recorded'}
                </dd>
              </div>
              <div className="rounded-xl bg-gradely-light p-3">
                <dt className="uppercase tracking-wide text-gradely-muted">
                  School memberships
                </dt>
                <dd className="mt-1 font-semibold text-gradely-text">None</dd>
              </div>
            </dl>
          </Panel>

          <div className="grid gap-6 xl:grid-cols-2">
            <Panel>
              <h2 className="flex items-center gap-2 text-base font-bold text-gradely-text">
                <UserRound aria-hidden="true" className="size-5 text-gradely-blue" />
                Profile
              </h2>
              <div className="mt-3 flex justify-end">
                <AutoSaveIndicator
                  {...profileAutoSave}
                  onRetry={() => void profileAutoSave.retry()}
                />
              </div>
              <form
                onSubmit={(event) => event.preventDefault()}
                className="mt-4 space-y-4"
              >
                <FormField
                  label="First name"
                  value={profile.firstName}
                  onChange={(event) =>
                    setProfile((current) => ({
                      ...current,
                      firstName: event.target.value,
                    }))
                  }
                  onBlur={() => void profileAutoSave.flush()}
                  required
                />
                <FormField
                  label="Last name"
                  value={profile.lastName}
                  onChange={(event) =>
                    setProfile((current) => ({
                      ...current,
                      lastName: event.target.value,
                    }))
                  }
                  onBlur={() => void profileAutoSave.flush()}
                  required
                />
                <p className="text-xs text-gradely-muted">
                  Name changes save automatically.
                </p>
              </form>
            </Panel>

            <Panel>
              <h2 className="flex items-center gap-2 text-base font-bold text-gradely-text">
                <Mail aria-hidden="true" className="size-5 text-gradely-blue" />
                Sign-in email
              </h2>
              <p className="mt-1 text-sm text-gradely-muted">
                Changing your email signs out every other session.
              </p>
              <form onSubmit={saveEmail} className="mt-4 space-y-4">
                {emailError ? <ErrorNotice message={emailError} /> : null}
                <FormField
                  label="Email address"
                  type="email"
                  value={emailForm.email}
                  onChange={(event) =>
                    setEmailForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  required
                />
                <FormField
                  label="Current password"
                  type="password"
                  autoComplete="current-password"
                  value={emailForm.currentPassword}
                  onChange={(event) =>
                    setEmailForm((current) => ({
                      ...current,
                      currentPassword: event.target.value,
                    }))
                  }
                  required
                />
                <div className="flex justify-end">
                  <Button type="submit" loading={busy === 'email'}>
                    <Save aria-hidden="true" className="size-4" />
                    Update email
                  </Button>
                </div>
              </form>
            </Panel>

            <Panel>
              <h2 className="flex items-center gap-2 text-base font-bold text-gradely-text">
                <KeyRound aria-hidden="true" className="size-5 text-gradely-blue" />
                Password
              </h2>
              <p className="mt-1 text-sm text-gradely-muted">
                Passwords are stored using the same hashing used by the login
                page.
              </p>
              <form onSubmit={savePassword} className="mt-4 space-y-4">
                {passwordError ? <ErrorNotice message={passwordError} /> : null}
                <FormField
                  label="Current password"
                  type="password"
                  autoComplete="current-password"
                  value={passwordForm.currentPassword}
                  onChange={(event) =>
                    setPasswordForm((current) => ({
                      ...current,
                      currentPassword: event.target.value,
                    }))
                  }
                  required
                />
                <FormField
                  label="New password"
                  type="password"
                  autoComplete="new-password"
                  hint="At least 12 characters."
                  value={passwordForm.newPassword}
                  onChange={(event) =>
                    setPasswordForm((current) => ({
                      ...current,
                      newPassword: event.target.value,
                    }))
                  }
                  required
                />
                <FormField
                  label="Confirm new password"
                  type="password"
                  autoComplete="new-password"
                  value={passwordForm.confirmPassword}
                  onChange={(event) =>
                    setPasswordForm((current) => ({
                      ...current,
                      confirmPassword: event.target.value,
                    }))
                  }
                  required
                />
                <div className="flex justify-end">
                  <Button type="submit" loading={busy === 'password'}>
                    <KeyRound aria-hidden="true" className="size-4" />
                    Change password
                  </Button>
                </div>
              </form>
            </Panel>

            <Panel>
              <h2 className="flex items-center gap-2 text-base font-bold text-gradely-text">
                <Laptop aria-hidden="true" className="size-5 text-gradely-blue" />
                Active sessions
              </h2>
              <p className="mt-1 text-sm text-gradely-muted">
                {sessions.length} active session(s). This browser is marked as
                current.
              </p>
              {sessionError ? <ErrorNotice message={sessionError} /> : null}
              <ul className="mt-4 space-y-2 text-xs">
                {sessions.map((session) => (
                  <li
                    key={session.id}
                    className="rounded-xl border border-slate-200 p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-gradely-text">
                        {session.current ? 'This session' : 'Other session'}
                      </span>
                      {session.current ? <Badge tone="success">Current</Badge> : null}
                    </div>
                    <p className="mt-1 text-gradely-muted">
                      {session.userAgent ?? 'Unknown device'}
                    </p>
                    <p className="text-gradely-muted">
                      {session.ipAddress ?? 'Unknown IP'} · last used{' '}
                      {formatDateTime(session.lastUsedAt)}
                    </p>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex justify-end">
                <Button
                  variant="secondary"
                  disabled={otherSessions.length === 0 || busy === 'sessions'}
                  onClick={() => {
                    setSessionError(null)
                    setRevokeOpen(true)
                  }}
                >
                  Revoke other sessions
                </Button>
              </div>
            </Panel>
          </div>
        </>
      ) : null}

      <ConfirmDialog
        open={revokeOpen}
        title="Revoke other sessions"
        description="Every other browser session for this platform account will be signed out. This session remains active."
        confirmLabel="Revoke other sessions"
        danger
        busy={busy === 'sessions'}
        onConfirm={() => void revokeOthers()}
        onCancel={() => {
          if (busy !== 'sessions') setRevokeOpen(false)
        }}
      />
    </div>
  )
}
