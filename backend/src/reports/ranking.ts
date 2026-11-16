import { centiToNumber, decimalToCenti } from '../assessment/calculation.js'
import type { ReportTiePolicy } from './repository.js'

/**
 * Deterministic ranking policy.
 *
 * Scope: one school, academic term and class. A pupil is included in class
 * ranking only when every configured class subject has an accepted result and a
 * non-null final score. Subject ranking includes every pupil in the class with a
 * valid score for that subject, even if another subject is incomplete.
 *
 * Equal scores are handled by the school's configured policy:
 *   COMPETITION -> 1, 2, 2, 4 (shared rank, next rank skips)
 *   DENSE       -> 1, 2, 2, 3 (shared rank, next rank is next integer)
 *   ORDINAL     -> 1, 2, 3, 4 (no shared ranks; name then pupil id breaks ties)
 *
 * Scores are compared as integer hundredths, so ranking never depends on
 * floating-point display rounding. Higher scores rank first.
 */

export interface RankableScore {
  pupilId: string
  name: string
  /** Decimal string or null when the subject is incomplete. */
  score: string | null
}

export interface ClassRankCandidate {
  pupilId: string
  name: string
  /** Sum of all subject final scores in hundredths. */
  totalCenti: number
  subjectCount: number
}

export interface SubjectRankResult {
  pupilId: string
  rank: number
}

export function rankSubjectScores(
  entries: ReadonlyArray<RankableScore>,
  tiePolicy: ReportTiePolicy,
): SubjectRankResult[] {
  const parsed = entries
    .map((entry) => ({
      pupilId: entry.pupilId,
      name: entry.name,
      centi: entry.score === null ? null : decimalToCenti(entry.score),
    }))
    .filter(
      (entry): entry is { pupilId: string; name: string; centi: number } =>
        entry.centi !== null,
    )

  return assignRanks(parsed, tiePolicy)
}

export function rankClassPositions(
  candidates: ReadonlyArray<ClassRankCandidate>,
  tiePolicy: ReportTiePolicy,
): SubjectRankResult[] {
  const parsed = candidates
    .filter((candidate) => candidate.subjectCount > 0)
    .map((candidate) => ({
      pupilId: candidate.pupilId,
      name: candidate.name,
      centi: candidate.totalCenti,
    }))

  return assignRanks(parsed, tiePolicy)
}

function assignRanks(
  entries: ReadonlyArray<{ pupilId: string; name: string; centi: number }>,
  tiePolicy: ReportTiePolicy,
): SubjectRankResult[] {
  const sorted = [...entries].sort((a, b) => {
    if (b.centi !== a.centi) {
      return b.centi - a.centi
    }

    const byName = a.name.localeCompare(b.name, 'en', {
      sensitivity: 'base',
    })

    if (byName !== 0) {
      return byName
    }

    return a.pupilId.localeCompare(b.pupilId)
  })

  const results: SubjectRankResult[] = []
  let previousCenti: number | null = null
  let previousRank = 0
  let denseRank = 0

  sorted.forEach((entry, index) => {
    let rank: number

    if (tiePolicy === 'ORDINAL') {
      rank = index + 1
    } else if (previousCenti !== null && entry.centi === previousCenti) {
      rank = previousRank
    } else if (tiePolicy === 'DENSE') {
      denseRank += 1
      rank = denseRank
    } else {
      rank = index + 1
    }

    results.push({ pupilId: entry.pupilId, rank })
    previousCenti = entry.centi
    previousRank = rank
  })

  return results
}

export function averageCenti(totalCenti: number, subjectCount: number): number {
  if (subjectCount <= 0) {
    return 0
  }

  return Math.floor((2 * totalCenti + subjectCount) / (2 * subjectCount))
}

export function scoreToCenti(score: string | null): number | null {
  return score === null ? null : decimalToCenti(score)
}

export function centiToScore(centi: number): string {
  return centiToNumber(centi).toFixed(2)
}
