import { ImagePlus, Loader2, Save } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ApiError, apiAssetUrl } from '../../lib/api'
import { readFileAsBase64 } from '../../lib/files'
import { validateSchoolLogoFile } from '../../lib/validation'
import {
  AccessDenied,
  Button,
  ErrorNotice,
  LoadingPanel,
  PageHeader,
  Panel,
  TextareaField,
} from '../../components/ui'
import FormField from '../../components/FormField'
import SignatureManager from '../../components/SignatureManager'
import { readDeviceTimeZone } from '../../location/device-time-zone'
import { useSchool } from '../../schools/use-school'
import {
  getSchoolProfile,
  getSchoolSignature,
  updateSchoolProfile,
  uploadSchoolLogo,
} from '../../schools/api'
import type {
  SchoolProfileInput,
  SchoolSignature,
} from '../../schools/types'

interface FormState {
  name: string
  email: string
  phone: string
  address: string
  landmark: string
  timezone: string
}

/**
 * A blank profile defaults its timezone to the administrator's own device
 * timezone. The value remains an editable school setting that drives academic
 * dates; it is never silently overridden later by a visitor's location.
 */
function emptyForm(): FormState {
  return {
    name: '',
    email: '',
    phone: '',
    address: '',
    landmark: '',
    timezone: readDeviceTimeZone(),
  }
}

export default function SchoolProfilePage() {
  const { schoolId, isAdmin, refreshSchool } = useSchool()
  const [form, setForm] = useState<FormState>(emptyForm)
  const [slug, setSlug] = useState('')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [signature, setSignature] = useState<SchoolSignature | null>(null)
  const [profileComplete, setProfileComplete] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [logoError, setLogoError] = useState<string | null>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!schoolId) return

    try {
      const [{ school }, signatureResponse] = await Promise.all([
        getSchoolProfile(schoolId),
        getSchoolSignature(schoolId),
      ])
      setError(null)
      setSignature(signatureResponse.signature)
      setForm({
        name: school.name,
        email: school.email ?? '',
        phone: school.phone ?? '',
        address: school.address ?? '',
        landmark: school.landmark ?? '',
        timezone: school.timezone,
      })
      setSlug(school.slug)
      setLogoUrl(school.logoUrl)
      setProfileComplete(school.profileComplete)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load the school profile.',
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

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    setSuccess(null)
  }

  function chooseLogo(file: File | null) {
    if (logoPreview) {
      URL.revokeObjectURL(logoPreview)
    }

    setLogoFile(file)
    setLogoPreview(file ? URL.createObjectURL(file) : null)
    setLogoError(validateSchoolLogoFile(file))
    setSuccess(null)
  }

  async function handleLogoUpload() {
    if (!schoolId || !logoFile || uploadingLogo) return

    const validation = validateSchoolLogoFile(logoFile)

    if (validation) {
      setLogoError(validation)
      return
    }

    setUploadingLogo(true)
    setLogoError(null)
    setError(null)

    try {
      const base64 = await readFileAsBase64(logoFile)
      const { school } = await uploadSchoolLogo(schoolId, {
        mimeType: logoFile.type,
        base64,
        originalName: logoFile.name,
      })

      setLogoUrl(school.logoUrl)
      setProfileComplete(school.profileComplete)
      if (logoPreview) {
        URL.revokeObjectURL(logoPreview)
      }
      setLogoPreview(null)
      setLogoFile(null)
      setSuccess('School logo updated. Historical reports keep their original logo.')
      await refreshSchool()
    } catch (cause) {
      setLogoError(
        cause instanceof ApiError
          ? cause.message
          : 'Could not upload the school logo.',
      )
    } finally {
      setUploadingLogo(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!schoolId) return

    setSaving(true)
    setError(null)
    setSuccess(null)

    const input: SchoolProfileInput = {
      name: form.name.trim(),
      email: form.email.trim() === '' ? null : form.email.trim(),
      phone: form.phone.trim() === '' ? null : form.phone.trim(),
      address: form.address.trim() === '' ? null : form.address.trim(),
      landmark: form.landmark.trim() === '' ? null : form.landmark.trim(),
      timezone: form.timezone.trim(),
    }

    try {
      const { school } = await updateSchoolProfile(schoolId, input)
      setForm({
        name: school.name,
        email: school.email ?? '',
        phone: school.phone ?? '',
        address: school.address ?? '',
        landmark: school.landmark ?? '',
        timezone: school.timezone,
      })
      setLogoUrl(school.logoUrl)
      setProfileComplete(school.profileComplete)
      setSuccess('School profile saved.')
      await refreshSchool()
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'Could not save the school profile.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="School profile"
        description="Keep the school's identity and contact details accurate. These details and the school logo are printed on terminal reports."
      />

      {!isAdmin ? (
        <AccessDenied message="Only a school administrator can edit the school profile." />
      ) : (
        <>
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
          {loading ? <LoadingPanel label="Loading school profile…" /> : null}

          {!loading ? (
            <>
              {!profileComplete ? (
                <div
                  role="status"
                  className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                >
                  The school profile is incomplete. Add a logo, landmark, postal
                  address and Ghana mobile number before reports can be
                  generated.
                </div>
              ) : null}

              <Panel>
                <h2 className="text-base font-bold text-gradely-text">
                  School logo
                </h2>
                <p className="mt-1 text-sm text-gradely-muted">
                  PNG, JPEG or WebP, maximum 2 MB. The logo appears in the school
                  dashboard and on terminal reports.
                </p>

                <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
                  <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-gradely-light">
                    {logoPreview || logoUrl ? (
                      // The saved logo is streamed from the API origin, so it
                      // needs the same credentialed CORS request as the
                      // dashboard image. Local previews are blob URLs and must
                      // not opt into CORS mode.
                      <img
                        src={
                          logoPreview ?? apiAssetUrl(logoUrl as string)
                        }
                        alt="Current school logo"
                        crossOrigin={
                          logoPreview ? undefined : 'use-credentials'
                        }
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <ImagePlus
                        aria-hidden="true"
                        className="size-8 text-gradely-muted"
                      />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <label
                      htmlFor="profileLogo"
                      className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-gradely-text hover:bg-gradely-light"
                    >
                      <ImagePlus aria-hidden="true" className="size-4" />
                      {logoUrl ? 'Choose replacement' : 'Choose logo'}
                    </label>
                    <input
                      id="profileLogo"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      onChange={(event) =>
                        chooseLogo(event.target.files?.[0] ?? null)
                      }
                    />
                    <p className="mt-1.5 text-xs text-gradely-muted">
                      {logoFile
                        ? `Selected: ${logoFile.name}`
                        : 'The previous logo is retained in storage so historical reports remain accurate.'}
                    </p>
                    {logoError ? (
                      <p
                        role="alert"
                        className="mt-1.5 text-xs font-medium text-red-700"
                      >
                        {logoError}
                      </p>
                    ) : null}
                    {logoFile ? (
                      <Button
                        type="button"
                        className="mt-3"
                        loading={uploadingLogo}
                        onClick={() => void handleLogoUpload()}
                      >
                        {uploadingLogo ? (
                          <Loader2
                            aria-hidden="true"
                            className="size-4 animate-spin"
                          />
                        ) : null}
                        Upload logo
                      </Button>
                    ) : null}
                  </div>
                </div>
              </Panel>

              <Panel>
                {schoolId && signature ? (
                  <SignatureManager
                    schoolId={schoolId}
                    signature={signature}
                    onChanged={setSignature}
                  />
                ) : (
                  <p className="text-sm text-gradely-muted">
                    Loading signature settings…
                  </p>
                )}
              </Panel>

              <Panel>
                <form
                  onSubmit={(event) => void handleSubmit(event)}
                  className="space-y-5"
                >
                  <div className="grid gap-5 sm:grid-cols-2">
                    <FormField
                      label="School name"
                      value={form.name}
                      onChange={(event) => update('name', event.target.value)}
                      required
                      minLength={2}
                      maxLength={160}
                    />
                    <FormField
                      label="School slug"
                      value={slug}
                      readOnly
                      hint="The slug is a stable identifier and cannot be changed here."
                    />
                    <FormField
                      label="Contact email"
                      type="email"
                      value={form.email}
                      onChange={(event) => update('email', event.target.value)}
                      hint="Used for school office correspondence."
                    />
                    <FormField
                      label="Ghana mobile number"
                      type="tel"
                      value={form.phone}
                      onChange={(event) => update('phone', event.target.value)}
                      maxLength={32}
                      required
                      hint="Required on terminal reports. Example: 024 000 0000."
                    />
                    <FormField
                      label="Landmark"
                      value={form.landmark}
                      onChange={(event) =>
                        update('landmark', event.target.value)
                      }
                      maxLength={200}
                      required
                      hint="A recognisable nearby place, printed on reports."
                    />
                    <FormField
                      label="Timezone"
                      value={form.timezone}
                      onChange={(event) =>
                        update('timezone', event.target.value)
                      }
                      required
                      maxLength={64}
                      hint="Pre-filled from this device. This school timezone drives academic dates and is not changed by a visitor's location."
                    />
                  </div>

                  <TextareaField
                    label="Postal address"
                    rows={3}
                    value={form.address}
                    onChange={(event) => update('address', event.target.value)}
                    maxLength={400}
                  />

                  {success ? (
                    <p
                      role="status"
                      className="rounded-xl border border-gradely-green/30 bg-gradely-green/10 px-4 py-3 text-sm font-medium text-[#137026]"
                    >
                      {success}
                    </p>
                  ) : null}

                  <div className="flex justify-end">
                    <Button type="submit" loading={saving}>
                      <Save aria-hidden="true" className="size-4" />
                      Save profile
                    </Button>
                  </div>
                </form>
              </Panel>
            </>
          ) : null}
        </>
      )}
    </div>
  )
}
