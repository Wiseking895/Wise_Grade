import { HttpError } from '../errors/http-error.js'
import { getPrismaClient } from '../lib/prisma.js'
import type { Prisma } from '../generated/prisma/client.js'
import type {
  ReportAssetRecord,
  ReportAuditContext,
  ReportBatchDetail,
  ReportBatchRecord,
  ReportCardRecord,
  ReportClassRecord,
  ReportFailureRecord,
  ReportGenerationData,
  ReportInputRecord,
  ReportReleaseStatus,
  ReportRepository,
  ReportSettingsRecord,
  ReportVersionRecord,
} from './repository.js'
import { blocksNewTermRequest } from './request-guard.js'

type Tx = Prisma.TransactionClient

type DecimalLike = { toString(): string }

function decimalString(value: DecimalLike | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toString()
}

function dateOnly(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null
  }

  return typeof value === 'string'
    ? value.slice(0, 10)
    : value.toISOString().slice(0, 10)
}

function parseDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) {
    return undefined
  }

  if (value === null) {
    return null
  }

  return new Date(`${value}T00:00:00.000Z`)
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function fullName(pupil: {
  firstName: string
  lastName: string
  otherNames: string | null
}): string {
  return [pupil.firstName, pupil.lastName, pupil.otherNames]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function mapSettings(row: {
  id: string
  schoolId: string
  academicYearId: string
  academicTermId: string
  emblemObjectKey: string | null
  crestObjectKey: string | null
  signatureObjectKey: string | null
  headteacherLabel: string
  rankingEnabled: boolean
  tiePolicy: string
  aggregatePolicy: string
  attendanceRequired: boolean
  closingDate: Date | null
  reopeningDate: Date | null
  createdAt: Date
  updatedAt: Date
}): ReportSettingsRecord {
  return {
    id: row.id,
    schoolId: row.schoolId,
    academicYearId: row.academicYearId,
    academicTermId: row.academicTermId,
    emblemObjectKey: row.emblemObjectKey,
    crestObjectKey: row.crestObjectKey,
    signatureObjectKey: row.signatureObjectKey,
    headteacherLabel: row.headteacherLabel,
    rankingEnabled: row.rankingEnabled,
    tiePolicy: row.tiePolicy as ReportSettingsRecord['tiePolicy'],
    aggregatePolicy:
      row.aggregatePolicy as ReportSettingsRecord['aggregatePolicy'],
    attendanceRequired: row.attendanceRequired,
    closingDate: dateOnly(row.closingDate),
    reopeningDate: dateOnly(row.reopeningDate),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function mapInput(row: {
  id: string
  schoolId: string
  academicYearId: string
  academicTermId: string
  classId: string
  pupilId: string
  daysOpened: number | null
  daysAttended: number | null
  teacherRemarks: string | null
  attitude: string | null
  closingDate: Date | null
  reopeningDate: Date | null
  updatedAt: Date
}): ReportInputRecord {
  return {
    id: row.id,
    schoolId: row.schoolId,
    academicYearId: row.academicYearId,
    academicTermId: row.academicTermId,
    classId: row.classId,
    pupilId: row.pupilId,
    daysOpened: row.daysOpened,
    daysAttended: row.daysAttended,
    teacherRemarks: row.teacherRemarks,
    attitude: row.attitude,
    closingDate: dateOnly(row.closingDate),
    reopeningDate: dateOnly(row.reopeningDate),
    updatedAt: row.updatedAt,
  }
}

function mapAsset(row: {
  id: string
  schoolId: string
  kind: string
  storageKey: string
  mimeType: string
  byteSize: number
  checksum: string
  originalName: string
  createdAt: Date
}): ReportAssetRecord {
  return {
    id: row.id,
    schoolId: row.schoolId,
    kind: row.kind as ReportAssetRecord['kind'],
    storageKey: row.storageKey,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    checksum: row.checksum,
    originalName: row.originalName,
    createdAt: row.createdAt,
  }
}

export function mapReportBatch(row: {
  id: string
  schoolId: string
  academicYearId: string
  academicTermId: string
  classId: string | null
  scope: string
  status: string
  requestedPupilCount: number
  generatedCount: number
  skippedCount: number
  failedCount: number
  fatalError: string | null
  startedAt: Date | null
  completedAt: Date | null
  releaseStatus: string
  previousReleaseStatus: string | null
  submittedAt: Date | null
  submittedByMembershipId: string | null
  reviewedAt: Date | null
  reviewedByUserId: string | null
  returnedReason: string | null
  holdReason: string | null
  heldAt: Date | null
  heldByUserId: string | null
  releasedAt: Date | null
  releasedByUserId: string | null
  createdAt: Date
}): ReportBatchRecord {
  return {
    id: row.id,
    schoolId: row.schoolId,
    academicYearId: row.academicYearId,
    academicTermId: row.academicTermId,
    classId: row.classId,
    scope: row.scope as ReportBatchRecord['scope'],
    status: row.status as ReportBatchRecord['status'],
    requestedPupilCount: row.requestedPupilCount,
    generatedCount: row.generatedCount,
    skippedCount: row.skippedCount,
    failedCount: row.failedCount,
    fatalError: row.fatalError,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    releaseStatus: row.releaseStatus as ReportBatchRecord['releaseStatus'],
    previousReleaseStatus:
      row.previousReleaseStatus as ReportBatchRecord['previousReleaseStatus'],
    submittedAt: row.submittedAt,
    submittedByMembershipId: row.submittedByMembershipId,
    reviewedAt: row.reviewedAt,
    reviewedByUserId: row.reviewedByUserId,
    returnedReason: row.returnedReason,
    holdReason: row.holdReason,
    heldAt: row.heldAt,
    heldByUserId: row.heldByUserId,
    releasedAt: row.releasedAt,
    releasedByUserId: row.releasedByUserId,
    createdAt: row.createdAt,
  }
}

function acceptedSubmissionsFromSnapshot(snapshot: unknown): number {
  if (typeof snapshot !== 'object' || snapshot === null) {
    return 0
  }

  const source = (snapshot as Record<string, unknown>).source

  if (typeof source !== 'object' || source === null) {
    return 0
  }

  const value = (source as Record<string, unknown>).acceptedSubmissions

  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function mapVersion(
  row: {
    id: string
    reportCardId: string
    batchId: string | null
    version: number
    checksum: string
    byteSize: number
    pageCount: number
    generatedAt: Date
    snapshot: unknown
    batch: { releaseStatus: string } | null
  },
  generatedByName: string | null,
): ReportVersionRecord {
  return {
    id: row.id,
    reportCardId: row.reportCardId,
    batchId: row.batchId,
    releaseStatus:
      (row.batch?.releaseStatus as ReportVersionRecord['releaseStatus']) ??
      null,
    version: row.version,
    checksum: row.checksum,
    byteSize: row.byteSize,
    pageCount: row.pageCount,
    generatedAt: row.generatedAt,
    generatedByName,
    snapshot: row.snapshot,
  }
}

const versionGeneratorInclude = {
  generatedBy: {
    include: { user: { select: { firstName: true, lastName: true } } },
  },
  batch: { select: { releaseStatus: true } },
} satisfies Prisma.ReportCardVersionInclude

type VersionRow = Prisma.ReportCardVersionGetPayload<{
  include: typeof versionGeneratorInclude
}>

function generatorName(row: VersionRow): string | null {
  return row.generatedBy
    ? `${row.generatedBy.user.firstName} ${row.generatedBy.user.lastName}`.trim()
    : null
}

async function audit(
  tx: Tx | ReturnType<typeof getPrismaClient>,
  schoolId: string,
  context: ReportAuditContext,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata?: unknown,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      schoolId,
      actorUserId: context.actorUserId,
      action,
      entityType,
      entityId,
      metadata: metadata === undefined ? undefined : jsonValue(metadata),
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
    },
  })
}

async function assertTermAndClass(
  schoolId: string,
  academicYearId: string,
  academicTermId: string,
  classId: string,
): Promise<void> {
  const prisma = getPrismaClient()
  const [term, classroom] = await Promise.all([
    prisma.academicTerm.findFirst({
      where: {
        id: academicTermId,
        schoolId,
        academicYearId,
      },
      select: { id: true },
    }),
    prisma.schoolClass.findFirst({
      where: { id: classId, schoolId },
      select: { id: true },
    }),
  ])

  if (!term) {
    throw new HttpError(
      400,
      'The selected academic term does not belong to this school and academic year',
    )
  }

  if (!classroom) {
    throw new HttpError(400, 'The selected class does not belong to this school')
  }
}

export function createPrismaReportRepository(): ReportRepository {
  const repo: ReportRepository = {
    async getSettings(actor, academicTermId) {
      const prisma = getPrismaClient()
      const row = await prisma.reportSettings.findUnique({
        where: {
          schoolId_academicTermId: {
            schoolId: actor.schoolId,
            academicTermId,
          },
        },
      })

      return row ? mapSettings(row) : null
    },

    async updateSettings(actor, input, auditContext) {
      const prisma = getPrismaClient()
      const term = await prisma.academicTerm.findFirst({
        where: {
          id: input.academicTermId,
          schoolId: actor.schoolId,
          academicYearId: input.academicYearId,
        },
        select: { id: true },
      })

      if (!term) {
        throw new HttpError(
          400,
          'The selected academic term does not belong to this school and academic year',
        )
      }

      const assetKeys = [
        input.emblemObjectKey,
        input.crestObjectKey,
        input.signatureObjectKey,
      ].filter((key): key is string => Boolean(key))

      if (assetKeys.length > 0) {
        const found = await prisma.reportAsset.findMany({
          where: { schoolId: actor.schoolId, storageKey: { in: assetKeys } },
          select: { storageKey: true },
        })
        const known = new Set(found.map((asset) => asset.storageKey))

        for (const key of assetKeys) {
          if (!known.has(key)) {
            throw new HttpError(
              400,
              'A branding asset does not belong to this school',
            )
          }
        }
      }

      const row = await prisma.reportSettings.upsert({
        where: {
          schoolId_academicTermId: {
            schoolId: actor.schoolId,
            academicTermId: input.academicTermId,
          },
        },
        create: {
          schoolId: actor.schoolId,
          academicYearId: input.academicYearId,
          academicTermId: input.academicTermId,
          emblemObjectKey: input.emblemObjectKey ?? null,
          crestObjectKey: input.crestObjectKey ?? null,
          signatureObjectKey: input.signatureObjectKey ?? null,
          headteacherLabel:
            input.headteacherLabel ?? "HEADMASTER'S SIGNATURE",
          rankingEnabled: input.rankingEnabled ?? true,
          tiePolicy: input.tiePolicy ?? 'COMPETITION',
          aggregatePolicy: input.aggregatePolicy ?? 'NONE',
          attendanceRequired: input.attendanceRequired ?? true,
          closingDate: parseDate(input.closingDate) ?? null,
          reopeningDate: parseDate(input.reopeningDate) ?? null,
        },
        update: {
          ...(input.emblemObjectKey !== undefined
            ? { emblemObjectKey: input.emblemObjectKey }
            : {}),
          ...(input.crestObjectKey !== undefined
            ? { crestObjectKey: input.crestObjectKey }
            : {}),
          ...(input.signatureObjectKey !== undefined
            ? { signatureObjectKey: input.signatureObjectKey }
            : {}),
          ...(input.headteacherLabel !== undefined
            ? { headteacherLabel: input.headteacherLabel }
            : {}),
          ...(input.rankingEnabled !== undefined
            ? { rankingEnabled: input.rankingEnabled }
            : {}),
          ...(input.tiePolicy !== undefined
            ? { tiePolicy: input.tiePolicy }
            : {}),
          ...(input.aggregatePolicy !== undefined
            ? { aggregatePolicy: input.aggregatePolicy }
            : {}),
          ...(input.attendanceRequired !== undefined
            ? { attendanceRequired: input.attendanceRequired }
            : {}),
          ...(input.closingDate !== undefined
            ? { closingDate: parseDate(input.closingDate) }
            : {}),
          ...(input.reopeningDate !== undefined
            ? { reopeningDate: parseDate(input.reopeningDate) }
            : {}),
        },
      })

      await audit(
        prisma,
        actor.schoolId,
        auditContext,
        'REPORT_SETTINGS_UPDATED',
        'ReportSettings',
        row.id,
        {
          academicYearId: row.academicYearId,
          academicTermId: row.academicTermId,
          rankingEnabled: row.rankingEnabled,
          tiePolicy: row.tiePolicy,
          aggregatePolicy: row.aggregatePolicy,
        },
      )

      return mapSettings(row)
    },

    async uploadAsset(actor, input, auditContext) {
      const prisma = getPrismaClient()
      const row = await prisma.reportAsset.create({
        data: {
          schoolId: actor.schoolId,
          kind: input.kind,
          storageKey: input.storageKey,
          mimeType: input.mimeType,
          byteSize: input.byteSize,
          checksum: input.checksum,
          originalName: input.originalName,
          uploadedByMembershipId: actor.membershipId,
        },
      })

      await audit(
        prisma,
        actor.schoolId,
        auditContext,
        'REPORT_ASSET_UPLOADED',
        'ReportAsset',
        row.id,
        { kind: row.kind, storageKey: row.storageKey, checksum: row.checksum },
      )

      return mapAsset(row)
    },

    async getAsset(actor, assetId) {
      const prisma = getPrismaClient()
      const row = await prisma.reportAsset.findFirst({
        where: { id: assetId, schoolId: actor.schoolId },
      })

      return row ? mapAsset(row) : null
    },

    async listAssets(actor) {
      const prisma = getPrismaClient()
      const rows = await prisma.reportAsset.findMany({
        where: { schoolId: actor.schoolId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      })

      return rows.map(mapAsset)
    },

    async upsertInput(actor, input, auditContext) {
      const prisma = getPrismaClient()
      await assertTermAndClass(
        actor.schoolId,
        input.academicYearId,
        input.academicTermId,
        input.classId,
      )

      const enrollment = await prisma.pupilEnrollment.findFirst({
        where: {
          schoolId: actor.schoolId,
          academicYearId: input.academicYearId,
          classId: input.classId,
          pupilId: input.pupilId,
          status: 'ACTIVE',
        },
        select: { id: true },
      })

      if (!enrollment) {
        throw new HttpError(
          400,
          'The pupil is not actively enrolled in this class for the selected academic year',
        )
      }

      if (
        input.daysOpened !== null &&
        input.daysOpened !== undefined &&
        input.daysOpened <= 0
      ) {
        throw new HttpError(400, 'School days opened must be greater than zero')
      }

      if (
        input.daysOpened !== null &&
        input.daysOpened !== undefined &&
        input.daysAttended !== null &&
        input.daysAttended !== undefined &&
        (input.daysAttended < 0 || input.daysAttended > input.daysOpened)
      ) {
        throw new HttpError(
          400,
          'Days attended must be between zero and school days opened',
        )
      }

      const existing = await prisma.reportInput.findUnique({
        where: {
          schoolId_academicTermId_pupilId: {
            schoolId: actor.schoolId,
            academicTermId: input.academicTermId,
            pupilId: input.pupilId,
          },
        },
        select: { id: true },
      })

      const row = await prisma.reportInput.upsert({
        where: {
          schoolId_academicTermId_pupilId: {
            schoolId: actor.schoolId,
            academicTermId: input.academicTermId,
            pupilId: input.pupilId,
          },
        },
        create: {
          schoolId: actor.schoolId,
          academicYearId: input.academicYearId,
          academicTermId: input.academicTermId,
          classId: input.classId,
          pupilId: input.pupilId,
          daysOpened: input.daysOpened ?? null,
          daysAttended: input.daysAttended ?? null,
          teacherRemarks: input.teacherRemarks ?? null,
          attitude: input.attitude ?? null,
          closingDate: parseDate(input.closingDate) ?? null,
          reopeningDate: parseDate(input.reopeningDate) ?? null,
          updatedByMembershipId: actor.membershipId,
        },
        update: {
          academicYearId: input.academicYearId,
          classId: input.classId,
          ...(input.daysOpened !== undefined
            ? { daysOpened: input.daysOpened }
            : {}),
          ...(input.daysAttended !== undefined
            ? { daysAttended: input.daysAttended }
            : {}),
          ...(input.teacherRemarks !== undefined
            ? { teacherRemarks: input.teacherRemarks }
            : {}),
          ...(input.attitude !== undefined ? { attitude: input.attitude } : {}),
          ...(input.closingDate !== undefined
            ? { closingDate: parseDate(input.closingDate) }
            : {}),
          ...(input.reopeningDate !== undefined
            ? { reopeningDate: parseDate(input.reopeningDate) }
            : {}),
          updatedByMembershipId: actor.membershipId,
        },
      })

      await audit(
        prisma,
        actor.schoolId,
        auditContext,
        existing ? 'REPORT_INPUT_UPDATED' : 'REPORT_INPUT_CREATED',
        'ReportInput',
        row.id,
        {
          pupilId: row.pupilId,
          classId: row.classId,
          academicYearId: row.academicYearId,
          academicTermId: row.academicTermId,
          daysOpened: row.daysOpened,
          daysAttended: row.daysAttended,
          hasTeacherRemarks:
            row.teacherRemarks !== null && row.teacherRemarks.trim() !== '',
          hasAttitude: row.attitude !== null && row.attitude.trim() !== '',
        },
      )

      return mapInput(row)
    },

    async listInputs(actor, filter) {
      const prisma = getPrismaClient()
      const rows = await prisma.reportInput.findMany({
        where: {
          schoolId: actor.schoolId,
          academicTermId: filter.academicTermId,
          classId: filter.classId,
        },
        orderBy: [{ pupil: { lastName: 'asc' } }, { pupil: { firstName: 'asc' } }],
      })

      return rows.map(mapInput)
    },

    async listAccessibleClassIds(actor) {
      if (
        actor.role === 'SCHOOL_ADMIN' ||
        actor.role === 'PLATFORM_SUPER_ADMIN'
      ) {
        return null
      }

      if (!actor.membershipId) {
        return []
      }

      const membershipId = actor.membershipId
      const prisma = getPrismaClient()

      if (actor.role === 'CLASS_TEACHER') {
        const rows = await prisma.classTeacherAssignment.findMany({
          where: {
            schoolId: actor.schoolId,
            membershipId,
            endedAt: null,
          },
          select: { classId: true },
        })

        return [...new Set(rows.map((row) => row.classId))]
      }

      if (actor.role === 'SUBJECT_TEACHER') {
        const rows = await prisma.subjectTeacherAssignment.findMany({
          where: {
            schoolId: actor.schoolId,
            membershipId,
            endedAt: null,
          },
          select: { classId: true },
        })

        return [...new Set(rows.map((row) => row.classId))]
      }

      return []
    },

    async hasClassTeacherAssignment(actor, classId) {
      if (!actor.membershipId) {
        return false
      }

      const prisma = getPrismaClient()
      const row = await prisma.classTeacherAssignment.findFirst({
        where: {
          schoolId: actor.schoolId,
          classId,
          membershipId: actor.membershipId,
          endedAt: null,
        },
        select: { id: true },
      })

      return Boolean(row)
    },

    async hasSubjectTeacherAssignment(actor, classId) {
      if (!actor.membershipId) {
        return false
      }

      const prisma = getPrismaClient()
      const row = await prisma.subjectTeacherAssignment.findFirst({
        where: {
          schoolId: actor.schoolId,
          classId,
          membershipId: actor.membershipId,
          endedAt: null,
        },
        select: { id: true },
      })

      return Boolean(row)
    },

    async loadGenerationData(actor, request) {
      const prisma = getPrismaClient()
      const school = await prisma.school.findFirst({
        where: { id: actor.schoolId, isActive: true },
        select: {
          id: true,
          name: true,
          slug: true,
          email: true,
          phone: true,
          address: true,
          landmark: true,
          timezone: true,
          logoObjectKey: true,
          signatureObjectKey: true,
          signatureName: true,
          signatureDesignation: true,
        },
      })

      if (!school) {
        throw new HttpError(404, 'School not found')
      }

      const [year, term, classroom] = await Promise.all([
        prisma.academicYear.findFirst({
          where: { id: request.academicYearId, schoolId: actor.schoolId },
          select: { id: true, name: true, startsOn: true, endsOn: true },
        }),
        prisma.academicTerm.findFirst({
          where: {
            id: request.academicTermId,
            schoolId: actor.schoolId,
            academicYearId: request.academicYearId,
          },
          select: {
            id: true,
            academicYearId: true,
            name: true,
            sequence: true,
            startsOn: true,
            endsOn: true,
          },
        }),
        prisma.schoolClass.findFirst({
          where: { id: request.classId, schoolId: actor.schoolId },
          select: { id: true, name: true, level: true },
        }),
      ])

      if (!year || !term) {
        throw new HttpError(
          400,
          'The selected academic year and term do not belong to this school',
        )
      }

      if (!classroom) {
        throw new HttpError(400, 'The selected class does not belong to this school')
      }

      const [classSubjects, enrollments, settings] = await Promise.all([
        prisma.classSubject.findMany({
          where: {
            schoolId: actor.schoolId,
            classId: classroom.id,
            isActive: true,
            subject: { isArchived: false },
          },
          include: {
            subject: { select: { id: true, name: true, code: true } },
          },
          orderBy: [
            { sortOrder: 'asc' },
            { subject: { name: 'asc' } },
          ],
        }),
        prisma.pupilEnrollment.findMany({
          where: {
            schoolId: actor.schoolId,
            academicYearId: year.id,
            classId: classroom.id,
            status: 'ACTIVE',
            pupil: { status: 'ACTIVE' },
          },
          include: {
            pupil: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                otherNames: true,
                admissionNumber: true,
                gender: true,
                photoReference: true,
                status: true,
              },
            },
          },
          orderBy: [
            { pupil: { lastName: 'asc' } },
            { pupil: { firstName: 'asc' } },
          ],
        }),
        prisma.reportSettings.findUnique({
          where: {
            schoolId_academicTermId: {
              schoolId: actor.schoolId,
              academicTermId: term.id,
            },
          },
        }),
      ])

      const pupilIds = enrollments.map((enrollment) => enrollment.pupilId)

      const [inputs, submissions, scores] = await Promise.all([
        pupilIds.length === 0
          ? Promise.resolve([])
          : prisma.reportInput.findMany({
              where: {
                schoolId: actor.schoolId,
                academicTermId: term.id,
                classId: classroom.id,
                pupilId: { in: pupilIds },
              },
            }),
        prisma.resultSubmission.findMany({
          where: {
            schoolId: actor.schoolId,
            academicTermId: term.id,
            classId: classroom.id,
          },
          select: {
            subjectId: true,
            status: true,
            policySnapshot: true,
            gradingSnapshot: true,
            reviewedAt: true,
          },
        }),
        pupilIds.length === 0
          ? Promise.resolve([])
          : prisma.pupilSubjectScore.findMany({
              where: {
                schoolId: actor.schoolId,
                academicTermId: term.id,
                classId: classroom.id,
                pupilId: { in: pupilIds },
              },
              select: {
                pupilId: true,
                subjectId: true,
                sbaContribution: true,
                examContribution: true,
                finalScore: true,
                gradeLabel: true,
                gradeRemark: true,
                policySnapshot: true,
                gradingSnapshot: true,
              },
            }),
      ])

      const data: ReportGenerationData = {
        school,
        academicYear: {
          id: year.id,
          name: year.name,
          startsOn: dateOnly(year.startsOn) ?? '',
          endsOn: dateOnly(year.endsOn) ?? '',
        },
        academicTerm: {
          id: term.id,
          academicYearId: term.academicYearId,
          name: term.name,
          sequence: term.sequence,
          startsOn: dateOnly(term.startsOn) ?? '',
          endsOn: dateOnly(term.endsOn) ?? '',
        },
        class: classroom,
        settings: settings ? mapSettings(settings) : null,
        subjects: classSubjects.map((classSubject) => ({
          id: classSubject.subject.id,
          name: classSubject.subject.name,
          code: classSubject.subject.code,
          sortOrder: classSubject.sortOrder,
        })),
        pupils: enrollments.map((enrollment) => ({
          id: enrollment.pupil.id,
          firstName: enrollment.pupil.firstName,
          lastName: enrollment.pupil.lastName,
          otherNames: enrollment.pupil.otherNames,
          admissionNumber: enrollment.pupil.admissionNumber,
          gender: enrollment.pupil.gender,
          photoReference: enrollment.pupil.photoReference,
          status: enrollment.pupil.status,
          enrolledAt: enrollment.createdAt,
        })),
        inputs: inputs.map(mapInput),
        submissions: submissions.map((submission) => ({
          subjectId: submission.subjectId,
          status: submission.status,
          policySnapshot: submission.policySnapshot,
          gradingSnapshot: submission.gradingSnapshot,
          reviewedAt: submission.reviewedAt,
        })),
        scores: scores.map((score) => ({
          pupilId: score.pupilId,
          subjectId: score.subjectId,
          sbaContribution: decimalString(score.sbaContribution),
          examContribution: decimalString(score.examContribution),
          finalScore: decimalString(score.finalScore),
          gradeLabel: score.gradeLabel,
          gradeRemark: score.gradeRemark,
          policySnapshot: score.policySnapshot,
          gradingSnapshot: score.gradingSnapshot,
        })),
        onRoll: enrollments.length,
      }

      return data
    },

    async listClassesForTerm(actor, academicYearId, academicTermId) {
      const prisma = getPrismaClient()
      const term = await prisma.academicTerm.findFirst({
        where: {
          id: academicTermId,
          schoolId: actor.schoolId,
          academicYearId,
        },
        select: { id: true },
      })

      if (!term) {
        throw new HttpError(
          400,
          'The selected academic term does not belong to this school and academic year',
        )
      }

      const rows = await prisma.schoolClass.findMany({
        where: {
          schoolId: actor.schoolId,
          isArchived: false,
          enrollments: {
            some: { academicYearId, status: 'ACTIVE' },
          },
        },
        select: { id: true, name: true, level: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      })

      return rows.map(
        (row): ReportClassRecord => ({
          id: row.id,
          name: row.name,
          level: row.level,
        }),
      )
    },

    async getLatestVersionForPupil(actor, input) {
      const prisma = getPrismaClient()
      const card = await prisma.reportCard.findUnique({
        where: {
          schoolId_academicTermId_pupilId: {
            schoolId: actor.schoolId,
            academicTermId: input.academicTermId,
            pupilId: input.pupilId,
          },
        },
        include: {
          versions: {
            orderBy: { version: 'desc' },
            take: 1,
            include: {
              batch: { select: { id: true, releaseStatus: true } },
            },
          },
        },
      })

      const latest = card?.versions[0]

      if (!card || !latest) {
        return null
      }

      return {
        reportCardId: card.id,
        version: latest.version,
        snapshot: latest.snapshot,
        storageKey: latest.storageKey,
        checksum: latest.checksum,
        batchId: latest.batch?.id ?? null,
        releaseStatus:
          (latest.batch?.releaseStatus as ReportReleaseStatus | undefined) ??
          null,
      }
    },

    async createBatch(actor, input, auditContext) {
      const prisma = getPrismaClient()
      const row = await prisma.reportGenerationBatch.create({
        data: {
          schoolId: actor.schoolId,
          academicYearId: input.academicYearId,
          academicTermId: input.academicTermId,
          classId: input.classId,
          scope: input.scope,
          status: input.status ?? 'PENDING',
          releaseStatus: input.releaseStatus ?? 'GENERATED',
          requestedByMembershipId: actor.membershipId,
          requestedPupilCount: input.requestedPupilCount,
          submittedAt: input.submittedAt ?? null,
          submittedByMembershipId: input.submittedByMembershipId ?? null,
        },
      })

      await audit(
        prisma,
        actor.schoolId,
        auditContext,
        input.auditAction ?? 'REPORT_BATCH_REQUESTED',
        'ReportGenerationBatch',
        row.id,
        {
          scope: row.scope,
          classId: row.classId,
          requestedPupilCount: row.requestedPupilCount,
          releaseStatus: row.releaseStatus,
        },
      )

      return mapReportBatch(row)
    },

    async createRequestBatch(actor, input, auditContext) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        // Serialise concurrent request submissions for the same reporting
        // period. The key is tenant-scoped, so unrelated schools never wait.
        const lockKey = `report-request:${actor.schoolId}:${input.academicYearId}:${input.academicTermId}`
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`

        const existingRows = await tx.reportGenerationBatch.findMany({
          where: {
            schoolId: actor.schoolId,
            academicYearId: input.academicYearId,
            academicTermId: input.academicTermId,
          },
          orderBy: { createdAt: 'desc' },
        })
        const blocking = existingRows
          .map(mapReportBatch)
          .find(blocksNewTermRequest)

        if (blocking) {
          throw new HttpError(
            409,
            'A report-generation request for this term is already awaiting generation.',
            { batchId: blocking.id },
          )
        }

        const row = await tx.reportGenerationBatch.create({
          data: {
            schoolId: actor.schoolId,
            academicYearId: input.academicYearId,
            academicTermId: input.academicTermId,
            classId: input.classId,
            scope: input.scope,
            status: input.status ?? 'PENDING',
            releaseStatus: input.releaseStatus ?? 'GENERATED',
            requestedByMembershipId: actor.membershipId,
            requestedPupilCount: input.requestedPupilCount,
            submittedAt: input.submittedAt ?? null,
            submittedByMembershipId: input.submittedByMembershipId ?? null,
          },
        })

        await audit(
          tx,
          actor.schoolId,
          auditContext,
          input.auditAction ?? 'REPORT_BATCH_REQUESTED',
          'ReportGenerationBatch',
          row.id,
          {
            scope: row.scope,
            classId: row.classId,
            requestedPupilCount: row.requestedPupilCount,
            releaseStatus: row.releaseStatus,
          },
        )

        return mapReportBatch(row)
      })
    },

    async markBatchRunning(actor, batchId, requestedPupilCount) {
      const prisma = getPrismaClient()
      // Claim the batch atomically. A concurrent click sees the RUNNING (or
      // already-completed) row and cannot start a second generation run.
      const result = await prisma.reportGenerationBatch.updateMany({
        where: {
          id: batchId,
          schoolId: actor.schoolId,
          status: { in: ['PENDING', 'FAILED', 'COMPLETED_WITH_FAILURES'] },
        },
        data: {
          status: 'RUNNING',
          startedAt: new Date(),
          ...(requestedPupilCount === undefined ? {} : { requestedPupilCount }),
        },
      })

      if (result.count === 0) {
        const exists = await prisma.reportGenerationBatch.findFirst({
          where: { id: batchId, schoolId: actor.schoolId },
          select: { id: true },
        })

        if (!exists) {
          throw new HttpError(404, 'Report generation batch not found')
        }

        throw new HttpError(
          409,
          'Report generation is already running or this request has already been generated.',
        )
      }
    },

    async recordBatchEvent(actor, batchId, action, metadata) {
      const prisma = getPrismaClient()
      await audit(
        prisma,
        actor.schoolId,
        {
          actorUserId: actor.userId,
          actorMembershipId: actor.membershipId,
        },
        action,
        'ReportGenerationBatch',
        batchId,
        metadata,
      )
    },

    async deleteFailures(actor, batchId, pupilIds) {
      if (pupilIds.length === 0) {
        return
      }

      const prisma = getPrismaClient()
      await prisma.reportGenerationFailure.deleteMany({
        where: {
          schoolId: actor.schoolId,
          batchId,
          pupilId: { in: pupilIds },
        },
      })
    },

    async recordReportAccess(actor, reportCardId, action, auditContext) {
      const prisma = getPrismaClient()
      await audit(
        prisma,
        actor.schoolId,
        auditContext,
        action,
        'ReportCard',
        reportCardId,
        { role: actor.role },
      )
    },

    async completeBatch(actor, batchId, result) {
      const prisma = getPrismaClient()
      const row = await prisma.reportGenerationBatch.update({
        where: { id: batchId, schoolId: actor.schoolId },
        data: {
          status: result.status,
          generatedCount: result.generatedCount,
          skippedCount: result.skippedCount,
          failedCount: result.failedCount,
          fatalError: result.fatalError ?? null,
          completedAt: new Date(),
        },
      })

      return mapReportBatch(row)
    },

    async recordFailure(actor, input) {
      const prisma = getPrismaClient()
      const row = await prisma.reportGenerationFailure.create({
        data: {
          schoolId: actor.schoolId,
          batchId: input.batchId,
          academicYearId: input.academicYearId,
          academicTermId: input.academicTermId,
          classId: input.classId,
          pupilId: input.pupilId,
          code: input.code,
          message: input.message,
        },
      })

      return {
        id: row.id,
        batchId: row.batchId,
        classId: row.classId,
        pupilId: row.pupilId,
        pupilName: null,
        code: row.code,
        message: row.message,
        createdAt: row.createdAt,
      }
    },

    async saveGeneratedReport(actor, input, auditContext) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        const card = await tx.reportCard.upsert({
          where: {
            schoolId_academicTermId_pupilId: {
              schoolId: actor.schoolId,
              academicTermId: input.academicTermId,
              pupilId: input.pupilId,
            },
          },
          create: {
            schoolId: actor.schoolId,
            academicYearId: input.academicYearId,
            academicTermId: input.academicTermId,
            classId: input.classId,
            pupilId: input.pupilId,
            currentVersion: 0,
            createdByMembershipId: actor.membershipId,
          },
          update: {},
        })

        const incremented = await tx.reportCard.update({
          where: { id: card.id },
          data: { currentVersion: { increment: 1 } },
          select: { currentVersion: true },
        })

        const row = await tx.reportCardVersion.create({
          data: {
            id: input.versionId,
            schoolId: actor.schoolId,
            reportCardId: card.id,
            batchId: input.batchId,
            version: incremented.currentVersion,
            snapshot: jsonValue(input.snapshot),
            storageKey: input.storageKey,
            checksum: input.checksum,
            byteSize: input.byteSize,
            pageCount: input.pageCount,
            generatedByMembershipId: actor.membershipId,
          },
          include: versionGeneratorInclude,
        })

        await audit(
          tx,
          actor.schoolId,
          auditContext,
          'REPORT_VERSION_GENERATED',
          'ReportCardVersion',
          row.id,
          {
            reportCardId: card.id,
            pupilId: input.pupilId,
            version: row.version,
            checksum: row.checksum,
            batchId: input.batchId,
          },
        )

        return mapVersion(row, generatorName(row))
      })
    },

    async listCards(actor, filter) {
      const prisma = getPrismaClient()
      const where: Prisma.ReportCardWhereInput = {
        schoolId: actor.schoolId,
        academicTermId: filter.academicTermId,
        ...(filter.classId ? { classId: filter.classId } : {}),
        ...(filter.accessibleClassIds
          ? { classId: { in: filter.accessibleClassIds } }
          : {}),
        ...(filter.releasedOnly
          ? {
              versions: {
                some: { batch: { releaseStatus: 'RELEASED' } },
              },
            }
          : {}),
      }

      const rows = await prisma.reportCard.findMany({
        where,
        include: {
          class: { select: { name: true } },
          pupil: {
            select: {
              firstName: true,
              lastName: true,
              otherNames: true,
              admissionNumber: true,
            },
          },
          _count: { select: { versions: true } },
        },
        orderBy: [
          { class: { sortOrder: 'asc' } },
          { pupil: { lastName: 'asc' } },
          { pupil: { firstName: 'asc' } },
        ],
      })

      return rows.map(
        (row): ReportCardRecord => ({
          id: row.id,
          schoolId: row.schoolId,
          academicYearId: row.academicYearId,
          academicTermId: row.academicTermId,
          classId: row.classId,
          className: row.class.name,
          pupilId: row.pupilId,
          pupilName: fullName(row.pupil),
          admissionNumber: row.pupil.admissionNumber,
          currentVersion: row.currentVersion,
          versionCount: row._count.versions,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        }),
      )
    },

    async getCard(actor, reportCardId) {
      const prisma = getPrismaClient()
      const row = await prisma.reportCard.findFirst({
        where: { id: reportCardId, schoolId: actor.schoolId },
        include: {
          class: { select: { name: true } },
          pupil: {
            select: {
              firstName: true,
              lastName: true,
              otherNames: true,
              admissionNumber: true,
            },
          },
          versions: {
            orderBy: { version: 'desc' },
            include: versionGeneratorInclude,
          },
        },
      })

      if (!row) {
        return null
      }

      const input = await prisma.reportInput.findUnique({
        where: {
          schoolId_academicTermId_pupilId: {
            schoolId: actor.schoolId,
            academicTermId: row.academicTermId,
            pupilId: row.pupilId,
          },
        },
      })

      return {
        card: {
          id: row.id,
          schoolId: row.schoolId,
          academicYearId: row.academicYearId,
          academicTermId: row.academicTermId,
          classId: row.classId,
          className: row.class.name,
          pupilId: row.pupilId,
          pupilName: fullName(row.pupil),
          admissionNumber: row.pupil.admissionNumber,
          currentVersion: row.currentVersion,
          versionCount: row.versions.length,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        },
        versions: row.versions.map((version) =>
          mapVersion(version, generatorName(version)),
        ),
        input: input ? mapInput(input) : null,
      }
    },

    async getVersion(actor, reportCardId, version) {
      const prisma = getPrismaClient()
      const card = await prisma.reportCard.findFirst({
        where: { id: reportCardId, schoolId: actor.schoolId },
        include: {
          class: { select: { name: true } },
          pupil: {
            select: {
              firstName: true,
              lastName: true,
              otherNames: true,
              admissionNumber: true,
            },
          },
        },
      })

      if (!card) {
        return null
      }

      const row = await prisma.reportCardVersion.findUnique({
        where: {
          reportCardId_version: { reportCardId, version },
        },
        include: versionGeneratorInclude,
      })

      if (!row || row.schoolId !== actor.schoolId) {
        return null
      }

      return {
        card: {
          id: card.id,
          schoolId: card.schoolId,
          academicYearId: card.academicYearId,
          academicTermId: card.academicTermId,
          classId: card.classId,
          className: card.class.name,
          pupilId: card.pupilId,
          pupilName: fullName(card.pupil),
          admissionNumber: card.pupil.admissionNumber,
          currentVersion: card.currentVersion,
          versionCount: card.currentVersion,
          createdAt: card.createdAt,
          updatedAt: card.updatedAt,
        },
        version: mapVersion(row, generatorName(row)),
        storageKey: row.storageKey,
      }
    },

    async listBatches(actor, filter) {
      const prisma = getPrismaClient()
      const where: Prisma.ReportGenerationBatchWhereInput = {
        schoolId: actor.schoolId,
        ...(filter.academicTermId
          ? { academicTermId: filter.academicTermId }
          : {}),
        ...(filter.classIds ? { classId: { in: filter.classIds } } : {}),
      }

      const rows = await prisma.reportGenerationBatch.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
      })

      return rows.map(mapReportBatch)
    },

    async getBatch(actor, batchId) {
      const prisma = getPrismaClient()
      const row = await prisma.reportGenerationBatch.findFirst({
        where: { id: batchId, schoolId: actor.schoolId },
        include: {
          class: { select: { name: true } },
          academicTerm: { select: { name: true } },
          failures: {
            orderBy: [{ createdAt: 'asc' }],
            include: {
              pupil: {
                select: {
                  firstName: true,
                  lastName: true,
                  otherNames: true,
                },
              },
            },
          },
          versions: {
            orderBy: [{ generatedAt: 'desc' }],
            include: {
              reportCard: {
                include: {
                  pupil: {
                    select: {
                      firstName: true,
                      lastName: true,
                      otherNames: true,
                    },
                  },
                },
              },
            },
          },
        },
      })

      if (!row) {
        return null
      }

      const failures: ReportFailureRecord[] = row.failures.map((failure) => ({
        id: failure.id,
        batchId: failure.batchId,
        classId: failure.classId,
        pupilId: failure.pupilId,
        pupilName: failure.pupil ? fullName(failure.pupil) : null,
        code: failure.code,
        message: failure.message,
        createdAt: failure.createdAt,
      }))

      return {
        ...mapReportBatch(row),
        className: row.class?.name ?? null,
        academicTermName: row.academicTerm.name,
        failures,
        versions: row.versions.map((version) => ({
          id: version.id,
          reportCardId: version.reportCardId,
          pupilId: version.reportCard.pupilId,
          pupilName: fullName(version.reportCard.pupil),
          classId: version.reportCard.classId,
          version: version.version,
          generatedAt: version.generatedAt,
          acceptedResultCount: acceptedSubmissionsFromSnapshot(
            version.snapshot,
          ),
        })),
      } satisfies ReportBatchDetail
    },
  }

  return repo
}
