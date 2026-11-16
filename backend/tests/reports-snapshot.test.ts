import { describe, expect, it } from 'vitest'
import {
  DRAFT_LABEL,
  buildReportSet,
  parseGradingSnapshot,
  parsePolicySnapshot,
  subjectWeights,
} from '../src/reports/snapshot.js'
import type { ReportGenerationData } from '../src/reports/repository.js'
import {
  DEFAULT_PUPILS,
  DEFAULT_SUBJECTS,
  makeReportData,
} from './helpers/report-fixtures.js'

function snapshotFor(data: ReportGenerationData, pupilId = 'pupil-ada') {
  const built = buildReportSet(data)
  const build = built.builds.find((item) => item.pupil.id === pupilId)

  if (!build) {
    throw new Error(`Missing fixture pupil ${pupilId}`)
  }

  return build
}

describe('report snapshot generation', () => {
  it('builds an eligible immutable snapshot from accepted results', () => {
    const built = buildReportSet(makeReportData())
    const snapshot = built.builds[0]!.snapshot!

    expect(built.eligibleCount).toBe(3)
    expect(snapshot.draft).toBe(true)
    expect(snapshot.draftLabel).toBe(DRAFT_LABEL)
    expect(snapshot.school.name).toBe('Green Valley Academy')
    expect(snapshot.pupil.fullName).toBe('Ada Mensah Akosua')
    expect(snapshot.academic.subjects).toHaveLength(3)
    expect(snapshot.academic.subjects.map((row) => row.name)).toEqual([
      'Mathematics',
      'English Language',
      'Integrated Science',
    ])
    expect(snapshot.academic.subjects[0]).toMatchObject({
      classScore: '46.00',
      examScore: '46.00',
      totalScore: '92.00',
      grade: 'A',
      remark: 'Excellent',
      subjectPosition: 1,
      weights: { sba: '50.00', exam: '50.00', total: '100.00' },
    })
    expect(snapshot.academic.total).toBe('264.00')
    expect(snapshot.academic.average).toBe('88.00')
    expect(snapshot.academic.examTotal).toBe('132.00')
    expect(snapshot.academic.aggregate.display).toBe('264.00')
    expect(snapshot.document.classPositionDisplay).toBe('1')
    expect(snapshot.document.numberOnRoll).toBe(3)
    expect(snapshot.attendance.display).toBe('58/60')
  })

  it('preserves the configured subject order', () => {
    const subjects = [
      ...DEFAULT_SUBJECTS,
      { id: 'sub-ict', name: 'Information Technology', sortOrder: -1 },
    ]
    const built = buildReportSet(makeReportData({ subjects }))

    expect(built.subjects.map((subject) => subject.name)).toEqual([
      'Information Technology',
      'Mathematics',
      'English Language',
      'Integrated Science',
    ])
  })

  it('uses per-subject assessment weights without misrepresenting scores', () => {
    const subjects = DEFAULT_SUBJECTS.map((subject) =>
      subject.id === 'sub-math'
        ? { ...subject, sbaWeight: '40.00', examWeight: '60.00' }
        : subject,
    )
    const snapshot = snapshotFor(makeReportData({ subjects })).snapshot!

    expect(snapshot.academic.mixedSubjectWeights).toBe(true)
    expect(snapshot.academic.sbaWeight).toBe('MIXED')
    expect(snapshot.academic.examWeight).toBe('MIXED')
    expect(snapshot.academic.subjects[0]!.weights).toEqual({
      sba: '40.00',
      exam: '60.00',
      total: '100.00',
    })
    expect(snapshot.academic.subjects[1]!.weights.sba).toBe('50.00')
  })

  it('summarizes the grouped standard policy as 30% SBA and 70% examination', () => {
    const summary = subjectWeights({
      id: 'standard',
      name: 'Wise Grade Standard Assessment Policy',
      version: 1,
      calculationMode: 'GROUPED_SBA',
      isDefault: true,
      components: [
        {
          key: 'individual-test',
          name: 'Individual Test',
          category: 'SBA',
          maximumScore: '15.00',
          weightPercent: '7.50',
          sortOrder: 0,
        },
        {
          key: 'group-work',
          name: 'Group Work',
          category: 'SBA',
          maximumScore: '15.00',
          weightPercent: '7.50',
          sortOrder: 1,
        },
        {
          key: 'class-test',
          name: 'Class Test',
          category: 'SBA',
          maximumScore: '15.00',
          weightPercent: '7.50',
          sortOrder: 2,
        },
        {
          key: 'project',
          name: 'Project',
          category: 'SBA',
          maximumScore: '15.00',
          weightPercent: '7.50',
          sortOrder: 3,
        },
        {
          key: 'examination',
          name: 'Examination',
          category: 'EXAM',
          maximumScore: '100.00',
          weightPercent: '70.00',
          sortOrder: 4,
        },
      ],
    })

    expect(summary).toEqual({
      sba: '30.00',
      exam: '70.00',
      total: '100.00',
    })
  })

  it('classifies early-years subjects with Gold/Silver/Bronze and hides letter grades', () => {
    const data = makeReportData({ className: 'Creche' })
    const snapshot = snapshotFor(data).snapshot!

    expect(snapshot.academic.earlyYears).toBe(true)
    expect(snapshot.academic.grading.name).toBe(
      'Early Years Performance Scale',
    )
    expect(
      snapshot.academic.grading.bands.map((band) => band.gradeLabel),
    ).toEqual(['G', 'S', 'B'])
    expect(snapshot.academic.subjects.map((row) => row.grade)).toEqual([
      null,
      null,
      null,
    ])
    expect(snapshot.academic.subjects.map((row) => row.remark)).toEqual([
      'Gold (G)',
      'Gold (G)',
      'Gold (G)',
    ])

    const esi = snapshotFor(data, 'pupil-esi').snapshot!
    expect(esi.academic.subjects.map((row) => row.grade)).toEqual([
      null,
      null,
      null,
    ])
    expect(esi.academic.subjects.map((row) => row.remark)).toEqual([
      'Silver (S)',
      'Silver (S)',
      'Bronze (B)',
    ])
  })

  it('preserves the stored early-years classification in historical snapshots', () => {
    const data = makeReportData({ className: 'Creche' })
    const score = data.scores.find(
      (item) => item.pupilId === 'pupil-ada' && item.subjectId === 'sub-math',
    )!

    // A historical report keeps the accepted Gold classification even if the
    // numeric score alone would now fall into another band.
    score.finalScore = '50.00'
    score.gradeLabel = 'G'
    score.gradeRemark = 'Gold'

    const snapshot = snapshotFor(data).snapshot!
    const math = snapshot.academic.subjects.find(
      (row) => row.subjectId === 'sub-math',
    )
    expect(math?.grade).toBeNull()
    expect(math?.remark).toBe('Gold (G)')
  })

  it('refuses to generate when any required subject result is missing', () => {
    const data = makeReportData({
      pupils: [
        {
          ...DEFAULT_PUPILS[0]!,
          scores: { 'sub-math': '92.00', 'sub-english': '88.00' },
        },
      ],
    })
    const build = snapshotFor(data)

    expect(build.eligible).toBe(false)
    expect(build.failure?.code).toBe('RESULT_MISSING')
    expect(build.snapshot).toBeNull()
  })

  it('treats an explicit zero as a complete score', () => {
    const data = makeReportData({
      pupils: [
        {
          ...DEFAULT_PUPILS[0]!,
          scores: { 'sub-math': '0.00', 'sub-english': '88.00', 'sub-science': '84.00' },
        },
      ],
    })
    const build = snapshotFor(data)

    expect(build.eligible).toBe(true)
    expect(build.snapshot!.academic.subjects[0]!.totalScore).toBe('0.00')
    expect(build.snapshot!.academic.subjects[0]!.grade).toBe('F')
  })

  it('rejects an accepted result whose stored grade contradicts the grading snapshot', () => {
    const data = makeReportData()
    data.scores[0] = { ...data.scores[0]!, gradeLabel: 'Z' }
    const build = snapshotFor(data)

    expect(build.eligible).toBe(false)
    expect(build.failure?.code).toBe('GRADE_SNAPSHOT_MISMATCH')
  })

  it('refuses to generate when a subject submission is not accepted', () => {
    const data = makeReportData()
    data.submissions[1] = { ...data.submissions[1]!, status: 'SUBMITTED' }
    const build = snapshotFor(data)

    expect(build.eligible).toBe(false)
    expect(build.failure?.code).toBe('RESULT_NOT_ACCEPTED')
  })

  it('validates required attendance and attendance bounds', () => {
    const missing = makeReportData({
      pupils: [
        {
          ...DEFAULT_PUPILS[0]!,
          daysOpened: null,
          daysAttended: null,
        },
      ],
    })
    expect(snapshotFor(missing).failure?.code).toBe('ATTENDANCE_MISSING')

    const invalid = makeReportData({
      pupils: [
        {
          ...DEFAULT_PUPILS[0]!,
          daysOpened: 40,
          daysAttended: 41,
        },
      ],
    })
    expect(snapshotFor(invalid).failure?.code).toBe('ATTENDANCE_INVALID')

    const optional = makeReportData({
      settings: { attendanceRequired: false },
      pupils: [
        {
          ...DEFAULT_PUPILS[0]!,
          daysOpened: null,
          daysAttended: null,
        },
      ],
    })
    const optionalBuild = snapshotFor(optional)
    expect(optionalBuild.eligible).toBe(true)
    expect(optionalBuild.snapshot!.attendance.display).toBe('N/A')
  })

  it('handles competition, dense and ordinal ties deterministically', () => {
    const tiedPupils = [
      {
        ...DEFAULT_PUPILS[0]!,
        id: 'pupil-a',
        firstName: 'Ama',
        lastName: 'Asare',
        scores: { 'sub-math': '80.00', 'sub-english': '80.00', 'sub-science': '80.00' },
      },
      {
        ...DEFAULT_PUPILS[1]!,
        id: 'pupil-b',
        firstName: 'Bola',
        lastName: 'Bediako',
        scores: { 'sub-math': '80.00', 'sub-english': '80.00', 'sub-science': '80.00' },
      },
      {
        ...DEFAULT_PUPILS[2]!,
        id: 'pupil-c',
        firstName: 'Chipo',
        lastName: 'Cole',
        scores: { 'sub-math': '70.00', 'sub-english': '70.00', 'sub-science': '70.00' },
      },
    ]

    const competition = buildReportSet(
      makeReportData({ pupils: tiedPupils, settings: { tiePolicy: 'COMPETITION' } }),
    )
    expect(competition.builds.map((item) => item.snapshot!.document.classPosition)).toEqual([
      1, 1, 3,
    ])

    const dense = buildReportSet(
      makeReportData({ pupils: tiedPupils, settings: { tiePolicy: 'DENSE' } }),
    )
    expect(dense.builds.map((item) => item.snapshot!.document.classPosition)).toEqual([
      1, 1, 2,
    ])

    const ordinal = buildReportSet(
      makeReportData({ pupils: tiedPupils, settings: { tiePolicy: 'ORDINAL' } }),
    )
    expect(ordinal.builds.map((item) => item.snapshot!.document.classPosition)).toEqual([
      1, 2, 3,
    ])
  })

  it('ranks subject positions across the class with the configured tie policy', () => {
    const pupils = [
      { ...DEFAULT_PUPILS[0]!, id: 'pupil-a', scores: { 'sub-math': '90.00', 'sub-english': '70.00', 'sub-science': '60.00' } },
      { ...DEFAULT_PUPILS[1]!, id: 'pupil-b', scores: { 'sub-math': '80.00', 'sub-english': '80.00', 'sub-science': '60.00' } },
      { ...DEFAULT_PUPILS[2]!, id: 'pupil-c', scores: { 'sub-math': '80.00', 'sub-english': '60.00', 'sub-science': '60.00' } },
    ]
    const built = buildReportSet(makeReportData({ pupils }))
    const math = built.builds.map(
      (item) => item.snapshot!.academic.subjects[0]!.subjectPosition,
    )

    expect(math).toEqual([1, 2, 2])
  })

  it('disables ranks without inventing positions when ranking is off', () => {
    const built = buildReportSet(
      makeReportData({ settings: { rankingEnabled: false } }),
    )

    for (const item of built.builds) {
      expect(item.snapshot!.document.classPosition).toBeNull()
      expect(item.snapshot!.document.classPositionDisplay).toBe('N/A')
      expect(
        item.snapshot!.academic.subjects.every(
          (row) => row.subjectPosition === null,
        ),
      ).toBe(true)
    }
  })

  it('computes documented aggregate, average and total policies', () => {
    const sumAll = buildReportSet(
      makeReportData({ settings: { aggregatePolicy: 'SUM_ALL_SUBJECTS' } }),
    )
    expect(sumAll.builds[0]!.snapshot!.academic.aggregate.display).toBe('264.00')

    const bestSixAverage = buildReportSet(
      makeReportData({ settings: { aggregatePolicy: 'BEST_SIX_AVERAGE' } }),
    )
    expect(bestSixAverage.builds[0]!.snapshot!.academic.aggregate.display).toBe('88.00')

    const none = buildReportSet(
      makeReportData({ settings: { aggregatePolicy: 'NONE' } }),
    )
    expect(none.builds[0]!.snapshot!.academic.aggregate.display).toBe('N/A')
  })

  it('preserves branding, remarks, dates and signature configuration', () => {
    const snapshot = snapshotFor(makeReportData()).snapshot!

    expect(snapshot.school.emblemObjectKey).toContain('/emblem/')
    expect(snapshot.school.crestObjectKey).toBeNull()
    expect(snapshot.document.signatureObjectKey).toContain('/signature/')
    expect(snapshot.document.closingDate).toBe('2026-07-31')
    expect(snapshot.document.reopeningDate).toBe('2026-09-15')
    expect(snapshot.remarks.teacher).toBe('A focused and consistent learner.')
    expect(snapshot.remarks.attitude).toBe('Respectful and cooperative.')
  })

  it('snapshots the school signature, printed name and designation when no term override exists', () => {
    const data = makeReportData({
      settings: {
        signatureObjectKey: null,
      },
    })
    data.school.signatureObjectKey = 'schools/school-1/signature/admin.png'
    data.school.signatureName = 'Grace Mensah'
    data.school.signatureDesignation = 'Headmistress'

    const snapshot = snapshotFor(data).snapshot!

    expect(snapshot.document.signatureObjectKey).toBe(
      'schools/school-1/signature/admin.png',
    )
    expect(snapshot.document.signatureName).toBe('Grace Mensah')
    expect(snapshot.document.signatureDesignation).toBe('Headmistress')
  })

  it('prefers the school-level signature over a legacy term-scoped asset', () => {
    const data = makeReportData()
    data.school.signatureObjectKey = 'schools/school-1/signature/admin.png'
    data.school.signatureName = 'Grace Mensah'
    data.school.signatureDesignation = 'Headmistress'

    const snapshot = snapshotFor(data).snapshot!

    expect(snapshot.document.signatureObjectKey).toBe(
      'schools/school-1/signature/admin.png',
    )
  })

  it('keeps an existing snapshot unchanged when the current photo or signature is replaced', () => {
    const data = makeReportData({
      pupils: [
        {
          ...DEFAULT_PUPILS[0]!,
          photoReference: 'schools/school-1/pupils/pupil-ada/photo/old.jpg',
        },
      ],
    })

    const snapshot = snapshotFor(data).snapshot!
    const originalPhoto = snapshot.pupil.photoObjectKey
    const originalSignature = snapshot.document.signatureObjectKey
    const originalFingerprint = snapshot.fingerprint

    data.pupils[0]!.photoReference =
      'schools/school-1/pupils/pupil-ada/photo/new.jpg'
    data.school.signatureObjectKey = 'schools/school-1/signature/new.png'
    data.school.signatureName = 'New Administrator'

    expect(snapshot.pupil.photoObjectKey).toBe(originalPhoto)
    expect(snapshot.document.signatureObjectKey).toBe(originalSignature)
    expect(snapshot.fingerprint).toBe(originalFingerprint)

    const regenerated = snapshotFor(data).snapshot!
    expect(regenerated.pupil.photoObjectKey).not.toBe(originalPhoto)
    expect(regenerated.fingerprint).not.toBe(originalFingerprint)
  })

  it('changes the fingerprint when authorized inputs change', () => {
    const first = snapshotFor(makeReportData()).snapshot!
    const changed = snapshotFor(
      makeReportData({
        pupils: [
          {
            ...DEFAULT_PUPILS[0]!,
            teacherRemarks: 'A different authorized remark.',
          },
        ],
      }),
    ).snapshot!

    expect(changed.fingerprint).not.toBe(first.fingerprint)
  })

  it('handles long pupil and subject names without dropping data', () => {
    const longName = 'Ama Serwaa Nkrumah-Adjei Boateng Mensah Owusu-Ansah'
    const subjects = [
      {
        id: 'sub-long',
        name: 'Religious and Moral Education, Citizenship and Social Studies',
        sortOrder: 0,
      },
    ]
    const built = buildReportSet(
      makeReportData({
        subjects,
        pupils: [
          {
            ...DEFAULT_PUPILS[0]!,
            firstName: longName,
            lastName: 'Agyeman',
            scores: { 'sub-long': '88.00' },
          },
        ],
      }),
    )

    expect(built.builds[0]!.snapshot!.pupil.fullName).toContain(longName)
    expect(built.builds[0]!.snapshot!.academic.subjects[0]!.name).toContain(
      'Citizenship',
    )
  })

  it('parses stored policy and grading snapshots defensively', () => {
    expect(parsePolicySnapshot({ components: [] })).toBeNull()
    expect(parseGradingSnapshot({ bands: [] })).toBeNull()
    expect(
      parsePolicySnapshot({
        id: 'p',
        name: 'Policy',
        version: 1,
        components: [
          {
            key: 'sba',
            name: 'SBA',
            category: 'SBA',
            maximumScore: '100.00',
            weightPercent: '100.00',
            sortOrder: 0,
          },
        ],
      }),
    ).not.toBeNull()
  })
})
