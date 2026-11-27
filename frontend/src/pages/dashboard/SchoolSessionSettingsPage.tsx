import { CalendarRange, Loader2, Save } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  AccessDenied,
  Button,
  ErrorNotice,
  LoadingPanel,
  Modal,
  PageHeader,
  Panel,
} from '../../components/ui'
import FormField from '../../components/FormField'
import { ApiError } from '../../lib/api'
import { formatDate, formatDateTime } from '../../lib/format'
import {
  getSchoolSessionSettings,
  updateSchoolSessionSettings,
} from '../../schools/api'
import type { SchoolSessionSettings } from '../../schools/types'
import { useSchool } from '../../schools/use-school'

interface EditForm {
  reopeningDate: string
  closingDate: string
}

export default function SchoolSessionSettingsPage() {
  const { schoolId, isAdmin } = useSchool()
  const [settings, setSettings] = useState<SchoolSessionSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [editOpen, setEditOpen] = useState(false)
  const [form, setForm] = useState<EditForm>({ reopeningDate: '', closingDate: '' })
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!schoolId) return

    try {
      const { settings: result } = await getSchoolSessionSettings(schoolId)
      setSettings(result)
      setError(null)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load the school session settings.',
      )
    } finally {
      setLoading(false)
    }
  }, [schoolId])

  useEffect(() => {
    // Data fetching is the intended external-system synchronisation here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  function openEdit() {
    if (!settings) return

    setForm({
      reopeningDate: settings.reopeningDate ?? '',
      closingDate: settings.closingDate ?? '',
    })
    setFormError(null)
    setNotice(null)
    setEditOpen(true)
  }

  function update<K extends keyof EditForm>(key: K, value: EditForm[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    setFormError(null)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!schoolId || saving) return

    if (form.reopeningDate === '' || form.closingDate === '') {
      setFormError('Both the reopening and closing dates are required.')
      return
    }

    if (form.closingDate <= form.reopeningDate) {
      setFormError('The closing date must be later than the reopening date.')
      return
    }

    setSaving(true)
    setFormError(null)

    try {
      const { settings: result } = await updateSchoolSessionSettings(schoolId, {
        reopeningDate: form.reopeningDate,
        closingDate: form.closingDate,
      })
      setSettings(result)
      setEditOpen(false)
      setNotice('School session dates updated.')
    } catch (cause) {
      setFormError(
        cause instanceof ApiError
          ? cause.message
          : 'Could not update the school session dates.',
      )
    } finally {
      setSaving(false)
    }
  }

  if (!isAdmin) {
    return (
      <AccessDenied message="Only a school administrator can manage the school session settings." />
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="School Session Settings"
        description="Set the school's reopening and closing dates. Subject-teacher access codes stay valid until the closing date."
      />

      {notice ? (
        <div
          role="status"
          className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          {notice}
        </div>
      ) : null}

      {error ? (
        <ErrorNotice
          message={error}
          onRetry={() => {
            setLoading(true)
            setError(null)
            void load()
          }}
        />
      ) : null}

      {loading ? <LoadingPanel label="Loading school session settings…" /> : null}

      {!loading && settings ? (
        <Panel>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-gradely-text">
                {settings.schoolName}
              </h2>
              <p className="mt-1 text-sm text-gradely-muted">
                Current session:{' '}
                <span className="font-medium text-gradely-text">
                  {settings.currentAcademicYearName ?? 'Not set'}
                </span>
              </p>
            </div>
            <Button onClick={openEdit}>
              <CalendarRange aria-hidden="true" className="size-4" />
              {settings.closingDate ? 'Update Session' : 'Set Session'}
            </Button>
          </div>

          <dl className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-gradely-light/60 px-4 py-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-gradely-muted">
                School reopening date
              </dt>
              <dd className="mt-1 text-lg font-bold text-gradely-navy">
                {formatDate(settings.reopeningDate)}
              </dd>
            </div>
            <div className="rounded-xl border border-slate-200 bg-gradely-light/60 px-4 py-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-gradely-muted">
                School closing date
              </dt>
              <dd className="mt-1 text-lg font-bold text-gradely-navy">
                {formatDate(settings.closingDate)}
              </dd>
            </div>
          </dl>

          <p className="mt-4 text-xs text-gradely-muted">
            {settings.lastUpdatedAt
              ? `Last updated ${formatDateTime(settings.lastUpdatedAt)}${
                  settings.lastUpdatedByName
                    ? ` by ${settings.lastUpdatedByName}`
                    : ''
                }.`
              : 'The session dates have not been configured yet.'}{' '}
            Subject-teacher access codes remain valid until the school closing
            date.
          </p>
        </Panel>
      ) : null}

      <Modal
        open={editOpen}
        title={settings?.closingDate ? 'Update session dates' : 'Set session dates'}
        description="The reopening date must be earlier than the closing date. These dates govern subject-teacher access-code expiry."
        onClose={() => {
          if (!saving) setEditOpen(false)
        }}
      >
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {formError ? (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              {formError}
            </div>
          ) : null}

          <FormField
            label="School reopening date"
            type="date"
            value={form.reopeningDate}
            onChange={(event) => update('reopeningDate', event.target.value)}
            required
          />
          <FormField
            label="School closing date"
            type="date"
            value={form.closingDate}
            onChange={(event) => update('closingDate', event.target.value)}
            required
            hint="Access codes expire at the end of this date in the school's timezone."
          />

          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setEditOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {saving ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <Save aria-hidden="true" className="size-4" />
              )}
              Save dates
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
