import { Router, type Request, type RequestHandler } from 'express'
import type { z } from 'zod'
import { parseBody } from '../auth/validation.js'
import type {
  AuthRepository,
  MembershipRecord,
} from '../auth/repository.js'
import { HttpError } from '../errors/http-error.js'
import { createAuthenticate } from '../middleware/authenticate.js'
import {
  createAuthenticateEither,
  denySubjectSessions,
} from '../middleware/subject-authenticate.js'
import {
  requirePlatformAdmin,
  requireRole,
  requireSchoolAccess,
} from '../middleware/authorize.js'
import { requireTrustedOrigin } from '../middleware/csrf.js'
import { resolveClassTeacherClassId } from '../assessment/class-resolution.js'
import type {
  AssessmentActor,
  AssessmentAuditContext,
  AssessmentRepository,
} from '../assessment/repository.js'
import {
  assessmentSettingsSchema,
  classTeacherPermissionSchema,
  reviewSubmissionSchema,
  saveDraftSchema,
  scoreEntryQuerySchema,
  submissionQuerySchema,
  submitResultsSchema,
} from '../assessment/validation.js'

function requireAccess(req: Request): MembershipRecord {
  if (!req.schoolAccess) {
    throw new HttpError(403, 'You do not have access to this school')
  }

  return req.schoolAccess
}

function routeParam(req: Request, name: string): string {
  const value = req.params[name]

  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(400, 'Invalid route parameter')
  }

  return value
}

function actorFromRequest(req: Request): AssessmentActor {
  const access = requireAccess(req)

  // A restricted subject session has no User or Membership. Its assignment is
  // the only authority it holds.
  if (req.subjectAuth) {
    return {
      schoolId: access.schoolId,
      userId: null,
      membershipId: null,
      assignmentId: req.subjectAuth.assignmentId,
      role: 'SUBJECT_TEACHER',
    }
  }

  if (!req.auth) {
    throw new HttpError(401, 'Authentication required')
  }

  return {
    schoolId: access.schoolId,
    userId: req.auth.user.id,
    membershipId: access.id,
    role: access.role,
  }
}

function auditFromRequest(req: Request): AssessmentAuditContext {
  const access = requireAccess(req)

  if (req.subjectAuth) {
    return {
      actorUserId: null,
      actorMembershipId: null,
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    }
  }

  if (!req.auth) {
    throw new HttpError(401, 'Authentication required')
  }

  return {
    actorUserId: req.auth.user.id,
    actorMembershipId: access.id,
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  }
}

function parseQuery<T>(schema: z.ZodType<T>, query: unknown): T {
  const result = schema.safeParse(query)

  if (!result.success) {
    throw new HttpError(
      400,
      'Validation failed',
      result.error.issues.map((issue) => ({
        field: issue.path.map(String).join('.') || 'query',
        message: issue.message,
      })),
    )
  }

  return result.data
}

/**
 * Phase 4 assessment routes.
 *
 * Every route is mounted beneath `/:schoolId/assessments`, so ACTIVE school
 * membership is resolved once. Role checks are layered on top, and the
 * repository independently re-checks class/subject authorization for every
 * score read or write. A platform administrator has no membership and is
 * therefore denied before reaching any pupil data.
 */
export function createAssessmentsRouter(
  authRepository: AuthRepository,
  assessmentRepository: AssessmentRepository,
  trustedOrigins: string[],
): Router {
  const router = Router()
  const authenticate = createAuthenticate(authRepository)
  const authenticateEither = createAuthenticateEither(
    authRepository,
    authenticate,
  )
  const schoolAccess = requireSchoolAccess(authRepository)
  const trustedOrigin = requireTrustedOrigin(trustedOrigins)
  const admin = requireRole('SCHOOL_ADMIN')
  const teacher = requireRole('CLASS_TEACHER', 'SUBJECT_TEACHER')

  router.use(
    '/:schoolId/assessments',
    authenticateEither,
    schoolAccess,
    trustedOrigin,
  )

  async function authorizedPairs(req: Request): Promise<Set<string> | null> {
    const access = requireAccess(req)

    if (access.role === 'SCHOOL_ADMIN') {
      return null
    }

    const permitted = await assessmentRepository.listAuthorizedClassSubjects(
      actorFromRequest(req),
    )

    return new Set(
      permitted.map((item) => `${item.classId}:${item.subjectId}`),
    )
  }

  /**
   * A single-class class teacher never selects a class. Their active assignment
   * is authoritative, so a manipulated classId is replaced server-side. Teachers
   * with multiple active assignments must still name one of them.
   */
  async function resolveClassIdForActor(
    req: Request,
    requestedClassId: string,
  ): Promise<string> {
    if (req.subjectAuth) {
      return req.subjectAuth.classId
    }

    const actor = actorFromRequest(req)

    if (actor.role !== 'CLASS_TEACHER') {
      return requestedClassId
    }

    const classIds = await assessmentRepository.listClassTeacherClassIds(actor)

    return resolveClassTeacherClassId({
      role: actor.role,
      assignedClassIds: classIds,
      requestedClassId,
    })
  }

  async function assertSubmissionReadAccess(
    req: Request,
    submission: {
      classId: string
      subjectId: string
    },
  ): Promise<void> {
    const actor = actorFromRequest(req)

    if (actor.role === 'SCHOOL_ADMIN') {
      return
    }

    const allowed = await assessmentRepository.canViewScoreEntry(
      actor,
      submission.classId,
      submission.subjectId,
    )

    if (!allowed) {
      throw new HttpError(403, 'You do not have access to this result submission')
    }
  }

  // -----------------------------------------------------------------------
  // Settings and class-teacher authorization
  // -----------------------------------------------------------------------

  router.get(
    '/:schoolId/assessments/settings',
    denySubjectSessions(),
    async (req, res, next) => {
    try {
      const access = requireAccess(req)
      const settings = await assessmentRepository.getSettings(access.schoolId)
      res.status(200).json({ data: { settings } })
    } catch (error) {
      next(error)
    }
  })

  router.patch(
    '/:schoolId/assessments/settings',
    admin,
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const input = parseBody(assessmentSettingsSchema, req.body)
        const settings = await assessmentRepository.updateSettings(
          access.schoolId,
          input.classTeacherEntryMode,
          auditFromRequest(req),
        )
        res.status(200).json({ data: { settings } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/:schoolId/assessments/class-teacher-permissions',
    admin,
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const permissions =
          await assessmentRepository.listClassTeacherPermissions(access.schoolId)
        res.status(200).json({ data: { permissions } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/:schoolId/assessments/class-teacher-permissions',
    admin,
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const input = parseBody(classTeacherPermissionSchema, req.body)
        const permission =
          await assessmentRepository.grantClassTeacherPermission(
            access.schoolId,
            input,
            auditFromRequest(req),
          )
        res.status(201).json({ data: { permission } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.delete(
    '/:schoolId/assessments/class-teacher-permissions/:permissionId',
    admin,
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        await assessmentRepository.revokeClassTeacherPermission(
          access.schoolId,
          routeParam(req, 'permissionId'),
          auditFromRequest(req),
        )
        res.status(200).json({ data: { message: 'Permission revoked' } })
      } catch (error) {
        next(error)
      }
    },
  )

  // -----------------------------------------------------------------------
  // System-managed configuration
  // -----------------------------------------------------------------------

  // Assessment policies and grading schemes are managed by the platform. The
  // school workspace has no configuration UI, and direct calls are rejected so
  // hiding navigation is not the only protection.
  const configurationLocked: RequestHandler = (_req, _res, next) => {
    next(
      new HttpError(
        403,
        'Assessment policies and grading schemes are system-managed and cannot be configured from the school workspace.',
      ),
    )
  }

  router.all(
    '/:schoolId/assessments/grading-schemes',
    configurationLocked,
  )
  router.all(
    '/:schoolId/assessments/grading-schemes/:schemeId',
    configurationLocked,
  )
  router.all(
    '/:schoolId/assessments/grading-schemes/:schemeId/activate',
    configurationLocked,
  )
  router.all('/:schoolId/assessments/policies', configurationLocked)
  router.all(
    '/:schoolId/assessments/policies/:policyId',
    configurationLocked,
  )
  router.all(
    '/:schoolId/assessments/policies/:policyId/activate',
    configurationLocked,
  )

  // -----------------------------------------------------------------------
  // Score entry
  // -----------------------------------------------------------------------

  router.get(
    '/:schoolId/assessments/class-subjects',
    teacher,
    async (req, res, next) => {
      try {
        const permitted =
          await assessmentRepository.listAuthorizedClassSubjects(
            actorFromRequest(req),
          )
        res.status(200).json({ data: { classSubjects: permitted } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get('/:schoolId/assessments/score-entry', teacher, async (req, res, next) => {
    try {
      const query = parseQuery(scoreEntryQuerySchema, req.query)
      const classId = await resolveClassIdForActor(req, query.classId)
      const scoreEntry = await assessmentRepository.getScoreEntry(
        actorFromRequest(req),
        { ...query, classId },
      )
      res.status(200).json({ data: { scoreEntry } })
    } catch (error) {
      next(error)
    }
  })

  router.put('/:schoolId/assessments/score-entry', teacher, async (req, res, next) => {
    try {
      const input = parseBody(saveDraftSchema, req.body)
      const classId = await resolveClassIdForActor(req, input.classId)
      const scoreEntry = await assessmentRepository.saveDraft(
        actorFromRequest(req),
        { ...input, classId },
        auditFromRequest(req),
      )
      res.status(200).json({ data: { scoreEntry } })
    } catch (error) {
      next(error)
    }
  })

  router.post(
    '/:schoolId/assessments/score-entry/submit',
    teacher,
    async (req, res, next) => {
      try {
        const input = parseBody(submitResultsSchema, req.body)
        const classId = await resolveClassIdForActor(req, input.classId)
        const submission = await assessmentRepository.submitResults(
          actorFromRequest(req),
          { ...input, classId },
          auditFromRequest(req),
        )
        res.status(200).json({ data: { submission } })
      } catch (error) {
        next(error)
      }
    },
  )

  // -----------------------------------------------------------------------
  // Submission tracking and review
  // -----------------------------------------------------------------------

  router.get('/:schoolId/assessments/submissions', teacher, async (req, res, next) => {
    try {
      const access = requireAccess(req)
      const query = parseQuery(submissionQuerySchema, req.query)
      const pairs = await authorizedPairs(req)
      const submissions = await assessmentRepository.listSubmissions(
        access.schoolId,
        query,
      )
      const visible =
        pairs === null
          ? submissions
          : submissions.filter((submission) =>
              pairs.has(`${submission.classId}:${submission.subjectId}`),
            )

      res.status(200).json({ data: { submissions: visible } })
    } catch (error) {
      next(error)
    }
  })

  router.get(
    '/:schoolId/assessments/submissions/:submissionId',
    teacher,
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const submission = await assessmentRepository.getSubmission(
          access.schoolId,
          routeParam(req, 'submissionId'),
        )

        if (!submission) {
          throw new HttpError(404, 'Result submission not found')
        }

        await assertSubmissionReadAccess(req, submission)
        res.status(200).json({ data: { submission } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/:schoolId/assessments/submissions/:submissionId/reviews',
    teacher,
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const submission = await assessmentRepository.getSubmission(
          access.schoolId,
          routeParam(req, 'submissionId'),
        )

        if (!submission) {
          throw new HttpError(404, 'Result submission not found')
        }

        await assertSubmissionReadAccess(req, submission)
        const reviews = await assessmentRepository.listReviews(
          access.schoolId,
          submission.id,
        )
        res.status(200).json({ data: { reviews } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/:schoolId/assessments/submissions/:submissionId/history',
    teacher,
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const submission = await assessmentRepository.getSubmission(
          access.schoolId,
          routeParam(req, 'submissionId'),
        )

        if (!submission) {
          throw new HttpError(404, 'Result submission not found')
        }

        await assertSubmissionReadAccess(req, submission)
        const history = await assessmentRepository.listHistory(
          access.schoolId,
          submission.id,
        )
        res.status(200).json({ data: { history } })
      } catch (error) {
        next(error)
      }
    },
  )

  // Academic review is a platform responsibility. School users (including the
  // administrator) can never accept or return teacher assessments.
  router.post(
    '/:schoolId/assessments/submissions/:submissionId/review',
    (_req, _res, next) => {
      next(
        new HttpError(
          403,
          'Academic review is performed by the Wise Grade platform, not the school workspace.',
        ),
      )
    },
  )

  return router
}

function platformAuditFromRequest(req: Request): AssessmentAuditContext {
  if (!req.auth) {
    throw new HttpError(401, 'Authentication required')
  }

  return {
    actorUserId: req.auth.user.id,
    actorMembershipId: null,
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  }
}

/**
 * Platform-super-admin academic review.
 *
 * The school workspace can no longer accept or return teacher assessments.
 * Wise Grade performs the authorized review before reports are prepared. Platform
 * administrators hold no school membership, so the review is recorded with a
 * null reviewer membership and an explicit platform audit entry.
 */
export function createPlatformAssessmentsRouter(
  authRepository: AuthRepository,
  assessmentRepository: AssessmentRepository,
  trustedOrigins: string[],
): Router {
  const router = Router()
  const authenticate = createAuthenticate(authRepository)
  const platformAdmin = requirePlatformAdmin()
  const trustedOrigin = requireTrustedOrigin(trustedOrigins)

  router.use(authenticate, platformAdmin, trustedOrigin)

  function schoolId(req: Request): string {
    return routeParam(req, 'schoolId')
  }

  router.get('/schools/:schoolId/submissions', async (req, res, next) => {
    try {
      const query = parseQuery(submissionQuerySchema, req.query)
      const submissions = await assessmentRepository.listSubmissions(
        schoolId(req),
        query,
      )
      res.status(200).json({ data: { submissions } })
    } catch (error) {
      next(error)
    }
  })

  router.get(
    '/schools/:schoolId/submissions/:submissionId',
    async (req, res, next) => {
      try {
        const submission = await assessmentRepository.getSubmission(
          schoolId(req),
          routeParam(req, 'submissionId'),
        )

        if (!submission) {
          throw new HttpError(404, 'Result submission not found')
        }

        res.status(200).json({ data: { submission } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/schools/:schoolId/submissions/:submissionId/reviews',
    async (req, res, next) => {
      try {
        const reviews = await assessmentRepository.listReviews(
          schoolId(req),
          routeParam(req, 'submissionId'),
        )
        res.status(200).json({ data: { reviews } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/schools/:schoolId/submissions/:submissionId/history',
    async (req, res, next) => {
      try {
        const history = await assessmentRepository.listHistory(
          schoolId(req),
          routeParam(req, 'submissionId'),
        )
        res.status(200).json({ data: { history } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/schools/:schoolId/submissions/:submissionId/review',
    async (req, res, next) => {
      try {
        const input = parseBody(reviewSubmissionSchema, req.body)
        const submission = await assessmentRepository.reviewSubmission(
          schoolId(req),
          routeParam(req, 'submissionId'),
          input,
          platformAuditFromRequest(req),
        )
        res.status(200).json({ data: { submission } })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}
