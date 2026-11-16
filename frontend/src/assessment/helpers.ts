import type {
  AssessmentCalculationMode,
  AssessmentComponentInput,
  GradeBandInput,
  ResultSubmissionStatus,
  ScoreEntryPupil,
} from './types'

export const SUBMISSION_STATUS_LABELS: Record<
  ResultSubmissionStatus,
  string
> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  RETURNED_FOR_CORRECTION: 'Returned for correction',
  ACCEPTED: 'Accepted',
}

export function submissionTone(
  status: ResultSubmissionStatus,
): 'neutral' | 'success' | 'warning' | 'info' {
  if (status === 'ACCEPTED') return 'success'
  if (status === 'RETURNED_FOR_CORRECTION') return 'warning'
  if (status === 'SUBMITTED') return 'info'
  return 'neutral'
}

export function pupilName(pupil: ScoreEntryPupil): string {
  return [pupil.firstName, pupil.otherNames, pupil.lastName]
    .filter(Boolean)
    .join(' ')
}

export function formatScore(value: number | null): string {
  return value === null ? '--' : value.toFixed(2)
}

/**
 * Formats a backend-calculated rank as an ordinal (1st, 2nd, 3rd, 4th).
 * Returns an em dash when no finalized position is available; positions are
 * never estimated on the client.
 */
export function formatOrdinal(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '—'
  }

  const rank = Math.trunc(value)
  const mod100 = Math.abs(rank) % 100
  const mod10 = Math.abs(rank) % 10
  const suffix =
    mod100 >= 11 && mod100 <= 13
      ? 'th'
      : mod10 === 1
        ? 'st'
        : mod10 === 2
          ? 'nd'
          : mod10 === 3
            ? 'rd'
            : 'th'

  return `${rank}${suffix}`
}

/**
 * Renders the register Position cell. The column is reserved for an academic
 * ranking only: accepted results use the official backend position, while
 * provisional positions come from the live score state.
 *
 * The live provisional value is optional. When it is absent (for example before
 * the register has hydrated, or when live ranking is disabled) the backend's
 * own provisional position is used instead, so a valid position is never hidden
 * merely because the client-side recalculation has not run yet. Passing an
 * explicit null means the pupil is incomplete in the current score state and
 * must show a dash. Workflow wording never belongs in this column.
 */
export function positionDisplay(
  pupil: Pick<ScoreEntryPupil, 'subjectPosition' | 'subjectPositionStatus'>,
  provisionalPosition?: number | null,
): string {
  if (pupil.subjectPositionStatus === 'NOT_ELIGIBLE') {
    return '—'
  }

  if (pupil.subjectPositionStatus === 'FINAL') {
    return formatOrdinal(pupil.subjectPosition)
  }

  return formatOrdinal(
    provisionalPosition === undefined
      ? pupil.subjectPosition
      : provisionalPosition,
  )
}

export function formatPercent(value: string | number): string {
  const numeric = typeof value === 'number' ? value : Number(value)

  return Number.isFinite(numeric) ? `${numeric.toFixed(2)}%` : `${value}%`
}

export interface PreviewResult {
  sba: number | null
  exam: number | null
  final: number | null
  /** Exact final score before contribution rounding; used by early years. */
  finalUnrounded: number | null
  missingComponentIds: string[]
  invalidComponentIds: string[]
}

function decimalToCenti(value: string): number | null {
  const text = value.trim()

  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    return null
  }

  const [whole = '0', fraction = ''] = text.split('.')
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0') || '0')
}

function roundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator))
}

/**
 * Local preview only. The server recalculates with the same documented
 * rounding rule before persisting, and its response replaces this preview.
 *
 * GROUPED_SBA mirrors the backend's standard policy: the raw SBA marks are
 * summed and the single Class Score is scaled, never the individual components.
 */
export function previewPupilResult(
  components: Array<{
    id: string
    maximumScore: string
    weightPercent: string
    category: 'SBA' | 'EXAM'
  }>,
  values: Record<string, string>,
  mode: AssessmentCalculationMode = 'COMPONENT_WEIGHTED',
): PreviewResult {
  if (mode === 'GROUPED_SBA') {
    return previewGroupedPupilResult(components, values)
  }

  const missingComponentIds: string[] = []
  const invalidComponentIds: string[] = []
  let sba = 0
  let exam = 0
  let sbaExact = 0
  let examExact = 0

  for (const component of components) {
    const raw = values[component.id]

    if (raw === undefined || raw.trim() === '') {
      missingComponentIds.push(component.id)
      continue
    }

    const score = decimalToCenti(raw)
    const maximum = decimalToCenti(component.maximumScore)
    const weight = decimalToCenti(component.weightPercent)

    if (
      score === null ||
      maximum === null ||
      weight === null ||
      maximum <= 0 ||
      score > maximum
    ) {
      invalidComponentIds.push(component.id)
      missingComponentIds.push(component.id)
      continue
    }

    const contribution = roundHalfUp(score * weight, maximum)
    const exactContribution = (score * weight) / maximum

    if (component.category === 'SBA') {
      sba += contribution
      sbaExact += exactContribution
    } else {
      exam += contribution
      examExact += exactContribution
    }
  }

  const complete = missingComponentIds.length === 0

  return {
    sba: complete ? sba / 100 : null,
    exam: complete ? exam / 100 : null,
    final: complete ? (sba + exam) / 100 : null,
    finalUnrounded: complete ? (sbaExact + examExact) / 100 : null,
    missingComponentIds,
    invalidComponentIds,
  }
}

function previewGroupedPupilResult(
  components: Array<{
    id: string
    maximumScore: string
    weightPercent: string
    category: 'SBA' | 'EXAM'
  }>,
  values: Record<string, string>,
): PreviewResult {
  const missingComponentIds: string[] = []
  const invalidComponentIds: string[] = []
  const groups = {
    SBA: { raw: 0, maximum: 0, weight: 0, configured: 0 },
    EXAM: { raw: 0, maximum: 0, weight: 0, configured: 0 },
  }

  for (const component of components) {
    const group = groups[component.category]
    const maximum = decimalToCenti(component.maximumScore)
    const weight = decimalToCenti(component.weightPercent)
    const raw = values[component.id]

    if (maximum === null || maximum <= 0 || weight === null || weight <= 0) {
      invalidComponentIds.push(component.id)
      missingComponentIds.push(component.id)
      continue
    }

    group.maximum += maximum
    group.weight += weight
    group.configured += 1

    if (raw === undefined || raw.trim() === '') {
      missingComponentIds.push(component.id)
      continue
    }

    const score = decimalToCenti(raw)

    if (score === null || score > maximum) {
      invalidComponentIds.push(component.id)
      missingComponentIds.push(component.id)
      continue
    }

    group.raw += score
  }

  const configured =
    groups.SBA.configured > 0 &&
    groups.EXAM.configured > 0 &&
    groups.SBA.maximum > 0 &&
    groups.EXAM.maximum > 0 &&
    groups.SBA.weight > 0 &&
    groups.EXAM.weight > 0
  const complete = configured && missingComponentIds.length === 0

  if (!complete) {
    return {
      sba: null,
      exam: null,
      final: null,
      finalUnrounded: null,
      missingComponentIds,
      invalidComponentIds,
    }
  }

  const sba = roundHalfUp(
    groups.SBA.raw * groups.SBA.weight,
    groups.SBA.maximum,
  )
  const exam = roundHalfUp(
    groups.EXAM.raw * groups.EXAM.weight,
    groups.EXAM.maximum,
  )
  const sbaExact = (groups.SBA.raw * groups.SBA.weight) / groups.SBA.maximum
  const examExact =
    (groups.EXAM.raw * groups.EXAM.weight) / groups.EXAM.maximum

  return {
    sba: sba / 100,
    exam: exam / 100,
    final: (sba + exam) / 100,
    finalUnrounded: (sbaExact + examExact) / 100,
    missingComponentIds,
    invalidComponentIds,
  }
}

export function findPreviewBand(
  bands: Array<{
    minScore: string
    maxScore: string
    gradeLabel: string
    remark: string
  }>,
  finalScore: number | null,
): { gradeLabel: string; remark: string } | null {
  if (finalScore === null) return null

  const centi = Math.round(finalScore * 100)

  for (const band of bands) {
    const min = decimalToCenti(band.minScore)
    const max = decimalToCenti(band.maxScore)

    if (min !== null && max !== null && centi >= min && centi <= max) {
      return { gradeLabel: band.gradeLabel, remark: band.remark }
    }
  }

  return null
}

export function totalWeight(
  components: Array<Pick<AssessmentComponentInput, 'weightPercent'>>,
): number {
  return components.reduce((total, component) => {
    const weight = Number(component.weightPercent)
    return total + (Number.isFinite(weight) ? weight : 0)
  }, 0)
}

/**
 * Client-side mirror of the server band validation. The server remains the
 * authority; this only gives immediate feedback while a scheme is edited.
 */
export function validateBands(bands: GradeBandInput[]): string[] {
  const issues: string[] = []

  if (bands.length === 0) {
    return ['Add at least one grading band.']
  }

  const parsed = bands.map((band, index) => ({
    ...band,
    index,
    min: Number(band.minScore),
    max: Number(band.maxScore),
  }))

  for (const band of parsed) {
    if (!band.gradeLabel.trim()) {
      issues.push(`Band ${band.index + 1} needs a grade label.`)
    }

    if (!band.remark.trim()) {
      issues.push(`Band ${band.index + 1} needs a remark.`)
    }

    if (!Number.isFinite(band.min) || band.min < 0 || band.min > 100) {
      issues.push(`Band ${band.index + 1} minimum must be between 0 and 100.`)
    }

    if (!Number.isFinite(band.max) || band.max < 0 || band.max > 100) {
      issues.push(`Band ${band.index + 1} maximum must be between 0 and 100.`)
    }

    if (Number.isFinite(band.min) && Number.isFinite(band.max) && band.min > band.max) {
      issues.push(`Band ${band.index + 1} maximum cannot be below its minimum.`)
    }
  }

  const sorted = [...parsed].sort((a, b) => a.min - b.min)

  if (sorted[0] && sorted[0].min !== 0) {
    issues.push('The first band must start at 0.00.')
  }

  const last = sorted[sorted.length - 1]

  if (last && last.max !== 100) {
    issues.push('The last band must end at 100.00.')
  }

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]
    const current = sorted[index]

    if (!previous || !current) continue

    if (current.min <= previous.max) {
      issues.push(
        `Bands ${previous.gradeLabel} and ${current.gradeLabel} overlap.`,
      )
    } else if (Math.abs(current.min - (previous.max + 0.01)) > 0.0001) {
      issues.push(
        `There is a gap between ${previous.gradeLabel} and ${current.gradeLabel}.`,
      )
    }
  }

  return issues
}

/** Editable example only; schools may use any bands their policy requires. */
export const EXAMPLE_BANDS: GradeBandInput[] = [
  { minScore: '80.00', maxScore: '100.00', gradeLabel: 'A1', remark: 'Excellent', sortOrder: 0 },
  { minScore: '75.00', maxScore: '79.99', gradeLabel: 'B2', remark: 'Very good', sortOrder: 1 },
  { minScore: '70.00', maxScore: '74.99', gradeLabel: 'B3', remark: 'Good', sortOrder: 2 },
  { minScore: '65.00', maxScore: '69.99', gradeLabel: 'C4', remark: 'Credit', sortOrder: 3 },
  { minScore: '60.00', maxScore: '64.99', gradeLabel: 'C5', remark: 'Credit', sortOrder: 4 },
  { minScore: '55.00', maxScore: '59.99', gradeLabel: 'C6', remark: 'Credit', sortOrder: 5 },
  { minScore: '50.00', maxScore: '54.99', gradeLabel: 'D7', remark: 'Pass', sortOrder: 6 },
  { minScore: '45.00', maxScore: '49.99', gradeLabel: 'E8', remark: 'Pass', sortOrder: 7 },
  { minScore: '0.00', maxScore: '44.99', gradeLabel: 'F9', remark: 'Needs support', sortOrder: 8 },
]

/** Editable example only: 40% continuous assessment and 60% examination. */
export const EXAMPLE_COMPONENTS: AssessmentComponentInput[] = [
  {
    key: 'class-test',
    name: 'Class test',
    category: 'SBA',
    maximumScore: '20.00',
    weightPercent: '20.00',
    sortOrder: 0,
  },
  {
    key: 'project',
    name: 'Project',
    category: 'SBA',
    maximumScore: '10.00',
    weightPercent: '10.00',
    sortOrder: 1,
  },
  {
    key: 'homework',
    name: 'Homework',
    category: 'SBA',
    maximumScore: '10.00',
    weightPercent: '10.00',
    sortOrder: 2,
  },
  {
    key: 'examination',
    name: 'Examination',
    category: 'EXAM',
    maximumScore: '100.00',
    weightPercent: '60.00',
    sortOrder: 3,
  },
]
