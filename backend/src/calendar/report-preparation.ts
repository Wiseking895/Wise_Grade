import type { ReportService } from '../reports/service.js'
import type { CalendarRepository, PrepareReports } from './types.js'

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message.slice(0, 1000)
  }

  return 'Report preparation failed'
}

/**
 * Report preparation is performed by a platform actor. School administrators
 * neither trigger nor approve automatic term-end preparation, and the existing
 * payment-dependent release workflow remains unchanged.
 */
export function createReportPreparation(
  reportService: ReportService,
  repository: CalendarRepository,
): PrepareReports {
  return async (request) => {
    const actorUserId = await repository.findSystemActorUserId()

    if (!actorUserId) {
      return {
        prepared: false,
        message:
          'No active platform administrator is available to prepare reports',
      }
    }

    try {
      const result = await reportService.generate(
        {
          schoolId: request.schoolId,
          userId: actorUserId,
          membershipId: null,
          role: 'PLATFORM_SUPER_ADMIN',
        },
        {
          academicYearId: request.academicYearId,
          academicTermId: request.academicTermId,
          scope: 'TERM',
        },
        {
          actorUserId,
          actorMembershipId: null,
          ipAddress: null,
          userAgent: 'gradely-calendar-scheduler',
        },
      )

      return {
        prepared: true,
        batchId: result.batch.id,
        message: `${result.batch.generatedCount} generated, ${result.batch.failedCount} failed`,
      }
    } catch (error) {
      return { prepared: false, message: messageOf(error) }
    }
  }
}
