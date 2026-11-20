import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import {
  registrationBody,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from './helpers/auth-fixtures.js'
import { CaptureEmailService } from './helpers/capture-email-service.js'
import { FakeAuthRepository } from './helpers/fake-auth-repository.js'
import { FakeSchoolRepository } from './helpers/fake-school-repository.js'

/**
 * Administrator teacher management:
 * PATCH /api/schools/:schoolId/teachers/:membershipId
 * DELETE /api/schools/:schoolId/teachers/:membershipId
 *
 * These routes must normalize identity fields, never accept or return a
 * password, reject cross-tenant membership ids, report email dispatch honestly,
 * and soft-remove access without deleting the account or academic history.
 */

interface TestContext {
  app: ReturnType<typeof createApp>
  auth: FakeAuthRepository
  schools: FakeSchoolRepository
  email: CaptureEmailService
  admin: ReturnType<typeof request.agent>
  schoolId: string
  adminUserId: string
}

const SCHOOL_NAME = 'Green Valley Academy'
const ADMIN_EMAIL = 'admin@greenvalley.test'

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

  return {
    app,
    auth,
    schools,
    email: new CaptureEmailService(),
    admin,
    schoolId,
    adminUserId,
  }
}

describe('administrator teacher management', () => {
  let ctx: TestContext
  let sequence = 0

  beforeEach(async () => {
    const auth = new FakeAuthRepository()
    const schools = new FakeSchoolRepository(auth)
    const email = new CaptureEmailService()
    const app = createApp({
      authRepository: auth,
      schoolRepository: schools,
      emailService: email,
    })
    ctx = await registerSchool(auth, schools, app, {
      schoolName: SCHOOL_NAME,
      email: ADMIN_EMAIL,
    })
    ctx.email = email
  })

  function uniqueEmail(local = 'teacher') {
    sequence += 1
    return `${local}${sequence}@greenvalley.test`
  }

  async function registerClassTeacher(options: {
    email?: string
    className?: string
  } = {}) {
    const response = await ctx.admin
      .post(`/api/schools/${ctx.schoolId}/classes/register`)
      .set('Origin', TEST_ORIGIN)
      .send({
        className: options.className ?? 'Basic 1',
        level: null,
        academicYearId: null,
        teacher: {
          firstName: 'Ama',
          lastName: 'Mensah',
          email: options.email ?? uniqueEmail(),
          phone: null,
        },
      })

    expect(response.status).toBe(201)
    return response.body.data as {
      class: { id: string; name: string }
      teacher: {
        membershipId: string
        userId: string
        email: string
        firstName: string
        lastName: string
        status: string
      }
      accountCreated: boolean
      onboardingEmail: string
    }
  }

  async function createSecondSchool(): Promise<string> {
    const agent = request.agent(ctx.app)
    const response = await agent
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(
        registrationBody({
          schoolName: 'Riverside Academy',
          email: `riverside-${sequence}@example.test`,
        }),
      )

    expect(response.status).toBe(201)
    const schoolId = response.body.data.school.id as string
    ctx.schools.seedSchool({
      id: schoolId,
      name: 'Riverside Academy',
      slug: response.body.data.school.slug,
      email: `riverside-${sequence}@example.test`,
    })

    return schoolId
  }

  function patchTeacher(
    membershipId: string,
    body: Record<string, unknown>,
    schoolId = ctx.schoolId,
  ) {
    return ctx.admin
      .patch(`/api/schools/${schoolId}/teachers/${membershipId}`)
      .set('Origin', TEST_ORIGIN)
      .send(body)
  }

  function deleteTeacher(
    membershipId: string,
    body: Record<string, unknown>,
    schoolId = ctx.schoolId,
  ) {
    return ctx.admin
      .delete(`/api/schools/${schoolId}/teachers/${membershipId}`)
      .set('Origin', TEST_ORIGIN)
      .send(body)
  }

  it('normalizes a changed email, marks it unverified and reports dispatch', async () => {
    const teacher = await registerClassTeacher()
    ctx.email.messages.length = 0

    const response = await patchTeacher(teacher.teacher.membershipId, {
      firstName: ' Ama ',
      lastName: 'Owusu',
      email: ' New.Address@GreenValley.test ',
    })

    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({
      emailChanged: true,
      emailVerification: 'sent',
      teacher: {
        firstName: 'Ama',
        lastName: 'Owusu',
        email: 'new.address@greenvalley.test',
      },
    })
    expect(JSON.stringify(response.body)).not.toMatch(
      /password|temporaryPassword|token/i,
    )

    const verification = ctx.email.last('email-change-verification')
    expect(verification?.to).toBe('new.address@greenvalley.test')
    expect(verification?.data.previousEmail).toBe(teacher.teacher.email)
    expect(String(verification?.data.verificationUrl)).toContain('token=')

    const account = ctx.auth.getUserSnapshot('new.address@greenvalley.test')
    expect(account?.emailVerificationRequired).toBe(true)
    expect(account?.emailVerifiedAt).toBeNull()
  })

  it('reports a failed verification email without pretending the address is verified', async () => {
    const teacher = await registerClassTeacher()
    ctx.email.messages.length = 0
    ctx.email.failNextSend = true

    const response = await patchTeacher(teacher.teacher.membershipId, {
      email: 'unverified@greenvalley.test',
    })

    expect(response.status).toBe(200)
    expect(response.body.data.emailChanged).toBe(true)
    expect(response.body.data.emailVerification).toBe('not_sent')
    expect(ctx.email.last('email-change-verification')).toBeUndefined()

    const account = ctx.auth.getUserSnapshot('unverified@greenvalley.test')
    expect(account?.emailVerificationRequired).toBe(true)
    expect(account?.emailVerifiedAt).toBeNull()
    expect(JSON.stringify(response.body)).not.toContain('token=')
  })

  it('rejects an email already owned by another account without changing the teacher', async () => {
    const teacher = await registerClassTeacher()
    await ctx.auth.createUser({
      email: 'taken@greenvalley.test',
      password: TEST_PASSWORD,
    })

    const response = await patchTeacher(teacher.teacher.membershipId, {
      email: 'TAKEN@greenvalley.test',
    })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('email_in_use')
    expect(response.body.error.details).toEqual([
      expect.objectContaining({ field: 'email' }),
    ])
    expect(
      ctx.auth.getUserSnapshot(teacher.teacher.email)?.email,
    ).toBe(teacher.teacher.email)
  })

  it('rejects a cross-school membership id for both edit and removal', async () => {
    const teacher = await registerClassTeacher()
    const otherSchoolId = await createSecondSchool()
    const otherMembershipId = await ctx.auth.addMembership(
      teacher.teacher.userId,
      otherSchoolId,
      'CLASS_TEACHER',
    )

    const edit = await patchTeacher(otherMembershipId, { firstName: 'Hijack' })
    expect(edit.status).toBe(404)
    expect(edit.body.error.code).toBe('teacher_not_found')

    const removal = await deleteTeacher(otherMembershipId, {
      confirmEmail: teacher.teacher.email,
    })
    expect(removal.status).toBe(404)
    expect(removal.body.error.code).toBe('teacher_not_found')

    expect(
      ctx.auth
        .listMembershipsForSchool(otherSchoolId)
        .find((membership) => membership.id === otherMembershipId)?.status,
    ).toBe('ACTIVE')
  })

  it('requires the exact current email before removing access', async () => {
    const teacher = await registerClassTeacher()

    const response = await deleteTeacher(teacher.teacher.membershipId, {
      confirmEmail: 'wrong@greenvalley.test',
    })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('email_confirmation_mismatch')
    expect(
      ctx.auth.getMembershipById(teacher.teacher.membershipId)?.status,
    ).toBe('ACTIVE')
  })

  it('soft-removes one school membership and preserves the account and other-school access', async () => {
    const teacher = await registerClassTeacher()
    const otherSchoolId = await createSecondSchool()
    const otherMembershipId = await ctx.auth.addMembership(
      teacher.teacher.userId,
      otherSchoolId,
      'CLASS_TEACHER',
    )
    ctx.email.messages.length = 0

    const response = await deleteTeacher(teacher.teacher.membershipId, {
      confirmEmail: teacher.teacher.email.toUpperCase(),
      reason: 'Moved to another school',
    })

    expect(response.status).toBe(200)
    expect(response.body.data.teacher.status).toBe('SUSPENDED')
    expect(response.body.data.message).toMatch(/preserved/i)
    expect(JSON.stringify(response.body)).not.toMatch(
      /password|temporaryPassword/i,
    )

    // The account is not deleted and the other school's membership is intact.
    expect(ctx.auth.users.has(teacher.teacher.userId)).toBe(true)
    expect(
      ctx.auth
        .listMembershipsForSchool(otherSchoolId)
        .find((membership) => membership.id === otherMembershipId)?.status,
    ).toBe('ACTIVE')

    // This school's active assignments ended.
    const assignments = await ctx.schools.listTeacherAssignments(ctx.schoolId)
    expect(
      assignments.classTeachers.some(
        (assignment) =>
          assignment.membershipId === teacher.teacher.membershipId &&
          assignment.endedAt === null,
      ),
    ).toBe(false)

    // The school still lists the membership for audit, but as removed.
    const listed = (await ctx.schools.listTeachers(ctx.schoolId)).find(
      (item) => item.membershipId === teacher.teacher.membershipId,
    )
    expect(listed?.status).toBe('SUSPENDED')

    expect(
      ctx.schools.audits.some(
        (audit) => audit.action === 'TEACHER_MEMBERSHIP_REMOVED',
      ),
    ).toBe(true)
  })

  it('does not generate or email another password when a same-school teacher is reused', async () => {
    const email = uniqueEmail('reuse')
    const first = await registerClassTeacher({ email, className: 'Basic 2' })
    const firstMessages = ctx.email.all('teacher-credentials').length

    const second = await registerClassTeacher({
      email: email.toUpperCase(),
      className: 'Basic 3',
    })

    expect(second.accountCreated).toBe(false)
    expect(second.teacher.membershipId).toBe(first.teacher.membershipId)
    expect(second.onboardingEmail).toBe('not_sent')
    expect(ctx.email.all('teacher-credentials')).toHaveLength(firstMessages)
  })

  it('rejects an edit on a membership that was already removed', async () => {
    const teacher = await registerClassTeacher()
    await deleteTeacher(teacher.teacher.membershipId, {
      confirmEmail: teacher.teacher.email,
    })

    const response = await patchTeacher(teacher.teacher.membershipId, {
      firstName: 'Again',
    })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('teacher_inactive')
  })
})
