import { describe, expect, it } from 'vitest'
import {
  averageCenti,
  rankClassPositions,
  rankSubjectScores,
  scoreToCenti,
} from '../src/reports/ranking.js'

const ENTRIES = [
  { pupilId: 'pupil-c', name: 'Chipo Cole', score: '80.00' },
  { pupilId: 'pupil-a', name: 'Ama Asare', score: '90.00' },
  { pupilId: 'pupil-b', name: 'Bola Bediako', score: '80.00' },
  { pupilId: 'pupil-d', name: 'Dela Danso', score: '70.00' },
  { pupilId: 'pupil-e', name: 'Esi Eshun', score: null },
]

describe('deterministic report ranking', () => {
  it('ranks subject scores with competition ties and excludes missing scores', () => {
    expect(rankSubjectScores(ENTRIES, 'COMPETITION')).toEqual([
      { pupilId: 'pupil-a', rank: 1 },
      { pupilId: 'pupil-b', rank: 2 },
      { pupilId: 'pupil-c', rank: 2 },
      { pupilId: 'pupil-d', rank: 4 },
    ])
  })

  it('supports dense and ordinal tie policies', () => {
    expect(rankSubjectScores(ENTRIES, 'DENSE')).toEqual([
      { pupilId: 'pupil-a', rank: 1 },
      { pupilId: 'pupil-b', rank: 2 },
      { pupilId: 'pupil-c', rank: 2 },
      { pupilId: 'pupil-d', rank: 3 },
    ])

    expect(rankSubjectScores(ENTRIES, 'ORDINAL')).toEqual([
      { pupilId: 'pupil-a', rank: 1 },
      { pupilId: 'pupil-b', rank: 2 },
      { pupilId: 'pupil-c', rank: 3 },
      { pupilId: 'pupil-d', rank: 4 },
    ])
  })

  it('breaks ordinal ties by name and then pupil id deterministically', () => {
    const reversed = [...ENTRIES].reverse()

    expect(rankSubjectScores(reversed, 'ORDINAL')).toEqual(
      rankSubjectScores(ENTRIES, 'ORDINAL'),
    )
    expect(rankSubjectScores(reversed, 'COMPETITION')).toEqual(
      rankSubjectScores(ENTRIES, 'COMPETITION'),
    )
  })

  it('ranks class totals and ignores pupils with no complete subject count', () => {
    const ranked = rankClassPositions(
      [
        { pupilId: 'pupil-a', name: 'Ama Asare', totalCenti: 26400, subjectCount: 3 },
        { pupilId: 'pupil-b', name: 'Bola Bediako', totalCenti: 26400, subjectCount: 3 },
        { pupilId: 'pupil-c', name: 'Chipo Cole', totalCenti: 18000, subjectCount: 3 },
        { pupilId: 'pupil-d', name: 'Dela Danso', totalCenti: 0, subjectCount: 0 },
      ],
      'COMPETITION',
    )

    expect(ranked).toEqual([
      { pupilId: 'pupil-a', rank: 1 },
      { pupilId: 'pupil-b', rank: 1 },
      { pupilId: 'pupil-c', rank: 3 },
    ])
  })

  it('compares scores as integer hundredths and averages with half-up rounding', () => {
    expect(scoreToCenti('88.88')).toBe(8888)
    expect(scoreToCenti(null)).toBeNull()
    expect(averageCenti(26400, 3)).toBe(8800)
    expect(averageCenti(100, 3)).toBe(33)
    expect(averageCenti(0, 0)).toBe(0)
  })
})
