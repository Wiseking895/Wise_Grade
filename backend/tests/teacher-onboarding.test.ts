import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { registrationBody, TEST_ORIGIN, TEST_PASSWORD } from './helpers/auth-fixtures.js'
import { CaptureEmailService } from './helpers/capture-email-service.js'
import { FakeAuthRepository } from './helpers/fake-auth-repository.js'
import { FakeSchoolRepository } from './helpers/fake-school-repository.js'

const NEW_TEACHER_PASSWORD = 'PersonalPass456'

/**
 * Class-teacher onboarding: the credentials email, the forced first-login
 * password rotation, and the guarantee that an existing account is never sent a
 * temporary password it did not receive in the API response.
 */
describe('class teacher onboarding', () => {
  let auth: FakeAuthRepository
  let schools: FakeSchoolRepository
  let email: CaptureEmailService
  let app: ReturnType<typeof createApp>
  let admin: ReturnType<typeof request.agent>
  let schoolId: string

  beforeEach(async () => {
    auth = new FakeAuthRepository({ requireTeacherPasswordChange: true })
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
          email: 'admin@onboarding.test',
          schoolName: 'Onboarding Academy',
        }),
      )

    expect(registration.status).toBe(201)
    schoolId = registration.body.data.school.id as string

    schools.seedSchool({
      id: schoolId,
      name: 'Onboarding Academy',
      slug: registration.body.data.school.slug as string,
      email: 'admin@onboarding.test',
    })
    schools.seedDefaults(schoolId, registration.body.data.user.id as string)
  })

  async function registerClass(overrides: {
    className: string
    email: string
  }) {
    return admin
      .post(`/api/schools/${schoolId}/classes/register`)
      .set('Origin', TEST_ORIGIN)
      .send({
        className: overrides.className,
        level: null,
        academicYearId: null,
        teacher: {
          firstName: 'Ama',
          lastName: 'Mensah',
          email: overrides.email,
          phone: null,
        },
      })
  }

  it('emails the class teacher their school, class, login and generated password', async () => {
    const response = await registerClass({
      className: 'Basic 2',
      email: 'ama@onboarding.test',
    })

    expect(response.status).toBe(201)

    const credentials = email.last('teacher-credentials')
    expect(credentials).toBeDefined()
    expect(credentials?.to).toBe('ama@onboarding.test')
    expect(credentials?.data.schoolName).toBe('Onboarding Academy')
    expect(credentials?.data.className).toBe('Basic 2')
    expect(credentials?.data.loginEmail).toBe('ama@onboarding.test')
    expect(String(credentials?.data.loginUrl)).toContain('/login')

    // The administrator never chose this value: the server generated a strong
    // temporary password and included it only in the onboarding email.
    const temporaryPassword = String(credentials?.data.temporaryPassword)
    expect(temporaryPassword).toHaveLength(20)
    expect(temporaryPassword).toMatch(/[A-Z]/)
    expect(temporaryPassword).toMatch(/[a-z]/)
    expect(temporaryPassword).toMatch(/[0-9]/)
    expect(temporaryPassword).not.toMatch(/[0O1Il]/)

    // The temporary password never appears in the API response or in stored
    // audit metadata.
    expect(JSON.stringify(response.body)).not.toContain(temporaryPassword)
    expect(JSON.stringify(response.body)).not.toMatch(/password/i)
    expect(JSON.stringify(auth.audits)).not.toContain(temporaryPassword)

    const teachers = await admin.get(`/api/schools/${schoolId}/teachers`)
    expect(teachers.status).toBe(200)
    expect(JSON.stringify(teachers.body)).not.toContain(temporaryPassword)
    expect(JSON.stringify(teachers.body)).not.toContain('passwordHash')
  })

  it('forces a temporary password to be replaced before the workspace opens', async () => {
    await registerClass({
      className: 'Basic 2',
      email: 'ama@onboarding.test',
    })

    const temporaryPassword = String(
      email.last('teacher-credentials')?.data.temporaryPassword,
    )
    expect(temporaryPassword).toHaveLength(20)

    const teacher = request.agent(app)
    const login = await teacher
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'ama@onboarding.test', password: temporaryPassword })

    expect(login.status).toBe(200)
    expect(login.body.data.user.mustChangePassword).toBe(true)

    // A first-login reminder is captured with a link to the rotation page.
    const reminder = email.last('teacher-first-login')
    expect(reminder).toBeDefined()
    expect(String(reminder?.data.changePasswordUrl)).toContain('/change-password')
    expect(JSON.stringify(reminder?.data)).not.toContain(temporaryPassword)

    // The session may read its own identity and sign out, but nothing else.
    const me = await teacher.get('/api/auth/me')
    expect(me.status).toBe(200)
    expect(me.body.data.user.mustChangePassword).toBe(true)

    const blocked = await teacher.get(`/api/schools/${schoolId}/classes`)
    expect(blocked.status).toBe(403)
    expect(blocked.body.error.message).toMatch(/set a new password/i)
    expect(blocked.body.error.code).toBe('password_change_required')

    const wrongCurrent = await teacher
      .post('/api/auth/change-password')
      .set('Origin', TEST_ORIGIN)
      .send({
        currentPassword: 'not-the-password',
        newPassword: NEW_TEACHER_PASSWORD,
      })
    expect(wrongCurrent.status).toBe(401)
    expect(wrongCurrent.body.error.code).toBe('password_invalid')

    const changed = await teacher
      .post('/api/auth/change-password')
      .set('Origin', TEST_ORIGIN)
      .send({
        currentPassword: temporaryPassword,
        newPassword: NEW_TEACHER_PASSWORD,
      })
    expect(changed.status).toBe(200)
    expect(changed.body.data.user.mustChangePassword).toBe(false)

    const allowed = await teacher.get(`/api/schools/${schoolId}/classes`)
    expect(allowed.status).toBe(200)

    // The previous password no longer works; the personal one does.
    const oldLogin = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'ama@onboarding.test', password: temporaryPassword })
    expect(oldLogin.status).toBe(401)

    const newLogin = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'ama@onboarding.test', password: NEW_TEACHER_PASSWORD })
    expect(newLogin.status).toBe(200)
    expect(newLogin.body.data.user.mustChangePassword).toBe(false)
  })

  it('rejects an existing account from another school without generating credentials', async () => {
    const existing = await auth.createUser({
      email: 'existing@onboarding.test',
      password: TEST_PASSWORD,
      firstName: 'Existing',
      lastName: 'Teacher',
    })
    // The account belongs to a different school, so this tenant must not attach
    // it, generate a second password or report a successful onboarding email.
    const otherSchoolId = randomUUID()
    auth.seedSchool({
      id: otherSchoolId,
      name: 'Another Academy',
      slug: 'another-academy',
    })
    await auth.addMembership(existing.id, otherSchoolId, 'CLASS_TEACHER')

    const response = await registerClass({
      className: 'Basic 3',
      email: 'EXISTING@onboarding.test',
    })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('email_in_use')
    expect(email.all('teacher-credentials')).toHaveLength(0)
    expect(JSON.stringify(response.body)).not.toMatch(/temporaryPassword|passwordHash/)
    expect(auth.getUserSnapshot('existing@onboarding.test')?.mustChangePassword).toBe(
      false,
    )
    expect(
      auth
        .listMembershipsForSchool(schoolId)
        .some((membership) => membership.user.id === existing.id),
    ).toBe(false)

    // The existing account keeps its original password and is not forced to
    // rotate it, because no administrator-supplied password was applied.
    const login = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'existing@onboarding.test', password: TEST_PASSWORD })
    expect(login.status).toBe(200)
    expect(login.body.data.user.mustChangePassword).toBe(false)
  })

  it('keeps each teacher’s temporary password out of another teacher’s email', async () => {
    await registerClass({
      className: 'Basic 2',
      email: 'first@onboarding.test',
    })
    await registerClass({
      className: 'Basic 4',
      email: 'second@onboarding.test',
    })

    const messages = email.all('teacher-credentials')
    expect(messages).toHaveLength(2)

    const first = messages.find((message) => message.to === 'first@onboarding.test')
    const second = messages.find((message) => message.to === 'second@onboarding.test')
    const firstPassword = String(first?.data.temporaryPassword)
    const secondPassword = String(second?.data.temporaryPassword)

    expect(firstPassword).toHaveLength(20)
    expect(secondPassword).toHaveLength(20)
    // Two registrations never reuse the same generated password.
    expect(firstPassword).not.toBe(secondPassword)
    expect(JSON.stringify(first?.data)).not.toContain(secondPassword)
    expect(JSON.stringify(second?.data)).not.toContain(firstPassword)
  })
})
