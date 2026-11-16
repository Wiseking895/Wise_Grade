import {
  Building2,
  CheckCircle2,
  ImagePlus,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldOff,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { apiAssetUrl } from '../../lib/api'
import { readFileAsBase64 } from '../../lib/files'
import { formatDate, formatDateTime, statusLabel } from '../../lib/format'
import {
  hasErrors,
  validateRegistration,
  type FieldErrors,
} from '../../lib/validation'
import FormField from '../../components/FormField'
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorNotice,
  LoadingPanel,
  Modal,
  PageHeader,
  Panel,
  SelectField,
} from '../../components/ui'
import {
  createPlatformSchool,
  getPlatformSchool,
  listPlatformSchools,
  setPlatformSchoolStatus,
  updatePlatformSchool,
} from '../../platform/api'
import { usePlatformReauth } from '../../platform/reauth-context'
import { PLATFORM_REAUTH_PURPOSE } from '../../platform/reauth-purpose'
import {
  SchoolStatusBadge,
} from '../../platform/components'
import { formatMoney } from '../../platform/format'
import type {
  PlatformSchoolDetail,
  PlatformSchoolStatusFilter,
  PlatformSchoolSummary,
} from '../../platform/types'

const EMPTY_REGISTRATION = {
  schoolName: '',
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  confirmPassword: '',
  landmark: '',
  address: '',
  phone: '',
}

export default function PlatformSchoolsPage() {
  const { ensureReauth } = usePlatformReauth()
  const [schools, setSchools] = useState<PlatformSchoolSummary[]>([])
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [status, setStatus] = useState<PlatformSchoolStatusFilter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<PlatformSchoolDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const [registerOpen, setRegisterOpen] = useState(false)
  const [registration, setRegistration] = useState(EMPTY_REGISTRATION)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [formErrors, setFormErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [statusTarget, setStatusTarget] = useState<PlatformSchoolSummary | null>(null)
  const [statusBusy, setStatusBusy] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)

  const [editOpen, setEditOpen] = useState(false)
  const [editValues, setEditValues] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    landmark: '',
  })
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const loadSchools = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await listPlatformSchools({
        search: appliedSearch || undefined,
        status,
      })
      setSchools(response.schools)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not load schools.',
      )
    } finally {
      setLoading(false)
    }
  }, [appliedSearch, status])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSchools()
  }, [loadSchools])

  const loadDetail = useCallback(async (schoolId: string) => {
    try {
      setDetailLoading(true)
      setDetailError(null)
      const response = await getPlatformSchool(schoolId)
      setDetail(response.school)
    } catch (cause) {
      setDetailError(
        cause instanceof Error ? cause.message : 'Could not load school details.',
      )
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    if (selectedId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadDetail(selectedId)
    } else {
      setDetail(null)
    }
  }, [selectedId, loadDetail])

  const summary = useMemo(() => {
    return {
      total: schools.length,
      active: schools.filter((school) => school.isActive).length,
      suspended: schools.filter((school) => !school.isActive).length,
    }
  }, [schools])

  function updateRegistration(field: keyof typeof EMPTY_REGISTRATION, value: string) {
    setRegistration((current) => ({ ...current, [field]: value }))
    setFormErrors((current) => {
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  function updateLogo(file: File | null) {
    if (logoPreview) {
      URL.revokeObjectURL(logoPreview)
    }

    setLogoFile(file)
    setLogoPreview(file ? URL.createObjectURL(file) : null)
    setFormErrors((current) => {
      const next = { ...current }
      delete next.logo
      return next
    })
  }

  async function submitRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (submitting) return

    const clientErrors = validateRegistration({ ...registration, logo: logoFile })
    setFormErrors(clientErrors)
    setFormError(null)

    if (hasErrors(clientErrors) || !logoFile) {
      return
    }

    setSubmitting(true)

    const token = await ensureReauth(
      PLATFORM_REAUTH_PURPOSE.sensitive,
      'Onboarding a school creates a tenant and its first administrator account. Confirm your identity to continue.',
    )

    if (!token) {
      setSubmitting(false)
      return
    }

    try {
      const base64 = await readFileAsBase64(logoFile)
      const result = await createPlatformSchool(
        {
          schoolName: registration.schoolName.trim(),
          firstName: registration.firstName.trim(),
          lastName: registration.lastName.trim(),
          email: registration.email.trim(),
          password: registration.password,
          landmark: registration.landmark.trim(),
          address: registration.address.trim(),
          phone: registration.phone.trim(),
          logo: {
            mimeType: logoFile.type,
            base64,
            originalName: logoFile.name,
          },
        },
        token,
      )

      setNotice(
        `Registered ${result.school.name}. School administrator: ${result.administrator.email}. Share the password securely; it is never stored in plain text.`,
      )
      setRegisterOpen(false)
      setRegistration(EMPTY_REGISTRATION)
      updateLogo(null)
      await loadSchools()
    } catch (cause) {
      setFormError(
        cause instanceof Error ? cause.message : 'Could not register the school.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function confirmStatusChange() {
    if (!statusTarget) return

    setStatusBusy(true)
    setStatusError(null)

    const token = await ensureReauth(
      PLATFORM_REAUTH_PURPOSE.sensitive,
      'Suspending or reactivating a school changes tenant access. Confirm your identity to continue.',
    )

    if (!token) {
      setStatusBusy(false)
      return
    }

    try {
      const response = await setPlatformSchoolStatus(
        statusTarget.id,
        !statusTarget.isActive,
        undefined,
        token,
      )
      setNotice(
        `${response.school.name} is now ${response.school.isActive ? 'active' : 'suspended'}.`,
      )
      setStatusTarget(null)
      await loadSchools()

      if (selectedId === response.school.id) {
        setDetail(response.school)
      }
    } catch (cause) {
      setStatusError(
        cause instanceof Error ? cause.message : 'Could not change school status.',
      )
    } finally {
      setStatusBusy(false)
    }
  }

  function openEdit(school: PlatformSchoolDetail) {
    setEditValues({
      name: school.name,
      email: school.email ?? '',
      phone: school.phone ?? '',
      address: school.address ?? '',
      landmark: school.landmark ?? '',
    })
    setEditError(null)
    setEditOpen(true)
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selectedId || editBusy) return

    setEditBusy(true)
    setEditError(null)

    try {
      const response = await updatePlatformSchool(selectedId, {
        name: editValues.name.trim(),
        email: editValues.email.trim() || null,
        phone: editValues.phone.trim() || null,
        address: editValues.address.trim() || null,
        landmark: editValues.landmark.trim() || null,
      })
      setDetail(response.school)
      setEditOpen(false)
      setNotice(`${response.school.name} was updated.`)
      await loadSchools()
    } catch (cause) {
      setEditError(
        cause instanceof Error ? cause.message : 'Could not update the school.',
      )
    } finally {
      setEditBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Schools"
        description="Register, inspect, update, activate or suspend every Wise Grade school."
        actions={
          <>
            <Button variant="secondary" onClick={() => void loadSchools()} loading={loading}>
              <RefreshCw aria-hidden="true" className="size-4" />
              Refresh
            </Button>
            <Button onClick={() => setRegisterOpen(true)}>
              <Plus aria-hidden="true" className="size-4" />
              Register school
            </Button>
          </>
        }
      />

      {error ? <ErrorNotice message={error} onRetry={() => void loadSchools()} /> : null}
      {notice ? (
        <div
          role="status"
          className="flex items-start justify-between gap-3 rounded-2xl border border-gradely-green/30 bg-gradely-green/10 p-4 text-sm text-[#137026]"
        >
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      ) : null}

      <Panel>
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault()
            setAppliedSearch(search.trim())
          }}
        >
          <div className="flex-1">
            <FormField
              label="Search schools"
              name="search"
              placeholder="Name, slug or email"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="sm:w-48">
            <SelectField
              label="Status"
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as PlatformSchoolStatusFilter)
              }
            >
              <option value="all">All schools</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </SelectField>
          </div>
          <Button type="submit" variant="secondary">
            <Search aria-hidden="true" className="size-4" />
            Search
          </Button>
        </form>

        <p className="mt-3 text-xs text-gradely-muted">
          {summary.total} school(s) shown · {summary.active} active ·{' '}
          {summary.suspended} suspended
        </p>

        {loading ? (
          <div className="mt-4">
            <LoadingPanel label="Loading schools…" />
          </div>
        ) : schools.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No schools match this filter"
              description="Register a school or adjust the search and status filter."
              icon={Building2}
            />
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gradely-muted">
                  <th className="px-3 py-2 font-semibold">School</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Pupils</th>
                  <th className="px-3 py-2 font-semibold">Teachers</th>
                  <th className="px-3 py-2 font-semibold">Current term</th>
                  <th className="px-3 py-2 font-semibold">Outstanding</th>
                  <th className="px-3 py-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {schools.map((school) => (
                  <tr key={school.id} className="align-top">
                    <td className="px-3 py-3">
                      <p className="font-semibold text-gradely-text">{school.name}</p>
                      <p className="text-xs text-gradely-muted">
                        {school.email ?? school.slug}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <SchoolStatusBadge isActive={school.isActive} />
                    </td>
                    <td className="px-3 py-3 text-gradely-text">{school.pupilCount}</td>
                    <td className="px-3 py-3 text-gradely-text">{school.teacherCount}</td>
                    <td className="px-3 py-3 text-gradely-muted">
                      {school.currentTermName
                        ? `${school.currentTermName} (${school.currentTermStatus})`
                        : '—'}
                    </td>
                    <td className="px-3 py-3 text-gradely-text">
                      {formatMoney(school.outstandingMinor, school.currency)}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setSelectedId(school.id)}
                        >
                          View
                        </Button>
                        <Button
                          size="sm"
                          variant={school.isActive ? 'danger' : 'primary'}
                          onClick={() => {
                            setStatusError(null)
                            setStatusTarget(school)
                          }}
                        >
                          {school.isActive ? 'Suspend' : 'Activate'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        title="Register a school"
        description="Uses the existing school onboarding fields. The first administrator is created with no platform privileges."
        wide
      >
        <form onSubmit={submitRegistration} className="space-y-4" noValidate>
          {formError ? (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {formError}
            </div>
          ) : null}

          <FormField
            label="School name"
            name="schoolName"
            value={registration.schoolName}
            error={formErrors.schoolName}
            onChange={(event) => updateRegistration('schoolName', event.target.value)}
            required
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Administrator first name"
              name="firstName"
              value={registration.firstName}
              error={formErrors.firstName}
              onChange={(event) => updateRegistration('firstName', event.target.value)}
              required
            />
            <FormField
              label="Administrator last name"
              name="lastName"
              value={registration.lastName}
              error={formErrors.lastName}
              onChange={(event) => updateRegistration('lastName', event.target.value)}
              required
            />
          </div>

          <FormField
            label="Administrator email"
            name="email"
            type="email"
            value={registration.email}
            error={formErrors.email}
            onChange={(event) => updateRegistration('email', event.target.value)}
            required
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Initial password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={registration.password}
              error={formErrors.password}
              onChange={(event) => updateRegistration('password', event.target.value)}
              required
            />
            <FormField
              label="Confirm password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={registration.confirmPassword}
              error={formErrors.confirmPassword}
              onChange={(event) =>
                updateRegistration('confirmPassword', event.target.value)
              }
              required
            />
          </div>

          <FormField
            label="Landmark"
            name="landmark"
            value={registration.landmark}
            error={formErrors.landmark}
            onChange={(event) => updateRegistration('landmark', event.target.value)}
            required
          />
          <FormField
            label="Postal address"
            name="address"
            value={registration.address}
            error={formErrors.address}
            onChange={(event) => updateRegistration('address', event.target.value)}
            required
          />
          <FormField
            label="Mobile number"
            name="phone"
            value={registration.phone}
            error={formErrors.phone}
            onChange={(event) => updateRegistration('phone', event.target.value)}
            required
          />

          <div>
            <p className="text-sm font-semibold text-gradely-text">School logo</p>
            {logoPreview ? (
              <img
                src={logoPreview}
                alt="Selected school logo"
                className="mt-2 size-16 rounded-xl border border-slate-200 object-contain p-1"
              />
            ) : null}
            <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-gradely-text hover:bg-gradely-light">
              <ImagePlus aria-hidden="true" className="size-4" />
              Choose logo
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(event) => updateLogo(event.target.files?.[0] ?? null)}
              />
            </label>
            {formErrors.logo ? (
              <p role="alert" className="mt-1 text-xs font-medium text-red-700">
                {formErrors.logo}
              </p>
            ) : null}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setRegisterOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              <CheckCircle2 aria-hidden="true" className="size-4" />
              Register school
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(selectedId)}
        onClose={() => setSelectedId(null)}
        title={detail?.name ?? 'School details'}
        description="Platform-level view of the school profile, people, calendar, payments and reports."
        wide
      >
        {detailLoading ? <LoadingPanel label="Loading school details…" /> : null}
        {detailError ? (
          <ErrorNotice
            message={detailError}
            onRetry={() => selectedId && void loadDetail(selectedId)}
          />
        ) : null}

        {detail ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              {detail.logoUrl ? (
                <img
                  src={apiAssetUrl(detail.logoUrl)}
                  alt={`${detail.name} logo`}
                  className="size-16 rounded-xl border border-slate-200 object-contain p-1"
                />
              ) : (
                <span className="flex size-16 items-center justify-center rounded-xl bg-gradely-light text-gradely-blue">
                  <Building2 aria-hidden="true" className="size-7" />
                </span>
              )}
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <SchoolStatusBadge isActive={detail.isActive} />
                  <Badge tone="info">{detail.slug}</Badge>
                  {!detail.profileComplete ? (
                    <Badge tone="warning">Profile incomplete</Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-gradely-muted">
                  {detail.landmark ?? 'No landmark'} · {detail.address ?? 'No address'}
                </p>
                <p className="text-sm text-gradely-muted">
                  {detail.phone ?? 'No phone'} · {detail.email ?? 'No email'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => openEdit(detail)}>
                  <Pencil aria-hidden="true" className="size-4" />
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant={detail.isActive ? 'danger' : 'primary'}
                  onClick={() => {
                    setStatusError(null)
                    setStatusTarget(detail)
                  }}
                >
                  {detail.isActive ? (
                    <>
                      <ShieldOff aria-hidden="true" className="size-4" />
                      Suspend
                    </>
                  ) : (
                    'Activate'
                  )}
                </Button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl bg-gradely-light p-3">
                <p className="text-xs uppercase tracking-wide text-gradely-muted">Pupils</p>
                <p className="text-xl font-extrabold text-gradely-navy">{detail.pupilCount}</p>
              </div>
              <div className="rounded-xl bg-gradely-light p-3">
                <p className="text-xs uppercase tracking-wide text-gradely-muted">Teachers</p>
                <p className="text-xl font-extrabold text-gradely-navy">{detail.teacherCount}</p>
              </div>
              <div className="rounded-xl bg-gradely-light p-3">
                <p className="text-xs uppercase tracking-wide text-gradely-muted">Classes</p>
                <p className="text-xl font-extrabold text-gradely-navy">{detail.classCount}</p>
              </div>
              <div className="rounded-xl bg-gradely-light p-3">
                <p className="text-xs uppercase tracking-wide text-gradely-muted">Outstanding</p>
                <p className="text-xl font-extrabold text-gradely-navy">
                  {formatMoney(detail.outstandingMinor, detail.currency)}
                </p>
              </div>
            </div>

            <section>
              <h3 className="text-sm font-bold text-gradely-text">Academic calendar</h3>
              <p className="mt-1 text-xs text-gradely-muted">
                Current: {detail.currentAcademicYearName ?? '—'} ·{' '}
                {detail.currentTermName ?? '—'} ({detail.currentTermStatus ?? '—'})
              </p>
              <div className="mt-2 overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-xs">
                  <thead>
                    <tr className="text-left uppercase tracking-wide text-gradely-muted">
                      <th className="px-2 py-1.5 font-semibold">Year</th>
                      <th className="px-2 py-1.5 font-semibold">Term</th>
                      <th className="px-2 py-1.5 font-semibold">Status</th>
                      <th className="px-2 py-1.5 font-semibold">Dates</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {detail.academicYears.flatMap((year) =>
                      year.terms.map((term) => (
                        <tr key={term.id}>
                          <td className="px-2 py-1.5 text-gradely-muted">{year.name}</td>
                          <td className="px-2 py-1.5 font-semibold text-gradely-text">
                            {term.name}
                            {term.isCurrent ? ' · current' : ''}
                          </td>
                          <td className="px-2 py-1.5 text-gradely-muted">{term.status}</td>
                          <td className="px-2 py-1.5 text-gradely-muted">
                            {formatDate(term.startsOn)} – {formatDate(term.endsOn)}
                          </td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <div>
                <h3 className="text-sm font-bold text-gradely-text">Administrators</h3>
                {detail.administrators.length === 0 ? (
                  <p className="mt-1 text-xs text-gradely-muted">None registered.</p>
                ) : (
                  <ul className="mt-2 space-y-1.5 text-xs text-gradely-muted">
                    {detail.administrators.map((member) => (
                      <li key={member.userId}>
                        <span className="font-semibold text-gradely-text">
                          {member.firstName} {member.lastName}
                        </span>{' '}
                        · {member.email} · {member.status}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 className="text-sm font-bold text-gradely-text">Teachers</h3>
                {detail.teachers.length === 0 ? (
                  <p className="mt-1 text-xs text-gradely-muted">None registered.</p>
                ) : (
                  <ul className="mt-2 space-y-1.5 text-xs text-gradely-muted">
                    {detail.teachers.map((member) => (
                      <li key={member.userId}>
                        <span className="font-semibold text-gradely-text">
                          {member.firstName} {member.lastName}
                        </span>{' '}
                        · {member.email} · {statusLabel(member.role)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section>
              <h3 className="text-sm font-bold text-gradely-text">Classes</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {detail.classes.length === 0 ? (
                  <p className="text-xs text-gradely-muted">No classes.</p>
                ) : (
                  detail.classes.map((classroom) => (
                    <span
                      key={classroom.id}
                      className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-gradely-text"
                    >
                      {classroom.name} · {classroom.pupilCount} pupil(s)
                    </span>
                  ))
                )}
              </div>
            </section>

            <section>
              <h3 className="text-sm font-bold text-gradely-text">Payment history</h3>
              {detail.payments.length === 0 ? (
                <p className="mt-1 text-xs text-gradely-muted">No payments recorded.</p>
              ) : (
                <div className="mt-2 overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-xs">
                    <thead>
                      <tr className="text-left uppercase tracking-wide text-gradely-muted">
                        <th className="px-2 py-1.5 font-semibold">Invoice</th>
                        <th className="px-2 py-1.5 font-semibold">Term</th>
                        <th className="px-2 py-1.5 font-semibold">Amount</th>
                        <th className="px-2 py-1.5 font-semibold">Method</th>
                        <th className="px-2 py-1.5 font-semibold">Status</th>
                        <th className="px-2 py-1.5 font-semibold">Submitted</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {detail.payments.map((payment) => (
                        <tr key={payment.id}>
                          <td className="px-2 py-1.5 font-semibold text-gradely-text">
                            {payment.invoiceNumber}
                          </td>
                          <td className="px-2 py-1.5 text-gradely-muted">
                            {payment.academicYearName} · {payment.termName}
                          </td>
                          <td className="px-2 py-1.5 text-gradely-text">
                            {formatMoney(payment.amountMinor, payment.currency)}
                          </td>
                          <td className="px-2 py-1.5 text-gradely-muted">
                            {statusLabel(payment.method)}
                          </td>
                          <td className="px-2 py-1.5 text-gradely-muted">
                            {statusLabel(payment.status)}
                          </td>
                          <td className="px-2 py-1.5 text-gradely-muted">
                            {formatDateTime(payment.submittedAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section>
              <h3 className="text-sm font-bold text-gradely-text">Report batches</h3>
              {detail.reportBatches.length === 0 ? (
                <p className="mt-1 text-xs text-gradely-muted">No report batches.</p>
              ) : (
                <div className="mt-2 overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-xs">
                    <thead>
                      <tr className="text-left uppercase tracking-wide text-gradely-muted">
                        <th className="px-2 py-1.5 font-semibold">Term</th>
                        <th className="px-2 py-1.5 font-semibold">Class</th>
                        <th className="px-2 py-1.5 font-semibold">Generation</th>
                        <th className="px-2 py-1.5 font-semibold">Release</th>
                        <th className="px-2 py-1.5 font-semibold">Reports</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {detail.reportBatches.map((batch) => (
                        <tr key={batch.id}>
                          <td className="px-2 py-1.5 text-gradely-muted">
                            {batch.academicYearName} · {batch.termName}
                          </td>
                          <td className="px-2 py-1.5 text-gradely-muted">
                            {batch.className ?? 'Whole term'}
                          </td>
                          <td className="px-2 py-1.5 text-gradely-muted">
                            {statusLabel(batch.generationStatus)}
                          </td>
                          <td className="px-2 py-1.5 font-semibold text-gradely-text">
                            {statusLabel(batch.releaseStatus)}
                          </td>
                          <td className="px-2 py-1.5 text-gradely-muted">{batch.reportCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Update school information"
        description="Only school profile fields are editable here. Status changes use the audited activate/suspend action."
      >
        <form onSubmit={submitEdit} className="space-y-4" noValidate>
          {editError ? (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {editError}
            </div>
          ) : null}
          <FormField
            label="School name"
            value={editValues.name}
            onChange={(event) =>
              setEditValues((current) => ({ ...current, name: event.target.value }))
            }
            required
          />
          <FormField
            label="Email"
            type="email"
            value={editValues.email}
            onChange={(event) =>
              setEditValues((current) => ({ ...current, email: event.target.value }))
            }
          />
          <FormField
            label="Phone"
            value={editValues.phone}
            onChange={(event) =>
              setEditValues((current) => ({ ...current, phone: event.target.value }))
            }
          />
          <FormField
            label="Landmark"
            value={editValues.landmark}
            onChange={(event) =>
              setEditValues((current) => ({ ...current, landmark: event.target.value }))
            }
          />
          <FormField
            label="Postal address"
            value={editValues.address}
            onChange={(event) =>
              setEditValues((current) => ({ ...current, address: event.target.value }))
            }
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditOpen(false)}
              disabled={editBusy}
            >
              Cancel
            </Button>
            <Button type="submit" loading={editBusy}>
              Save changes
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(statusTarget)}
        title={statusTarget?.isActive ? 'Suspend school access' : 'Activate school'}
        description={
          statusTarget?.isActive
            ? `Suspending ${statusTarget.name} blocks its users from signing in to school features. Historical records are preserved.`
            : `Activating ${statusTarget?.name ?? 'this school'} restores access for its members.`
        }
        confirmLabel={statusTarget?.isActive ? 'Suspend school' : 'Activate school'}
        danger={Boolean(statusTarget?.isActive)}
        busy={statusBusy}
        onConfirm={() => void confirmStatusChange()}
        onCancel={() => {
          if (!statusBusy) setStatusTarget(null)
        }}
      />
      {statusError ? <ErrorNotice message={statusError} /> : null}
    </div>
  )
}
