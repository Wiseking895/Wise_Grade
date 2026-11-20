import { z } from 'zod'
import {
  emailSchema,
  ghanaMobileSchema,
  schoolLogoUploadSchema,
} from '../auth/validation.js'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const uuid = z.string().uuid('Enter a valid identifier')
const optionalUuid = uuid.optional().nullable()

const shortText = (max: number) =>
  z.string().trim().max(max, `Must be ${max} characters or fewer`)

const optionalText = (max: number) => shortText(max).optional().nullable()

const optionalGhanaMobile = ghanaMobileSchema.nullable().optional()

/**
 * Teacher email addresses use the same canonical rule as every other account:
 * trimmed and lowercased before the format check, so a value pasted with
 * surrounding whitespace is accepted instead of failing a rule that looks
 * unrelated to what was typed.
 */
const teacherEmail = emailSchema

const optionalEmail = z
  .string()
  .trim()
  .max(320, 'Email is too long')
  .optional()
  .nullable()
  .refine(
    (value) =>
      value === undefined ||
      value === null ||
      value === '' ||
      EMAIL_PATTERN.test(value),
    'Enter a valid email address',
  )

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD format')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), {
    message: 'Enter a valid date',
  })

const personName = z
  .string()
  .trim()
  .min(2, 'Must be at least 2 characters')
  .max(80, 'Must be 80 characters or fewer')

export const updateSchoolSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'School name must be at least 2 characters')
      .max(160, 'School name must be 160 characters or fewer')
      .optional(),
    email: optionalEmail,
    phone: optionalGhanaMobile,
    address: optionalText(400),
    landmark: optionalText(200),
    timezone: z.string().trim().min(1).max(64).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  })

export const schoolLogoUploadBodySchema = z
  .object({ logo: schoolLogoUploadSchema })
  .strict()

export const academicYearSchema = z
  .object({
    name: shortText(80).min(2, 'Name must be at least 2 characters'),
    startsOn: dateString,
    endsOn: dateString,
    isCurrent: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.endsOn >= value.startsOn, {
    message: 'End date must be on or after the start date',
    path: ['endsOn'],
  })

export const updateAcademicYearSchema = z
  .object({
    name: shortText(80).min(2, 'Name must be at least 2 characters').optional(),
    startsOn: dateString.optional(),
    endsOn: dateString.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  })
  .refine(
    (value) =>
      value.startsOn === undefined ||
      value.endsOn === undefined ||
      value.endsOn >= value.startsOn,
    {
      message: 'End date must be on or after the start date',
      path: ['endsOn'],
    },
  )

export const academicTermSchema = z
  .object({
    name: shortText(80).min(2, 'Name must be at least 2 characters'),
    sequence: z.coerce.number().int().min(1).max(20),
    startsOn: dateString,
    endsOn: dateString,
    isCurrent: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.endsOn >= value.startsOn, {
    message: 'End date must be on or after the start date',
    path: ['endsOn'],
  })

export const updateAcademicTermSchema = z
  .object({
    name: shortText(80).min(2, 'Name must be at least 2 characters').optional(),
    sequence: z.coerce.number().int().min(1).max(20).optional(),
    startsOn: dateString.optional(),
    endsOn: dateString.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  })
  .refine(
    (value) =>
      value.startsOn === undefined ||
      value.endsOn === undefined ||
      value.endsOn >= value.startsOn,
    {
      message: 'End date must be on or after the start date',
      path: ['endsOn'],
    },
  )

export const createClassSchema = z
  .object({
    name: shortText(80).min(1, 'Class name is required'),
    level: optionalText(40),
    sortOrder: z.coerce.number().int().min(0).max(10_000).optional(),
    academicYearId: optionalUuid,
  })
  .strict()

export const updateClassSchema = z
  .object({
    name: shortText(80).min(1, 'Class name is required').optional(),
    level: optionalText(40),
    sortOrder: z.coerce.number().int().min(0).max(10_000).optional(),
    academicYearId: optionalUuid,
    isArchived: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  })

export const pupilGender = z.enum(['MALE', 'FEMALE', 'OTHER'])
export const pupilStatus = z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED'])

export const createPupilSchema = z
  .object({
    firstName: personName,
    lastName: personName,
    otherNames: optionalText(120),
    admissionNumber: shortText(40).min(1, 'Admission number is required'),
    gender: pupilGender.optional().nullable(),
    dateOfBirth: dateString.optional().nullable(),
    classId: optionalUuid,
    academicYearId: optionalUuid,
    startedOn: dateString.optional(),
  })
  .strict()
  .refine(
    (value) => Boolean(value.classId) === Boolean(value.academicYearId),
    {
      message: 'Class and academic year must be supplied together',
      path: ['classId'],
    },
  )

export const updatePupilSchema = z
  .object({
    firstName: personName.optional(),
    lastName: personName.optional(),
    otherNames: optionalText(120),
    admissionNumber: shortText(40)
      .min(1, 'Admission number is required')
      .optional(),
    gender: pupilGender.optional().nullable(),
    dateOfBirth: dateString.optional().nullable(),
    // Archiving must use the dedicated endpoint so enrollment history and the
    // current-class pointer are updated together.
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  })

export const movePupilSchema = z
  .object({
    classId: uuid,
    academicYearId: uuid,
    startedOn: dateString.optional(),
  })
  .strict()

const imageMimeType = z.enum(['image/png', 'image/jpeg', 'image/webp'])

export const signatureUploadBodySchema = z
  .object({
    signature: z
      .object({
        mimeType: imageMimeType,
        base64: z
          .string()
          .min(1, 'Signature image is required')
          .max(2_000_000, 'Signature image is too large'),
        originalName: optionalText(255),
      })
      .strict(),
    name: optionalText(120),
    designation: optionalText(80),
  })
  .strict()

export const signatureDetailsSchema = z
  .object({
    name: optionalText(120),
    designation: optionalText(80),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined || value.designation !== undefined,
    { message: 'Provide the printed name or designation to update' },
  )

export const pupilPhotoUploadBodySchema = z
  .object({
    photo: z
      .object({
        mimeType: imageMimeType,
        base64: z
          .string()
          .min(1, 'Pupil photograph is required')
          .max(8_000_000, 'Pupil photograph is too large'),
        originalName: optionalText(255),
      })
      .strict(),
  })
  .strict()

export const createSubjectSchema = z
  .object({
    name: shortText(100).min(2, 'Subject name must be at least 2 characters'),
    code: optionalText(24),
  })
  .strict()

export const updateSubjectSchema = z
  .object({
    name: shortText(100)
      .min(2, 'Subject name must be at least 2 characters')
      .optional(),
    code: optionalText(24),
    isArchived: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  })

/**
 * A subject offered by the class being created during class-teacher
 * registration. An existing catalogue subject may be selected by id, or a new
 * subject may be supplied by name. The optional subject-teacher assignment is
 * validated against an existing active SUBJECT_TEACHER membership in the same
 * school.
 */
const registrationSubjectSchema = z
  .object({
    subjectId: optionalUuid,
    name: optionalText(100),
    code: optionalText(24),
    subjectTeacherMembershipId: optionalUuid,
    subjectTeacher: z
      .object({
        firstName: personName,
        lastName: personName,
        email: teacherEmail,
        phone: optionalGhanaMobile,
      })
      .strict()
      .optional()
      .nullable(),
  })
  .strict()
  .refine(
    (value) => Boolean(value.subjectId) || Boolean(value.name?.trim()),
    {
      message: 'Select an existing subject or enter a new subject name',
      path: ['name'],
    },
  )

export const subjectTeacherDetailsSchema = z
  .object({
    firstName: personName,
    lastName: personName,
    email: teacherEmail,
    phone: optionalGhanaMobile,
  })
  .strict()

export const classSubjectCreateSchema = z
  .object({
    subjectId: optionalUuid,
    name: optionalText(100),
    code: optionalText(24),
    subjectTeacherMembershipId: optionalUuid,
    subjectTeacher: subjectTeacherDetailsSchema.optional().nullable(),
  })
  .strict()
  .refine(
    (value) => Boolean(value.subjectId) || Boolean(value.name?.trim()),
    {
      message: 'Select an existing subject or enter a new subject name',
      path: ['name'],
    },
  )
  .refine((value) => !(value.subjectId && value.name?.trim()), {
    message: 'Choose an existing subject or create a new one, not both',
    path: ['name'],
  })
  .refine(
    (value) => !(value.subjectTeacherMembershipId && value.subjectTeacher),
    {
      message:
        'Choose an existing subject teacher or enter new teacher details, not both',
      path: ['subjectTeacher'],
    },
  )

export const assignSubjectTeacherSchema = z
  .object({
    membershipId: optionalUuid,
    teacher: subjectTeacherDetailsSchema.optional().nullable(),
  })
  .strict()
  .refine((value) => Boolean(value.membershipId) !== Boolean(value.teacher), {
    message:
      'Provide either an existing subject-teacher membership or new teacher details',
    path: ['teacher'],
  })

export const registerClassWithTeacherSchema = z
  .object({
    className: shortText(80).min(2, 'Class name must be at least 2 characters'),
    level: optionalText(40),
    academicYearId: optionalUuid,
    sortOrder: z.coerce.number().int().min(0).max(10_000).optional(),
    teacher: z
      .object({
        firstName: personName,
        lastName: personName,
        email: teacherEmail,
        phone: optionalGhanaMobile,
      })
      .strict(),
  })
  .strict()

export const registerTeacherSchema = z
  .object({
    firstName: personName,
    lastName: personName,
    email: teacherEmail,
    phone: optionalGhanaMobile,
    // The corrected workflow allows the school administrator to register only
    // class teachers. Subject teachers are invited by the class teacher.
    role: z.literal('CLASS_TEACHER'),
    // A class teacher is created together with (or attached to) their class.
    // The client may send either the supported class name or an existing id.
    className: optionalText(80),
    classId: optionalUuid,
    // Subjects are set up by the class teacher after registration. The field is
    // accepted for backwards compatibility but must remain empty.
    subjects: z.array(registrationSubjectSchema).max(50).optional(),
  })
  .strict()
  .refine(
    (value) =>
      Boolean(value.className?.trim()) || Boolean(value.classId),
    {
      message: 'Select the class this class teacher will manage',
      path: ['className'],
    },
  )
  .refine((value) => !value.subjects?.length, {
    message:
      'Class subjects are registered by the class teacher after their account is created',
    path: ['subjects'],
  })

export const updateTeacherSchema = z
  .object({
    firstName: personName.optional(),
    lastName: personName.optional(),
    email: teacherEmail.optional(),
    phone: optionalGhanaMobile,
    classId: uuid.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.firstName !== undefined ||
      value.lastName !== undefined ||
      value.email !== undefined ||
      value.phone !== undefined ||
      value.classId !== undefined,
    { message: 'Provide at least one field to update' },
  )

export const removeTeacherMembershipSchema = z
  .object({
    confirmEmail: teacherEmail,
    reason: shortText(500).optional().nullable(),
  })
  .strict()

export const membershipBodySchema = z
  .object({ membershipId: uuid })
  .strict()

export const assignSubjectBodySchema = z
  .object({ subjectId: uuid })
  .strict()

export const pupilListQuerySchema = z.object({
  q: shortText(120).optional(),
  classId: uuid.optional(),
  academicYearId: uuid.optional(),
  status: pupilStatus.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

export const archivedQuerySchema = z.object({
  includeArchived: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
})

export const academicTermQuerySchema = z.object({
  academicYearId: uuid.optional(),
})

export type UpdateSchoolInput = z.infer<typeof updateSchoolSchema>
export type AcademicYearInput = z.infer<typeof academicYearSchema>
export type UpdateAcademicYearInput = z.infer<typeof updateAcademicYearSchema>
export type AcademicTermInput = z.infer<typeof academicTermSchema>
export type UpdateAcademicTermInput = z.infer<typeof updateAcademicTermSchema>
export type CreateClassInput = z.infer<typeof createClassSchema>
export type UpdateClassInput = z.infer<typeof updateClassSchema>
export type CreatePupilInput = z.infer<typeof createPupilSchema>
export type UpdatePupilInput = z.infer<typeof updatePupilSchema>
export type MovePupilInput = z.infer<typeof movePupilSchema>
export type CreateSubjectInput = z.infer<typeof createSubjectSchema>
export type UpdateSubjectInput = z.infer<typeof updateSubjectSchema>
export type RegisterTeacherInput = z.infer<typeof registerTeacherSchema>
export type UpdateTeacherInput = z.infer<typeof updateTeacherSchema>
export type RemoveTeacherMembershipInput = z.infer<
  typeof removeTeacherMembershipSchema
>
export type RegisterClassWithTeacherInput = z.infer<
  typeof registerClassWithTeacherSchema
>
export type AssignSubjectTeacherInput = z.infer<
  typeof assignSubjectTeacherSchema
>
