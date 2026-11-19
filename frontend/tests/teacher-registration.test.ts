import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import { fieldFeedback } from '../src/schools/validation-feedback.ts'

function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8')
}

describe('class-teacher registration field feedback', () => {
  it('uses the same labels as the registration form', () => {
    const rows = fieldFeedback([
      { field: 'className', message: 'Class name must be at least 2 characters' },
      { field: 'teacher.email', message: 'Enter a valid email address' },
      { field: 'teacher.phone', message: 'Enter a valid phone number' },
    ])

    assert.deepEqual(
      rows.map((row) => row.label),
      ['Class name', 'Email address', 'Mobile number'],
    )
    assert.equal(rows[1]?.message, 'Enter a valid email address')
    assert.equal(rows[1]?.field, 'teacher.email')
  })

  it('labels every field the registration schema can reject', () => {
    const fields = [
      'className',
      'level',
      'academicYearId',
      'sortOrder',
      'teacher.firstName',
      'teacher.lastName',
      'teacher.email',
      'teacher.phone',
    ]

    const rows = fieldFeedback(
      fields.map((field) => ({ field, message: 'rejected' })),
    )

    for (const row of rows) {
      assert.doesNotMatch(row.label, /teacher\./i)
      assert.doesNotMatch(row.label, /^[a-z]/)
    }
  })

  it('humanizes an unknown field instead of hiding the message', () => {
    const rows = fieldFeedback([
      { field: 'teacher.middleName', message: 'Unexpected field' },
      { field: 'academicTermId', message: 'Academic term is invalid' },
    ])

    assert.deepEqual(
      rows.map((row) => row.label),
      ['Class teacher · Middle name', 'Academic term id'],
    )
  })

  it('returns no rows when the API sent no field details', () => {
    assert.deepEqual(fieldFeedback([]), [])
  })
})

describe('class-teacher registration request', () => {
  it('submits the contract the backend validates', async () => {
    const page = await source('../src/pages/dashboard/TeachersPage.tsx')

    assert.match(page, /registerClassWithTeacher\(schoolId, \{/)
    assert.match(page, /className: registerForm\.className\.trim\(\)/)
    assert.match(page, /level: registerForm\.level\.trim\(\) \|\| null/)
    assert.match(page, /academicYearId: registerForm\.academicYearId \|\| null/)
    assert.match(page, /firstName: registerForm\.firstName\.trim\(\)/)
    assert.match(page, /lastName: registerForm\.lastName\.trim\(\)/)
    assert.match(page, /email: registerForm\.email\.trim\(\)/)
    assert.match(page, /phone: registerForm\.phone\.trim\(\) \|\| null/)
    // The server generates the temporary password; nobody types it here.
    assert.doesNotMatch(page, /initialPassword/)
    assert.match(page, /Gradely generates a strong temporary password/)
    assert.match(page, /resendTeacherCredentials/)
  })

  it('shows field-specific errors and keeps the generic fallback', async () => {
    const page = await source('../src/pages/dashboard/TeachersPage.tsx')

    assert.match(page, /cause instanceof ApiError/)
    assert.match(page, /fieldFeedback\(cause\.details\)/)
    assert.match(page, /registerDetails\.map/)
    assert.match(page, /detail\.label/)
    assert.match(page, /detail\.message/)
  })

  it('posts the payload to the register endpoint', async () => {
    const api = await source('../src/schools/api.ts')

    assert.match(api, /schoolPath\(schoolId, '\/classes\/register'\)/)
    assert.match(api, /method: 'POST'/)
    assert.match(api, /body: input/)
  })
})
