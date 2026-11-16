/**
 * Pure helpers for the SBA register presentation.
 *
 * These helpers only group configured components, validate a single score cell
 * and sum raw marks for display. Scaled contributions, final scores, grades
 * and remarks remain the backend's responsibility; the editable grid preview
 * mirrors the backend formula and is replaced by the server response on save.
 */

export type RegisterCategory = 'SBA' | 'EXAM'

export interface RegisterComponentLike {
  id: string
  category: RegisterCategory
  name: string
  sortOrder: number
  maximumScore: string
  weightPercent: string
}

export interface SplitComponents<T extends RegisterComponentLike> {
  sba: T[]
  exam: T[]
}

export function splitComponents<T extends RegisterComponentLike>(
  components: readonly T[],
): SplitComponents<T> {
  const sorted = [...components].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder || left.name.localeCompare(right.name),
  )

  return {
    sba: sorted.filter((component) => component.category === 'SBA'),
    exam: sorted.filter((component) => component.category === 'EXAM'),
  }
}

export type ScoreInputState = 'missing' | 'valid' | 'invalid'

export interface ScoreInputResult {
  state: ScoreInputState
  value: number | null
  message: string | null
}

const DECIMAL_PATTERN = /^\d+(?:\.\d{1,2})?$/

/** Parses a non-negative decimal string into hundredths. */
function toCenti(value: string): number | null {
  const text = value.trim()

  if (!DECIMAL_PATTERN.test(text)) {
    return null
  }

  const [wholePart = '0', fractionPart = ''] = text.split('.')
  const whole = Number(wholePart)

  if (!Number.isSafeInteger(whole)) {
    return null
  }

  return whole * 100 + Number(fractionPart.padEnd(2, '0') || '0')
}

/**
 * Validates one score cell against the configured maximum.
 *
 * Blank means missing and is never coerced to zero. An explicit "0" is a real
 * score and remains valid.
 */
export function validateScoreInput(
  raw: string | undefined,
  maximumScore: string,
): ScoreInputResult {
  const text = raw?.trim() ?? ''

  if (text === '') {
    return { state: 'missing', value: null, message: null }
  }

  const maximum = toCenti(maximumScore)
  const value = toCenti(text)

  if (value === null) {
    return {
      state: 'invalid',
      value: null,
      message: 'Enter a number with at most two decimal places.',
    }
  }

  if (maximum === null || maximum <= 0) {
    return {
      state: 'invalid',
      value: null,
      message: 'The component maximum is misconfigured.',
    }
  }

  if (value > maximum) {
    return {
      state: 'invalid',
      value: null,
      message: `Score cannot exceed the maximum of ${(maximum / 100).toFixed(2)}.`,
    }
  }

  return { state: 'valid', value: value / 100, message: null }
}

export interface CategoryRawTotal {
  /** Sum of valid entered marks, or null when no valid mark was entered. */
  enteredTotal: number | null
  /** Sum of the category's configured maxima. */
  maximum: number
  /** Sum of the category's configured weights. */
  weight: number
  missingCount: number
  invalidCount: number
  complete: boolean
}

/**
 * Sums the raw marks for one category. This is a display total only: the
 * backend recalculates every contribution and the final result on save.
 */
export function categoryRawTotal(
  components: readonly RegisterComponentLike[],
  values: Record<string, string>,
): CategoryRawTotal {
  let enteredCenti = 0
  let maximumCenti = 0
  let weightCenti = 0
  let entered = 0
  let missingCount = 0
  let invalidCount = 0

  for (const component of components) {
    const maximum = toCenti(component.maximumScore)
    const weight = toCenti(component.weightPercent)
    const result = validateScoreInput(values[component.id], component.maximumScore)

    if (maximum !== null) {
      maximumCenti += maximum
    }

    if (weight !== null) {
      weightCenti += weight
    }

    if (result.state === 'missing') {
      missingCount += 1
    } else if (result.state === 'invalid') {
      invalidCount += 1
    } else if (result.value !== null) {
      entered += 1
      enteredCenti += Math.round(result.value * 100)
    }
  }

  return {
    enteredTotal: entered > 0 ? enteredCenti / 100 : null,
    maximum: maximumCenti / 100,
    weight: weightCenti / 100,
    missingCount,
    invalidCount,
    complete:
      components.length > 0 && missingCount === 0 && invalidCount === 0,
  }
}

export interface RegisterReadiness {
  totalPupils: number
  completePupils: number
  incompletePupils: number
  invalidPupils: number
  canSubmit: boolean
  reason: string | null
}

export interface ReadinessPupil {
  pupilId: string
}

/**
 * Calculates local readiness from the current unsaved grid. It blocks the
 * submit dialog early; the backend remains the final authority.
 */
export function registerReadiness(
  components: readonly RegisterComponentLike[],
  pupils: readonly ReadinessPupil[],
  values: Record<string, Record<string, string>>,
): RegisterReadiness {
  let completePupils = 0
  let invalidPupils = 0

  for (const pupil of pupils) {
    const pupilValues = values[pupil.pupilId] ?? {}
    let invalid = false
    let missing = false

    for (const component of components) {
      const result = validateScoreInput(
        pupilValues[component.id],
        component.maximumScore,
      )

      if (result.state === 'invalid') {
        invalid = true
      } else if (result.state === 'missing') {
        missing = true
      }
    }

    if (invalid) {
      invalidPupils += 1
    } else if (missing) {
      continue
    } else {
      completePupils += 1
    }
  }

  const totalPupils = pupils.length
  const incompletePupils = totalPupils - completePupils
  const canSubmit = totalPupils > 0 && incompletePupils === 0

  return {
    totalPupils,
    completePupils,
    incompletePupils,
    invalidPupils,
    canSubmit,
    reason:
      totalPupils === 0
        ? 'There are no active pupils on this sheet.'
        : invalidPupils > 0
          ? `${invalidPupils} pupil${invalidPupils === 1 ? '' : 's'} have an invalid score.`
          : incompletePupils > 0
            ? `${incompletePupils} pupil${incompletePupils === 1 ? '' : 's'} still need one or more scores.`
            : null,
  }
}

export function isSubmissionLocked(
  status: 'DRAFT' | 'SUBMITTED' | 'RETURNED_FOR_CORRECTION' | 'ACCEPTED' | null,
): boolean {
  return status === 'SUBMITTED' || status === 'ACCEPTED'
}

/**
 * Resolves the next score cell for vertical keyboard movement. Returns null
 * for keys the grid does not handle (notably Tab, which keeps its native
 * left-to-right browser behaviour).
 */
export function scoreNavigationTarget(
  key: string,
  pupilIndex: number,
  componentIndex: number,
  rowCount: number,
  shiftKey = false,
): string | null {
  if (!['Enter', 'ArrowDown', 'ArrowUp'].includes(key)) {
    return null
  }

  const offset =
    key === 'ArrowUp' || (key === 'Enter' && shiftKey) ? -1 : 1
  const targetIndex = Math.min(
    Math.max(pupilIndex + offset, 0),
    Math.max(rowCount - 1, 0),
  )

  return `score-${targetIndex}-${componentIndex}`
}

/** Printed values stay literal: a real zero is retained, a blank stays blank. */
export function printableScore(raw: string | undefined): string {
  return raw?.trim() ?? ''
}
