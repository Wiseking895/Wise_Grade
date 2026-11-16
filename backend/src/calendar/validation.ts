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
