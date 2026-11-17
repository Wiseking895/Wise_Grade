import { z } from 'zod'

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD format')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), {
    message: 'Enter a valid date',
  })

export const termDatesCorrectionSchema = z
  .object({
    startsOn: dateString,
    endsOn: dateString,
  })
  .strict()
  .refine((value) => value.endsOn >= value.startsOn, {
    message: 'End date must be on or after the start date',
    path: ['endsOn'],
  })

export const calendarSchoolQuerySchema = z
  .object({
    schoolId: z.string().uuid('Enter a valid school identifier').optional(),
  })
  .strict()

export const transitionListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict()

const calendarName = z
  .string()
  .trim()
  .min(1, 'Enter a name')
  .max(80, 'Use 80 characters or fewer')

export const calendarTermConfigSchema = z
  .object({
    name: calendarName,
    sequence: z.number().int().min(1).max(3),
    startsOn: dateString,
    endsOn: dateString,
    assessmentDeadline: dateString,
    examinationStartsOn: dateString,
    examinationEndsOn: dateString,
    datesConfirmed: z.boolean(),
  })
  .strict()

export const academicYearCreateSchema = z
  .object({
    name: calendarName,
    startsOn: dateString,
    endsOn: dateString,
    activate: z.boolean().default(false),
    terms: z.array(calendarTermConfigSchema).max(3).default([]),
  })
  .strict()

export const academicYearUpdateSchema = z
  .object({
    name: calendarName,
    startsOn: dateString,
    endsOn: dateString,
  })
  .strict()

export const calendarTermUpdateSchema = z
  .object({
    name: calendarName,
    startsOn: dateString,
    endsOn: dateString,
    assessmentDeadline: dateString,
    examinationStartsOn: dateString,
    examinationEndsOn: dateString,
    datesConfirmed: z.boolean(),
    acknowledgeImpacts: z.boolean().optional(),
  })
  .strict()

export const academicYearResetSchema = z
  .object({
    name: calendarName,
    startsOn: dateString,
    endsOn: dateString,
    terms: z.array(calendarTermConfigSchema).max(3).default([]),
    acknowledgeImpacts: z
      .boolean()
      .refine((value) => value === true, {
        message:
          'Confirm that you understand the impact of resetting the calendar',
      }),
  })
  .strict()

export const calendarApplySchema = z
  .object({
    sourceSchoolId: z.string().uuid('Select the school holding the approved calendar'),
    yearId: z.string().uuid('Select the academic year to distribute'),
    schoolIds: z.array(z.string().uuid()).optional(),
  })
  .strict()

export const calendarApplyPreviewSchema = calendarApplySchema

export const calendarSequenceParamSchema = z
  .object({
    sequence: z.coerce.number().int().min(1).max(3),
  })
  .strict()
