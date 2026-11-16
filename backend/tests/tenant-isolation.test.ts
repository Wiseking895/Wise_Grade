import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { SESSION_COOKIE_NAME } from '../src/lib/cookies.js'
import {
  registrationBody,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from './helpers/auth-fixtures.js'
import { FakeAuthRepository } from './helpers/fake-auth-repository.js'

describe('tenant isolation', () => {
  let app: ReturnType<typeof createApp>
  let repository: FakeAuthRepository

  let schoolA: string
  let schoolB: string
  let agentA: ReturnType<typeof request.agent>
  let agentB: ReturnType<typeof request.agent>

  beforeEach(async () => {
    repository = new FakeAuthRepository()
    app = createApp({ authRepository: repository })

    agentA = request.agent(app)
    agentB = request.agent(app)

    const registrationA = await agentA
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(
        registrationBody({
          schoolName: 'Green Valley Academy',
          email: 'admin-a@example.com',
        }),
      )

    const registrationB = await agentB
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(
        registrationBody({
          schoolName: 'Blue Ridge College',
          firstName: 'Bola',
          lastName: 'Ade',
          email: 'admin-b@example.com',
        }),
      )

    schoolA = registrationA.body.data.school.id
    schoolB = registrationB.body.data.school.id
  })

  it('allows an administrator to read their own school', async () => {
    const response = await agentA.get(`/api/schools/${schoolA}`)

    expect(response.status).toBe(200)
    expect(response.body.data.school.id).toBe(schoolA)
    expect(response.body.data.school.name).toBe('Green Valley Academy')
    expect(response.body.data.membership.role).toBe('SCHOOL_ADMIN')
  })

  it('blocks an administrator from reading another school', async () => {
    const response = await agentA.get(`/api/schools/${schoolB}`)

    expect(response.status).toBe(403)
    expect(response.body.error.message).toBe(
      'You do not have access to this school',
    )
  })

  it('blocks an administrator from listing another school members', async () => {
    const response = await agentA.get(`/api/schools/${schoolB}/members`)

    expect(response.status).toBe(403)
    expect(response.body.error.message).toBe(
      'You do not have access to this school',
    )
  })

  it('lists only members of the requested school', async () => {
    const response = await agentA.get(`/api/schools/${schoolA}/members`)

    expect(response.status).toBe(200)
    expect(response.body.data.schoolId).toBe(schoolA)
    expect(response.body.data.members).toHaveLength(1)
    expect(response.body.data.members[0].email).toBe('admin-a@example.com')
  })

  it('rejects unauthenticated school requests', async () => {
    const response = await request(app).get(`/api/schools/${schoolA}`)

    expect(response.status).toBe(401)
    expect(response.body.error.message).toBe('Authentication required')
  })

  it('denies an unknown school id to avoid enumeration', async () => {
    const response = await agentA.get(
      '/api/schools/00000000-0000-0000-0000-000000000000',
    )

    expect(response.status).toBe(403)
  })

  it('denies a suspended membership', async () => {
    const user = await repository.createUser({
      email: 'suspended@example.com',
      password: TEST_PASSWORD,
    })
    await repository.addMembership(user.id, schoolA, 'SCHOOL_ADMIN', 'SUSPENDED')
    const token = await repository.issueSessionFor(user.id)

    const response = await request(app)
      .get(`/api/schools/${schoolA}`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`)

    expect(response.status).toBe(403)
  })

  it('allows a teacher to read the school but not the member list', async () => {
    const teacher = await repository.createUser({
      email: 'teacher@example.com',
      password: TEST_PASSWORD,
    })
    await repository.addMembership(teacher.id, schoolA, 'CLASS_TEACHER')
    const token = await repository.issueSessionFor(teacher.id)

    const ownSchool = await request(app)
      .get(`/api/schools/${schoolA}`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`)

    expect(ownSchool.status).toBe(200)
    expect(ownSchool.body.data.membership.role).toBe('CLASS_TEACHER')

    const members = await request(app)
      .get(`/api/schools/${schoolA}/members`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`)

    expect(members.status).toBe(403)
    expect(members.body.error.message).toBe(
      'Your role does not allow this action',
    )
  })

  it('denies a teacher access to a different school', async () => {
    const teacher = await repository.createUser({
      email: 'teacher@example.com',
      password: TEST_PASSWORD,
    })
    await repository.addMembership(teacher.id, schoolA, 'SUBJECT_TEACHER')
    const token = await repository.issueSessionFor(teacher.id)

    const response = await request(app)
      .get(`/api/schools/${schoolB}`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`)

    expect(response.status).toBe(403)
  })

  it('does not grant a platform administrator implicit school access', async () => {
    const platformAdmin = await repository.createUser({
      email: 'platform@example.com',
      password: TEST_PASSWORD,
      isPlatformAdmin: true,
    })
    const token = await repository.issueSessionFor(platformAdmin.id)

    const response = await request(app)
      .get(`/api/schools/${schoolA}`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`)

    expect(response.status).toBe(403)
  })

  it('keeps school A and school B sessions independent', async () => {
    const meA = await agentA.get('/api/auth/me')
    const meB = await agentB.get('/api/auth/me')

    expect(meA.body.data.memberships[0].schoolId).toBe(schoolA)
    expect(meB.body.data.memberships[0].schoolId).toBe(schoolB)
    expect(meA.body.data.user.id).not.toBe(meB.body.data.user.id)
  })
})
