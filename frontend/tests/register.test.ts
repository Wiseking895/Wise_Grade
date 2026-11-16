import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import {
  categoryRawTotal,
  isSubmissionLocked,
  printableScore,
  registerReadiness,
  scoreNavigationTarget,
  splitComponents,
  validateScoreInput,
  type RegisterComponentLike,
} from '../src/assessment/register.ts'
import {
  formatOrdinal,
  positionDisplay,
  previewPupilResult,
} from '../src/assessment/helpers.ts'
import { rankProvisionalPositions } from '../src/assessment/positions.ts'

function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8')
}

const REFERENCE_COMPONENTS: RegisterComponentLike[] = [
  {
    id: 'individual-test',
    category: 'SBA',
    name: 'Individual Test',
    sortOrder: 0,
    maximumScore: '15.00',
    weightPercent: '12.50',
  },
  {
    id: 'group-work',
    category: 'SBA',
    name: 'Group Work',
    sortOrder: 1,
    maximumScore: '15.00',
    weightPercent: '12.50',
  },
  {
    id: 'class-test',
    category: 'SBA',
    name: 'Class Test',
    sortOrder: 2,
    maximumScore: '15.00',
    weightPercent: '12.50',
  },
  {
    id: 'project',
    category: 'SBA',
    name: 'Project',
    sortOrder: 3,
    maximumScore: '15.00',
    weightPercent: '12.50',
  },
  {
    id: 'examination',
    category: 'EXAM',
    name: 'Examination',
    sortOrder: 4,
    maximumScore: '100.00',
    weightPercent: '50.00',
  },
]

const REFERENCE_SCORES = {
  'individual-test': '12',
  'group-work': '14',
  'class-test': '13',
  project: '15',
  examination: '80',
}

describe('dynamic SBA register columns', () => {
  it('groups and orders components from the active policy', () => {
    const groups = splitComponents(REFERENCE_COMPONENTS)

    assert.deepEqual(
      groups.sba.map((component) => component.name),
      ['Individual Test', 'Group Work', 'Class Test', 'Project'],
    )
    assert.deepEqual(
      groups.exam.map((component) => component.name),
      ['Examination'],
    )
  })

  it('accepts a policy with different components and maxima', () => {
    const groups = splitComponents([
      {
        id: 'homework',
        category: 'SBA',
        name: 'Homework',
        sortOrder: 1,
        maximumScore: '10.00',
        weightPercent: '20.00',
      },
      {
        id: 'class-exercise',
        category: 'SBA',
        name: 'Class exercise',
        sortOrder: 0,
        maximumScore: '20.00',
        weightPercent: '20.00',
      },
      {
        id: 'end-of-term',
        category: 'EXAM',
        name: 'End of term',
        sortOrder: 2,
        maximumScore: '50.00',
        weightPercent: '60.00',
      },
    ])

    assert.deepEqual(
      groups.sba.map((component) => component.name),
      ['Class exercise', 'Homework'],
    )
    assert.equal(groups.sba[0]?.maximumScore, '20.00')
    assert.equal(groups.exam[0]?.maximumScore, '50.00')
  })
})

describe('score cell validation', () => {
  it('distinguishes a missing score from an explicit zero', () => {
    assert.equal(validateScoreInput(undefined, '15.00').state, 'missing')
    assert.equal(validateScoreInput('   ', '15.00').state, 'missing')

    const zero = validateScoreInput('0', '15.00')
    assert.equal(zero.state, 'valid')
    assert.equal(zero.value, 0)
  })

  it('accepts scores up to the configured maximum', () => {
    const exact = validateScoreInput('15', '15.00')
    assert.equal(exact.state, 'valid')
    assert.equal(exact.value, 15)

    const decimals = validateScoreInput('14.75', '15.00')
    assert.equal(decimals.state, 'valid')
    assert.equal(decimals.value, 14.75)
  })

  it('rejects negative, above-maximum and malformed values', () => {
    assert.equal(validateScoreInput('-1', '15.00').state, 'invalid')
    assert.equal(validateScoreInput('15.01', '15.00').state, 'invalid')
    assert.equal(validateScoreInput('12.345', '15.00').state, 'invalid')
    assert.equal(validateScoreInput('ten', '15.00').state, 'invalid')
    assert.equal(validateScoreInput('1e2', '15.00').state, 'invalid')
  })
})

describe('raw category totals', () => {
  it('sums entered marks and reports missing scores separately', () => {
    const groups = splitComponents(REFERENCE_COMPONENTS)
    const total = categoryRawTotal(groups.sba, {
      'individual-test': '12',
      'group-work': '14',
      'class-test': '',
    })

    assert.equal(total.enteredTotal, 26)
    assert.equal(total.maximum, 60)
    assert.equal(total.weight, 50)
    assert.equal(total.missingCount, 2)
    assert.equal(total.complete, false)
  })

  it('keeps zeros in the sum and treats a filled category as complete', () => {
    const groups = splitComponents(REFERENCE_COMPONENTS)
    const total = categoryRawTotal(groups.sba, {
      'individual-test': '0',
      'group-work': '14',
      'class-test': '13',
      project: '15',
    })

    assert.equal(total.enteredTotal, 42)
    assert.equal(total.complete, true)
    assert.equal(total.missingCount, 0)
  })
})

describe('scaled totals preview', () => {
  it('shows the documented reference example', () => {
    const result = previewPupilResult(REFERENCE_COMPONENTS, REFERENCE_SCORES)

    assert.equal(result.sba, 45)
    assert.equal(result.exam, 40)
    assert.equal(result.final, 85)
    assert.deepEqual(result.missingComponentIds, [])
    assert.deepEqual(result.invalidComponentIds, [])
  })

  it('never treats missing scores as zero', () => {
    const result = previewPupilResult(REFERENCE_COMPONENTS, {
      'individual-test': '12',
      'group-work': '14',
      project: '15',
    })

    assert.equal(result.sba, null)
    assert.equal(result.final, null)
    assert.equal(result.missingComponentIds.length, 2)
  })

  it('leaves totals null when a score is invalid', () => {
    const result = previewPupilResult(REFERENCE_COMPONENTS, {
      ...REFERENCE_SCORES,
      'individual-test': '16',
    })

    assert.equal(result.final, null)
    assert.deepEqual(result.invalidComponentIds, ['individual-test'])
  })
})

describe('grouped standard SBA preview', () => {
  function grouped(
    sba: [string, string, string, string],
    examination: string,
  ) {
    return previewPupilResult(
      REFERENCE_COMPONENTS,
      {
        'individual-test': sba[0],
        'group-work': sba[1],
        'class-test': sba[2],
        project: sba[3],
        examination,
      },
      'GROUPED_SBA',
    )
  }

  it('Example A: full Class Score /60 and full examination produce 100', () => {
    const result = grouped(['15', '15', '15', '15'], '100')

    assert.equal(result.sba, 50)
    assert.equal(result.exam, 50)
    assert.equal(result.final, 100)
  })

  it('Example B: Class Score 45/60 and examination 75/100 produce 75', () => {
    const result = grouped(['12', '10', '8', '15'], '75')

    assert.equal(result.sba, 37.5)
    assert.equal(result.exam, 37.5)
    assert.equal(result.final, 75)
  })

  it('Example C: Class Score 30/60 and examination 50/100 produce 50', () => {
    const result = grouped(['8', '7', '8', '7'], '50')

    assert.equal(result.sba, 25)
    assert.equal(result.exam, 25)
    assert.equal(result.final, 50)
  })

  it('scales the summed Class Score once, not each component', () => {
    const result = grouped(['1', '1', '1', '1'], '0')

    // 4/60 * 50 = 3.333... -> 3.33. Per-component scaling would give 3.32.
    assert.equal(result.sba, 3.33)
    assert.equal(result.exam, 0)
    assert.equal(result.final, 3.33)
  })

  it('keeps a missing or invalid score distinct from zero', () => {
    const missing = previewPupilResult(
      REFERENCE_COMPONENTS,
      {
        'individual-test': '12',
        'group-work': '14',
        'class-test': '13',
        examination: '80',
      },
      'GROUPED_SBA',
    )

    assert.equal(missing.sba, null)
    assert.equal(missing.final, null)
    assert.deepEqual(missing.missingComponentIds, ['project'])

    const invalid = grouped(['12', '14', '13', '16'], '80')
    assert.equal(invalid.final, null)
    assert.deepEqual(invalid.invalidComponentIds, ['project'])
  })
})

describe('keyboard navigation and print values', () => {
  it('moves down on Enter or ArrowDown and up on ArrowUp', () => {
    assert.equal(scoreNavigationTarget('Enter', 0, 2, 3), 'score-1-2')
    assert.equal(scoreNavigationTarget('ArrowDown', 1, 2, 3), 'score-2-2')
    assert.equal(scoreNavigationTarget('ArrowUp', 2, 2, 3), 'score-1-2')
  })

  it('moves up on Shift+Enter and clamps at the register edges', () => {
    assert.equal(scoreNavigationTarget('Enter', 2, 1, 3, true), 'score-1-1')
    assert.equal(scoreNavigationTarget('ArrowUp', 0, 1, 3), 'score-0-1')
    assert.equal(scoreNavigationTarget('ArrowDown', 2, 1, 3), 'score-2-1')
  })

  it('leaves Tab to the browser', () => {
    assert.equal(scoreNavigationTarget('Tab', 0, 0, 5), null)
    assert.equal(scoreNavigationTarget('a', 0, 0, 5), null)
  })

  it('prints a real zero literally and keeps missing cells blank', () => {
    assert.equal(printableScore(undefined), '')
    assert.equal(printableScore('  '), '')
    assert.equal(printableScore('0'), '0')
    assert.equal(printableScore('0.00'), '0.00')
    assert.equal(printableScore(' 14.5 '), '14.5')
  })
})

describe('submission readiness and locking', () => {
  const pupils = [{ pupilId: 'pupil-a' }, { pupilId: 'pupil-b' }]

  it('blocks submission while any score is missing', () => {
    const readiness = registerReadiness(REFERENCE_COMPONENTS, pupils, {
      'pupil-a': { 'individual-test': '12' },
      'pupil-b': { 'individual-test': '10' },
    })

    assert.equal(readiness.canSubmit, false)
    assert.equal(readiness.completePupils, 0)
    assert.equal(readiness.incompletePupils, 2)
  })

  it('blocks submission while any score is invalid', () => {
    const readiness = registerReadiness(REFERENCE_COMPONENTS, pupils, {
      'pupil-a': REFERENCE_SCORES,
      'pupil-b': { ...REFERENCE_SCORES, 'individual-test': '-1' },
    })

    assert.equal(readiness.invalidPupils, 1)
    assert.equal(readiness.canSubmit, false)
  })

  it('allows submission when every pupil has a valid score, including zero', () => {
    const readiness = registerReadiness(REFERENCE_COMPONENTS, pupils, {
      'pupil-a': REFERENCE_SCORES,
      'pupil-b': {
        'individual-test': '0',
        'group-work': '0',
        'class-test': '0',
        project: '0',
        examination: '0',
      },
    })

    assert.equal(readiness.completePupils, 2)
    assert.equal(readiness.canSubmit, true)
  })

  it('locks submitted and accepted results only', () => {
    assert.equal(isSubmissionLocked('DRAFT'), false)
    assert.equal(isSubmissionLocked('RETURNED_FOR_CORRECTION'), false)
    assert.equal(isSubmissionLocked('SUBMITTED'), true)
    assert.equal(isSubmissionLocked('ACCEPTED'), true)
  })
})

describe('provisional subject ranking before submission', () => {
  const positions = (
    entries: Array<{
      pupilId: string
      name: string
      finalScore: number | null
    }>,
    tiePolicy: 'COMPETITION' | 'DENSE' | 'ORDINAL' = 'COMPETITION',
  ) => Object.fromEntries(rankProvisionalPositions(entries, tiePolicy))

  const marvin = {
    pupilId: 'marvin',
    name: 'Marvin Frimpong',
    finalScore: 68,
  }
  const freda = {
    pupilId: 'freda',
    name: 'Freda Oteng',
    finalScore: 64,
  }

  it('ranks complete draft scores before submission', () => {
    assert.deepEqual(positions([marvin, freda]), {
      marvin: 1,
      freda: 2,
    })
  })

  it('recalculates positions when an edited score changes the order', () => {
    assert.deepEqual(
      positions([marvin, { ...freda, finalScore: 75 }]),
      { freda: 1, marvin: 2 },
    )
  })

  it('includes a newly completed pupil and shifts existing positions', () => {
    const newPupil = {
      pupilId: 'ama',
      name: 'Ama Asare',
      finalScore: 80,
    }

    assert.deepEqual(
      positions([marvin, { ...freda, finalScore: 75 }, newPupil]),
      { ama: 1, freda: 2, marvin: 3 },
    )
  })

  it('uses competition ranking for ties', () => {
    assert.deepEqual(
      positions([
        { pupilId: 'a', name: 'Ama Asare', finalScore: 90 },
        { pupilId: 'b', name: 'Bola Bediako', finalScore: 80 },
        { pupilId: 'c', name: 'Chipo Cole', finalScore: 80 },
        { pupilId: 'd', name: 'Dela Danso', finalScore: 70 },
      ]),
      { a: 1, b: 2, c: 2, d: 4 },
    )
  })

  it('excludes incomplete pupils and never treats missing marks as zero', () => {
    assert.deepEqual(
      positions([marvin, { ...freda, finalScore: null }]),
      { marvin: 1 },
    )
  })

  it('keeps subjects and classes independent', () => {
    const maths = positions([
      { pupilId: 'a', name: 'Ama Asare', finalScore: 70 },
      { pupilId: 'b', name: 'Bola Bediako', finalScore: 90 },
    ])
    const english = positions([
      { pupilId: 'a', name: 'Ama Asare', finalScore: 90 },
      { pupilId: 'b', name: 'Bola Bediako', finalScore: 70 },
    ])
    const otherClass = positions([
      { pupilId: 'x', name: 'Xavier X', finalScore: 100 },
      { pupilId: 'y', name: 'Yaa Y', finalScore: 99 },
    ])

    assert.deepEqual(maths, { b: 1, a: 2 })
    assert.deepEqual(english, { a: 1, b: 2 })
    assert.deepEqual(otherClass, { x: 1, y: 2 })
  })
})

describe('SBA register subject position display', () => {
  it('formats backend ranks as ordinals without estimating missing positions', () => {
    assert.equal(formatOrdinal(1), '1st')
    assert.equal(formatOrdinal(2), '2nd')
    assert.equal(formatOrdinal(3), '3rd')
    assert.equal(formatOrdinal(4), '4th')
    assert.equal(formatOrdinal(11), '11th')
    assert.equal(formatOrdinal(12), '12th')
    assert.equal(formatOrdinal(13), '13th')
    assert.equal(formatOrdinal(21), '21st')
    assert.equal(formatOrdinal(22), '22nd')
    assert.equal(formatOrdinal(23), '23rd')
    assert.equal(formatOrdinal(101), '101st')
    assert.equal(formatOrdinal(null), '—')
  })

  it('never places workflow statuses in the Position column', () => {
    assert.equal(
      positionDisplay(
        { subjectPosition: 1, subjectPositionStatus: 'PROVISIONAL' },
        1,
      ),
      '1st',
    )
    assert.equal(
      positionDisplay(
        { subjectPosition: null, subjectPositionStatus: 'INCOMPLETE' },
        null,
      ),
      '—',
    )
    assert.equal(
      positionDisplay(
        { subjectPosition: null, subjectPositionStatus: 'NOT_ELIGIBLE' },
        1,
      ),
      '—',
    )
    assert.equal(
      positionDisplay(
        { subjectPosition: null, subjectPositionStatus: 'NOT_RANKED' },
        null,
      ),
      '—',
    )
  })

  it('shows only the official ordinal for a finalized result', () => {
    const first = positionDisplay({
      subjectPosition: 1,
      subjectPositionStatus: 'FINAL',
    })
    const second = positionDisplay({
      subjectPosition: 2,
      subjectPositionStatus: 'FINAL',
    })

    assert.equal(first, '1st')
    assert.equal(second, '2nd')
    assert.doesNotMatch(first, /pending|complete|review|submitted|accepted/i)
    assert.doesNotMatch(second, /pending|complete|review|submitted|accepted/i)
  })

  it('falls back to the backend provisional rank when live ranking has not run', () => {
    // The backend already calculated these provisional positions. They must
    // render even if the client-side live map is not available yet.
    assert.equal(
      positionDisplay({
        subjectPosition: 1,
        subjectPositionStatus: 'PROVISIONAL',
      }),
      '1st',
    )
    assert.equal(
      positionDisplay({
        subjectPosition: 2,
        subjectPositionStatus: 'PROVISIONAL',
      }),
      '2nd',
    )

    // An explicit null comes from the live score state: the pupil is now
    // incomplete, so the previously saved provisional rank must not leak.
    assert.equal(
      positionDisplay(
        { subjectPosition: 1, subjectPositionStatus: 'PROVISIONAL' },
        null,
      ),
      '—',
    )

    // A live rank wins over the backend rank while the teacher edits scores.
    assert.equal(
      positionDisplay(
        { subjectPosition: 2, subjectPositionStatus: 'PROVISIONAL' },
        1,
      ),
      '1st',
    )
  })

  it('adds a read-only Position column to the on-screen and printed register', async () => {
    const page = await source('../src/pages/dashboard/ScoreEntryPage.tsx')
    const helpers = await source('../src/assessment/helpers.ts')

    assert.match(page, /Position/)
    assert.equal(
      (page.match(/positionDisplay\(/g) ?? []).length,
      2,
    )
    assert.match(page, /provisionalPositions\.get\(pupil\.pupilId\)/)
    assert.match(page, /new Map<string, number \| null>\(\)/)
    assert.match(
      page,
      /positions\.set\(pupil\.pupilId, ranks\.get\(pupil\.pupilId\) \?\? null\)/,
    )
    assert.match(page, /Provisional positions update as scores change/)
    // Workflow wording must never leak into the Position display helper.
    for (const label of [
      'Pending submission',
      'Pending review',
      'Not ranked',
    ]) {
      assert.equal(helpers.includes(label), false, label)
    }
    // The position is rendered as text, never as an editable input.
    assert.doesNotMatch(
      page,
      /value=\{[^}]*subjectPosition[^}]*\}/,
    )
  })

  it('removes technical assessment information from the teacher interface', async () => {
    const page = await source('../src/pages/dashboard/ScoreEntryPage.tsx')

    for (const hidden of [
      'Not saved yet',
      'Grading scheme:',
      'pupils complete',
      'does not expose an authorized ranking calculation',
      'Position is not computed',
      'Component names, maxima and weights come from the active policy',
    ]) {
      assert.equal(page.includes(hidden), false, hidden)
    }

    // The policy name and version are no longer displayed as a teacher heading.
    assert.doesNotMatch(page, /v\{view\.policy\.version\}/)
    assert.doesNotMatch(page, /<h2[^>]*>\s*\{view\.policy\.name\}/)
  })
})
