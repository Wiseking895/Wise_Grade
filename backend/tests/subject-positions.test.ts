import { describe, expect, it } from 'vitest'
import { calculatePupilResult } from '../src/assessment/calculation.js'
import { rankRegisterSubjectPositions } from '../src/assessment/positions.js'
import { saveDraftSchema } from '../src/assessment/validation.js'
import { buildReportSet } from '../src/reports/snapshot.js'
import { DEFAULT_PUPILS, makeReportData } from './helpers/report-fixtures.js'

const COMPONENTS = [
  {
    id: 'sba',
    key: 'sba',
    name: 'Continuous assessment',
    category: 'SBA' as const,
    maximumScore: '60.00',
    weightPercent: '60.00',
    sortOrder: 0,
  },
  {
    id: 'exam',
    key: 'exam',
    name: 'End of term examination',
    category: 'EXAM' as const,
    maximumScore: '40.00',
    weightPercent: '40.00',
    sortOrder: 1,
  },
]

function positions(
  candidates: Array<{ pupilId: string; name: string; finalScore: number | null }>,
) {
  return Object.fromEntries(
    rankRegisterSubjectPositions(candidates, 'COMPETITION'),
  )
}

describe('60/40 combined subject score', () => {
  it('scales 30/60 SBA and 20/40 examination to a final score of 50/100', () => {
    const result = calculatePupilResult(COMPONENTS, [
      { componentId: 'sba', score: '30' },
      { componentId: 'exam', score: '20' },
    ])

    expect(result.sbaContribution).toBe(30)
    expect(result.examContribution).toBe(20)
    expect(result.finalScore).toBe(50)
    expect(result.finalScoreUnrounded).toBe(50)
    expect(result.missingComponentIds).toEqual([])
  })

  it('keeps missing marks null instead of treating them as zero', () => {
    const result = calculatePupilResult(COMPONENTS, [
      { componentId: 'sba', score: '30' },
    ])

    expect(result.sbaContribution).toBeNull()
    expect(result.examContribution).toBeNull()
    expect(result.finalScore).toBeNull()
    expect(result.missingComponentIds).toEqual(['exam'])
  })

  it('ranks the exact Marvin/Freda example as 1st and 2nd', () => {
    const marvin = calculatePupilResult(COMPONENTS, [
      { componentId: 'sba', score: '48' },
      { componentId: 'exam', score: '20' },
    ])
    const freda = calculatePupilResult(COMPONENTS, [
      { componentId: 'sba', score: '40' },
      { componentId: 'exam', score: '24' },
    ])

    expect(marvin.sbaContribution).toBe(48)
    expect(marvin.examContribution).toBe(20)
    expect(marvin.finalScore).toBe(68)
    expect(freda.sbaContribution).toBe(40)
    expect(freda.examContribution).toBe(24)
    expect(freda.finalScore).toBe(64)

    expect(
      positions([
        {
          pupilId: 'marvin',
          name: 'Marvin Frimpong',
          finalScore: marvin.finalScore,
        },
        {
          pupilId: 'freda',
          name: 'Freda Oteng',
          finalScore: freda.finalScore,
        },
      ]),
    ).toEqual({ marvin: 1, freda: 2 })
  })
})

describe('backend subject positions', () => {
  it('awards 1st to the highest final score', () => {
    expect(
      positions([
        { pupilId: 'pupil-a', name: 'Ama Asare', finalScore: 50 },
        { pupilId: 'pupil-b', name: 'Bola Bediako', finalScore: 80 },
        { pupilId: 'pupil-c', name: 'Chipo Cole', finalScore: 70 },
      ]),
    ).toEqual({ 'pupil-b': 1, 'pupil-c': 2, 'pupil-a': 3 })
  })

  it('uses competition ranking for ties: 1st, 2nd, 2nd, 4th', () => {
    expect(
      positions([
        { pupilId: 'pupil-a', name: 'Ama Asare', finalScore: 90 },
        { pupilId: 'pupil-b', name: 'Bola Bediako', finalScore: 80 },
        { pupilId: 'pupil-c', name: 'Chipo Cole', finalScore: 80 },
        { pupilId: 'pupil-d', name: 'Dela Danso', finalScore: 70 },
      ]),
    ).toEqual({ 'pupil-a': 1, 'pupil-b': 2, 'pupil-c': 2, 'pupil-d': 4 })
  })

  it('ranks each subject independently inside the same class', () => {
    const maths = positions([
      { pupilId: 'pupil-a', name: 'Ama Asare', finalScore: 90 },
      { pupilId: 'pupil-b', name: 'Bola Bediako', finalScore: 70 },
    ])
    const english = positions([
      { pupilId: 'pupil-a', name: 'Ama Asare', finalScore: 60 },
      { pupilId: 'pupil-b', name: 'Bola Bediako', finalScore: 85 },
    ])

    expect(maths).toEqual({ 'pupil-a': 1, 'pupil-b': 2 })
    expect(english).toEqual({ 'pupil-b': 1, 'pupil-a': 2 })
  })

  it('never lets another class affect a class position', () => {
    const basicFive = positions([
      { pupilId: 'pupil-a', name: 'Ama Asare', finalScore: 50 },
      { pupilId: 'pupil-b', name: 'Bola Bediako', finalScore: 40 },
    ])

    // Basic 6 pupils are ranked in their own call and cannot change Basic 5.
    positions([
      { pupilId: 'pupil-x', name: 'Xavier X', finalScore: 100 },
      { pupilId: 'pupil-y', name: 'Yaa Y', finalScore: 99 },
    ])

    expect(basicFive).toEqual({ 'pupil-a': 1, 'pupil-b': 2 })
  })

  it('excludes pupils who do not take the subject and never treats missing as zero', () => {
    expect(
      positions([
        { pupilId: 'pupil-a', name: 'Ama Asare', finalScore: 50 },
        { pupilId: 'pupil-b', name: 'Bola Bediako', finalScore: null },
        { pupilId: 'pupil-c', name: 'Chipo Cole', finalScore: 40 },
      ]),
    ).toEqual({ 'pupil-a': 1, 'pupil-c': 2 })
  })
})

describe('report and register position parity', () => {
  const pupils = [
    {
      ...DEFAULT_PUPILS[0]!,
      id: 'pupil-a',
      firstName: 'Ama',
      lastName: 'Asare',
      scores: {
        'sub-math': '90.00',
        'sub-english': '70.00',
        'sub-science': '60.00',
      },
    },
    {
      ...DEFAULT_PUPILS[1]!,
      id: 'pupil-b',
      firstName: 'Bola',
      lastName: 'Bediako',
      scores: {
        'sub-math': '80.00',
        'sub-english': '80.00',
        'sub-science': '60.00',
      },
    },
    {
      ...DEFAULT_PUPILS[2]!,
      id: 'pupil-c',
      firstName: 'Chipo',
      lastName: 'Cole',
      scores: {
        'sub-math': '80.00',
        'sub-english': '60.00',
        'sub-science': '60.00',
      },
    },
  ]

  it('gives the terminal report the same subject position as the register', () => {
    const built = buildReportSet(makeReportData({ pupils }))
    const reportPositions = Object.fromEntries(
      built.builds.map((item) => [
        item.pupil.id,
        item.snapshot!.academic.subjects[0]!.subjectPosition,
      ]),
    )

    const registerPositions = positions(
      pupils.map((pupil) => ({
        pupilId: pupil.id,
        name: [pupil.firstName, pupil.lastName, pupil.otherNames]
          .filter(Boolean)
          .join(' '),
        finalScore: Number(pupil.scores['sub-math']),
      })),
    )

    expect(reportPositions).toEqual(registerPositions)
    expect(reportPositions).toEqual({
      'pupil-a': 1,
      'pupil-b': 2,
      'pupil-c': 2,
    })
  })

  it('recalculates positions when an authorized score change affects the ranking', () => {
    const before = buildReportSet(makeReportData({ pupils }))
    const beforePositions = before.builds.map(
      (item) => item.snapshot!.academic.subjects[0]!.subjectPosition,
    )

    const changed = pupils.map((pupil) =>
      pupil.id === 'pupil-b'
        ? { ...pupil, scores: { ...pupil.scores, 'sub-math': '95.00' } }
        : pupil,
    )
    const after = buildReportSet(makeReportData({ pupils: changed }))
    const afterPositions = after.builds.map(
      (item) => item.snapshot!.academic.subjects[0]!.subjectPosition,
    )

    expect(beforePositions).toEqual([1, 2, 2])
    expect(afterPositions).toEqual([2, 1, 3])
  })

  it('does not finalize positions for submitted or draft results', () => {
    const submitted = buildReportSet(
      makeReportData({
        pupils,
        submissions: ['sub-math', 'sub-english', 'sub-science'].map(
          (subjectId) => ({
            subjectId,
            status: 'SUBMITTED',
            policySnapshot: null,
            gradingSnapshot: null,
            reviewedAt: null,
          }),
        ),
      }),
    )

    expect(submitted.builds.every((item) => item.snapshot === null)).toBe(true)

    const draft = buildReportSet(
      makeReportData({
        pupils,
        submissions: ['sub-math', 'sub-english', 'sub-science'].map(
          (subjectId) => ({
            subjectId,
            status: 'DRAFT',
            policySnapshot: null,
            gradingSnapshot: null,
            reviewedAt: null,
          }),
        ),
      }),
    )

    expect(draft.builds.every((item) => item.snapshot === null)).toBe(true)
  })

  it('keeps a released snapshot position unchanged when current results change', () => {
    const data = makeReportData({ pupils })
    const released = buildReportSet(data).builds[0]!.snapshot!
    const original = released.academic.subjects[0]!.subjectPosition

    data.scores = data.scores.map((score) =>
      score.pupilId === 'pupil-b' && score.subjectId === 'sub-math'
        ? { ...score, finalScore: '95.00' }
        : score,
    )

    const current = buildReportSet(data).builds[0]!.snapshot!
    expect(released.academic.subjects[0]!.subjectPosition).toBe(original)
    expect(current.academic.subjects[0]!.subjectPosition).not.toBe(original)
  })
})

describe('position integrity', () => {
  const termId = '11111111-1111-4111-8111-111111111111'
  const classId = '22222222-2222-4222-8222-222222222222'
  const subjectId = '33333333-3333-4333-8333-333333333333'
  const pupilId = '44444444-4444-4444-8444-444444444444'
  const componentId = '55555555-5555-4555-8555-555555555555'

  const validDraft = {
    academicTermId: termId,
    classId,
    subjectId,
    pupils: [
      {
        pupilId,
        scores: [{ componentId, score: '10' }],
      },
    ],
  }

  it('rejects a teacher-supplied position instead of persisting it', () => {
    expect(saveDraftSchema.safeParse(validDraft).success).toBe(true)
    expect(
      saveDraftSchema.safeParse({
        ...validDraft,
        pupils: [
          {
            ...validDraft.pupils[0],
            subjectPosition: 1,
          },
        ],
      }).success,
    ).toBe(false)
    expect(
      saveDraftSchema.safeParse({ ...validDraft, position: 1 }).success,
    ).toBe(false)
  })
})
