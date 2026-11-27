/**
 * Pupil duplicate identity rules.
 *
 * Two pupils are compared on the complete name (first, last and other names)
 * and on the admission number. Comparison is deliberately conservative:
 *
 * - case, leading/trailing spaces and repeated internal spaces are ignored;
 * - the name order is never reversed or guessed;
 * - no fuzzy matching is performed, so "Kwame Mensah" and
 *   "Kwame Mensah Junior" remain different names.
 *
 * The original stored values are never rewritten here. These helpers only
 * produce comparison keys.
 */

export type PupilDuplicateCategory =
  | 'DEFINITE'
  | 'NAME_CONFLICT'
  | 'ADMISSION_CONFLICT'

export type PupilDuplicateDecision = 'DIFFERENT' | 'SAME' | 'MERGED'

export type PupilConflictCategory =
  | 'EXACT_DUPLICATE'
  | 'ADMISSION_CONFLICT'
  | 'NAME_CONFLICT'

export interface PupilNameParts {
  firstName: string
  lastName: string
  otherNames?: string | null
}

export interface PupilIdentityLike extends PupilNameParts {
  id: string
  admissionNumber: string
  status: string
  currentClassId?: string | null
  currentClassName?: string | null
}

export interface PupilConflictCandidate {
  pupil: PupilIdentityLike
  category: PupilConflictCategory
}

export interface PupilDuplicatePair {
  pupilIds: [string, string]
  admissionNumbers: [string, string]
  decision: PupilDuplicateDecision | null
  decidedAt: string | null
  decidedByUserId: string | null
  note: string | null
}

export interface PupilDuplicateGroup {
  /** Deterministic identifier, unique inside one school. */
  key: string
  category: PupilDuplicateCategory
  nameKey: string
  admissionNumbers: string[]
  pupils: PupilIdentityLike[]
  pairs: PupilDuplicatePair[]
  resolved: boolean
  suggestedResolution: string
}

export interface PupilDuplicateSummary {
  definiteRecords: number
  possibleRecords: number
  admissionConflictRecords: number
  possibleGroups: number
  admissionConflictGroups: number
  resolvedGroups: number
  awaitingGroups: number
}

export interface PupilDuplicateAudit {
  generatedAt: string
  groups: PupilDuplicateGroup[]
  summary: PupilDuplicateSummary
}

export interface PupilDuplicateDecisionRecord {
  decision: PupilDuplicateDecision
  decidedAt: string
  decidedByUserId: string | null
  note: string | null
}

export type PupilDuplicateDecisionMap = ReadonlyMap<
  string,
  PupilDuplicateDecisionRecord
>

/** Collapse accidental spacing without changing the stored display value. */
export function collapsePupilName(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

/**
 * Comparison key for a complete pupil name. Never used for display.
 */
export function normalizePupilName(parts: PupilNameParts): string {
  return [parts.firstName, parts.lastName, parts.otherNames]
    .filter((part): part is string => typeof part === 'string')
    .map(collapsePupilName)
    .filter((part) => part.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Human-readable full name using the stored casing and spacing. */
export function displayPupilName(parts: PupilNameParts): string {
  return [parts.firstName, parts.lastName, parts.otherNames]
    .filter((part): part is string => typeof part === 'string')
    .map(collapsePupilName)
    .filter((part) => part.length > 0)
    .join(' ')
}

/** Admission numbers are compared case-insensitively and without padding. */
export function normalizePupilAdmissionNumber(value: string): string {
  return value.trim().toUpperCase()
}

/**
 * Stable key for a same-name pair. Admission numbers are sorted so the key does
 * not depend on which record the administrator opened first.
 */
export function pupilDuplicatePairKey(
  nameKey: string,
  admissionNumberA: string,
  admissionNumberB: string,
): string {
  const [first, second] = [
    normalizePupilAdmissionNumber(admissionNumberA),
    normalizePupilAdmissionNumber(admissionNumberB),
  ].sort()

  return `${nameKey}\u0000${first}\u0000${second}`
}

const CONFLICT_PRIORITY: Record<PupilConflictCategory, number> = {
  EXACT_DUPLICATE: 0,
  ADMISSION_CONFLICT: 1,
  NAME_CONFLICT: 2,
}

/**
 * Finds every existing pupil that conflicts with an incoming identity.
 * `excludePupilId` is used when editing so a pupil never conflicts with itself.
 */
export function findPupilConflicts(input: {
  nameKey: string
  admissionNumber: string
  candidates: readonly PupilIdentityLike[]
  excludePupilId?: string | null
}): PupilConflictCandidate[] {
  const admission = normalizePupilAdmissionNumber(input.admissionNumber)

  const conflicts: PupilConflictCandidate[] = []

  for (const pupil of input.candidates) {
    if (input.excludePupilId && pupil.id === input.excludePupilId) {
      continue
    }

    const sameName = normalizePupilName(pupil) === input.nameKey
    const sameAdmission =
      normalizePupilAdmissionNumber(pupil.admissionNumber) === admission

    if (sameName && sameAdmission) {
      conflicts.push({ pupil, category: 'EXACT_DUPLICATE' })
    } else if (sameAdmission) {
      conflicts.push({ pupil, category: 'ADMISSION_CONFLICT' })
    } else if (sameName) {
      conflicts.push({ pupil, category: 'NAME_CONFLICT' })
    }
  }

  return conflicts.sort(
    (left, right) =>
      CONFLICT_PRIORITY[left.category] - CONFLICT_PRIORITY[right.category] ||
      left.pupil.id.localeCompare(right.pupil.id),
  )
}

export interface PupilConflictResolution {
  /** A conflict that must block the write. */
  blocking: PupilConflictCandidate | null
  /** True when the only remaining conflict needs an administrator choice. */
  requiresConfirmation: boolean
  /** The same-name candidate the caller explicitly confirmed as different. */
  confirmedCandidate: PupilIdentityLike | null
}

/**
 * Decides whether a write may proceed.
 *
 * - exact name + exact admission and same admission with another name always
 *   block;
 * - a same-name candidate blocks until the caller confirms "different pupils";
 * - a previous DIFFERENT decision for the same pair also allows the write, so
 *   the administrator is not asked repeatedly.
 */
export function resolvePupilConflict(input: {
  conflicts: readonly PupilConflictCandidate[]
  decisions: PupilDuplicateDecisionMap
  nameKey: string
  admissionNumber: string
  confirmedPupilId?: string | null
}): PupilConflictResolution {
  const nameCandidates: PupilIdentityLike[] = []

  for (const conflict of input.conflicts) {
    if (
      conflict.category === 'EXACT_DUPLICATE' ||
      conflict.category === 'ADMISSION_CONFLICT'
    ) {
      return {
        blocking: conflict,
        requiresConfirmation: false,
        confirmedCandidate: null,
      }
    }

    nameCandidates.push(conflict.pupil)
  }

  if (nameCandidates.length === 0) {
    return {
      blocking: null,
      requiresConfirmation: false,
      confirmedCandidate: null,
    }
  }

  const confirmedCandidate =
    nameCandidates.find((pupil) => pupil.id === input.confirmedPupilId) ?? null

  const unresolved = nameCandidates.filter((pupil) => {
    if (confirmedCandidate?.id === pupil.id) {
      return false
    }

    const decision = input.decisions.get(
      pupilDuplicatePairKey(
        input.nameKey,
        input.admissionNumber,
        pupil.admissionNumber,
      ),
    )

    return decision?.decision !== 'DIFFERENT'
  })

  if (unresolved.length === 0) {
    return {
      blocking: null,
      requiresConfirmation: false,
      confirmedCandidate,
    }
  }

  // A previous "same pupil" or "merged" decision means the pair still needs a
  // deliberate merge, so a new registration must not slip through.
  const pendingResolution = unresolved.some((pupil) => {
    const decision = input.decisions.get(
      pupilDuplicatePairKey(
        input.nameKey,
        input.admissionNumber,
        pupil.admissionNumber,
      ),
    )

    return decision?.decision === 'SAME' || decision?.decision === 'MERGED'
  })

  const blockingPupil = unresolved[0]

  if (!blockingPupil) {
    return {
      blocking: null,
      requiresConfirmation: false,
      confirmedCandidate: null,
    }
  }

  return {
    blocking: { pupil: blockingPupil, category: 'NAME_CONFLICT' },
    requiresConfirmation: !pendingResolution,
    confirmedCandidate: null,
  }
}

function sortPupils(pupils: readonly PupilIdentityLike[]): PupilIdentityLike[] {
  return [...pupils].sort(
    (left, right) =>
      normalizePupilAdmissionNumber(left.admissionNumber).localeCompare(
        normalizePupilAdmissionNumber(right.admissionNumber),
      ) || left.id.localeCompare(right.id),
  )
}

function buildPairs(
  pupils: readonly PupilIdentityLike[],
  decisions: PupilDuplicateDecisionMap,
  options: { allowSameAdmission?: boolean } = {},
): PupilDuplicatePair[] {
  const pairs: PupilDuplicatePair[] = []

  for (let index = 0; index < pupils.length; index += 1) {
    for (let other = index + 1; other < pupils.length; other += 1) {
      const left = pupils[index]
      const right = pupils[other]

      if (!left || !right) {
        continue
      }

      if (
        !options.allowSameAdmission &&
        normalizePupilAdmissionNumber(left.admissionNumber) ===
          normalizePupilAdmissionNumber(right.admissionNumber)
      ) {
        continue
      }

      const decision = decisions.get(
        pupilDuplicatePairKey(
          normalizePupilName(left),
          left.admissionNumber,
          right.admissionNumber,
        ),
      )

      pairs.push({
        pupilIds: [left.id, right.id],
        admissionNumbers: [
          normalizePupilAdmissionNumber(left.admissionNumber),
          normalizePupilAdmissionNumber(right.admissionNumber),
        ],
        decision: decision?.decision ?? null,
        decidedAt: decision?.decidedAt ?? null,
        decidedByUserId: decision?.decidedByUserId ?? null,
        note: decision?.note ?? null,
      })
    }
  }

  return pairs
}

/**
 * Groups every pupil supplied (active, inactive and archived) into the three
 * duplicate categories. This is pure so the same rules power the live API and
 * the unit tests.
 */
export function groupPupilDuplicates(
  pupils: readonly PupilIdentityLike[],
  decisions: PupilDuplicateDecisionMap = new Map(),
): PupilDuplicateAudit {
  const groups: PupilDuplicateGroup[] = []

  const byName = new Map<string, PupilIdentityLike[]>()
  const byAdmission = new Map<string, PupilIdentityLike[]>()
  const byNameAndAdmission = new Map<string, PupilIdentityLike[]>()

  for (const pupil of pupils) {
    const nameKey = normalizePupilName(pupil)
    const admission = normalizePupilAdmissionNumber(pupil.admissionNumber)

    const nameBucket = byName.get(nameKey) ?? []
    nameBucket.push(pupil)
    byName.set(nameKey, nameBucket)

    const admissionBucket = byAdmission.get(admission) ?? []
    admissionBucket.push(pupil)
    byAdmission.set(admission, admissionBucket)

    const exactKey = `${nameKey}\u0000${admission}`
    const exactBucket = byNameAndAdmission.get(exactKey) ?? []
    exactBucket.push(pupil)
    byNameAndAdmission.set(exactKey, exactBucket)
  }

  // Definite: same complete name and same admission number.
  for (const [key, bucket] of byNameAndAdmission) {
    if (bucket.length < 2) {
      continue
    }

    const separatorIndex = key.indexOf('\u0000')
    const nameKey = key.slice(0, separatorIndex)
    const admission = key.slice(separatorIndex + 1)

    const sorted = sortPupils(bucket)
    const pairs = buildPairs(sorted, decisions, { allowSameAdmission: true })

    groups.push({
      key: `DEFINITE:${key}`,
      category: 'DEFINITE',
      nameKey,
      admissionNumbers: [admission],
      pupils: sorted,
      pairs,
      resolved:
        pairs.length > 0 && pairs.every((pair) => pair.decision === 'MERGED'),
      suggestedResolution:
        'Definite duplicate: retain one record, transfer its dependent records to the retained pupil, then archive the other record.',
    })
  }

  // Possible: same complete name, more than one distinct admission number.
  for (const [nameKey, bucket] of byName) {
    const admissions = new Set(
      bucket.map((pupil) => normalizePupilAdmissionNumber(pupil.admissionNumber)),
    )

    if (bucket.length < 2 || admissions.size < 2) {
      continue
    }

    const sorted = sortPupils(bucket)
    const pairs = buildPairs(sorted, decisions)
    const resolved =
      pairs.length > 0 &&
      pairs.every(
        (pair) => pair.decision === 'DIFFERENT' || pair.decision === 'MERGED',
      )

    groups.push({
      key: `NAME_CONFLICT:${nameKey}`,
      category: 'NAME_CONFLICT',
      nameKey,
      admissionNumbers: [...admissions].sort(),
      pupils: sorted,
      pairs,
      resolved,
      suggestedResolution:
        'Possible duplicate: confirm whether these records belong to the same pupil. If they do, merge them; if not, mark them as different individuals.',
    })
  }

  // Admission conflict: one admission number assigned to different names.
  for (const [admission, bucket] of byAdmission) {
    const names = new Set(bucket.map((pupil) => normalizePupilName(pupil)))

    if (bucket.length < 2 || names.size < 2) {
      continue
    }

    groups.push({
      key: `ADMISSION_CONFLICT:${admission}`,
      category: 'ADMISSION_CONFLICT',
      nameKey: '',
      admissionNumbers: [admission],
      pupils: sortPupils(bucket),
      pairs: [],
      resolved: false,
      suggestedResolution:
        'Admission number conflict: correct the admission number on one of the records before proceeding.',
    })
  }

  groups.sort(
    (left, right) =>
      left.category.localeCompare(right.category) ||
      left.key.localeCompare(right.key),
  )

  const summary: PupilDuplicateSummary = {
    definiteRecords: groups
      .filter((group) => group.category === 'DEFINITE')
      .reduce((total, group) => total + group.pupils.length, 0),
    possibleRecords: groups
      .filter((group) => group.category === 'NAME_CONFLICT')
      .reduce((total, group) => total + group.pupils.length, 0),
    admissionConflictRecords: groups
      .filter((group) => group.category === 'ADMISSION_CONFLICT')
      .reduce((total, group) => total + group.pupils.length, 0),
    possibleGroups: groups.filter((group) => group.category === 'NAME_CONFLICT')
      .length,
    admissionConflictGroups: groups.filter(
      (group) => group.category === 'ADMISSION_CONFLICT',
    ).length,
    resolvedGroups: groups.filter(
      (group) =>
        (group.category === 'NAME_CONFLICT' ||
          group.category === 'DEFINITE') &&
        group.resolved,
    ).length,
    awaitingGroups: groups.filter(
      (group) =>
        (group.category === 'NAME_CONFLICT' ||
          group.category === 'DEFINITE') &&
        !group.resolved,
    ).length,
  }

  return {
    generatedAt: new Date().toISOString(),
    groups,
    summary,
  }
}

/** Applies the administrator's category and free-text filters. */
export function filterPupilDuplicateGroups(
  audit: PupilDuplicateAudit,
  filter: { category?: PupilDuplicateCategory; query?: string },
): PupilDuplicateAudit {
  const query = filter.query?.trim().toLowerCase() ?? ''

  const groups = audit.groups.filter((group) => {
    if (filter.category && group.category !== filter.category) {
      return false
    }

    if (!query) {
      return true
    }

    return (
      group.nameKey.includes(query) ||
      group.admissionNumbers.some((admission) =>
        admission.toLowerCase().includes(query),
      ) ||
      group.pupils.some(
        (pupil) =>
          displayPupilName(pupil).toLowerCase().includes(query) ||
          pupil.admissionNumber.toLowerCase().includes(query),
      )
    )
  })

  const summary: PupilDuplicateSummary = {
    definiteRecords: groups
      .filter((group) => group.category === 'DEFINITE')
      .reduce((total, group) => total + group.pupils.length, 0),
    possibleRecords: groups
      .filter((group) => group.category === 'NAME_CONFLICT')
      .reduce((total, group) => total + group.pupils.length, 0),
    admissionConflictRecords: groups
      .filter((group) => group.category === 'ADMISSION_CONFLICT')
      .reduce((total, group) => total + group.pupils.length, 0),
    possibleGroups: groups.filter((group) => group.category === 'NAME_CONFLICT')
      .length,
    admissionConflictGroups: groups.filter(
      (group) => group.category === 'ADMISSION_CONFLICT',
    ).length,
    resolvedGroups: groups.filter(
      (group) =>
        (group.category === 'NAME_CONFLICT' ||
          group.category === 'DEFINITE') &&
        group.resolved,
    ).length,
    awaitingGroups: groups.filter(
      (group) =>
        (group.category === 'NAME_CONFLICT' ||
          group.category === 'DEFINITE') &&
        !group.resolved,
    ).length,
  }

  return { ...audit, groups, summary }
}
