/**
 * Live Phase 3 verification against the configured development database.
 *
 * This script creates one disposable school plus disposable users and records,
 * exercises the real HTTP API and Prisma persistence, then removes only the
 * records it created. It refuses to run unless NODE_ENV is development and the
 * database is a local non-production target.
 *
 * Run with: npx tsx scripts/verify-phase3-live.ts
 */
import assert from 'node:assert/strict'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { getPrismaClient } from '../src/lib/prisma.js'

const ORIGIN = 'http://localhost:5173'
const PASSWORD = 'verification-password-123'
const suffix = `p3v-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 6)}`
const tag = suffix

const adminAEmail = `${tag}.admin-a@gradely.test`
const adminBEmail = `${tag}.admin-b@gradely.test`
const classTeacherEmail = `${tag}.ct@gradely.test`
const subjectTeacherEmail = `${tag}.st@gradely.test`

const createdUserIds: string[] = []
const createdSchoolIds: string[] = []
let failures = 0

function checkTarget(): void {
  const raw = env.DATABASE_URL ?? ''
  const url = new URL(raw)

  assert.equal(env.NODE_ENV, 'development', 'NODE_ENV must be development')
  assert.equal(url.hostname, 'localhost', 'Database host must be localhost')
  assert.equal(url.port, '5432', 'Database port must be 5432')
  assert.equal(
    url.pathname.replace(/^\//, ''),
    'wise_grade',
    'Database must be the intended development database',
  )
  assert.notEqual(env.NODE_ENV, 'production')
}

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS  ${name}`)
  } catch (error) {
    failures += 1
    console.error(`FAIL  ${name}`)
    console.error(error)
  }
}

async function main(): Promise<void> {
  checkTarget()

  const prisma = getPrismaClient()
  const app = createApp()

  const connectivity = await prisma.$queryRaw<
    { currentDatabase: string; serverVersion: string }[]
  >`SELECT current_database() AS "currentDatabase", version() AS "serverVersion"`
  assert.equal(connectivity[0]?.currentDatabase, 'wise_grade')
  console.log(
    `PASS  PostgreSQL connectivity (database=${connectivity[0]?.currentDatabase}, server=${connectivity[0]?.serverVersion.split(' ').slice(0, 2).join(' ')})`,
  )

  const annotate = (id: string | undefined | null) => {
    if (id && !createdUserIds.includes(id)) createdUserIds.push(id)
  }

  try {
    // ------------------------------------------------------------------
    // Registration and login
    // ------------------------------------------------------------------
    let schoolAId = ''
    let adminAId = ''
    let adminACookie = ''

    await step('school registration creates a real school + admin', async () => {
      const response = await request(app)
        .post('/api/auth/register-school')
        .set('Origin', ORIGIN)
        .send({
          schoolName: `Phase 3 Verification ${tag}`,
          firstName: 'Verification',
          lastName: 'Admin',
          email: adminAEmail,
          password: PASSWORD,
        })

      assert.equal(response.status, 201, JSON.stringify(response.body))
      assert.equal(response.body.data.school.name, `Phase 3 Verification ${tag}`)
      assert.equal(response.body.data.school.timezone, 'Africa/Accra')
      assert.equal(response.body.data.user.email, adminAEmail)
      assert.equal(response.body.data.memberships[0].role, 'SCHOOL_ADMIN')
      const cookie = response.headers['set-cookie']
      assert.ok(cookie, 'registration must set a session cookie')
      assert.match(String(cookie), /HttpOnly/i)
      assert.doesNotMatch(JSON.stringify(response.body), /verification-password/)
      schoolAId = response.body.data.school.id
      adminAId = response.body.data.user.id
      createdSchoolIds.push(schoolAId)
      annotate(adminAId)

      const persisted = await prisma.school.findUnique({
        where: { id: schoolAId },
        include: { memberships: true, classes: true, subjects: true },
      })
      assert.ok(persisted)
      assert.equal(persisted.memberships.length, 1)
      assert.equal(persisted.memberships[0]?.role, 'SCHOOL_ADMIN')
      assert.equal(persisted.classes.length, 11)
      assert.equal(persisted.subjects.length, 9)
    })

    await step('login authenticates and issues a protected session', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .set('Origin', ORIGIN)
        .send({ email: adminAEmail, password: PASSWORD })

      assert.equal(response.status, 200, JSON.stringify(response.body))
      const setCookie = String(response.headers['set-cookie'])
      assert.match(setCookie, /HttpOnly/i)
      assert.match(setCookie, /SameSite=Lax/i)
      adminACookie = setCookie.split(';')[0] ?? ''
      assert.ok(adminACookie.startsWith('gradely_session='))

      const me = await request(app)
        .get('/api/auth/me')
        .set('Cookie', adminACookie)
      assert.equal(me.status, 200)
      assert.equal(me.body.data.memberships[0].schoolId, schoolAId)

      const wrongPassword = await request(app)
        .post('/api/auth/login')
        .set('Origin', ORIGIN)
        .send({ email: adminAEmail, password: 'wrong-password-123' })
      assert.equal(wrongPassword.status, 401)
    })

    // supertest's Test object only exposes HTTP verb helpers at this level;
    // headers must be attached after choosing the verb.
    const admin = () => ({
      get: (path: string) =>
        request(app).get(path).set('Cookie', adminACookie).set('Origin', ORIGIN),
      post: (path: string) =>
        request(app).post(path).set('Cookie', adminACookie).set('Origin', ORIGIN),
      patch: (path: string) =>
        request(app).patch(path).set('Cookie', adminACookie).set('Origin', ORIGIN),
    })

    await step('cookie-authenticated mutation requires a trusted Origin', async () => {
      const response = await request(app)
        .patch(`/api/schools/${schoolAId}`)
        .set('Cookie', adminACookie)
        .send({ name: 'Should be rejected' })
      assert.equal(response.status, 403)
    })

    // ------------------------------------------------------------------
    // School profile
    // ------------------------------------------------------------------
    await step('school profile can be read and updated', async () => {
      const read = await admin().get(`/api/schools/${schoolAId}/profile`)
      assert.equal(read.status, 200)
      assert.equal(read.body.data.school.name, `Phase 3 Verification ${tag}`)
      assert.equal(read.body.data.school.timezone, 'Africa/Accra')

      const update = await admin()
        .patch(`/api/schools/${schoolAId}`)
        .send({
          name: `Phase 3 Verification School ${tag}`,
          email: `${tag}.office@gradely.test`,
          phone: '+233 24 000 0000',
          address: '12 Verification Road',
        })
      assert.equal(update.status, 200, JSON.stringify(update.body))
      assert.equal(update.body.data.school.name, `Phase 3 Verification School ${tag}`)
      assert.equal(update.body.data.school.phone, '+233 24 000 0000')
    })

    // ------------------------------------------------------------------
    // Academic year, term, classes, pupil, enrollment
    // ------------------------------------------------------------------
    let yearId = ''
    let termId = ''
    let classAId = ''
    let classBId = ''
    let pupilId = ''
    let subjectId = ''

    await step('academic year and term are created and activated', async () => {
      const year = await admin()
        .post(`/api/schools/${schoolAId}/academic-years`)
        .send({
          name: `Verification Year ${tag}`,
          startsOn: '2026-09-01',
          endsOn: '2027-07-31',
          isCurrent: true,
        })
      assert.equal(year.status, 201, JSON.stringify(year.body))
      yearId = year.body.data.academicYear.id

      const term = await admin()
        .post(`/api/schools/${schoolAId}/academic-years/${yearId}/terms`)
        .send({
          name: `Verification Term ${tag}`,
          sequence: 1,
          startsOn: '2026-09-01',
          endsOn: '2026-12-18',
          isCurrent: true,
        })
      assert.equal(term.status, 201, JSON.stringify(term.body))
      termId = term.body.data.term.id

      const activate = await admin()
        .post(`/api/schools/${schoolAId}/academic-terms/${termId}/activate`)
        .send({})
      assert.equal(activate.status, 200)
      assert.equal(activate.body.data.term.isCurrent, true)

      const years = await admin().get(`/api/schools/${schoolAId}/academic-years`)
      assert.equal(years.body.data.academicYears[0].isCurrent, true)
      assert.equal(years.body.data.academicYears[0].terms[0].id, termId)
    })

    await step('custom classes can be created alongside the Ghanaian defaults', async () => {
      const classA = await admin()
        .post(`/api/schools/${schoolAId}/classes`)
        .send({ name: `Verification Class A ${tag}`, level: 'BASIC', sortOrder: 900 })
      assert.equal(classA.status, 201, JSON.stringify(classA.body))
      classAId = classA.body.data.class.id

      const classB = await admin()
        .post(`/api/schools/${schoolAId}/classes`)
        .send({ name: `Verification Class B ${tag}`, level: 'BASIC', sortOrder: 910 })
      assert.equal(classB.status, 201, JSON.stringify(classB.body))
      classBId = classB.body.data.class.id

      const classes = await admin().get(`/api/schools/${schoolAId}/classes`)
      assert.equal(classes.body.data.classes.length, 13)
      assert.ok(classes.body.data.classes.some((item: { name: string }) => item.name === 'Basic 6'))
    })

    await step('pupil registration and enrollment history are persisted', async () => {
      const pupil = await admin()
        .post(`/api/schools/${schoolAId}/pupils`)
        .send({
          firstName: 'Verification',
          lastName: 'Pupil',
          otherNames: 'Disposable',
          admissionNumber: `VER-${tag}`,
          gender: 'FEMALE',
          dateOfBirth: '2016-04-12',
          classId: classAId,
          academicYearId: yearId,
          startedOn: '2026-09-01',
        })
      assert.equal(pupil.status, 201, JSON.stringify(pupil.body))
      pupilId = pupil.body.data.pupil.id
      assert.equal(pupil.body.data.pupil.enrollments.length, 1)

      const move = await admin()
        .post(`/api/schools/${schoolAId}/pupils/${pupilId}/enrollments`)
        .send({ classId: classBId, academicYearId: yearId, startedOn: '2027-01-12' })
      assert.equal(move.status, 201, JSON.stringify(move.body))
      assert.equal(move.body.data.pupil.currentClassId, classBId)
      assert.equal(move.body.data.pupil.enrollments.length, 2)

      const persisted = await prisma.pupilEnrollment.findMany({
        where: { schoolId: schoolAId, pupilId },
        orderBy: { startedOn: 'desc' },
      })
      assert.equal(persisted.length, 2)
      assert.equal(persisted[0]?.status, 'ACTIVE')
      assert.equal(persisted[1]?.status, 'COMPLETED')

      const search = await admin().get(
        `/api/schools/${schoolAId}/pupils?q=${encodeURIComponent(`VER-${tag}`)}`,
      )
      assert.equal(search.body.data.total, 1)
    })

    // ------------------------------------------------------------------
    // Subjects and assignments
    // ------------------------------------------------------------------
    await step('subject creation and subject-to-class assignment work', async () => {
      const subject = await admin()
        .post(`/api/schools/${schoolAId}/subjects`)
        .send({ name: `Verification Subject ${tag}`, code: 'VSUB' })
      assert.equal(subject.status, 201, JSON.stringify(subject.body))
      subjectId = subject.body.data.subject.id

      const assign = await admin()
        .post(`/api/schools/${schoolAId}/classes/${classBId}/subjects`)
        .send({ subjectId })
      assert.equal(assign.status, 201, JSON.stringify(assign.body))

      const list = await admin().get(
        `/api/schools/${schoolAId}/classes/${classBId}/subjects`,
      )
      assert.equal(list.status, 200)
      assert.equal(
        list.body.data.subjects.filter(
          (item: { subjectId: string }) => item.subjectId === subjectId,
        ).length,
        1,
      )

      const archived = await admin()
        .patch(`/api/schools/${schoolAId}/subjects/${subjectId}`)
        .send({ isArchived: true })
      assert.equal(archived.status, 200)
      const restored = await admin()
        .patch(`/api/schools/${schoolAId}/subjects/${subjectId}`)
        .send({ isArchived: false })
      assert.equal(restored.status, 200)
    })

    // ------------------------------------------------------------------
    // Teachers and assignments
    // ------------------------------------------------------------------
    let classTeacherMembershipId = ''
    let subjectTeacherMembershipId = ''
    let classTeacherCookie = ''
    let classTeacherUserId = ''
    let subjectTeacherUserId = ''

    await step('teacher registration is controlled and never grants platform admin', async () => {
      const classTeacher = await admin()
        .post(`/api/schools/${schoolAId}/teachers`)
        .send({
          firstName: 'Class',
          lastName: 'Teacher',
          email: classTeacherEmail,
          role: 'CLASS_TEACHER',
          initialPassword: PASSWORD,
        })
      assert.equal(classTeacher.status, 201, JSON.stringify(classTeacher.body))
      classTeacherMembershipId = classTeacher.body.data.teacher.membershipId
      classTeacherUserId = classTeacher.body.data.teacher.userId
      annotate(classTeacherUserId)

      const subjectTeacher = await admin()
        .post(`/api/schools/${schoolAId}/teachers`)
        .send({
          firstName: 'Subject',
          lastName: 'Teacher',
          email: subjectTeacherEmail,
          role: 'SUBJECT_TEACHER',
          initialPassword: PASSWORD,
        })
      assert.equal(subjectTeacher.status, 201, JSON.stringify(subjectTeacher.body))
      subjectTeacherMembershipId = subjectTeacher.body.data.teacher.membershipId
      subjectTeacherUserId = subjectTeacher.body.data.teacher.userId
      annotate(subjectTeacherUserId)

      const persisted = await prisma.user.findMany({
        where: { id: { in: [classTeacherUserId, subjectTeacherUserId] } },
      })
      assert.equal(persisted.length, 2)
      assert.ok(persisted.every((user) => user.isPlatformAdmin === false))

      const forbidden = await admin()
        .post(`/api/schools/${schoolAId}/teachers`)
        .send({
          firstName: 'Bad',
          lastName: 'Role',
          email: `${tag}.bad-role@gradely.test`,
          role: 'SCHOOL_ADMIN',
          initialPassword: PASSWORD,
        })
      assert.equal(forbidden.status, 400)

      const platformRole = await admin()
        .post(`/api/schools/${schoolAId}/teachers`)
        .send({
          firstName: 'Bad',
          lastName: 'Role',
          email: `${tag}.platform-role@gradely.test`,
          role: 'PLATFORM_SUPER_ADMIN',
          initialPassword: PASSWORD,
        })
      assert.equal(platformRole.status, 400)
    })

    await step('class-teacher and subject-teacher assignments are persisted', async () => {
      const classAssign = await admin()
        .post(`/api/schools/${schoolAId}/classes/${classBId}/class-teacher`)
        .send({ membershipId: classTeacherMembershipId })
      assert.equal(classAssign.status, 201, JSON.stringify(classAssign.body))

      const subjectAssign = await admin()
        .post(
          `/api/schools/${schoolAId}/classes/${classBId}/subjects/${subjectId}/teacher`,
        )
        .send({ membershipId: subjectTeacherMembershipId })
      assert.equal(subjectAssign.status, 201, JSON.stringify(subjectAssign.body))

      const assignments = await admin().get(
        `/api/schools/${schoolAId}/teacher-assignments`,
      )
      assert.equal(assignments.status, 200)
      assert.equal(assignments.body.data.assignments.classTeachers.length, 1)
      assert.equal(assignments.body.data.assignments.subjectTeachers.length, 1)
    })

    // ------------------------------------------------------------------
    // Teacher access restrictions
    // ------------------------------------------------------------------
    await step('class teacher is limited to their assigned class', async () => {
      const login = await request(app)
        .post('/api/auth/login')
        .set('Origin', ORIGIN)
        .send({ email: classTeacherEmail, password: PASSWORD })
      assert.equal(login.status, 200)
      classTeacherCookie = String(login.headers['set-cookie']).split(';')[0] ?? ''

      const classes = await request(app)
        .get(`/api/schools/${schoolAId}/classes`)
        .set('Cookie', classTeacherCookie)
      assert.equal(classes.status, 200)
      assert.deepEqual(
        classes.body.data.classes.map((item: { id: string }) => item.id),
        [classBId],
      )

      const assignedRead = await request(app)
        .get(`/api/schools/${schoolAId}/classes/${classBId}/subjects`)
        .set('Cookie', classTeacherCookie)
      assert.equal(assignedRead.status, 200)

      const unassignedRead = await request(app)
        .get(`/api/schools/${schoolAId}/classes/${classAId}/subjects`)
        .set('Cookie', classTeacherCookie)
      assert.equal(unassignedRead.status, 403)

      const teacherAdminRoute = await request(app)
        .get(`/api/schools/${schoolAId}/teachers`)
        .set('Cookie', classTeacherCookie)
      assert.equal(teacherAdminRoute.status, 403)

      const pupils = await request(app)
        .get(`/api/schools/${schoolAId}/pupils`)
        .set('Cookie', classTeacherCookie)
      assert.equal(pupils.status, 200)
      assert.equal(pupils.body.data.total, 1)
      assert.equal(pupils.body.data.pupils[0].id, pupilId)
    })

    await step('subject teacher can read but not manage their class subjects', async () => {
      const login = await request(app)
        .post('/api/auth/login')
        .set('Origin', ORIGIN)
        .send({ email: subjectTeacherEmail, password: PASSWORD })
      assert.equal(login.status, 200)
      const cookie = String(login.headers['set-cookie']).split(';')[0] ?? ''

      const assignedRead = await request(app)
        .get(`/api/schools/${schoolAId}/classes/${classBId}/subjects`)
        .set('Cookie', cookie)
      assert.equal(assignedRead.status, 200)

      const unassignedRead = await request(app)
        .get(`/api/schools/${schoolAId}/classes/${classAId}/subjects`)
        .set('Cookie', cookie)
      assert.equal(unassignedRead.status, 403)

      const manageAttempt = await request(app)
        .post(`/api/schools/${schoolAId}/classes/${classBId}/subjects`)
        .set('Cookie', cookie)
        .set('Origin', ORIGIN)
        .send({ subjectId })
      assert.equal(manageAttempt.status, 403)
    })

    await step('suspended membership loses access to the school', async () => {
      await prisma.schoolMembership.update({
        where: { id: classTeacherMembershipId },
        data: { status: 'SUSPENDED' },
      })

      const denied = await request(app)
        .get(`/api/schools/${schoolAId}/classes`)
        .set('Cookie', classTeacherCookie)
      assert.equal(denied.status, 403)
    })

    // ------------------------------------------------------------------
    // Cross-school isolation
    // ------------------------------------------------------------------
    await step('a second school cannot read the first school data', async () => {
      const registration = await request(app)
        .post('/api/auth/register-school')
        .set('Origin', ORIGIN)
        .send({
          schoolName: `Phase 3 Isolation ${tag}`,
          firstName: 'Isolation',
          lastName: 'Admin',
          email: adminBEmail,
          password: PASSWORD,
        })
      assert.equal(registration.status, 201, JSON.stringify(registration.body))
      const schoolBId = registration.body.data.school.id
      const adminBId = registration.body.data.user.id
      createdSchoolIds.push(schoolBId)
      annotate(adminBId)

      const adminBCookie = String(registration.headers['set-cookie']).split(';')[0] ?? ''
      const adminB = () => ({
        get: (path: string) =>
          request(app).get(path).set('Cookie', adminBCookie).set('Origin', ORIGIN),
        patch: (path: string) =>
          request(app).patch(path).set('Cookie', adminBCookie).set('Origin', ORIGIN),
      })

      const profileDenied = await adminB().get(
        `/api/schools/${schoolAId}/profile`,
      )
      assert.equal(profileDenied.status, 403)

      const profileUpdateDenied = await adminB()
        .patch(`/api/schools/${schoolAId}`)
        .send({ name: 'Hijacked' })
      assert.equal(profileUpdateDenied.status, 403)

      const pupilDenied = await adminB().get(
        `/api/schools/${schoolBId}/pupils/${pupilId}`,
      )
      assert.equal(pupilDenied.status, 404)

      const reverseDenied = await admin().get(
        `/api/schools/${schoolBId}/profile`,
      )
      assert.equal(reverseDenied.status, 403)
    })

    // ------------------------------------------------------------------
    // Audit logging
    // ------------------------------------------------------------------
    await step('audit log records the Phase 3 mutations', async () => {
      const entries = await prisma.auditLog.findMany({
        where: { schoolId: schoolAId },
        select: { action: true },
      })
      const actions = new Set(entries.map((entry) => entry.action))
      const expected = [
        'SCHOOL_REGISTERED',
        'SCHOOL_PROFILE_UPDATED',
        'ACADEMIC_YEAR_CREATED',
        'ACADEMIC_TERM_CREATED',
        'ACADEMIC_TERM_ACTIVATED',
        'CLASS_CREATED',
        'PUPIL_CREATED',
        'PUPIL_ENROLLED',
        'SUBJECT_CREATED',
        'CLASS_SUBJECT_ASSIGNED',
        'TEACHER_REGISTERED',
        'CLASS_TEACHER_ASSIGNED',
        'SUBJECT_TEACHER_ASSIGNED',
      ]

      for (const action of expected) {
        assert.ok(actions.has(action), `missing audit action ${action}`)
      }

      const persisted = await prisma.auditLog.count({
        where: { schoolId: schoolAId },
      })
      assert.ok(persisted >= expected.length)
    })

    // ------------------------------------------------------------------
    // Session invalidation
    // ------------------------------------------------------------------
    await step('logout revokes the server-side session', async () => {
      const logout = await admin()
        .post('/api/auth/logout')
        .send({})
      assert.equal(logout.status, 200)

      const afterLogout = await request(app)
        .get(`/api/schools/${schoolAId}/profile`)
        .set('Cookie', adminACookie)
      assert.equal(afterLogout.status, 401)
    })
  } finally {
    console.log('... cleaning up disposable verification records')

    if (createdSchoolIds.length > 0 || createdUserIds.length > 0) {
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { schoolId: { in: createdSchoolIds } },
            { actorUserId: { in: createdUserIds } },
          ],
        },
      })
    }

    if (createdSchoolIds.length > 0) {
      await prisma.school.deleteMany({ where: { id: { in: createdSchoolIds } } })
    }

    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } })
    }

    const [schoolsLeft, usersLeft, auditLeft] = await Promise.all([
      prisma.school.count({ where: { id: { in: createdSchoolIds } } }),
      prisma.user.count({ where: { id: { in: createdUserIds } } }),
      prisma.auditLog.count({
        where: {
          OR: [
            { schoolId: { in: createdSchoolIds } },
            { actorUserId: { in: createdUserIds } },
          ],
        },
      }),
    ])

    console.log(
      `CLEANUP schools=${schoolsLeft} users=${usersLeft} auditEntries=${auditLeft}`,
    )
    assert.equal(schoolsLeft, 0)
    assert.equal(usersLeft, 0)
    assert.equal(auditLeft, 0)

    await prisma.$disconnect()
  }

  if (failures > 0) {
    console.error(`\n${failures} live verification step(s) failed`)
    process.exitCode = 1
  } else {
    console.log('\nAll live Phase 3 verification steps passed')
  }
}

main().catch((error) => {
  console.error('Live verification could not complete')
  console.error(error)
  process.exitCode = 1
})
