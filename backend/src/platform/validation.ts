import { z } from 'zod'

const email = z
  .email('Enter a valid email address')
  .max(320, 'Email is too long')
  .transform((value) => value.trim().toLowerCase())

const personName = z
  .string()
  .trim()
  .min(2, 'Must be at least 2 characters')
  .max(80, 'Must be 80 characters or fewer')

const strongPassword = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password must be 128 characters or fewer')

export const platformSchoolListQuerySchema = z
  .object({
    search: z.string().trim().max(160).optional(),
    status: z.enum(['all', 'active', 'suspended']).optional(),
  })
  .strict()

export const platformSchoolUpdateSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'School name must be at least 2 characters')
      .max(160, 'School name must be 160 characters or fewer')
      .optional(),
    email: email.nullable().optional(),
    phone: z.string().trim().max(32).nullable().optional(),
    address: z.string().trim().max(400).nullable().optional(),
    landmark: z.string().trim().max(200).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one school field to update',
  })

export const platformSchoolStatusSchema = z
  .object({
    isActive: z.boolean(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict()

export const platformAuditQuerySchema = z
  .object({
    search: z.string().trim().max(160).optional(),
    action: z.string().trim().max(80).optional(),
    schoolId: z.uuid().optional(),
    source: z.enum(['all', 'AUDIT_LOG', 'BILLING', 'CALENDAR']).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict()

export const platformSettingsUpdateSchema = z
  .object({
    supportEmail: email.nullable().optional(),
    registrationEnabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one setting to update',
  })

export const platformAccountProfileSchema = z
  .object({
    firstName: personName,
    lastName: personName,
  })
  .strict()

export const platformAccountEmailSchema = z
  .object({
    email,
    currentPassword: z.string().min(1, 'Current password is required').max(128),
  })
  .strict()

export const platformAccountPasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required').max(128),
    newPassword: strongPassword,
  })
  .strict()

export const platformNotificationListQuerySchema = z
  .object({
    unreadOnly: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    severity: z.enum(['INFO', 'SUCCESS', 'WARNING', 'CRITICAL']).optional(),
    type: z.string().trim().max(80).optional(),
    schoolId: z.uuid().optional(),
    search: z.string().trim().max(160).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict()

export const platformReconciliationQuerySchema = z
  .object({
    code: z
      .enum([
        'MISMATCHED_REFERENCE',
        'DUPLICATE_PROVIDER_REFERENCE',
        'REPEATED_SUBMISSION',
        'FAILED_VERIFICATION',
        'INCONSISTENT_AMOUNT',
        'OVERPAYMENT',
        'UNRECONCILED_PAYMENT',
        'WRONG_SCHOOL',
        'WRONG_TERM',
      ])
      .optional(),
    severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).optional(),
    schoolId: z.uuid().optional(),
  })
  .strict()

export const platformReconciliationAcknowledgeSchema = z
  .object({
    note: z.string().trim().max(1000).nullable().optional(),
  })
  .strict()

export const platformReauthSchema = z
  .object({
    password: z.string().min(1, 'Password is required').max(128),
    code: z.string().trim().max(40).optional(),
    purpose: z
      .string()
      .trim()
      .regex(/^[A-Z_]{3,80}$/, 'Invalid reauthentication purpose'),
  })
  .strict()

export const platformMfaConfirmSchema = z
  .object({
    code: z.string().trim().min(6, 'Enter the 6-digit code').max(40),
  })
  .strict()

export const platformMfaDisableSchema = z
  .object({
    password: z.string().min(1, 'Password is required').max(128),
    code: z.string().trim().min(6, 'Enter the 6-digit code').max(40),
  })
  .strict()

export const platformRecoveryCodesSchema = z
  .object({
    code: z.string().trim().min(6, 'Enter the 6-digit code').max(40),
  })
  .strict()

export const platformExportQuerySchema = z
  .object({
    dataset: z.enum(['schools', 'payments', 'invoices', 'audit', 'notifications']),
  })
  .strict()

export type PlatformSchoolUpdateInput = z.infer<typeof platformSchoolUpdateSchema>
export type PlatformSettingsUpdateInput = z.infer<
  typeof platformSettingsUpdateSchema
>
export type PlatformAccountProfileInput = z.infer<
  typeof platformAccountProfileSchema
>
