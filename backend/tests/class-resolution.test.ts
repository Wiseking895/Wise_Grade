import { describe, expect, it } from 'vitest'
import { resolveClassTeacherClassId } from '../src/assessment/class-resolution.js'
import { HttpError } from '../src/errors/http-error.js'

const CLASS_A = '11111111-1111-4111-8111-111111111111'
const CLASS_B = '22222222-2222-4222-8222-222222222222'

function expectForbidden(run: () => unknown, message: string) {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError)
    expect((error as HttpError).statusCode).toBe(403)
    expect((error as HttpError).message).toBe(message)
    return
  }

  throw new Error('Expected the call to be rejected')
}

describe('class teacher class resolution', () => {
  it('leaves the requested class untouched for other roles', () => {
    expect(
      resolveClassTeacherClassId({
        role: 'SCHOOL_ADMIN',
        assignedClassIds: [CLASS_A],
        requestedClassId: CLASS_B,
      }),
    ).toBe(CLASS_B)
  })

  it('rejects a class teacher with no active assignment', () => {
    expectForbidden(
      () =>
        resolveClassTeacherClassId({
          role: 'CLASS_TEACHER',
          assignedClassIds: [],
          requestedClassId: CLASS_A,
        }),
      'No class is currently assigned to you',
    )
  })

  it('overrides a manipulated class id for a single-class teacher', () => {
    expect(
      resolveClassTeacherClassId({
        role: 'CLASS_TEACHER',
        assignedClassIds: [CLASS_A],
        requestedClassId: CLASS_B,
      }),
    ).toBe(CLASS_A)
  })

  it('accepts a named class when the teacher has several assignments', () => {
    expect(
      resolveClassTeacherClassId({
        role: 'CLASS_TEACHER',
        assignedClassIds: [CLASS_A, CLASS_B],
        requestedClassId: CLASS_B,
      }),
    ).toBe(CLASS_B)
  })

  it('rejects an unassigned class when the teacher has several assignments', () => {
    expectForbidden(
      () =>
        resolveClassTeacherClassId({
          role: 'CLASS_TEACHER',
          assignedClassIds: [CLASS_A, CLASS_B],
          requestedClassId: '33333333-3333-4333-8333-333333333333',
        }),
      'You do not have access to this class',
    )
  })
})
