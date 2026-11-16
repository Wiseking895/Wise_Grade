import type {
  ReportEligibilityItem,
  ReportInput,
} from './types'

export type TermRecordKind = 'attendance' | 'remarks' | 'attitude'

/**
 * One editable row on a Class Teacher term-records page. The saved values are
 * kept beside the editable strings so the page can warn about unsaved changes
 * and show a completion state without guessing.
 */
export interface TermRecordRow {
  pupilId: string
  pupilName: string
  eligible: boolean
  failureMessage: string | null
  daysOpened: string
  daysAttended: string
  teacherRemarks: string
  attitude: string
  savedDaysOpened: number | null
  savedDaysAttended: number | null
  savedTeacherRemarks: string | null
  savedAttitude: string | null
  savedAt: string | null
}

export function rowsFromInputs(
  pupils: ReportEligibilityItem[],
  inputs: ReportInput[],
): TermRecordRow[] {
  const byPupil = new Map(inputs.map((input) => [input.pupilId, input]))

  return pupils.map((pupil) => {
    const input = byPupil.get(pupil.pupilId)

    return {
      pupilId: pupil.pupilId,
      pupilName: pupil.pupilName,
      eligible: pupil.eligible,
      failureMessage: pupil.failure?.message ?? null,
      daysOpened:
        input?.daysOpened === null || input?.daysOpened === undefined
          ? ''
          : String(input.daysOpened),
      daysAttended:
        input?.daysAttended === null || input?.daysAttended === undefined
          ? ''
          : String(input.daysAttended),
      teacherRemarks: input?.teacherRemarks ?? '',
      attitude: input?.attitude ?? '',
      savedDaysOpened: input?.daysOpened ?? null,
      savedDaysAttended: input?.daysAttended ?? null,
      savedTeacherRemarks: input?.teacherRemarks ?? null,
      savedAttitude: input?.attitude ?? null,
      savedAt: input?.updatedAt ?? null,
    }
  })
}

/** The class-level school-days value shown above the attendance list. */
export function initialDaysOpened(rows: TermRecordRow[]): string {
  const first = rows.find((row) => row.savedDaysOpened !== null)
  return first?.savedDaysOpened !== null &&
    first?.savedDaysOpened !== undefined
    ? String(first.savedDaysOpened)
    : ''
}

export function hasMixedDaysOpened(rows: TermRecordRow[]): boolean {
  const values = new Set(
    rows
      .map((row) => row.savedDaysOpened)
      .filter((value): value is number => value !== null),
  )
  return values.size > 1
}

export interface WholeNumberResult {
  value: number | null
  error: string | null
}

/**
 * Empty input is deliberately `null` rather than zero: a missing attendance
 * value must stay missing on the report card.
 */
export function parseWholeNumber(
  raw: string,
  options: { label: string; min: number; max: number },
): WholeNumberResult {
  const trimmed = raw.trim()

  if (trimmed === '') {
    return { value: null, error: null }
  }

  if (!/^\d+$/.test(trimmed)) {
    return {
      value: null,
      error: `${options.label} must be a whole number.`,
    }
  }

  const value = Number(trimmed)

  if (!Number.isSafeInteger(value)) {
    return {
      value: null,
      error: `${options.label} must be a whole number.`,
    }
  }

  if (value < options.min || value > options.max) {
    return {
      value: null,
      error: `${options.label} must be between ${options.min} and ${options.max}.`,
    }
  }

  return { value, error: null }
}

export interface AttendancePlanRow {
  pupilId: string
  daysOpened: number
  daysAttended: number | null
  error: string | null
  dirty: boolean
}

export interface AttendancePlan {
  totalError: string | null
  rows: AttendancePlanRow[]
  valid: boolean
  dirty: boolean
}

export function buildAttendancePlan(
  totalValue: string,
  rows: TermRecordRow[],
): AttendancePlan {
  const total = parseWholeNumber(totalValue, {
    label: 'School days in the term',
    min: 1,
    max: 400,
  })

  const planned: AttendancePlanRow[] = rows.map((row) => {
    const attended = parseWholeNumber(row.daysAttended, {
      label: 'Days present',
      min: 0,
      max: 400,
    })
    let error = attended.error

    if (
      error === null &&
      attended.value !== null &&
      total.value !== null &&
      attended.value > total.value
    ) {
      error = 'Days present cannot exceed the school days entered for the term.'
    }

    if (error === null && attended.value !== null && total.error !== null) {
      error = 'Enter a valid school-days total before saving attendance.'
    }

    return {
      pupilId: row.pupilId,
      daysOpened: total.value ?? 0,
      daysAttended: attended.value,
      error,
      dirty:
        (total.value === null
          ? row.savedDaysOpened !== null
          : total.value !== row.savedDaysOpened) ||
        attended.value !== row.savedDaysAttended,
    }
  })

  const valid =
    total.error === null &&
    total.value !== null &&
    planned.every((row) => row.error === null)

  return {
    totalError: total.error,
    rows: planned,
    valid,
    dirty: planned.some((row) => row.dirty),
  }
}

export interface TextPlanRow {
  pupilId: string
  value: string | null
  error: string | null
  dirty: boolean
  complete: boolean
}

export interface TextPlan {
  rows: TextPlanRow[]
  valid: boolean
  dirty: boolean
}

export function buildTextPlan(
  kind: 'remarks' | 'attitude',
  rows: TermRecordRow[],
): TextPlan {
  const maxLength = kind === 'remarks' ? 1000 : 400

  const planned: TextPlanRow[] = rows.map((row) => {
    const raw =
      kind === 'remarks' ? row.teacherRemarks : row.attitude
    const saved =
      kind === 'remarks' ? row.savedTeacherRemarks : row.savedAttitude
    const trimmed = raw.trim()
    const error =
      trimmed.length > maxLength
        ? `Keep this entry to ${maxLength} characters or fewer.`
        : null

    return {
      pupilId: row.pupilId,
      value: trimmed === '' ? null : trimmed,
      error,
      dirty: (saved ?? '').trim() !== trimmed,
      complete: trimmed !== '',
    }
  })

  return {
    rows: planned,
    valid: planned.every((row) => row.error === null),
    dirty: planned.some((row) => row.dirty),
  }
}

export function isRowComplete(
  kind: TermRecordKind,
  row: TermRecordRow,
): boolean {
  if (kind === 'attendance') {
    return (
      row.daysOpened.trim() !== '' && row.daysAttended.trim() !== ''
    )
  }

  return (kind === 'remarks' ? row.teacherRemarks : row.attitude).trim() !== ''
}

export function completedCount(
  kind: TermRecordKind,
  rows: TermRecordRow[],
): number {
  return rows.filter((row) => isRowComplete(kind, row)).length
}

export function hasUnsavedChanges(
  kind: TermRecordKind,
  rows: TermRecordRow[],
  totalValue: string,
): boolean {
  if (kind === 'attendance') {
    return buildAttendancePlan(totalValue, rows).dirty
  }

  return buildTextPlan(kind, rows).dirty
}

export function completionSummary(
  kind: TermRecordKind,
  completed: number,
  total: number,
): string {
  const noun =
    kind === 'attendance'
      ? 'attendance records'
      : kind === 'remarks'
        ? 'teacher remarks'
        : 'attitude entries'

  if (total === 0) {
    return `No pupils are enrolled, so there are no ${noun} to complete.`
  }

  if (completed === total) {
    return `All ${total} pupils have ${noun}.`
  }

  return `${completed} of ${total} pupils have ${noun}; ${
    total - completed
  } still missing.`
}
