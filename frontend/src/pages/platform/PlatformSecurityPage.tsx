import {
  CheckCircle2,
  KeyRound,
  Laptop,
  Lock,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Smartphone,
} from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import FormField from '../../components/FormField'
import {
  Badge,
  Button,
  ConfirmDialog,
  ErrorNotice,
  LoadingPanel,
  Modal,
  PageHeader,
  Panel,
} from '../../components/ui'
import { formatDateTime } from '../../lib/format'
import {
  confirmPlatformMfaEnrollment,
  disablePlatformMfa,
  getPlatformSecurity,
  regeneratePlatformRecoveryCodes,
  revokePlatformSession,
  startPlatformMfaEnrollment,
} from '../../platform/api'
import { usePlatformReauth } from '../../platform/reauth-context'
import { PLATFORM_REAUTH_PURPOSE } from '../../platform/reauth-purpose'
import type { PlatformSecurityOverview } from '../../platform/types'

type Busy = 'enroll' | 'confirm' | 'disable' | 'recovery' | 'revoke' | null

export default function PlatformSecurityPage() {
  const { ensureReauth } = usePlatformReauth()
  const [overview, setOverview] = useState<PlatformSecurityOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<Busy>(null)

  const [enrollment, setEnrollment] = useState<{
    secret: string
    otpauthUri: string
  } | null>(null)
  const [confirmCode, setConfirmCode] = useState('')
  const [enrollError, setEnrollError] = useState<string | null>(null)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)

  const [disableOpen, setDisableOpen] = useState(false)
  const [disableForm, setDisableForm] = useState({ password: '', code: '' })
  const [disableError, setDisableError] = useState<string | null>(null)

  const [recoveryOpen, setRecoveryOpen] = useState(false)
  const [recoveryCode, setRecoveryCode] = useState('')
  const [recoveryError, setRecoveryError] = useState<string | null>(null)

  const [revokeTarget, setRevokeTarget] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      setOverview(await getPlatformSecurity())
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load your security overview.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  async function beginEnrollment() {
    setBusy('enroll')
    setEnrollError(null)
    setNotice(null)

    try {
      const result = await startPlatformMfaEnrollment()
      setEnrollment({ secret: result.secret, otpauthUri: result.otpauthUri })
      setConfirmCode('')
    } catch (cause) {
      setEnrollError(
        cause instanceof Error
          ? cause.message
          : 'Could not start multi-factor authentication setup.',
      )
    } finally {
      setBusy(null)
    }
  }

  async function confirmEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy('confirm')
    setEnrollError(null)

    try {
      const result = await confirmPlatformMfaEnrollment(confirmCode.trim())
      setRecoveryCodes(result.recoveryCodes)
      setEnrollment(null)
      setConfirmCode('')
      await load()
      setNotice(
        'Multi-factor authentication is enabled. Store the recovery codes somewhere safe; they are shown once.',
      )
    } catch (cause) {
      setEnrollError(
        cause instanceof Error
          ? cause.message
          : 'Could not confirm the authenticator code.',
      )
    } finally {
      setBusy(null)
    }
  }

  async function disableMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy('disable')
    setDisableError(null)

    const token = await ensureReauth(
      PLATFORM_REAUTH_PURPOSE.security,
      'Disabling multi-factor authentication weakens this platform account. Confirm your identity to continue.',
    )

    if (!token) {
      setBusy(null)
      return
    }

    try {
      await disablePlatformMfa(
        {
          password: disableForm.password,
          code: disableForm.code.trim(),
        },
        token,
      )
      setDisableOpen(false)
      setDisableForm({ password: '', code: '' })
      await load()
      setNotice('Multi-factor authentication has been disabled.')
    } catch (cause) {
      setDisableError(
        cause instanceof Error
          ? cause.message
          : 'Could not disable multi-factor authentication.',
      )
    } finally {
      setBusy(null)
    }
  }

  async function regenerateRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy('recovery')
    setRecoveryError(null)

    const token = await ensureReauth(
      PLATFORM_REAUTH_PURPOSE.security,
      'Generating new recovery codes invalidates the previous set. Confirm your identity to continue.',
    )

    if (!token) {
      setBusy(null)
      return
    }

    try {
      const result = await regeneratePlatformRecoveryCodes(
        recoveryCode.trim(),
        token,
      )
      setRecoveryCodes(result.recoveryCodes)
      setRecoveryOpen(false)
      setRecoveryCode('')
      await load()
      setNotice('New recovery codes generated. The previous codes no longer work.')
    } catch (cause) {
      setRecoveryError(
        cause instanceof Error
          ? cause.message
          : 'Could not regenerate recovery codes.',
      )
    } finally {
      setBusy(null)
    }
  }

  async function revokeSession() {
    if (!revokeTarget) return

    setBusy('revoke')
    setError(null)

    const token = await ensureReauth(
      PLATFORM_REAUTH_PURPOSE.sessionRevoke,
      'Revoking a session signs that browser out immediately. Confirm your identity to continue.',
    )

    if (!token) {
      setBusy(null)
      return
    }

    try {
      await revokePlatformSession(revokeTarget, token)
      setRevokeTarget(null)
      await load()
      setNotice('The selected session was revoked.')
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not revoke the session.',
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security & sessions"
        description="Multi-factor authentication, login monitoring, security history and active-session control for your platform account."
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
      {loading && !overview ? (
        <LoadingPanel label="Loading security overview…" />
      ) : null}

      {overview ? (
        <>
          <div className="grid gap-6 xl:grid-cols-2">
            <Panel>
              <div className="flex items-start justify-between gap-3">
                <h2 className="flex items-center gap-2 text-base font-bold text-gradely-text">
                  <ShieldCheck
                    aria-hidden="true"
                    className="size-5 text-gradely-blue"
                  />
                  Multi-factor authentication
                </h2>
                <Badge tone={overview.mfa.enabled ? 'success' : 'warning'}>
                  {overview.mfa.enabled ? 'Enabled' : 'Not enabled'}
                </Badge>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-gradely-muted">
                {overview.mfa.enabled
                  ? `Enabled ${overview.mfa.enabledAt ? formatDateTime(overview.mfa.enabledAt) : ''}. ${overview.mfa.recoveryCodesRemaining} recovery code(s) remaining.`
                  : 'Optional for this platform account. When enabled, a TOTP authenticator or recovery code is required at sign-in and for sensitive actions.'}
              </p>
              {!overview.mfa.configured && overview.mfa.configurationMessage ? (
                <p className="mt-2 rounded-xl border border-gradely-gold/30 bg-gradely-gold/10 p-3 text-xs text-[#7a5400]">
                  {overview.mfa.configurationMessage}
                </p>
              ) : null}

              {enrollment ? (
                <form onSubmit={confirmEnrollment} className="mt-4 space-y-3">
                  {enrollError ? <ErrorNotice message={enrollError} /> : null}
                  <div className="rounded-xl bg-gradely-light p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gradely-muted">
                      Manual setup key
                    </p>
                    <p className="mt-1 break-all font-mono text-sm text-gradely-text">
                      {enrollment.secret}
                    </p>
                    <p className="mt-2 break-all text-xs text-gradely-muted">
                      {enrollment.otpauthUri}
                    </p>
                  </div>
                  <FormField
                    label="Authenticator code"
                    value={confirmCode}
                    onChange={(event) => setConfirmCode(event.target.value)}
                    autoComplete="one-time-code"
                    required
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setEnrollment(null)}
                      disabled={busy === 'confirm'}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" loading={busy === 'confirm'}>
                      Confirm and enable
                    </Button>
                  </div>
                </form>
              ) : overview.mfa.enabled ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setRecoveryError(null)
                      setRecoveryCode('')
                      setRecoveryOpen(true)
                    }}
                  >
                    <KeyRound aria-hidden="true" className="size-4" />
                    Regenerate recovery codes
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => {
                      setDisableError(null)
                      setDisableForm({ password: '', code: '' })
                      setDisableOpen(true)
                    }}
                  >
                    <ShieldOff aria-hidden="true" className="size-4" />
                    Disable MFA
                  </Button>
                </div>
              ) : (
                <div className="mt-4">
                  {enrollError ? <ErrorNotice message={enrollError} /> : null}
                  <Button
                    onClick={() => void beginEnrollment()}
                    loading={busy === 'enroll'}
                    disabled={!overview.mfa.configured}
                  >
                    <Smartphone aria-hidden="true" className="size-4" />
                    Set up authenticator
                  </Button>
                </div>
              )}
            </Panel>

            <Panel>
              <h2 className="flex items-center gap-2 text-base font-bold text-gradely-text">
                <Lock aria-hidden="true" className="size-5 text-gradely-blue" />
                Login monitoring
              </h2>
              <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
                <div className="rounded-xl bg-gradely-light p-3">
                  <dt className="uppercase tracking-wide text-gradely-muted">
                    Last sign-in
                  </dt>
                  <dd className="mt-1 font-semibold text-gradely-text">
                    {overview.lastLoginAt
                      ? formatDateTime(overview.lastLoginAt)
                      : 'Not recorded'}
                  </dd>
                </div>
                <div className="rounded-xl bg-gradely-light p-3">
                  <dt className="uppercase tracking-wide text-gradely-muted">
                    Failed sign-ins (24h)
                  </dt>
                  <dd className="mt-1 font-semibold text-gradely-text">
                    {overview.failedLogins24h}
                  </dd>
                </div>
                <div className="rounded-xl bg-gradely-light p-3">
                  <dt className="uppercase tracking-wide text-gradely-muted">
                    Locked platform accounts
                  </dt>
                  <dd className="mt-1 font-semibold text-gradely-text">
                    {overview.lockedAccounts}
                  </dd>
                </div>
                <div className="rounded-xl bg-gradely-light p-3">
                  <dt className="uppercase tracking-wide text-gradely-muted">
                    Account lockout
                  </dt>
                  <dd className="mt-1 font-semibold text-gradely-text">
                    {overview.lockout.lockedUntil
                      ? `Until ${formatDateTime(overview.lockout.lockedUntil)}`
                      : 'Not locked'}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-gradely-muted">
                Five consecutive failed sign-ins lock an account for 15 minutes.
              </p>
            </Panel>
          </div>

          <Panel>
            <h2 className="flex items-center gap-2 text-base font-bold text-gradely-text">
              <Laptop aria-hidden="true" className="size-5 text-gradely-blue" />
              Active sessions
            </h2>
            <p className="mt-1 text-sm text-gradely-muted">
              {overview.sessions.length} active session(s). Revoking a session
              takes effect immediately.
            </p>
            <ul className="mt-4 space-y-2 text-xs">
              {overview.sessions.map((session) => (
                <li
                  key={session.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3"
                >
                  <div className="min-w-0">
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
                      {formatDateTime(session.lastUsedAt)} · expires{' '}
                      {formatDateTime(session.expiresAt)}
                    </p>
                  </div>
                  {!session.current ? (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => setRevokeTarget(session.id)}
                    >
                      Revoke
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </Panel>

          <Panel>
            <h2 className="text-base font-bold text-gradely-text">
              Security history
            </h2>
            <ul className="mt-4 space-y-2 text-xs">
              {overview.events.length === 0 ? (
                <li className="text-gradely-muted">No security events recorded.</li>
              ) : (
                overview.events.map((event) => (
                  <li
                    key={event.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3"
                  >
                    <div>
                      <p className="font-semibold text-gradely-text">
                        {event.action.replaceAll('_', ' ')}
                      </p>
                      <p className="text-gradely-muted">
                        {event.entityType}
                        {event.entityId ? ` · ${event.entityId}` : ''}
                        {event.ipAddress ? ` · ${event.ipAddress}` : ''}
                      </p>
                    </div>
                    <span className="text-gradely-muted">
                      {formatDateTime(event.createdAt)}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </Panel>
        </>
      ) : null}

      <Modal
        open={disableOpen}
        title="Disable multi-factor authentication"
        description="This removes the second factor from your platform account. You will confirm your identity first."
        onClose={() => {
          if (busy !== 'disable') setDisableOpen(false)
        }}
      >
        <form onSubmit={disableMfa} className="space-y-4">
          {disableError ? <ErrorNotice message={disableError} /> : null}
          <FormField
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={disableForm.password}
            onChange={(event) =>
              setDisableForm((current) => ({
                ...current,
                password: event.target.value,
              }))
            }
            required
          />
          <FormField
            label="Authenticator or recovery code"
            value={disableForm.code}
            onChange={(event) =>
              setDisableForm((current) => ({
                ...current,
                code: event.target.value,
              }))
            }
            autoComplete="one-time-code"
            required
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDisableOpen(false)}
              disabled={busy === 'disable'}
            >
              Cancel
            </Button>
            <Button type="submit" variant="danger" loading={busy === 'disable'}>
              Disable MFA
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={recoveryOpen}
        title="Regenerate recovery codes"
        description="The previous recovery codes stop working immediately."
        onClose={() => {
          if (busy !== 'recovery') setRecoveryOpen(false)
        }}
      >
        <form onSubmit={regenerateRecovery} className="space-y-4">
          {recoveryError ? <ErrorNotice message={recoveryError} /> : null}
          <FormField
            label="Authenticator or recovery code"
            value={recoveryCode}
            onChange={(event) => setRecoveryCode(event.target.value)}
            autoComplete="one-time-code"
            required
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setRecoveryOpen(false)}
              disabled={busy === 'recovery'}
            >
              Cancel
            </Button>
            <Button type="submit" loading={busy === 'recovery'}>
              Generate new codes
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={recoveryCodes !== null}
        title="Recovery codes"
        description="Store these codes securely. They are shown only once and each can be used one time."
        onClose={() => setRecoveryCodes(null)}
      >
        <ul className="grid gap-2 rounded-xl bg-gradely-light p-4 font-mono text-sm text-gradely-text sm:grid-cols-2">
          {(recoveryCodes ?? []).map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end">
          <Button onClick={() => setRecoveryCodes(null)}>I have saved them</Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={revokeTarget !== null}
        title="Revoke this session?"
        description="That browser will be signed out immediately. This action requires reauthentication and is audited."
        confirmLabel="Revoke session"
        danger
        busy={busy === 'revoke'}
        onConfirm={() => void revokeSession()}
        onCancel={() => {
          if (busy !== 'revoke') setRevokeTarget(null)
        }}
      />
    </div>
  )
}
