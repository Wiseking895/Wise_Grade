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

describe('report release HTTP routes', () => {
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
    seed = await buildReleaseSeed(storage, { schoolId, academicTermId })
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

  it('runs the platform review and release lifecycle', async () => {
    const queue = await platform(
      'get',
      '/api/platform/reports/batches?status=GENERATED',
    )
    expect(queue.status).toBe(200)
    expect(queue.body.data.batches).toHaveLength(1)
    expect(queue.body.data.batches[0]).toMatchObject({
      releaseStatus: 'GENERATED',
      eligibility: { eligible: true },
    })
    expect(queue.body.data.batches[0]).not.toHaveProperty('snapshot')
    expect(queue.body.data.batches[0].reportCount).toBe(1)
    expect(queue.body.data.batches[0]).not.toHaveProperty('versions')

    const queued = await platform(
      'post',
      `/api/platform/reports/batches/${seed.record.batch.id}/queue`,
    )
    expect(queued.status).toBe(200)
    expect(queued.body.data.batch.releaseStatus).toBe(
      'PENDING_PLATFORM_REVIEW',
    )

    const reviewQueue = await platform(
      'get',
      '/api/platform/reports/batches?status=PENDING_PLATFORM_REVIEW',
    )
    expect(reviewQueue.status).toBe(200)
    expect(reviewQueue.body.data.batches).toHaveLength(1)

    const overview = await platform('get', '/api/platform/reports/overview')
    expect(overview.status).toBe(200)
    expect(overview.body.data.overview).toMatchObject({
      pendingReview: 1,
      approvedUnreleased: 0,
      released: 0,
    })

    // A legacy batch that already has reports is released by the same
    // approval action; there is no separate payment or release step.
    const approved = await platform(
      'post',
      `/api/platform/reports/batches/${seed.record.batch.id}/approve`,
    )
    expect(approved.status).toBe(200)
    expect(approved.body.data.batch.releaseStatus).toBe('RELEASED')
    expect(approved.body.data.batch.releasedAt).not.toBeNull()

    expect(releaseRepository.transitions.map((item) => item.action)).toEqual([
      'REPORT_RELEASE_GENERATED_FOR_REVIEW',
      'REPORT_RELEASE_APPROVED',
      'REPORT_RELEASE_RELEASED',
    ])
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

  it('denies platform routes to an ordinary school administrator', async () => {
    const response = await schoolAgent.get('/api/platform/reports/overview')
    expect(response.status).toBe(403)

    const mutation = await schoolAgent
      .post(`/api/platform/reports/batches/${seed.record.batch.id}/approve`)
      .set('Origin', TEST_ORIGIN)
    expect(mutation.status).toBe(403)
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

  it('requires a trusted origin for release mutations', async () => {
    const response = await request(app)
      .post(`/api/platform/reports/batches/${seed.record.batch.id}/approve`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${platformToken}`)
    expect(response.status).toBe(403)
    expect(releaseRepository.transitions).toHaveLength(0)
  })

  it('lists platform schools and streams a secure preview before release', async () => {
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

  it('validates return and hold reasons over HTTP', async () => {
    await platform(
      'post',
      `/api/platform/reports/batches/${seed.record.batch.id}/queue`,
    )

    const emptyReturn = await platform(
      'post',
      `/api/platform/reports/batches/${seed.record.batch.id}/return`,
    ).send({ reason: '' })
    expect(emptyReturn.status).toBe(400)

    const shortReturn = await platform(
      'post',
      `/api/platform/reports/batches/${seed.record.batch.id}/return`,
    ).send({ reason: 'no' })
    expect(shortReturn.status).toBe(400)

    const returned = await platform(
      'post',
      `/api/platform/reports/batches/${seed.record.batch.id}/return`,
    ).send({ reason: 'Correct the term dates before release.' })
    expect(returned.status).toBe(200)
    expect(returned.body.data.batch).toMatchObject({
      releaseStatus: 'RETURNED',
      returnedReason: 'Correct the term dates before release.',
    })

    const held = await platform(
      'post',
      `/api/platform/reports/batches/${seed.record.batch.id}/hold`,
    ).send({ reason: 'Finance is reviewing the payment.' })
    expect(held.status).toBe(200)
    expect(held.body.data.batch).toMatchObject({
      releaseStatus: 'ON_HOLD',
      previousReleaseStatus: 'RETURNED',
      holdReason: 'Finance is reviewing the payment.',
    })

    const unheld = await platform(
      'post',
      `/api/platform/reports/batches/${seed.record.batch.id}/unhold`,
    )
    expect(unheld.status).toBe(200)
    expect(unheld.body.data.batch.releaseStatus).toBe('RETURNED')
  })

  it('blocks release until approval and auto-releases on approval', async () => {
    await platform(
      'post',
      `/api/platform/reports/batches/${seed.record.batch.id}/queue`,
    )

    const premature = await platform(
      'post',
      `/api/platform/reports/batches/${seed.record.batch.id}/release`,
    )
    expect(premature.status).toBe(409)

    const approved = await platform(
      'post',
      `/api/platform/reports/batches/${seed.record.batch.id}/approve`,
    )
    expect(approved.status).toBe(200)
    expect(approved.body.data.batch.releaseStatus).toBe('RELEASED')

    const repeated = await platform(
      'post',
      `/api/platform/reports/batches/${seed.record.batch.id}/release`,
    )
    expect(repeated.status).toBe(409)
  })

  it('approves and releases even when the invoice is unpaid or missing', async () => {
    for (const seedOptions of [
      {
        invoiceStatus: 'ISSUED',
        paidMinor: 0,
        outstandingMinor: 1500,
      },
      { includeInvoice: false },
    ]) {
      const unpaid = await buildReleaseSeed(storage, {
        schoolId,
        academicTermId,
        ...seedOptions,
      })
      releaseRepository.seed(unpaid)

      const queued = await platform(
        'post',
        `/api/platform/reports/batches/${unpaid.record.batch.id}/queue`,
      )
      expect(queued.status).toBe(200)

      const approval = await platform(
        'post',
        `/api/platform/reports/batches/${unpaid.record.batch.id}/approve`,
      )
      expect(approval.status).toBe(200)
      expect(approval.body.data.batch.releaseStatus).toBe('RELEASED')

      const released = releaseRepository.transitions.filter(
        (item) =>
          item.batchId === unpaid.record.batch.id &&
          item.action === 'REPORT_RELEASE_RELEASED',
      )
      expect(released).toHaveLength(1)
    }
  })

  it('requires a reason to reject a request and records the rejection', async () => {
    await platform(
      'post',
      `/api/platform/reports/batches/${seed.record.batch.id}/queue`,
    )

    const missing = await platform(
      'post',
      `/api/platform/reports/batches/${seed.record.batch.id}/reject`,
    ).send({ reason: '' })
    expect(missing.status).toBe(400)

    const rejected = await platform(
      'post',
      `/api/platform/reports/batches/${seed.record.batch.id}/reject`,
    ).send({ reason: 'Attendance figures are inconsistent for Term 1.' })
    expect(rejected.status).toBe(200)
    expect(rejected.body.data.batch).toMatchObject({
      releaseStatus: 'RETURNED',
      returnedReason: 'Attendance figures are inconsistent for Term 1.',
    })
    expect(releaseRepository.transitions.at(-1)).toMatchObject({
      action: 'REPORT_REQUEST_REJECTED',
    })
  })

  it('rejects an unsupported release status filter', async () => {
    const response = await platform(
      'get',
      '/api/platform/reports/batches?status=PAID',
    )
    expect(response.status).toBe(400)
  })
})
