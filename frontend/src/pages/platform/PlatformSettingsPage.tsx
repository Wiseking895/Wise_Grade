import {
  CheckCircle2,
  Info,
  Lock,
  RefreshCw,
  Save,
  ShieldCheck,
} from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import FormField from '../../components/FormField'
import {
  Badge,
  Button,
  ErrorNotice,
  LoadingPanel,
  PageHeader,
  Panel,
} from '../../components/ui'
import { formatDateTime } from '../../lib/format'
import {
  getPlatformSettings,
  updatePlatformSettings,
} from '../../platform/api'
import { usePlatformReauth } from '../../platform/reauth-context'
import { PLATFORM_REAUTH_PURPOSE } from '../../platform/reauth-purpose'
import type { PlatformSettings } from '../../platform/types'

export default function PlatformSettingsPage() {
  const { ensureReauth } = usePlatformReauth()
  const [settings, setSettings] = useState<PlatformSettings | null>(null)
  const [supportEmail, setSupportEmail] = useState('')
  const [registrationEnabled, setRegistrationEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const apply = useCallback((next: PlatformSettings) => {
    setSettings(next)
    setSupportEmail(next.supportEmail ?? '')
    setRegistrationEnabled(next.registrationEnabled)
  }, [])

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      apply(await getPlatformSettings())
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load platform settings.',
      )
    } finally {
      setLoading(false)
    }
  }, [apply])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (saving) return

    setSaving(true)
    setError(null)
    setNotice(null)

    const token = await ensureReauth(
      PLATFORM_REAUTH_PURPOSE.sensitive,
      'Changing platform-wide settings affects every school. Confirm your identity to continue.',
    )

    if (!token) {
      setSaving(false)
      return
    }

    try {
      const updated = await updatePlatformSettings(
        {
          supportEmail: supportEmail.trim() || null,
          registrationEnabled,
        },
        token,
      )
      apply(updated)
      setNotice('Platform settings saved and recorded in the audit log.')
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not save platform settings.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform settings"
        description="A deliberately small set of platform-wide operational settings. Every change is append-only in the audit log."
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

      {loading && !settings ? (
        <LoadingPanel label="Loading settings…" />
      ) : null}

      {settings ? (
        <form onSubmit={save} className="space-y-6">
          <Panel>
            <div className="flex items-start gap-3">
              <ShieldCheck
                aria-hidden="true"
                className="mt-0.5 size-5 shrink-0 text-gradely-blue"
              />
              <div>
                <h2 className="text-base font-bold text-gradely-text">
                  Operational settings
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-gradely-muted">
                  These are the only settings this dashboard manages. Secrets,
                  provider keys and infrastructure credentials are never exposed
                  here.
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-5">
              <FormField
                label="Platform support email"
                type="email"
                name="supportEmail"
                placeholder="support@wisegrade.app"
                value={supportEmail}
                hint="Shown to schools as the platform contact address. Leave blank to use the default."
                onChange={(event) => setSupportEmail(event.target.value)}
              />

              <div className="rounded-xl border border-slate-200 p-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 rounded border-slate-300 text-gradely-navy focus:ring-gradely-blue/30"
                    checked={registrationEnabled}
                    onChange={(event) =>
                      setRegistrationEnabled(event.target.checked)
                    }
                  />
                  <span>
                    <span className="block text-sm font-semibold text-gradely-text">
                      Allow public school registration
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-gradely-muted">
                      When disabled, the public registration page and endpoint
                      refuse new schools. Existing schools and platform-created
                      schools are unaffected.
                    </span>
                  </span>
                </label>
                <div className="mt-2">
                  <Badge tone={registrationEnabled ? 'success' : 'warning'}>
                    {registrationEnabled
                      ? 'Registration open'
                      : 'Registration closed'}
                  </Badge>
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
              <p className="text-xs text-gradely-muted">
                {settings.updatedAt
                  ? `Last updated ${formatDateTime(settings.updatedAt)}${
                      settings.updatedByName
                        ? ` by ${settings.updatedByName}`
                        : ''
                    }.`
                  : 'No platform setting has been changed yet; defaults are in effect.'}
              </p>
              <Button type="submit" loading={saving}>
                <Save aria-hidden="true" className="size-4" />
                Save settings
              </Button>
            </div>
          </Panel>
        </form>
      ) : null}

      {settings ? (
        <Panel className="bg-gradely-light">
          <h2 className="flex items-center gap-2 text-base font-bold text-gradely-text">
            <Info aria-hidden="true" className="size-5 text-gradely-blue" />
            Read-only platform status
          </h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-white p-3">
              <dt className="text-xs uppercase tracking-wide text-gradely-muted">
                Payment provider
              </dt>
              <dd className="mt-1 text-sm font-semibold text-gradely-text">
                {settings.paymentProvider ?? 'Not configured'}
              </dd>
            </div>
            <div className="rounded-xl bg-white p-3">
              <dt className="text-xs uppercase tracking-wide text-gradely-muted">
                Automatic calendar scheduler
              </dt>
              <dd className="mt-1 text-sm font-semibold text-gradely-text">
                {settings.calendarSchedulerEnabled ? 'Enabled' : 'Disabled'}
              </dd>
            </div>
          </dl>
          <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-gradely-muted">
            <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            Provider credentials and scheduler internals are configured through
            the server environment, not this dashboard.
          </p>
        </Panel>
      ) : null}
    </div>
  )
}
