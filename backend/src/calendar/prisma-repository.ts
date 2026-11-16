import { getPrismaClient } from '../lib/prisma.js'
import type { Prisma } from '../generated/prisma/client.js'
import { isUniqueConstraintError } from '../auth/prisma-repository.js'
import { HttpError } from '../errors/http-error.js'
import { initialTermLifecycles, todayInCalendar, validateCalendarConfiguration } from './logic.js'
import type {
  AcademicYearCreateInput,
  AcademicYearPlan,
  AcademicYearUpdateInput,
  ActiveSchoolSummary,
  ApplySchoolResult,
  CalendarCompletionResult,
  CalendarResetInput,
  CalendarRepository,
  CalendarTermConfig,
  CalendarTermRecord,
  CalendarTermUpdateInput,
  CalendarTransitionInput,
  CalendarTransitionRecord,
  CalendarYearRecord,
  SchoolCalendarRecord,
} from './types.js'

type Tx = Prisma.TransactionClient

function dateOnly(value: Date | string): string {
  return typeof value === 'string'
    ? value.slice(0, 10)
    : value.toISOString().slice(0, 10)
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

function assertValidCalendar(input: {
  startsOn: string
  endsOn: string
  terms: CalendarTermConfig[]
}): void {
  const issues = validateCalendarConfiguration(input)

  if (issues.length > 0) {
    throw new HttpError(400, 'Validation failed', issues)
  }
}

interface TermLifecycle {
  status: 'PLANNED' | 'OPEN' | 'CLOSED'
  isCurrent: boolean
  openedAt: Date | null
  closedAt: Date | null
}

function lifecycleForTerm(
  term: { startsOn: string; endsOn: string },
  today: string,
  confirmed: boolean,
  at: Date,
): TermLifecycle {
  if (!confirmed) {
    return {
      status: 'PLANNED',
      isCurrent: false,
      openedAt: null,
      closedAt: null,
    }
  }

  if (term.startsOn <= today && today <= term.endsOn) {
    return {
      status: 'OPEN',
      isCurrent: true,
      openedAt: at,
      closedAt: null,
    }
  }

  if (term.endsOn < today) {
    return {
      status: 'CLOSED',
      isCurrent: false,
      openedAt: parseDate(term.startsOn),
      closedAt: parseDate(term.endsOn),
    }
  }

  return {
    status: 'PLANNED',
    isCurrent: false,
    openedAt: null,
    closedAt: null,
  }
}

async function recordCalendarAudit(
  tx: Tx,
  input: {
    schoolId: string
    action: string
    entityType: 'AcademicYear' | 'AcademicTerm'
    entityId: string | null
    metadata: Record<string, unknown>
    audit: { actorUserId: string; ipAddress?: string | null; userAgent?: string | null }
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      schoolId: input.schoolId,
      actorUserId: input.audit.actorUserId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: jsonValue(input.metadata),
      ipAddress: input.audit.ipAddress ?? null,
      userAgent: input.audit.userAgent ?? null,
    },
  })
}

function yearSignature(year: {
  name: string
  startsOn: string
  endsOn: string
  terms: CalendarTermRecord[]
}): Record<string, unknown> {
  return {
    name: year.name,
    startsOn: year.startsOn,
    endsOn: year.endsOn,
    terms: year.terms
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map((term) => ({
        sequence: term.sequence,
        name: term.name,
        startsOn: term.startsOn,
        endsOn: term.endsOn,
        assessmentDeadline: term.assessmentDeadline,
        examinationStartsOn: term.examinationStartsOn,
        examinationEndsOn: term.examinationEndsOn,
        datesConfirmed: term.datesConfirmedAt !== null,
      })),
  }
}

function jsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined
  }

  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function mapTerm(term: {
  id: string
  schoolId: string
  academicYearId: string
  name: string
  sequence: number
  startsOn: Date
  endsOn: Date
  isCurrent: boolean
  status: string
  openedAt: Date | null
  closedAt: Date | null
  reportsPreparedAt: Date | null
  assessmentDeadline: Date | null
  examinationStartsOn: Date | null
  examinationEndsOn: Date | null
  datesConfirmedAt: Date | null
}): CalendarTermRecord {
  return {
    id: term.id,
    schoolId: term.schoolId,
    academicYearId: term.academicYearId,
    name: term.name,
    sequence: term.sequence,
    startsOn: dateOnly(term.startsOn),
    endsOn: dateOnly(term.endsOn),
    isCurrent: term.isCurrent,
    status: term.status as CalendarTermRecord['status'],
    openedAt: term.openedAt,
    closedAt: term.closedAt,
    reportsPreparedAt: term.reportsPreparedAt,
    assessmentDeadline: term.assessmentDeadline
      ? dateOnly(term.assessmentDeadline)
      : null,
    examinationStartsOn: term.examinationStartsOn
      ? dateOnly(term.examinationStartsOn)
      : null,
    examinationEndsOn: term.examinationEndsOn
      ? dateOnly(term.examinationEndsOn)
      : null,
    datesConfirmedAt: term.datesConfirmedAt,
  }
}

function mapYear(year: {
  id: string
  schoolId: string
  name: string
  startsOn: Date
  endsOn: Date
  isCurrent: boolean
  isArchived: boolean
  archivedAt: Date | null
  terms: Parameters<typeof mapTerm>[0][]
}): CalendarYearRecord {
  return {
    id: year.id,
    schoolId: year.schoolId,
    name: year.name,
    startsOn: dateOnly(year.startsOn),
    endsOn: dateOnly(year.endsOn),
    isCurrent: year.isCurrent,
    isArchived: year.isArchived,
    archivedAt: year.archivedAt,
    terms: year.terms.map(mapTerm),
  }
}

async function findTermOrThrow(
  tx: Tx | ReturnType<typeof getPrismaClient>,
  schoolId: string,
  termId: string,
) {
  const term = await tx.academicTerm.findFirst({
    where: { id: termId, schoolId },
  })

  if (!term) {
    throw new HttpError(404, 'Academic term not found')
  }

  return term
}

export function createPrismaCalendarRepository(): CalendarRepository {
  return {
    async listActiveSchoolIds() {
      const schools = await getPrismaClient().school.findMany({
        where: { isActive: true },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      })

      return schools.map((school) => school.id)
    },

    async listActiveSchools(): Promise<ActiveSchoolSummary[]> {
      return getPrismaClient().school.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      })
    },

    async getSchoolCalendar(schoolId): Promise<SchoolCalendarRecord | null> {
      const school = await getPrismaClient().school.findFirst({
        where: { id: schoolId, isActive: true },
        select: {
          id: true,
          name: true,
          timezone: true,
          academicYears: {
            orderBy: [{ startsOn: 'desc' }, { name: 'asc' }],
            include: { terms: { orderBy: { sequence: 'asc' } } },
          },
        },
      })

      if (!school) {
        return null
      }

      return {
        schoolId: school.id,
        schoolName: school.name,
        timezone: school.timezone,
        years: school.academicYears.map(mapYear),
      }
    },

    async ensureAcademicYear(
      schoolId,
      plan: AcademicYearPlan,
      options: { today?: string } = {},
    ) {
      const prisma = getPrismaClient()

      const existing = await prisma.academicYear.findFirst({
        where: { schoolId, name: plan.name },
        select: { id: true },
      })

      if (existing) {
        return false
      }

      const today = options.today ?? todayInCalendar(new Date())
      const lifecycles = initialTermLifecycles(plan, today)
      const containsToday = plan.startsOn <= today && today <= plan.endsOn

      try {
        await prisma.$transaction(async (tx) => {
          // The year containing today is the current academic year. Any stale
          // current flag is cleared so there is exactly one current year.
          if (containsToday) {
            await tx.academicYear.updateMany({
              where: { schoolId, isCurrent: true },
              data: { isCurrent: false },
            })
          }

          await tx.academicYear.create({
            data: {
              schoolId,
              name: plan.name,
              startsOn: parseDate(plan.startsOn),
              endsOn: parseDate(plan.endsOn),
              isCurrent: containsToday,
              terms: {
                create: plan.terms.map((term, index) => {
                  const lifecycle = lifecycles[index]!

                  return {
                    schoolId,
                    name: term.name,
                    sequence: term.sequence,
                    startsOn: parseDate(term.startsOn),
                    endsOn: parseDate(term.endsOn),
                    isCurrent: lifecycle.isCurrent,
                    status: lifecycle.status,
                    openedAt: lifecycle.openedAt
                      ? parseDate(lifecycle.openedAt)
                      : null,
                    closedAt: lifecycle.closedAt
                      ? parseDate(lifecycle.closedAt)
                      : null,
                    reportsPreparedAt: lifecycle.reportsPreparedAt
                      ? parseDate(lifecycle.reportsPreparedAt)
                      : null,
                  }
                }),
              },
            },
          })

          await tx.auditLog.create({
            data: {
              schoolId,
              action: 'ACADEMIC_YEAR_INITIALIZED',
              entityType: 'AcademicYear',
              metadata: jsonValue({
                name: plan.name,
                startsOn: plan.startsOn,
                endsOn: plan.endsOn,
                terms: plan.terms.map((term) => term.name),
              }),
            },
          })
        })

        return true
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          return false
        }

        throw error
      }
    },

    async openTerm(schoolId, termId, at) {
      const prisma = getPrismaClient()

      await prisma.$transaction(async (tx) => {
        const term = await findTermOrThrow(tx, schoolId, termId)

        if (term.status === 'CLOSED') {
          throw new HttpError(409, 'A closed term cannot be reopened')
        }

        if (dateOnly(at) < dateOnly(term.startsOn)) {
          throw new HttpError(409, 'A term cannot be opened before its opening date')
        }

        await tx.academicTerm.updateMany({
          where: { schoolId, isCurrent: true },
          data: { isCurrent: false },
        })
        await tx.academicYear.updateMany({
          where: { schoolId, isCurrent: true },
          data: { isCurrent: false },
        })
        await tx.academicTerm.update({
          where: { id: termId },
          data: {
            status: 'OPEN',
            isCurrent: true,
            openedAt: term.openedAt ?? at,
          },
        })
        await tx.academicYear.update({
          where: { id: term.academicYearId },
          data: { isCurrent: true },
        })
        await tx.auditLog.create({
          data: {
            schoolId,
            action: 'ACADEMIC_TERM_OPENED',
            entityType: 'AcademicTerm',
            entityId: termId,
            metadata: jsonValue({ openedAt: at.toISOString() }),
          },
        })
      })
    },

    async markReportsPrepared(schoolId, termId, at) {
      const prisma = getPrismaClient()

      await prisma.$transaction(async (tx) => {
        const term = await findTermOrThrow(tx, schoolId, termId)

        if (term.reportsPreparedAt) {
          return
        }

        await tx.academicTerm.update({
          where: { id: termId },
          data: { reportsPreparedAt: at },
        })
        await tx.auditLog.create({
          data: {
            schoolId,
            action: 'ACADEMIC_TERM_REPORTS_PREPARED',
            entityType: 'AcademicTerm',
            entityId: termId,
            metadata: jsonValue({ preparedAt: at.toISOString() }),
          },
        })
      })
    },

    async closeTerm(schoolId, termId, at) {
      const prisma = getPrismaClient()

      await prisma.$transaction(async (tx) => {
        const term = await findTermOrThrow(tx, schoolId, termId)

        if (term.status === 'CLOSED') {
          return
        }

        if (term.status !== 'OPEN') {
          throw new HttpError(409, 'Only an open term can be closed')
        }

        await tx.academicTerm.update({
          where: { id: termId },
          data: {
            status: 'CLOSED',
            isCurrent: false,
            closedAt: term.closedAt ?? at,
          },
        })
        await tx.auditLog.create({
          data: {
            schoolId,
            action: 'ACADEMIC_TERM_CLOSED',
            entityType: 'AcademicTerm',
            entityId: termId,
            metadata: jsonValue({ closedAt: at.toISOString() }),
          },
        })
      })
    },

    async finalizeYear(schoolId, yearId, nextPlan, at) {
      const prisma = getPrismaClient()

      return prisma.$transaction(async (tx) => {
        const year = await tx.academicYear.findFirst({
          where: { id: yearId, schoolId },
          include: { terms: { orderBy: { sequence: 'asc' } } },
        })

        if (!year) {
          throw new HttpError(404, 'Academic year not found')
        }

        let nextYear = await tx.academicYear.findFirst({
          where: { schoolId, name: nextPlan.name },
        })

        if (year.isArchived && nextYear) {
          return { nextYearId: nextYear.id, promotedCount: 0 }
        }

        if (!nextYear) {
          const nextToday = todayInCalendar(at)
          const lifecycles = initialTermLifecycles(nextPlan, nextToday)

          nextYear = await tx.academicYear.create({
            data: {
              schoolId,
              name: nextPlan.name,
              startsOn: parseDate(nextPlan.startsOn),
              endsOn: parseDate(nextPlan.endsOn),
              isCurrent: false,
              terms: {
                create: nextPlan.terms.map((term, index) => {
                  const lifecycle = lifecycles[index]!

                  return {
                    schoolId,
                    name: term.name,
                    sequence: term.sequence,
                    startsOn: parseDate(term.startsOn),
                    endsOn: parseDate(term.endsOn),
                    isCurrent: lifecycle.isCurrent,
                    status: lifecycle.status,
                    openedAt: lifecycle.openedAt
                      ? parseDate(lifecycle.openedAt)
                      : null,
                    closedAt: lifecycle.closedAt
                      ? parseDate(lifecycle.closedAt)
                      : null,
                    reportsPreparedAt: lifecycle.reportsPreparedAt
                      ? parseDate(lifecycle.reportsPreparedAt)
                      : null,
                  }
                }),
              },
            },
          })
        }

        const enrollments = await tx.pupilEnrollment.findMany({
          where: { schoolId, academicYearId: year.id, status: 'ACTIVE' },
          include: { class: { select: { sortOrder: true } } },
        })

        let promotedCount = 0

        for (const enrollment of enrollments) {
          const existing = await tx.pupilEnrollment.findFirst({
            where: {
              schoolId,
              pupilId: enrollment.pupilId,
              academicYearId: nextYear.id,
            },
            select: { id: true },
          })

          const nextClass = await tx.schoolClass.findFirst({
            where: {
              schoolId,
              isArchived: false,
              sortOrder: { gt: enrollment.class.sortOrder },
            },
            orderBy: { sortOrder: 'asc' },
            select: { id: true },
          })

          await tx.pupilEnrollment.update({
            where: { id: enrollment.id },
            data: { status: 'COMPLETED', endedOn: year.endsOn },
          })

          if (existing) {
            continue
          }

          if (!nextClass) {
            await tx.pupil.update({
              where: { id: enrollment.pupilId },
              data: { currentClassId: null },
            })
            continue
          }

          await tx.pupilEnrollment.create({
            data: {
              schoolId,
              pupilId: enrollment.pupilId,
              classId: nextClass.id,
              academicYearId: nextYear.id,
              status: 'ACTIVE',
              startedOn: parseDate(nextPlan.startsOn),
            },
          })
          await tx.pupil.update({
            where: { id: enrollment.pupilId },
            data: { currentClassId: nextClass.id },
          })
          promotedCount += 1
        }

        await tx.academicTerm.updateMany({
          where: { academicYearId: year.id, isCurrent: true },
          data: { isCurrent: false, status: 'CLOSED' },
        })
        await tx.academicYear.update({
          where: { id: year.id },
          data: {
            isArchived: true,
            archivedAt: year.archivedAt ?? at,
            isCurrent: false,
          },
        })
        await tx.academicYear.update({
          where: { id: nextYear.id },
          data: { isCurrent: true },
        })
        await tx.auditLog.create({
          data: {
            schoolId,
            action: 'ACADEMIC_YEAR_FINALIZED',
            entityType: 'AcademicYear',
            entityId: year.id,
            metadata: jsonValue({
              archivedYear: year.name,
              nextYear: nextPlan.name,
              promotedCount,
            }),
          },
        })

        return { nextYearId: nextYear.id, promotedCount }
      })
    },

    async updateTermDates(schoolId, termId, input, audit) {
      const prisma = getPrismaClient()

      if (input.startsOn > input.endsOn) {
        throw new HttpError(400, 'End date must be on or after the start date')
      }

      return prisma.$transaction(async (tx) => {
        const term = await findTermOrThrow(tx, schoolId, termId)
        const year = await tx.academicYear.findFirst({
          where: { id: term.academicYearId, schoolId },
          select: { startsOn: true, endsOn: true },
        })

        if (!year) {
          throw new HttpError(404, 'Academic year not found')
        }

        if (
          input.startsOn < dateOnly(year.startsOn) ||
          input.endsOn > dateOnly(year.endsOn)
        ) {
          throw new HttpError(
            400,
            'Term dates must fall within the academic year',
          )
        }

        const updated = await tx.academicTerm.update({
          where: { id: termId },
          data: {
            startsOn: parseDate(input.startsOn),
            endsOn: parseDate(input.endsOn),
          },
        })

        await tx.auditLog.create({
          data: {
            schoolId,
            actorUserId: audit.actorUserId,
            action: 'ACADEMIC_TERM_DATES_CORRECTED',
            entityType: 'AcademicTerm',
            entityId: termId,
            metadata: jsonValue({
              startsOn: input.startsOn,
              endsOn: input.endsOn,
            }),
          },
        })

        return mapTerm(updated)
      })
    },

    async completion(schoolId, termId): Promise<CalendarCompletionResult> {
      const prisma = getPrismaClient()
      const term = await prisma.academicTerm.findFirst({
        where: { id: termId, schoolId },
        select: { id: true, academicYearId: true },
      })

      if (!term) {
        throw new HttpError(404, 'Academic term not found')
      }

      const [classSubjects, accepted, enrollments] = await Promise.all([
        prisma.classSubject.findMany({
          where: {
            schoolId,
            isActive: true,
            class: { isArchived: false },
            subject: { isArchived: false },
          },
          select: {
            classId: true,
            subjectId: true,
            class: { select: { name: true } },
            subject: { select: { name: true } },
          },
          orderBy: [{ classId: 'asc' }, { sortOrder: 'asc' }],
        }),
        prisma.resultSubmission.findMany({
          where: { schoolId, academicTermId: termId, status: 'ACCEPTED' },
          select: { classId: true, subjectId: true },
        }),
        prisma.pupilEnrollment.findMany({
          where: {
            schoolId,
            academicYearId: term.academicYearId,
            status: 'ACTIVE',
          },
          select: { classId: true },
        }),
      ])

      // A class subject is only a required assessment when the class actually
      // has at least one actively enrolled pupil. A school that has set up its
      // classes and subjects but not enrolled pupils must not block the term.
      const activeClassIds = new Set(
        enrollments.map((enrollment) => enrollment.classId),
      )
      const requiredClassSubjects = classSubjects.filter((item) =>
        activeClassIds.has(item.classId),
      )

      const acceptedKeys = new Set(
        accepted.map((item) => `${item.classId}:${item.subjectId}`),
      )
      const missing = requiredClassSubjects
        .filter(
          (item) => !acceptedKeys.has(`${item.classId}:${item.subjectId}`),
        )
        .map((item) => ({
          classId: item.classId,
          className: item.class.name,
          subjectId: item.subjectId,
          subjectName: item.subject.name,
        }))

      return {
        complete: missing.length === 0,
        requiredCount: requiredClassSubjects.length,
        acceptedCount: requiredClassSubjects.length - missing.length,
        missing,
      }
    },

    async hasActivePupils(schoolId, termId) {
      const prisma = getPrismaClient()
      const term = await prisma.academicTerm.findFirst({
        where: { id: termId, schoolId },
        select: { academicYearId: true },
      })

      if (!term) {
        throw new HttpError(404, 'Academic term not found')
      }

      const count = await prisma.pupilEnrollment.count({
        where: {
          schoolId,
          academicYearId: term.academicYearId,
          status: 'ACTIVE',
        },
      })

      return count > 0
    },

    async findSystemActorUserId() {
      const user = await getPrismaClient().user.findFirst({
        where: { isPlatformAdmin: true, isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      })

      return user?.id ?? null
    },

    async recordTransition(input: CalendarTransitionInput) {
      await getPrismaClient().academicCalendarTransition.create({
        data: {
          schoolId: input.schoolId,
          academicYearId: input.academicYearId ?? null,
          academicTermId: input.academicTermId ?? null,
          action: input.action,
          status: input.status,
          trigger: input.trigger,
          scheduledFor: input.scheduledFor
            ? parseDate(input.scheduledFor)
            : null,
          startedAt: input.startedAt ?? null,
          completedAt: input.completedAt ?? null,
          message: input.message ?? null,
          metadata: jsonValue(input.metadata),
        },
      })
    },

    async listTransitions(
      schoolId: string,
      limit: number,
    ): Promise<CalendarTransitionRecord[]> {
      const rows = await getPrismaClient().academicCalendarTransition.findMany({
        where: { schoolId },
        orderBy: { createdAt: 'desc' },
        take: Math.max(1, Math.min(limit, 200)),
      })

      return rows.map((row) => ({
        id: row.id,
        schoolId: row.schoolId,
        academicYearId: row.academicYearId,
        academicTermId: row.academicTermId,
        action: row.action,
        status: row.status,
        trigger: row.trigger,
        scheduledFor: row.scheduledFor ? dateOnly(row.scheduledFor) : null,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        message: row.message,
        metadata: row.metadata,
        createdAt: row.createdAt,
      }))
    },
  }
}

export { parseDate as parseCalendarDate }
