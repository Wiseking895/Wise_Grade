import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import {
  academicStartYearFor,
  buildAcademicYearPlan,
  todayInCalendar,
} from '../src/calendar/logic.js'
import {
  registrationBody,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from './helpers/auth-fixtures.js'
import { FakeAuthRepository } from './helpers/fake-auth-repository.js'
import { FakeSchoolRepository } from './helpers/fake-school-repository.js'

interface TestContext {
  app: ReturnType<typeof createApp>
  auth: FakeAuthRepository
  schools: FakeSchoolRepository
  admin: ReturnType<typeof request.agent>
  schoolId: string
  adminUserId: string
}

async function registerSchool(
  auth: FakeAuthRepository,
  schools: FakeSchoolRepository,
  app: ReturnType<typeof createApp>,
  overrides: { schoolName: string; email: string },
): Promise<TestContext> {
  const admin = request.agent(app)

  const response = await admin
    .post('/api/auth/register-school')
    .set('Origin', TEST_ORIGIN)
    .send(
      registrationBody({
        schoolName: overrides.schoolName,
        email: overrides.email,
      }),
    )

  expect(response.status).toBe(201)

  const schoolId = response.body.data.school.id as string
  const adminUserId = response.body.data.user.id as string

  schools.seedSchool({
    id: schoolId,
    name: overrides.schoolName,
    slug: response.body.data.school.slug,
    email: overrides.email,
  })
  schools.seedDefaults(schoolId, adminUserId)

  return { app, auth, schools, admin, schoolId, adminUserId }
}

let currentAuth: FakeAuthRepository

async function login(
  app: ReturnType<typeof createApp>,
  email: string,
  password = TEST_PASSWORD,
) {
  // Class teachers now receive a server-generated temporary password that is
  // only delivered by email. These suites focus on class management rather than
  // onboarding, so give the account a known password before signing in. Accounts
  // created directly with `createUser` already have this password; resetting it
  // is harmless.
  if (password === TEST_PASSWORD) {
    await currentAuth.setPasswordForTesting(email, password)
  }

  const agent = request.agent(app)
  const response = await agent
    .post('/api/auth/login')
    .set('Origin', TEST_ORIGIN)
    .send({ email, password })

  return { agent, response }
}

describe('Phase 3 school management', () => {
  let auth: FakeAuthRepository
  let schools: FakeSchoolRepository
  let app: ReturnType<typeof createApp>
  let ctx: TestContext

  beforeEach(async () => {
    auth = new FakeAuthRepository()
    currentAuth = auth
    schools = new FakeSchoolRepository(auth)
    app = createApp({ authRepository: auth, schoolRepository: schools })
    ctx = await registerSchool(auth, schools, app, {
      schoolName: 'Green Valley Academy',
      email: 'admin@greenvalley.test',
    })
  })

  // -----------------------------------------------------------------------
  // School profile
  // -----------------------------------------------------------------------

  describe('school profile', () => {
    it('lets a school administrator read and update only their profile', async () => {
      const read = await ctx.admin.get(
        `/api/schools/${ctx.schoolId}/profile`,
      )
      expect(read.status).toBe(200)
      expect(read.body.data.school.name).toBe('Green Valley Academy')

      const update = await ctx.admin
        .patch(`/api/schools/${ctx.schoolId}`)
        .set('Origin', TEST_ORIGIN)
        .send({
          name: 'Green Valley Basic School',
          email: 'office@greenvalley.test',
          phone: '+233240000000',
          address: '12 Accra Road',
        })

      expect(update.status).toBe(200)
      expect(update.body.data.school).toMatchObject({
        name: 'Green Valley Basic School',
        email: 'office@greenvalley.test',
        phone: '+233240000000',
        address: '12 Accra Road',
      })
      expect(schools.auditActions()).toContain('SCHOOL_PROFILE_UPDATED')
    })

    it('denies another school administrator access to the profile', async () => {
      const other = await registerSchool(auth, schools, app, {
        schoolName: 'Riverside School',
        email: 'admin@riverside.test',
      })

      const read = await ctx.admin.get(
        `/api/schools/${other.schoolId}/profile`,
      )
      expect(read.status).toBe(403)

      const update = await ctx.admin
        .patch(`/api/schools/${other.schoolId}`)
        .set('Origin', TEST_ORIGIN)
        .send({ name: 'Hijacked School' })
      expect(update.status).toBe(403)
    })

    it('gives a platform administrator no implicit school access', async () => {
      const platformAdmin = await auth.createUser({
        email: 'platform@gradely.test',
        password: TEST_PASSWORD,
        isPlatformAdmin: true,
      })
      expect(platformAdmin.isPlatformAdmin).toBe(true)

      const { agent, response } = await login(app, 'platform@gradely.test')
      expect(response.status).toBe(200)

      const read = await agent.get(`/api/schools/${ctx.schoolId}/profile`)
      expect(read.status).toBe(403)
    })

    it('denies a suspended membership', async () => {
      const user = await auth.createUser({
        email: 'suspended@greenvalley.test',
        password: TEST_PASSWORD,
      })
      await auth.addMembership(
        user.id,
        ctx.schoolId,
        'SCHOOL_ADMIN',
        'SUSPENDED',
      )

      const { agent, response } = await login(
        app,
        'suspended@greenvalley.test',
      )
      expect(response.status).toBe(200)

      const read = await agent.get(`/api/schools/${ctx.schoolId}/profile`)
      expect(read.status).toBe(403)
    })
  })

  // -----------------------------------------------------------------------
  // Academic years and terms
  // -----------------------------------------------------------------------

  describe('academic calendar permissions', () => {
    it('keeps academic year and term management locked for school administrators', async () => {
      const create = await ctx.admin
        .post(`/api/schools/${ctx.schoolId}/academic-years`)
        .set('Origin', TEST_ORIGIN)
        .send({
          name: '2026/2027',
          startsOn: '2026-09-01',
          endsOn: '2027-07-31',
          isCurrent: true,
        })

      expect(create.status).toBe(403)
      expect(create.body.error.message).toMatch(/managed automatically/i)

      const update = await ctx.admin
        .patch(`/api/schools/${ctx.schoolId}/academic-years/00000000-0000-4000-8000-000000000000`)
        .set('Origin', TEST_ORIGIN)
        .send({ name: 'Renamed' })
      expect(update.status).toBe(403)

      const activate = await ctx.admin
        .post(`/api/schools/${ctx.schoolId}/academic-years/00000000-0000-4000-8000-000000000000/activate`)
        .set('Origin', TEST_ORIGIN)
        .send({})
      expect(activate.status).toBe(403)

      const createTerm = await ctx.admin
        .post(`/api/schools/${ctx.schoolId}/academic-years/00000000-0000-4000-8000-000000000000/terms`)
        .set('Origin', TEST_ORIGIN)
        .send({
          name: 'Term 1',
          sequence: 1,
          startsOn: '2026-09-01',
          endsOn: '2026-12-15',
        })
      expect(createTerm.status).toBe(403)

      const updateTerm = await ctx.admin
        .patch(`/api/schools/${ctx.schoolId}/academic-terms/00000000-0000-4000-8000-000000000000`)
        .set('Origin', TEST_ORIGIN)
        .send({ name: 'Renamed term' })
      expect(updateTerm.status).toBe(403)

      const activateTerm = await ctx.admin
        .post(`/api/schools/${ctx.schoolId}/academic-terms/00000000-0000-4000-8000-000000000000/activate`)
        .set('Origin', TEST_ORIGIN)
        .send({})
      expect(activateTerm.status).toBe(403)

      const years = await ctx.admin.get(
        `/api/schools/${ctx.schoolId}/academic-years`,
      )
      expect(years.status).toBe(200)
      expect(years.body.data.academicYears).toEqual([])
    })

    it('rejects calendar mutations from teachers and non-members', async () => {
      const teacher = await auth.createUser({
        email: 'teacher@greenvalley.test',
        password: TEST_PASSWORD,
      })
      await auth.addMembership(userId(teacher), ctx.schoolId, 'CLASS_TEACHER')

      const { agent } = await login(app, 'teacher@greenvalley.test')
      const denied = await agent
        .post(`/api/schools/${ctx.schoolId}/academic-years`)
        .set('Origin', TEST_ORIGIN)
        .send({
          name: 'Teacher year',
          startsOn: '2026-09-01',
          endsOn: '2027-07-31',
        })

      expect(denied.status).toBe(403)

      const platform = await auth.createUser({
        email: 'platform@gradely.test',
        password: TEST_PASSWORD,
        isPlatformAdmin: true,
      })
      expect(platform.isPlatformAdmin).toBe(true)
      const platformLogin = await login(app, 'platform@gradely.test')
      expect(platformLogin.response.status).toBe(200)

      const platformWrite = await platformLogin.agent
        .post(`/api/schools/${ctx.schoolId}/academic-years`)
        .set('Origin', TEST_ORIGIN)
        .send({
          name: 'Platform year',
          startsOn: '2026-09-01',
          endsOn: '2027-07-31',
        })

      expect(platformWrite.status).toBe(403)
    })
  })

  // -----------------------------------------------------------------------
  // Classes
  // -----------------------------------------------------------------------

  describe('classes', () => {
    it('keeps class management read-only for school administrators', async () => {
      const create = await ctx.admin
        .post(`/api/schools/${ctx.schoolId}/classes`)
        .set('Origin', TEST_ORIGIN)
        .send({ name: 'Basic 7', level: 'JUNIOR', sortOrder: 120 })

      expect(create.status).toBe(403)
      expect(create.body.error.message).toMatch(/automatically/i)

      const cls = schools.classByName(ctx.schoolId, 'Basic 2')
      const update = await ctx.admin
        .patch(`/api/schools/${ctx.schoolId}/classes/${cls.id}`)
        .set('Origin', TEST_ORIGIN)
        .send({ isArchived: true })

      expect(update.status).toBe(403)

      const list = await ctx.admin.get(`/api/schools/${ctx.schoolId}/classes`)
      expect(list.status).toBe(200)
      expect(list.body.data.classes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: cls.id, name: 'Basic 2' }),
        ]),
      )
    })

    it('creates a class when a class teacher is registered and reuses existing classes', async () => {
      const before = await ctx.admin.get(`/api/schools/${ctx.schoolId}/classes`)
      const basicOneCountBefore = before.body.data.classes.filter(
        (item: { name: string }) => item.name === 'Basic 1',
      ).length

      const response = await ctx.admin
        .post(`/api/schools/${ctx.schoolId}/teachers`)
        .set('Origin', TEST_ORIGIN)
        .send({
          firstName: 'Efua',
          lastName: 'Owusu',
          email: 'efua@greenvalley.test',
          role: 'CLASS_TEACHER',
          className: 'Basic 1',
        })

      expect(response.status).toBe(201)

      const after = await ctx.admin.get(`/api/schools/${ctx.schoolId}/classes`)
      const basicOne = after.body.data.classes.filter(
        (item: { name: string }) => item.name === 'Basic 1',
      )
      expect(basicOne).toHaveLength(basicOneCountBefore)

      const assignments = await ctx.admin.get(
        `/api/schools/${ctx.schoolId}/teacher-assignments`,
      )
      expect(assignments.body.data.assignments.classTeachers).toEqual([
        expect.objectContaining({
          membershipId: response.body.data.teacher.membershipId,
          className: 'Basic 1',
        }),
      ])
      expect(schools.auditActions()).toEqual(
        expect.arrayContaining([
          'TEACHER_REGISTERED',
          'CLASS_TEACHER_ASSIGNED',
        ]),
      )
    })

    it('creates a new class for a supported class name that does not exist yet', async () => {
      const response = await ctx.admin
        .post(`/api/schools/${ctx.schoolId}/teachers`)
        .set('Origin', TEST_ORIGIN)
        .send({
          firstName: 'Yaa',
          lastName: 'Boateng',
          email: 'yaa@greenvalley.test',
          role: 'CLASS_TEACHER',
          className: 'Basic 7',
        })

      expect(response.status).toBe(201)

      const classes = await ctx.admin.get(
        `/api/schools/${ctx.schoolId}/classes`,
      )
      expect(
        classes.body.data.classes.filter(
          (item: { name: string }) => item.name === 'Basic 7',
        ),
      ).toHaveLength(1)
    })

    it('prevents two active class teachers from owning the same class', async () => {
      const first = await ctx.admin
        .post(`/api/schools/${ctx.schoolId}/teachers`)
        .set('Origin', TEST_ORIGIN)
        .send({
          firstName: 'Efua',
          lastName: 'Owusu',
          email: 'efua@greenvalley.test',
          role: 'CLASS_TEACHER',
          className: 'Basic 1',
        })
      expect(first.status).toBe(201)

      const second = await ctx.admin
        .post(`/api/schools/${ctx.schoolId}/teachers`)
        .set('Origin', TEST_ORIGIN)
        .send({
          firstName: 'Kojo',
          lastName: 'Mensah',
          email: 'kojo@greenvalley.test',
          role: 'CLASS_TEACHER',
          className: 'Basic 1',
        })
      expect(second.status).toBe(409)

      const classes = await ctx.admin.get(
        `/api/schools/${ctx.schoolId}/classes`,
      )
      expect(
        classes.body.data.classes.filter(
          (item: { name: string }) => item.name === 'Basic 1',
        ),
      ).toHaveLength(1)
    })

    it('requires a class when registering a class teacher', async () => {
      const response = await ctx.admin
        .post(`/api/schools/${ctx.schoolId}/teachers`)
        .set('Origin', TEST_ORIGIN)
        .send({
          firstName: 'No',
          lastName: 'Class',
          email: 'noclass@greenvalley.test',
          role: 'CLASS_TEACHER',
        })

      expect(response.status).toBe(400)
    })
  })

  // -----------------------------------------------------------------------
  // Pupils
  // -----------------------------------------------------------------------

  describe('pupils', () => {
    async function registerClassTeacher(
      className = 'Basic 1',
      email = 'ct-pupils@greenvalley.test',
    ) {
      const response = await ctx.admin
        .post(`/api/schools/${ctx.schoolId}/teachers`)
        .set('Origin', TEST_ORIGIN)
        .send({
          firstName: 'Class',
          lastName: 'Teacher',
          email,
          role: 'CLASS_TEACHER',
          className,
        })

      expect(response.status).toBe(201)
      const { agent, response: loginResponse } = await login(app, email)
      expect(loginResponse.status).toBe(200)

      return {
        agent,
        membershipId: response.body.data.teacher.membershipId as string,
        classId: schools.classByName(ctx.schoolId, className).id,
      }
    }

    async function createYearAndPupil() {
      const teacher = await registerClassTeacher()

      const plan = buildAcademicYearPlan(
        academicStartYearFor(todayInCalendar()),
      )
      const year = await schools.createAcademicYear(
        ctx.schoolId,
        {
          name: plan.name,
          startsOn: plan.startsOn,
          endsOn: plan.endsOn,
          isCurrent: true,
        },
        { actorUserId: ctx.adminUserId },
      )

      const classId = teacher.classId

      const pupil = await teacher.agent
        .post(`/api/schools/${ctx.schoolId}/pupils`)
        .set('Origin', TEST_ORIGIN)
        .send({
          firstName: 'Ama',
          lastName: 'Mensah',
          otherNames: 'Akosua',
          admissionNumber: 'gva-001',
          gender: 'FEMALE',
          dateOfBirth: '2016-04-12',
          classId,
          academicYearId: year.id,
          startedOn: plan.startsOn,
        })

      return {
        pupilId: pupil.body.data.pupil.id as string,
        yearId: year.id,
        classId,
        pupil,
        teacher,
      }
    }

    it('denies pupil registration to school administrators', async () => {
      const classId = schools.classByName(ctx.schoolId, 'Basic 1').id
      const response = await ctx.admin
        .post(`/api/schools/${ctx.schoolId}/pupils`)
        .set('Origin', TEST_ORIGIN)
        .send({
          firstName: 'Ama',
          lastName: 'Mensah',
          admissionNumber: 'GVA-001',
          classId,
        })

      expect(response.status).toBe(403)
    })

    it('registers pupils through their class teacher, prevents duplicate admission numbers, and supports search', async () => {
      const { pupil, classId, teacher } = await createYearAndPupil()

      expect(pupil.status).toBe(201)
      expect(pupil.body.data.pupil).toMatchObject({
        firstName: 'Ama',
        lastName: 'Mensah',
        admissionNumber: 'GVA-001',
        currentClassName: 'Basic 1',
        status: 'ACTIVE',
      })

      const duplicate = await teacher.agent
        .post(`/api/schools/${ctx.schoolId}/pupils`)
        .set('Origin', TEST_ORIGIN)
        .send({
          firstName: 'Other',
          lastName: 'Pupil',
          admissionNumber: 'GVA-001',
          classId,
          academicYearId: pupil.body.data.pupil.enrollments[0].academicYearId,
        })
      expect(duplicate.status).toBe(409)

      const listed = await teacher.agent.get(
        `/api/schools/${ctx.schoolId}/pupils?classId=${classId}&q=ama`,
      )
      expect(listed.status).toBe(200)
      expect(listed.body.data.total).toBe(1)
      expect(listed.body.data.pupils[0].id).toBe(
        pupil.body.data.pupil.id,
      )

      // Administrators retain read-only visibility across the school.
      const adminList = await ctx.admin.get(
        `/api/schools/${ctx.schoolId}/pupils?q=ama`,
      )
      expect(adminList.status).toBe(200)
      expect(adminList.body.data.total).toBe(1)

      const missing = await teacher.agent.get(
        `/api/schools/${ctx.schoolId}/pupils?q=does-not-exist`,
      )
      expect(missing.body.data.total).toBe(0)
      expect(schools.auditActions()).toContain('PUPIL_CREATED')
    })

    it('keeps pupil transfers within the class teacher own class and denies administrators', async () => {
      const { pupilId, yearId, teacher } = await createYearAndPupil()
      const nextClassId = schools.classByName(ctx.schoolId, 'Basic 2').id

      const deniedTransfer = await teacher.agent
        .post(`/api/schools/${ctx.schoolId}/pupils/${pupilId}/enrollments`)
        .set('Origin', TEST_ORIGIN)
        .send({
          classId: nextClassId,
          academicYearId: yearId,
          startedOn: '2027-01-10',
        })

      expect(deniedTransfer.status).toBe(403)

      const adminTransfer = await ctx.admin
        .post(`/api/schools/${ctx.schoolId}/pupils/${pupilId}/enrollments`)
        .set('Origin', TEST_ORIGIN)
        .send({
          classId: nextClassId,
          academicYearId: yearId,
          startedOn: '2027-01-10',
        })
      expect(adminTransfer.status).toBe(403)
    })

    it('archives pupils without deleting their history', async () => {
      const { pupilId, teacher } = await createYearAndPupil()

      const directArchive = await teacher.agent
        .patch(`/api/schools/${ctx.schoolId}/pupils/${pupilId}`)
        .set('Origin', TEST_ORIGIN)
        .send({ status: 'ARCHIVED' })
      expect(directArchive.status).toBe(400)

      const adminArchive = await ctx.admin
        .post(`/api/schools/${ctx.schoolId}/pupils/${pupilId}/archive`)
        .set('Origin', TEST_ORIGIN)
        .send({})
      expect(adminArchive.status).toBe(403)

      const archive = await teacher.agent
        .post(`/api/schools/${ctx.schoolId}/pupils/${pupilId}/archive`)
        .set('Origin', TEST_ORIGIN)
        .send({})

      expect(archive.status).toBe(200)
      expect(archive.body.data.pupil.status).toBe('ARCHIVED')
      expect(archive.body.data.pupil.currentClassId).toBeNull()
      expect(archive.body.data.pupil.enrollments[0].status).toBe(
        'WITHDRAWN',
      )

      const listed = await teacher.agent.get(
        `/api/schools/${ctx.schoolId}/pupils`,
      )
      expect(listed.body.data.total).toBe(0)

      const archived = await ctx.admin.get(
        `/api/schools/${ctx.schoolId}/pupils?status=ARCHIVED`,
      )
      expect(archived.body.data.total).toBe(1)
      expect(schools.auditActions()).toContain('PUPIL_ARCHIVED')
    })

    it('keeps pupils isolated between schools', async () => {
      const { pupilId } = await createYearAndPupil()
      const other = await registerSchool(auth, schools, app, {
        schoolName: 'Riverside School',
        email: 'admin@riverside.test',
      })

      const crossRead = await other.admin.get(
        `/api/schools/${other.schoolId}/pupils/${pupilId}`,
      )
      expect(crossRead.status).toBe(404)
    })

    it('denies a class teacher access to another class or school', async () => {
      const { yearId } = await createYearAndPupil()
      const otherClassId = schools.classByName(ctx.schoolId, 'Basic 2').id

      const response = await ctx.admin
        .post(`/api/schools/${ctx.schoolId}/teachers`)
        .set('Origin', TEST_ORIGIN)
        .send({
          firstName: 'Second',
          lastName: 'Teacher',
          email: 'second-ct@greenvalley.test',
          role: 'CLASS_TEACHER',
          className: 'Basic 3',
        })
      expect(response.status).toBe(201)
      const { agent } = await login(app, 'second-ct@greenvalley.test')

      const crossClass = await agent
        .post(`/api/schools/${ctx.schoolId}/pupils`)
        .set('Origin', TEST_ORIGIN)
        .send({
          firstName: 'Cross',
          lastName: 'Class',
          admissionNumber: 'GVA-002',
          classId: otherClassId,
          academicYearId: yearId,
        })
      expect(crossClass.status).toBe(403)

      const other = await registerSchool(auth, schools, app, {
        schoolName: 'Riverside School',
        email: 'admin@riverside.test',
      })

      const crossSchool = await agent
        .post(`/api/schools/${other.schoolId}/pupils`)
        .set('Origin', TEST_ORIGIN)
        .send({
          firstName: 'Cross',
          lastName: 'School',
          admissionNumber: 'RVS-001',
        })
      expect(crossSchool.status).toBe(403)
    })
  })

  // -----------------------------------------------------------------------
  // Class dashboard
  // -----------------------------------------------------------------------

  describe('class dashboard', () => {
    async function registerClassTeacher(
      className: string,
      email: string,
    ): Promise<{
      agent: ReturnType<typeof request.agent>
      membershipId: string
      classId: string
    }> {
      const response = await ctx.admin
        .post(`/api/schools/${ctx.schoolId}/teachers`)
        .set('Origin', TEST_ORIGIN)
        .send({
          firstName: 'Class',
          lastName: 'Teacher',
          email,
          role: 'CLASS_TEACHER',
          className,
        })

      expect(response.status).toBe(201)
      const { agent, response: loginResponse } = await login(app, email)
      expect(loginResponse.status).toBe(200)

      return {
        agent,
        membershipId: response.body.data.teacher.membershipId as string,
        classId: schools.classByName(ctx.schoolId, className).id,
      }
    }

    async function createCurrentYear(): Promise<{
      id: string
      startsOn: string
    }> {
      const plan = buildAcademicYearPlan(
        academicStartYearFor(todayInCalendar()),
      )
      const year = await schools.createAcademicYear(
        ctx.schoolId,
        {
          name: plan.name,
          startsOn: plan.startsOn,
          endsOn: plan.endsOn,
          isCurrent: true,
        },
        { actorUserId: ctx.adminUserId },
      )

      return { id: year.id, startsOn: plan.startsOn }
    }

    async function createPupil(
      agent: ReturnType<typeof request.agent>,
      input: {
        classId: string
        academicYearId: string
        startedOn: string
        admissionNumber: string
        firstName?: string
      },
    ) {
      const response = await agent
        .post(`/api/schools/${ctx.schoolId}/pupils`)
        .set('Origin', TEST_ORIGIN)
        .send({
          firstName: input.firstName ?? 'Ama',
          lastName: 'Mensah',
          admissionNumber: input.admissionNumber,
          classId: input.classId,
          academicYearId: input.academicYearId,
          startedOn: input.startedOn,
        })

      expect(response.status).toBe(201)
      return response.body.data.pupil as { id: string }
    }

    function dashboardFor(agent: ReturnType<typeof request.agent>) {
      return agent.get(`/api/schools/${ctx.schoolId}/class-dashboard`)
    }

    it('resolves the assigned class, subjects and active pupils without a class parameter', async () => {
      const teacher = await registerClassTeacher(
        'Basic 3',
        'ct-dashboard@greenvalley.test',
      )
      const year = await createCurrentYear()

      await createPupil(teacher.agent, {
        classId: teacher.classId,
        academicYearId: year.id,
        startedOn: year.startsOn,
        admissionNumber: 'DASH-001',
        firstName: 'Ama',
      })
      await createPupil(teacher.agent, {
        classId: teacher.classId,
        academicYearId: year.id,
        startedOn: year.startsOn,
        admissionNumber: 'DASH-002',
        firstName: 'Kofi',
      })

      const subject = await teacher.agent
        .post(
          `/api/schools/${ctx.schoolId}/classes/${teacher.classId}/subjects`,
        )
        .set('Origin', TEST_ORIGIN)
        .send({ name: 'Mathematics', code: 'MATH' })
      expect(subject.status).toBe(201)

      // A manipulated class query is ignored: the assignment is authoritative.
      const otherClassId = schools.classByName(ctx.schoolId, 'Basic 1').id
      const response = await teacher.agent.get(
        `/api/schools/${ctx.schoolId}/class-dashboard?classId=${otherClassId}`,
      )

      expect(response.status).toBe(200)
      expect(response.body.data.classes).toHaveLength(1)
      expect(response.body.data.classes[0]).toMatchObject({
        classId: teacher.classId,
        className: 'Basic 3',
        pupilsOnRoll: 2,
      })
      expect(response.body.data.classes[0].subjects).toEqual([
        expect.objectContaining({
          subjectName: 'Mathematics',
          subjectCode: 'MATH',
          readOnly: false,
          canEnterScores: true,
        }),
      ])
    })

    it('updates Pupils on Roll when a pupil is deactivated, archived or registered', async () => {
      const teacher = await registerClassTeacher(
        'Basic 3',
        'ct-roll@greenvalley.test',
      )
      const year = await createCurrentYear()

      const first = await createPupil(teacher.agent, {
        classId: teacher.classId,
        academicYearId: year.id,
        startedOn: year.startsOn,
        admissionNumber: 'ROLL-001',
      })
      const second = await createPupil(teacher.agent, {
        classId: teacher.classId,
        academicYearId: year.id,
        startedOn: year.startsOn,
        admissionNumber: 'ROLL-002',
      })

      let dashboard = await dashboardFor(teacher.agent)
      expect(dashboard.body.data.classes[0].pupilsOnRoll).toBe(2)

      const inactive = await teacher.agent
        .patch(`/api/schools/${ctx.schoolId}/pupils/${first.id}`)
        .set('Origin', TEST_ORIGIN)
        .send({ status: 'INACTIVE' })
      expect(inactive.status).toBe(200)

      dashboard = await dashboardFor(teacher.agent)
      expect(dashboard.body.data.classes[0].pupilsOnRoll).toBe(1)

      const archived = await teacher.agent
        .post(`/api/schools/${ctx.schoolId}/pupils/${second.id}/archive`)
        .set('Origin', TEST_ORIGIN)
        .send({})
      expect(archived.status).toBe(200)

      dashboard = await dashboardFor(teacher.agent)
      expect(dashboard.body.data.classes[0].pupilsOnRoll).toBe(0)

      await createPupil(teacher.agent, {
        classId: teacher.classId,
        academicYearId: year.id,
        startedOn: year.startsOn,
        admissionNumber: 'ROLL-003',
      })

      dashboard = await dashboardFor(teacher.agent)
      expect(dashboard.body.data.classes[0].pupilsOnRoll).toBe(1)
    })

    it('returns every active assignment for a multi-class teacher', async () => {
      const teacher = await registerClassTeacher(
        'Basic 3',
        'ct-multi@greenvalley.test',
      )
      const year = await createCurrentYear()
      const secondClass = schools.classByName(ctx.schoolId, 'Basic 4')
      await schools.assignClassTeacher(
        ctx.schoolId,
        secondClass.id,
        teacher.membershipId,
        { actorUserId: ctx.adminUserId },
      )

      await createPupil(teacher.agent, {
        classId: secondClass.id,
        academicYearId: year.id,
        startedOn: year.startsOn,
        admissionNumber: 'MULTI-001',
      })

      const response = await dashboardFor(teacher.agent)
      expect(response.status).toBe(200)
      expect(
        response.body.data.classes.map(
          (item: { className: string; pupilsOnRoll: number }) => ({
            className: item.className,
            pupilsOnRoll: item.pupilsOnRoll,
          }),
        ),
      ).toEqual([
        { className: 'Basic 3', pupilsOnRoll: 0 },
        { className: 'Basic 4', pupilsOnRoll: 1 },
      ])
    })

    it('returns an empty dashboard for a class teacher with no active assignment', async () => {
      const user = await auth.createUser({
        email: 'ct-unassigned@greenvalley.test',
        password: TEST_PASSWORD,
      })
      await auth.addMembership(
        userId(user),
        ctx.schoolId,
        'CLASS_TEACHER',
      )
      const { agent } = await login(app, 'ct-unassigned@greenvalley.test')

      const response = await dashboardFor(agent)
      expect(response.status).toBe(200)
      expect(response.body.data.classes).toEqual([])
    })

    it('denies the dashboard to administrators, subject teachers and other schools', async () => {
      const teacher = await registerClassTeacher(
        'Basic 3',
        'ct-access@greenvalley.test',
      )
      const otherClassTeacher = await registerClassTeacher(
        'Basic 4',
        'ct-other@greenvalley.test',
      )

      // A teacher only ever sees their own assignment, never a colleague's.
      const own = await dashboardFor(teacher.agent)
      expect(own.body.data.classes.map((item: { classId: string }) => item.classId)).toEqual([
        teacher.classId,
      ])
      expect(
        own.body.data.classes.some(
          (item: { classId: string }) => item.classId === otherClassTeacher.classId,
        ),
      ).toBe(false)

      const admin = await dashboardFor(ctx.admin)
      expect(admin.status).toBe(403)

      const other = await registerSchool(auth, schools, app, {
        schoolName: 'Riverside School',
        email: 'admin@riverside.test',
      })
      const crossSchool = await teacher.agent.get(
        `/api/schools/${other.schoolId}/class-dashboard`,
      )
      expect(crossSchool.status).toBe(403)
    })
  })

  describe('subjects', () => {
    async function registerClassTeacherFor(
      className: string,
      email: string,
    ) {
      const response = await ctx.admin
        .post(`/api/schools/${ctx.schoolId}/teachers`)
        .set('Origin', TEST_ORIGIN)
        .send({
          firstName: 'Class',
          lastName: 'Teacher',
          email,
          role: 'CLASS_TEACHER',
          className,
        })

      expect(response.status).toBe(201)
      const { agent, response: loginResponse } = await login(app, email)
      expect(loginResponse.status).toBe(200)

      return {
        agent,
        membershipId: response.body.data.teacher.membershipId as string,
        classId: schools.classByName(ctx.schoolId, className).id,
      }
    }

    it('denies school administrators direct class and subject management and exposes counts only', async () => {
      const classId = schools.classByName(ctx.schoolId, 'Basic 3').id
      const subjectId = schools.seedSubject(
        ctx.schoolId,
        'Science',
        'SCI',
      ).id

      const createSubject = await ctx.admin
        .post(`/api/schools/${ctx.schoolId}/subjects`)
        .set('Origin', TEST_ORIGIN)
        .send({ name: 'French', code: 'FRE' })
      expect([403, 404]).toContain(createSubject.status)

      const updateSubject = await ctx.admin
        .patch(
          `/api/schools/${ctx.schoolId}/classes/${classId}/subjects/${subjectId}`,
        )
        .set('Origin', TEST_ORIGIN)
        .send({ isArchived: true })
      expect(updateSubject.status).toBe(403)

      const assignSubject = await ctx.admin
        .post(`/api/schools/${ctx.schoolId}/classes/${classId}/subjects`)
        .set('Origin', TEST_ORIGIN)
        .send({ subjectId })
      expect(assignSubject.status).toBe(403)

      const subjectTeacherMembership = await auth.addMembership(
        userId(
          await auth.createUser({
            email: 'st-admin-denied@greenvalley.test',
            password: TEST_PASSWORD,
          }),
        ),
        ctx.schoolId,
        'SUBJECT_TEACHER',
      )

      const assignTeacher = await ctx.admin
        .post(
          `/api/schools/${ctx.schoolId}/classes/${classId}/subjects/${subjectId}/teacher`,
        )
        .set('Origin', TEST_ORIGIN)
        .send({ membershipId: subjectTeacherMembership })
      expect(assignTeacher.status).toBe(403)

      const subjects = await ctx.admin.get(
        `/api/schools/${ctx.schoolId}/subjects`,
      )
      expect(subjects.status).toBe(403)

      const classSubjects = await ctx.admin.get(
        `/api/schools/${ctx.schoolId}/classes/${classId}/subjects`,
      )
      expect(classSubjects.status).toBe(403)

      // The administrator still receives the aggregate per-class counts, but
      // the response contains no subject names or codes.
      const counts = await ctx.admin.get(
        `/api/schools/${ctx.schoolId}/class-subject-counts`,
      )
      expect(counts.status).toBe(200)
      expect(counts.body.data.classSubjectCounts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            classId,
            className: 'Basic 3',
            subjectCount: 0,
          }),
        ]),
      )
      expect(JSON.stringify(counts.body.data)).not.toContain('Science')
      expect(JSON.stringify(counts.body.data)).not.toContain('SCI')

      const classes = await ctx.admin.get(
        `/api/schools/${ctx.schoolId}/classes`,
      )
      expect(classes.status).toBe(200)
    })

    it('lets the assigned class teacher create, assign, and archive subjects without duplicates', async () => {
      const teacher = await registerClassTeacherFor(
        'Basic 3',
        'ct-subjects@greenvalley.test',
      )

      // Subject creation is class-scoped: the class teacher deliberately adds
      // the subject to their own class, which also creates the school-level
      // subject record.
      const subjectResponse = await teacher.agent
        .post(
          `/api/schools/${ctx.schoolId}/classes/${teacher.classId}/subjects`,
        )
        .set('Origin', TEST_ORIGIN)
        .send({ name: 'French', code: 'FRE' })

      expect(subjectResponse.status).toBe(201)
      const subjectId = subjectResponse.body.data.assignment.subjectId as string

      const duplicateSubject = await teacher.agent
        .post(
          `/api/schools/${ctx.schoolId}/classes/${teacher.classId}/subjects`,
        )
        .set('Origin', TEST_ORIGIN)
        .send({ name: 'french' })
      expect(duplicateSubject.status).toBe(201)
      expect(duplicateSubject.body.data.assignment.subjectId).toBe(subjectId)

      const list = await teacher.agent.get(
        `/api/schools/${ctx.schoolId}/classes/${teacher.classId}/subjects`,
      )
      expect(
        list.body.data.subjects.filter(
          (item: { subjectId: string }) => item.subjectId === subjectId,
        ),
      ).toHaveLength(1)

      const archive = await teacher.agent
        .patch(
          `/api/schools/${ctx.schoolId}/classes/${teacher.classId}/subjects/${subjectId}`,
        )
        .set('Origin', TEST_ORIGIN)
        .send({ isArchived: true })
      expect(archive.status).toBe(200)
      expect(archive.body.data.subject.isArchived).toBe(true)

      const remove = await teacher.agent
        .delete(
          `/api/schools/${ctx.schoolId}/classes/${teacher.classId}/subjects/${subjectId}`,
        )
        .set('Origin', TEST_ORIGIN)
      expect(remove.status).toBe(200)

      expect(schools.auditActions()).toEqual(
        expect.arrayContaining([
          'SUBJECT_CREATED',
          'CLASS_SUBJECT_ASSIGNED',
          'SUBJECT_ARCHIVED',
          'CLASS_SUBJECT_REMOVED',
        ]),
      )
    })

    it('registers class subjects and optional subject teachers after class-teacher registration', async () => {
      const classTeacher = await registerClassTeacherFor(
        'Basic 2',
        'esi@greenvalley.test',
      )
      const classId = schools.classByName(ctx.schoolId, 'Basic 2').id

      // The administrator may no longer attach subjects to teacher
      // registration; subjects are the class teacher's responsibility.
      const adminSubjects = await ctx.admin
        .post(`/api/schools/${ctx.schoolId}/teachers`)
        .set('Origin', TEST_ORIGIN)
        .send({
          firstName: 'Esi',
          lastName: 'Mensah',
          email: 'esi-admin-subjects@greenvalley.test',
          role: 'CLASS_TEACHER',
          className: 'Basic 3',
          subjects: [{ name: 'French', code: 'FRE' }],
        })
      expect(adminSubjects.status).toBe(400)

      // The class teacher registers the subject and, optionally, the subject
      // teacher in the same request. A single-use code is returned once.
      const english = await classTeacher.agent
        .post(`/api/schools/${ctx.schoolId}/classes/${classId}/subjects`)
        .set('Origin', TEST_ORIGIN)
        .send({
          name: 'English Language',
          code: 'ENG',
          subjectTeacher: {
            firstName: 'Adwoa',
            lastName: 'Nyarko',
            email: 'st-registration@greenvalley.test',
          },
        })
      expect(english.status).toBe(201)
      const englishId = english.body.data.assignment.subjectId as string
      expect(english.body.data.subjectTeacherAssignment).toMatchObject({
        subjectId: englishId,
      })
      expect(english.body.data.invitation.code).toBeTruthy()
      expect(english.body.data.invitation.status).toBe('PENDING')

      const french = await classTeacher.agent
        .post(`/api/schools/${ctx.schoolId}/classes/${classId}/subjects`)
        .set('Origin', TEST_ORIGIN)
        .send({ name: 'French', code: 'FRE' })
      expect(french.status).toBe(201)
      const frenchId = french.body.data.assignment.subjectId as string

      // Re-registering the same subject is idempotent and never duplicates the
      // class subject or catalogue entry.
      const duplicate = await classTeacher.agent
        .post(`/api/schools/${ctx.schoolId}/classes/${classId}/subjects`)
        .set('Origin', TEST_ORIGIN)
        .send({ name: 'french' })
      expect(duplicate.status).toBe(201)
      expect(duplicate.body.data.assignment.subjectId).toBe(frenchId)

      const classSubjects = await classTeacher.agent.get(
        `/api/schools/${ctx.schoolId}/classes/${classId}/subjects`,
      )
      expect(classSubjects.status).toBe(200)
      const names = classSubjects.body.data.subjects.map(
        (item: { subjectName: string }) => item.subjectName,
      )
      expect(names).toEqual(
        expect.arrayContaining(['English Language', 'French']),
      )
      expect(
        names.filter((name: string) => name.toLowerCase() === 'french'),
      ).toHaveLength(1)

      const assignments = await classTeacher.agent.get(
        `/api/schools/${ctx.schoolId}/classes/${classId}/subject-teacher-assignments`,
      )
      expect(assignments.status).toBe(200)
      expect(assignments.body.data.assignments).toEqual([
        expect.objectContaining({ subjectId: englishId }),
      ])

      // Listing invitations never re-exposes the activation code.
      const invitations = await classTeacher.agent.get(
        `/api/schools/${ctx.schoolId}/classes/${classId}/subject-teacher-invitations`,
      )
      expect(invitations.status).toBe(200)
      expect(invitations.body.data.invitations[0].status).toBe('PENDING')
      expect(JSON.stringify(invitations.body.data)).not.toContain('"code"')

      // The same catalogue subject is reused when offered in another class.
      const otherClass = schools.classByName(ctx.schoolId, 'Basic 3').id
      const otherTeacher = await registerClassTeacherFor(
        'Basic 3',
        'ct-basic3@greenvalley.test',
      )
      const reused = await otherTeacher.agent
        .post(`/api/schools/${ctx.schoolId}/classes/${otherClass}/subjects`)
        .set('Origin', TEST_ORIGIN)
        .send({ name: 'french' })
      expect(reused.status).toBe(201)
      expect(reused.body.data.assignment.subjectId).toBe(frenchId)
    })

    it('rejects ineligible subject teachers without partial records', async () => {
      const classTeacher = await registerClassTeacherFor(
        'Basic 5',
        'ct-basic5@greenvalley.test',
      )
      const classId = schools.classByName(ctx.schoolId, 'Basic 5').id

      // A class-teacher membership cannot be attached as a subject teacher.
      const response = await classTeacher.agent
        .post(`/api/schools/${ctx.schoolId}/classes/${classId}/subjects`)
        .set('Origin', TEST_ORIGIN)
        .send({
          name: 'Music',
          subjectTeacherMembershipId: classTeacher.membershipId,
        })
      expect(response.status).toBe(409)

      // The whole registration rolls back: no catalogue subject, class subject
      // or invitation is left behind.
      const subjects = await classTeacher.agent.get(
        `/api/schools/${ctx.schoolId}/subjects`,
      )
      expect(
        subjects.body.data.subjects.some(
          (subject: { name: string }) => subject.name === 'Music',
        ),
      ).toBe(false)

      const classSubjects = await classTeacher.agent.get(
        `/api/schools/${ctx.schoolId}/classes/${classId}/subjects`,
      )
      expect(
        classSubjects.body.data.subjects.some(
          (item: { subjectName: string }) => item.subjectName === 'Music',
        ),
      ).toBe(false)

      const invitations = await classTeacher.agent.get(
        `/api/schools/${ctx.schoolId}/classes/${classId}/subject-teacher-invitations`,
      )
      expect(invitations.body.data.invitations).toHaveLength(0)
    })

    it('lets an assigned class teacher manage subjects for their class only', async () => {
      const classId = schools.classByName(ctx.schoolId, 'Basic 4').id
      const otherClassId = schools.classByName(ctx.schoolId, 'Basic 5').id
      const subjectId = schools.seedSubject(ctx.schoolId, 'Science', 'SCI').id

      const teacher = await auth.createUser({
        email: 'class-teacher@greenvalley.test',
        password: TEST_PASSWORD,
      })
      const membershipId = await auth.addMembership(
        userId(teacher),
        ctx.schoolId,
        'CLASS_TEACHER',
      )

      const assign = await ctx.admin
        .post(`/api/schools/${ctx.schoolId}/classes/${classId}/class-teacher`)
        .set('Origin', TEST_ORIGIN)
        .send({ membershipId })
      expect(assign.status).toBe(201)

      const { agent, response } = await login(
        app,
        'class-teacher@greenvalley.test',
      )
      expect(response.status).toBe(200)

      const allowed = await agent
        .post(`/api/schools/${ctx.schoolId}/classes/${classId}/subjects`)
        .set('Origin', TEST_ORIGIN)
        .send({ subjectId })
      expect(allowed.status).toBe(201)

      const denied = await agent
        .post(
          `/api/schools/${ctx.schoolId}/classes/${otherClassId}/subjects`,
        )
        .set('Origin', TEST_ORIGIN)
        .send({ subjectId })
      expect(denied.status).toBe(403)

      const classes = await agent.get(
        `/api/schools/${ctx.schoolId}/classes`,
      )
      expect(classes.body.data.classes.map((item: { id: string }) => item.id)).toEqual([
        classId,
      ])
      expect(schools.auditActions()).toContain('CLASS_TEACHER_ASSIGNED')
    })

    it('lists eligible subject-teacher candidates for class teachers only', async () => {
      const classTeacher = await registerClassTeacherFor(
        'Basic 2',
        'ct-candidates@greenvalley.test',
      )
      const classId = schools.classByName(ctx.schoolId, 'Basic 2').id
      const englishId = schools.seedSubject(
        ctx.schoolId,
        'English Language',
        'ENG',
      ).id

      // Administrators cannot manage subject teachers in the corrected flow.
      const adminList = await ctx.admin.get(
        `/api/schools/${ctx.schoolId}/subject-teacher-candidates`,
      )
      expect(adminList.status).toBe(403)

      const assigned = await classTeacher.agent
        .post(`/api/schools/${ctx.schoolId}/classes/${classId}/subjects`)
        .set('Origin', TEST_ORIGIN)
        .send({
          subjectId: englishId,
          subjectTeacher: {
            firstName: 'Eligible',
            lastName: 'Candidate',
            email: 'candidate@greenvalley.test',
          },
        })
      expect(assigned.status).toBe(201)

      const classTeacherList = await classTeacher.agent.get(
        `/api/schools/${ctx.schoolId}/subject-teacher-candidates`,
      )
      expect(classTeacherList.status).toBe(200)

      // An access-code assignment never creates a User, Membership or password.
      expect(
        await auth.findUserByEmail('candidate@greenvalley.test'),
      ).toBeNull()

      const sessionAgent = request.agent(app)
      const entry = await sessionAgent
        .post('/api/auth/subject-teacher/access-code')
        .set('Origin', TEST_ORIGIN)
        .send({ code: assigned.body.data.invitation.code })
      expect(entry.status).toBe(200)
      expect(entry.body.data.subjectSession).toMatchObject({
        schoolId: ctx.schoolId,
        classId,
        subjectId: englishId,
        teacher: expect.objectContaining({
          email: 'candidate@greenvalley.test',
        }),
      })

      const dashboard = await sessionAgent.get(
        `/api/schools/${ctx.schoolId}/class-dashboard`,
      )
      expect(dashboard.status).toBe(200)
      expect(dashboard.body.data.classes).toHaveLength(1)
      expect(dashboard.body.data.classes[0].subjects).toEqual([
        expect.objectContaining({ subjectId: englishId }),
      ])

      const denied = await sessionAgent.get(
        `/api/schools/${ctx.schoolId}/subject-teacher-candidates`,
      )
      expect(denied.status).toBe(403)
    })

    it('creates no subjects during school or class registration', async () => {
      // School registration seeds the standard classes only.
      const countsAfterSchool = await ctx.admin.get(
        `/api/schools/${ctx.schoolId}/class-subject-counts`,
      )
      expect(countsAfterSchool.status).toBe(200)
      const counts = countsAfterSchool.body.data.classSubjectCounts as Array<{
        subjectCount: number
      }>
      expect(counts.length).toBeGreaterThan(0)
      expect(counts.every((item) => item.subjectCount === 0)).toBe(true)

      // Administrators cannot read the subject catalogue at all.
      const adminSubjects = await ctx.admin.get(
        `/api/schools/${ctx.schoolId}/subjects`,
      )
      expect(adminSubjects.status).toBe(403)

      // Registering a class teacher creates the class but no subjects.
      const teacher = await registerClassTeacherFor(
        'Basic 2',
        'ct-no-auto-subjects@greenvalley.test',
      )

      const afterClassRegistration = await ctx.admin.get(
        `/api/schools/${ctx.schoolId}/class-subject-counts`,
      )
      expect(
        (
          afterClassRegistration.body.data.classSubjectCounts as Array<{
            classId: string
            subjectCount: number
          }>
        ).find((item) => item.classId === teacher.classId)?.subjectCount,
      ).toBe(0)

      const teacherSubjects = await teacher.agent.get(
        `/api/schools/${ctx.schoolId}/subjects`,
      )
      expect(teacherSubjects.status).toBe(200)
      expect(teacherSubjects.body.data.subjects).toEqual([])

      const classSubjects = await teacher.agent.get(
        `/api/schools/${ctx.schoolId}/classes/${teacher.classId}/subjects`,
      )
      expect(classSubjects.status).toBe(200)
      expect(classSubjects.body.data.subjects).toEqual([])
    })

    it('updates administrator per-class counts when a class teacher adds or removes a subject', async () => {
      const teacher = await registerClassTeacherFor(
        'Basic 2',
        'ct-counts@greenvalley.test',
      )

      const created = await teacher.agent
        .post(`/api/schools/${ctx.schoolId}/classes/${teacher.classId}/subjects`)
        .set('Origin', TEST_ORIGIN)
        .send({ name: 'Integrated Science', code: 'INT' })
      expect(created.status).toBe(201)
      const subjectId = created.body.data.assignment.subjectId as string

      const withSubject = await ctx.admin.get(
        `/api/schools/${ctx.schoolId}/class-subject-counts`,
      )
      const row = (
        withSubject.body.data.classSubjectCounts as Array<{
          classId: string
          className: string
          classTeacherName: string | null
          subjectCount: number
          isArchived: boolean
        }>
      ).find((item) => item.classId === teacher.classId)

      expect(row).toMatchObject({
        className: 'Basic 2',
        subjectCount: 1,
        isArchived: false,
      })
      expect(row?.classTeacherName).toBe('Class Teacher')
      // The aggregate response exposes no subject identity.
      expect(JSON.stringify(withSubject.body.data)).not.toContain(
        'Integrated Science',
      )
      expect(JSON.stringify(withSubject.body.data)).not.toContain('INT')

      const removed = await teacher.agent
        .delete(
          `/api/schools/${ctx.schoolId}/classes/${teacher.classId}/subjects/${subjectId}`,
        )
        .set('Origin', TEST_ORIGIN)
      expect(removed.status).toBe(200)

      const withoutSubject = await ctx.admin.get(
        `/api/schools/${ctx.schoolId}/class-subject-counts`,
      )
      expect(
        (
          withoutSubject.body.data.classSubjectCounts as Array<{
            classId: string
            subjectCount: number
          }>
        ).find((item) => item.classId === teacher.classId)?.subjectCount,
      ).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // Teacher management
  // -----------------------------------------------------------------------

  describe('teachers and assignments', () => {
    it('registers controlled teacher memberships without platform privileges', async () => {
      const response = await ctx.admin
        .post(`/api/schools/${ctx.schoolId}/teachers`)
        .set('Origin', TEST_ORIGIN)
        .send({
          firstName: 'Kwame',
          lastName: 'Asare',
          email: 'kwame@greenvalley.test',
          role: 'CLASS_TEACHER',
          className: 'Basic 4',
        })

      expect(response.status).toBe(201)
      expect(response.body.data.teacher).toMatchObject({
        email: 'kwame@greenvalley.test',
        role: 'CLASS_TEACHER',
      })

      const user = await auth.findUserByEmail('kwame@greenvalley.test')
      expect(user?.isPlatformAdmin).toBe(false)

      const forbiddenRole = await ctx.admin
        .post(`/api/schools/${ctx.schoolId}/teachers`)
        .set('Origin', TEST_ORIGIN)
        .send({
          firstName: 'Bad',
          lastName: 'Actor',
          email: 'bad@greenvalley.test',
          role: 'SCHOOL_ADMIN',
        })
      expect(forbiddenRole.status).toBe(400)

      const platformRole = await ctx.admin
        .post(`/api/schools/${ctx.schoolId}/teachers`)
        .set('Origin', TEST_ORIGIN)
        .send({
          firstName: 'Bad',
          lastName: 'Actor',
          email: 'bad2@greenvalley.test',
          role: 'PLATFORM_SUPER_ADMIN',
        })
      expect(platformRole.status).toBe(400)

      expect(schools.auditActions()).toContain('TEACHER_REGISTERED')
    })

    it('registers subject teachers only through a class-subject assignment', async () => {
      const before = await ctx.admin.get(`/api/schools/${ctx.schoolId}/classes`)

      // Administrators can no longer create subject-teacher accounts directly.
      const adminAttempt = await ctx.admin
        .post(`/api/schools/${ctx.schoolId}/teachers`)
        .set('Origin', TEST_ORIGIN)
        .send({
          firstName: 'Adwoa',
          lastName: 'Nyarko',
          email: 'adwoa@greenvalley.test',
          role: 'SUBJECT_TEACHER',
        })
      expect(adminAttempt.status).toBe(400)
      expect(await auth.findUserByEmail('adwoa@greenvalley.test')).toBeNull()

      const classTeacherRegistration = await ctx.admin
        .post(`/api/schools/${ctx.schoolId}/teachers`)
        .set('Origin', TEST_ORIGIN)
        .send({
          firstName: 'Class',
          lastName: 'Teacher',
          email: 'ct-st-registration@greenvalley.test',
          role: 'CLASS_TEACHER',
          className: 'Basic 2',
        })
      expect(classTeacherRegistration.status).toBe(201)
      const classTeacher = await login(
        app,
        'ct-st-registration@greenvalley.test',
      )
      const classId = schools.classByName(ctx.schoolId, 'Basic 2').id
      const englishId = schools.seedSubject(
        ctx.schoolId,
        'English Language',
        'ENG',
      ).id

      const assigned = await classTeacher.agent
        .post(`/api/schools/${ctx.schoolId}/classes/${classId}/subjects`)
        .set('Origin', TEST_ORIGIN)
        .send({
          subjectId: englishId,
          subjectTeacher: {
            firstName: 'Adwoa',
            lastName: 'Nyarko',
            email: 'adwoa@greenvalley.test',
          },
        })
      expect(assigned.status).toBe(201)

      // The subject teacher never claims or creates a class.
      const after = await ctx.admin.get(`/api/schools/${ctx.schoolId}/classes`)
      expect(after.body.data.classes).toHaveLength(
        before.body.data.classes.length,
      )

      const assignments = await ctx.admin.get(
        `/api/schools/${ctx.schoolId}/teacher-assignments`,
      )
      expect(assignments.body.data.assignments.classTeachers).toEqual([
        expect.objectContaining({ className: 'Basic 2' }),
      ])
      expect(assignments.body.data.assignments.subjectTeachers).toEqual([
        expect.objectContaining({
          email: 'adwoa@greenvalley.test',
          className: 'Basic 2',
          subjectName: 'English Language',
        }),
      ])
    })

    it('does not silently change the role of an existing school member', async () => {
      const body = {
        firstName: 'Kwame',
        lastName: 'Asare',
        email: 'kwame@greenvalley.test',
        role: 'CLASS_TEACHER',
        className: 'Basic 4',
      }

      const first = await ctx.admin
        .post(`/api/schools/${ctx.schoolId}/teachers`)
        .set('Origin', TEST_ORIGIN)
        .send(body)
      expect(first.status).toBe(201)

      const second = await ctx.admin
        .post(`/api/schools/${ctx.schoolId}/teachers`)
        .set('Origin', TEST_ORIGIN)
        .send({
          firstName: 'Kwame',
          lastName: 'Asare',
          email: 'kwame@greenvalley.test',
          role: 'CLASS_TEACHER',
          className: 'Basic 3',
        })
      expect(second.status).toBe(409)

      const teachers = await ctx.admin.get(
        `/api/schools/${ctx.schoolId}/teachers`,
      )
      expect(teachers.body.data.teachers).toHaveLength(1)
      expect(teachers.body.data.teachers[0].role).toBe('CLASS_TEACHER')
    })

    it('assigns class and subject teachers and enforces assignment authorization', async () => {
      const classId = schools.classByName(ctx.schoolId, 'Basic 6').id
      const subjectId = schools.seedSubject(
        ctx.schoolId,
        'Mathematics',
        'MATH',
      ).id

      const classTeacher = await auth.createUser({
        email: 'ct@greenvalley.test',
        password: TEST_PASSWORD,
      })
      const classMembershipId = await auth.addMembership(
        userId(classTeacher),
        ctx.schoolId,
        'CLASS_TEACHER',
      )

      const subjectTeacher = await auth.createUser({
        email: 'st@greenvalley.test',
        password: TEST_PASSWORD,
      })
      const subjectMembershipId = await auth.addMembership(
        userId(subjectTeacher),
        ctx.schoolId,
        'SUBJECT_TEACHER',
      )

      const classAssign = await ctx.admin
        .post(`/api/schools/${ctx.schoolId}/classes/${classId}/class-teacher`)
        .set('Origin', TEST_ORIGIN)
        .send({ membershipId: classMembershipId })
      expect(classAssign.status).toBe(201)

      const classTeacherLogin = await login(app, 'ct@greenvalley.test')

      const addSubject = await classTeacherLogin.agent
        .post(`/api/schools/${ctx.schoolId}/classes/${classId}/subjects`)
        .set('Origin', TEST_ORIGIN)
        .send({ subjectId })
      expect(addSubject.status).toBe(201)

      const adminAssign = await ctx.admin
        .post(
          `/api/schools/${ctx.schoolId}/classes/${classId}/subjects/${subjectId}/teacher`,
        )
        .set('Origin', TEST_ORIGIN)
        .send({ membershipId: subjectMembershipId })
      expect(adminAssign.status).toBe(403)

      const subjectAssign = await classTeacherLogin.agent
        .post(
          `/api/schools/${ctx.schoolId}/classes/${classId}/subjects/${subjectId}/teacher`,
        )
        .set('Origin', TEST_ORIGIN)
        .send({ membershipId: subjectMembershipId })
      expect(subjectAssign.status).toBe(201)

      const wrongRole = await classTeacherLogin.agent
        .post(
          `/api/schools/${ctx.schoolId}/classes/${classId}/subjects/${subjectId}/teacher`,
        )
        .set('Origin', TEST_ORIGIN)
        .send({ membershipId: classMembershipId })
      expect(wrongRole.status).toBe(409)

      const subjectTeacherLogin = await login(
        app,
        'st@greenvalley.test',
      )
      const read = await subjectTeacherLogin.agent.get(
        `/api/schools/${ctx.schoolId}/classes/${classId}/subjects`,
      )
      expect(read.status).toBe(200)

      const classAssignments = await subjectTeacherLogin.agent.get(
        `/api/schools/${ctx.schoolId}/classes/${classId}/subject-teacher-assignments`,
      )
      expect(classAssignments.status).toBe(200)
      expect(classAssignments.body.data.assignments).toEqual([
        expect.objectContaining({
          subjectId,
          membershipId: subjectMembershipId,
        }),
      ])

      const otherClassId = schools.classByName(ctx.schoolId, 'Basic 1').id
      const denied = await subjectTeacherLogin.agent.get(
        `/api/schools/${ctx.schoolId}/classes/${otherClassId}/subjects`,
      )
      expect(denied.status).toBe(403)

      const assignments = await ctx.admin.get(
        `/api/schools/${ctx.schoolId}/teacher-assignments`,
      )
      expect(assignments.status).toBe(200)
      expect(assignments.body.data.assignments.classTeachers).toHaveLength(1)
      expect(assignments.body.data.assignments.subjectTeachers).toHaveLength(1)

      const adminRevokeSubjectTeacher = await ctx.admin
        .delete(
          `/api/schools/${ctx.schoolId}/classes/${classId}/subjects/${subjectId}/teacher/${subjectMembershipId}`,
        )
        .set('Origin', TEST_ORIGIN)
      expect(adminRevokeSubjectTeacher.status).toBe(403)

      const revoke = await ctx.admin
        .delete(
          `/api/schools/${ctx.schoolId}/classes/${classId}/class-teacher/${classMembershipId}`,
        )
        .set('Origin', TEST_ORIGIN)
      expect(revoke.status).toBe(200)

      const afterRevoke = await login(app, 'ct@greenvalley.test')
      const classes = await afterRevoke.agent.get(
        `/api/schools/${ctx.schoolId}/classes`,
      )
      expect(classes.body.data.classes).toHaveLength(0)

      expect(schools.auditActions()).toEqual(
        expect.arrayContaining([
          'CLASS_TEACHER_ASSIGNED',
          'SUBJECT_TEACHER_ASSIGNED',
          'CLASS_TEACHER_REVOKED',
        ]),
      )
    })

    it('denies a suspended teacher and a teacher from another school', async () => {
      const classId = schools.classByName(ctx.schoolId, 'Basic 1').id

      const suspended = await auth.createUser({
        email: 'suspended-teacher@greenvalley.test',
        password: TEST_PASSWORD,
      })
      await auth.addMembership(
        userId(suspended),
        ctx.schoolId,
        'CLASS_TEACHER',
        'SUSPENDED',
      )

      const suspendedLogin = await login(
        app,
        'suspended-teacher@greenvalley.test',
      )
      const denied = await suspendedLogin.agent.get(
        `/api/schools/${ctx.schoolId}/classes/${classId}/subjects`,
      )
      expect(denied.status).toBe(403)

      const other = await registerSchool(auth, schools, app, {
        schoolName: 'Riverside School',
        email: 'admin@riverside.test',
      })
      const outsider = await auth.createUser({
        email: 'outsider@riverside.test',
        password: TEST_PASSWORD,
      })
      const outsiderMembership = await auth.addMembership(
        userId(outsider),
        other.schoolId,
        'CLASS_TEACHER',
      )

      const crossAssign = await ctx.admin
        .post(`/api/schools/${ctx.schoolId}/classes/${classId}/class-teacher`)
        .set('Origin', TEST_ORIGIN)
        .send({ membershipId: outsiderMembership })
      expect(crossAssign.status).toBe(404)
    })
  })
})

function userId(user: { id: string }): string {
  return user.id
}
