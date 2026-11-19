import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { hashToken } from '../src/auth/tokens.js'
import { registrationBody, TEST_ORIGIN } from './helpers/auth-fixtures.js'
import { CaptureEmailService } from './helpers/capture-email-service.js'
import { FakeAuthRepository } from './helpers/fake-auth-repository.js'
import { FakeSchoolRepository } from './helpers/fake-school-repository.js'

const TEACHER_PASSWORD = 'InitialPass123'

interface IssuedInvitation {
  id: string
  code: string
  classId: string
  subjectId: string
  assignmentId: string
  status: string
  expiresAt: string
  email: string
}

/**
 * Subject-teacher access codes.
 *
 * A code is bound to exactly one school, class, subject and assignment. Only
 * the SHA-256 hash is persisted; the plaintext code is delivered by email and
 * returned once to the issuing class teacher, never stored in audit records.
 */
describe('subject teacher access codes', () => {
  let auth: FakeAuthRepository
  let schools: FakeSchoolRepository
  let email: CaptureEmailService
  let app: ReturnType<typeof createApp>
  let admin: ReturnType<typeof request.agent>
  let classTeacher: ReturnType<typeof request.agent>
  let schoolId: string
  let classId: string

  async function login(emailAddress: string) {
    const agent = request.agent(app)
    const response = await agent
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: emailAddress, password: TEACHER_PASSWORD })

    expect(response.status).toBe(200)
    return agent
  }

  beforeEach(async () => {
    auth = new FakeAuthRepository()
    schools = new FakeSchoolRepository(auth)
    email = new CaptureEmailService()
    app = createApp({
      authRepository: auth,
      schoolRepository: schools,
      emailService: email,
    })

    admin = request.agent(app)
    const registration = await admin
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(
        registrationBody({
          email: 'admin@access-codes.test',
          schoolName: 'Access Code Academy',
        }),
      )

    expect(registration.status).toBe(201)
    schoolId = registration.body.data.school.id as string

    schools.seedSchool({
      id: schoolId,
      name: 'Access Code Academy',
      slug: registration.body.data.school.slug as string,
      email: 'admin@access-codes.test',
    })
    schools.seedDefaults(schoolId, registration.body.data.user.id as string)

    const classRegistration = await admin
      .post(`/api/schools/${schoolId}/classes/register`)
      .set('Origin', TEST_ORIGIN)
      .send({
        className: 'Basic 2',
        teacher: {
          firstName: 'Class',
          lastName: 'Teacher',
          email: 'ct@access-codes.test',
          initialPassword: TEACHER_PASSWORD,
        },
      })

    expect(classRegistration.status).toBe(201)
    classId = classRegistration.body.data.class.id as string
    classTeacher = await login('ct@access-codes.test')
  })

  async function assignSubject(
    agent: ReturnType<typeof request.agent>,
    input: {
      name?: string
      subjectId?: string
      email?: string
      firstName?: string
      lastName?: string
    } = {},
  ): Promise<IssuedInvitation> {
    const response = await agent
      .post(`/api/schools/${schoolId}/classes/${classId}/subjects`)
      .set('Origin', TEST_ORIGIN)
      .send({
        ...(input.subjectId
          ? { subjectId: input.subjectId }
          : { name: input.name ?? 'Mathematics' }),
        subjectTeacher: {
          firstName: input.firstName ?? 'Subject',
          lastName: input.lastName ?? 'Teacher',
          email: input.email ?? 'subject@access-codes.test',
          phone: null,
        },
      })

    expect(response.status).toBe(201)
    return response.body.data.invitation as IssuedInvitation
  }

  function enterCode(agent: ReturnType<typeof request.agent>, code: string) {
    return agent
      .post('/api/auth/subject-teacher/access-code')
      .set('Origin', TEST_ORIGIN)
      .send({ code })
  }

  it('issues a code bound to the exact school, class, subject and assignment', async () => {
    const invitation = await assignSubject(classTeacher)

    // The plaintext code is returned once and emailed to the subject teacher.
    expect(invitation.code).toBeTruthy()
    const assignment = email.last('subject-assignment')
    expect(assignment).toBeDefined()
    expect(assignment?.to).toBe('subject@access-codes.test')
    expect(assignment?.data.accessCode).toBe(invitation.code)
    expect(assignment?.data.className).toBe('Basic 2')
    expect(assignment?.data.subjectName).toBe('Mathematics')

    // Only the hash is stored. Neither the fake persistence nor the audit trail
    // contains the plaintext code.
    expect(auth.invitations.has(invitation.code)).toBe(false)
    expect(auth.invitations.has(hashToken(invitation.code))).toBe(true)
    expect(JSON.stringify(auth.audits)).not.toContain(invitation.code)

    const agent = request.agent(app)
    const entered = await enterCode(agent, invitation.code)

    expect(entered.status).toBe(200)
    expect(entered.body.data.subjectSession).toMatchObject({
      schoolId,
      classId,
      subjectId: invitation.subjectId,
    })
    expect(auth.auditActions()).toContain('SUBJECT_TEACHER_ACCESS_CODE_USED')
  })

  it('sets a seven-day expiry and rejects the code afterwards', async () => {
    const invitation = await assignSubject(classTeacher)

    const list = await classTeacher.get(
      `/api/schools/${schoolId}/classes/${classId}/subject-teacher-invitations`,
    )
    expect(list.status).toBe(200)
    const listed = (
      list.body.data.invitations as Array<IssuedInvitation & { status: string }>
    ).find((item) => item.id === invitation.id)

    expect(listed?.status).toBe('PENDING')
    const ttlHours =
      (new Date(listed!.expiresAt).getTime() - Date.now()) / (60 * 60 * 1000)
    expect(ttlHours).toBeGreaterThan(7 * 24 - 1)
    expect(ttlHours).toBeLessThanOrEqual(7 * 24)

    schools.expireInvitation(invitation.id)

    const expired = await enterCode(request.agent(app), invitation.code)
    expect(expired.status).toBe(401)
    expect(expired.body.error.message).toMatch(/invalid, has expired, or has been revoked/i)
  })

  it('rejects an invalid or revoked code', async () => {
    const invalid = await enterCode(request.agent(app), 'x'.repeat(32))
    expect(invalid.status).toBe(401)

    const invitation = await assignSubject(classTeacher)
    const revoked = await classTeacher
      .delete(
        `/api/schools/${schoolId}/classes/${classId}/subject-teacher-invitations/${invitation.id}`,
      )
      .set('Origin', TEST_ORIGIN)
    expect(revoked.status).toBe(200)

    const afterRevoke = await enterCode(request.agent(app), invitation.code)
    expect(afterRevoke.status).toBe(401)
    expect(schools.auditActions()).toContain('SUBJECT_TEACHER_INVITATION_REVOKED')
  })

  it('isolates replacement codes from the assignment they replaced', async () => {
    const first = await assignSubject(classTeacher, {
      email: 'first-subject@access-codes.test',
      firstName: 'First',
    })

    const firstSession = await enterCode(request.agent(app), first.code)
    expect(firstSession.status).toBe(200)

    // Replacing the teacher ends the previous assignment and invalidates the
    // previous code for the same subject.
    const replaced = await assignSubject(classTeacher, {
      name: 'Mathematics',
      subjectId: first.subjectId,
      email: 'second-subject@access-codes.test',
      firstName: 'Second',
    })

    expect(replaced.code).not.toBe(first.code)
    expect(replaced.assignmentId).not.toBe(first.assignmentId)
    const secondEmail = email.last('subject-assignment')
    expect(secondEmail?.to).toBe('second-subject@access-codes.test')
    expect(secondEmail?.data.accessCode).toBe(replaced.code)

    const oldCode = await enterCode(request.agent(app), first.code)
    expect(oldCode.status).toBe(401)

    const newCode = await enterCode(request.agent(app), replaced.code)
    expect(newCode.status).toBe(200)
    expect(newCode.body.data.subjectSession.subjectId).toBe(first.subjectId)
    expect(schools.auditActions()).toContain('SUBJECT_TEACHER_REPLACED')
  })

  it('only lets the assigned class teacher issue or reissue codes for that class', async () => {
    const invitation = await assignSubject(classTeacher)

    const secondClass = await admin
      .post(`/api/schools/${schoolId}/classes/register`)
      .set('Origin', TEST_ORIGIN)
      .send({
        className: 'Basic 4',
        teacher: {
          firstName: 'Other',
          lastName: 'Teacher',
          email: 'other-ct@access-codes.test',
          initialPassword: TEACHER_PASSWORD,
        },
      })
    expect(secondClass.status).toBe(201)

    // Seed the second class profile, then sign in as its class teacher.
    const otherClassId = secondClass.body.data.class.id as string
    const otherTeacher = await login('other-ct@access-codes.test')

    const list = await otherTeacher.get(
      `/api/schools/${schoolId}/classes/${classId}/subject-teacher-invitations`,
    )
    expect(list.status).toBe(403)

    const reissue = await otherTeacher
      .post(
        `/api/schools/${schoolId}/classes/${classId}/subject-teacher-invitations/${invitation.id}/reissue`,
      )
      .set('Origin', TEST_ORIGIN)
    expect(reissue.status).toBe(403)

    // A subject session can never manage codes either, even for its own class.
    const subjectAgent = request.agent(app)
    await enterCode(subjectAgent, invitation.code)
    const subjectList = await subjectAgent.get(
      `/api/schools/${schoolId}/classes/${classId}/subject-teacher-invitations`,
    )
    expect([401, 403]).toContain(subjectList.status)

    // The other class's own invitations are still empty.
    const own = await otherTeacher.get(
      `/api/schools/${schoolId}/classes/${otherClassId}/subject-teacher-invitations`,
    )
    expect(own.status).toBe(200)
    expect(own.body.data.invitations).toHaveLength(0)
  })

  it('rate-limits repeated reissue requests', async () => {
    const invitation = await assignSubject(classTeacher)
    const url = `/api/schools/${schoolId}/classes/${classId}/subject-teacher-invitations/${invitation.id}/reissue`

    let current = invitation
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await classTeacher
        .post(url)
        .set('Origin', TEST_ORIGIN)
        .send()
      expect(response.status).toBe(201)
      current = response.body.data.invitation as IssuedInvitation
    }

    const limited = await classTeacher
      .post(
        `/api/schools/${schoolId}/classes/${classId}/subject-teacher-invitations/${current.id}/reissue`,
      )
      .set('Origin', TEST_ORIGIN)
      .send()
    expect(limited.status).toBe(429)

    // The most recent code still works; the limiter only blocks new codes.
    const usable = await enterCode(request.agent(app), current.code)
    expect(usable.status).toBe(200)
  })

  it('records the issuing class teacher in the audit history', async () => {
    const invitation = await assignSubject(classTeacher)

    const created = schools.audits.find(
      (entry) =>
        entry.action === 'SUBJECT_TEACHER_INVITATION_CREATED' &&
        entry.entityId === invitation.id,
    )
    expect(created).toBeDefined()
    expect(created?.actorUserId).toBe(
      auth.getUserSnapshot('ct@access-codes.test')?.id,
    )

    const reissued = await classTeacher
      .post(
        `/api/schools/${schoolId}/classes/${classId}/subject-teacher-invitations/${invitation.id}/reissue`,
      )
      .set('Origin', TEST_ORIGIN)
    expect(reissued.status).toBe(201)
    expect(email.last('subject-code-replaced')?.data.accessCode).toBe(
      reissued.body.data.invitation.code,
    )

    const reissueAudit = schools.audits.find(
      (entry) => entry.action === 'SUBJECT_TEACHER_INVITATION_REISSUED',
    )
    expect(reissueAudit?.entityId).toBe(reissued.body.data.invitation.id)
    expect(reissueAudit?.actorUserId).toBe(
      auth.getUserSnapshot('ct@access-codes.test')?.id,
    )
  })

  it('sends one expiry notice when an expired invitation is listed', async () => {
    const invitation = await assignSubject(classTeacher)
    schools.expireInvitation(invitation.id)

    const list = await classTeacher.get(
      `/api/schools/${schoolId}/classes/${classId}/subject-teacher-invitations`,
    )
    expect(list.status).toBe(200)

    const notice = email.last('subject-code-expired')
    expect(notice).toBeDefined()
    expect(notice?.to).toBe('subject@access-codes.test')
    expect(notice?.data.subjectName).toBe('Mathematics')
    // The notice never repeats the code itself.
    expect(JSON.stringify(notice?.data)).not.toContain(invitation.code)
  })
})
