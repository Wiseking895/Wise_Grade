import { z } from 'zod'
import { HttpError } from '../errors/http-error.js'
import {
  normalizeGhanaMobile,
  SCHOOL_LOGO_MIME_TYPES,
} from '../lib/school-branding.js'

/**
 * Canonical account email rule: trim and lowercase before the format check, so
 * a value typed with surrounding whitespace is normalized rather than rejected.
 * The accepted format and stored value are unchanged.
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address'))
  .pipe(z.string().max(320, 'Email is too long'))

const personName = z
  .string()
  .trim()
  .min(2, 'Must be at least 2 characters')
  .max(80, 'Must be 80 characters or fewer')

const password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be 128 characters or fewer')

export const ghanaMobileSchema = z
  .string()
  .trim()
  .min(1, 'Mobile number is required')
  .max(32, 'Mobile number is too long')
  .transform((value, ctx) => {
    try {
      return normalizeGhanaMobile(value)
    } catch {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter a valid Ghana mobile number, e.g. 024 000 0000',
      })
      return z.NEVER
    }
  })

export const schoolLogoUploadSchema = z
  .object({
    mimeType: z.enum([...SCHOOL_LOGO_MIME_TYPES], {
      message: 'School logo must be a PNG, JPEG or WebP image',
    }),
    base64: z
      .string()
      .min(1, 'School logo is required')
      .max(3_000_000, 'School logo is too large'),
    originalName: z.string().trim().max(255).optional(),
  })
  .strict()

export const registerSchoolSchema = z
  .object({
    schoolName: z
      .string()
      .trim()
      .min(2, 'School name must be at least 2 characters')
      .max(160, 'School name must be 160 characters or fewer'),
    firstName: personName,
    lastName: personName,
    email: emailSchema,
    password,
    landmark: z
      .string()
      .trim()
      .min(2, 'Landmark must be at least 2 characters')
      .max(200, 'Landmark must be 200 characters or fewer'),
    address: z
      .string()
      .trim()
      .min(5, 'Postal address must be at least 5 characters')
      .max(400, 'Postal address must be 400 characters or fewer'),
    phone: ghanaMobileSchema,
    logo: schoolLogoUploadSchema,
  })
  // Strict: unknown fields such as `role` or `isPlatformAdmin` are rejected
  // instead of being silently ignored. Public registration cannot escalate.
  .strict()

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1, 'Password is required').max(128),
    /** Optional TOTP or recovery code when MFA is enabled. */
    mfaCode: z.string().trim().max(40).optional(),
  })
  .strict()

export const passwordResetRequestSchema = z
  .object({ email: emailSchema })
  .strict()

export const passwordResetConfirmSchema = z
  .object({
    token: z.string().min(20, 'Reset token is invalid').max(256),
    password,
  })
  .strict()

export const subjectTeacherAccessCodeSchema = z
  .object({
    code: z.string().trim().min(20, 'Access code is invalid').max(256),
  })
  .strict()

export type RegisterSchoolInput = z.infer<typeof registerSchoolSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type PasswordResetRequestInput = z.infer<
  typeof passwordResetRequestSchema
>
export type PasswordResetConfirmInput = z.infer<
  typeof passwordResetConfirmSchema
>

/**
 * Parses a request body and throws a structured 400 with field-level details.
 * `path: ['body']` keeps flow through the shared error handler.
 */
export function parseBody<T extends z.ZodType>(
  schema: T,
  body: unknown,
): z.infer<T> {
  const result = schema.safeParse(body)

  if (!result.success) {
    throw new HttpError(
      400,
      'Validation failed',
      result.error.issues.map((issue) => ({
        field: issue.path.join('.') || 'body',
        message: issue.message,
      })),
    )
  }

  return result.data
}
