import { randomUUID } from 'node:crypto'
import { HttpError } from '../errors/http-error.js'

export const SCHOOL_LOGO_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const

export type SchoolLogoMimeType = (typeof SCHOOL_LOGO_MIME_TYPES)[number]

/** Logos are larger than report branding assets but still tightly bounded. */
export const MAX_SCHOOL_LOGO_BYTES = 2 * 1024 * 1024
/** A scanned or drawn signature is small; keep the private object tight. */
export const MAX_SIGNATURE_BYTES = 1024 * 1024
/** Uploads are compressed in the browser, but still validate a hard ceiling. */
export const MAX_PUPIL_PHOTO_BYTES = 5 * 1024 * 1024

export interface SchoolLogoUpload {
  mimeType: string
  base64: string
  originalName?: string | null
}

export type SignatureUpload = SchoolLogoUpload
export type PupilPhotoUpload = SchoolLogoUpload

export interface DecodedSchoolLogo {
  data: Buffer
  mimeType: SchoolLogoMimeType
  extension: 'png' | 'jpg' | 'webp'
}

export type DecodedSignature = DecodedSchoolLogo
export type DecodedPupilPhoto = DecodedSchoolLogo

export function isSchoolLogoMimeType(
  value: string,
): value is SchoolLogoMimeType {
  return (SCHOOL_LOGO_MIME_TYPES as readonly string[]).includes(value)
}

function matchesMagicBytes(data: Buffer, mimeType: SchoolLogoMimeType): boolean {
  if (mimeType === 'image/png') {
    return (
      data.length >= 8 &&
      data[0] === 0x89 &&
      data[1] === 0x50 &&
      data[2] === 0x4e &&
      data[3] === 0x47 &&
      data[4] === 0x0d &&
      data[5] === 0x0a &&
      data[6] === 0x1a &&
      data[7] === 0x0a
    )
  }

  if (mimeType === 'image/jpeg') {
    return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
  }

  return (
    data.length >= 12 &&
    data.subarray(0, 4).toString('ascii') === 'RIFF' &&
    data.subarray(8, 12).toString('ascii') === 'WEBP'
  )
}

function decodeImageUpload(
  input: SchoolLogoUpload,
  options: { label: string; maxBytes: number; sizeMessage: string },
): DecodedSchoolLogo {
  if (!isSchoolLogoMimeType(input.mimeType)) {
    throw new HttpError(400, `${options.label} must be a PNG, JPEG or WebP image`)
  }

  const encoded = input.base64
    .replace(/^data:[^;]+;base64,/, '')
    .replace(/\s+/g, '')

  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new HttpError(
      400,
      `The ${options.label.toLowerCase()} upload is not valid base64 data`,
    )
  }

  const data = Buffer.from(encoded, 'base64')

  if (data.length === 0) {
    throw new HttpError(400, `The ${options.label.toLowerCase()} upload is empty`)
  }

  if (data.length > options.maxBytes) {
    throw new HttpError(400, options.sizeMessage)
  }

  if (!matchesMagicBytes(data, input.mimeType)) {
    throw new HttpError(
      400,
      'The uploaded file does not match the declared image type',
    )
  }

  const extension =
    input.mimeType === 'image/png'
      ? 'png'
      : input.mimeType === 'image/jpeg'
        ? 'jpg'
        : 'webp'

  return { data, mimeType: input.mimeType, extension }
}

/**
 * Validates a base64 school logo upload. Type, size and the actual file
 * signature are all checked server-side; a client-declared MIME type is never
 * trusted on its own.
 */
export function decodeSchoolLogo(input: SchoolLogoUpload): DecodedSchoolLogo {
  return decodeImageUpload(input, {
    label: 'School logo',
    maxBytes: MAX_SCHOOL_LOGO_BYTES,
    sizeMessage: 'School logos must be 2 MB or smaller',
  })
}

/** Validates a scanned or digitally drawn administrator signature. */
export function decodeSignatureUpload(
  input: SignatureUpload,
): DecodedSignature {
  return decodeImageUpload(input, {
    label: 'Signature',
    maxBytes: MAX_SIGNATURE_BYTES,
    sizeMessage: 'Signatures must be 1 MB or smaller',
  })
}

/** Validates a pupil photograph before it is written to private storage. */
export function decodePupilPhotoUpload(
  input: PupilPhotoUpload,
): DecodedPupilPhoto {
  return decodeImageUpload(input, {
    label: 'Pupil photograph',
    maxBytes: MAX_PUPIL_PHOTO_BYTES,
    sizeMessage: 'Pupil photographs must be 5 MB or smaller',
  })
}

/** School-scoped storage key. Keys are opaque and never returned to clients. */
export function schoolLogoStorageKey(
  schoolId: string,
  extension: string,
): string {
  return `schools/${schoolId}/school-logo/${randomUUID()}.${extension}`
}

/** Immutable, school-scoped key for an administrator signature object. */
export function signatureStorageKey(
  schoolId: string,
  extension: string,
): string {
  return `schools/${schoolId}/signature/${randomUUID()}.${extension}`
}

/** Immutable, pupil-scoped key for a profile photograph object. */
export function pupilPhotoStorageKey(
  schoolId: string,
  pupilId: string,
  extension: string,
): string {
  return `schools/${schoolId}/pupils/${pupilId}/photo/${randomUUID()}.${extension}`
}

const GHANA_MOBILE_NATIONAL = /^[235]\d{8}$/

/**
 * Normalizes a Ghana mobile number to the canonical +233XXXXXXXXX form.
 * Accepts local (0XXXXXXXXX), international (+233 / 233) and lightly
 * punctuated input. Throws for numbers that are not Ghana mobile numbers.
 */
export function normalizeGhanaMobile(value: string): string {
  const cleaned = value.trim().replace(/[\s().-]/g, '')

  let national = cleaned

  if (national.startsWith('+233')) {
    national = national.slice(4)
  } else if (national.startsWith('00233')) {
    national = national.slice(5)
  } else if (national.startsWith('233')) {
    national = national.slice(3)
  }

  // Ghanaians commonly write the country code followed by the national number
  // that still carries its trunk 0, for example "+233 (0)24 000 0000". Strip
  // that single leading 0 so the same number is accepted however it is written.
  // Local numbers ("024 000 0000") take the same path.
  if (national.startsWith('0')) {
    national = national.slice(1)
  }

  if (!GHANA_MOBILE_NATIONAL.test(national)) {
    throw new Error('Enter a valid Ghana mobile number')
  }

  return `+233${national}`
}

export interface SchoolIdentityFields {
  logoObjectKey: string | null
  landmark: string | null
  address: string | null
  phone: string | null
}

/** Human-readable list of identity fields still missing from a school profile. */
export function missingSchoolIdentityFields(
  school: SchoolIdentityFields,
): string[] {
  const missing: string[] = []

  if (!school.logoObjectKey) missing.push('school logo')
  if (!school.landmark || school.landmark.trim() === '') missing.push('landmark')
  if (!school.address || school.address.trim() === '') missing.push('postal address')
  if (!school.phone || school.phone.trim() === '') missing.push('mobile number')

  return missing
}

export function isSchoolIdentityComplete(
  school: SchoolIdentityFields,
): boolean {
  return missingSchoolIdentityFields(school).length === 0
}

/** Stable, private API path used by the authenticated frontend. */
export function schoolLogoUrl(
  schoolId: string,
  logoUpdatedAt: Date | null,
): string | null {
  if (!logoUpdatedAt) {
    return null
  }

  return `/api/schools/${schoolId}/profile/logo?v=${logoUpdatedAt.getTime()}`
}
