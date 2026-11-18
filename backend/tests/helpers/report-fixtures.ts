import type {
  ReportGenerationData,
  ReportInputRecord,
  ReportPupilRecord,
  ReportScoreRecord,
  ReportSettingsRecord,
  ReportSubjectRecord,
  ReportSubmissionRecord,
} from '../../src/reports/repository.js'

export const GRADING_BANDS = [
  { minScore: '80.00', maxScore: '100.00', gradeLabel: 'A', remark: 'Excellent', sortOrder: 0 },
  { minScore: '70.00', maxScore: '79.99', gradeLabel: 'B', remark: 'Very good', sortOrder: 1 },
  { minScore: '60.00', maxScore: '69.99', gradeLabel: 'C', remark: 'Good', sortOrder: 2 },
  { minScore: '50.00', maxScore: '59.99', gradeLabel: 'D', remark: 'Fair', sortOrder: 3 },
  { minScore: '40.00', maxScore: '49.99', gradeLabel: 'E', remark: 'Pass', sortOrder: 4 },
  { minScore: '0.00', maxScore: '39.99', gradeLabel: 'F', remark: 'Needs support', sortOrder: 5 },
] as const

export function gradingSnapshot() {
  return {
    id: 'scheme-1',
    name: 'School grading scale',
    bands: GRADING_BANDS.map((band) => ({ ...band })),
  }
}

export function policySnapshot(sbaWeight = '50.00', examWeight = '50.00') {
  return {
    id: 'policy-1',
    name: 'Term assessment policy',
    version: 3,
    calculationMode: 'COMPONENT_WEIGHTED' as const,
    isDefault: false,
    components: [
      {
        key: 'sba',
        name: 'Continuous assessment',
        category: 'SBA',
        maximumScore: '100.00',
        weightPercent: sbaWeight,
        sortOrder: 0,
      },
      {
        key: 'exam',
        name: 'End of term examination',
        category: 'EXAM',
        maximumScore: '100.00',
        weightPercent: examWeight,
        sortOrder: 1,
      },
    ],
  }
}

export function gradeFor(score: string): { gradeLabel: string; remark: string } {
  const value = Number(score)
  const band = GRADING_BANDS.find(
    (item) => value >= Number(item.minScore) && value <= Number(item.maxScore),
  )

  if (!band) {
    throw new Error(`No fixture grading band for ${score}`)
  }

  return { gradeLabel: band.gradeLabel, remark: band.remark }
}

export interface FixtureSubject {
  id: string
  name: string
  code?: string | null
  sortOrder?: number
  sbaWeight?: string
  examWeight?: string
}

export interface FixturePupil {
  id: string
  firstName: string
  lastName: string
  otherNames?: string | null
  admissionNumber: string
  scores: Record<string, string | null>
  daysOpened?: number | null
  daysAttended?: number | null
  teacherRemarks?: string | null
  attitude?: string | null
  photoReference?: string | null
  /** Enrollment timestamp; defaults to before any request in the fixtures. */
  enrolledAt?: Date
}

export const DEFAULT_SUBJECTS: FixtureSubject[] = [
  { id: 'sub-math', name: 'Mathematics', code: 'MATH', sortOrder: 0 },
  { id: 'sub-english', name: 'English Language', code: 'ENG', sortOrder: 1 },
  { id: 'sub-science', name: 'Integrated Science', code: 'SCI', sortOrder: 2 },
]

export const DEFAULT_PUPILS: FixturePupil[] = [
  {
    id: 'pupil-ada',
    firstName: 'Ada',
    lastName: 'Mensah',
    otherNames: 'Akosua',
    admissionNumber: 'GVA/2026/001',
    scores: { 'sub-math': '92.00', 'sub-english': '88.00', 'sub-science': '84.00' },
    daysOpened: 60,
    daysAttended: 58,
    teacherRemarks: 'A focused and consistent learner.',
    attitude: 'Respectful and cooperative.',
  },
  {
    id: 'pupil-kojo',
    firstName: 'Kojo',
    lastName: 'Boateng',
    admissionNumber: 'GVA/2026/002',
    scores: { 'sub-math': '80.00', 'sub-english': '80.00', 'sub-science': '80.00' },
    daysOpened: 60,
    daysAttended: 55,
    teacherRemarks: 'Steady progress this term.',
    attitude: 'Participates well in class.',
  },
  {
    id: 'pupil-esi',
    firstName: 'Esi',
    lastName: 'Owusu',
    admissionNumber: 'GVA/2026/003',
    scores: { 'sub-math': '70.00', 'sub-english': '60.00', 'sub-science': '50.00' },
    daysOpened: 60,
    daysAttended: 49,
    teacherRemarks: null,
    attitude: null,
  },
]

export interface ReportFixtureOptions {
  subjects?: FixtureSubject[]
  pupils?: FixturePupil[]
  settings?: Partial<ReportSettingsRecord> | null
  onRoll?: number
  schoolName?: string
  className?: string
  academicYearName?: string
  academicTermName?: string
  submissions?: ReportSubmissionRecord[]
}

export function makeReportData(
  options: ReportFixtureOptions = {},
): ReportGenerationData {
  const subjects = options.subjects ?? DEFAULT_SUBJECTS
  const pupils = options.pupils ?? DEFAULT_PUPILS
  const settings =
    options.settings === null
      ? null
      : {
          id: 'settings-1',
          schoolId: 'school-1',
          academicYearId: 'year-1',
          academicTermId: 'term-1',
          emblemObjectKey: 'schools/school-1/report-assets/emblem/emblem.png',
          crestObjectKey: null,
          signatureObjectKey:
            'schools/school-1/report-assets/signature/signature.png',
          headteacherLabel: 'SCHOOL ADMIN SIGNATURE',
          rankingEnabled: true,
          tiePolicy: 'COMPETITION' as const,
          aggregatePolicy: 'SUM_ALL_SUBJECTS' as const,
          attendanceRequired: true,
          closingDate: '2026-07-31',
          reopeningDate: '2026-09-15',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          ...options.settings,
        }

  const submissions: ReportSubmissionRecord[] =
    options.submissions ??
    subjects.map((subject) => ({
      subjectId: subject.id,
      status: 'ACCEPTED',
      policySnapshot: policySnapshot(
        subject.sbaWeight ?? '50.00',
        subject.examWeight ?? '50.00',
      ),
      gradingSnapshot: gradingSnapshot(),
      reviewedAt: new Date('2026-07-01T00:00:00.000Z'),
    }))

  const scores: ReportScoreRecord[] = []
  const inputs: ReportInputRecord[] = []

  pupils.forEach((pupil) => {
    subjects.forEach((subject) => {
      const value = pupil.scores[subject.id]

      if (value === undefined || value === null) {
        return
      }

      const grade = gradeFor(value)
      const sbaWeight = Number(subject.sbaWeight ?? '50')
      const examWeight = 100 - sbaWeight
      scores.push({
        pupilId: pupil.id,
        subjectId: subject.id,
        sbaContribution: ((Number(value) * sbaWeight) / 100).toFixed(2),
        examContribution: ((Number(value) * examWeight) / 100).toFixed(2),
        finalScore: value,
        gradeLabel: grade.gradeLabel,
        gradeRemark: grade.remark,
        policySnapshot: policySnapshot(
          subject.sbaWeight ?? '50.00',
          subject.examWeight ?? '50.00',
        ),
        gradingSnapshot: gradingSnapshot(),
      })
    })

    inputs.push({
      id: `input-${pupil.id}`,
      schoolId: 'school-1',
      academicYearId: 'year-1',
      academicTermId: 'term-1',
      classId: 'class-1',
      pupilId: pupil.id,
      daysOpened: pupil.daysOpened === undefined ? 60 : pupil.daysOpened,
      daysAttended: pupil.daysAttended === undefined ? 55 : pupil.daysAttended,
      teacherRemarks: pupil.teacherRemarks ?? null,
      attitude: pupil.attitude ?? null,
      closingDate: null,
      reopeningDate: null,
      updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    })
  })

  const reportPupils: ReportPupilRecord[] = pupils.map((pupil) => ({
    id: pupil.id,
    firstName: pupil.firstName,
    lastName: pupil.lastName,
    otherNames: pupil.otherNames ?? null,
    admissionNumber: pupil.admissionNumber,
    gender: null,
    photoReference: pupil.photoReference ?? null,
    status: 'ACTIVE',
    enrolledAt:
      pupil.enrolledAt ?? new Date('2025-09-01T00:00:00.000Z'),
  }))

  const reportSubjects: ReportSubjectRecord[] = subjects.map((subject) => ({
    id: subject.id,
    name: subject.name,
    code: subject.code ?? null,
    sortOrder: subject.sortOrder ?? 0,
  }))

  return {
    school: {
      id: 'school-1',
      name: options.schoolName ?? 'Green Valley Academy',
      slug: 'green-valley-academy',
      email: 'office@greenvalley.example',
      phone: '+233 24 000 0000',
      address: '12 Independence Avenue, Accra',
      landmark: 'Opposite the central market',
      timezone: 'Africa/Accra',
      logoObjectKey: 'schools/school-1/school-logo/logo.png',
      signatureObjectKey: null,
      signatureName: null,
      signatureDesignation: null,
    },
    academicYear: {
      id: 'year-1',
      name: options.academicYearName ?? '2025/2026',
      startsOn: '2025-09-01',
      endsOn: '2026-07-31',
    },
    academicTerm: {
      id: 'term-1',
      academicYearId: 'year-1',
      name: options.academicTermName ?? 'Term 3',
      sequence: 3,
      startsOn: '2026-04-20',
      endsOn: '2026-07-31',
    },
    class: {
      id: 'class-1',
      name: options.className ?? 'Basic 6',
      level: 'Primary 6',
    },
    settings,
    subjects: reportSubjects,
    pupils: reportPupils,
    inputs,
    submissions,
    scores,
    onRoll: options.onRoll ?? pupils.length,
  }
}
