/**
 * Client-side mirror of the system early-years performance rules.
 *
 * Creche, Nursery 1, Nursery 2, KG1 and KG2 subjects are never shown with
 * conventional letter grades. Each subject is classified from its unrounded
 * final score:
 *
 *   >= 80       Gold   (G)
 *   >= 55 < 80  Silver (S)
 *   < 55        Bronze (B)
 */

export type EarlyYearsSymbol = 'G' | 'S' | 'B'
export type EarlyYearsRemark = 'Gold' | 'Silver' | 'Bronze'

export interface EarlyYearsPerformance {
  symbol: EarlyYearsSymbol
  remark: EarlyYearsRemark
  display: string
}

export const EARLY_YEARS_SCALE = [
  { minScore: '80.00', maxScore: '100.00', gradeLabel: 'G', remark: 'Gold' },
  { minScore: '55.00', maxScore: '79.99', gradeLabel: 'S', remark: 'Silver' },
  { minScore: '0.00', maxScore: '54.99', gradeLabel: 'B', remark: 'Bronze' },
] as const

function normalize(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

const EARLY_YEARS_NAME = /^(creche|nursery[12]?|kg[12]?|kindergarten[12]?)$/
const EARLY_YEARS_LEVEL =
  /^(creche|nursery|kindergarten|earlyyears|preschool|preprimary)$/
const NON_EARLY_YEARS_NAME =
  /^(basic|primary|jhs|jss|junior|senior|shs|sss)\d*/

/** Matches the backend: class name is authoritative; Basic 1+ is excluded. */
export function isEarlyYearsClass(input: {
  name?: string | null
  level?: string | null
}): boolean {
  const name = normalize(input.name)
  const level = normalize(input.level)

  if (name !== '' && NON_EARLY_YEARS_NAME.test(name)) {
    return false
  }

  if (name !== '' && EARLY_YEARS_NAME.test(name)) {
    return true
  }

  return EARLY_YEARS_LEVEL.test(level)
}

/** Classifies an unrounded score out of 100. Missing scores stay unclassified. */
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
    return { symbol: 'G', remark: 'Gold', display: 'Gold (G)' }
  }

  if (numeric >= 55) {
    return { symbol: 'S', remark: 'Silver', display: 'Silver (S)' }
  }

  return { symbol: 'B', remark: 'Bronze', display: 'Bronze (B)' }
}

/** Display text used in the register and report Remarks column. */
export function earlyYearsRemark(
  score: number | string | null | undefined,
): string | null {
  return earlyYearsPerformance(score)?.display ?? null
}
