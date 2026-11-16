import { describe, expect, it } from 'vitest'
import {
  calculatePupilResult,
  decimalToCenti,
  findGradeBand,
  validateComponents,
  validateGradeBands,
  type ComponentDefinition,
  type GradeBandDefinition,
} from '../src/assessment/calculation.js'
import { STANDARD_ASSESSMENT_COMPONENTS } from '../src/assessment/defaults.js'
import {
  earlyYearsPerformance,
  isEarlyYearsClass,
} from '../src/assessment/early-years.js'

const EXAMPLE_COMPONENTS: ComponentDefinition[] = [
  {
    id: 'class-test',
    key: 'class-test',
    name: 'Class test',
    category: 'SBA',
    maximumScore: '20.00',
    weightPercent: '20.00',
    sortOrder: 0,
  },
  {
    id: 'project',
    key: 'project',
    name: 'Project',
    category: 'SBA',
    maximumScore: '10.00',
    weightPercent: '10.00',
    sortOrder: 1,
  },
  {
    id: 'homework',
    key: 'homework',
    name: 'Homework',
    category: 'SBA',
    maximumScore: '10.00',
    weightPercent: '10.00',
    sortOrder: 2,
  },
  {
    id: 'examination',
    key: 'examination',
    name: 'Examination',
    category: 'EXAM',
    maximumScore: '100.00',
    weightPercent: '60.00',
    sortOrder: 3,
  },
]

const BANDS: GradeBandDefinition[] = [
  { minScore: '80.00', maxScore: '100.00', gradeLabel: 'A1', remark: 'Excellent' },
  { minScore: '70.00', maxScore: '79.99', gradeLabel: 'B2', remark: 'Very good' },
  { minScore: '60.00', maxScore: '69.99', gradeLabel: 'C4', remark: 'Credit' },
  { minScore: '50.00', maxScore: '59.99', gradeLabel: 'D7', remark: 'Pass' },
  { minScore: '0.00', maxScore: '49.99', gradeLabel: 'F9', remark: 'Needs support' },
]

describe('decimal parsing and deterministic rounding', () => {
  it('parses two-decimal values into exact hundredths', () => {
    expect(decimalToCenti('40.00')).toBe(4000)
    expect(decimalToCenti('0.01')).toBe(1)
    expect(decimalToCenti('19.99')).toBe(1999)
    expect(decimalToCenti('8')).toBe(800)
    expect(decimalToCenti('1.234')).toBeNull()
    expect(decimalToCenti('abc')).toBeNull()
  })

  it('rounds each component contribution half-up to two decimals', () => {
    const result = calculatePupilResult(
      [
        {
          id: 'one',
          key: 'one',
          name: 'One',
          category: 'SBA',
          maximumScore: '16.00',
          weightPercent: '10.00',
        },
        {
          id: 'exam',
          key: 'exam',
          name: 'Exam',
          category: 'EXAM',
          maximumScore: '100.00',
          weightPercent: '90.00',
        },
      ],
      [
        { componentId: 'one', score: '1.00' },
        { componentId: 'exam', score: '90.00' },
      ],
    )

    // 1/16 * 10 = 0.625 -> 0.63 (half-up), not 0.62.
    expect(result.contributions[0]?.contribution).toBe(0.63)
    expect(result.sbaContribution).toBe(0.63)
    expect(result.examContribution).toBe(81)
    expect(result.finalScore).toBe(81.63)
  })

  it('sums already-rounded component contributions exactly', () => {
    const result = calculatePupilResult(
      [
        {
          id: 'a',
          key: 'a',
          name: 'A',
          category: 'SBA',
          maximumScore: '3.00',
          weightPercent: '50.00',
        },
        {
          id: 'b',
          key: 'b',
          name: 'B',
          category: 'EXAM',
          maximumScore: '3.00',
          weightPercent: '50.00',
        },
      ],
      [
        { componentId: 'a', score: '1.00' },
        { componentId: 'b', score: '1.00' },
      ],
    )

    // 1/3 * 50 = 16.666... -> 16.67 each, total 33.34.
    expect(result.sbaContribution).toBe(16.67)
    expect(result.examContribution).toBe(16.67)
    expect(result.finalScore).toBe(33.34)
  })
})

describe('configurable SBA and examination weighting', () => {
  it('normalizes raw scores into a 40% SBA / 60% exam final score', () => {
    const result = calculatePupilResult(EXAMPLE_COMPONENTS, [
      { componentId: 'class-test', score: '16.00' },
      { componentId: 'project', score: '8.00' },
      { componentId: 'homework', score: '9.00' },
      { componentId: 'examination', score: '75.00' },
    ])

    expect(result.issues).toEqual([])
    expect(result.missingComponentIds).toEqual([])
    expect(result.sbaContribution).toBe(33)
    expect(result.examContribution).toBe(45)
    expect(result.finalScore).toBe(78)
  })

  it('supports a different policy such as 30% SBA / 70% exam', () => {
    const result = calculatePupilResult(
      [
        {
          id: 'sba',
          key: 'sba',
          name: 'SBA',
          category: 'SBA',
          maximumScore: '100.00',
          weightPercent: '30.00',
        },
        {
          id: 'exam',
          key: 'exam',
          name: 'Exam',
          category: 'EXAM',
          maximumScore: '100.00',
          weightPercent: '70.00',
        },
      ],
      [
        { componentId: 'sba', score: '80.00' },
        { componentId: 'exam', score: '50.00' },
      ],
    )

    expect(result.sbaContribution).toBe(24)
    expect(result.examContribution).toBe(35)
    expect(result.finalScore).toBe(59)
  })

  it('accepts a fully valid component configuration', () => {
    expect(validateComponents(EXAMPLE_COMPONENTS)).toEqual([])
  })

  it('rejects component weights that do not total 100 percent', () => {
    const issues = validateComponents([
      {
        id: 'sba',
        key: 'sba',
        name: 'SBA',
        category: 'SBA',
        maximumScore: '100.00',
        weightPercent: '40.00',
      },
      {
        id: 'exam',
        key: 'exam',
        name: 'Exam',
        category: 'EXAM',
        maximumScore: '100.00',
        weightPercent: '50.00',
      },
    ])

    expect(issues.some((issue) => issue.message.includes('100.00%'))).toBe(true)
  })

  it('rejects negative, zero or over-precise weights and maxima', () => {
    const issues = validateComponents([
      {
        id: 'sba',
        key: 'sba',
        name: 'SBA',
        category: 'SBA',
        maximumScore: '0',
        weightPercent: '-1',
      },
      {
        id: 'exam',
        key: 'exam',
        name: 'Exam',
        category: 'EXAM',
        maximumScore: '100.001',
        weightPercent: '101',
      },
    ])

    expect(issues.length).toBeGreaterThan(2)
  })

  it('rejects duplicate keys and a missing SBA or exam category', () => {
    const duplicate = validateComponents([
      {
        id: 'sba',
        key: 'same',
        name: 'SBA',
        category: 'SBA',
        maximumScore: '100',
        weightPercent: '100',
      },
      {
        id: 'sba2',
        key: 'same',
        name: 'SBA 2',
        category: 'SBA',
        maximumScore: '100',
        weightPercent: '0.01',
      },
    ])

    expect(duplicate.some((issue) => issue.message.includes('duplicated'))).toBe(true)
    expect(duplicate.some((issue) => issue.message.includes('examination'))).toBe(true)

    const noSba = validateComponents([
      {
        id: 'exam',
        key: 'exam',
        name: 'Exam',
        category: 'EXAM',
        maximumScore: '100',
        weightPercent: '100',
      },
    ])
    expect(noSba.some((issue) => issue.message.includes('SBA'))).toBe(true)
  })
})

describe('missing scores are distinct from zero', () => {
  it('returns a null final score when a required component is missing', () => {
    const result = calculatePupilResult(EXAMPLE_COMPONENTS, [
      { componentId: 'class-test', score: '16' },
      { componentId: 'project', score: '8' },
      { componentId: 'homework', score: '9' },
    ])

    expect(result.missingComponentIds).toEqual(['examination'])
    expect(result.sbaContribution).toBeNull()
    expect(result.examContribution).toBeNull()
    expect(result.finalScore).toBeNull()
  })

  it('treats an explicit zero as a complete zero score', () => {
    const result = calculatePupilResult(
      [
        {
          id: 'sba',
          key: 'sba',
          name: 'SBA',
          category: 'SBA',
          maximumScore: '100',
          weightPercent: '40',
        },
        {
          id: 'exam',
          key: 'exam',
          name: 'Exam',
          category: 'EXAM',
          maximumScore: '100',
          weightPercent: '60',
        },
      ],
      [
        { componentId: 'sba', score: '0' },
        { componentId: 'exam', score: '0' },
      ],
    )

    expect(result.missingComponentIds).toEqual([])
    expect(result.sbaContribution).toBe(0)
    expect(result.examContribution).toBe(0)
    expect(result.finalScore).toBe(0)
  })

  it('rejects scores above the component maximum and negative scores', () => {
    const over = calculatePupilResult(EXAMPLE_COMPONENTS, [
      { componentId: 'class-test', score: '21' },
    ])
    expect(over.issues.some((issue) => issue.message.includes('cannot exceed'))).toBe(true)
    expect(over.finalScore).toBeNull()

    const negative = calculatePupilResult(EXAMPLE_COMPONENTS, [
      { componentId: 'class-test', score: '-1' },
    ])
    expect(negative.issues.length).toBeGreaterThan(0)
    expect(negative.finalScore).toBeNull()
  })

  it('rejects duplicate component rows rather than merging them', () => {
    const result = calculatePupilResult(EXAMPLE_COMPONENTS, [
      { componentId: 'class-test', score: '10' },
      { componentId: 'class-test', score: '15' },
    ])

    expect(result.issues.some((issue) => issue.message.includes('more than once'))).toBe(true)
  })
})

describe('Wise Grade standard grouped SBA policy', () => {
  const STANDARD_COMPONENTS: ComponentDefinition[] =
    STANDARD_ASSESSMENT_COMPONENTS.map((component, index) => ({
      id: component.key,
      key: component.key,
      name: component.name,
      category: component.category,
      maximumScore: component.maximumScore,
      weightPercent: component.weightPercent,
      sortOrder: component.sortOrder ?? index,
    }))

  function standardEntries(
    sba: [string, string, string, string],
    exam: string,
  ) {
    return [
      { componentId: 'individual-test', score: sba[0] },
      { componentId: 'group-work', score: sba[1] },
      { componentId: 'class-test', score: sba[2] },
      { componentId: 'project', score: sba[3] },
      { componentId: 'examination', score: exam },
    ]
  }

  it('defines the four SBA components and examination in the required order', () => {
    expect(
      STANDARD_ASSESSMENT_COMPONENTS.map((component) => ({
        key: component.key,
        name: component.name,
        category: component.category,
        maximumScore: component.maximumScore,
      })),
    ).toEqual([
      {
        key: 'individual-test',
        name: 'Individual Test',
        category: 'SBA',
        maximumScore: '15.00',
      },
      {
        key: 'group-work',
        name: 'Group Work',
        category: 'SBA',
        maximumScore: '15.00',
      },
      {
        key: 'class-test',
        name: 'Class Test',
        category: 'SBA',
        maximumScore: '15.00',
      },
      {
        key: 'project',
        name: 'Project',
        category: 'SBA',
        maximumScore: '15.00',
      },
      {
        key: 'examination',
        name: 'Examination',
        category: 'EXAM',
        maximumScore: '100.00',
      },
    ])
  })

  it('uses 7.50% per SBA component and 70.00% for the examination', () => {
    expect(
      STANDARD_ASSESSMENT_COMPONENTS.map((component) => ({
        key: component.key,
        weightPercent: component.weightPercent,
      })),
    ).toEqual([
      { key: 'individual-test', weightPercent: '7.50' },
      { key: 'group-work', weightPercent: '7.50' },
      { key: 'class-test', weightPercent: '7.50' },
      { key: 'project', weightPercent: '7.50' },
      { key: 'examination', weightPercent: '70.00' },
    ])
  })

  it('Example A: Class Score 48/60 and examination 80/100 produce 80', () => {
    const result = calculatePupilResult(
      STANDARD_COMPONENTS,
      standardEntries(['12', '12', '12', '12'], '80'),
      'GROUPED_SBA',
    )

    expect(result.issues).toEqual([])
    expect(result.missingComponentIds).toEqual([])
    // 48/60 * 30 = 24.00 and 80/100 * 70 = 56.00.
    expect(result.sbaContribution).toBe(24)
    expect(result.examContribution).toBe(56)
    expect(result.finalScore).toBe(80)
    expect(result.finalScoreUnrounded).toBe(80)
    expect(earlyYearsPerformance(result.finalScoreUnrounded)?.symbol).toBe('G')
  })

  it('Example B: Class Score 42/60 and examination 70/100 produce 70', () => {
    const result = calculatePupilResult(
      STANDARD_COMPONENTS,
      standardEntries(['11', '10', '11', '10'], '70'),
      'GROUPED_SBA',
    )

    // 42/60 * 30 = 21.00 and 70/100 * 70 = 49.00.
    expect(result.sbaContribution).toBe(21)
    expect(result.examContribution).toBe(49)
    expect(result.finalScore).toBe(70)
    expect(result.finalScoreUnrounded).toBe(70)
    expect(earlyYearsPerformance(result.finalScoreUnrounded)?.symbol).toBe('S')
  })

  it('Example C: Class Score 30/60 and examination 50/100 produce 50', () => {
    const result = calculatePupilResult(
      STANDARD_COMPONENTS,
      standardEntries(['8', '7', '8', '7'], '50'),
      'GROUPED_SBA',
    )

    // 30/60 * 30 = 15.00 and 50/100 * 70 = 35.00.
    expect(result.sbaContribution).toBe(15)
    expect(result.examContribution).toBe(35)
    expect(result.finalScore).toBe(50)
    expect(result.finalScoreUnrounded).toBe(50)
    expect(earlyYearsPerformance(result.finalScoreUnrounded)?.symbol).toBe('B')
  })

  it('Example full marks: 60/60 and 100/100 produce 100', () => {
    const result = calculatePupilResult(
      STANDARD_COMPONENTS,
      standardEntries(['15', '15', '15', '15'], '100'),
      'GROUPED_SBA',
    )

    expect(result.sbaContribution).toBe(30)
    expect(result.examContribution).toBe(70)
    expect(result.finalScore).toBe(100)
  })

  it('scales the summed Class Score once instead of each component', () => {
    const result = calculatePupilResult(
      STANDARD_COMPONENTS,
      standardEntries(['1', '1', '1', '1'], '0'),
      'GROUPED_SBA',
    )

    // 4/60 * 30 = 2.00. GROUPED_SBA scales the category total, which is the
    // authoritative NaCCA Class Score rule even when equal component maxima
    // happen to make per-component scaling numerically identical.
    expect(result.sbaContribution).toBe(2)
    expect(result.examContribution).toBe(0)
    expect(result.finalScore).toBe(2)
    expect(result.contributions.every((item) => item.contribution === null)).toBe(
      true,
    )
  })

  it('keeps a missing score distinct from zero', () => {
    const result = calculatePupilResult(
      STANDARD_COMPONENTS,
      standardEntries(['12', '10', '8', '0'], '0').filter(
        (entry) => entry.componentId !== 'project',
      ),
      'GROUPED_SBA',
    )

    expect(result.missingComponentIds).toContain('project')
    expect(result.sbaContribution).toBeNull()
    expect(result.examContribution).toBeNull()
    expect(result.finalScore).toBeNull()
  })

  it('rejects scores below zero or above the component maximum without clamping', () => {
    const over = calculatePupilResult(
      STANDARD_COMPONENTS,
      standardEntries(['16', '10', '8', '7'], '50'),
      'GROUPED_SBA',
    )
    expect(over.issues.some((issue) => issue.message.includes('cannot exceed'))).toBe(
      true,
    )
    expect(over.finalScore).toBeNull()

    const negative = calculatePupilResult(
      STANDARD_COMPONENTS,
      standardEntries(['-1', '10', '8', '7'], '50'),
      'GROUPED_SBA',
    )
    expect(negative.issues.length).toBeGreaterThan(0)
    expect(negative.finalScore).toBeNull()
  })

  it('preserves component-weighted behaviour for existing policies', () => {
    const result = calculatePupilResult(EXAMPLE_COMPONENTS, [
      { componentId: 'class-test', score: '16.00' },
      { componentId: 'project', score: '8.00' },
      { componentId: 'homework', score: '9.00' },
      { componentId: 'examination', score: '75.00' },
    ])

    // The default mode is still COMPONENT_WEIGHTED.
    expect(result.sbaContribution).toBe(33)
    expect(result.examContribution).toBe(45)
    expect(result.finalScore).toBe(78)
  })
})

describe('grading bands', () => {
  it('accepts contiguous bands and matches exact boundaries', () => {
    expect(validateGradeBands(BANDS)).toEqual([])
    expect(findGradeBand(BANDS, 79.99)?.gradeLabel).toBe('B2')
    expect(findGradeBand(BANDS, 80)?.gradeLabel).toBe('A1')
    expect(findGradeBand(BANDS, 49.99)?.gradeLabel).toBe('F9')
    expect(findGradeBand(BANDS, 50)?.gradeLabel).toBe('D7')
    expect(findGradeBand(BANDS, 0)?.gradeLabel).toBe('F9')
    expect(findGradeBand(BANDS, 100)?.gradeLabel).toBe('A1')
  })

  it('detects overlapping bands', () => {
    const issues = validateGradeBands([
      { minScore: '0', maxScore: '60', gradeLabel: 'A', remark: 'A' },
      { minScore: '50', maxScore: '100', gradeLabel: 'B', remark: 'B' },
    ])

    expect(issues.some((issue) => issue.message.includes('overlap'))).toBe(true)
  })

  it('detects gaps between bands', () => {
    const issues = validateGradeBands([
      { minScore: '0', maxScore: '49.99', gradeLabel: 'A', remark: 'A' },
      { minScore: '50.01', maxScore: '100', gradeLabel: 'B', remark: 'B' },
    ])

    expect(issues.some((issue) => issue.message.includes('gap'))).toBe(true)
  })

  it('requires coverage from 0 to 100 and unique labels', () => {
    const issues = validateGradeBands([
      { minScore: '10', maxScore: '90', gradeLabel: 'A', remark: 'A' },
    ])

    expect(issues.some((issue) => issue.message.includes('start at 0.00'))).toBe(true)
    expect(issues.some((issue) => issue.message.includes('end at 100.00'))).toBe(true)

    const duplicate = validateGradeBands([
      { minScore: '0', maxScore: '49.99', gradeLabel: 'A', remark: 'A' },
      { minScore: '50', maxScore: '100', gradeLabel: 'a', remark: 'B' },
    ])
    expect(duplicate.some((issue) => issue.message.includes('more than once'))).toBe(true)
  })

  it('returns null outside a malformed band set', () => {
    expect(findGradeBand([], 50)).toBeNull()
  })
})

describe('early-years performance classification', () => {
  it('classifies exact boundaries: 80 Gold, 55 Silver, 54.99 Bronze', () => {
    expect(earlyYearsPerformance(80)).toMatchObject({
      symbol: 'G',
      remark: 'Gold',
      display: 'Gold (G)',
    })
    expect(earlyYearsPerformance(79.99)).toMatchObject({
      symbol: 'S',
      remark: 'Silver',
    })
    expect(earlyYearsPerformance(55)).toMatchObject({
      symbol: 'S',
      remark: 'Silver',
    })
    expect(earlyYearsPerformance(54.99)).toMatchObject({
      symbol: 'B',
      remark: 'Bronze',
    })
    expect(earlyYearsPerformance(0)).toMatchObject({ symbol: 'B' })
    expect(earlyYearsPerformance(100)).toMatchObject({ symbol: 'G' })
  })

  it('never classifies a missing or out-of-range score', () => {
    expect(earlyYearsPerformance(null)).toBeNull()
    expect(earlyYearsPerformance(undefined)).toBeNull()
    expect(earlyYearsPerformance(-0.01)).toBeNull()
    expect(earlyYearsPerformance(100.01)).toBeNull()
    expect(earlyYearsPerformance(Number.NaN)).toBeNull()
  })

  it('matches only Creche, Nursery 1/2, KG1 and KG2', () => {
    for (const name of [
      'Creche',
      'Nursery 1',
      'Nursery 2',
      'KG 1',
      'KG1',
      'KG 2',
      'KG2',
      'Kindergarten 1',
    ]) {
      expect(isEarlyYearsClass({ name })).toBe(true)
    }

    for (const name of [
      'Basic 1',
      'Basic 6',
      'Primary 1',
      'JHS 1',
      'JSS 2',
      'Senior High 1',
    ]) {
      expect(isEarlyYearsClass({ name, level: 'KINDERGARTEN' })).toBe(false)
    }
  })

  it('falls back to the educational level when the class name is absent', () => {
    expect(isEarlyYearsClass({ level: 'CRECHE' })).toBe(true)
    expect(isEarlyYearsClass({ level: 'NURSERY' })).toBe(true)
    expect(isEarlyYearsClass({ level: 'KINDERGARTEN' })).toBe(true)
    expect(isEarlyYearsClass({ level: 'BASIC' })).toBe(false)
    expect(isEarlyYearsClass({})).toBe(false)
  })
})
