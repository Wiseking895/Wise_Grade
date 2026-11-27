import { describe, expect, it } from 'vitest'
import {
  displayPupilName,
  filterPupilDuplicateGroups,
  findPupilConflicts,
  groupPupilDuplicates,
  normalizePupilAdmissionNumber,
  normalizePupilName,
  pupilDuplicatePairKey,
  resolvePupilConflict,
  type PupilDuplicateDecision,
  type PupilDuplicateDecisionMap,
  type PupilIdentityLike,
} from '../src/schools/pupil-duplicates.js'

const CLASS_A = '11111111-1111-4111-8111-111111111111'
const CLASS_B = '22222222-2222-4222-8222-222222222222'

function pupil(
  input: Partial<PupilIdentityLike> &
    Pick<PupilIdentityLike, 'id' | 'firstName' | 'lastName'>,
): PupilIdentityLike {
  return {
    id: input.id,
    firstName: input.firstName,
    lastName: input.lastName,
    otherNames: input.otherNames ?? null,
    admissionNumber: input.admissionNumber ?? '1000',
    status: input.status ?? 'ACTIVE',
    currentClassId: input.currentClassId ?? null,
    currentClassName: input.currentClassName ?? null,
  }
}

function decisionMap(
  entries: Array<{
    nameKey: string
    admissions: [string, string]
    decision: PupilDuplicateDecision
  }>,
): PupilDuplicateDecisionMap {
  return new Map(
    entries.map((entry) => [
      pupilDuplicatePairKey(entry.nameKey, ...entry.admissions),
      {
        decision: entry.decision,
        decidedAt: '2026-01-01T00:00:00.000Z',
        decidedByUserId: 'admin-user',
        note: null,
      },
    ]),
  )
}

function conflictsFor(
  candidates: PupilIdentityLike[],
  identity: { firstName: string; lastName: string; otherNames?: string | null; admissionNumber: string },
  excludePupilId?: string,
) {
  return findPupilConflicts({
    nameKey: normalizePupilName(identity),
    admissionNumber: identity.admissionNumber,
    candidates,
    excludePupilId,
  })
}

describe('pupil identity normalization', () => {
  it('ignores case, padding and repeated spaces in the complete name', () => {
    expect(
      normalizePupilName({
        firstName: '  kWAme ',
        lastName: 'MENSAH',
        otherNames: '  ',
      }),
    ).toBe('kwame mensah')

    expect(
      normalizePupilName({
        firstName: 'Kwame',
        lastName: 'Mensah',
        otherNames: 'Junior',
      }),
    ).toBe('kwame mensah junior')
  })

  it('keeps the stored display name while collapsing accidental spacing', () => {
    expect(
      displayPupilName({
        firstName: '  Ama ',
        lastName: 'Boateng',
        otherNames: '  Akosua ',
      }),
    ).toBe('Ama Boateng Akosua')
  })

  it('compares admission numbers without case or padding', () => {
    expect(normalizePupilAdmissionNumber('  g-1001 ')).toBe('G-1001')
  })

  it('builds the same pair key regardless of admission order', () => {
    expect(
      pupilDuplicatePairKey('ama boateng', '2000', '1000'),
    ).toBe(pupilDuplicatePairKey('ama boateng', '1000', '2000'))
  })
})

describe('duplicate classification', () => {
  it('treats same complete name and same admission number as definite', () => {
    const audit = groupPupilDuplicates([
      pupil({
        id: 'a',
        firstName: 'Ama',
        lastName: 'Boateng',
        admissionNumber: '1001',
      }),
      pupil({
        id: 'b',
        firstName: 'AMA',
        lastName: ' boateng ',
        admissionNumber: '1001',
      }),
    ])

    expect(audit.groups).toHaveLength(1)
    expect(audit.groups[0]?.category).toBe('DEFINITE')
    expect(audit.groups[0]?.pupils.map((item) => item.id)).toEqual(['a', 'b'])
    expect(audit.summary.definiteRecords).toBe(2)
  })

  it('treats the same name with a different admission number as a possible duplicate', () => {
    const audit = groupPupilDuplicates([
      pupil({
        id: 'a',
        firstName: 'Ama',
        lastName: 'Boateng',
        admissionNumber: '1001',
      }),
      pupil({
        id: 'b',
        firstName: 'Ama',
        lastName: 'Boateng',
        admissionNumber: '2002',
      }),
    ])

    expect(audit.groups).toHaveLength(1)
    expect(audit.groups[0]?.category).toBe('NAME_CONFLICT')
    expect(audit.groups[0]?.pairs).toHaveLength(1)
    expect(audit.groups[0]?.resolved).toBe(false)
    expect(audit.summary.possibleGroups).toBe(1)
    expect(audit.summary.awaitingGroups).toBe(1)
  })

  it('treats one admission number used by different names as an admission conflict', () => {
    const audit = groupPupilDuplicates([
      pupil({
        id: 'a',
        firstName: 'Ama',
        lastName: 'Boateng',
        admissionNumber: '1001',
      }),
      pupil({
        id: 'b',
        firstName: 'Kofi',
        lastName: 'Mensah',
        admissionNumber: '1001',
      }),
    ])

    expect(audit.groups).toHaveLength(1)
    expect(audit.groups[0]?.category).toBe('ADMISSION_CONFLICT')
    expect(audit.summary.admissionConflictGroups).toBe(1)
    expect(audit.summary.admissionConflictRecords).toBe(2)
  })

  it('does not group similar but different names', () => {
    const audit = groupPupilDuplicates([
      pupil({
        id: 'a',
        firstName: 'Kwame',
        lastName: 'Mensah',
        admissionNumber: '1001',
      }),
      pupil({
        id: 'b',
        firstName: 'Kwame',
        lastName: 'Mensah',
        otherNames: 'Junior',
        admissionNumber: '2002',
      }),
      pupil({
        id: 'c',
        firstName: 'Kwamena',
        lastName: 'Mensah',
        admissionNumber: '3003',
      }),
    ])

    expect(audit.groups).toHaveLength(0)
  })

  it('groups same-name pupils across different classes', () => {
    const audit = groupPupilDuplicates([
      pupil({
        id: 'a',
        firstName: 'Ama',
        lastName: 'Boateng',
        admissionNumber: '1001',
        currentClassId: CLASS_A,
        currentClassName: 'Basic 1',
      }),
      pupil({
        id: 'b',
        firstName: 'Ama',
        lastName: 'Boateng',
        admissionNumber: '2002',
        currentClassId: CLASS_B,
        currentClassName: 'Basic 2',
      }),
    ])

    expect(audit.groups[0]?.pupils.map((item) => item.currentClassName)).toEqual([
      'Basic 1',
      'Basic 2',
    ])
  })

  it('includes inactive and archived pupils in the audit', () => {
    const audit = groupPupilDuplicates([
      pupil({
        id: 'active',
        firstName: 'Ama',
        lastName: 'Boateng',
        admissionNumber: '1001',
        status: 'ACTIVE',
      }),
      pupil({
        id: 'inactive',
        firstName: 'Ama',
        lastName: 'Boateng',
        admissionNumber: '2002',
        status: 'INACTIVE',
      }),
      pupil({
        id: 'archived',
        firstName: 'Ama',
        lastName: 'Boateng',
        admissionNumber: '3003',
        status: 'ARCHIVED',
      }),
    ])

    expect(audit.groups).toHaveLength(1)
    expect(audit.groups[0]?.pupils.map((item) => item.status)).toEqual([
      'ACTIVE',
      'INACTIVE',
      'ARCHIVED',
    ])
    expect(audit.groups[0]?.pairs).toHaveLength(3)
  })

  it('only compares the pupils supplied, so another school is never included', () => {
    const schoolA = [
      pupil({
        id: 'a',
        firstName: 'Ama',
        lastName: 'Boateng',
        admissionNumber: '1001',
      }),
    ]
    const schoolB = [
      pupil({
        id: 'b',
        firstName: 'Ama',
        lastName: 'Boateng',
        admissionNumber: '1001',
      }),
    ]

    expect(groupPupilDuplicates(schoolA).groups).toHaveLength(0)
    expect(groupPupilDuplicates(schoolB).groups).toHaveLength(0)
  })
})

describe('write-time conflict checks', () => {
  it('finds an exact duplicate, admission conflict and name conflict', () => {
    const candidates = [
      pupil({
        id: 'exact',
        firstName: 'Ama',
        lastName: 'Boateng',
        admissionNumber: '1001',
      }),
      pupil({
        id: 'admission',
        firstName: 'Kofi',
        lastName: 'Mensah',
        admissionNumber: '1001',
      }),
      pupil({
        id: 'name',
        firstName: 'Ama',
        lastName: 'Boateng',
        admissionNumber: '2002',
      }),
    ]

    const conflicts = conflictsFor(candidates, {
      firstName: 'Ama',
      lastName: 'Boateng',
      admissionNumber: '1001',
    })

    expect(conflicts.map((conflict) => conflict.category)).toEqual([
      'EXACT_DUPLICATE',
      'ADMISSION_CONFLICT',
      'NAME_CONFLICT',
    ])
  })

  it('never reports a pupil as conflicting with itself during an edit', () => {
    const candidates = [
      pupil({
        id: 'self',
        firstName: 'Ama',
        lastName: 'Boateng',
        admissionNumber: '1001',
      }),
    ]

    expect(
      conflictsFor(
        candidates,
        { firstName: 'Ama', lastName: 'Boateng', admissionNumber: '1001' },
        'self',
      ),
    ).toHaveLength(0)
  })

  it('blocks an exact duplicate without offering a confirmation', () => {
    const candidates = [
      pupil({
        id: 'existing',
        firstName: 'Ama',
        lastName: 'Boateng',
        admissionNumber: '1001',
      }),
    ]
    const resolution = resolvePupilConflict({
      conflicts: conflictsFor(candidates, {
        firstName: 'Ama',
        lastName: 'Boateng',
        admissionNumber: '1001',
      }),
      decisions: new Map(),
      nameKey: 'ama boateng',
      admissionNumber: '1001',
    })

    expect(resolution.blocking?.category).toBe('EXACT_DUPLICATE')
    expect(resolution.requiresConfirmation).toBe(false)
  })

  it('blocks a reused admission number even when the name differs', () => {
    const candidates = [
      pupil({
        id: 'existing',
        firstName: 'Kofi',
        lastName: 'Mensah',
        admissionNumber: '1001',
      }),
    ]
    const resolution = resolvePupilConflict({
      conflicts: conflictsFor(candidates, {
        firstName: 'Ama',
        lastName: 'Boateng',
        admissionNumber: '1001',
      }),
      decisions: new Map(),
      nameKey: 'ama boateng',
      admissionNumber: '1001',
    })

    expect(resolution.blocking?.category).toBe('ADMISSION_CONFLICT')
    expect(resolution.requiresConfirmation).toBe(false)
  })

  it('asks for confirmation when only the name matches', () => {
    const candidates = [
      pupil({
        id: 'existing',
        firstName: 'Ama',
        lastName: 'Boateng',
        admissionNumber: '2002',
      }),
    ]
    const resolution = resolvePupilConflict({
      conflicts: conflictsFor(candidates, {
        firstName: 'Ama',
        lastName: 'Boateng',
        admissionNumber: '1001',
      }),
      decisions: new Map(),
      nameKey: 'ama boateng',
      admissionNumber: '1001',
    })

    expect(resolution.blocking?.pupil.id).toBe('existing')
    expect(resolution.requiresConfirmation).toBe(true)
  })

  it('allows the write after the caller confirms a different pupil', () => {
    const candidates = [
      pupil({
        id: 'existing',
        firstName: 'Ama',
        lastName: 'Boateng',
        admissionNumber: '2002',
      }),
    ]
    const resolution = resolvePupilConflict({
      conflicts: conflictsFor(candidates, {
        firstName: 'Ama',
        lastName: 'Boateng',
        admissionNumber: '1001',
      }),
      decisions: new Map(),
      nameKey: 'ama boateng',
      admissionNumber: '1001',
      confirmedPupilId: 'existing',
    })

    expect(resolution.blocking).toBeNull()
    expect(resolution.confirmedCandidate?.id).toBe('existing')
  })

  it('does not ask again when a different-pupil decision was persisted', () => {
    const candidates = [
      pupil({
        id: 'existing',
        firstName: 'Ama',
        lastName: 'Boateng',
        admissionNumber: '2002',
      }),
    ]
    const decisions = decisionMap([
      {
        nameKey: 'ama boateng',
        admissions: ['2002', '1001'],
        decision: 'DIFFERENT',
      },
    ])
    const resolution = resolvePupilConflict({
      conflicts: conflictsFor(candidates, {
        firstName: 'Ama',
        lastName: 'Boateng',
        admissionNumber: '1001',
      }),
      decisions,
      nameKey: 'ama boateng',
      admissionNumber: '1001',
    })

    expect(resolution.blocking).toBeNull()
    expect(resolution.requiresConfirmation).toBe(false)
  })

  it('keeps blocking when the pair was already marked as the same pupil', () => {
    const candidates = [
      pupil({
        id: 'existing',
        firstName: 'Ama',
        lastName: 'Boateng',
        admissionNumber: '2002',
      }),
    ]
    const decisions = decisionMap([
      {
        nameKey: 'ama boateng',
        admissions: ['2002', '1001'],
        decision: 'SAME',
      },
    ])
    const resolution = resolvePupilConflict({
      conflicts: conflictsFor(candidates, {
        firstName: 'Ama',
        lastName: 'Boateng',
        admissionNumber: '1001',
      }),
      decisions,
      nameKey: 'ama boateng',
      admissionNumber: '1001',
    })

    expect(resolution.blocking).not.toBeNull()
    expect(resolution.requiresConfirmation).toBe(false)
  })

  it('still blocks on an unconfirmed second same-name candidate', () => {
    const candidates = [
      pupil({
        id: 'first',
        firstName: 'Ama',
        lastName: 'Boateng',
        admissionNumber: '2002',
      }),
      pupil({
        id: 'second',
        firstName: 'Ama',
        lastName: 'Boateng',
        admissionNumber: '3003',
      }),
    ]
    const resolution = resolvePupilConflict({
      conflicts: conflictsFor(candidates, {
        firstName: 'Ama',
        lastName: 'Boateng',
        admissionNumber: '1001',
      }),
      decisions: new Map(),
      nameKey: 'ama boateng',
      admissionNumber: '1001',
      confirmedPupilId: 'first',
    })

    expect(resolution.blocking?.pupil.id).toBe('second')
    expect(resolution.requiresConfirmation).toBe(true)
  })
})

describe('resolved duplicate groups', () => {
  const pupils = [
    pupil({
      id: 'a',
      firstName: 'Ama',
      lastName: 'Boateng',
      admissionNumber: '1001',
    }),
    pupil({
      id: 'b',
      firstName: 'Ama',
      lastName: 'Boateng',
      admissionNumber: '2002',
    }),
  ]

  it('marks a pair resolved after a different-pupil decision', () => {
    const audit = groupPupilDuplicates(
      pupils,
      decisionMap([
        {
          nameKey: 'ama boateng',
          admissions: ['1001', '2002'],
          decision: 'DIFFERENT',
        },
      ]),
    )

    expect(audit.groups[0]?.resolved).toBe(true)
    expect(audit.summary.resolvedGroups).toBe(1)
    expect(audit.summary.awaitingGroups).toBe(0)
  })

  it('marks a pair resolved after a merge', () => {
    const audit = groupPupilDuplicates(
      pupils,
      decisionMap([
        {
          nameKey: 'ama boateng',
          admissions: ['1001', '2002'],
          decision: 'MERGED',
        },
      ]),
    )

    expect(audit.groups[0]?.resolved).toBe(true)
  })

  it('keeps a same-pupil decision unresolved until it is merged', () => {
    const audit = groupPupilDuplicates(
      pupils,
      decisionMap([
        {
          nameKey: 'ama boateng',
          admissions: ['1001', '2002'],
          decision: 'SAME',
        },
      ]),
    )

    expect(audit.groups[0]?.resolved).toBe(false)
    expect(audit.summary.awaitingGroups).toBe(1)
  })
})

describe('duplicate filters', () => {
  const audit = groupPupilDuplicates([
    pupil({
      id: 'definite-a',
      firstName: 'Ama',
      lastName: 'Boateng',
      admissionNumber: '1001',
    }),
    pupil({
      id: 'definite-b',
      firstName: 'Ama',
      lastName: 'Boateng',
      admissionNumber: '1001',
    }),
    pupil({
      id: 'possible-a',
      firstName: 'Kofi',
      lastName: 'Mensah',
      admissionNumber: '2002',
    }),
    pupil({
      id: 'possible-b',
      firstName: 'Kofi',
      lastName: 'Mensah',
      admissionNumber: '3003',
    }),
    pupil({
      id: 'admission-a',
      firstName: 'Yaw',
      lastName: 'Owusu',
      admissionNumber: '4004',
    }),
    pupil({
      id: 'admission-b',
      firstName: 'Esi',
      lastName: 'Adjei',
      admissionNumber: '4004',
    }),
  ])

  it('filters by category', () => {
    expect(
      filterPupilDuplicateGroups(audit, { category: 'DEFINITE' }).groups.map(
        (group) => group.category,
      ),
    ).toEqual(['DEFINITE'])
    expect(
      filterPupilDuplicateGroups(audit, { category: 'NAME_CONFLICT' }).groups.map(
        (group) => group.category,
      ),
    ).toEqual(['NAME_CONFLICT'])
    expect(
      filterPupilDuplicateGroups(audit, {
        category: 'ADMISSION_CONFLICT',
      }).groups.map((group) => group.category),
    ).toEqual(['ADMISSION_CONFLICT'])
  })

  it('searches names and admission numbers', () => {
    expect(
      filterPupilDuplicateGroups(audit, { query: 'mensah' }).groups,
    ).toHaveLength(1)
    expect(
      filterPupilDuplicateGroups(audit, { query: '4004' }).groups,
    ).toHaveLength(1)
  })
})
