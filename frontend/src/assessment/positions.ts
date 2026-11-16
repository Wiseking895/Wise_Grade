import type { SubjectTiePolicy } from './types'

/**
 * One pupil's current final score for the selected subject.
 *
 * Provisional ranking uses exactly the same precision and tie rules as the
 * backend report ranking: scores are compared as integer hundredths and a
 * null score means the pupil is incomplete and excluded, never zero.
 */
export interface ProvisionalRankCandidate {
  pupilId: string
  name: string
  finalScore: number | null
}

interface ParsedCandidate {
  pupilId: string
  name: string
  centi: number
}

function toCenti(value: number): number {
  return Math.round(Number(value.toFixed(2)) * 100)
}

/**
 * Competition ranking is the default: 1st, 2nd, 2nd, 4th. DENSE and ORDINAL
 * are mirrored too so the live register always agrees with the configured
 * backend policy.
 */
export function rankProvisionalPositions(
  candidates: ReadonlyArray<ProvisionalRankCandidate>,
  tiePolicy: SubjectTiePolicy = 'COMPETITION',
): Map<string, number> {
  const parsed: ParsedCandidate[] = candidates
    .filter(
      (candidate) =>
        candidate.finalScore !== null &&
        Number.isFinite(candidate.finalScore),
    )
    .map((candidate) => ({
      pupilId: candidate.pupilId,
      name: candidate.name,
      centi: toCenti(candidate.finalScore as number),
    }))

  const sorted = [...parsed].sort((a, b) => {
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

  const positions = new Map<string, number>()
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

    positions.set(entry.pupilId, rank)
    previousCenti = entry.centi
    previousRank = rank
  })

  return positions
}
