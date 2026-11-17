import { z } from 'zod'

const uuid = z.string().uuid('Enter a valid identifier')

const optionalDate = z
  .union([
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in YYYY-MM-DD format'),
    z.null(),
  ])
  .optional()

const optionalObjectKey = z
  .union([z.string().trim().min(1).max(512), z.null()])
  .optional()

const optionalText = (max: number) =>
  z
    .union([
      z.string().trim().max(max, `Must be ${max} characters or fewer`),
      z.null(),
    ])
    .optional()
    // An absent field means "leave the stored value alone". A dedicated
    // attendance, remarks or attitude page saves only its own field, so
    // mapping `undefined` to `null` here would erase the other fields.
    .transform((value) => (value === '' ? null : value))

export const reportSettingsSchema = z
  .object({
    academicYearId: uuid,
    academicTermId: uuid,
    emblemObjectKey: optionalObjectKey,
    crestObjectKey: optionalObjectKey,
    signatureObjectKey: optionalObjectKey,
    emblemAssetId: uuid.nullable().optional(),
    crestAssetId: uuid.nullable().optional(),
    signatureAssetId: uuid.nullable().optional(),
    headteacherLabel: z
      .string()
      .trim()
      .min(1, 'Signature label is required')
      .max(80, 'Must be 80 characters or fewer')
      .optional(),
    rankingEnabled: z.boolean().optional(),
    tiePolicy: z.enum(['COMPETITION', 'DENSE', 'ORDINAL']).optional(),
    aggregatePolicy: z
      .enum(['NONE', 'SUM_ALL_SUBJECTS', 'BEST_SIX_TOTAL', 'BEST_SIX_AVERAGE'])
      .optional(),
    attendanceRequired: z.boolean().optional(),
    closingDate: optionalDate,
    reopeningDate: optionalDate,
  })
  .strict()

export const reportInputSchema = z
  .object({
    academicYearId: uuid,
    academicTermId: uuid,
    classId: uuid,
    pupilId: uuid,
    daysOpened: z
      .number()
      .int('School days opened must be a whole number')
      .min(1, 'School days opened must be greater than zero')
      .max(400, 'School days opened looks too large')
      .optional()
      .nullable(),
    daysAttended: z
      .number()
      .int('Days attended must be a whole number')
      .min(0, 'Days attended cannot be negative')
      .max(400, 'Days attended looks too large')
      .optional()
      .nullable(),
    teacherRemarks: optionalText(1000),
    attitude: optionalText(400),
    closingDate: optionalDate,
    reopeningDate: optionalDate,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.daysOpened !== null &&
      value.daysOpened !== undefined &&
      value.daysAttended !== null &&
      value.daysAttended !== undefined &&
      value.daysAttended > value.daysOpened
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['daysAttended'],
        message: 'Days attended cannot exceed school days opened',
      })
    }
  })

export const reportAssetSchema = z
  .object({
    kind: z.enum(['EMBLEM', 'CREST', 'SIGNATURE']),
    mimeType: z.enum(['image/png', 'image/jpeg']),
    originalName: z
      .string()
      .trim()
      .min(1, 'A file name is required')
      .max(255, 'File name is too long'),
    base64: z
      .string()
      .min(1, 'Image data is required')
      .max(1_000_000, 'Image data is too large'),
  })
  .strict()

export const generateReportsSchema = z
  .object({
    academicYearId: uuid,
    academicTermId: uuid,
    classId: uuid.optional().nullable(),
    pupilIds: z.array(uuid).max(500).optional(),
    scope: z.enum(['INDIVIDUAL', 'CLASS', 'TERM']),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.scope === 'TERM' && value.classId) {
      ctx.addIssue({
        code: 'custom',
        path: ['classId'],
        message: 'Term-wide generation does not accept a single class',
      })
    }

    if (value.scope !== 'TERM' && !value.classId) {
      ctx.addIssue({
        code: 'custom',
        path: ['classId'],
        message: 'A class is required for individual and class-wide generation',
      })
    }

    if (value.scope === 'INDIVIDUAL') {
      if (!value.pupilIds || value.pupilIds.length !== 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['pupilIds'],
          message: 'Individual generation requires exactly one pupil',
        })
      }
    }
  })

export const reportTermQuerySchema = z
  .object({
    academicTermId: uuid,
    classId: uuid.optional(),
    // School users may only list report cards that the platform has explicitly
    // released. Platform operators use the dedicated platform endpoints.
    releasedOnly: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
  })
  .strict()

export const reportInputQuerySchema = z
  .object({
    academicTermId: uuid,
    classId: uuid,
  })
  .strict()

export const reportEligibilityQuerySchema = z
  .object({
    academicYearId: uuid,
    academicTermId: uuid,
    classId: uuid,
  })
  .strict()

export const reportClassesQuerySchema = z
  .object({
    academicYearId: uuid,
    academicTermId: uuid,
  })
  .strict()

export const reportBatchesQuerySchema = z
  .object({
    academicTermId: uuid.optional(),
  })
  .strict()

export const reportRequestSchema = z
  .object({
    academicYearId: uuid,
    academicTermId: uuid,
  })
  .strict()

export const reportRequestQuerySchema = z
  .object({
    academicTermId: uuid.optional(),
  })
  .strict()

const releaseStatus = z.enum([
  'GENERATED',
  'PENDING_PLATFORM_REVIEW',
  'RETURNED',
  'APPROVED',
  'RELEASED',
  'ON_HOLD',
])

export const reportReleaseBatchesQuerySchema = z
  .object({
    academicTermId: uuid.optional(),
  })
  .strict()

export const platformReportBatchesQuerySchema = z
  .object({
    schoolId: uuid.optional(),
    academicYearId: uuid.optional(),
    academicTermId: uuid.optional(),
    status: releaseStatus.optional(),
    submittedFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in YYYY-MM-DD format')
      .optional(),
    submittedTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in YYYY-MM-DD format')
      .optional(),
  })
  .strict()

export const reportReleaseReasonSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(3, 'A reason of at least 3 characters is required')
      .max(1000, 'Reason must be 1000 characters or fewer'),
  })
  .strict()
