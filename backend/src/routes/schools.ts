import { Router, type Request, type RequestHandler } from 'express'
import type { MembershipRecord } from '../auth/repository.js'
import type { AuthRepository } from '../auth/repository.js'
import { toPublicMembership, toPublicSchool } from '../auth/presenter.js'
import { hashPassword } from '../auth/password.js'
import { parseBody } from '../auth/validation.js'
import { HttpError } from '../errors/http-error.js'
import { createAuthenticate } from '../middleware/authenticate.js'
import { requireRole, requireSchoolAccess } from '../middleware/authorize.js'
import { createAuthenticateEither } from '../middleware/subject-authenticate.js'
import { requireTrustedOrigin } from '../middleware/csrf.js'
import type {
  AuditContext,
  SchoolRepository,
} from '../schools/repository.js'
import {
  academicTermQuerySchema,
  archivedQuerySchema,
  assignSubjectTeacherSchema,
  classSubjectCreateSchema,
  createPupilSchema,
  membershipBodySchema,
  movePupilSchema,
  pupilListQuerySchema,
  registerClassWithTeacherSchema,
  registerTeacherSchema,
  pupilPhotoUploadBodySchema,
  schoolLogoUploadBodySchema,
  signatureDetailsSchema,
  signatureUploadBodySchema,
  updatePupilSchema,
  updateSchoolSchema,
  updateSubjectSchema,
} from '../schools/validation.js'
import {
  decodePupilPhotoUpload,
  decodeSchoolLogo,
  decodeSignatureUpload,
  pupilPhotoStorageKey,
  schoolLogoStorageKey,
  signatureStorageKey,
} from '../lib/school-branding.js'
import { sha256, type StorageAdapter } from '../storage/storage.js'

function requireAccess(req: Request): MembershipRecord {
  if (!req.schoolAccess) {
    throw new HttpError(403, 'You do not have access to this school')
  }

  return req.schoolAccess
}

function auditContext(req: Request): AuditContext {
  if (!req.auth) {
    throw new HttpError(401, 'Authentication required')
  }

  return {
    actorUserId: req.auth.user.id,
    actorMembershipId: req.schoolAccess?.id ?? null,
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  }
}

function normalizeNullable(value: string | null | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined
  }

  return value === null || value.trim() === '' ? null : value.trim()
}

function publicSignature(
  schoolId: string,
  signature: {
    storageKey: string
    mimeType: string
    updatedAt: Date
    name: string | null
    designation: string | null
  } | null,
) {
  if (!signature) {
    return {
      hasSignature: false,
      url: null,
      mimeType: null,
      updatedAt: null,
      name: null,
      designation: null,
    }
  }

  return {
    hasSignature: true,
    url: `/api/schools/${schoolId}/profile/signature/file?v=${signature.updatedAt.getTime()}`,
    mimeType: signature.mimeType,
    updatedAt: signature.updatedAt,
    name: signature.name,
    designation: signature.designation,
  }
}

/**
 * Express can type a route parameter as `string | string[]` when a router is
 * mounted with repeated path segments. Every identifier in this API is a
 * single scalar value, so reject anything else instead of letting an array
 * reach the repository.
 */
function routeParam(req: Request, name: string): string {
  const value = req.params[name]

  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(400, 'Invalid route parameter')
  }

  return value
}

/**
 * School-scoped API for Phase 3.
 *
 * The router resolves authentication and ACTIVE membership once for every
 * `/:schoolId` route. Additional role/assignment checks are applied per route.
 * A platform administrator receives no implicit access because access always
 * comes from a SchoolMembership row.
 */
export function createSchoolsRouter(
  authRepository: AuthRepository,
  schoolRepository: SchoolRepository,
  trustedOrigins: string[],
  storage: StorageAdapter,
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
  const classTeacher = requireRole('CLASS_TEACHER')

  /**
   * A restricted subject session may only reach the read-only class workspace
   * endpoints it genuinely needs. This allow-list is enforced before any route
   * handler, so URL manipulation cannot reach pupils, billing, staff, admin
   * summaries or any mutation.
   */
  const subjectSessionAllowed = (req: Request): boolean => {
    const parts = req.path.split('/').filter(Boolean)

    // The assessments router is mounted separately beneath the same prefix and
    // performs its own assignment-scoped authorization, including writes.
    if (parts[0] === 'assessments') {
      return true
    }

    if (req.method !== 'GET') {
      return false
    }

    // `req.path` is relative to the matched `/:schoolId` prefix here.
    if (parts.length === 0) {
      return true
    }

    if (parts.length === 1 && parts[0] === 'profile') {
      return true
    }

    if (parts.length === 2 && parts[0] === 'profile' && parts[1] === 'logo') {
      return true
    }

    if (parts.length === 1 && parts[0] === 'class-dashboard') {
      return true
    }

    // The class workspace and assessment register need the active year/term.
    if (
      parts.length === 1 &&
      (parts[0] === 'academic-years' || parts[0] === 'academic-terms')
    ) {
      return true
    }

    if (
      parts.length === 3 &&
      parts[0] === 'classes' &&
      (parts[2] === 'subjects' || parts[2] === 'subject-teacher-assignments')
    ) {
      return true
    }

    return false
  }

  const subjectSessionGuard: RequestHandler = (req, _res, next) => {
    if (req.subjectAuth && !subjectSessionAllowed(req)) {
      next(
        new HttpError(
          403,
          'Your subject-teacher session cannot access this resource',
        ),
      )
      return
    }

    next()
  }

  // Class records are an academic structure created automatically during
  // class-teacher registration. The school workspace is read-only.
  const classManagementLocked: RequestHandler = (_req, _res, next) => {
    next(
      new HttpError(
        403,
        'Classes are created automatically when a class teacher is registered and cannot be created or edited from the school workspace.',
      ),
    )
  }

  // Academic years and terms are managed by the Wise Grade calendar service.
  // School roles retain read-only access through the calendar and existing
  // read endpoints, but every mutation is rejected at the API boundary.
  const calendarManagementLocked: RequestHandler = (_req, _res, next) => {
    next(
      new HttpError(
        403,
        'Academic years and terms are managed automatically by Wise Grade and cannot be created, edited, activated or deleted from the school workspace.',
      ),
    )
  }

  router.use(
    '/:schoolId',
    authenticateEither,
    schoolAccess,
    trustedOrigin,
    subjectSessionGuard,
  )

  async function assertClassTeacherOwnsClass(
    req: Request,
    classId: string,
    message = 'You can only manage pupils in your assigned class',
  ): Promise<void> {
    const access = requireAccess(req)

    if (
      access.role !== 'CLASS_TEACHER' ||
      !(await schoolRepository.hasClassTeacherAssignment(
        access.schoolId,
        classId,
        access.id,
      ))
    ) {
      throw new HttpError(403, message)
    }
  }

  async function accessibleClassIds(req: Request): Promise<string[] | undefined> {
    const access = requireAccess(req)

    if (access.role === 'SCHOOL_ADMIN') {
      return undefined
    }

    return schoolRepository.listAccessibleClassIds(access.schoolId, access.id)
  }

  async function assertClassSubjectReadAccess(
    req: Request,
    classId: string,
  ): Promise<void> {
    const access = requireAccess(req)

    if (
      access.role === 'CLASS_TEACHER' &&
      (await schoolRepository.hasClassTeacherAssignment(
        access.schoolId,
        classId,
        access.id,
      ))
    ) {
      return
    }

    if (
      access.role === 'SUBJECT_TEACHER' &&
      (await schoolRepository.hasSubjectTeacherAssignmentInClass(
        access.schoolId,
        classId,
        access.id,
      ))
    ) {
      return
    }

    throw new HttpError(403, 'You do not have access to this class')
  }

  async function assertClassSubjectManageAccess(
    req: Request,
    classId: string,
  ): Promise<void> {
    const access = requireAccess(req)

    if (
      access.role === 'CLASS_TEACHER' &&
      (await schoolRepository.hasClassTeacherAssignment(
        access.schoolId,
        classId,
        access.id,
      ))
    ) {
      return
    }

    throw new HttpError(
      403,
      'Only the assigned class teacher can manage subjects for this class',
    )
  }

  router.get('/:schoolId', async (req, res, next) => {
    try {
      const access = requireAccess(req)
      const school = await authRepository.findSchoolById(access.schoolId)

      if (!school) {
        throw new HttpError(404, 'School not found')
      }

      res.status(200).json({
        data: {
          school: toPublicSchool(school),
          membership: toPublicMembership(access),
        },
      })
    } catch (error) {
      next(error)
    }
  })

  router.get('/:schoolId/profile', async (req, res, next) => {
    try {
      const access = requireAccess(req)
      const school = await schoolRepository.getSchoolProfile(access.schoolId)

      if (!school) {
        throw new HttpError(404, 'School not found')
      }

      res.status(200).json({ data: { school } })
    } catch (error) {
      next(error)
    }
  })

  // School logos are private. Authorized members stream the bytes through the
  // backend; the storage key is never exposed to the browser.
  router.get('/:schoolId/profile/logo', async (req, res, next) => {
    try {
      const access = requireAccess(req)
      const logo = await schoolRepository.getSchoolLogo(access.schoolId)

      if (!logo) {
        throw new HttpError(404, 'This school has not uploaded a logo')
      }

      const data = await storage.getObject(logo.storageKey)

      if (!data) {
        throw new HttpError(404, 'The school logo file is missing from storage')
      }

      res.setHeader('Content-Type', logo.mimeType)
      res.setHeader('Content-Length', String(data.length))
      res.setHeader('Cache-Control', 'private, max-age=300')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      // The web app and API are different origins. Helmet's default
      // same-origin CORP header blocks this authenticated <img> response even
      // when the request carries credentials; the route remains private.
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
      res.status(200).send(data)
    } catch (error) {
      next(error)
    }
  })

  router.post('/:schoolId/profile/logo', admin, async (req, res, next) => {
    try {
      const access = requireAccess(req)
      const input = parseBody(schoolLogoUploadBodySchema, req.body)
      const logo = decodeSchoolLogo(input.logo)
      const storageKey = schoolLogoStorageKey(access.schoolId, logo.extension)

      await storage.putObject(storageKey, logo.data, logo.mimeType)

      try {
        const school = await schoolRepository.updateSchoolLogo(
          access.schoolId,
          {
            logoObjectKey: storageKey,
            logoMimeType: logo.mimeType,
            logoUpdatedAt: new Date(),
          },
          auditContext(req),
        )

        res.status(200).json({ data: { school } })
      } catch (error) {
        // Keep the previous logo usable and remove the unused new object.
        await storage.deleteObject(storageKey).catch(() => undefined)
        throw error
      }
    } catch (error) {
      next(error)
    }
  })

  router.get(
    '/:schoolId/profile/signature',
    admin,
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const signature = await schoolRepository.getSchoolSignature(
          access.schoolId,
        )

        res.status(200).json({
          data: { signature: publicSignature(access.schoolId, signature) },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/:schoolId/profile/signature/file',
    admin,
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const signature = await schoolRepository.getSchoolSignature(
          access.schoolId,
        )

        if (!signature) {
          throw new HttpError(404, 'This school has not uploaded a signature')
        }

        const data = await storage.getObject(signature.storageKey)

        if (!data) {
          throw new HttpError(
            404,
            'The school signature file is missing from storage',
          )
        }

        res.setHeader('Content-Type', signature.mimeType)
        res.setHeader('Content-Length', String(data.length))
        res.setHeader('Cache-Control', 'private, no-store')
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
        res.status(200).send(data)
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/:schoolId/profile/signature',
    admin,
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const input = parseBody(signatureUploadBodySchema, req.body)
        const decoded = decodeSignatureUpload(input.signature)
        const storageKey = signatureStorageKey(
          access.schoolId,
          decoded.extension,
        )

        await storage.putObject(storageKey, decoded.data, decoded.mimeType)

        try {
          const signature = await schoolRepository.updateSchoolSignature(
            access.schoolId,
            {
              storageKey,
              mimeType: decoded.mimeType,
              updatedAt: new Date(),
              name: input.name === undefined ? undefined : input.name,
              designation:
                input.designation === undefined ? undefined : input.designation,
            },
            auditContext(req),
          )

          res.status(200).json({
            data: {
              signature: publicSignature(access.schoolId, signature),
            },
          })
        } catch (error) {
          // A failed save must not leave an orphaned private object.
          await storage.deleteObject(storageKey).catch(() => undefined)
          throw error
        }
      } catch (error) {
        next(error)
      }
    },
  )

  router.patch(
    '/:schoolId/profile/signature',
    admin,
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const input = parseBody(signatureDetailsSchema, req.body)
        const signature =
          await schoolRepository.updateSchoolSignatureDetails(
            access.schoolId,
            {
              name: input.name === undefined ? undefined : input.name,
              designation:
                input.designation === undefined ? undefined : input.designation,
            },
            auditContext(req),
          )

        res.status(200).json({
          data: { signature: publicSignature(access.schoolId, signature) },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  router.delete(
    '/:schoolId/profile/signature',
    admin,
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        await schoolRepository.removeSchoolSignature(
          access.schoolId,
          auditContext(req),
        )

        res.status(200).json({
          data: { signature: publicSignature(access.schoolId, null) },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  router.patch('/:schoolId', admin, async (req, res, next) => {
    try {
      const access = requireAccess(req)
      const input = parseBody(updateSchoolSchema, req.body)

      const school = await schoolRepository.updateSchoolProfile(
        access.schoolId,
        {
          ...input,
          email: normalizeNullable(input.email),
          phone: normalizeNullable(input.phone),
          address: normalizeNullable(input.address),
          landmark: normalizeNullable(input.landmark),
        },
        auditContext(req),
      )

      res.status(200).json({ data: { school } })
    } catch (error) {
      next(error)
    }
  })

  router.get('/:schoolId/members', admin, async (req, res, next) => {
    try {
      const access = requireAccess(req)
      const members = await authRepository.listSchoolMembers(access.schoolId)

      res.status(200).json({
        data: { schoolId: access.schoolId, members },
      })
    } catch (error) {
      next(error)
    }
  })

  // -------------------------------------------------------------------------
  // Academic years and terms
  // -------------------------------------------------------------------------

  router.get('/:schoolId/academic-years', async (req, res, next) => {
    try {
      const access = requireAccess(req)
      const academicYears = await schoolRepository.listAcademicYears(
        access.schoolId,
      )

      res.status(200).json({ data: { academicYears } })
    } catch (error) {
      next(error)
    }
  })

  router.post(
    '/:schoolId/academic-years',
    calendarManagementLocked,
    (_req, _res) => undefined,
  )

  router.patch(
    '/:schoolId/academic-years/:yearId',
    calendarManagementLocked,
    (_req, _res) => undefined,
  )

  router.post(
    '/:schoolId/academic-years/:yearId/activate',
    calendarManagementLocked,
    (_req, _res) => undefined,
  )

  router.get('/:schoolId/academic-terms', async (req, res, next) => {
    try {
      const access = requireAccess(req)
      const query = parseBody(academicTermQuerySchema, req.query)
      const terms = await schoolRepository.listAcademicTerms(
        access.schoolId,
        query.academicYearId,
      )

      res.status(200).json({ data: { terms } })
    } catch (error) {
      next(error)
    }
  })

  router.post(
    '/:schoolId/academic-years/:yearId/terms',
    calendarManagementLocked,
    (_req, _res) => undefined,
  )

  router.patch(
    '/:schoolId/academic-terms/:termId',
    calendarManagementLocked,
    (_req, _res) => undefined,
  )

  router.post(
    '/:schoolId/academic-terms/:termId/activate',
    calendarManagementLocked,
    (_req, _res) => undefined,
  )

  // -------------------------------------------------------------------------
  // Classes
  // -------------------------------------------------------------------------

  router.get('/:schoolId/classes', async (req, res, next) => {
    try {
      const access = requireAccess(req)
      const query = parseBody(archivedQuerySchema, req.query)
      const classes = await schoolRepository.listClasses(access.schoolId, {
        includeArchived: query.includeArchived,
        accessibleClassIds: await accessibleClassIds(req),
      })

      res.status(200).json({ data: { classes } })
    } catch (error) {
      next(error)
    }
  })

  // Authoritative Class Dashboard context. The assigned class, its subjects and
  // its active pupil roll are resolved from the authenticated membership. A
  // request parameter cannot select or widen the class.
  router.get(
    '/:schoolId/class-dashboard',
    async (req, res, next) => {
      try {
        const access = requireAccess(req)

        if (req.subjectAuth) {
          const classes = await schoolRepository.getSubjectSessionDashboard(
            access.schoolId,
            req.subjectAuth.assignmentId,
          )

          res.status(200).json({ data: { classes } })
          return
        }

        if (access.role !== 'CLASS_TEACHER') {
          throw new HttpError(403, 'Your role does not allow this action')
        }

        const classes = await schoolRepository.getClassTeacherDashboard(
          access.schoolId,
          access.id,
        )

        res.status(200).json({ data: { classes } })
      } catch (error) {
        next(error)
      }
    },
  )

  // Administrator summary. It returns class identity and an aggregate subject
  // count only; subject names, codes and ids never leave the class-teacher
  // workspace through this endpoint.
  router.get(
    '/:schoolId/class-subject-counts',
    admin,
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const classSubjectCounts =
          await schoolRepository.listClassSubjectCounts(access.schoolId)

        res.status(200).json({ data: { classSubjectCounts } })
      } catch (error) {
        next(error)
      }
    },
  )

  // Admin-only corrected workflow: a class and its class teacher are registered
  // together. Subjects, pupils and subject teachers are managed later by the
  // assigned class teacher.
  router.post('/:schoolId/classes/register', admin, async (req, res, next) => {
    try {
      const access = requireAccess(req)
      const input = parseBody(registerClassWithTeacherSchema, req.body)
      const passwordHash = await hashPassword(input.teacher.initialPassword)

      const result = await schoolRepository.registerClassWithTeacher(
        access.schoolId,
        {
          className: input.className,
          level: input.level,
          academicYearId: input.academicYearId,
          sortOrder: input.sortOrder,
          teacher: {
            firstName: input.teacher.firstName,
            lastName: input.teacher.lastName,
            email: input.teacher.email,
            phone: input.teacher.phone,
            passwordHash,
          },
        },
        auditContext(req),
      )

      res.status(201).json({ data: result })
    } catch (error) {
      next(error)
    }
  })

  router.post(
    '/:schoolId/classes',
    classManagementLocked,
    (_req, _res) => undefined,
  )

  router.post(
    '/:schoolId/classes/seed-defaults',
    admin,
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const classes = await schoolRepository.seedDefaultClasses(
          access.schoolId,
          auditContext(req),
        )

        res.status(200).json({ data: { classes } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.patch(
    '/:schoolId/classes/:classId',
    classManagementLocked,
    (_req, _res) => undefined,
  )

  router.get(
    '/:schoolId/classes/:classId/subjects',
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const classId = routeParam(req, 'classId')

        if (req.subjectAuth) {
          if (classId !== req.subjectAuth.classId) {
            throw new HttpError(403, 'You do not have access to this class')
          }

          const subjects =
            await schoolRepository.listSubjectSessionClassSubjects(
              access.schoolId,
              req.subjectAuth.assignmentId,
            )

          res.status(200).json({ data: { subjects } })
          return
        }

        await assertClassSubjectReadAccess(req, classId)
        const subjects = await schoolRepository.listClassSubjects(
          access.schoolId,
          classId,
        )

        res.status(200).json({ data: { subjects } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/:schoolId/classes/:classId/subject-teacher-assignments',
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const classId = routeParam(req, 'classId')

        if (req.subjectAuth) {
          if (classId !== req.subjectAuth.classId) {
            throw new HttpError(403, 'You do not have access to this class')
          }

          const assignments =
            await schoolRepository.listSubjectSessionAssignments(
              access.schoolId,
              req.subjectAuth.assignmentId,
            )

          res.status(200).json({ data: { assignments } })
          return
        }

        await assertClassSubjectReadAccess(req, classId)
        const assignments =
          await schoolRepository.listClassSubjectTeacherAssignments(
            access.schoolId,
            classId,
          )

        res.status(200).json({ data: { assignments } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/:schoolId/classes/:classId/subjects',
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const classId = routeParam(req, 'classId')
        await assertClassSubjectManageAccess(req, classId)
        const input = parseBody(classSubjectCreateSchema, req.body)
        const result = await schoolRepository.registerClassSubjectWithTeacher(
          access.schoolId,
          classId,
          input,
          auditContext(req),
        )

        res.status(201).json({ data: result })
      } catch (error) {
        next(error)
      }
    },
  )

  router.delete(
    '/:schoolId/classes/:classId/subjects/:subjectId',
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const classId = routeParam(req, 'classId')
        await assertClassSubjectManageAccess(req, classId)
        await schoolRepository.removeSubjectFromClass(
          access.schoolId,
          classId,
          routeParam(req, 'subjectId'),
          auditContext(req),
        )

        res.status(200).json({ data: { message: 'Subject removed from class' } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.patch(
    '/:schoolId/classes/:classId/subjects/:subjectId',
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const classId = routeParam(req, 'classId')
        await assertClassSubjectManageAccess(req, classId)
        const input = parseBody(updateSubjectSchema, req.body)
        const subject = await schoolRepository.updateClassSubject(
          access.schoolId,
          classId,
          routeParam(req, 'subjectId'),
          input,
          auditContext(req),
        )

        res.status(200).json({ data: { subject } })
      } catch (error) {
        next(error)
      }
    },
  )

  // -------------------------------------------------------------------------
  // Pupils
  // -------------------------------------------------------------------------

  router.get('/:schoolId/pupils', async (req, res, next) => {
    try {
      const access = requireAccess(req)
      const query = parseBody(pupilListQuerySchema, req.query)
      const allowedClassIds = await accessibleClassIds(req)

      if (
        query.classId &&
        allowedClassIds !== undefined &&
        !allowedClassIds.includes(query.classId)
      ) {
        throw new HttpError(403, 'You do not have access to this class')
      }

      const result = await schoolRepository.listPupils({
        schoolId: access.schoolId,
        query: query.q,
        classId: query.classId,
        academicYearId: query.academicYearId,
        status: query.status,
        accessibleClassIds: allowedClassIds,
        page: query.page,
        pageSize: query.pageSize,
      })

      res.status(200).json({
        data: {
          pupils: result.items,
          total: result.total,
          page: query.page,
          pageSize: query.pageSize,
        },
      })
    } catch (error) {
      next(error)
    }
  })

  router.post('/:schoolId/pupils', classTeacher, async (req, res, next) => {
    try {
      const access = requireAccess(req)
      const input = parseBody(createPupilSchema, req.body)

      if (!input.classId || !input.academicYearId) {
        throw new HttpError(
          400,
          'Pupils must be registered into one of your assigned classes for an academic year',
        )
      }

      await assertClassTeacherOwnsClass(req, input.classId)

      const pupil = await schoolRepository.createPupil(
        access.schoolId,
        input,
        auditContext(req),
      )

      res.status(201).json({ data: { pupil } })
    } catch (error) {
      next(error)
    }
  })

  router.get('/:schoolId/pupils/:pupilId', async (req, res, next) => {
    try {
      const access = requireAccess(req)
      const pupil = await schoolRepository.getPupil(
        access.schoolId,
        routeParam(req, 'pupilId'),
      )

      if (!pupil) {
        throw new HttpError(404, 'Pupil not found')
      }

      const allowedClassIds = await accessibleClassIds(req)

      if (
        allowedClassIds !== undefined &&
        (!pupil.currentClassId || !allowedClassIds.includes(pupil.currentClassId))
      ) {
        throw new HttpError(403, 'You do not have access to this pupil')
      }

      res.status(200).json({ data: { pupil } })
    } catch (error) {
      next(error)
    }
  })

  router.patch(
    '/:schoolId/pupils/:pupilId',
    classTeacher,
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const pupilId = routeParam(req, 'pupilId')
        const existing = await schoolRepository.getPupil(
          access.schoolId,
          pupilId,
        )

        if (!existing) {
          throw new HttpError(404, 'Pupil not found')
        }

        if (!existing.currentClassId) {
          throw new HttpError(
            403,
            'You can only edit pupils in your assigned class',
          )
        }

        await assertClassTeacherOwnsClass(
          req,
          existing.currentClassId,
          'You can only edit pupils in your assigned class',
        )

        const input = parseBody(updatePupilSchema, req.body)
        const pupil = await schoolRepository.updatePupil(
          access.schoolId,
          pupilId,
          input,
          auditContext(req),
        )

        res.status(200).json({ data: { pupil } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/:schoolId/pupils/:pupilId/enrollments',
    classTeacher,
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const pupilId = routeParam(req, 'pupilId')
        const input = parseBody(movePupilSchema, req.body)
        const existing = await schoolRepository.getPupil(
          access.schoolId,
          pupilId,
        )

        if (!existing) {
          throw new HttpError(404, 'Pupil not found')
        }

        if (!existing.currentClassId) {
          throw new HttpError(
            403,
            'You can only transfer pupils from your assigned class',
          )
        }

        await assertClassTeacherOwnsClass(
          req,
          existing.currentClassId,
          'You can only transfer pupils from your assigned class',
        )
        await assertClassTeacherOwnsClass(
          req,
          input.classId,
          'You can only transfer pupils into your assigned class',
        )

        const pupil = await schoolRepository.movePupil(
          access.schoolId,
          pupilId,
          input,
          auditContext(req),
        )

        res.status(201).json({ data: { pupil } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/:schoolId/pupils/:pupilId/archive',
    classTeacher,
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const pupilId = routeParam(req, 'pupilId')
        const existing = await schoolRepository.getPupil(
          access.schoolId,
          pupilId,
        )

        if (!existing) {
          throw new HttpError(404, 'Pupil not found')
        }

        if (!existing.currentClassId) {
          throw new HttpError(
            403,
            'You can only archive pupils in your assigned class',
          )
        }

        await assertClassTeacherOwnsClass(
          req,
          existing.currentClassId,
          'You can only archive pupils in your assigned class',
        )

        const pupil = await schoolRepository.archivePupil(
          access.schoolId,
          pupilId,
          auditContext(req),
        )

        res.status(200).json({ data: { pupil } })
      } catch (error) {
        next(error)
      }
    },
  )

  async function assertCanManagePupilPhoto(
    req: Request,
    pupil: { currentClassId: string | null },
  ): Promise<void> {
    const access = requireAccess(req)

    if (access.role === 'SCHOOL_ADMIN') {
      return
    }

    if (access.role !== 'CLASS_TEACHER' || !pupil.currentClassId) {
      throw new HttpError(
        403,
        'You can only manage photographs for pupils in your assigned class',
      )
    }

    await assertClassTeacherOwnsClass(
      req,
      pupil.currentClassId,
      'You can only manage photographs for pupils in your assigned class',
    )
  }

  router.post(
    '/:schoolId/pupils/:pupilId/photo',
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const pupilId = routeParam(req, 'pupilId')
        const pupil = await schoolRepository.getPupil(access.schoolId, pupilId)

        if (!pupil) {
          throw new HttpError(404, 'Pupil not found')
        }

        await assertCanManagePupilPhoto(req, pupil)

        const input = parseBody(pupilPhotoUploadBodySchema, req.body)
        const photo = decodePupilPhotoUpload(input.photo)
        const storageKey = pupilPhotoStorageKey(
          access.schoolId,
          pupilId,
          photo.extension,
        )

        await storage.putObject(storageKey, photo.data, photo.mimeType)

        try {
          const updated = await schoolRepository.updatePupilPhoto(
            access.schoolId,
            pupilId,
            {
              storageKey,
              mimeType: photo.mimeType,
              checksum: sha256(photo.data),
              updatedAt: new Date(),
            },
            auditContext(req),
          )

          res.status(200).json({ data: { pupil: updated } })
        } catch (error) {
          await storage.deleteObject(storageKey).catch(() => undefined)
          throw error
        }
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/:schoolId/pupils/:pupilId/photo',
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const pupilId = routeParam(req, 'pupilId')
        const pupil = await schoolRepository.getPupil(access.schoolId, pupilId)

        if (!pupil) {
          throw new HttpError(404, 'Pupil not found')
        }

        const allowedClassIds = await accessibleClassIds(req)

        if (
          allowedClassIds !== undefined &&
          (!pupil.currentClassId ||
            !allowedClassIds.includes(pupil.currentClassId))
        ) {
          throw new HttpError(403, 'You do not have access to this pupil')
        }

        const photo = await schoolRepository.getPupilPhoto(
          access.schoolId,
          pupilId,
        )

        if (!photo) {
          throw new HttpError(404, 'This pupil has no profile photograph')
        }

        const data = await storage.getObject(photo.storageKey)

        if (!data) {
          throw new HttpError(
            404,
            'The pupil photograph is missing from private storage',
          )
        }

        if (sha256(data) !== photo.checksum) {
          throw new HttpError(
            500,
            'The pupil photograph failed integrity verification',
          )
        }

        res.setHeader('Content-Type', photo.mimeType)
        res.setHeader('Content-Length', String(data.length))
        res.setHeader('Cache-Control', 'private, max-age=300')
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
        res.status(200).send(data)
      } catch (error) {
        next(error)
      }
    },
  )

  router.delete(
    '/:schoolId/pupils/:pupilId/photo',
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const pupilId = routeParam(req, 'pupilId')
        const pupil = await schoolRepository.getPupil(access.schoolId, pupilId)

        if (!pupil) {
          throw new HttpError(404, 'Pupil not found')
        }

        await assertCanManagePupilPhoto(req, pupil)

        const updated = await schoolRepository.removePupilPhoto(
          access.schoolId,
          pupilId,
          auditContext(req),
        )

        res.status(200).json({ data: { pupil: updated } })
      } catch (error) {
        next(error)
      }
    },
  )

  // -------------------------------------------------------------------------
  // Subjects
  // -------------------------------------------------------------------------

  // The school-level subject list exists only to let a class teacher reuse an
  // existing subject when adding it to their own class. School administrators
  // never receive subject names; they use the aggregate count endpoint above.
  router.get('/:schoolId/subjects', classTeacher, async (req, res, next) => {
    try {
      const access = requireAccess(req)
      const query = parseBody(archivedQuerySchema, req.query)
      const subjects = await schoolRepository.listSubjects(access.schoolId, {
        includeArchived: query.includeArchived,
      })

      res.status(200).json({ data: { subjects } })
    } catch (error) {
      next(error)
    }
  })

  // -------------------------------------------------------------------------
  // Teachers and assignments
  // -------------------------------------------------------------------------

  router.get('/:schoolId/teachers', admin, async (req, res, next) => {
    try {
      const access = requireAccess(req)
      const teachers = await schoolRepository.listTeachers(access.schoolId)

      res.status(200).json({ data: { teachers } })
    } catch (error) {
      next(error)
    }
  })

  // Eligible subject teachers for a class-subject assignment. Administrators
  // need this during class-teacher registration; the assigned class teacher
  // needs it when maintaining their own class subjects.
  router.get(
    '/:schoolId/subject-teacher-candidates',
    classTeacher,
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const teachers = await schoolRepository.listSubjectTeacherCandidates(
          access.schoolId,
        )

        res.status(200).json({ data: { teachers } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post('/:schoolId/teachers', admin, async (req, res, next) => {
    try {
      const access = requireAccess(req)
      const input = parseBody(registerTeacherSchema, req.body)
      const passwordHash = await hashPassword(input.initialPassword)
      const teacher = await schoolRepository.registerTeacher(
        access.schoolId,
        {
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          role: input.role,
          passwordHash,
          className: input.className,
          classId: input.classId,
        },
        auditContext(req),
      )

      res.status(201).json({ data: { teacher } })
    } catch (error) {
      next(error)
    }
  })

  router.get(
    '/:schoolId/teacher-assignments',
    admin,
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const assignments = await schoolRepository.listTeacherAssignments(
          access.schoolId,
        )

        res.status(200).json({ data: { assignments } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/:schoolId/classes/:classId/class-teacher',
    admin,
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const input = parseBody(membershipBodySchema, req.body)
        const assignment = await schoolRepository.assignClassTeacher(
          access.schoolId,
          routeParam(req, 'classId'),
          input.membershipId,
          auditContext(req),
        )

        res.status(201).json({ data: { assignment } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.delete(
    '/:schoolId/classes/:classId/class-teacher/:membershipId',
    admin,
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        await schoolRepository.revokeClassTeacher(
          access.schoolId,
          routeParam(req, 'classId'),
          routeParam(req, 'membershipId'),
          auditContext(req),
        )

        res.status(200).json({ data: { message: 'Class teacher assignment revoked' } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/:schoolId/classes/:classId/subjects/:subjectId/teacher',
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const classId = routeParam(req, 'classId')
        await assertClassSubjectManageAccess(req, classId)
        const input = parseBody(assignSubjectTeacherSchema, req.body)
        const result =
          await schoolRepository.assignSubjectTeacherWithInvitation(
            access.schoolId,
            classId,
            routeParam(req, 'subjectId'),
            {
              membershipId: input.membershipId,
              teacher: input.teacher,
            },
            auditContext(req),
          )

        res.status(201).json({ data: result })
      } catch (error) {
        next(error)
      }
    },
  )

  router.delete(
    '/:schoolId/classes/:classId/subjects/:subjectId/teacher/:assignmentId',
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const classId = routeParam(req, 'classId')
        await assertClassSubjectManageAccess(req, classId)
        await schoolRepository.revokeSubjectTeacher(
          access.schoolId,
          classId,
          routeParam(req, 'subjectId'),
          routeParam(req, 'assignmentId'),
          auditContext(req),
        )

        res.status(200).json({
          data: { message: 'Subject teacher assignment revoked' },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/:schoolId/classes/:classId/subject-teacher-invitations',
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const classId = routeParam(req, 'classId')
        await assertClassSubjectManageAccess(req, classId)
        const invitations =
          await schoolRepository.listSubjectTeacherInvitations(
            access.schoolId,
            classId,
          )

        res.status(200).json({ data: { invitations } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/:schoolId/classes/:classId/subject-teacher-invitations/:invitationId/reissue',
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const classId = routeParam(req, 'classId')
        await assertClassSubjectManageAccess(req, classId)
        const invitations =
          await schoolRepository.listSubjectTeacherInvitations(
            access.schoolId,
            classId,
          )
        const invitationId = routeParam(req, 'invitationId')

        if (!invitations.some((item) => item.id === invitationId)) {
          throw new HttpError(404, 'Invitation not found')
        }

        const invitation =
          await schoolRepository.reissueSubjectTeacherInvitation(
            access.schoolId,
            invitationId,
            auditContext(req),
          )

        res.status(201).json({ data: { invitation } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.delete(
    '/:schoolId/classes/:classId/subject-teacher-invitations/:invitationId',
    async (req, res, next) => {
      try {
        const access = requireAccess(req)
        const classId = routeParam(req, 'classId')
        await assertClassSubjectManageAccess(req, classId)
        const invitations =
          await schoolRepository.listSubjectTeacherInvitations(
            access.schoolId,
            classId,
          )
        const invitationId = routeParam(req, 'invitationId')

        if (!invitations.some((item) => item.id === invitationId)) {
          throw new HttpError(404, 'Invitation not found')
        }

        await schoolRepository.revokeSubjectTeacherInvitation(
          access.schoolId,
          invitationId,
          auditContext(req),
        )

        res.status(200).json({ data: { message: 'Invitation revoked' } })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}
