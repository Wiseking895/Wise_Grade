import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import {
  buildAttendancePlan,
  buildTextPlan,
  completedCount,
  completionSummary,
  hasMixedDaysOpened,
  hasUnsavedChanges,
  initialDaysOpened,
  isRowComplete,
  parseWholeNumber,
  rowsFromInputs,
  type TermRecordRow,
} from '../src/reports/term-records.ts'
import type {
  ReportEligibilityItem,
  ReportInput,
} from '../src/reports/types.ts'

function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8')
}

function row(overrides: Partial<TermRecordRow> = {}): TermRecordRow {
  return {
    pupilId: 'pupil-1',
    pupilName: 'Ama Mensah',
    eligible: true,
    failureMessage: null,
    daysOpened: '60',
    daysAttended: '58',
    teacherRemarks: '',
    attitude: '',
    savedDaysOpened: 60,
    savedDaysAttended: 58,
    savedTeacherRemarks: null,
    savedAttitude: null,
    savedAt: null,
    ...overrides,
  }
}

const pupil: ReportEligibilityItem = {
  pupilId: 'pupil-1',
  pupilName: 'Ama Mensah',
  eligible: true,
  acceptedResultCount: 3,
  failure: null,
}

const input: ReportInput = {
  id: 'input-1',
  schoolId: 'school-1',
  academicYearId: 'year-1',
  academicTermId: 'term-1',
  classId: 'class-1',
  pupilId: 'pupil-1',
  daysOpened: 60,
  daysAttended: 57,
  teacherRemarks: 'A steady term.',
  attitude: 'Cooperative.',
  closingDate: null,
  reopeningDate: null,
  updatedAt: '2026-07-01T10:00:00.000Z',
}

describe('class teacher term records', () => {
  it('maps saved attendance, remarks and attitude into editable rows', () => {
    const [mapped] = rowsFromInputs([pupil], [input])

    assert.ok(mapped)
    assert.equal(mapped.daysOpened, '60')
    assert.equal(mapped.daysAttended, '57')
    assert.equal(mapped.teacherRemarks, 'A steady term.')
    assert.equal(mapped.attitude, 'Cooperative.')
    assert.equal(mapped.savedDaysOpened, 60)
    assert.equal(mapped.savedDaysAttended, 57)
    assert.equal(mapped.savedTeacherRemarks, 'A steady term.')
    assert.equal(mapped.savedAttitude, 'Cooperative.')
    assert.equal(mapped.savedAt, '2026-07-01T10:00:00.000Z')
  })

  it('leaves a missing record blank rather than inventing zero attendance', () => {
    const [mapped] = rowsFromInputs([pupil], [])

    assert.ok(mapped)
    assert.equal(mapped.daysOpened, '')
    assert.equal(mapped.daysAttended, '')
    assert.equal(mapped.teacherRemarks, '')
    assert.equal(mapped.attitude, '')
    assert.equal(mapped.savedDaysOpened, null)
    assert.equal(mapped.savedDaysAttended, null)
    assert.equal(initialDaysOpened([mapped]), '')
  })

  it('accepts only non-negative whole numbers and keeps blanks missing', () => {
    assert.deepEqual(
      parseWholeNumber('', { label: 'Days present', min: 0, max: 400 }),
      { value: null, error: null },
    )
    assert.deepEqual(
      parseWholeNumber('58', { label: 'Days present', min: 0, max: 400 }),
      { value: 58, error: null },
    )
    assert.match(
      parseWholeNumber('-1', { label: 'Days present', min: 0, max: 400 })
        .error ?? '',
      /whole number/,
    )
    assert.match(
      parseWholeNumber('12.5', { label: 'Days present', min: 0, max: 400 })
        .error ?? '',
      /whole number/,
    )
    assert.match(
      parseWholeNumber('abc', { label: 'Days present', min: 0, max: 400 })
        .error ?? '',
      /whole number/,
    )
    assert.match(
      parseWholeNumber('401', { label: 'Days present', min: 0, max: 400 })
        .error ?? '',
      /between 0 and 400/,
    )
  })

  it('requires a term total and prevents days present exceeding it', () => {
    const missingTotal = buildAttendancePlan('', [row({ daysAttended: '10' })])
    assert.equal(missingTotal.totalError, null)
    assert.equal(missingTotal.valid, false)

    const emptyDraft = buildAttendancePlan('', [
      row({
        daysOpened: '',
        daysAttended: '',
        savedDaysOpened: null,
        savedDaysAttended: null,
      }),
    ])
    // A brand-new blank page is not "dirty" until the teacher types something.
    assert.equal(emptyDraft.dirty, false)
    assert.equal(
      hasUnsavedChanges(
        'attendance',
        [
          row({
            daysOpened: '',
            daysAttended: '',
            savedDaysOpened: null,
            savedDaysAttended: null,
          }),
        ],
        '',
      ),
      false,
    )

    const exceeded = buildAttendancePlan('60', [
      row({ daysAttended: '61' }),
    ])
    assert.match(
      exceeded.rows[0]!.error ?? '',
      /cannot exceed the school days/,
    )
    assert.equal(exceeded.valid, false)

    const valid = buildAttendancePlan('60', [row({ daysAttended: '60' })])
    assert.equal(valid.valid, true)
    assert.equal(valid.dirty, true)
    assert.deepEqual(
      { opened: valid.rows[0]!.daysOpened, attended: valid.rows[0]!.daysAttended },
      { opened: 60, attended: 60 },
    )
  })

  it('detects unsaved changes and completion per pupil', () => {
    const saved = row()
    assert.equal(hasUnsavedChanges('attendance', [saved], '60'), false)
    assert.equal(isRowComplete('attendance', saved), true)
    assert.equal(
      hasUnsavedChanges('attendance', [saved], '62'),
      true,
    )
    assert.equal(isRowComplete('attendance', row({ daysAttended: '' })), false)

    const remarks = row({ teacherRemarks: 'Saved remark', savedTeacherRemarks: 'Saved remark' })
    assert.equal(hasUnsavedChanges('remarks', [remarks], ''), false)
    assert.equal(completedCount('remarks', [remarks]), 1)
    assert.equal(
      hasUnsavedChanges('remarks', [{ ...remarks, teacherRemarks: 'Edited' }], ''),
      true,
    )

    const attitude = row({ attitude: '', savedAttitude: null })
    assert.equal(isRowComplete('attitude', attitude), false)
    assert.equal(completedCount('attitude', [attitude]), 0)
  })

  it('trims text, rejects overlong entries and never shares one class remark', () => {
    const plan = buildTextPlan('remarks', [
      row({ teacherRemarks: '  First pupil remark.  ' }),
      row({
        pupilId: 'pupil-2',
        pupilName: 'Kojo Boateng',
        teacherRemarks: 'x'.repeat(1001),
      }),
    ])

    assert.equal(plan.rows[0]!.value, 'First pupil remark.')
    assert.equal(plan.rows[0]!.dirty, true)
    assert.equal(plan.rows[1]!.error !== null, true)
    assert.equal(plan.valid, false)
    assert.equal(plan.rows[0]!.pupilId, 'pupil-1')
    assert.equal(plan.rows[1]!.pupilId, 'pupil-2')

    const cleared = buildTextPlan('attitude', [
      row({ attitude: '   ', savedAttitude: 'Old note' }),
    ])
    assert.equal(cleared.rows[0]!.value, null)
    assert.equal(cleared.rows[0]!.dirty, true)
  })

  it('summarises completion and flags mixed saved school-day totals', () => {
    assert.equal(
      completionSummary('remarks', 1, 3),
      '1 of 3 pupils have teacher remarks; 2 still missing.',
    )
    assert.equal(
      completionSummary('attendance', 3, 3),
      'All 3 pupils have attendance records.',
    )
    assert.equal(
      initialDaysOpened([
        row({ savedDaysOpened: null }),
        row({ pupilId: 'pupil-2', savedDaysOpened: 62 }),
      ]),
      '62',
    )
    assert.equal(
      hasMixedDaysOpened([
        row({ savedDaysOpened: 60 }),
        row({ pupilId: 'pupil-2', savedDaysOpened: 62 }),
      ]),
      true,
    )
    assert.equal(
      hasMixedDaysOpened([
        row({ savedDaysOpened: 60 }),
        row({ pupilId: 'pupil-2', savedDaysOpened: null }),
      ]),
      false,
    )
  })
})

describe('class teacher term-record pages', () => {
  it('exposes the three navigation entries only to class teachers', async () => {
    const layout = await source('../src/components/DashboardLayout.tsx')

    for (const path of [
      '/dashboard/attendance',
      '/dashboard/teacher-remarks',
      '/dashboard/attitude',
    ]) {
      assert.match(layout, new RegExp(`to: '${path}'`))
    }

    assert.match(layout, /label: 'Attendance'/)
    assert.match(layout, /label: "Teacher's remarks"/)
    assert.match(layout, /label: 'Attitude'/)
    assert.match(layout, /roles: CLASS_TEACHER_ROLES/)
  })

  it('guards all three routes with the class teacher route', async () => {
    const app = await source('../src/App.tsx')

    for (const page of ['AttendancePage', 'TeacherRemarksPage', 'AttitudePage']) {
      assert.match(app, new RegExp(`<${page} />`))
    }

    const guarded = app.match(/<ClassTeacherRoute>[\s\S]*?<\/ClassTeacherRoute>/g)
    assert.ok(guarded && guarded.length >= 4)
  })

  it('saves each page through the per-pupil report input endpoints', async () => {
    const page = await source('../src/pages/dashboard/ClassTermRecordsPage.tsx')

    assert.match(page, /getReportEligibility/)
    assert.match(page, /listReportInputs/)
    assert.match(page, /upsertReportInput/)
    assert.match(page, /academicTermId: selected\.termId/)
    assert.match(page, /classId,/)
    assert.match(page, /pupilId: row\.pupilId/)
    assert.match(page, /teacherRemarks: row\.value/)
    assert.match(page, /attitude: row\.value/)
    assert.match(page, /discard them/)
  })

  it('warns before leaving unsaved work', async () => {
    const hook = await source('../src/reports/use-unsaved-changes-warning.ts')

    assert.match(hook, /beforeunload/)
    assert.match(hook, /event\.returnValue = message/)
    assert.match(hook, /window\.confirm\(message\)/)
    assert.match(hook, /addEventListener\('click', onClick, true\)/)
  })
})
