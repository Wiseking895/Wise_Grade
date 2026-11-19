import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { registrationBody, TEST_ORIGIN, TEST_PASSWORD } from './helpers/auth-fixtures.js'
import { CaptureEmailService } from './helpers/capture-email-service.js'
import { FakeAuthRepository } from './helpers/fake-auth-repository.js'
import { FakeSchoolRepository } from './helpers/fake-school-repository.js'

const TEACHER_PASSWORD = 'InitialPass123'
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
    initialPassword?: string
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
          initialPassword: overrides.initialPassword ?? TEACHER_PASSWORD,
        },
      })
  }

  it('emails the class teacher their school, class, login and temporary password', async () => {
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
    expect(credentials?.data.temporaryPassword).toBe(TEACHER_PASSWORD)
    expect(String(credentials?.data.loginUrl)).toContain('/login')

    // The temporary password never appears in the API response or in stored
    // audit metadata.
    expect(JSON.stringify(response.body)).not.toContain(TEACHER_PASSWORD)
    expect(JSON.stringify(auth.audits)).not.toContain(TEACHER_PASSWORD)

    const teachers = await admin.get(`/api/schools/${schoolId}/teachers`)
    expect(teachers.status).toBe(200)
    expect(JSON.stringify(teachers.body)).not.toContain(TEACHER_PASSWORD)
    expect(JSON.stringify(teachers.body)).not.toContain('passwordHash')
  })

  it('forces a temporary password to be replaced before the workspace opens', async () => {
    await registerClass({
      className: 'Basic 2',
      email: 'ama@onboarding.test',
    })

    const teacher = request.agent(app)
    const login = await teacher
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'ama@onboarding.test', password: TEACHER_PASSWORD })

    expect(login.status).toBe(200)
    expect(login.body.data.user.mustChangePassword).toBe(true)

    // A first-login reminder is captured with a link to the rotation page.
    const reminder = email.last('teacher-first-login')
    expect(reminder).toBeDefined()
    expect(String(reminder?.data.changePasswordUrl)).toContain('/change-password')
    expect(JSON.stringify(reminder?.data)).not.toContain(TEACHER_PASSWORD)

    // The session may read its own identity and sign out, but nothing else.
    const me = await teacher.get('/api/auth/me')
    expect(me.status).toBe(200)
    expect(me.body.data.user.mustChangePassword).toBe(true)

    const blocked = await teacher.get(`/api/schools/${schoolId}/classes`)
    expect(blocked.status).toBe(403)
    expect(blocked.body.error.message).toMatch(/set a new password/i)

    const wrongCurrent = await teacher
      .post('/api/auth/change-password')
      .set('Origin', TEST_ORIGIN)
      .send({
        currentPassword: 'not-the-password',
        newPassword: NEW_TEACHER_PASSWORD,
      })
    expect(wrongCurrent.status).toBe(401)

    const changed = await teacher
      .post('/api/auth/change-password')
      .set('Origin', TEST_ORIGIN)
      .send({
        currentPassword: TEACHER_PASSWORD,
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
      .send({ email: 'ama@onboarding.test', password: TEACHER_PASSWORD })
    expect(oldLogin.status).toBe(401)

    const newLogin = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'ama@onboarding.test', password: NEW_TEACHER_PASSWORD })
    expect(newLogin.status).toBe(200)
    expect(newLogin.body.data.user.mustChangePassword).toBe(false)
  })

  it('does not email temporary credentials to an existing account', async () => {
    const existing = await auth.createUser({
      email: 'existing@onboarding.test',
      password: TEST_PASSWORD,
      firstName: 'Existing',
      lastName: 'Teacher',
    })

    const response = await registerClass({
      className: 'Basic 3',
      email: 'existing@onboarding.test',
      initialPassword: 'ShouldNeverBeUsed789',
    })

    expect(response.status).toBe(201)
    expect(response.body.data.teacher.userId).toBe(existing.id)
    expect(email.all('teacher-credentials')).toHaveLength(0)

    // The account kept its real password and is not forced to rotate it,
    // because no administrator-supplied password was applied.
    expect(auth.getUserSnapshot('existing@onboarding.test')?.mustChangePassword).toBe(
      false,
    )

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
      initialPassword: 'FirstTemporary123',
    })
    await registerClass({
      className: 'Basic 4',
      email: 'second@onboarding.test',
      initialPassword: 'SecondTemporary456',
    })

    const messages = email.all('teacher-credentials')
    expect(messages).toHaveLength(2)

    const first = messages.find((message) => message.to === 'first@onboarding.test')
    const second = messages.find((message) => message.to === 'second@onboarding.test')

    expect(first?.data.temporaryPassword).toBe('FirstTemporary123')
    expect(second?.data.temporaryPassword).toBe('SecondTemporary456')
    expect(JSON.stringify(first?.data)).not.toContain('SecondTemporary456')
    expect(JSON.stringify(second?.data)).not.toContain('FirstTemporary123')
  })
})
