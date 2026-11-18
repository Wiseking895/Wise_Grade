import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { SESSION_COOKIE_NAME } from '../src/lib/cookies.js'
import { ReportService } from '../src/reports/service.js'
import { MemoryStorageAdapter } from '../src/storage/storage.js'
import { registrationBody, TEST_ORIGIN } from './helpers/auth-fixtures.js'
import { FakeAuthRepository } from './helpers/fake-auth-repository.js'
import { FakeReportRepository } from './helpers/fake-report-repository.js'
import {
  buildReleaseSeed,
  FakeReportReleaseRepository,
  type FakeReleaseSeed,
} from './helpers/fake-release-repository.js'

describe('platform report generation HTTP routes', () => {
  let auth: FakeAuthRepository
  let releaseRepository: FakeReportReleaseRepository
  let storage: MemoryStorageAdapter
  let app: ReturnType<typeof createApp>
  let schoolAgent: ReturnType<typeof request.agent>
  let otherSchoolAgent: ReturnType<typeof request.agent>
  let platformToken: string
  let schoolId: string
  let academicTermId: string
  let seed: FakeReleaseSeed

  beforeEach(async () => {
    auth = new FakeAuthRepository()
    releaseRepository = new FakeReportReleaseRepository()
    storage = new MemoryStorageAdapter()
    const reports = new FakeReportRepository()

    app = createApp({
      authRepository: auth,
      reportRepository: reports,
      reportStorage: storage,
      reportReleaseRepository: releaseRepository,
      reportService: new ReportService({ repository: reports, storage }),
    })

    schoolAgent = request.agent(app)
    otherSchoolAgent = request.agent(app)

    const registrationA = await schoolAgent
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(
        registrationBody({
          schoolName: 'Green Valley Academy',
          email: 'release-admin-a@example.com',
        }),
      )
    const registrationB = await otherSchoolAgent
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(
        registrationBody({
          schoolName: 'Blue Ridge College',
          email: 'release-admin-b@example.com',
        }),
      )

    schoolId = registrationA.body.data.school.id
    expect(registrationB.body.data.school.id).not.toBe(schoolId)
    academicTermId = '11111111-1111-4111-8111-111111111111'
    seed = await buildReleaseSeed(storage, {
      schoolId,
      academicTermId,
      releaseStatus: 'APPROVED',
      batchStatus: 'COMPLETED',
      generatedCount: 1,
    })
    releaseRepository.seed(seed)

    const platformUser = await auth.createUser({
      email: `platform-${Date.now()}@example.com`,
      password: 'PlatformPassw0rd!',
      firstName: 'Platform',
      lastName: 'Supervisor',
      isPlatformAdmin: true,
    })
    platformToken = await auth.issueSessionFor(platformUser.id)
  })

  function platform(method: 'get' | 'post', path: string) {
    const agent = request(app)[method](path).set(
      'Cookie',
      `${SESSION_COOKIE_NAME}=${platformToken}`,
    )
    return method === 'post' ? agent.set('Origin', TEST_ORIGIN) : agent
  }

  async function createTeacher(role: 'CLASS_TEACHER' | 'SUBJECT_TEACHER') {
    const user = await auth.createUser({
      email: `${role.toLowerCase()}-${Date.now()}@example.com`,
      password: 'TeacherPassw0rd!',
      firstName: 'Test',
      lastName: 'Teacher',
    })
    await auth.addMembership(user.id, schoolId, role)
    return auth.issueSessionFor(user.id)
  }

  it('generates an accepted request and makes the reports available', async () => {
    const queue = await platform(
      'get',
      '/api/platform/reports/batches?status=APPROVED',
    )
    expect(queue.status).toBe(200)
    expect(queue.body.data.batches).toHaveLength(1)
    expect(queue.body.data.batches[0]).toMatchObject({
      releaseStatus: 'APPROVED',
      eligibility: { eligible: true },
    })
    expect(queue.body.data.batches[0]).not.toHaveProperty('snapshot')
    expect(queue.body.data.batches[0]).not.toHaveProperty('versions')

    const generated = await platform(
      'post',
      `/api/platform/reports/batches/${seed.record.batch.id}/generate`,
    )
    expect(generated.status).toBe(200)
    expect(generated.body.data.batch.releaseStatus).toBe('RELEASED')
    expect(generated.body.data.batch.releasedAt).not.toBeNull()

    // The completed batch is available to the school immediately; there is no
    // manual release endpoint.
    const overview = await platform('get', '/api/platform/reports/overview')
    expect(overview.status).toBe(200)
    expect(overview.body.data.overview).toMatchObject({
      approvedUnreleased: 0,
      released: 1,
    })

    expect(releaseRepository.transitions.map((item) => item.action)).toEqual([
      'REPORT_RELEASE_RELEASED',
    ])
  })

  it('generates a request even when the term invoice is unpaid or missing', async () => {
    for (const seedOptions of [
      {
        invoiceStatus: 'ISSUED',
        paidMinor: 0,
        outstandingMinor: 1500,
      },
      { includeInvoice: false },
    ]) {
      const accepted = await buildReleaseSeed(storage, {
        schoolId,
        academicTermId,
        releaseStatus: 'APPROVED',
        batchStatus: 'COMPLETED',
        generatedCount: 1,
        ...seedOptions,
      })
      releaseRepository.seed(accepted)

      const generated = await platform(
        'post',
        `/api/platform/reports/batches/${accepted.record.batch.id}/generate`,
      )
      expect(generated.status).toBe(200)
      expect(generated.body.data.batch.releaseStatus).toBe('RELEASED')
    }
  })

  it('refuses to generate a request that has not been accepted', async () => {
    const unaccepted = await buildReleaseSeed(storage, {
      schoolId,
      academicTermId,
      releaseStatus: 'RETURNED',
      batchStatus: 'PENDING',
      generatedCount: 0,
    })
    releaseRepository.seed(unaccepted)

    const response = await platform(
      'post',
      `/api/platform/reports/batches/${unaccepted.record.batch.id}/generate`,
    )
    expect(response.status).toBe(409)
    expect(response.body.error.message).toMatch(/accepted/i)
    expect(response.body.error.message).toMatch(/administrator/i)
  })

  it('normalises a legacy review-queue request on generate', async () => {
    const legacy = await buildReleaseSeed(storage, {
      schoolId,
      academicTermId,
      releaseStatus: 'PENDING_PLATFORM_REVIEW',
      batchStatus: 'COMPLETED',
      generatedCount: 1,
    })
    releaseRepository.seed(legacy)

    const generated = await platform(
      'post',
      `/api/platform/reports/batches/${legacy.record.batch.id}/generate`,
    )
    expect(generated.status).toBe(200)
    expect(generated.body.data.batch.releaseStatus).toBe('RELEASED')
    expect(releaseRepository.transitions.map((item) => item.action)).toEqual([
      'REPORT_RELEASE_APPROVED',
      'REPORT_RELEASE_RELEASED',
    ])
  })

  it('refuses duplicate generation once reports are available', async () => {
    const released = await buildReleaseSeed(storage, {
      schoolId,
      academicTermId,
      releaseStatus: 'RELEASED',
      batchStatus: 'COMPLETED',
      generatedCount: 1,
    })
    releaseRepository.seed(released)

    const response = await platform(
      'post',
      `/api/platform/reports/batches/${released.record.batch.id}/generate`,
    )
    expect(response.status).toBe(409)
    expect(response.body.error.message).toMatch(/already/i)
  })

  it('no longer exposes platform academic approval or manual release routes', async () => {
    for (const action of [
      'queue',
      'approve',
      'reject',
      'return',
      'hold',
      'unhold',
      'release',
    ]) {
      const response = await platform(
        'post',
        `/api/platform/reports/batches/${seed.record.batch.id}/${action}`,
      )
      expect(response.status).toBe(404)
    }
  })

  it('denies school workspaces any release listing or submission', async () => {
    const list = await schoolAgent.get(
      `/api/schools/${schoolId}/reports/release/batches?academicTermId=${academicTermId}`,
    )
    expect(list.status).toBe(403)
    expect(list.body.error.message).toMatch(/platform/i)

    const submit = await schoolAgent
      .post(
        `/api/schools/${schoolId}/reports/release/batches/${seed.record.batch.id}/submit`,
      )
      .set('Origin', TEST_ORIGIN)
    expect(submit.status).toBe(403)
    expect(releaseRepository.transitions).toHaveLength(0)
  })

  it('denies generation to an ordinary school administrator', async () => {
    const overview = await schoolAgent.get('/api/platform/reports/overview')
    expect(overview.status).toBe(403)

    const mutation = await schoolAgent
      .post(`/api/platform/reports/batches/${seed.record.batch.id}/generate`)
      .set('Origin', TEST_ORIGIN)
    expect(mutation.status).toBe(403)
    expect(releaseRepository.transitions).toHaveLength(0)
  })

  it('denies generation to a teacher', async () => {
    const token = await createTeacher('CLASS_TEACHER')
    const response = await request(app)
      .post(`/api/platform/reports/batches/${seed.record.batch.id}/generate`)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`)

    expect(response.status).toBe(403)
    expect(releaseRepository.transitions).toHaveLength(0)
  })

  it('requires authentication for platform reports', async () => {
    const response = await request(app).get('/api/platform/reports/overview')
    expect(response.status).toBe(401)
  })

  it('denies cross-school release listing and submission', async () => {
    const list = await otherSchoolAgent.get(
      `/api/schools/${schoolId}/reports/release/batches`,
    )
    expect(list.status).toBe(403)

    const submit = await otherSchoolAgent
      .post(
        `/api/schools/${schoolId}/reports/release/batches/${seed.record.batch.id}/submit`,
      )
      .set('Origin', TEST_ORIGIN)
    expect(submit.status).toBe(403)
    expect(releaseRepository.transitions).toHaveLength(0)
  })

  it('does not let a teacher submit reports for release', async () => {
    const token = await createTeacher('CLASS_TEACHER')
    const response = await request(app)
      .post(
        `/api/schools/${schoolId}/reports/release/batches/${seed.record.batch.id}/submit`,
      )
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`)

    expect(response.status).toBe(403)
    expect(releaseRepository.transitions).toHaveLength(0)
  })

  it('requires a trusted origin for generation', async () => {
    const response = await request(app)
      .post(`/api/platform/reports/batches/${seed.record.batch.id}/generate`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${platformToken}`)
    expect(response.status).toBe(403)
    expect(releaseRepository.transitions).toHaveLength(0)
  })

  it('lists platform schools and streams a secure private preview', async () => {
    const detail = await platform(
      'get',
      `/api/platform/reports/batches/${seed.record.batch.id}`,
    )
    expect(detail.status).toBe(200)
    expect(detail.body.data.batch.schoolId).toBe(schoolId)
    expect(JSON.stringify(detail.body)).not.toContain(seed.storageKey)

    const preview = await platform(
      'get',
      `/api/platform/reports/batches/${seed.record.batch.id}/versions/${seed.versionId}/preview`,
    )
    expect(preview.status).toBe(200)
    expect(preview.headers['content-type']).toContain('application/pdf')
    expect(preview.headers['cache-control']).toBe('private, no-store')
    expect(Buffer.from(preview.body).subarray(0, 5).toString()).toBe('%PDF-')

    const schools = await platform('get', '/api/platform/reports/schools')
    expect(schools.status).toBe(200)
    expect(Array.isArray(schools.body.data.schools)).toBe(true)
  })

  it('rejects an unsupported release status filter', async () => {
    const response = await platform(
      'get',
      '/api/platform/reports/batches?status=PAID',
    )
    expect(response.status).toBe(400)
  })
})
