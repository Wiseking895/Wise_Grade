export type FieldErrors = Partial<
  Record<
    | 'schoolName'
    | 'firstName'
    | 'lastName'
    | 'email'
    | 'password'
    | 'confirmPassword'
    | 'landmark'
    | 'address'
    | 'phone'
    | 'logo',
    string
  >
>

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 10
const GHANA_MOBILE_NATIONAL = /^[235]\d{8}$/
export const MAX_SCHOOL_LOGO_BYTES = 2 * 1024 * 1024
export const SCHOOL_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp']

/** Normalizes a Ghana mobile number to +233XXXXXXXXX, or null when invalid. */
export function normalizeGhanaMobile(value: string): string | null {
  const cleaned = value.trim().replace(/[\s().-]/g, '')

  let national: string

  if (cleaned.startsWith('+233')) {
    national = cleaned.slice(4)
  } else if (cleaned.startsWith('00233')) {
    national = cleaned.slice(5)
  } else if (cleaned.startsWith('233')) {
    national = cleaned.slice(3)
  } else if (cleaned.startsWith('0')) {
    national = cleaned.slice(1)
  } else {
    national = cleaned
  }

  return GHANA_MOBILE_NATIONAL.test(national) ? `+233${national}` : null
}

export function validateSchoolLogoFile(file: File | null): string | null {
  if (!file) {
    return 'School logo is required'
  }

  if (!SCHOOL_LOGO_TYPES.includes(file.type)) {
    return 'Logo must be a PNG, JPEG or WebP image'
  }

  if (file.size > MAX_SCHOOL_LOGO_BYTES) {
    return 'Logo must be 2 MB or smaller'
  }

  return null
}

export function validateLogin(values: {
  email: string
  password: string
}): FieldErrors {
  const errors: FieldErrors = {}

  if (!values.email.trim()) {
    errors.email = 'Email is required'
  } else if (!EMAIL_PATTERN.test(values.email.trim())) {
    errors.email = 'Enter a valid email address'
  }

  if (!values.password) {
    errors.password = 'Password is required'
  }

  return errors
}

export function validateRegistration(values: {
  schoolName: string
  firstName: string
  lastName: string
  email: string
  password: string
  confirmPassword: string
  landmark: string
  address: string
  phone: string
  logo: File | null
}): FieldErrors {
  const errors: FieldErrors = {}

  if (values.schoolName.trim().length < 2) {
    errors.schoolName = 'School name must be at least 2 characters'
  }

  if (values.landmark.trim().length < 2) {
    errors.landmark = 'Landmark is required'
  }

  if (values.address.trim().length < 5) {
    errors.address = 'Postal address is required'
  }

  if (!values.phone.trim()) {
    errors.phone = 'Mobile number is required'
  } else if (!normalizeGhanaMobile(values.phone)) {
    errors.phone = 'Enter a valid Ghana mobile number, e.g. 024 000 0000'
  }

  const logoError = validateSchoolLogoFile(values.logo)

  if (logoError) {
    errors.logo = logoError
  }

  if (values.firstName.trim().length < 2) {
    errors.firstName = 'First name must be at least 2 characters'
  }

  if (values.lastName.trim().length < 2) {
    errors.lastName = 'Last name must be at least 2 characters'
  }

  if (!values.email.trim()) {
    errors.email = 'Email is required'
  } else if (!EMAIL_PATTERN.test(values.email.trim())) {
    errors.email = 'Enter a valid email address'
  }

  if (values.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
  }

  if (values.password !== values.confirmPassword) {
    errors.confirmPassword = 'Passwords do not match'
  }

  return errors
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0
}
