import type { ApiFieldError } from '../lib/api'

/**
 * Human labels for the class-teacher registration fields the API can reject.
 * The backend reports paths such as `teacher.firstName`; showing the same
 * wording as the form is what makes the error actionable for an administrator.
 */
const FIELD_LABELS: Record<string, string> = {
  className: 'Class name',
  level: 'Class level',
  academicYearId: 'Academic year',
  sortOrder: 'Sort order',
  'teacher.firstName': 'First name',
  'teacher.lastName': 'Last name',
  'teacher.email': 'Email address',
  'teacher.phone': 'Mobile number',
  'teacher.initialPassword': 'Initial password',
}

const PATH_LABELS: Record<string, string> = {
  teacher: 'Class teacher',
}

export interface FieldFeedback {
  field: string
  label: string
  message: string
}

/** Turns `teacher.initialPassword` into `Initial password` for unknown paths. */
function humanize(field: string): string {
  const [parent, ...rest] = field.split('.')
  const leaf = rest.length > 0 ? rest.join('.') : parent
  const words = leaf
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()

  if (!words) return field

  const label = words.charAt(0).toUpperCase() + words.slice(1)
  const prefix = rest.length > 0 ? PATH_LABELS[parent] : undefined

  return prefix ? `${prefix} · ${label}` : label
}

/**
 * Maps API field errors to display rows. Unknown fields keep their message and
 * get a readable label derived from the path, so a new backend rule never
 * regresses the page to a generic failure message.
 */
export function fieldFeedback(details: ApiFieldError[]): FieldFeedback[] {
  return details.map((detail) => ({
    field: detail.field,
    label: FIELD_LABELS[detail.field] ?? humanize(detail.field),
    message: detail.message,
  }))
}
