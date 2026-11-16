import type { SchoolRole } from '../auth/roles.js'
import { HttpError } from '../errors/http-error.js'

/**
 * Resolves the class id a class teacher is allowed to work on.
 *
 * The browser never owns class selection for a single-class teacher: their
 * active assignment is authoritative, so a manipulated class id is replaced
 * server-side. A teacher with several active assignments must still name one of
 * them, and a teacher with none is rejected outright.
 */
export function resolveClassTeacherClassId(input: {
  role: SchoolRole
  assignedClassIds: string[]
  requestedClassId: string
}): string {
  if (input.role !== 'CLASS_TEACHER') {
    return input.requestedClassId
  }

  if (input.assignedClassIds.length === 0) {
    throw new HttpError(403, 'No class is currently assigned to you')
  }

  if (input.assignedClassIds.length === 1) {
    return input.assignedClassIds[0]!
  }

  if (!input.assignedClassIds.includes(input.requestedClassId)) {
    throw new HttpError(403, 'You do not have access to this class')
  }

  return input.requestedClassId
}
