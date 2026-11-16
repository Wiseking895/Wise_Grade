import type { ReportTiePolicy } from '../reports/repository.js'
import { rankSubjectScores } from '../reports/ranking.js'

/**
 * One pupil's final score for the selected class subject.
 *
 * Only complete results are passed here. A null score means the pupil is not
 * eligible for ranking; it is never treated as zero.
 */
export interface SubjectPositionCandidate {
  pupilId: string
  /** Display name used only to break ordinal ties deterministically. */
  name: string
  finalScore: number | null
}

/**
 * Calculates the authoritative subject position for a single class and subject.
 *
 * The calculation reuses the report ranking implementation so the SBA register
 * and terminal report can never disagree. Scores are compared as integer
 * hundredths by `rankSubjectScores`; the configured tie policy defaults to
 * COMPETITION (1st, 2nd, 2nd, 4th). Callers must keep the candidate list scoped
 * to one class and subject. Before acceptance the result is provisional; after
 * acceptance the same calculation becomes the official saved position.
 */
export function rankRegisterSubjectPositions(
  candidates: ReadonlyArray<SubjectPositionCandidate>,
  tiePolicy: ReportTiePolicy = 'COMPETITION',
): Map<string, number> {
  const entries = candidates.map((candidate) => ({
    pupilId: candidate.pupilId,
    name: candidate.name,
    score:
      candidate.finalScore === null
        ? null
        : candidate.finalScore.toFixed(2),
  }))

  return new Map(
    rankSubjectScores(entries, tiePolicy).map((item) => [
      item.pupilId,
      item.rank,
    ]),
  )
}
