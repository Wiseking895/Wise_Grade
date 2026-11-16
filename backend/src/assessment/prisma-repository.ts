import { HttpError } from '../errors/http-error.js'
import { getPrismaClient } from '../lib/prisma.js'
import type { Prisma } from '../generated/prisma/client.js'
import { isUniqueConstraintError } from '../auth/prisma-repository.js'
import {
  calculatePupilResult,
  centiToDecimalString,
  findGradeBand,
  validateComponents,
  validateGradeBands,
  type ComponentDefinition,
  type GradeBandDefinition,
} from './calculation.js'
import {
  EXAMPLE_GRADE_BANDS,
  STANDARD_ASSESSMENT_COMPONENTS,
  STANDARD_GRADING_SCHEME_DESCRIPTION,
  STANDARD_GRADING_SCHEME_NAME,
  STANDARD_POLICY_DESCRIPTION,
  STANDARD_POLICY_NAME,
} from './defaults.js'
import {
  earlyYearsPerformance,
  isEarlyYearsClass,
} from './early-years.js'
import { rankRegisterSubjectPositions } from './positions.js'
import {
  canReviewSubmission,
  isScoreEntryAuthorized,
  reviewTransition,
  submissionEditBlockReason,
} from './rules.js'
import type { ReportTiePolicy } from '../reports/repository.js'
import type {
  AssessmentActor,
  AssessmentAuditContext,
  AssessmentComponentInput,
  AssessmentComponentRecord,
  AssessmentPolicyInput,
  AssessmentPolicyRecord,
  AssessmentPolicyUpdateInput,
  AssessmentRepository,
  AuthorizedClassSubject,
  ClassTeacherPermissionRecord,
  GradeBandInput,
  GradingSchemeRecord,
  PupilScoreInput,
  ResultAuditRecord,
  ResultReviewInput,
  ResultReviewRecord,
  ResultSubmissionRecord,
  SaveDraftInput,
  ScoreEntryPupil,
  ScoreEntryView,
  SubjectPositionStatus,
  SubjectTiePolicy,
} from './repository.js'

type Tx = Prisma.TransactionClient

type DecimalLike = { toString(): string }

function decimalString(value: DecimalLike | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null
  }

  const numeric = Number(value.toString())
  return Number.isFinite(numeric) ? numeric.toFixed(2) : value.toString()
}

function decimalNumber(value: DecimalLike | null | undefined): number | null {
  const text = decimalString(value)
  return text === null ? null : Number(text)
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function normalizeLevel(level: string | null | undefined): string | null {
  const normalized = level?.trim().toLowerCase()
  return normalized ? normalized : null
}

function policyScopeKey(
  classId: string | null | undefined,
  level: string | null | undefined,
): string {
  if (classId) {
    return `class:${classId}`
  }

  const normalizedLevel = normalizeLevel(level)
  return normalizedLevel ? `level:${normalizedLevel}` : 'term'
}

function componentDefinitions(
  components: ReadonlyArray<AssessmentComponentRecord | AssessmentComponentInput>,
): ComponentDefinition[] {
  return components.map((component) => ({
    id: 'id' in component ? component.id : component.key,
    key: component.key,
    name: component.name,
    category: component.category,
    maximumScore: component.maximumScore,
    weightPercent: component.weightPercent,
    sortOrder: component.sortOrder,
  }))
}

const policyInclude = {
  components: { orderBy: { sortOrder: 'asc' } },
  gradingScheme: {
    include: { bands: { orderBy: { sortOrder: 'asc' } } },
  },
} satisfies Prisma.AssessmentPolicyInclude

type PolicyRow = Prisma.AssessmentPolicyGetPayload<{
  include: typeof policyInclude
}>

const schemeInclude = {
  bands: { orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.GradingSchemeInclude

type SchemeRow = Prisma.GradingSchemeGetPayload<{
  include: typeof schemeInclude
}>

const submissionInclude = {
  class: { select: { name: true } },
  subject: { select: { name: true } },
  createdBy: {
    include: { user: { select: { firstName: true, lastName: true } } },
  },
  createdByAssignment: {
    select: { firstName: true, lastName: true },
  },
  reviewer: {
    include: { user: { select: { firstName: true, lastName: true } } },
  },
  scores: { select: { finalScore: true } },
} satisfies Prisma.ResultSubmissionInclude

type SubmissionRow = Prisma.ResultSubmissionGetPayload<{
  include: typeof submissionInclude
}>

function mapScheme(row: SchemeRow): GradingSchemeRecord {
  return {
    id: row.id,
    schoolId: row.schoolId,
    academicYearId: row.academicYearId,
    academicTermId: row.academicTermId,
    name: row.name,
    description: row.description,
    isActive: row.isActive,
    bands: row.bands.map((band) => ({
      id: band.id,
      schoolId: band.schoolId,
      gradingSchemeId: band.gradingSchemeId,
      minScore: decimalString(band.minScore) ?? '0',
      maxScore: decimalString(band.maxScore) ?? '0',
      gradeLabel: band.gradeLabel,
      remark: band.remark,
      sortOrder: band.sortOrder,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function mapComponent(
  component: PolicyRow['components'][number],
): AssessmentComponentRecord {
  return {
    id: component.id,
    schoolId: component.schoolId,
    policyId: component.policyId,
    key: component.key,
    name: component.name,
    category: component.category,
    maximumScore: decimalString(component.maximumScore) ?? '0',
    weightPercent: decimalString(component.weightPercent) ?? '0',
    sortOrder: component.sortOrder,
  }
}

function mapPolicy(row: PolicyRow): AssessmentPolicyRecord {
  return {
    id: row.id,
    schoolId: row.schoolId,
    academicYearId: row.academicYearId,
    academicTermId: row.academicTermId,
    classId: row.classId,
    level: row.level,
    gradingSchemeId: row.gradingSchemeId,
    name: row.name,
    description: row.description,
    scopeKey: row.scopeKey,
    version: row.version,
    isActive: row.isActive,
    isDefault: row.isDefault,
    calculationMode: row.calculationMode,
    components: row.components.map(mapComponent),
    gradingScheme: mapScheme(row.gradingScheme),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function mapSubmission(row: SubmissionRow): ResultSubmissionRecord {
  const creator = row.createdBy?.user
  const assignmentCreator = row.createdByAssignment
  const reviewer = row.reviewer?.user

  return {
    id: row.id,
    schoolId: row.schoolId,
    academicYearId: row.academicYearId,
    academicTermId: row.academicTermId,
    classId: row.classId,
    className: row.class.name,
    subjectId: row.subjectId,
    subjectName: row.subject.name,
    status: row.status,
    version: row.version,
    createdByMembershipId: row.createdByMembershipId,
    createdByAssignmentId: row.createdByAssignmentId,
    createdByName: creator
      ? `${creator.firstName} ${creator.lastName}`.trim()
      : assignmentCreator
        ? `${assignmentCreator.firstName} ${assignmentCreator.lastName}`.trim()
        : 'Unknown',
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt,
    reviewerMembershipId: row.reviewerMembershipId,
    reviewerName: reviewer
      ? `${reviewer.firstName} ${reviewer.lastName}`.trim()
      : null,
    lastComment: row.lastComment,
    pupilCount: row.scores.length,
    completePupilCount: row.scores.filter((score) => score.finalScore !== null)
      .length,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
  }
}

function gradeBandDefinitions(
  scheme: GradingSchemeRecord,
): GradeBandDefinition[] {
  return scheme.bands.map((band) => ({
    minScore: band.minScore,
    maxScore: band.maxScore,
    gradeLabel: band.gradeLabel,
    remark: band.remark,
    sortOrder: band.sortOrder,
  }))
}

function policySnapshot(policy: AssessmentPolicyRecord) {
  return {
    id: policy.id,
    name: policy.name,
    version: policy.version,
    scopeKey: policy.scopeKey,
    isDefault: policy.isDefault,
    calculationMode: policy.calculationMode,
    components: policy.components.map((component) => ({
      id: component.id,
      key: component.key,
      name: component.name,
      category: component.category,
      maximumScore: component.maximumScore,
      weightPercent: component.weightPercent,
      sortOrder: component.sortOrder,
    })),
    gradingScheme: gradingSnapshot(policy.gradingScheme),
  }
}

function gradingSnapshot(scheme: GradingSchemeRecord) {
  return {
    id: scheme.id,
    name: scheme.name,
    bands: scheme.bands.map((band) => ({
      minScore: band.minScore,
      maxScore: band.maxScore,
      gradeLabel: band.gradeLabel,
      remark: band.remark,
      sortOrder: band.sortOrder,
    })),
  }
}

function auditRecord(
  schoolId: string,
  audit: AssessmentAuditContext,
  action: string,
  entityType: string,
  entityId: string | null,
  options: {
    submissionId?: string | null
    beforeState?: unknown
    afterState?: unknown
    metadata?: unknown
  } = {},
): Prisma.ResultAuditHistoryUncheckedCreateInput {
  return {
    schoolId,
    resultSubmissionId: options.submissionId ?? null,
    actorUserId: audit.actorUserId,
    actorMembershipId: audit.actorMembershipId,
    action,
    entityType,
    entityId,
    beforeState:
      options.beforeState === undefined
        ? undefined
        : jsonValue(options.beforeState),
    afterState:
      options.afterState === undefined
        ? undefined
        : jsonValue(options.afterState),
    metadata:
      options.metadata === undefined ? undefined : jsonValue(options.metadata),
    ipAddress: audit.ipAddress ?? null,
    userAgent: audit.userAgent ?? null,
  }
}

function assertValidBands(bands: ReadonlyArray<GradeBandInput>): void {
  const issues = validateGradeBands(
    bands.map((band) => ({
      minScore: band.minScore,
      maxScore: band.maxScore,
      gradeLabel: band.gradeLabel,
      remark: band.remark,
      sortOrder: band.sortOrder,
    })),
  )

  if (issues.length > 0) {
    throw new HttpError(400, 'Invalid grading scheme', issues)
  }
}

function assertValidComponents(
  components: ReadonlyArray<AssessmentComponentInput>,
): void {
  const issues = validateComponents(
    components.map((component) => ({
      id: component.key,
      key: component.key,
      name: component.name,
      category: component.category,
      maximumScore: component.maximumScore,
      weightPercent: component.weightPercent,
      sortOrder: component.sortOrder,
    })),
  )

  if (issues.length > 0) {
    throw new HttpError(400, 'Invalid assessment configuration', issues)
  }
}

async function findTermOrThrow(
  tx: Tx,
  schoolId: string,
  termId: string,
  academicYearId?: string,
) {
  const term = await tx.academicTerm.findFirst({
    where: {
      id: termId,
      schoolId,
      ...(academicYearId ? { academicYearId } : {}),
    },
  })

  if (!term) {
    throw new HttpError(404, 'Academic term not found')
  }

  return term
}

async function findSchemeOrThrow(
  tx: Tx,
  schoolId: string,
  schemeId: string,
): Promise<SchemeRow> {
  const scheme = await tx.gradingScheme.findFirst({
    where: { id: schemeId, schoolId },
    include: schemeInclude,
  })

  if (!scheme) {
    throw new HttpError(404, 'Grading scheme not found')
  }

  return scheme
}

async function findPolicyByIdOrThrow(
  tx: Tx,
  schoolId: string,
  policyId: string,
): Promise<PolicyRow> {
  const policy = await tx.assessmentPolicy.findFirst({
    where: { id: policyId, schoolId },
    include: policyInclude,
  })

  if (!policy) {
    throw new HttpError(404, 'Assessment policy not found')
  }

  return policy
}

async function resolvePolicy(
  tx: Tx,
  schoolId: string,
  academicTermId: string,
  classId: string,
  level: string | null,
): Promise<PolicyRow | null> {
  const scopeKeys = [`class:${classId}`]
  const normalizedLevel = normalizeLevel(level)

  if (normalizedLevel) {
    scopeKeys.push(`level:${normalizedLevel}`)
  }
  scopeKeys.push('term')

  for (const scopeKey of scopeKeys) {
    const policy = await tx.assessmentPolicy.findFirst({
      where: {
        schoolId,
        academicTermId,
        scopeKey,
        isActive: true,
      },
      include: policyInclude,
    })

    if (policy) {
      return policy
    }
  }

  return null
}

/**
 * Finds a grading scheme the standard policy can use. The school's active
 * term-specific scheme wins, then an active year-wide scheme, then any active
 * scheme for the year. Only when the school has no active scheme at all does
 * Wise Grade create the standard example scale.
 */
async function findOrCreateStandardScheme(
  tx: Tx,
  schoolId: string,
  academicYearId: string,
  academicTermId: string,
): Promise<SchemeRow> {
  const termScheme = await tx.gradingScheme.findFirst({
    where: {
      schoolId,
      academicYearId,
      academicTermId,
      isActive: true,
    },
    include: schemeInclude,
    orderBy: { createdAt: 'desc' },
  })

  if (termScheme) {
    return termScheme
  }

  const yearScheme = await tx.gradingScheme.findFirst({
    where: {
      schoolId,
      academicYearId,
      academicTermId: null,
      isActive: true,
    },
    include: schemeInclude,
    orderBy: { createdAt: 'desc' },
  })

  if (yearScheme) {
    return yearScheme
  }

  const anyActiveScheme = await tx.gradingScheme.findFirst({
    where: { schoolId, academicYearId, isActive: true },
    include: schemeInclude,
    orderBy: { createdAt: 'desc' },
  })

  if (anyActiveScheme) {
    return anyActiveScheme
  }

  // Reuse a previously created standard scheme even if it is currently
  // inactive, rather than creating a duplicate with the same unique name.
  const existingStandard = await tx.gradingScheme.findFirst({
    where: {
      schoolId,
      academicYearId,
      name: STANDARD_GRADING_SCHEME_NAME,
    },
    include: schemeInclude,
  })

  if (existingStandard) {
    return existingStandard
  }

  return tx.gradingScheme.create({
    data: {
      schoolId,
      academicYearId,
      academicTermId,
      name: STANDARD_GRADING_SCHEME_NAME,
      description: STANDARD_GRADING_SCHEME_DESCRIPTION,
      isActive: true,
      bands: {
        create: EXAMPLE_GRADE_BANDS.map((band, index) => ({
          schoolId,
          minScore: band.minScore,
          maxScore: band.maxScore,
          gradeLabel: band.gradeLabel,
          remark: band.remark,
          sortOrder: band.sortOrder ?? index,
        })),
      },
    },
    include: schemeInclude,
  })
}

/**
 * Lazily creates the Wise Grade standard term-wide policy for a term that has no
 * active assessment policy at all. Existing custom policies (at any scope) are
 * never modified, deactivated or overwritten, and accepted results keep their
 * recorded policy/grading snapshots.
 *
 * The unique constraint on (schoolId, academicTermId, scopeKey, version)
 * makes concurrent initialisation safe: the losing transaction retries and
 * then observes the winner's active policy.
 */
async function ensureStandardPolicyForTerm(
  schoolId: string,
  academicYearId: string,
  academicTermId: string,
): Promise<void> {
  const prisma = getPrismaClient()
  let lastError: unknown

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await prisma.$transaction(async (tx) => {
        // Serialize concurrent lazy initialization for the same term. Without
        // this lock, two transactions could both observe "no active policy",
        // compute different version numbers and both stay active.
        await tx.$queryRaw`
          SELECT "id" FROM "AcademicTerm"
          WHERE "id" = ${academicTermId} AND "schoolId" = ${schoolId}
          FOR UPDATE
        `

        const activePolicy = await tx.assessmentPolicy.findFirst({
          where: { schoolId, academicTermId, isActive: true },
          select: { id: true },
        })

        if (activePolicy) {
          return
        }

        const scheme = await findOrCreateStandardScheme(
          tx,
          schoolId,
          academicYearId,
          academicTermId,
        )

        const latest = await tx.assessmentPolicy.findFirst({
          where: { schoolId, academicTermId, scopeKey: 'term' },
          orderBy: { version: 'desc' },
          select: { version: true },
        })

        await tx.assessmentPolicy.create({
          data: {
            schoolId,
            academicYearId,
            academicTermId,
            classId: null,
            level: null,
            gradingSchemeId: scheme.id,
            name: STANDARD_POLICY_NAME,
            description: STANDARD_POLICY_DESCRIPTION,
            scopeKey: 'term',
            version: (latest?.version ?? 0) + 1,
            isActive: true,
            isDefault: true,
            calculationMode: 'GROUPED_SBA',
            components: {
              create: STANDARD_ASSESSMENT_COMPONENTS.map(
                (component, index) => ({
                  schoolId,
                  key: component.key,
                  name: component.name,
                  category: component.category,
                  maximumScore: component.maximumScore,
                  weightPercent: component.weightPercent,
                  sortOrder: component.sortOrder ?? index,
                }),
              ),
            },
          },
        })
      })

      return
    } catch (error) {
      lastError = error

      if (!isUniqueConstraintError(error)) {
        throw error
      }
    }
  }

  // A concurrent request may have won every race. Treat an active policy as
  // success; otherwise surface the last uniqueness error.
  const activePolicy = await prisma.assessmentPolicy.findFirst({
    where: { schoolId, academicTermId, isActive: true },
    select: { id: true },
  })

  if (activePolicy) {
    return
  }

  throw lastError ?? new Error('Could not initialize the standard assessment policy')
}

async function ensureStandardPolicyForTermId(
  schoolId: string,
  academicTermId: string,
  academicYearId?: string,
): Promise<void> {
  const term = await getPrismaClient().academicTerm.findFirst({
    where: {
      id: academicTermId,
      schoolId,
      ...(academicYearId ? { academicYearId } : {}),
    },
    select: { id: true, academicYearId: true },
  })

  if (term) {
    await ensureStandardPolicyForTerm(
      schoolId,
      term.academicYearId,
      term.id,
    )
  }
}

async function lockSubmission(tx: Tx, submissionId: string): Promise<void> {
  await tx.$queryRaw`
    SELECT "id" FROM "ResultSubmission" WHERE "id" = ${submissionId} FOR UPDATE
  `
}

async function assertClassSubjectActive(
  tx: Tx,
  schoolId: string,
  classId: string,
  subjectId: string,
) {
  const record = await tx.classSubject.findFirst({
    where: {
      schoolId,
      classId,
      subjectId,
      isActive: true,
      class: { isArchived: false },
      subject: { isArchived: false },
    },
    include: { class: true, subject: true },
  })

  if (!record) {
    throw new HttpError(
      404,
      'This subject is not an active subject of the selected class',
    )
  }

  return record
}

async function activeRoster(
  tx: Tx,
  schoolId: string,
  academicYearId: string,
  classId: string,
) {
  return tx.pupilEnrollment.findMany({
    where: {
      schoolId,
      classId,
      academicYearId,
      status: 'ACTIVE',
      pupil: { status: 'ACTIVE' },
    },
    include: { pupil: true },
    orderBy: [{ pupil: { lastName: 'asc' } }, { pupil: { firstName: 'asc' } }],
  })
}

interface PreparedPupil {
  pupilId: string
  name: string
  /** componentId -> score string, or null when the teacher cleared it. */
  values: Map<string, string | null>
  finalScore: number | null
  sbaContribution: number | null
  examContribution: number | null
  gradeLabel: string | null
  gradeRemark: string | null
  missingComponentIds: string[]
  contributions: Array<{ componentId: string; contribution: number | null }>
}

function preparePupils(
  policy: AssessmentPolicyRecord,
  roster: Map<string, { name: string }>,
  pupils: ReadonlyArray<PupilScoreInput>,
  earlyYears: boolean,
): PreparedPupil[] {
  const seenPupils = new Set<string>()
  const prepared: PreparedPupil[] = []
  const componentById = new Map(
    policy.components.map((component) => [component.id, component]),
  )

  for (const pupil of pupils) {
    if (seenPupils.has(pupil.pupilId)) {
      throw new HttpError(400, 'Score validation failed', [
        {
          field: `pupils.${pupil.pupilId}`,
          message: 'A pupil appears more than once in the score sheet.',
        },
      ])
    }
    seenPupils.add(pupil.pupilId)

    const rosterEntry = roster.get(pupil.pupilId)

    if (!rosterEntry) {
      throw new HttpError(400, 'Score validation failed', [
        {
          field: `pupils.${pupil.pupilId}`,
          message:
            'The pupil is not actively enrolled in the selected class for this academic year.',
        },
      ])
    }

    const seenComponents = new Set<string>()
    const values = new Map<string, string | null>()
    const entries: Array<{ componentId: string; score: string }> = []

    for (const score of pupil.scores) {
      if (!componentById.has(score.componentId)) {
        throw new HttpError(400, 'Score validation failed', [
          {
            field: `pupils.${pupil.pupilId}.${score.componentId}`,
            message: `${rosterEntry.name}: this component does not belong to the selected assessment policy.`,
          },
        ])
      }

      if (seenComponents.has(score.componentId)) {
        throw new HttpError(400, 'Score validation failed', [
          {
            field: `pupils.${pupil.pupilId}.${score.componentId}`,
            message: `${rosterEntry.name}: a score for this component appears more than once.`,
          },
        ])
      }
      seenComponents.add(score.componentId)
      values.set(score.componentId, score.score)

      if (score.score !== null) {
        entries.push({ componentId: score.componentId, score: score.score })
      }
    }

    const calculation = calculatePupilResult(
      componentDefinitions(policy.components),
      entries,
      policy.calculationMode,
    )

    if (calculation.issues.length > 0) {
      throw new HttpError(
        400,
        'Score validation failed',
        calculation.issues.map((issue) => ({
          field: `pupils.${pupil.pupilId}`,
          message: `${rosterEntry.name}: ${issue.message}`,
        })),
      )
    }

    // Early-years classes are classified from the exact (unrounded) final
    // score so a result just below a boundary is never promoted. All other
    // classes keep the school's configured grading bands.
    const earlyYearsResult = earlyYears
      ? earlyYearsPerformance(calculation.finalScoreUnrounded)
      : null
    const grade = earlyYears
      ? null
      : calculation.finalScore === null
        ? null
        : findGradeBand(
            gradeBandDefinitions(policy.gradingScheme),
            calculation.finalScore,
          )

    prepared.push({
      pupilId: pupil.pupilId,
      name: rosterEntry.name,
      values,
      finalScore: calculation.finalScore,
      sbaContribution: calculation.sbaContribution,
      examContribution: calculation.examContribution,
      gradeLabel: earlyYears
        ? (earlyYearsResult?.symbol ?? null)
        : (grade?.gradeLabel ?? null),
      gradeRemark: earlyYears
        ? (earlyYearsResult?.remark ?? null)
        : (grade?.remark ?? null),
      missingComponentIds: calculation.missingComponentIds,
      contributions: calculation.contributions.map((item) => ({
        componentId: item.componentId,
        contribution: item.contribution,
      })),
    })
  }

  return prepared
}

function assertSubmissionEditable(status: string): void {
  const reason = submissionEditBlockReason(status)

  if (reason) {
    throw new HttpError(409, reason)
  }
}

async function persistScores(
  tx: Tx,
  input: {
    schoolId: string
    academicYearId: string
    academicTermId: string
    classId: string
    subjectId: string
    policy: AssessmentPolicyRecord
    actorMembershipId: string | null
    actorAssignmentId?: string | null
    prepared: PreparedPupil[]
    expectedVersion?: number
    requireComplete?: boolean
  },
): Promise<{ submissionId: string; status: string; version: number }> {
  const existing = await tx.resultSubmission.findUnique({
    where: {
      schoolId_academicTermId_classId_subjectId: {
        schoolId: input.schoolId,
        academicTermId: input.academicTermId,
        classId: input.classId,
        subjectId: input.subjectId,
      },
    },
  })

  let submissionId: string
  let status: string
  let version: number

  if (existing) {
    await lockSubmission(tx, existing.id)
    const fresh = await tx.resultSubmission.findUnique({
      where: { id: existing.id },
    })

    if (!fresh) {
      throw new HttpError(409, 'The result submission changed. Reload and try again.')
    }

    assertSubmissionEditable(fresh.status)

    if (
      input.expectedVersion !== undefined &&
      fresh.version !== input.expectedVersion
    ) {
      throw new HttpError(
        409,
        'Another change was saved first. Reload the score sheet before saving again.',
        { expectedVersion: input.expectedVersion, actualVersion: fresh.version },
      )
    }

    status = fresh.status
    version = fresh.version + 1
    submissionId = fresh.id

    await tx.resultSubmission.update({
      where: { id: fresh.id },
      data: {
        policyId: input.policy.id,
        gradingSchemeId: input.policy.gradingSchemeId,
        policySnapshot: jsonValue(policySnapshot(input.policy)),
        gradingSnapshot: jsonValue(gradingSnapshot(input.policy.gradingScheme)),
        version,
        ...(input.requireComplete
          ? {
              status: 'SUBMITTED' as const,
              submittedAt: new Date(),
              reviewedAt: null,
              reviewerMembershipId: null,
              lastComment: null,
            }
          : {}),
      },
    })
  } else {
    if (input.expectedVersion !== undefined && input.expectedVersion !== 0) {
      throw new HttpError(
        409,
        'There is no saved draft at that version. Reload the score sheet.',
      )
    }

    status = input.requireComplete ? 'SUBMITTED' : 'DRAFT'
    version = 1

    const created = await tx.resultSubmission.create({
      data: {
        schoolId: input.schoolId,
        academicYearId: input.academicYearId,
        academicTermId: input.academicTermId,
        classId: input.classId,
        subjectId: input.subjectId,
        policyId: input.policy.id,
        gradingSchemeId: input.policy.gradingSchemeId,
        status: input.requireComplete ? 'SUBMITTED' : 'DRAFT',
        version,
        createdByMembershipId: input.actorMembershipId,
        createdByAssignmentId: input.actorAssignmentId ?? null,
        submittedAt: input.requireComplete ? new Date() : null,
        policySnapshot: jsonValue(policySnapshot(input.policy)),
        gradingSnapshot: jsonValue(gradingSnapshot(input.policy.gradingScheme)),
      },
    })

    submissionId = created.id
  }

  for (const pupil of input.prepared) {
    const uniqueWhere = {
      schoolId_academicTermId_pupilId_subjectId: {
        schoolId: input.schoolId,
        academicTermId: input.academicTermId,
        pupilId: pupil.pupilId,
        subjectId: input.subjectId,
      },
    }

    const existingScore = await tx.pupilSubjectScore.findUnique({
      where: uniqueWhere,
    })

    const scoreData = {
      schoolId: input.schoolId,
      academicYearId: input.academicYearId,
      academicTermId: input.academicTermId,
      classId: input.classId,
      pupilId: pupil.pupilId,
      subjectId: input.subjectId,
      policyId: input.policy.id,
      gradingSchemeId: input.policy.gradingSchemeId,
      resultSubmissionId: submissionId,
      sbaContribution:
        pupil.sbaContribution === null
          ? null
          : centiToDecimalString(Math.round(pupil.sbaContribution * 100)),
      examContribution:
        pupil.examContribution === null
          ? null
          : centiToDecimalString(Math.round(pupil.examContribution * 100)),
      finalScore:
        pupil.finalScore === null
          ? null
          : centiToDecimalString(Math.round(pupil.finalScore * 100)),
      gradeLabel: pupil.gradeLabel,
      gradeRemark: pupil.gradeRemark,
      policySnapshot: jsonValue(policySnapshot(input.policy)),
      gradingSnapshot: jsonValue(gradingSnapshot(input.policy.gradingScheme)),
    }

    let pupilSubjectScoreId: string

    if (existingScore) {
      if (existingScore.classId !== input.classId) {
        throw new HttpError(
          409,
          'This pupil already has result data in another class for this term and subject. Use the historical correction workflow or contact the platform administrator.',
        )
      }

      const updated = await tx.pupilSubjectScore.update({
        where: { id: existingScore.id },
        data: scoreData,
      })
      pupilSubjectScoreId = updated.id
    } else {
      const created = await tx.pupilSubjectScore.create({
        data: scoreData,
      })
      pupilSubjectScoreId = created.id
    }

    for (const component of input.policy.components) {
      const value = pupil.values.get(component.id)

      if (value === undefined) {
        continue
      }

      const existingComponentScore = await tx.assessmentScore.findUnique({
        where: {
          pupilSubjectScoreId_componentId: {
            pupilSubjectScoreId,
            componentId: component.id,
          },
        },
      })

      if (value === null) {
        if (existingComponentScore) {
          await tx.assessmentScore.delete({
            where: { id: existingComponentScore.id },
          })
        }
        continue
      }

      const data = {
        schoolId: input.schoolId,
        pupilSubjectScoreId,
        componentId: component.id,
        academicYearId: input.academicYearId,
        academicTermId: input.academicTermId,
        classId: input.classId,
        pupilId: pupil.pupilId,
        subjectId: input.subjectId,
        score: value,
      }

      if (existingComponentScore) {
        await tx.assessmentScore.update({
          where: { id: existingComponentScore.id },
          data,
        })
      } else {
        await tx.assessmentScore.create({ data })
      }
    }
  }

  if (input.requireComplete) {
    const incomplete = input.prepared.filter(
      (pupil) => pupil.finalScore === null,
    )

    if (incomplete.length > 0) {
      throw new HttpError(
        400,
        'Results cannot be submitted until every pupil has every required score',
        incomplete.map((pupil) => ({
          field: `pupils.${pupil.pupilId}`,
          message: `${pupil.name} is missing one or more required component scores.`,
        })),
      )
    }
  }

  return { submissionId, status, version }
}

export function createPrismaAssessmentRepository(): AssessmentRepository {
  const repo: AssessmentRepository = {
    async getSettings(schoolId) {
      const school = await getPrismaClient().school.findUnique({
        where: { id: schoolId },
        select: { classTeacherEntryMode: true },
      })

      if (!school) {
        throw new HttpError(404, 'School not found')
      }

      return {
        schoolId,
        classTeacherEntryMode: school.classTeacherEntryMode,
      }
    },

    async updateSettings(schoolId, mode, audit) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        const existing = await tx.school.findUnique({
          where: { id: schoolId },
          select: { classTeacherEntryMode: true },
        })

        if (!existing) {
          throw new HttpError(404, 'School not found')
        }

        const school = await tx.school.update({
          where: { id: schoolId },
          data: { classTeacherEntryMode: mode },
          select: { classTeacherEntryMode: true },
        })

        await tx.resultAuditHistory.create({
          data: auditRecord(
            schoolId,
            audit,
            'ASSESSMENT_SETTINGS_UPDATED',
            'School',
            schoolId,
            {
              beforeState: existing,
              afterState: school,
            },
          ),
        })

        return { schoolId, classTeacherEntryMode: school.classTeacherEntryMode }
      })
    },

    async listClassTeacherPermissions(schoolId) {
      const permissions = await getPrismaClient().classTeacherSubjectPermission.findMany({
        where: { schoolId },
        include: {
          class: true,
          subject: true,
          membership: { include: { user: true } },
        },
        orderBy: [{ class: { sortOrder: 'asc' } }, { subject: { name: 'asc' } }],
      })

      return permissions.map((permission) => ({
        id: permission.id,
        schoolId: permission.schoolId,
        classId: permission.classId,
        className: permission.class.name,
        subjectId: permission.subjectId,
        subjectName: permission.subject.name,
        membershipId: permission.membershipId,
        userId: permission.membership.user.id,
        firstName: permission.membership.user.firstName,
        lastName: permission.membership.user.lastName,
        email: permission.membership.user.email,
        createdAt: permission.createdAt,
      }))
    },

    async grantClassTeacherPermission(schoolId, input, audit) {
      const prisma = getPrismaClient()

      try {
        return await prisma.$transaction(async (tx) => {
          const membership = await tx.schoolMembership.findFirst({
            where: {
              id: input.membershipId,
              schoolId,
              status: 'ACTIVE',
              role: 'CLASS_TEACHER',
            },
            include: { user: true },
          })

          if (!membership) {
            throw new HttpError(
              404,
              'Active class teacher membership not found',
            )
          }

          const classSubject = await assertClassSubjectActive(
            tx,
            schoolId,
            input.classId,
            input.subjectId,
          )

          const permission = await tx.classTeacherSubjectPermission.upsert({
            where: {
              classId_subjectId_membershipId: {
                classId: input.classId,
                subjectId: input.subjectId,
                membershipId: input.membershipId,
              },
            },
            create: {
              schoolId,
              classId: input.classId,
              subjectId: input.subjectId,
              membershipId: input.membershipId,
            },
            update: {},
            include: {
              class: true,
              subject: true,
              membership: { include: { user: true } },
            },
          })

          await tx.resultAuditHistory.create({
            data: auditRecord(
              schoolId,
              audit,
              'CLASS_TEACHER_PERMISSION_GRANTED',
              'ClassTeacherSubjectPermission',
              permission.id,
              {
                afterState: {
                  classId: input.classId,
                  subjectId: input.subjectId,
                  membershipId: input.membershipId,
                },
                metadata: {
                  className: classSubject.class.name,
                  subjectName: classSubject.subject.name,
                },
              },
            ),
          })

          return {
            id: permission.id,
            schoolId: permission.schoolId,
            classId: permission.classId,
            className: permission.class.name,
            subjectId: permission.subjectId,
            subjectName: permission.subject.name,
            membershipId: permission.membershipId,
            userId: permission.membership.user.id,
            firstName: permission.membership.user.firstName,
            lastName: permission.membership.user.lastName,
            email: permission.membership.user.email,
            createdAt: permission.createdAt,
          } satisfies ClassTeacherPermissionRecord
        })
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw new HttpError(409, 'This class-teacher permission already exists')
        }
        throw error
      }
    },

    async revokeClassTeacherPermission(schoolId, permissionId, audit) {
      const prisma = getPrismaClient()

      await prisma.$transaction(async (tx) => {
        const permission = await tx.classTeacherSubjectPermission.findFirst({
          where: { id: permissionId, schoolId },
        })

        if (!permission) {
          throw new HttpError(404, 'Class-teacher permission not found')
        }

        await tx.classTeacherSubjectPermission.delete({
          where: { id: permission.id },
        })

        await tx.resultAuditHistory.create({
          data: auditRecord(
            schoolId,
            audit,
            'CLASS_TEACHER_PERMISSION_REVOKED',
            'ClassTeacherSubjectPermission',
            permission.id,
            {
              beforeState: {
                classId: permission.classId,
                subjectId: permission.subjectId,
                membershipId: permission.membershipId,
              },
            },
          ),
        })
      })
    },

    async listGradingSchemes(schoolId, filter = {}) {
      if (filter.academicTermId) {
        await ensureStandardPolicyForTermId(
          schoolId,
          filter.academicTermId,
          filter.academicYearId,
        )
      }

      const schemes = await getPrismaClient().gradingScheme.findMany({
        where: {
          schoolId,
          ...(filter.academicYearId
            ? { academicYearId: filter.academicYearId }
            : {}),
          ...(filter.academicTermId
            ? { academicTermId: filter.academicTermId }
            : {}),
        },
        include: schemeInclude,
        orderBy: [{ createdAt: 'desc' }],
      })

      return schemes.map(mapScheme)
    },

    async createGradingScheme(schoolId, input, audit) {
      assertValidBands(input.bands)

      const prisma = getPrismaClient()

      try {
        return await prisma.$transaction(async (tx) => {
          const year = await tx.academicYear.findFirst({
            where: { id: input.academicYearId, schoolId },
          })

          if (!year) {
            throw new HttpError(404, 'Academic year not found')
          }

          if (input.academicTermId) {
            await findTermOrThrow(
              tx,
              schoolId,
              input.academicTermId,
              input.academicYearId,
            )
          }

          const scheme = await tx.gradingScheme.create({
            data: {
              schoolId,
              academicYearId: input.academicYearId,
              academicTermId: input.academicTermId ?? null,
              name: input.name,
              description: input.description ?? null,
              bands: {
                create: input.bands.map((band, index) => ({
                  schoolId,
                  minScore: band.minScore,
                  maxScore: band.maxScore,
                  gradeLabel: band.gradeLabel,
                  remark: band.remark,
                  sortOrder: band.sortOrder ?? index,
                })),
              },
            },
            include: schemeInclude,
          })

          await tx.resultAuditHistory.create({
            data: auditRecord(
              schoolId,
              audit,
              'GRADING_SCHEME_CREATED',
              'GradingScheme',
              scheme.id,
              {
                afterState: mapScheme(scheme),
              },
            ),
          })

          return mapScheme(scheme)
        })
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw new HttpError(
            409,
            'A grading scheme with this name already exists for the academic year',
          )
        }
        throw error
      }
    },

    async updateGradingScheme(schoolId, schemeId, input, audit) {
      if (input.bands) {
        assertValidBands(input.bands)
      }

      const prisma = getPrismaClient()

      try {
        return await prisma.$transaction(async (tx) => {
          const existing = await findSchemeOrThrow(tx, schoolId, schemeId)

          if (input.academicYearId) {
            const year = await tx.academicYear.findFirst({
              where: { id: input.academicYearId, schoolId },
            })

            if (!year) {
              throw new HttpError(404, 'Academic year not found')
            }
          }

          if (input.academicTermId) {
            await findTermOrThrow(
              tx,
              schoolId,
              input.academicTermId,
              input.academicYearId ?? existing.academicYearId,
            )
          }

          const scheme = await tx.gradingScheme.update({
            where: { id: existing.id },
            data: {
              academicYearId: input.academicYearId ?? undefined,
              academicTermId:
                input.academicTermId === undefined
                  ? undefined
                  : input.academicTermId,
              name: input.name ?? undefined,
              description:
                input.description === undefined ? undefined : input.description,
              isActive: input.isActive ?? undefined,
              ...(input.bands
                ? {
                    bands: {
                      deleteMany: {},
                      create: input.bands.map((band, index) => ({
                        schoolId,
                        minScore: band.minScore,
                        maxScore: band.maxScore,
                        gradeLabel: band.gradeLabel,
                        remark: band.remark,
                        sortOrder: band.sortOrder ?? index,
                      })),
                    },
                  }
                : {}),
            },
            include: schemeInclude,
          })

          await tx.resultAuditHistory.create({
            data: auditRecord(
              schoolId,
              audit,
              'GRADING_SCHEME_UPDATED',
              'GradingScheme',
              scheme.id,
              {
                beforeState: mapScheme(existing),
                afterState: mapScheme(scheme),
              },
            ),
          })

          return mapScheme(scheme)
        })
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw new HttpError(
            409,
            'A grading scheme with this name already exists for the academic year',
          )
        }
        throw error
      }
    },

    async activateGradingScheme(schoolId, schemeId, audit) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        const existing = await findSchemeOrThrow(tx, schoolId, schemeId)

        await tx.gradingScheme.updateMany({
          where: {
            schoolId,
            academicYearId: existing.academicYearId,
            academicTermId: existing.academicTermId,
            id: { not: existing.id },
            isActive: true,
          },
          data: { isActive: false },
        })

        const scheme = await tx.gradingScheme.update({
          where: { id: existing.id },
          data: { isActive: true },
          include: schemeInclude,
        })

        await tx.resultAuditHistory.create({
          data: auditRecord(
            schoolId,
            audit,
            'GRADING_SCHEME_ACTIVATED',
            'GradingScheme',
            scheme.id,
            {
              afterState: mapScheme(scheme),
            },
          ),
        })

        return mapScheme(scheme)
      })
    },

    async listPolicies(schoolId, filter = {}) {
      if (filter.academicTermId) {
        await ensureStandardPolicyForTermId(
          schoolId,
          filter.academicTermId,
          filter.academicYearId,
        )
      }

      const policies = await getPrismaClient().assessmentPolicy.findMany({
        where: {
          schoolId,
          ...(filter.academicYearId
            ? { academicYearId: filter.academicYearId }
            : {}),
          ...(filter.academicTermId
            ? { academicTermId: filter.academicTermId }
            : {}),
          ...(filter.includeInactive ? {} : { isActive: true }),
        },
        include: policyInclude,
        orderBy: [{ scopeKey: 'asc' }, { version: 'desc' }],
      })

      return policies.map(mapPolicy)
    },

    async createPolicy(schoolId, input: AssessmentPolicyInput, audit) {
      assertValidComponents(input.components)

      if (input.classId && input.level) {
        throw new HttpError(
          400,
          'Choose either a class or an educational level, not both',
        )
      }

      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        const term = await findTermOrThrow(
          tx,
          schoolId,
          input.academicTermId,
          input.academicYearId,
        )

        let level = normalizeLevel(input.level)
        let classId: string | null = null

        if (input.classId) {
          const cls = await tx.schoolClass.findFirst({
            where: { id: input.classId, schoolId },
          })

          if (!cls) {
            throw new HttpError(404, 'Class not found')
          }

          classId = cls.id
          level = normalizeLevel(cls.level)
        }

        const scheme = await findSchemeOrThrow(
          tx,
          schoolId,
          input.gradingSchemeId,
        )

        if (scheme.bands.length === 0) {
          throw new HttpError(
            400,
            'The selected grading scheme has no grading bands',
          )
        }

        const scopeKey = policyScopeKey(classId, level)
        const latest = await tx.assessmentPolicy.findFirst({
          where: {
            schoolId,
            academicTermId: term.id,
            scopeKey,
          },
          orderBy: { version: 'desc' },
          select: { version: true },
        })

        const version = (latest?.version ?? 0) + 1

        await tx.assessmentPolicy.updateMany({
          where: {
            schoolId,
            academicTermId: term.id,
            scopeKey,
            isActive: true,
          },
          data: { isActive: false },
        })

        const policy = await tx.assessmentPolicy.create({
          data: {
            schoolId,
            academicYearId: input.academicYearId,
            academicTermId: term.id,
            classId,
            level,
            gradingSchemeId: input.gradingSchemeId,
            name: input.name,
            description: input.description ?? null,
            scopeKey,
            version,
            isActive: true,
            isDefault: false,
            calculationMode: input.calculationMode ?? 'COMPONENT_WEIGHTED',
            components: {
              create: input.components.map((component, index) => ({
                schoolId,
                key: component.key,
                name: component.name,
                category: component.category,
                maximumScore: component.maximumScore,
                weightPercent: component.weightPercent,
                sortOrder: component.sortOrder ?? index,
              })),
            },
          },
          include: policyInclude,
        })

        await tx.resultAuditHistory.create({
          data: auditRecord(
            schoolId,
            audit,
            'ASSESSMENT_POLICY_CREATED',
            'AssessmentPolicy',
            policy.id,
            { afterState: mapPolicy(policy) },
          ),
        })

        return mapPolicy(policy)
      })
    },

    async updatePolicy(
      schoolId,
      policyId,
      input: AssessmentPolicyUpdateInput,
      audit,
    ) {
      if (input.components) {
        assertValidComponents(input.components)
      }

      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        const existing = await findPolicyByIdOrThrow(tx, schoolId, policyId)

        if (input.gradingSchemeId) {
          await findSchemeOrThrow(tx, schoolId, input.gradingSchemeId)
        }

        if (input.components) {
          const submissionCount = await tx.resultSubmission.count({
            where: { schoolId, policyId: existing.id },
          })

          if (submissionCount > 0) {
            throw new HttpError(
              409,
              'This policy is already used by saved results. Create a new policy version instead of changing its components.',
            )
          }
        }

        if (input.isActive) {
          await tx.assessmentPolicy.updateMany({
            where: {
              schoolId,
              academicTermId: existing.academicTermId,
              scopeKey: existing.scopeKey,
              id: { not: existing.id },
              isActive: true,
            },
            data: { isActive: false },
          })
        }

        const policy = await tx.assessmentPolicy.update({
          where: { id: existing.id },
          data: {
            name: input.name ?? undefined,
            description:
              input.description === undefined ? undefined : input.description,
            gradingSchemeId: input.gradingSchemeId ?? undefined,
            isActive: input.isActive ?? undefined,
            calculationMode: input.calculationMode ?? undefined,
            ...(input.components
              ? {
                  components: {
                    deleteMany: {},
                    create: input.components.map((component, index) => ({
                      schoolId,
                      key: component.key,
                      name: component.name,
                      category: component.category,
                      maximumScore: component.maximumScore,
                      weightPercent: component.weightPercent,
                      sortOrder: component.sortOrder ?? index,
                    })),
                  },
                }
              : {}),
          },
          include: policyInclude,
        })

        await tx.resultAuditHistory.create({
          data: auditRecord(
            schoolId,
            audit,
            'ASSESSMENT_POLICY_UPDATED',
            'AssessmentPolicy',
            policy.id,
            {
              beforeState: mapPolicy(existing),
              afterState: mapPolicy(policy),
            },
          ),
        })

        return mapPolicy(policy)
      })
    },

    async activatePolicy(schoolId, policyId, audit) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        const existing = await findPolicyByIdOrThrow(tx, schoolId, policyId)

        await tx.assessmentPolicy.updateMany({
          where: {
            schoolId,
            academicTermId: existing.academicTermId,
            scopeKey: existing.scopeKey,
            id: { not: existing.id },
            isActive: true,
          },
          data: { isActive: false },
        })

        const policy = await tx.assessmentPolicy.update({
          where: { id: existing.id },
          data: { isActive: true },
          include: policyInclude,
        })

        await tx.resultAuditHistory.create({
          data: auditRecord(
            schoolId,
            audit,
            'ASSESSMENT_POLICY_ACTIVATED',
            'AssessmentPolicy',
            policy.id,
            { afterState: mapPolicy(policy) },
          ),
        })

        return mapPolicy(policy)
      })
    },

    async listAuthorizedClassSubjects(actor) {
      const prisma = getPrismaClient()

      const classSubjectInclude = {
        class: { select: { id: true, name: true, level: true, sortOrder: true } },
        subject: { select: { id: true, name: true, code: true } },
      } as const

      if (actor.role === 'SCHOOL_ADMIN') {
        const records = await prisma.classSubject.findMany({
          where: {
            schoolId: actor.schoolId,
            isActive: true,
            class: { isArchived: false },
            subject: { isArchived: false },
          },
          include: classSubjectInclude,
          orderBy: [{ class: { sortOrder: 'asc' } }, { subject: { name: 'asc' } }],
        })

        return records.map(
          (record): AuthorizedClassSubject => ({
            classId: record.classId,
            className: record.class.name,
            classLevel: record.class.level,
            subjectId: record.subjectId,
            subjectName: record.subject.name,
            subjectCode: record.subject.code,
            source: 'ADMIN',
            subjectTeacherName: null,
            readOnly: true,
            canEnterScores: false,
          }),
        )
      }

      if (actor.role === 'SUBJECT_TEACHER') {
        if (!actor.assignmentId && !actor.membershipId) {
          return []
        }

        const assignments = await prisma.subjectTeacherAssignment.findMany({
          where: {
            schoolId: actor.schoolId,
            endedAt: null,
            ...(actor.assignmentId
              ? { id: actor.assignmentId }
              : { membershipId: actor.membershipId }),
          },
          select: { classId: true, subjectId: true },
        })
        const allowedPairs = new Set(
          assignments.map(
            (assignment) => `${assignment.classId}:${assignment.subjectId}`,
          ),
        )

        if (allowedPairs.size === 0) {
          return []
        }

        const records = await prisma.classSubject.findMany({
          where: {
            schoolId: actor.schoolId,
            isActive: true,
            classId: { in: [...new Set(assignments.map((item) => item.classId))] },
            subjectId: {
              in: [...new Set(assignments.map((item) => item.subjectId))],
            },
            class: { isArchived: false },
            subject: { isArchived: false },
          },
          include: classSubjectInclude,
          orderBy: [{ class: { sortOrder: 'asc' } }, { subject: { name: 'asc' } }],
        })

        return records
          .filter((record) =>
            allowedPairs.has(`${record.classId}:${record.subjectId}`),
          )
          .map(
            (record): AuthorizedClassSubject => ({
              classId: record.classId,
              className: record.class.name,
              classLevel: record.class.level,
              subjectId: record.subjectId,
              subjectName: record.subject.name,
              subjectCode: record.subject.code,
              source: 'SUBJECT_TEACHER',
              subjectTeacherName: null,
              readOnly: false,
              canEnterScores: true,
            }),
          )
      }

      if (!actor.membershipId) {
        return []
      }

      const records = await prisma.classSubject.findMany({
        where: {
          schoolId: actor.schoolId,
          isActive: true,
          class: {
            isArchived: false,
            classTeacherAssignments: {
              some: { membershipId: actor.membershipId, endedAt: null },
            },
          },
          subject: { isArchived: false },
        },
        include: classSubjectInclude,
        orderBy: [{ class: { sortOrder: 'asc' } }, { subject: { name: 'asc' } }],
      })

      const assignments = await prisma.subjectTeacherAssignment.findMany({
        where: {
          schoolId: actor.schoolId,
          endedAt: null,
          classId: { in: [...new Set(records.map((record) => record.classId))] },
        },
        include: { membership: { include: { user: true } } },
      })

      const subjectTeacherByPair = new Map(
        assignments.map((assignment) => [
          `${assignment.classId}:${assignment.subjectId}`,
          assignment.membership
            ? `${assignment.membership.user.firstName} ${assignment.membership.user.lastName}`.trim()
            : `${assignment.firstName} ${assignment.lastName}`.trim(),
        ]),
      )

      return records.map((record): AuthorizedClassSubject => {
        const subjectTeacherName =
          subjectTeacherByPair.get(`${record.classId}:${record.subjectId}`) ??
          null

        return {
          classId: record.classId,
          className: record.class.name,
          classLevel: record.class.level,
          subjectId: record.subjectId,
          subjectName: record.subject.name,
          subjectCode: record.subject.code,
          source: 'CLASS_TEACHER',
          subjectTeacherName,
          readOnly: Boolean(subjectTeacherName),
          canEnterScores: !subjectTeacherName,
        }
      })
    },

    async listClassTeacherClassIds(actor) {
      if (actor.role !== 'CLASS_TEACHER' || !actor.membershipId) {
        return []
      }

      const assignments = await getPrismaClient().classTeacherAssignment.findMany({
        where: {
          schoolId: actor.schoolId,
          membershipId: actor.membershipId,
          endedAt: null,
          class: { isArchived: false },
        },
        select: { classId: true },
      })

      return [...new Set(assignments.map((assignment) => assignment.classId))]
    },

    async canEnterScores(actor, classId, subjectId) {      if (actor.role === 'SCHOOL_ADMIN') {
        return isScoreEntryAuthorized({
          role: actor.role,
          classSubjectActive: true,
          hasClassTeacherAssignment: false,
          hasSubjectTeacherAssignment: false,
          classTeacherEntryMode: 'EXPLICIT_ONLY',
          hasExplicitClassTeacherPermission: false,
        })
      }

      const prisma = getPrismaClient()

      const record = await prisma.classSubject.findFirst({
        where: {
          schoolId: actor.schoolId,
          classId,
          subjectId,
          isActive: true,
          class: { isArchived: false },
          subject: { isArchived: false },
        },
        select: { id: true },
      })

      if (!record) {
        return false
      }

      if (actor.role === 'SUBJECT_TEACHER') {
        if (!actor.assignmentId && !actor.membershipId) {
          return false
        }

        const assignment =
          await prisma.subjectTeacherAssignment.findFirst({
            where: {
              schoolId: actor.schoolId,
              classId,
              subjectId,
              endedAt: null,
              ...(actor.assignmentId
                ? { id: actor.assignmentId }
                : { membershipId: actor.membershipId ?? undefined }),
            },
            select: { id: true },
          })

        return isScoreEntryAuthorized({
          role: actor.role,
          classSubjectActive: true,
          hasClassTeacherAssignment: false,
          hasSubjectTeacherAssignment: Boolean(assignment),
          classTeacherEntryMode: 'EXPLICIT_ONLY',
          hasExplicitClassTeacherPermission: false,
        })
      }

      if (actor.role === 'CLASS_TEACHER') {
        if (!actor.membershipId) {
          return false
        }

        const assignment = await prisma.classTeacherAssignment.findFirst({
          where: {
            schoolId: actor.schoolId,
            classId,
            membershipId: actor.membershipId,
            endedAt: null,
          },
          select: { id: true },
        })

        const subjectTeacher = assignment
          ? await prisma.subjectTeacherAssignment.findFirst({
              where: {
                schoolId: actor.schoolId,
                classId,
                subjectId,
                endedAt: null,
              },
              select: { id: true },
            })
          : null

        return isScoreEntryAuthorized({
          role: actor.role,
          classSubjectActive: true,
          hasClassTeacherAssignment: Boolean(assignment),
          hasSubjectTeacherAssignment: Boolean(subjectTeacher),
          classTeacherEntryMode: 'EXPLICIT_ONLY',
          hasExplicitClassTeacherPermission: false,
        })
      }

      return false
    },

    async canViewScoreEntry(actor, classId, subjectId) {
      const prisma = getPrismaClient()

      const record = await prisma.classSubject.findFirst({
        where: {
          schoolId: actor.schoolId,
          classId,
          subjectId,
          isActive: true,
          class: { isArchived: false },
          subject: { isArchived: false },
        },
        select: { id: true },
      })

      if (!record) {
        return false
      }

      if (actor.role === 'SCHOOL_ADMIN') {
        return true
      }

      if (actor.role === 'SUBJECT_TEACHER') {
        if (!actor.assignmentId && !actor.membershipId) {
          return false
        }

        const assignment = await prisma.subjectTeacherAssignment.findFirst({
          where: {
            schoolId: actor.schoolId,
            classId,
            subjectId,
            endedAt: null,
            ...(actor.assignmentId
              ? { id: actor.assignmentId }
              : { membershipId: actor.membershipId }),
          },
          select: { id: true },
        })

        return Boolean(assignment)
      }

      if (actor.role === 'CLASS_TEACHER') {
        if (!actor.membershipId) {
          return false
        }

        const assignment = await prisma.classTeacherAssignment.findFirst({
          where: {
            schoolId: actor.schoolId,
            classId,
            membershipId: actor.membershipId,
            endedAt: null,
          },
          select: { id: true },
        })

        return Boolean(assignment)
      }

      return false
    },

    async getScoreEntry(actor, input) {
      const prisma = getPrismaClient()
      const allowed = await repo.canViewScoreEntry(
        actor,
        input.classId,
        input.subjectId,
      )

      if (!allowed) {
        throw new HttpError(
          403,
          'You are not authorized to view scores for this class and subject',
        )
      }

      const readOnly = !(await repo.canEnterScores(
        actor,
        input.classId,
        input.subjectId,
      ))
      const activeSubjectTeacher =
        await prisma.subjectTeacherAssignment.findFirst({
          where: {
            schoolId: actor.schoolId,
            classId: input.classId,
            subjectId: input.subjectId,
            endedAt: null,
          },
          include: { membership: { include: { user: true } } },
        })
      const subjectTeacherName = activeSubjectTeacher
        ? activeSubjectTeacher.membership
          ? `${activeSubjectTeacher.membership.user.firstName} ${activeSubjectTeacher.membership.user.lastName}`.trim()
          : `${activeSubjectTeacher.firstName} ${activeSubjectTeacher.lastName}`.trim()
        : null
      const ownerName =
        subjectTeacherName ??
        (actor.role === 'CLASS_TEACHER' ? 'Class teacher' : 'School administrator')

      await ensureStandardPolicyForTermId(actor.schoolId, input.academicTermId)

      return prisma.$transaction(async (tx) => {
        const term = await findTermOrThrow(
          tx,
          actor.schoolId,
          input.academicTermId,
        )
        const classSubject = await assertClassSubjectActive(
          tx,
          actor.schoolId,
          input.classId,
          input.subjectId,
        )

        const submission = await tx.resultSubmission.findUnique({
          where: {
            schoolId_academicTermId_classId_subjectId: {
              schoolId: actor.schoolId,
              academicTermId: term.id,
              classId: input.classId,
              subjectId: input.subjectId,
            },
          },
          include: submissionInclude,
        })

        let policyRow: PolicyRow | null

        if (submission?.policyId) {
          policyRow = await findPolicyByIdOrThrow(
            tx,
            actor.schoolId,
            submission.policyId,
          )
        } else {
          policyRow = await resolvePolicy(
            tx,
            actor.schoolId,
            term.id,
            input.classId,
            classSubject.class.level,
          )
        }

        if (!policyRow) {
          throw new HttpError(
            409,
            'No active assessment policy applies to this class and term. Configure an assessment policy first.',
          )
        }

        const policy = mapPolicy(policyRow)
        const earlyYears = isEarlyYearsClass(classSubject.class)
        const roster = await activeRoster(
          tx,
          actor.schoolId,
          term.academicYearId,
          input.classId,
        )

        const existingScores = await tx.pupilSubjectScore.findMany({
          where: {
            schoolId: actor.schoolId,
            academicTermId: term.id,
            classId: input.classId,
            subjectId: input.subjectId,
          },
          include: {
            assessmentScores: true,
            pupil: {
              select: {
                admissionNumber: true,
                firstName: true,
                lastName: true,
                otherNames: true,
              },
            },
          },
        })

        const scoreByPupil = new Map(
          existingScores.map((score) => [score.pupilId, score]),
        )

        const locked =
          submission?.status === 'SUBMITTED' ||
          submission?.status === 'ACCEPTED'

        const components = policy.components
        const pupilRows: ScoreEntryPupil[] = roster.map((enrollment) => {
          const stored = scoreByPupil.get(enrollment.pupilId)
          const values: Record<string, string> = {}

          for (const score of stored?.assessmentScores ?? []) {
            values[score.componentId] = decimalString(score.score) ?? '0'
          }

          const entries = (stored?.assessmentScores ?? []).map((score) => ({
            componentId: score.componentId,
            score: decimalString(score.score) ?? '0',
          }))
          const calculation = calculatePupilResult(
            componentDefinitions(components),
            entries,
            policy.calculationMode,
          )
          const earlyYearsResult = earlyYears
            ? earlyYearsPerformance(calculation.finalScoreUnrounded)
            : null
          const grade = earlyYears
            ? null
            : calculation.finalScore === null
              ? null
              : findGradeBand(
                  gradeBandDefinitions(policy.gradingScheme),
                  calculation.finalScore,
                )

          return {
            pupilId: enrollment.pupilId,
            admissionNumber: enrollment.pupil.admissionNumber,
            firstName: enrollment.pupil.firstName,
            lastName: enrollment.pupil.lastName,
            otherNames: enrollment.pupil.otherNames,
            scores: values,
            missingComponentIds: calculation.missingComponentIds,
            sbaContribution:
              locked && stored?.sbaContribution !== null && stored
                ? decimalNumber(stored.sbaContribution)
                : calculation.sbaContribution,
            examContribution:
              locked && stored?.examContribution !== null && stored
                ? decimalNumber(stored.examContribution)
                : calculation.examContribution,
            finalScore:
              locked && stored?.finalScore !== null && stored
                ? decimalNumber(stored.finalScore)
                : calculation.finalScore,
            subjectPosition: null,
            subjectPositionStatus: 'INCOMPLETE',
            gradeLabel:
              locked && stored?.gradeLabel
                ? stored.gradeLabel
                : earlyYears
                  ? (earlyYearsResult?.symbol ?? null)
                  : (grade?.gradeLabel ?? null),
            gradeRemark:
              locked && stored?.gradeRemark
                ? stored.gradeRemark
                : earlyYears
                  ? (earlyYearsResult?.remark ?? null)
                  : (grade?.remark ?? null),
          }
        })

        // A locked submission is a historical record. If a pupil has since
        // left the active roster, keep their stored result in the review view
        // so the visible sheet still matches the submission counts.
        if (locked) {
          const rosterPupilIds = new Set(
            roster.map((enrollment) => enrollment.pupilId),
          )

          for (const stored of existingScores) {
            if (rosterPupilIds.has(stored.pupilId)) {
              continue
            }

            const values: Record<string, string> = {}

            for (const score of stored.assessmentScores) {
              values[score.componentId] = decimalString(score.score) ?? '0'
            }

            const entries = stored.assessmentScores.map((score) => ({
              componentId: score.componentId,
              score: decimalString(score.score) ?? '0',
            }))
            const calculation = calculatePupilResult(
              componentDefinitions(components),
              entries,
              policy.calculationMode,
            )
            const earlyYearsResult = earlyYears
              ? earlyYearsPerformance(calculation.finalScoreUnrounded)
              : null
            const grade = earlyYears
              ? null
              : calculation.finalScore === null
                ? null
                : findGradeBand(
                    gradeBandDefinitions(policy.gradingScheme),
                    calculation.finalScore,
                  )

            pupilRows.push({
              pupilId: stored.pupilId,
              admissionNumber: stored.pupil.admissionNumber,
              firstName: stored.pupil.firstName,
              lastName: stored.pupil.lastName,
              otherNames: stored.pupil.otherNames,
              scores: values,
              missingComponentIds: calculation.missingComponentIds,
              sbaContribution:
                stored.sbaContribution !== null
                  ? decimalNumber(stored.sbaContribution)
                  : calculation.sbaContribution,
              examContribution:
                stored.examContribution !== null
                  ? decimalNumber(stored.examContribution)
                  : calculation.examContribution,
              finalScore:
                stored.finalScore !== null
                  ? decimalNumber(stored.finalScore)
                  : calculation.finalScore,
              subjectPosition: null,
              subjectPositionStatus: 'INCOMPLETE',
              gradeLabel:
                stored.gradeLabel ??
                (earlyYears
                  ? (earlyYearsResult?.symbol ?? null)
                  : (grade?.gradeLabel ?? null)),
              gradeRemark:
                stored.gradeRemark ??
                (earlyYears
                  ? (earlyYearsResult?.remark ?? null)
                  : (grade?.remark ?? null)),
            })
          }
        }

        // Subject positions are calculated from complete, valid current scores
        // for this class and subject. Before acceptance they are provisional
        // and visible during score entry; after acceptance the same ranking is
        // official. Incomplete pupils are excluded rather than treated as zero.
        // The ranking reuses the terminal report's integer-hundredth
        // comparison and configured tie policy so the register and report
        // cannot disagree.
        const rosterPupilIds = new Set(
          roster.map((enrollment) => enrollment.pupilId),
        )
        const rankingSettings = await tx.reportSettings.findUnique({
          where: {
            schoolId_academicTermId: {
              schoolId: actor.schoolId,
              academicTermId: term.id,
            },
          },
          select: { rankingEnabled: true, tiePolicy: true },
        })
        const rankingEnabled = rankingSettings?.rankingEnabled !== false
        const rankingTiePolicy = (rankingSettings?.tiePolicy ??
          'COMPETITION') as SubjectTiePolicy

        if (rankingEnabled) {
          const positions = rankRegisterSubjectPositions(
            pupilRows
              .filter((pupil) => rosterPupilIds.has(pupil.pupilId))
              .map((pupil) => ({
                pupilId: pupil.pupilId,
                name: [pupil.firstName, pupil.lastName, pupil.otherNames]
                  .filter(
                    (part): part is string =>
                      Boolean(part && part.trim()),
                  )
                  .join(' ')
                  .replace(/\s+/g, ' ')
                  .trim(),
                finalScore: pupil.finalScore,
              })),
            rankingTiePolicy as ReportTiePolicy,
          )

          for (const pupil of pupilRows) {
            if (rosterPupilIds.has(pupil.pupilId)) {
              pupil.subjectPosition = positions.get(pupil.pupilId) ?? null
            }
          }
        }

        // Every row receives an explicit status so the UI can distinguish an
        // official position from a provisional one while never putting
        // workflow wording inside the Position column.
        for (const pupil of pupilRows) {
          let status: SubjectPositionStatus

          if (!rosterPupilIds.has(pupil.pupilId)) {
            pupil.subjectPosition = null
            status = 'NOT_ELIGIBLE'
          } else if (pupil.finalScore === null) {
            pupil.subjectPosition = null
            status = 'INCOMPLETE'
          } else if (!rankingEnabled || pupil.subjectPosition === null) {
            pupil.subjectPosition = null
            status = 'NOT_RANKED'
          } else if (submission?.status === 'ACCEPTED') {
            status = 'FINAL'
          } else {
            status = 'PROVISIONAL'
          }

          pupil.subjectPositionStatus = status
        }

        const completePupils = pupilRows.filter(
          (pupil) => pupil.finalScore !== null,
        ).length
        const totalPupils = pupilRows.length
        const incompletePupils = totalPupils - completePupils
        const canSubmit =
          !readOnly &&
          totalPupils > 0 &&
          incompletePupils === 0 &&
          (!submission || submission.status === 'DRAFT' || submission.status === 'RETURNED_FOR_CORRECTION')

        return {
          academicTermId: term.id,
          classId: input.classId,
          subjectId: input.subjectId,
          policy,
          earlyYears,
          readOnly,
          subjectTeacherName,
          ownerName,
          submission: submission ? mapSubmission(submission) : null,
          pupils: pupilRows,
          ranking: {
            enabled: rankingEnabled,
            tiePolicy: rankingTiePolicy,
          },
          readiness: {
            totalPupils,
            completePupils,
            incompletePupils,
            canSubmit,
            reason:
              totalPupils === 0
                ? 'There are no active pupils enrolled in this class for the academic year.'
                : incompletePupils > 0
                  ? `${incompletePupils} pupil${incompletePupils === 1 ? '' : 's'} still need one or more scores.`
                  : submission &&
                      submission.status !== 'DRAFT' &&
                      submission.status !== 'RETURNED_FOR_CORRECTION'
                    ? 'This submission is locked against ordinary editing.'
                    : null,
          },
        } satisfies ScoreEntryView
      })
    },

    async saveDraft(actor: AssessmentActor, input: SaveDraftInput, audit) {
      const prisma = getPrismaClient()
      const allowed = await repo.canEnterScores(
        actor,
        input.classId,
        input.subjectId,
      )

      if (!allowed) {
        throw new HttpError(
          403,
          'You are not authorized to enter scores for this class and subject',
        )
      }

      await ensureStandardPolicyForTermId(actor.schoolId, input.academicTermId)

      try {
        await prisma.$transaction(async (tx) => {
          const term = await findTermOrThrow(
            tx,
            actor.schoolId,
            input.academicTermId,
          )
          const classSubject = await assertClassSubjectActive(
            tx,
            actor.schoolId,
            input.classId,
            input.subjectId,
          )

          const existingSubmission = await tx.resultSubmission.findUnique({
            where: {
              schoolId_academicTermId_classId_subjectId: {
                schoolId: actor.schoolId,
                academicTermId: term.id,
                classId: input.classId,
                subjectId: input.subjectId,
              },
            },
          })

          if (existingSubmission) {
            assertSubmissionEditable(existingSubmission.status)
          }

          let policyRow: PolicyRow | null

          if (existingSubmission?.policyId) {
            policyRow = await findPolicyByIdOrThrow(
              tx,
              actor.schoolId,
              existingSubmission.policyId,
            )
          } else {
            policyRow = await resolvePolicy(
              tx,
              actor.schoolId,
              term.id,
              input.classId,
              classSubject.class.level,
            )
          }

          if (!policyRow) {
            throw new HttpError(
              409,
              'No active assessment policy applies to this class and term. Configure an assessment policy first.',
            )
          }

          const policy = mapPolicy(policyRow)
          const roster = await activeRoster(
            tx,
            actor.schoolId,
            term.academicYearId,
            input.classId,
          )
          const rosterMap = new Map(
            roster.map((enrollment) => [
              enrollment.pupilId,
              {
                name: `${enrollment.pupil.firstName} ${enrollment.pupil.lastName}`.trim(),
              },
            ]),
          )

          const prepared = preparePupils(
            policy,
            rosterMap,
            input.pupils,
            isEarlyYearsClass(classSubject.class),
          )

          const result = await persistScores(tx, {
            schoolId: actor.schoolId,
            academicYearId: term.academicYearId,
            academicTermId: term.id,
            classId: input.classId,
            subjectId: input.subjectId,
            policy,
            actorMembershipId: actor.membershipId,
            actorAssignmentId: actor.assignmentId ?? null,
            prepared,
            expectedVersion: input.expectedVersion,
          })

          await tx.resultAuditHistory.create({
            data: auditRecord(
              actor.schoolId,
              audit,
              'SCORE_DRAFT_SAVED',
              'ResultSubmission',
              result.submissionId,
              {
                submissionId: result.submissionId,
                afterState: {
                  status: result.status,
                  version: result.version,
                  pupils: prepared.map((pupil) => ({
                    pupilId: pupil.pupilId,
                    finalScore: pupil.finalScore,
                    gradeLabel: pupil.gradeLabel,
                  })),
                },
                metadata: {
                  classId: input.classId,
                  subjectId: input.subjectId,
                  academicTermId: term.id,
                  pupilCount: prepared.length,
                },
              },
            ),
          })

          return result.submissionId
        })

        return await repo.getScoreEntry(actor, {
          academicTermId: input.academicTermId,
          classId: input.classId,
          subjectId: input.subjectId,
        })
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw new HttpError(
            409,
            'Another request created this result submission first. Reload the score sheet.',
          )
        }
        throw error
      }
    },

    async submitResults(actor, input, audit) {
      const prisma = getPrismaClient()
      const allowed = await repo.canEnterScores(
        actor,
        input.classId,
        input.subjectId,
      )

      if (!allowed) {
        throw new HttpError(
          403,
          'You are not authorized to submit scores for this class and subject',
        )
      }

      await ensureStandardPolicyForTermId(actor.schoolId, input.academicTermId)

      try {
        const submissionId = await prisma.$transaction(async (tx) => {
          const term = await findTermOrThrow(
            tx,
            actor.schoolId,
            input.academicTermId,
          )
          const classSubject = await assertClassSubjectActive(
            tx,
            actor.schoolId,
            input.classId,
            input.subjectId,
          )

          const existingSubmission = await tx.resultSubmission.findUnique({
            where: {
              schoolId_academicTermId_classId_subjectId: {
                schoolId: actor.schoolId,
                academicTermId: term.id,
                classId: input.classId,
                subjectId: input.subjectId,
              },
            },
          })

          if (existingSubmission) {
            assertSubmissionEditable(existingSubmission.status)
          }

          let policyRow: PolicyRow | null

          if (existingSubmission?.policyId) {
            policyRow = await findPolicyByIdOrThrow(
              tx,
              actor.schoolId,
              existingSubmission.policyId,
            )
          } else {
            policyRow = await resolvePolicy(
              tx,
              actor.schoolId,
              term.id,
              input.classId,
              classSubject.class.level,
            )
          }

          if (!policyRow) {
            throw new HttpError(
              409,
              'No active assessment policy applies to this class and term. Configure an assessment policy first.',
            )
          }

          const policy = mapPolicy(policyRow)
          const roster = await activeRoster(
            tx,
            actor.schoolId,
            term.academicYearId,
            input.classId,
          )

          if (roster.length === 0) {
            throw new HttpError(
              400,
              'There are no actively enrolled pupils to submit for this class.',
            )
          }

          const inputByPupil = new Map(
            input.pupils.map((pupil) => [pupil.pupilId, pupil]),
          )
          const rosterMap = new Map(
            roster.map((enrollment) => [
              enrollment.pupilId,
              {
                name: `${enrollment.pupil.firstName} ${enrollment.pupil.lastName}`.trim(),
              },
            ]),
          )

          const mergedInput: PupilScoreInput[] = roster.map((enrollment) => {
            const existing = inputByPupil.get(enrollment.pupilId)
            return (
              existing ?? {
                pupilId: enrollment.pupilId,
                scores: [],
              }
            )
          })

          const prepared = preparePupils(
            policy,
            rosterMap,
            mergedInput,
            isEarlyYearsClass(classSubject.class),
          )

          const result = await persistScores(tx, {
            schoolId: actor.schoolId,
            academicYearId: term.academicYearId,
            academicTermId: term.id,
            classId: input.classId,
            subjectId: input.subjectId,
            policy,
            actorMembershipId: actor.membershipId,
            actorAssignmentId: actor.assignmentId ?? null,
            prepared,
            expectedVersion: input.expectedVersion,
            requireComplete: true,
          })

          await tx.resultAuditHistory.create({
            data: auditRecord(
              actor.schoolId,
              audit,
              'RESULT_SUBMITTED',
              'ResultSubmission',
              result.submissionId,
              {
                submissionId: result.submissionId,
                beforeState: existingSubmission
                  ? {
                      status: existingSubmission.status,
                      version: existingSubmission.version,
                    }
                  : null,
                afterState: {
                  status: result.status,
                  version: result.version,
                  pupils: prepared.map((pupil) => ({
                    pupilId: pupil.pupilId,
                    finalScore: pupil.finalScore,
                    gradeLabel: pupil.gradeLabel,
                  })),
                },
                metadata: {
                  classId: input.classId,
                  subjectId: input.subjectId,
                  academicTermId: term.id,
                  pupilCount: prepared.length,
                },
              },
            ),
          })

          return result.submissionId
        })

        const submission = await repo.getSubmission(actor.schoolId, submissionId)

        if (!submission) {
          throw new HttpError(404, 'Result submission not found')
        }

        return submission
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw new HttpError(
            409,
            'Another request created this result submission first. Reload the score sheet.',
          )
        }
        throw error
      }
    },

    async listSubmissions(schoolId, filter = {}) {
      const submissions = await getPrismaClient().resultSubmission.findMany({
        where: {
          schoolId,
          ...(filter.academicTermId
            ? { academicTermId: filter.academicTermId }
            : {}),
          ...(filter.status ? { status: filter.status } : {}),
          ...(filter.classId ? { classId: filter.classId } : {}),
          ...(filter.subjectId ? { subjectId: filter.subjectId } : {}),
        },
        include: submissionInclude,
        orderBy: [{ updatedAt: 'desc' }],
      })

      return submissions.map(mapSubmission)
    },

    async getSubmission(schoolId, submissionId) {
      const submission = await getPrismaClient().resultSubmission.findFirst({
        where: { id: submissionId, schoolId },
        include: submissionInclude,
      })

      return submission ? mapSubmission(submission) : null
    },

    async reviewSubmission(schoolId, submissionId, input: ResultReviewInput, audit) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        const existing = await tx.resultSubmission.findFirst({
          where: { id: submissionId, schoolId },
        })

        if (!existing) {
          throw new HttpError(404, 'Result submission not found')
        }

        await lockSubmission(tx, existing.id)

        const fresh = await tx.resultSubmission.findUnique({
          where: { id: existing.id },
        })

        if (!fresh) {
          throw new HttpError(404, 'Result submission not found')
        }

        if (!canReviewSubmission(fresh.status)) {
          throw new HttpError(
            409,
            'Only a submitted result can be accepted or returned for correction',
          )
        }

        if (fresh.version !== input.expectedVersion) {
          throw new HttpError(
            409,
            'Another reviewer action was recorded first. Reload the submission.',
            {
              expectedVersion: input.expectedVersion,
              actualVersion: fresh.version,
            },
          )
        }

        const comment = input.comment?.trim() || null

        if (input.decision === 'RETURNED_FOR_CORRECTION' && !comment) {
          throw new HttpError(
            400,
            'A comment is required when returning a submission for correction',
          )
        }

        const toStatus = reviewTransition(input.decision)

        const updated = await tx.resultSubmission.update({
          where: { id: fresh.id },
          data: {
            status: toStatus,
            version: fresh.version + 1,
            reviewedAt: new Date(),
            reviewerMembershipId: audit.actorMembershipId,
            lastComment: comment,
          },
          include: submissionInclude,
        })

        await tx.resultReview.create({
          data: {
            schoolId,
            resultSubmissionId: fresh.id,
            reviewerMembershipId: audit.actorMembershipId,
            decision: input.decision,
            fromStatus: fresh.status,
            toStatus,
            comment,
          },
        })

        await tx.resultAuditHistory.create({
          data: auditRecord(
            schoolId,
            audit,
            input.decision === 'ACCEPTED'
              ? 'RESULT_ACCEPTED'
              : 'RESULT_RETURNED_FOR_CORRECTION',
            'ResultSubmission',
            fresh.id,
            {
              submissionId: fresh.id,
              beforeState: {
                status: fresh.status,
                version: fresh.version,
              },
              afterState: {
                status: toStatus,
                version: updated.version,
                comment,
              },
            },
          ),
        })

        return mapSubmission(updated)
      })
    },

    async listReviews(schoolId, submissionId) {
      const reviews = await getPrismaClient().resultReview.findMany({
        where: { schoolId, resultSubmissionId: submissionId },
        include: {
          reviewer: {
            include: { user: { select: { firstName: true, lastName: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
      })

      return reviews.map(
        (review): ResultReviewRecord => ({
          id: review.id,
          resultSubmissionId: review.resultSubmissionId,
          reviewerMembershipId: review.reviewerMembershipId,
          reviewerName: review.reviewer
            ? `${review.reviewer.user.firstName} ${review.reviewer.user.lastName}`.trim()
            : 'Wise Grade academic review',
          decision: review.decision,
          fromStatus: review.fromStatus,
          toStatus: review.toStatus,
          comment: review.comment,
          createdAt: review.createdAt,
        }),
      )
    },

    async listHistory(schoolId, submissionId) {
      const history = await getPrismaClient().resultAuditHistory.findMany({
        where: {
          schoolId,
          ...(submissionId ? { resultSubmissionId: submissionId } : {}),
        },
        include: {
          actor: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: submissionId ? 500 : 200,
      })

      return history.map(
        (entry): ResultAuditRecord => ({
          id: entry.id,
          resultSubmissionId: entry.resultSubmissionId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          actorUserId: entry.actorUserId,
          actorMembershipId: entry.actorMembershipId,
          actorName: entry.actor
            ? `${entry.actor.firstName} ${entry.actor.lastName}`.trim()
            : null,
          beforeState: entry.beforeState,
          afterState: entry.afterState,
          metadata: entry.metadata,
          createdAt: entry.createdAt,
        }),
      )
    },
  }

  return repo
}

