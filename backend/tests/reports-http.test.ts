import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { SESSION_COOKIE_NAME } from '../src/lib/cookies.js'
import { ReportService } from '../src/reports/service.js'
import type { ReportGenerationData } from '../src/reports/repository.js'
import { MemoryStorageAdapter } from '../src/storage/storage.js'
import {
  registrationBody,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from './helpers/auth-fixtures.js'
import { FakeAuthRepository } from './helpers/fake-auth-repository.js'
import { FakeReportRepository } from './helpers/fake-report-repository.js'
import { makeReportData } from './helpers/report-fixtures.js'
import { extractPdfText } from './helpers/pdf-text.js'
import { tinyPng } from './helpers/png.js'

interface HttpIds {
  yearId: string
  termId: string
  classId: string
  pupilIds: Record<string, string>
  subjectIds: Record<string, string>
}

function prepareHttpData(
  data: ReportGenerationData,
  schoolId: string,
): HttpIds {
  const yearId = randomUUID()
  const termId = randomUUID()
  const classId = randomUUID()
  const pupilIds: Record<string, string> = {}
  const subjectIds: Record<string, string> = {}

  data.school.id = schoolId
  data.academicYear.id = yearId
  data.academicTerm.id = termId
  data.academicTerm.academicYearId = yearId
  data.class.id = classId

  for (const subject of data.subjects) {
    const next = randomUUID()
    subjectIds[subject.id] = next
    subject.id = next
  }

  for (const pupil of data.pupils) {
    const next = randomUUID()
    pupilIds[pupil.id] = next
    pupil.id = next
  }

  for (const input of data.inputs) {
    input.schoolId = schoolId
    input.academicYearId = yearId
    input.academicTermId = termId
    input.classId = classId
    input.pupilId = pupilIds[input.pupilId] ?? input.pupilId
  }

  for (const score of data.scores) {
    score.pupilId = pupilIds[score.pupilId] ?? score.pupilId
    score.subjectId = subjectIds[score.subjectId] ?? score.subjectId
  }

  for (const submission of data.submissions) {
    submission.subjectId = subjectIds[submission.subjectId] ?? submission.subjectId
  }

  if (data.settings) {
    data.settings.schoolId = schoolId
    data.settings.academicYearId = yearId
    data.settings.academicTermId = termId
  }

  return { yearId, termId, classId, pupilIds, subjectIds }
}

describe('report HTTP routes', () => {
  let auth: FakeAuthRepository
  let reports: FakeReportRepository
  let storage: MemoryStorageAdapter
  let service: ReportService
  let app: ReturnType<typeof createApp>
  let adminAgent: ReturnType<typeof request.agent>
  let otherAgent: ReturnType<typeof request.agent>
  let schoolA: string
  let schoolB: string
  let ids: HttpIds
  let data: ReportGenerationData

  beforeEach(async () => {
    auth = new FakeAuthRepository()
    reports = new FakeReportRepository()
    storage = new MemoryStorageAdapter()
    service = new ReportService({ repository: reports, storage })
    app = createApp({
      authRepository: auth,
      reportRepository: reports,
      reportStorage: storage,
      reportService: service,
    })

    adminAgent = request.agent(app)
    otherAgent = request.agent(app)

    const registrationA = await adminAgent
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(
        registrationBody({
          schoolName: 'Green Valley Academy',
          email: 'admin-a@example.com',
        }),
      )
    const registrationB = await otherAgent
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(
        registrationBody({
          schoolName: 'Blue Ridge College',
          email: 'admin-b@example.com',
        }),
      )

    schoolA = registrationA.body.data.school.id
    schoolB = registrationB.body.data.school.id
    data = makeReportData()
    ids = prepareHttpData(data, schoolA)
    reports.data.push(data)
  })

  async function issueTeacher(role: 'CLASS_TEACHER' | 'SUBJECT_TEACHER') {
    const user = await auth.createUser({
      email: `${role.toLowerCase()}-${randomUUID()}@example.com`,
      password: TEST_PASSWORD,
      firstName: 'Test',
      lastName: 'Teacher',
    })
    const membershipId = await auth.addMembership(user.id, schoolA, role)
    const token = await auth.issueSessionFor(user.id)
    return { user, membershipId, token }
  }

  /**
   * Report generation is platform-only over HTTP. These tests exercise the
   * school-facing card/preview/PDF routes, so batches are prepared directly
   * through the service rather than through the removed school endpoint.
   */
  function reportActor() {
    return {
      schoolId: schoolA,
      userId: 'admin-a-user',
      membershipId: 'admin-a-membership',
      role: 'SCHOOL_ADMIN' as const,
    }
  }

  async function generateReports() {
    return service.generate(
      reportActor(),
      {
        academicYearId: ids.yearId,
        academicTermId: ids.termId,
        classId: ids.classId,
        scope: 'CLASS',
      },
      { actorUserId: 'admin-a-user', actorMembershipId: 'admin-a-membership' },
    )
  }

  it('generates class reports, lists cards and previews a released PDF', async () => {
    const generated = await generateReports()

    expect(generated.batch.status).toBe('COMPLETED')
    expect(generated.batch.generatedCount).toBe(3)
    reports.markBatchReleased(generated.batch.id)

    const cards = await adminAgent.get(
      `/api/schools/${schoolA}/reports/cards?academicTermId=${ids.termId}`,
    )
    expect(cards.status).toBe(200)
    expect(cards.body.data.cards).toHaveLength(3)

    const cardId = cards.body.data.cards[0].id
    const preview = await adminAgent.get(
      `/api/schools/${schoolA}/reports/cards/${cardId}/preview`,
    )

    expect(preview.status).toBe(200)
    expect(preview.headers['content-type']).toContain('application/pdf')
    expect(preview.headers['cache-control']).toBe('private, no-store')
    expect(Buffer.from(preview.body).subarray(0, 5).toString()).toBe('%PDF-')

    // A released preview must never carry the generation-time draft label or
    // the removed release banner; the header belongs to the school branding.
    const previewText = await extractPdfText(Buffer.from(preview.body))
    expect(previewText).not.toContain('RELEASED — PRIVATE SCHOOL ACCESS')
    expect(previewText).not.toContain('INTERNAL DRAFT')

    const download = await adminAgent.get(
      `/api/schools/${schoolA}/reports/cards/${cardId}/versions/1/pdf`,
    )
    expect(download.status).toBe(200)

    const downloadText = await extractPdfText(Buffer.from(download.body))
    expect(downloadText).not.toContain('RELEASED — PRIVATE SCHOOL ACCESS')
    expect(downloadText).not.toContain('INTERNAL DRAFT')
  }, 20_000)

  it('denies preview and stored PDF access before platform release', async () => {
    await generateReports()

    const cards = await adminAgent.get(
      `/api/schools/${schoolA}/reports/cards?academicTermId=${ids.termId}`,
    )
    const cardId = cards.body.data.cards[0].id

    const preview = await adminAgent.get(
      `/api/schools/${schoolA}/reports/cards/${cardId}/preview`,
    )
    expect(preview.status).toBe(403)
    expect(preview.body.error.message).toContain(
      'has not been released by the platform administrator',
    )

    const pdf = await adminAgent.get(
      `/api/schools/${schoolA}/reports/cards/${cardId}/versions/1/pdf`,
    )
    expect(pdf.status).toBe(403)
    expect(pdf.body.error.message).toContain(
      'has not been released by the platform administrator',
    )
  })

  it('blocks cross-school report access and unauthenticated requests', async () => {
    await generateReports()

    const crossSchool = await otherAgent.get(
      `/api/schools/${schoolA}/reports/cards?academicTermId=${ids.termId}`,
    )
    expect(crossSchool.status).toBe(403)

    const anonymous = await request(app).get(
      `/api/schools/${schoolA}/reports/cards?academicTermId=${ids.termId}`,
    )
    expect(anonymous.status).toBe(401)

    expect(schoolB).not.toBe(schoolA)
  })

  it('never lets a class teacher preview terminal reports', async () => {
    const generated = await generateReports()
    reports.markBatchReleased(generated.batch.id)
    const cards = await adminAgent.get(
      `/api/schools/${schoolA}/reports/cards?academicTermId=${ids.termId}`,
    )
    const cardId = cards.body.data.cards[0].id
    const teacher = await issueTeacher('CLASS_TEACHER')

    const denied = await request(app)
      .get(`/api/schools/${schoolA}/reports/cards/${cardId}/preview`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${teacher.token}`)
    expect(denied.status).toBe(403)

    reports.classTeacherAssignments.add(
      `${schoolA}:${teacher.membershipId}:${ids.classId}`,
    )

    // A direct API/URL reuse must still be denied even when the teacher is
    // assigned to the class.
    const stillDenied = await request(app)
      .get(`/api/schools/${schoolA}/reports/cards/${cardId}/preview`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${teacher.token}`)
    expect(stillDenied.status).toBe(403)
  })

  it('never lets an assigned subject teacher preview terminal reports', async () => {
    const generated = await generateReports()
    reports.markBatchReleased(generated.batch.id)
    const cards = await adminAgent.get(
      `/api/schools/${schoolA}/reports/cards?academicTermId=${ids.termId}`,
    )
    const cardId = cards.body.data.cards[0].id
    const teacher = await issueTeacher('SUBJECT_TEACHER')
    reports.subjectTeacherAssignments.add(
      `${schoolA}:${teacher.membershipId}:${ids.classId}`,
    )

    const preview = await request(app)
      .get(`/api/schools/${schoolA}/reports/cards/${cardId}/preview`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${teacher.token}`)
    expect(preview.status).toBe(403)

    const input = await request(app)
      .put(`/api/schools/${schoolA}/reports/inputs`)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${teacher.token}`)
      .send({
        academicYearId: ids.yearId,
        academicTermId: ids.termId,
        classId: ids.classId,
        pupilId: ids.pupilIds['pupil-ada'],
        teacherRemarks: 'Should be denied',
      })
    expect(input.status).toBe(403)
  })

  it('lets an assigned class teacher edit authorized report inputs', async () => {
    const teacher = await issueTeacher('CLASS_TEACHER')
    reports.classTeacherAssignments.add(
      `${schoolA}:${teacher.membershipId}:${ids.classId}`,
    )

    const response = await request(app)
      .put(`/api/schools/${schoolA}/reports/inputs`)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${teacher.token}`)
      .send({
        academicYearId: ids.yearId,
        academicTermId: ids.termId,
        classId: ids.classId,
        pupilId: ids.pupilIds['pupil-ada'],
        daysOpened: 60,
        daysAttended: 58,
        teacherRemarks: 'Authorized class teacher remark.',
        attitude: 'Cooperative.',
      })

    expect(response.status).toBe(200)
    expect(response.body.data.input.teacherRemarks).toBe(
      'Authorized class teacher remark.',
    )
  })

  it('updates report settings and rejects a foreign branding key', async () => {
    const updated = await adminAgent
      .put(`/api/schools/${schoolA}/reports/settings`)
      .set('Origin', TEST_ORIGIN)
      .send({
        academicYearId: ids.yearId,
        academicTermId: ids.termId,
        headteacherLabel: "HEADMISTRESS'S SIGNATURE",
        rankingEnabled: true,
        tiePolicy: 'DENSE',
        aggregatePolicy: 'BEST_SIX_TOTAL',
        attendanceRequired: true,
        closingDate: '2026-07-31',
        reopeningDate: '2026-09-15',
      })

    expect(updated.status).toBe(200)
    expect(updated.body.data.settings.tiePolicy).toBe('DENSE')

    const foreign = await adminAgent
      .put(`/api/schools/${schoolA}/reports/settings`)
      .set('Origin', TEST_ORIGIN)
      .send({
        academicYearId: ids.yearId,
        academicTermId: ids.termId,
        emblemObjectKey: 'schools/other-school/emblem.png',
      })

    expect(foreign.status).toBe(400)
  })

  it('uploads and streams a private branding asset', async () => {
    const uploaded = await adminAgent
      .post(`/api/schools/${schoolA}/reports/assets`)
      .set('Origin', TEST_ORIGIN)
      .send({
        kind: 'CREST',
        mimeType: 'image/png',
        originalName: 'crest.png',
        base64: tinyPng().toString('base64'),
      })

    expect(uploaded.status).toBe(201)
    const assetId = uploaded.body.data.asset.id

    // Internal object keys must never leave the backend.
    expect(uploaded.body.data.asset).not.toHaveProperty('storageKey')

    const listed = await adminAgent.get(`/api/schools/${schoolA}/reports/assets`)
    expect(listed.status).toBe(200)
    const listedAsset = listed.body.data.assets.find(
      (asset: { id: string }) => asset.id === assetId,
    )
    expect(listedAsset).toBeDefined()
    expect(listedAsset).not.toHaveProperty('storageKey')
    expect(JSON.stringify(listed.body)).not.toContain('schools/')

    const attached = await adminAgent
      .put(`/api/schools/${schoolA}/reports/settings`)
      .set('Origin', TEST_ORIGIN)
      .send({
        academicYearId: ids.yearId,
        academicTermId: ids.termId,
        crestAssetId: assetId,
      })

    expect(attached.status).toBe(200)
    expect(attached.body.data.settings.crestAssetId).toBe(assetId)
    expect(attached.body.data.settings).not.toHaveProperty('crestObjectKey')
    expect(JSON.stringify(attached.body)).not.toContain('schools/')

    const fetched = await adminAgent.get(
      `/api/schools/${schoolA}/reports/settings?academicTermId=${ids.termId}`,
    )
    expect(fetched.status).toBe(200)
    expect(fetched.body.data.settings.crestAssetId).toBe(assetId)
    expect(fetched.body.data.settings).not.toHaveProperty('crestObjectKey')

    const file = await adminAgent.get(
      `/api/schools/${schoolA}/reports/assets/${assetId}/file`,
    )
    expect(file.status).toBe(200)
    expect(file.headers['content-type']).toBe('image/png')
    expect(file.headers['cache-control']).toBe('private, no-store')
  })

  it('lists generation failures and retries them over HTTP', async () => {
    const failingPupilId = ids.pupilIds['pupil-esi']!
    const originalPut = storage.putObject.bind(storage)

    storage.putObject = async (key, payload, contentType) => {
      if (key.includes(failingPupilId)) {
        throw new Error('Simulated storage outage')
      }

      return originalPut(key, payload, contentType)
    }

    const first = await generateReports()

    expect(first.batch.status).toBe('COMPLETED_WITH_FAILURES')

    const batchId = first.batch.id
    const detail = await service.getBatch(reportActor(), batchId)
    expect(detail.failures).toHaveLength(1)
    expect(detail.failures[0]!.code).toBe('GENERATION_FAILED')

    storage.putObject = originalPut

    const retried = await service.retryBatch(reportActor(), batchId, {
      actorUserId: 'admin-a-user',
      actorMembershipId: 'admin-a-membership',
    })

    expect(retried[0]!.batch.generatedCount).toBe(3)
    expect(retried[0]!.batch.failedCount).toBe(0)
  })

  it('denies school administrators report generation, batches and retries over HTTP', async () => {
    const generate = await adminAgent
      .post(`/api/schools/${schoolA}/reports/generate`)
      .set('Origin', TEST_ORIGIN)
      .send({
        academicYearId: ids.yearId,
        academicTermId: ids.termId,
        classId: ids.classId,
        scope: 'CLASS',
      })
    expect(generate.status).toBe(403)
    expect(generate.body.error.message).toMatch(/platform/i)

    const batches = await adminAgent.get(
      `/api/schools/${schoolA}/reports/batches`,
    )
    expect(batches.status).toBe(403)

    const retry = await adminAgent
      .post(`/api/schools/${schoolA}/reports/batches/${randomUUID()}/retry`)
      .set('Origin', TEST_ORIGIN)
    expect(retry.status).toBe(403)
  })

  it('redacts snapshots and private storage keys from card responses', async () => {
    await generateReports()
    const cards = await adminAgent.get(
      `/api/schools/${schoolA}/reports/cards?academicTermId=${ids.termId}`,
    )
    const cardId = cards.body.data.cards[0].id

    const detail = await adminAgent.get(
      `/api/schools/${schoolA}/reports/cards/${cardId}`,
    )

    expect(detail.status).toBe(200)
    expect(detail.body.data.versions).toHaveLength(1)
    const version = detail.body.data.versions[0]
    expect(version).toMatchObject({
      version: 1,
      pageCount: 1,
      generatedByName: 'Test Administrator',
    })
    expect(version).not.toHaveProperty('snapshot')
    expect(version).not.toHaveProperty('storageKey')
    expect(version).not.toHaveProperty('emblemObjectKey')
  })

  it('restricts report settings reads to school administrators', async () => {
    const teacher = await issueTeacher('CLASS_TEACHER')
    const response = await request(app)
      .get(
        `/api/schools/${schoolA}/reports/settings?academicTermId=${ids.termId}`,
      )
      .set('Cookie', `${SESSION_COOKIE_NAME}=${teacher.token}`)

    expect(response.status).toBe(403)
  })

  it('enforces class, school and version boundaries for stored PDF downloads', async () => {
    const generated = await generateReports()
    reports.markBatchReleased(generated.batch.id)
    const cards = await adminAgent.get(
      `/api/schools/${schoolA}/reports/cards?academicTermId=${ids.termId}`,
    )
    const cardId = cards.body.data.cards[0].id
    const teacher = await issueTeacher('CLASS_TEACHER')

    const anonymous = await request(app).get(
      `/api/schools/${schoolA}/reports/cards/${cardId}/versions/1/pdf`,
    )
    expect(anonymous.status).toBe(401)

    const crossSchool = await otherAgent.get(
      `/api/schools/${schoolA}/reports/cards/${cardId}/versions/1/pdf`,
    )
    expect(crossSchool.status).toBe(403)

    const unassigned = await request(app)
      .get(`/api/schools/${schoolA}/reports/cards/${cardId}/versions/1/pdf`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${teacher.token}`)
    expect(unassigned.status).toBe(403)

    reports.classTeacherAssignments.add(
      `${schoolA}:${teacher.membershipId}:${ids.classId}`,
    )
    const deniedForTeacher = await request(app)
      .get(`/api/schools/${schoolA}/reports/cards/${cardId}/versions/1/pdf`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${teacher.token}`)
    expect(deniedForTeacher.status).toBe(403)

    const allowed = await adminAgent.get(
      `/api/schools/${schoolA}/reports/cards/${cardId}/versions/1/pdf`,
    )
    expect(allowed.status).toBe(200)
    expect(allowed.headers['content-type']).toContain('application/pdf')

    const missingVersion = await adminAgent.get(
      `/api/schools/${schoolA}/reports/cards/${cardId}/versions/99/pdf`,
    )
    expect(missingVersion.status).toBe(404)
  })

  it('lets the assigned class teacher read and update attendance, remarks and attitude per pupil', async () => {
    const teacher = await issueTeacher('CLASS_TEACHER')
    reports.classTeacherAssignments.add(
      `${schoolA}:${teacher.membershipId}:${ids.classId}`,
    )
    const pupilId = ids.pupilIds['pupil-ada']!

    const eligibility = await request(app)
      .get(
        `/api/schools/${schoolA}/reports/eligibility?academicYearId=${ids.yearId}&academicTermId=${ids.termId}&classId=${ids.classId}`,
      )
      .set('Cookie', `${SESSION_COOKIE_NAME}=${teacher.token}`)
    expect(eligibility.status).toBe(200)
    expect(eligibility.body.data.eligibility.className).toBe(data.class.name)
    expect(
      eligibility.body.data.eligibility.pupils.some(
        (pupil: { pupilId: string }) => pupil.pupilId === pupilId,
      ),
    ).toBe(true)

    const base = {
      academicYearId: ids.yearId,
      academicTermId: ids.termId,
      classId: ids.classId,
      pupilId,
    }

    const attendance = await request(app)
      .put(`/api/schools/${schoolA}/reports/inputs`)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${teacher.token}`)
      .send({ ...base, daysOpened: 62, daysAttended: 59 })
    expect(attendance.status).toBe(200)
    expect(attendance.body.data.input).toMatchObject({
      daysOpened: 62,
      daysAttended: 59,
      teacherRemarks: null,
      attitude: null,
    })

    // A remarks-only save must not erase the attendance values entered on the
    // separate attendance page.
    const remarks = await request(app)
      .put(`/api/schools/${schoolA}/reports/inputs`)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${teacher.token}`)
      .send({ ...base, teacherRemarks: 'A diligent and kind pupil.' })
    expect(remarks.status).toBe(200)
    expect(remarks.body.data.input).toMatchObject({
      daysOpened: 62,
      daysAttended: 59,
      teacherRemarks: 'A diligent and kind pupil.',
      attitude: null,
    })

    const attitude = await request(app)
      .put(`/api/schools/${schoolA}/reports/inputs`)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${teacher.token}`)
      .send({ ...base, attitude: 'Cooperative and attentive.' })
    expect(attitude.status).toBe(200)
    expect(attitude.body.data.input).toMatchObject({
      daysOpened: 62,
      daysAttended: 59,
      teacherRemarks: 'A diligent and kind pupil.',
      attitude: 'Cooperative and attentive.',
    })

    const listed = await request(app)
      .get(
        `/api/schools/${schoolA}/reports/inputs?academicTermId=${ids.termId}&classId=${ids.classId}`,
      )
      .set('Cookie', `${SESSION_COOKIE_NAME}=${teacher.token}`)
    expect(listed.status).toBe(200)
    expect(listed.body.data.inputs).toHaveLength(1)
    expect(listed.body.data.inputs[0]).toMatchObject({
      pupilId,
      daysOpened: 62,
      daysAttended: 59,
      teacherRemarks: 'A diligent and kind pupil.',
      attitude: 'Cooperative and attentive.',
    })

    // The audit trail records who changed which pupil, class, year and term,
    // and distinguishes the first save from later updates.
    const inputId = listed.body.data.inputs[0].id
    const inputAudits = reports.audits.filter(
      (entry) => entry.entityId === inputId,
    )
    expect(inputAudits.map((entry) => entry.action)).toEqual([
      'REPORT_INPUT_CREATED',
      'REPORT_INPUT_UPDATED',
      'REPORT_INPUT_UPDATED',
    ])
    expect(inputAudits[0]!.metadata).toMatchObject({
      pupilId,
      classId: ids.classId,
      academicYearId: ids.yearId,
      academicTermId: ids.termId,
    })

    // School administrators keep read access for review but cannot write.
    const adminRead = await adminAgent.get(
      `/api/schools/${schoolA}/reports/inputs?academicTermId=${ids.termId}&classId=${ids.classId}`,
    )
    expect(adminRead.status).toBe(200)

    const otherClass = randomUUID()
    const unassignedClass = await request(app)
      .get(
        `/api/schools/${schoolA}/reports/inputs?academicTermId=${ids.termId}&classId=${otherClass}`,
      )
      .set('Cookie', `${SESSION_COOKIE_NAME}=${teacher.token}`)
    expect(unassignedClass.status).toBe(403)

    const foreignSchool = await request(app)
      .get(
        `/api/schools/${schoolB}/reports/inputs?academicTermId=${ids.termId}&classId=${ids.classId}`,
      )
      .set('Cookie', `${SESSION_COOKIE_NAME}=${teacher.token}`)
    expect(foreignSchool.status).toBe(403)
  })

  it('denies subject teachers and administrators write access to term records', async () => {
    const subjectTeacher = await issueTeacher('SUBJECT_TEACHER')
    reports.subjectTeacherAssignments.add(
      `${schoolA}:${subjectTeacher.membershipId}:${ids.classId}`,
    )
    const query = `academicYearId=${ids.yearId}&academicTermId=${ids.termId}&classId=${ids.classId}`

    for (const path of ['eligibility', 'inputs']) {
      const response = await request(app)
        .get(`/api/schools/${schoolA}/reports/${path}?${query}`)
        .set('Cookie', `${SESSION_COOKIE_NAME}=${subjectTeacher.token}`)
      expect(response.status, path).toBe(403)
    }

    const write = await request(app)
      .put(`/api/schools/${schoolA}/reports/inputs`)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${subjectTeacher.token}`)
      .send({
        academicYearId: ids.yearId,
        academicTermId: ids.termId,
        classId: ids.classId,
        pupilId: ids.pupilIds['pupil-ada'],
        teacherRemarks: 'Subject teacher must not write this.',
      })
    expect(write.status).toBe(403)

    const adminWrite = await adminAgent
      .put(`/api/schools/${schoolA}/reports/inputs`)
      .set('Origin', TEST_ORIGIN)
      .send({
        academicYearId: ids.yearId,
        academicTermId: ids.termId,
        classId: ids.classId,
        pupilId: ids.pupilIds['pupil-ada'],
        attitude: 'Administrators remain read-only.',
      })
    expect(adminWrite.status).toBe(403)
  })

  it('denies term records when the school is suspended', async () => {
    const teacher = await issueTeacher('CLASS_TEACHER')
    reports.classTeacherAssignments.add(
      `${schoolA}:${teacher.membershipId}:${ids.classId}`,
    )
    const inputQuery = `academicTermId=${ids.termId}&classId=${ids.classId}`
    const eligibilityQuery = `academicYearId=${ids.yearId}&academicTermId=${ids.termId}&classId=${ids.classId}`

    expect(
      (
        await request(app)
          .get(`/api/schools/${schoolA}/reports/inputs?${inputQuery}`)
          .set('Cookie', `${SESSION_COOKIE_NAME}=${teacher.token}`)
      ).status,
    ).toBe(200)

    auth.setSchoolActive(schoolA, false)

    const endpoints = [
      { path: 'eligibility', query: eligibilityQuery },
      { path: 'inputs', query: inputQuery },
    ]

    for (const endpoint of endpoints) {
      const response = await request(app)
        .get(
          `/api/schools/${schoolA}/reports/${endpoint.path}?${endpoint.query}`,
        )
        .set('Cookie', `${SESSION_COOKIE_NAME}=${teacher.token}`)
      expect(response.status, endpoint.path).toBe(403)
    }

    const write = await request(app)
      .put(`/api/schools/${schoolA}/reports/inputs`)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${teacher.token}`)
      .send({
        academicYearId: ids.yearId,
        academicTermId: ids.termId,
        classId: ids.classId,
        pupilId: ids.pupilIds['pupil-ada'],
        attitude: 'Suspended schools cannot write.',
      })
    expect(write.status).toBe(403)
  })

  it('requires an Origin header for cookie-authenticated mutations', async () => {
    const response = await adminAgent
      .put(`/api/schools/${schoolA}/reports/settings`)
      .send({
        academicYearId: ids.yearId,
        academicTermId: ids.termId,
        headteacherLabel: 'No origin',
      })

    expect(response.status).toBe(403)
  })
})
