import { Building2, ImagePlus, Loader2, UserPlus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/use-auth'
import AuthLayout from '../components/AuthLayout'
import FormField from '../components/FormField'
import { ApiError } from '../lib/api'
import { readFileAsBase64 } from '../lib/files'
import {
  hasErrors,
  validateRegistration,
  type FieldErrors,
} from '../lib/validation'

type RegistrationField =
  | 'schoolName'
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'password'
  | 'confirmPassword'
  | 'landmark'
  | 'address'
  | 'phone'

const EMPTY_FORM = {
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

export default function RegisterSchoolPage() {
  const { status, user, registerSchool } = useAuth()
  const navigate = useNavigate()
  const [values, setValues] = useState(EMPTY_FORM)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (status === 'authenticated') {
    const destination = user?.mustChangePassword
      ? '/change-password'
      : user &&
          !user.isPlatformAdmin &&
          user.emailVerificationRequired &&
          !user.emailVerified
        ? '/verify-email'
        : user?.isPlatformAdmin
          ? '/platform'
          : '/dashboard'

    return <Navigate to={destination} replace />
  }

  function updateField(field: RegistrationField, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => {
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
    setErrors((current) => {
      const next = { ...current }
      delete next.logo
      return next
    })
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (submitting) {
      return
    }

    const clientErrors = validateRegistration({
      ...values,
      logo: logoFile,
    })
    setErrors(clientErrors)
    setFormError(null)

    if (hasErrors(clientErrors) || !logoFile) {
      return
    }

    setSubmitting(true)

    try {
      const base64 = await readFileAsBase64(logoFile)

      await registerSchool({
        schoolName: values.schoolName.trim(),
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        email: values.email.trim(),
        password: values.password,
        landmark: values.landmark.trim(),
        address: values.address.trim(),
        phone: values.phone.trim(),
        logo: {
          mimeType: logoFile.type,
          base64,
          originalName: logoFile.name,
        },
      })
      navigate('/verify-email', { replace: true })
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(error.message)

        if (error.details.length > 0) {
          setErrors(
            Object.fromEntries(
              error.details.map((detail) => [
                detail.field.startsWith('logo') ? 'logo' : detail.field,
                detail.message,
              ]),
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
      title="Register your school"
      subtitle="Create your school workspace and the first administrator account. Your school identity is printed on every terminal report."
      footer={
        <p className="text-sm text-gradely-muted">
          Already have an account?{' '}
          <Link
            to="/login"
            className="font-semibold text-gradely-navy underline decoration-gradely-blue/40 underline-offset-2 hover:text-gradely-blue"
          >
            Sign in
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

        <div className="flex items-center gap-2 rounded-xl border border-gradely-blue/15 bg-gradely-light px-3.5 py-2.5 text-xs text-gradely-muted">
          <Building2 aria-hidden="true" className="size-4 text-gradely-blue" />
          Your account will be the school administrator for this workspace.
        </div>

        <FormField
          label="School name"
          name="schoolName"
          autoComplete="organization"
          required
          placeholder="Green Valley Academy"
          value={values.schoolName}
          error={errors.schoolName}
          onChange={(event) => updateField('schoolName', event.target.value)}
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            label="Landmark"
            name="landmark"
            required
            placeholder="Opposite the central market"
            value={values.landmark}
            error={errors.landmark}
            onChange={(event) => updateField('landmark', event.target.value)}
          />
          <FormField
            label="Ghana mobile number"
            name="phone"
            type="tel"
            inputMode="tel"
            required
            placeholder="024 000 0000"
            value={values.phone}
            error={errors.phone}
            onChange={(event) => updateField('phone', event.target.value)}
          />
        </div>

        <FormField
          label="Postal address"
          name="address"
          required
          placeholder="P.O. Box 123, Accra"
          value={values.address}
          error={errors.address}
          onChange={(event) => updateField('address', event.target.value)}
        />

        <div>
          <span className="block text-sm font-semibold text-gradely-text">
            School logo <span className="text-red-600">*</span>
          </span>
          <div className="mt-1.5 flex items-center gap-4 rounded-xl border border-slate-300 bg-gradely-white p-3">
            <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-gradely-light">
              {logoPreview ? (
                <img
                  src={logoPreview}
                  alt="School logo preview"
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <ImagePlus
                  aria-hidden="true"
                  className="size-6 text-gradely-muted"
                />
              )}
            </div>
            <div className="min-w-0">
              <label
                htmlFor="schoolLogo"
                className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-gradely-text hover:bg-gradely-light"
              >
                <ImagePlus aria-hidden="true" className="size-4" />
                {logoFile ? 'Replace logo' : 'Choose logo'}
              </label>
              <input
                id="schoolLogo"
                name="logo"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(event) =>
                  updateLogo(event.target.files?.[0] ?? null)
                }
              />
              <p className="mt-1.5 text-xs text-gradely-muted">
                PNG, JPEG or WebP. Maximum 2 MB.
                {logoFile ? ` Selected: ${logoFile.name}` : ''}
              </p>
            </div>
          </div>
          {errors.logo ? (
            <p role="alert" className="mt-1.5 text-xs font-medium text-red-700">
              {errors.logo}
            </p>
          ) : null}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            label="First name"
            name="firstName"
            autoComplete="given-name"
            required
            value={values.firstName}
            error={errors.firstName}
            onChange={(event) => updateField('firstName', event.target.value)}
          />
          <FormField
            label="Last name"
            name="lastName"
            autoComplete="family-name"
            required
            value={values.lastName}
            error={errors.lastName}
            onChange={(event) => updateField('lastName', event.target.value)}
          />
        </div>

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
          autoComplete="new-password"
          required
          hint="Use at least 10 characters."
          value={values.password}
          error={errors.password}
          onChange={(event) => updateField('password', event.target.value)}
        />

        <FormField
          label="Confirm password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          value={values.confirmPassword}
          error={errors.confirmPassword}
          onChange={(event) =>
            updateField('confirmPassword', event.target.value)
          }
        />

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradely-navy px-4 py-2.5 text-sm font-semibold text-gradely-white transition-colors hover:bg-[#123c80] disabled:cursor-wait disabled:opacity-70"
        >
          {submitting ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <UserPlus aria-hidden="true" className="size-4" />
          )}
          {submitting ? 'Creating your school...' : 'Create school account'}
        </button>

        <p className="text-center text-xs leading-relaxed text-gradely-muted">
          The school, its logo and the first administrator are created together
          in one transaction.
        </p>
      </form>
    </AuthLayout>
  )
}
