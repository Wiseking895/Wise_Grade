import { describe, expect, it } from 'vitest'
import {
  calculatePupilResult,
  type ComponentDefinition,
} from '../src/assessment/calculation.js'
import { buildReportSet } from '../src/reports/snapshot.js'
import {
  DEFAULT_PUPILS,
  makeReportData,
} from './helpers/report-fixtures.js'

/**
 * The report layer must print the accepted Phase 4 result exactly. These tests
 * run the real Phase 4 calculator and feed its output into the report snapshot
 * builder instead of duplicating the arithmetic in a fixture.
 */
const components: ComponentDefinition[] = [
  {
    id: 'sba',
    key: 'sba',
    name: 'Continuous assessment',
    category: 'SBA',
    maximumScore: '30.00',
    weightPercent: '40.00',
    sortOrder: 0,
  },
  {
    id: 'exam',
    key: 'exam',
    name: 'End of term examination',
    category: 'EXAM',
    maximumScore: '100.00',
    weightPercent: '60.00',
    sortOrder: 1,
  },
]

function policySnapshot() {
  return {
    id: 'policy-parity',
    name: 'Phase 4 parity policy',
    version: 1,
    components: components.map((component) => ({
      key: component.key,
      name: component.name,
      category: component.category,
      maximumScore: component.maximumScore,
      weightPercent: component.weightPercent,
      sortOrder: component.sortOrder ?? 0,
    })),
  }
}

describe('report calculation parity with Phase 4', () => {
  it('prints scaled SBA, examination and total values from the accepted calculator', () => {
    const result = calculatePupilResult(components, [
      { componentId: 'sba', score: '27.00' },
      { componentId: 'exam', score: '70.00' },
    ])

    expect(result.issues).toEqual([])
    expect(result.sbaContribution).toBe(36)
    expect(result.examContribution).toBe(42)
    expect(result.finalScore).toBe(78)

    const data = makeReportData({
      subjects: [{ id: 'sub-parity', name: 'Mathematics', sortOrder: 0 }],
      pupils: [
        {
          ...DEFAULT_PUPILS[0]!,
          scores: { 'sub-parity': '78.00' },
        },
      ],
    })
    const policy = policySnapshot()

    data.submissions[0]!.policySnapshot = policy
    data.scores[0] = {
      ...data.scores[0]!,
      sbaContribution: result.sbaContribution!.toFixed(2),
      examContribution: result.examContribution!.toFixed(2),
      finalScore: result.finalScore!.toFixed(2),
      gradeLabel: 'B',
      gradeRemark: 'Very good',
      policySnapshot: policy,
    }

    const snapshot = buildReportSet(data).builds[0]!.snapshot!
    expect(snapshot.academic.subjects[0]).toMatchObject({
      classScore: '36.00',
      examScore: '42.00',
      totalScore: '78.00',
      grade: 'B',
      weights: { sba: '40.00', exam: '60.00', total: '100.00' },
    })
    expect(snapshot.academic.total).toBe('78.00')
    expect(snapshot.academic.average).toBe('78.00')
    expect(snapshot.academic.examTotal).toBe('42.00')
  })

  it('prints an explicit zero but never treats a missing score as zero', () => {
    const zero = calculatePupilResult(components, [
      { componentId: 'sba', score: '0.00' },
      { componentId: 'exam', score: '0.00' },
    ])
    expect(zero.issues).toEqual([])
    expect(zero.finalScore).toBe(0)
    expect(zero.missingComponentIds).toEqual([])

    const missing = calculatePupilResult(components, [
      { componentId: 'sba', score: '27.00' },
    ])
    expect(missing.finalScore).toBeNull()
    expect(missing.missingComponentIds).toEqual(['exam'])

    const data = makeReportData({
      subjects: [{ id: 'sub-zero', name: 'Mathematics', sortOrder: 0 }],
      pupils: [
        {
          ...DEFAULT_PUPILS[0]!,
          scores: { 'sub-zero': '0.00' },
        },
      ],
    })
    const zeroBuild = buildReportSet(data).builds[0]!
    expect(zeroBuild.eligible).toBe(true)
    expect(zeroBuild.snapshot!.academic.subjects[0]!.totalScore).toBe('0.00')
    expect(zeroBuild.snapshot!.academic.subjects[0]!.grade).toBe('F')

    const missingData = makeReportData({
      subjects: [{ id: 'sub-zero', name: 'Mathematics', sortOrder: 0 }],
      pupils: [
        {
          ...DEFAULT_PUPILS[0]!,
          scores: {},
        },
      ],
    })
    const missingBuild = buildReportSet(missingData).builds[0]!
    expect(missingBuild.eligible).toBe(false)
    expect(missingBuild.failure?.code).toBe('RESULT_MISSING')
    expect(missingBuild.snapshot).toBeNull()
  })
})
