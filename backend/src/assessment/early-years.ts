/**
 * Early-years performance descriptors.
 *
 * Creche, Nursery and Kindergarten subjects are not graded with conventional
 * letter grades. Each subject is classified independently from its final
 * score out of 100, using the unrounded calculated score:
 *
 *   >= 80       Gold   (G)
 *   >= 55 < 80  Silver (S)
 *   < 55        Bronze (B)
 *
 * These descriptors are system-managed. They are never stored as an editable
 * grading scheme and are snapshotted into generated reports so historical
 * reports do not change when future rules change.
 */

export type EarlyYearsSymbol = 'G' | 'S' | 'B'
export type EarlyYearsRemark = 'Gold' | 'Silver' | 'Bronze'

export interface EarlyYearsPerformance {
  symbol: EarlyYearsSymbol
  remark: EarlyYearsRemark
  /** Display value used in the Remarks column, e.g. "Gold (G)". */
  display: string
}

/** The fixed, read-only performance scale printed on early-years reports. */
export const EARLY_YEARS_SCALE = [
  {
    minScore: '80.00',
    maxScore: '100.00',
    gradeLabel: 'G',
    remark: 'Gold',
    sortOrder: 0,
  },
  {
    minScore: '55.00',
    maxScore: '79.99',
    gradeLabel: 'S',
    remark: 'Silver',
    sortOrder: 1,
  },
  {
    minScore: '0.00',
    maxScore: '54.99',
    gradeLabel: 'B',
    remark: 'Bronze',
    sortOrder: 2,
  },
] as const

const GOLD: EarlyYearsPerformance = {
  symbol: 'G',
  remark: 'Gold',
  display: 'Gold (G)',
}

const SILVER: EarlyYearsPerformance = {
  symbol: 'S',
  remark: 'Silver',
  display: 'Silver (S)',
}

const BRONZE: EarlyYearsPerformance = {
  symbol: 'B',
  remark: 'Bronze',
  display: 'Bronze (B)',
}

/** Normalizes a class name or level for tolerant matching. */
function normalizeClassLabel(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

const EARLY_YEARS_NAME = /^(creche|nursery[12]?|kg[12]?|kindergarten[12]?)$/
const EARLY_YEARS_LEVEL =
  /^(creche|nursery|kindergarten|earlyyears|preschool|preprimary)$/
const NON_EARLY_YEARS_NAME =
  /^(basic|primary|jhs|jss|junior|senior|shs|sss)\d*/

/**
 * Returns true only for Creche, Nursery 1, Nursery 2, KG1 and KG2.
 *
 * The class name is authoritative. Basic 1 and above are explicitly excluded
 * even if a level value is malformed or unexpectedly set to an early-years
 * level.
 */
export function isEarlyYearsClass(input: {
  name?: string | null
  level?: string | null
}): boolean {
  const name = normalizeClassLabel(input.name)
  const level = normalizeClassLabel(input.level)

  if (name !== '' && NON_EARLY_YEARS_NAME.test(name)) {
    return false
  }

  if (name !== '' && EARLY_YEARS_NAME.test(name)) {
    return true
  }

  return EARLY_YEARS_LEVEL.test(level)
}

/**
 * Classifies an unrounded final subject score out of 100. A missing score is
 * never classified. Out-of-range values are rejected rather than clamped.
 */
export function earlyYearsPerformance(
  score: number | string | null | undefined,
): EarlyYearsPerformance | null {
  if (score === null || score === undefined) {
    return null
  }

  const numeric = typeof score === 'number' ? score : Number(score)

  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
    return null
  }

  if (numeric >= 80) {
    return GOLD
  }

  if (numeric >= 55) {
    return SILVER
  }

  return BRONZE
}

/** Convenience wrapper returning the display text or null. */
export function earlyYearsRemark(
  score: number | string | null | undefined,
): string | null {
  return earlyYearsPerformance(score)?.display ?? null
}
