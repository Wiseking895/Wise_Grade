import {
  centiToNumber,
  decimalToCenti,
  findGradeBand,
  type GradeBandDefinition,
} from '../assessment/calculation.js'
import {
  EARLY_YEARS_SCALE,
  earlyYearsPerformance,
  isEarlyYearsClass,
} from '../assessment/early-years.js'
import type {
  ReportGenerationData,
  ReportInputRecord,
  ReportPupilRecord,
  ReportScoreRecord,
  ReportSettingsRecord,
  ReportSubjectRecord,
  ReportTiePolicy,
} from './repository.js'
import {
  averageCenti,
  rankClassPositions,
  rankSubjectScores,
} from './ranking.js'

export const DRAFT_LABEL = 'INTERNAL DRAFT — NOT RELEASED'
export const SNAPSHOT_SCHEMA_VERSION = 2

export interface ReportPolicyComponent {
  key: string
  name: string
  category: 'SBA' | 'EXAM'
  maximumScore: string
  weightPercent: string
  sortOrder: number
}

export type ReportCalculationMode =
  | 'COMPONENT_WEIGHTED'
  | 'GROUPED_SBA'
  | null

export interface ReportPolicySnapshot {
  id: string | null
  name: string | null
  version: number | null
  /** Explicit calculation mode stored with the accepted result. */
  calculationMode: ReportCalculationMode
  /** True when the snapshot came from the system standard policy. */
  isDefault: boolean
  components: ReportPolicyComponent[]
}

export interface ReportGradingBand extends GradeBandDefinition {
  sortOrder: number
}

export interface ReportGradingSnapshot {
  id: string | null
  name: string | null
  bands: ReportGradingBand[]
}

export interface SubjectWeightSummary {
  sba: string
  exam: string
  total: '100.00'
}

export interface SnapshotSubjectRow {
  subjectId: string
  name: string
  code: string | null
  classScore: string | null
  examScore: string | null
  totalScore: string | null
  subjectPosition: number | null
  /** Null for early-years subjects: no conventional letter grade is shown. */
  grade: string | null
  /** For early years this is "Gold (G)", "Silver (S)" or "Bronze (B)". */
  remark: string | null
  weights: SubjectWeightSummary
  policyId: string | null
  policyName: string | null
  policyVersion: number | null
  calculationMode: ReportCalculationMode
  policyIsDefault: boolean
  gradingSchemeId: string | null
  gradingSchemeName: string | null
}

export interface ReportSnapshot {
  schemaVersion: number
  draft: true
  draftLabel: string
  fingerprint: string
  generatedAt: string
  reportCardId: string | null
  version: number
  school: {
    id: string
    name: string
    address: string | null
    landmark: string | null
    phone: string | null
    email: string | null
    timezone: string
    logoObjectKey: string | null
    emblemObjectKey: string | null
    crestObjectKey: string | null
  }
  pupil: {
    id: string
    fullName: string
    firstName: string
    lastName: string
    otherNames: string | null
    admissionNumber: string
    gender: string | null
    photoObjectKey: string | null
  }
  class: { id: string; name: string; level: string | null }
  academicYear: { id: string; name: string }
  academicTerm: { id: string; name: string; sequence: number }
  document: {
    closingDate: string | null
    reopeningDate: string | null
    headteacherLabel: string
    signatureObjectKey: string | null
    /** Printed name captured with the signature at generation time. */
    signatureName?: string | null
    /** Designation captured with the signature at generation time. */
    signatureDesignation?: string | null
    numberOnRoll: number
    classPosition: number | null
    classPositionDisplay: string
  }
  attendance: {
    daysOpened: number | null
    daysAttended: number | null
    display: string
    complete: boolean
  }
  academic: {
    subjects: SnapshotSubjectRow[]
    subjectCount: number
    /** True when this class uses the fixed early-years performance scale. */
    earlyYears: boolean
    sbaWeight: string
    examWeight: string
    calculationMode: ReportCalculationMode | 'MIXED'
    mixedSubjectWeights: boolean
    aggregate: { policy: string; value: string | null; display: string }
    average: string | null
    total: string | null
    examTotal: string | null
    grading: ReportGradingSnapshot
  }
  remarks: {
    teacher: string | null
    attitude: string | null
  }
  ranking: {
    enabled: boolean
    tiePolicy: ReportTiePolicy
    classPosition: number | null
    numberOnRoll: number
    note: string | null
  }
  source: {
    acceptedSubmissions: number
    policyVersions: Array<{
      subjectId: string
      policyId: string | null
      policyVersion: number | null
    }>
    gradingSchemeIds: string[]
    attendanceInputId: string | null
  }
}

export interface EligibilityFailure {
  code: string
  message: string
}

export interface PupilReportBuild {
  pupil: ReportPupilRecord
  eligible: boolean
  failure: EligibilityFailure | null
  fingerprint: string
  snapshot: ReportSnapshot | null
}

export interface BuiltReportSet {
  settings: ReportSettingsRecord
  subjects: ReportSubjectRecord[]
  builds: PupilReportBuild[]
  eligibleCount: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decimalString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toFixed(2)
  }

  if (typeof value === 'string') {
    const centi = decimalToCenti(value)
    return centi === null ? null : centiToNumber(centi).toFixed(2)
  }

  return null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

export function parsePolicySnapshot(value: unknown): ReportPolicySnapshot | null {
  if (!isRecord(value) || !Array.isArray(value.components)) {
    return null
  }

  const components: ReportPolicyComponent[] = []

  for (const component of value.components) {
    if (!isRecord(component)) {
      return null
    }

    const key = text(component.key)
    const name = text(component.name)
    const category = component.category
    const maximumScore = decimalString(component.maximumScore)
    const weightPercent = decimalString(component.weightPercent)

    if (
      !key ||
      !name ||
      (category !== 'SBA' && category !== 'EXAM') ||
      !maximumScore ||
      !weightPercent
    ) {
      return null
    }

    components.push({
      key,
      name,
      category,
      maximumScore,
      weightPercent,
      sortOrder:
        typeof component.sortOrder === 'number' ? component.sortOrder : 0,
    })
  }

  if (components.length === 0) {
    return null
  }

  const mode = value.calculationMode

  return {
    id: text(value.id),
    name: text(value.name),
    version: typeof value.version === 'number' ? value.version : null,
    calculationMode:
      mode === 'COMPONENT_WEIGHTED' || mode === 'GROUPED_SBA' ? mode : null,
    isDefault: value.isDefault === true,
    components: components.sort((a, b) => a.sortOrder - b.sortOrder),
  }
}

export function parseGradingSnapshot(
  value: unknown,
): ReportGradingSnapshot | null {
  if (!isRecord(value) || !Array.isArray(value.bands)) {
    return null
  }

  const bands: ReportGradingBand[] = []

  for (const band of value.bands) {
    if (!isRecord(band)) {
      return null
    }

    const minScore = decimalString(band.minScore)
    const maxScore = decimalString(band.maxScore)
    const gradeLabel = text(band.gradeLabel)
    const remark = text(band.remark)

    if (!minScore || !maxScore || !gradeLabel || !remark) {
      return null
    }

    bands.push({
      minScore,
      maxScore,
      gradeLabel,
      remark,
      sortOrder: typeof band.sortOrder === 'number' ? band.sortOrder : 0,
    })
  }

  if (bands.length === 0) {
    return null
  }

  bands.sort((a, b) => a.sortOrder - b.sortOrder)

  return {
    id: text(value.id),
    name: text(value.name),
    bands,
  }
}

export function subjectWeights(
  policy: ReportPolicySnapshot,
): SubjectWeightSummary | null {
  let sba = 0
  let exam = 0

  for (const component of policy.components) {
    const weight = decimalToCenti(component.weightPercent)

    if (weight === null || weight <= 0) {
      return null
    }

    if (component.category === 'SBA') {
      sba += weight
    } else {
      exam += weight
    }
  }

  if (sba + exam !== 10_000) {
    return null
  }

  return {
    sba: centiToNumber(sba).toFixed(2),
    exam: centiToNumber(exam).toFixed(2),
    total: '100.00',
  }
}

function defaultSettings(data: ReportGenerationData): ReportSettingsRecord {
  return {
    id: 'defaults',
    schoolId: data.school.id,
    academicYearId: data.academicYear.id,
    academicTermId: data.academicTerm.id,
    emblemObjectKey: null,
    crestObjectKey: null,
    signatureObjectKey: null,
    headteacherLabel: 'SCHOOL ADMIN SIGNATURE',
    rankingEnabled: true,
    tiePolicy: 'COMPETITION',
    aggregatePolicy: 'NONE',
    attendanceRequired: true,
    closingDate: null,
    reopeningDate: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  }
}

export function effectiveSettings(
  data: ReportGenerationData,
): ReportSettingsRecord {
  return data.settings ?? defaultSettings(data)
}

function fullName(pupil: ReportPupilRecord): string {
  return [pupil.firstName, pupil.lastName, pupil.otherNames]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function dateString(value: string | null | undefined): string | null {
  return value && value.trim() !== '' ? value : null
}

function attendanceFailure(
  input: ReportInputRecord | undefined,
  required: boolean,
): EligibilityFailure | null {
  if (!input || input.daysOpened === null || input.daysAttended === null) {
    if (!required) {
      return null
    }

    return {
      code: 'ATTENDANCE_MISSING',
      message: 'School days opened and days attended are required before generation.',
    }
  }

  if (input.daysOpened <= 0) {
    return {
      code: 'ATTENDANCE_INVALID',
      message: 'School days opened must be greater than zero.',
    }
  }

  if (input.daysAttended < 0 || input.daysAttended > input.daysOpened) {
    return {
      code: 'ATTENDANCE_INVALID',
      message: 'Days attended must be between zero and school days opened.',
    }
  }

  return null
}

interface PreparedSubject {
  subject: ReportSubjectRecord
  submission: {
    policy: ReportPolicySnapshot
    grading: ReportGradingSnapshot
    weights: SubjectWeightSummary
  } | null
  failure: EligibilityFailure | null
}

interface PreparedScore {
  score: ReportScoreRecord
  centi: number
  band: ReportGradingBand
  policy: ReportPolicySnapshot
  grading: ReportGradingSnapshot
}

/**
 * Resolves the fixed early-years descriptor for an accepted subject. Newly
 * accepted results store the symbol computed from the unrounded final score;
 * legacy results without a stored G/S/B symbol fall back to the stored final.
 *
 * The stored symbol is only trusted together with its matching descriptor, so
 * a legacy conventional grade such as "B" (which shares the Bronze symbol) is
 * never mistaken for an early-years classification.
 */
function earlyYearsBand(
  storedLabel: string | null,
  storedRemark: string | null,
  finalScore: string,
): ReportGradingBand | null {
  const symbol = storedLabel?.trim().toUpperCase()
  const remark = storedRemark?.trim().toLowerCase()
  const stored = EARLY_YEARS_SCALE.find(
    (band) =>
      band.gradeLabel === symbol && band.remark.toLowerCase() === remark,
  )

  if (stored) {
    return { ...stored }
  }

  const performance = earlyYearsPerformance(finalScore)

  if (!performance) {
    return null
  }

  const band = EARLY_YEARS_SCALE.find(
    (item) => item.gradeLabel === performance.symbol,
  )

  return band ? { ...band } : null
}

function fingerprintFor(
  data: ReportGenerationData,
  settings: ReportSettingsRecord,
  pupil: ReportPupilRecord,
  subjectRows: SnapshotSubjectRow[],
  input: ReportInputRecord | undefined,
  classPosition: number | null,
): string {
  return JSON.stringify({
    school: data.school.id,
    schoolIdentity: {
      name: data.school.name,
      landmark: data.school.landmark,
      address: data.school.address,
      phone: data.school.phone,
      logo: data.school.logoObjectKey,
      signature: data.school.signatureObjectKey,
      signatureName: data.school.signatureName,
      signatureDesignation: data.school.signatureDesignation,
    },
    year: data.academicYear.id,
    term: data.academicTerm.id,
    class: data.class.id,
    pupil: pupil.id,
    name: fullName(pupil),
    admissionNumber: pupil.admissionNumber,
    photo: pupil.photoReference,
    settings: {
      headteacherLabel: settings.headteacherLabel,
      rankingEnabled: settings.rankingEnabled,
      tiePolicy: settings.tiePolicy,
      aggregatePolicy: settings.aggregatePolicy,
      attendanceRequired: settings.attendanceRequired,
      closingDate: settings.closingDate,
      reopeningDate: settings.reopeningDate,
      emblem: settings.emblemObjectKey,
      crest: settings.crestObjectKey,
      signature: settings.signatureObjectKey,
    },
    input: input
      ? {
          daysOpened: input.daysOpened,
          daysAttended: input.daysAttended,
          teacherRemarks: input.teacherRemarks,
          attitude: input.attitude,
          closingDate: input.closingDate,
          reopeningDate: input.reopeningDate,
        }
      : null,
    subjects: subjectRows.map((row) => ({
      id: row.subjectId,
      name: row.name,
      classScore: row.classScore,
      examScore: row.examScore,
      totalScore: row.totalScore,
      position: row.subjectPosition,
      grade: row.grade,
      remark: row.remark,
      weights: row.weights,
      policyId: row.policyId,
      policyVersion: row.policyVersion,
      calculationMode: row.calculationMode,
      policyIsDefault: row.policyIsDefault,
      gradingSchemeId: row.gradingSchemeId,
    })),
    earlyYears: isEarlyYearsClass(data.class),
    classPosition,
    onRoll: data.onRoll,
  })
}

/**
 * Builds eligibility, ranking and immutable snapshots for every pupil in the
 * class. Nothing is invented: a pupil without every accepted subject result or
 * required attendance is returned with a failure instead of a snapshot.
 */
export function buildReportSet(data: ReportGenerationData): BuiltReportSet {
  const settings = effectiveSettings(data)
  const earlyYears = isEarlyYearsClass(data.class)
  const subjects = [...data.subjects].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  )
  const submissionsBySubject = new Map(
    data.submissions.map((submission) => [submission.subjectId, submission]),
  )

  const preparedSubjects: PreparedSubject[] = subjects.map((subject) => {
    const submission = submissionsBySubject.get(subject.id)

    if (!submission) {
      return {
        subject,
        submission: null,
        failure: {
          code: 'RESULT_NOT_ACCEPTED',
          message: `${subject.name} has no result submission for this term.`,
        },
      }
    }

    if (submission.status !== 'ACCEPTED') {
      return {
        subject,
        submission: null,
        failure: {
          code: 'RESULT_NOT_ACCEPTED',
          message: `${subject.name} results are ${submission.status.toLowerCase().replaceAll('_', ' ')}; only accepted results can be reported.`,
        },
      }
    }

    const policy = parsePolicySnapshot(submission.policySnapshot)
    const grading = parseGradingSnapshot(submission.gradingSnapshot)

    if (!policy || !grading) {
      return {
        subject,
        submission: null,
        failure: {
          code: 'SNAPSHOT_MISSING',
          message: `${subject.name} is missing its stored policy or grading snapshot.`,
        },
      }
    }

    const weights = subjectWeights(policy)

    if (!weights) {
      return {
        subject,
        submission: null,
        failure: {
          code: 'SNAPSHOT_INVALID',
          message: `${subject.name} has an invalid stored weighting snapshot.`,
        },
      }
    }

    return { subject, submission: { policy, grading, weights }, failure: null }
  })

  const subjectFailures = preparedSubjects
    .map((item) => item.failure)
    .filter((failure): failure is EligibilityFailure => failure !== null)

  const gradingSchemeIds = [
    ...new Set(
      preparedSubjects
        .map((item) => item.submission?.grading.id)
        .filter((id): id is string => Boolean(id)),
    ),
  ]

  const mixedGrading =
    gradingSchemeIds.length > 1
      ? {
          code: 'MIXED_GRADING_SCHEMES',
          message:
            'Accepted subjects reference more than one grading scheme, so a single grading scale cannot be printed.',
        }
      : null

  const scoresByPupil = new Map<string, Map<string, ReportScoreRecord>>()

  for (const score of data.scores) {
    let map = scoresByPupil.get(score.pupilId)

    if (!map) {
      map = new Map()
      scoresByPupil.set(score.pupilId, map)
    }

    map.set(score.subjectId, score)
  }

  const inputsByPupil = new Map(
    data.inputs.map((input) => [input.pupilId, input]),
  )

  const scoreCentiBySubject = new Map<string, Map<string, number>>()
  const preparedByPupil = new Map<
    string,
    {
      prepared: Map<string, PreparedScore>
      failures: EligibilityFailure[]
      totalCenti: number
    }
  >()

  for (const pupil of data.pupils) {
    const scoreMap = scoresByPupil.get(pupil.id) ?? new Map()
    const prepared = new Map<string, PreparedScore>()
    const failures: EligibilityFailure[] = [...subjectFailures]

    if (mixedGrading) {
      failures.push(mixedGrading)
    }

    for (const item of preparedSubjects) {
      if (!item.submission || item.failure) {
        continue
      }

      const score = scoreMap.get(item.subject.id)

      if (!score || score.finalScore === null) {
        failures.push({
          code: 'RESULT_MISSING',
          message: `${pupil.firstName} ${pupil.lastName} has no complete accepted score for ${item.subject.name}.`,
        })
        continue
      }

      const centi = decimalToCenti(score.finalScore)

      if (centi === null) {
        failures.push({
          code: 'SCORE_INVALID',
          message: `${item.subject.name} has a non-numeric accepted score.`,
        })
        continue
      }

      const grading = parseGradingSnapshot(score.gradingSnapshot) ?? item.submission.grading
      const policy = parsePolicySnapshot(score.policySnapshot) ?? item.submission.policy
      const band = earlyYears
        ? earlyYearsBand(score.gradeLabel, score.gradeRemark, score.finalScore)
        : findGradeBand(grading.bands, score.finalScore)

      if (!band) {
        failures.push({
          code: earlyYears
            ? 'EARLY_YEARS_CLASSIFICATION_MISSING'
            : 'GRADE_NOT_FOUND',
          message: earlyYears
            ? `${item.subject.name} has no early-years performance classification.`
            : `${item.subject.name} score does not fall inside the stored grading scale.`,
        })
        continue
      }

      if (
        !earlyYears &&
        score.gradeLabel &&
        score.gradeLabel !== band.gradeLabel
      ) {
        failures.push({
          code: 'GRADE_SNAPSHOT_MISMATCH',
          message: `${item.subject.name} stored grade ${score.gradeLabel} does not match the stored grading scale (${band.gradeLabel}).`,
        })
        continue
      }

      prepared.set(item.subject.id, {
        score,
        centi,
        band: {
          ...band,
          sortOrder:
            'sortOrder' in band && typeof band.sortOrder === 'number'
              ? band.sortOrder
              : 0,
        },
        policy,
        grading,
      })

      let subjectMap = scoreCentiBySubject.get(item.subject.id)

      if (!subjectMap) {
        subjectMap = new Map()
        scoreCentiBySubject.set(item.subject.id, subjectMap)
      }

      subjectMap.set(pupil.id, centi)
    }

    const attendance = attendanceFailure(
      inputsByPupil.get(pupil.id),
      settings.attendanceRequired,
    )

    if (attendance) {
      failures.push(attendance)
    }

    const totalCenti = [...prepared.values()].reduce(
      (sum, item) => sum + item.centi,
      0,
    )

    preparedByPupil.set(pupil.id, {
      prepared,
      failures,
      totalCenti,
    })
  }

  const classRankCandidates = data.pupils
    .map((pupil) => {
      const entry = preparedByPupil.get(pupil.id)
      const eligible =
        entry &&
        entry.failures.length === 0 &&
        entry.prepared.size === preparedSubjects.length &&
        preparedSubjects.length > 0

      if (!eligible || !entry) {
        return null
      }

      return {
        pupilId: pupil.id,
        name: fullName(pupil),
        totalCenti: entry.totalCenti,
        subjectCount: entry.prepared.size,
      }
    })
    .filter(
      (item): item is NonNullable<typeof item> => item !== null,
    )

  const classRanks = settings.rankingEnabled
    ? new Map(
        rankClassPositions(classRankCandidates, settings.tiePolicy).map(
          (item) => [item.pupilId, item.rank],
        ),
      )
    : new Map<string, number>()

  const subjectRanks = new Map<string, Map<string, number>>()

  if (settings.rankingEnabled) {
    for (const item of preparedSubjects) {
      if (!item.submission || item.failure) {
        continue
      }

      const centiMap = scoreCentiBySubject.get(item.subject.id) ?? new Map()
      const entries = data.pupils.map((pupil) => ({
        pupilId: pupil.id,
        name: fullName(pupil),
        score:
          centiMap.get(pupil.id) === undefined
            ? null
            : centiToNumber(centiMap.get(pupil.id)!).toFixed(2),
      }))

      subjectRanks.set(
        item.subject.id,
        new Map(
          rankSubjectScores(entries, settings.tiePolicy).map((rank) => [
            rank.pupilId,
            rank.rank,
          ]),
        ),
      )
    }
  }

  const grading = preparedSubjects[0]?.submission?.grading ?? null
  const builds: PupilReportBuild[] = data.pupils.map((pupil) => {
    const entry = preparedByPupil.get(pupil.id)!
    const failures = entry.failures
    const eligible =
      failures.length === 0 &&
      entry.prepared.size === preparedSubjects.length &&
      preparedSubjects.length > 0

    if (!eligible || !grading) {
      const first = failures[0] ?? {
        code: 'RESULTS_INCOMPLETE',
        message: 'The report cannot be generated because results are incomplete.',
      }

      return {
        pupil,
        eligible: false,
        failure: first,
        fingerprint: '',
        snapshot: null,
      }
    }

    const subjectRows: SnapshotSubjectRow[] = preparedSubjects.map((item) => {
      const prepared = entry.prepared.get(item.subject.id)!
      const policy = prepared.policy
      const gradingSnapshot = prepared.grading

      return {
        subjectId: item.subject.id,
        name: item.subject.name,
        code: item.subject.code,
        classScore:
          prepared.score.sbaContribution === null
            ? null
            : decimalString(prepared.score.sbaContribution),
        examScore:
          prepared.score.examContribution === null
            ? null
            : decimalString(prepared.score.examContribution),
        totalScore: decimalString(prepared.score.finalScore),
        subjectPosition:
          subjectRanks.get(item.subject.id)?.get(pupil.id) ?? null,
        grade: earlyYears ? null : prepared.band.gradeLabel,
        remark: earlyYears
          ? `${prepared.band.remark} (${prepared.band.gradeLabel})`
          : prepared.band.remark,
        weights: item.submission!.weights,
        policyId: policy.id,
        policyName: policy.name,
        policyVersion: policy.version,
        calculationMode: policy.calculationMode,
        policyIsDefault: policy.isDefault,
        gradingSchemeId: earlyYears ? null : gradingSnapshot.id,
        gradingSchemeName: earlyYears
          ? 'Early Years Performance Scale'
          : gradingSnapshot.name,
      }
    })

    const totals = subjectRows
      .map((row) => row.totalScore)
      .filter((value): value is string => value !== null)
      .map((value) => decimalToCenti(value)!)
    const totalCenti = totals.reduce((sum, value) => sum + value, 0)
    const average = averageCenti(totalCenti, totals.length)
    const examTotals = subjectRows
      .map((row) => row.examScore)
      .filter((value): value is string => value !== null)
      .map((value) => decimalToCenti(value)!)
    const examTotalCenti = examTotals.reduce((sum, value) => sum + value, 0)
    const bestSix = [...totals].sort((a, b) => b - a).slice(0, 6)
    const bestSixTotal = bestSix.reduce((sum, value) => sum + value, 0)
    const bestSixAverage = averageCenti(bestSixTotal, bestSix.length)

    let aggregateValue: string | null = null

    switch (settings.aggregatePolicy) {
      case 'SUM_ALL_SUBJECTS':
        aggregateValue = centiToNumber(totalCenti).toFixed(2)
        break
      case 'BEST_SIX_TOTAL':
        aggregateValue = centiToNumber(bestSixTotal).toFixed(2)
        break
      case 'BEST_SIX_AVERAGE':
        aggregateValue = centiToNumber(bestSixAverage).toFixed(2)
        break
      case 'NONE':
        aggregateValue = null
        break
    }

    const input = inputsByPupil.get(pupil.id)
    const attendanceDisplay =
      input && input.daysOpened !== null && input.daysAttended !== null
        ? `${input.daysAttended}/${input.daysOpened}`
        : 'N/A'
    const classPosition = classRanks.get(pupil.id) ?? null
    const fingerprint = fingerprintFor(
      data,
      settings,
      pupil,
      subjectRows,
      input,
      classPosition,
    )

    const sbaWeights = new Set(subjectRows.map((row) => row.weights.sba))
    const examWeights = new Set(subjectRows.map((row) => row.weights.exam))
    const calculationModes = new Set(
      subjectRows.map((row) => row.calculationMode),
    )
    const distinctGradingIds = new Set(
      subjectRows.map((row) => row.gradingSchemeId),
    )

    return {
      pupil,
      eligible: true,
      failure: null,
      fingerprint,
      snapshot: {
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        draft: true,
        draftLabel: DRAFT_LABEL,
        fingerprint,
        generatedAt: new Date().toISOString(),
        reportCardId: null,
        version: 0,
        school: {
          id: data.school.id,
          name: data.school.name,
          address: data.school.address,
          landmark: data.school.landmark,
          phone: data.school.phone,
          email: data.school.email,
          timezone: data.school.timezone,
          logoObjectKey: data.school.logoObjectKey,
          emblemObjectKey: settings.emblemObjectKey,
          crestObjectKey: settings.crestObjectKey,
        },
        pupil: {
          id: pupil.id,
          fullName: fullName(pupil),
          firstName: pupil.firstName,
          lastName: pupil.lastName,
          otherNames: pupil.otherNames,
          admissionNumber: pupil.admissionNumber,
          gender: pupil.gender,
          photoObjectKey: pupil.photoReference,
        },
        class: {
          id: data.class.id,
          name: data.class.name,
          level: data.class.level,
        },
        academicYear: {
          id: data.academicYear.id,
          name: data.academicYear.name,
        },
        academicTerm: {
          id: data.academicTerm.id,
          name: data.academicTerm.name,
          sequence: data.academicTerm.sequence,
        },
        document: {
          closingDate: dateString(input?.closingDate ?? settings.closingDate),
          reopeningDate: dateString(
            input?.reopeningDate ?? settings.reopeningDate,
          ),
          headteacherLabel: settings.headteacherLabel,
          signatureObjectKey:
            data.school.signatureObjectKey ?? settings.signatureObjectKey,
          signatureName: data.school.signatureName,
          signatureDesignation: data.school.signatureDesignation,
          numberOnRoll: data.onRoll,
          classPosition,
          classPositionDisplay:
            !settings.rankingEnabled || classPosition === null
              ? 'N/A'
              : String(classPosition),
        },
        attendance: {
          daysOpened: input?.daysOpened ?? null,
          daysAttended: input?.daysAttended ?? null,
          display: attendanceDisplay,
          complete:
            input !== undefined &&
            input.daysOpened !== null &&
            input.daysAttended !== null,
        },
        academic: {
          subjects: subjectRows,
          subjectCount: subjectRows.length,
          earlyYears,
          sbaWeight:
            sbaWeights.size === 1 ? [...sbaWeights][0]! : 'MIXED',
          examWeight:
            examWeights.size === 1 ? [...examWeights][0]! : 'MIXED',
          calculationMode:
            calculationModes.size === 1
              ? [...calculationModes][0]!
              : 'MIXED',
          mixedSubjectWeights: sbaWeights.size > 1 || examWeights.size > 1,
          aggregate: {
            policy: settings.aggregatePolicy,
            value: aggregateValue,
            display: aggregateValue ?? 'N/A',
          },
          average:
            totals.length > 0 ? centiToNumber(average).toFixed(2) : null,
          total:
            totals.length > 0 ? centiToNumber(totalCenti).toFixed(2) : null,
          examTotal:
            examTotals.length > 0
              ? centiToNumber(examTotalCenti).toFixed(2)
              : null,
          grading: earlyYears
            ? {
                id: null,
                name: 'Early Years Performance Scale',
                bands: EARLY_YEARS_SCALE.map((band) => ({ ...band })),
              }
            : {
                id: distinctGradingIds.size === 1 ? grading.id : null,
                name:
                  distinctGradingIds.size === 1
                    ? grading.name
                    : 'Mixed grading schemes',
                bands: grading.bands,
              },
        },
        remarks: {
          teacher: text(input?.teacherRemarks),
          attitude: text(input?.attitude),
        },
        ranking: {
          enabled: settings.rankingEnabled,
          tiePolicy: settings.tiePolicy,
          classPosition,
          numberOnRoll: data.onRoll,
          note: settings.rankingEnabled
            ? null
            : 'Ranking is disabled for this school and term.',
        },
        source: {
          acceptedSubmissions: preparedSubjects.filter(
            (item) => item.submission !== null,
          ).length,
          policyVersions: preparedSubjects.map((item) => ({
            subjectId: item.subject.id,
            policyId: item.submission?.policy.id ?? null,
            policyVersion: item.submission?.policy.version ?? null,
          })),
          gradingSchemeIds: [...distinctGradingIds].filter(
            (id): id is string => Boolean(id),
          ),
          attendanceInputId: input?.id ?? null,
        },
      },
    }
  })

  return {
    settings,
    subjects,
    builds,
    eligibleCount: builds.filter((build) => build.eligible).length,
  }
}
