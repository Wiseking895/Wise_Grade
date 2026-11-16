/**
 * Deterministic, decimal-safe Phase 4 result calculations.
 *
 * Storage convention: every score, maximum and contribution is represented as
 * an integer number of hundredths ("centi" units). A weight is represented in
 * hundredths of a percent ("basis points"), so 40.00% is 4000.
 *
 * Rounding rule: each component contribution is rounded half-up to two decimal
 * places before contributions are summed. Category totals and the final score
 * are therefore exact sums of already-rounded two-decimal values. No final
 * re-rounding is applied.
 *
 * Missing scores are never treated as zero. A component is complete only when
 * a score row exists; an explicit score of 0 is a real, complete zero.
 */

export type AssessmentComponentCategory = 'SBA' | 'EXAM'

/**
 * COMPONENT_WEIGHTED scales every component independently (the original
 * behaviour). GROUPED_SBA first sums the raw marks in each category and then
 * scales the single category total once, which is what the Wise Grade standard
 * policy requires for its four SBA components.
 */
export type AssessmentCalculationMode = 'COMPONENT_WEIGHTED' | 'GROUPED_SBA'

export interface ComponentDefinition {
  id: string
  key: string
  name: string
  category: AssessmentComponentCategory
  /** Decimal string with at most two decimal places, e.g. "20.00". */
  maximumScore: string
  /** Decimal string percentage with at most two decimal places, e.g. "40.00". */
  weightPercent: string
  sortOrder?: number
}

export interface ScoreEntry {
  componentId: string
  /** Decimal string with at most two decimal places. */
  score: string
}

export interface GradeBandDefinition {
  minScore: string
  maxScore: string
  gradeLabel: string
  remark: string
  sortOrder?: number
}

export interface ValidationIssue {
  field: string
  message: string
}

export interface ComponentContribution {
  componentId: string
  category: AssessmentComponentCategory
  contribution: number | null
}

export interface PupilResult {
  contributions: ComponentContribution[]
  sbaContribution: number | null
  examContribution: number | null
  finalScore: number | null
  /**
   * Exact final score before the two-decimal contribution rounding used for
   * storage. Early-years classification uses this value so a score just below
   * a boundary is not promoted by presentation rounding.
   */
  finalScoreUnrounded: number | null
  missingComponentIds: string[]
  issues: ValidationIssue[]
}

const DECIMAL_PATTERN = /^-?\d+(?:\.(\d{1,2}))?$/

/**
 * Parses a decimal string/number into hundredths. Returns null when the value
 * is not a finite decimal with at most two decimal places.
 */
export function decimalToCenti(value: string | number): number | null {
  const text =
    typeof value === 'number'
      ? Number.isFinite(value)
        ? String(value)
        : ''
      : value.trim()

  if (!DECIMAL_PATTERN.test(text)) {
    return null
  }

  const negative = text.startsWith('-')
  const unsigned = negative ? text.slice(1) : text
  const [wholePart = '0', fractionPart = ''] = unsigned.split('.')
  const whole = Number(wholePart)
  const fraction = Number(fractionPart.padEnd(2, '0') || '0')

  if (!Number.isSafeInteger(whole)) {
    return null
  }

  const centi = whole * 100 + fraction
  return negative ? -centi : centi
}

/** Converts hundredths back to a fixed two-decimal number. */
export function centiToNumber(centi: number): number {
  return centi / 100
}

/** Formats hundredths as a fixed two-decimal string. */
export function centiToDecimalString(centi: number): string {
  return (centi / 100).toFixed(2)
}

function roundHalfUp(numerator: number, denominator: number): number {
  // Both operands are non-negative for a valid score/weight/maximum.
  return Math.floor((2 * numerator + denominator) / (2 * denominator))
}

export function totalWeightBasisPoints(
  components: ReadonlyArray<Pick<ComponentDefinition, 'weightPercent'>>,
): number | null {
  let total = 0

  for (const component of components) {
    const basisPoints = decimalToCenti(component.weightPercent)

    if (basisPoints === null) {
      return null
    }

    total += basisPoints
  }

  return total
}

/** Validates an assessment policy's component set. */
export function validateComponents(
  components: ReadonlyArray<ComponentDefinition>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (components.length === 0) {
    issues.push({
      field: 'components',
      message: 'Add at least one assessment component.',
    })
    return issues
  }

  const keys = new Set<string>()
  const categories = new Set<AssessmentComponentCategory>()

  components.forEach((component, index) => {
    const label = component.name.trim() || `Component ${index + 1}`
    const maximum = decimalToCenti(component.maximumScore)
    const weight = decimalToCenti(component.weightPercent)

    if (!component.key.trim()) {
      issues.push({
        field: `components.${index}.key`,
        message: `${label} needs a stable key.`,
      })
    } else if (keys.has(component.key.trim().toLowerCase())) {
      issues.push({
        field: `components.${index}.key`,
        message: `Component key "${component.key}" is duplicated.`,
      })
    }
    keys.add(component.key.trim().toLowerCase())

    if (
      component.category !== 'SBA' &&
      component.category !== 'EXAM'
    ) {
      issues.push({
        field: `components.${index}.category`,
        message: `${label} must be an SBA or examination component.`,
      })
    } else {
      categories.add(component.category)
    }

    if (maximum === null || maximum <= 0) {
      issues.push({
        field: `components.${index}.maximumScore`,
        message: `${label} must have a maximum score greater than zero with at most two decimal places.`,
      })
    }

    if (weight === null || weight <= 0) {
      issues.push({
        field: `components.${index}.weightPercent`,
        message: `${label} must have a weight greater than zero with at most two decimal places.`,
      })
    }
  })

  const total = totalWeightBasisPoints(components)

  if (total === null) {
    issues.push({
      field: 'components',
      message: 'Component weights must be valid percentages with at most two decimal places.',
    })
  } else if (total !== 10_000) {
    issues.push({
      field: 'components',
      message: `Component weights must total exactly 100.00% (currently ${centiToDecimalString(total)}%).`,
    })
  }

  if (components.length > 0 && !categories.has('SBA')) {
    issues.push({
      field: 'components',
      message: 'Include at least one continuous assessment (SBA) component.',
    })
  }

  if (components.length > 0 && !categories.has('EXAM')) {
    issues.push({
      field: 'components',
      message: 'Include at least one examination component.',
    })
  }

  return issues
}

/**
 * Calculates one pupil's contributions and final score.
 *
 * Invalid or out-of-range scores produce issues and leave the final score
 * null. Duplicate component rows are rejected rather than silently merged.
 *
 * GROUPED_SBA sums the raw SBA marks into one Class Score and scales that
 * single total; it never treats the individual SBA components as separately
 * scaled contributions. COMPONENT_WEIGHTED preserves the original behaviour.
 */
export function calculatePupilResult(
  components: ReadonlyArray<ComponentDefinition>,
  entries: ReadonlyArray<ScoreEntry>,
  mode: AssessmentCalculationMode = 'COMPONENT_WEIGHTED',
): PupilResult {
  const issues: ValidationIssue[] = []
  const componentById = new Map<string, ComponentDefinition>()
  const seen = new Set<string>()

  for (const component of components) {
    componentById.set(component.id, component)
  }

  const scoreByComponent = new Map<string, number>()

  for (const entry of entries) {
    const component = componentById.get(entry.componentId)

    if (!component) {
      issues.push({
        field: 'scores',
        message: 'A score references a component that is not part of this policy.',
      })
      continue
    }

    if (seen.has(entry.componentId)) {
      issues.push({
        field: 'scores',
        message: `A score for ${component.name} appears more than once.`,
      })
      continue
    }
    seen.add(entry.componentId)

    const score = decimalToCenti(entry.score)
    const maximum = decimalToCenti(component.maximumScore)

    if (score === null) {
      issues.push({
        field: 'scores',
        message: `${component.name} must be a numeric score with at most two decimal places.`,
      })
      continue
    }

    if (score < 0) {
      issues.push({
        field: 'scores',
        message: `${component.name} cannot be negative.`,
      })
      continue
    }

    if (maximum === null || maximum <= 0) {
      issues.push({
        field: 'config',
        message: `${component.name} has an invalid maximum score.`,
      })
      continue
    }

    if (score > maximum) {
      issues.push({
        field: 'scores',
        message: `${component.name} cannot exceed its maximum of ${centiToDecimalString(maximum)}.`,
      })
      continue
    }

    scoreByComponent.set(entry.componentId, score)
  }

  const contributions: ComponentContribution[] = []
  const missingComponentIds: string[] = []

  if (mode === 'GROUPED_SBA') {
    const groups = {
      SBA: { raw: 0, maximum: 0, weight: 0, configured: 0 },
      EXAM: { raw: 0, maximum: 0, weight: 0, configured: 0 },
    }

    for (const component of components) {
      const group = groups[component.category]
      const maximum = decimalToCenti(component.maximumScore)
      const weight = decimalToCenti(component.weightPercent)
      const score = scoreByComponent.get(component.id)

      if (score === undefined) {
        missingComponentIds.push(component.id)
      }

      if (maximum === null || maximum <= 0 || weight === null || weight <= 0) {
        issues.push({
          field: 'config',
          message: `${component.name} has an invalid maximum score or weight.`,
        })
        contributions.push({
          componentId: component.id,
          category: component.category,
          contribution: null,
        })
        continue
      }

      group.maximum += maximum
      group.weight += weight
      group.configured += 1

      if (score !== undefined) {
        group.raw += score
      }

      // Individual SBA contributions are intentionally not scaled. The raw
      // group total is the only value that is scaled.
      contributions.push({
        componentId: component.id,
        category: component.category,
        contribution: null,
      })
    }

    for (const category of ['SBA', 'EXAM'] as const) {
      const group = groups[category]

      if (group.configured === 0) {
        issues.push({
          field: 'config',
          message:
            category === 'SBA'
              ? 'Include at least one continuous assessment (SBA) component.'
              : 'Include at least one examination component.',
        })
      } else if (group.maximum <= 0 || group.weight <= 0) {
        issues.push({
          field: 'config',
          message:
            category === 'SBA'
              ? 'The SBA group has an invalid total maximum or weight.'
              : 'The examination group has an invalid total maximum or weight.',
        })
      }
    }

    if (issues.length > 0 || missingComponentIds.length > 0) {
      return {
        contributions,
        sbaContribution: null,
        examContribution: null,
        finalScore: null,
        finalScoreUnrounded: null,
        missingComponentIds,
        issues,
      }
    }

    const sbaExactCenti =
      (groups.SBA.raw * groups.SBA.weight) / groups.SBA.maximum
    const examExactCenti =
      (groups.EXAM.raw * groups.EXAM.weight) / groups.EXAM.maximum
    const sbaCenti = roundHalfUp(
      groups.SBA.raw * groups.SBA.weight,
      groups.SBA.maximum,
    )
    const examCenti = roundHalfUp(
      groups.EXAM.raw * groups.EXAM.weight,
      groups.EXAM.maximum,
    )

    return {
      contributions,
      sbaContribution: centiToNumber(sbaCenti),
      examContribution: centiToNumber(examCenti),
      finalScore: centiToNumber(sbaCenti + examCenti),
      finalScoreUnrounded: (sbaExactCenti + examExactCenti) / 100,
      missingComponentIds,
      issues,
    }
  }

  let sbaCenti = 0
  let examCenti = 0
  let sbaExactCenti = 0
  let examExactCenti = 0

  for (const component of components) {
    const score = scoreByComponent.get(component.id)

    if (score === undefined) {
      missingComponentIds.push(component.id)
      contributions.push({
        componentId: component.id,
        category: component.category,
        contribution: null,
      })
      continue
    }

    const maximum = decimalToCenti(component.maximumScore)
    const weight = decimalToCenti(component.weightPercent)

    if (maximum === null || maximum <= 0 || weight === null || weight <= 0) {
      contributions.push({
        componentId: component.id,
        category: component.category,
        contribution: null,
      })
      continue
    }

    // finalCenti = rawCenti * weightBasisPoints / maximumCenti
    const contributionCenti = roundHalfUp(score * weight, maximum)
    // Retain the exact value separately for early-years boundary decisions.
    const exactContributionCenti = (score * weight) / maximum

    if (component.category === 'SBA') {
      sbaCenti += contributionCenti
      sbaExactCenti += exactContributionCenti
    } else {
      examCenti += contributionCenti
      examExactCenti += exactContributionCenti
    }

    contributions.push({
      componentId: component.id,
      category: component.category,
      contribution: centiToNumber(contributionCenti),
    })
  }

  if (issues.length > 0) {
    return {
      contributions,
      sbaContribution: null,
      examContribution: null,
      finalScore: null,
      finalScoreUnrounded: null,
      missingComponentIds,
      issues,
    }
  }

  const incomplete = missingComponentIds.length > 0

  return {
    contributions,
    sbaContribution: incomplete ? null : centiToNumber(sbaCenti),
    examContribution: incomplete ? null : centiToNumber(examCenti),
    finalScore: incomplete ? null : centiToNumber(sbaCenti + examCenti),
    finalScoreUnrounded: incomplete
      ? null
      : (sbaExactCenti + examExactCenti) / 100,
    missingComponentIds,
    issues,
  }
}

/** Validates a grading scheme's bands, including boundary continuity. */
export function validateGradeBands(
  bands: ReadonlyArray<GradeBandDefinition>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (bands.length === 0) {
    issues.push({
      field: 'bands',
      message: 'Add at least one grading band.',
    })
    return issues
  }

  const parsed = bands.map((band, index) => {
    const min = decimalToCenti(band.minScore)
    const max = decimalToCenti(band.maxScore)
    const label = band.gradeLabel.trim()

    if (!label) {
      issues.push({
        field: `bands.${index}.gradeLabel`,
        message: `Band ${index + 1} needs a grade label.`,
      })
    }

    if (!band.remark.trim()) {
      issues.push({
        field: `bands.${index}.remark`,
        message: `Band ${index + 1} needs a remark.`,
      })
    }

    if (min === null || min < 0 || min > 10_000) {
      issues.push({
        field: `bands.${index}.minScore`,
        message: 'Band minimum must be between 0.00 and 100.00.',
      })
    }

    if (max === null || max < 0 || max > 10_000) {
      issues.push({
        field: `bands.${index}.maxScore`,
        message: 'Band maximum must be between 0.00 and 100.00.',
      })
    }

    if (min !== null && max !== null && min > max) {
      issues.push({
        field: `bands.${index}.maxScore`,
        message: 'Band maximum cannot be less than its minimum.',
      })
    }

    return { band, min, max, label, index }
  })

  const labels = new Set<string>()

  for (const { label, index } of parsed) {
    const normalized = label.toLowerCase()

    if (normalized && labels.has(normalized)) {
      issues.push({
        field: `bands.${index}.gradeLabel`,
        message: `Grade label "${label}" is used more than once.`,
      })
    }
    labels.add(normalized)
  }

  const comparable = parsed
    .filter(
      (item): item is typeof item & { min: number; max: number } =>
        item.min !== null && item.max !== null,
    )
    .sort((a, b) => a.min - b.min)

  if (comparable.length !== parsed.length) {
    return issues
  }

  const first = comparable[0]
  const last = comparable[comparable.length - 1]

  if (first && first.min !== 0) {
    issues.push({
      field: 'bands',
      message: 'The first grading band must start at 0.00.',
    })
  }

  if (last && last.max !== 10_000) {
    issues.push({
      field: 'bands',
      message: 'The last grading band must end at 100.00.',
    })
  }

  for (let index = 1; index < comparable.length; index += 1) {
    const previous = comparable[index - 1]
    const current = comparable[index]

    if (!previous || !current) {
      continue
    }

    if (current.min <= previous.max) {
      issues.push({
        field: 'bands',
        message: `Grading bands overlap between ${previous.band.gradeLabel} and ${current.band.gradeLabel}.`,
      })
    } else if (current.min !== previous.max + 1) {
      issues.push({
        field: 'bands',
        message: `A grading gap exists between ${previous.band.gradeLabel} and ${current.band.gradeLabel}.`,
      })
    }
  }

  return issues
}

/** Finds the band containing a two-decimal final score. */
export function findGradeBand(
  bands: ReadonlyArray<GradeBandDefinition>,
  finalScore: number | string,
): GradeBandDefinition | null {
  const score = decimalToCenti(finalScore)

  if (score === null) {
    return null
  }

  for (const band of bands) {
    const min = decimalToCenti(band.minScore)
    const max = decimalToCenti(band.maxScore)

    if (min !== null && max !== null && score >= min && score <= max) {
      return band
    }
  }

  return null
}
