import { z } from 'zod'

const uuid = z.string().uuid('Enter a valid identifier')

const decimalString = z
  .union([z.string(), z.number()])
  .transform((value) =>
    typeof value === 'number' ? String(value) : value.trim(),
  )
  .pipe(
    z
      .string()
      .regex(
        /^\d+(?:\.\d{1,2})?$/,
        'Use a non-negative number with at most two decimal places',
      ),
  )

const optionalDecimalString = z
  .union([decimalString, z.null()])
  .optional()
  .transform((value) => value ?? null)

const shortText = (max: number) =>
  z.string().trim().min(1, 'This field is required').max(max, `Must be ${max} characters or fewer`)

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer`)
    .optional()
    .nullable()
    .transform((value) => (value === undefined || value === '' ? null : value))

const componentSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1, 'Component key is required')
      .max(40, 'Component key must be 40 characters or fewer')
      .regex(
        /^[A-Za-z0-9_-]+$/,
        'Use letters, numbers, hyphens or underscores only',
      ),
    name: shortText(120),
    category: z.enum(['SBA', 'EXAM']),
    maximumScore: decimalString,
    weightPercent: decimalString,
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .strict()

const gradeBandSchema = z
  .object({
    minScore: decimalString,
    maxScore: decimalString,
    gradeLabel: shortText(16),
    remark: shortText(160),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .strict()

export const gradingSchemeSchema = z
  .object({
    academicYearId: uuid,
    academicTermId: uuid.optional().nullable(),
    name: shortText(120),
    description: optionalText(400),
    bands: z
      .array(gradeBandSchema)
      .min(1, 'Add at least one grading band')
      .max(50, 'A scheme may contain at most 50 bands'),
  })
  .strict()

export const updateGradingSchemeSchema = z
  .object({
    academicYearId: uuid.optional(),
    academicTermId: uuid.optional().nullable(),
    name: shortText(120).optional(),
    description: optionalText(400),
    bands: z
      .array(gradeBandSchema)
      .min(1, 'Add at least one grading band')
      .max(50, 'A scheme may contain at most 50 bands')
      .optional(),
    isActive: z.boolean().optional(),
  })
  .strict()

export const assessmentPolicySchema = z
  .object({
    academicYearId: uuid,
    academicTermId: uuid,
    classId: uuid.optional().nullable(),
    level: optionalText(40),
    gradingSchemeId: uuid,
    name: shortText(120),
    description: optionalText(400),
    calculationMode: z
      .enum(['COMPONENT_WEIGHTED', 'GROUPED_SBA'])
      .optional(),
    components: z
      .array(componentSchema)
      .min(1, 'Add at least one assessment component')
      .max(20, 'A policy may contain at most 20 components'),
  })
  .strict()

export const updateAssessmentPolicySchema = z
  .object({
    name: shortText(120).optional(),
    description: optionalText(400),
    gradingSchemeId: uuid.optional(),
    calculationMode: z
      .enum(['COMPONENT_WEIGHTED', 'GROUPED_SBA'])
      .optional(),
    components: z
      .array(componentSchema)
      .min(1, 'Add at least one assessment component')
      .max(20, 'A policy may contain at most 20 components')
      .optional(),
    isActive: z.boolean().optional(),
  })
  .strict()

export const assessmentSettingsSchema = z
  .object({
    classTeacherEntryMode: z.enum(['ALL_CLASS_SUBJECTS', 'EXPLICIT_ONLY']),
  })
  .strict()

export const classTeacherPermissionSchema = z
  .object({
    classId: uuid,
    subjectId: uuid,
    membershipId: uuid,
  })
  .strict()

export const policyQuerySchema = z.object({
  academicYearId: uuid.optional(),
  academicTermId: uuid.optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
})

export const gradingSchemeQuerySchema = z.object({
  academicYearId: uuid.optional(),
  academicTermId: uuid.optional(),
})

export const scoreEntryQuerySchema = z.object({
  academicTermId: uuid,
  classId: uuid,
  subjectId: uuid,
})

const scoreSchema = z
  .object({
    componentId: uuid,
    score: optionalDecimalString,
  })
  .strict()

const pupilScoresSchema = z
  .object({
    pupilId: uuid,
    scores: z.array(scoreSchema).max(20),
  })
  .strict()

export const saveDraftSchema = z
  .object({
    academicTermId: uuid,
    classId: uuid,
    subjectId: uuid,
    pupils: z.array(pupilScoresSchema).min(1, 'At least one pupil is required').max(500),
    expectedVersion: z.number().int().min(0).optional(),
  })
  .strict()

export const submitResultsSchema = saveDraftSchema
  .extend({
    expectedVersion: z.number().int().min(0).optional(),
  })
  .strict()

export const submissionQuerySchema = z.object({
  academicTermId: uuid.optional(),
  status: z
    .enum(['DRAFT', 'SUBMITTED', 'RETURNED_FOR_CORRECTION', 'ACCEPTED'])
    .optional(),
  classId: uuid.optional(),
  subjectId: uuid.optional(),
})

export const reviewSubmissionSchema = z
  .object({
    decision: z.enum(['ACCEPTED', 'RETURNED_FOR_CORRECTION']),
    comment: z
      .string()
      .trim()
      .max(1000, 'Comment must be 1000 characters or fewer')
      .optional()
      .nullable(),
    expectedVersion: z.number().int().min(0),
  })
  .strict()
