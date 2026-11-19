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
/** E.164 allows at most 15 digits including the country code. */
const E164 = /^\+[1-9]\d{7,14}$/
export const MAX_SCHOOL_LOGO_BYTES = 2 * 1024 * 1024
export const SCHOOL_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp']

/**
 * Normalizes a phone number to canonical E.164, or null when invalid.
 * Ghanaian national forms become +233XXXXXXXXX; other international numbers
 * must already use `+` or the `00` dialling prefix.
 */
export function normalizeGhanaMobile(value: string): string | null {
  const cleaned = value.trim().replace(/[\s().-]/g, '')

  if (cleaned === '') {
    return null
  }

  const international = cleaned.startsWith('00')
    ? `+${cleaned.slice(2)}`
    : cleaned

  if (international.startsWith('+233')) {
    let national = international.slice(4)

    if (national.startsWith('0')) {
      national = national.slice(1)
    }

    return GHANA_MOBILE_NATIONAL.test(national) ? `+233${national}` : null
  }

  if (international.startsWith('+')) {
    return E164.test(international) ? international : null
  }

  let national = international

  if (national.startsWith('233')) {
    national = national.slice(3)
  }

  if (national.startsWith('0')) {
    national = national.slice(1)
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
    errors.phone = 'Enter a valid phone number, e.g. 024 000 0000'
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
