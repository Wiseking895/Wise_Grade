import { describe, expect, it } from 'vitest'
import { HttpError } from '../src/errors/http-error.js'
import { ReportService } from '../src/reports/service.js'
import { MemoryStorageAdapter } from '../src/storage/storage.js'
import type { ReportActor } from '../src/reports/repository.js'
import { FakeReportRepository } from './helpers/fake-report-repository.js'
import { makeReportData } from './helpers/report-fixtures.js'

const admin: ReportActor = {
  schoolId: 'school-1',
  userId: 'user-admin',
  membershipId: 'membership-admin',
  role: 'SCHOOL_ADMIN',
}

const classTeacher: ReportActor = {
  schoolId: 'school-1',
  userId: 'user-teacher',
  membershipId: 'membership-teacher',
  role: 'CLASS_TEACHER',
}

const audit = {
  actorUserId: admin.userId,
  actorMembershipId: admin.membershipId,
  ipAddress: '127.0.0.1',
  userAgent: 'vitest',
}

const subjectTeacher: ReportActor = {
  schoolId: 'school-1',
  userId: 'user-subject-teacher',
  membershipId: 'membership-subject-teacher',
  role: 'SUBJECT_TEACHER',
}

const platformReviewer: ReportActor = {
  schoolId: 'school-1',
  userId: 'user-platform',
  membershipId: null,
  role: 'PLATFORM_SUPER_ADMIN',
}

function setup(data = makeReportData()) {
  const repository = new FakeReportRepository([data])
  const storage = new MemoryStorageAdapter()
  const service = new ReportService({ repository, storage })
  return { data, repository, storage, service }
}

describe('report service generation', () => {
  it('generates class-wide reports and stores private PDFs with versions', async () => {
    const { service, repository, storage } = setup()

    const result = await service.generate(
      admin,
      {
        academicYearId: 'year-1',
        academicTermId: 'term-1',
        classId: 'class-1',
        scope: 'CLASS',
      },
      audit,
    )

    expect(result.batch.status).toBe('COMPLETED')
    expect(result.batch.generatedCount).toBe(3)
    expect(result.batch.failedCount).toBe(0)
    expect(result.results.every((item) => item.status === 'GENERATED')).toBe(true)
    expect(repository.cards.size).toBe(3)
    expect(repository.versions.size).toBe(3)

    for (const version of repository.versions.values()) {
      const stored = await storage.getObject(version.storageKey)
      expect(stored).not.toBeNull()
      expect(stored!.subarray(0, 5).toString()).toBe('%PDF-')
      expect(version.snapshot).toMatchObject({
        draftLabel: 'INTERNAL DRAFT — NOT RELEASED',
      })
    }
  })

  it('is idempotent when results and inputs are unchanged', async () => {
    const { service, repository } = setup()
    const request = {
      academicYearId: 'year-1',
      academicTermId: 'term-1',
      classId: 'class-1',
      scope: 'CLASS' as const,
    }

    await service.generate(admin, request, audit)
    const second = await service.generate(admin, request, audit)

    expect(second.batch.status).toBe('COMPLETED')
    expect(second.batch.generatedCount).toBe(0)
    expect(second.batch.skippedCount).toBe(3)
    expect(second.results.every((item) => item.status === 'SKIPPED')).toBe(true)
    expect(repository.versions.size).toBe(3)
  })

  it('creates a new immutable version after authorized input changes', async () => {
    const { service, repository, data } = setup()
    const request = {
      academicYearId: 'year-1',
      academicTermId: 'term-1',
      classId: 'class-1',
      scope: 'CLASS' as const,
    }

    await service.generate(admin, request, audit)
    data.inputs[0]!.teacherRemarks = 'Updated authorized remark.'
    const second = await service.generate(admin, request, audit)

    expect(second.batch.generatedCount).toBe(1)
    expect(second.batch.skippedCount).toBe(2)
    expect(repository.versions.size).toBe(4)
    expect(
      [...repository.versions.values()].some(
        (version) =>
          (version.snapshot as { remarks: { teacher: string } }).remarks
            .teacher === 'Updated authorized remark.',
      ),
    ).toBe(true)
  })

  it('keeps older versions immutable and hides their snapshots from card reads', async () => {
    const { service, repository, data } = setup()
    const request = {
      academicYearId: 'year-1',
      academicTermId: 'term-1',
      classId: 'class-1',
      scope: 'CLASS' as const,
    }

    await service.generate(admin, request, audit)
    data.inputs[0]!.teacherRemarks = 'Second authorized remark.'
    await service.generate(admin, request, audit)

    const cardId = [...repository.cards.values()][0]!.id
    const detail = await service.getCard(admin, cardId)

    expect(detail.versions.map((version) => version.version)).toEqual([2, 1])
    for (const version of detail.versions) {
      expect(version).not.toHaveProperty('snapshot')
      expect(version).not.toHaveProperty('storageKey')
    }

    const stored = [...repository.versions.values()]
      .filter((version) => version.reportCardId === cardId)
      .sort((a, b) => a.version - b.version)
    expect(
      (stored[0]!.snapshot as { remarks: { teacher: string } }).remarks.teacher,
    ).toBe('A focused and consistent learner.')
    expect(
      (stored[1]!.snapshot as { remarks: { teacher: string } }).remarks.teacher,
    ).toBe('Second authorized remark.')
  })

  it('records per-pupil failures instead of producing an incomplete report', async () => {
    const data = makeReportData()
    data.scores = data.scores.filter(
      (score) =>
        !(score.pupilId === 'pupil-esi' && score.subjectId === 'sub-science'),
    )
    const { service, repository } = setup(data)

    const result = await service.generate(
      admin,
      {
        academicYearId: 'year-1',
        academicTermId: 'term-1',
        classId: 'class-1',
        scope: 'CLASS',
      },
      audit,
    )

    expect(result.batch.status).toBe('COMPLETED_WITH_FAILURES')
    expect(result.batch.generatedCount).toBe(2)
    expect(result.batch.failedCount).toBe(1)
    expect(repository.failures).toHaveLength(1)
    expect(repository.failures[0]!.code).toBe('RESULT_MISSING')
    expect(repository.cards.size).toBe(2)
  })

  it('retries only the failed pupils after the data is corrected', async () => {
    const data = makeReportData()
    data.scores = data.scores.filter(
      (score) =>
        !(score.pupilId === 'pupil-esi' && score.subjectId === 'sub-science'),
    )
    const { service, repository } = setup(data)

    const first = await service.generate(
      admin,
      {
        academicYearId: 'year-1',
        academicTermId: 'term-1',
        classId: 'class-1',
        scope: 'CLASS',
      },
      audit,
    )

    data.scores.push({
      pupilId: 'pupil-esi',
      subjectId: 'sub-science',
      sbaContribution: '25.00',
      examContribution: '25.00',
      finalScore: '50.00',
      gradeLabel: 'D',
      gradeRemark: 'Fair',
      policySnapshot: data.submissions[2]!.policySnapshot,
      gradingSnapshot: data.submissions[2]!.gradingSnapshot,
    })

    const retried = await service.retryBatch(admin, first.batch.id, audit)

    expect(retried).toHaveLength(1)
    expect(retried[0]!.batch.generatedCount).toBe(3)
    expect(retried[0]!.batch.failedCount).toBe(0)
    expect(retried[0]!.batch.status).toBe('COMPLETED')
    expect(retried[0]!.results).toHaveLength(1)
    expect(retried[0]!.results[0]!.pupilId).toBe('pupil-esi')
    expect(repository.failures).toHaveLength(0)
    expect(repository.cards.size).toBe(3)
  })

  it('supports individual and term-wide generation scopes', async () => {
    const { service, repository } = setup()

    const individual = await service.generate(
      admin,
      {
        academicYearId: 'year-1',
        academicTermId: 'term-1',
        classId: 'class-1',
        pupilIds: ['pupil-ada'],
        scope: 'INDIVIDUAL',
      },
      audit,
    )

    expect(individual.batch.generatedCount).toBe(1)
    expect(individual.results[0]!.pupilId).toBe('pupil-ada')

    const term = await service.generate(
      admin,
      {
        academicYearId: 'year-1',
        academicTermId: 'term-1',
        scope: 'TERM',
      },
      audit,
    )

    expect(term.batch.scope).toBe('TERM')
    expect(term.batch.classId).toBeNull()
    expect(term.batch.requestedPupilCount).toBe(3)
    expect(term.batch.generatedCount).toBe(2)
    expect(term.batch.skippedCount).toBe(1)
    expect(repository.versions.size).toBe(3)
  })

  it('rejects pupil ids outside the target class', async () => {
    const { service } = setup()

    await expect(
      service.generate(
        admin,
        {
          academicYearId: 'year-1',
          academicTermId: 'term-1',
          classId: 'class-1',
          pupilIds: ['not-enrolled'],
          scope: 'INDIVIDUAL',
        },
        audit,
      ),
    ).rejects.toBeInstanceOf(HttpError)
  })

  it('blocks preview and stored PDF access until a batch is released', async () => {
    const { service, repository } = setup()
    await service.generate(
      admin,
      {
        academicYearId: 'year-1',
        academicTermId: 'term-1',
        classId: 'class-1',
        scope: 'CLASS',
      },
      audit,
    )
    const cardId = [...repository.cards.values()][0]!.id

    await expect(service.preview(admin, cardId)).rejects.toMatchObject({
      statusCode: 403,
      message: 'This report has not been released by the platform administrator.',
    })
    await expect(
      service.getStoredPdf(admin, cardId, 1),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('serves a released preview from the stored snapshot', async () => {
    const { service, repository } = setup()
    const generated = await service.generate(
      admin,
      {
        academicYearId: 'year-1',
        academicTermId: 'term-1',
        classId: 'class-1',
        scope: 'CLASS',
      },
      audit,
    )
    repository.markBatchReleased(generated.batch.id)
    const cardId = [...repository.cards.values()][0]!.id

    const preview = await service.preview(admin, cardId)

    expect(preview.data.subarray(0, 5).toString()).toBe('%PDF-')
    expect(preview.pageCount).toBe(1)
    expect(preview.fileName).toMatch(/^report-.*-v1\.pdf$/)
    expect(generated.batch.status).toBe('COMPLETED')
  })

  it('detects tampering with a released stored PDF checksum', async () => {
    const { service, repository, storage } = setup()
    const generated = await service.generate(
      admin,
      {
        academicYearId: 'year-1',
        academicTermId: 'term-1',
        classId: 'class-1',
        scope: 'CLASS',
      },
      audit,
    )
    repository.markBatchReleased(generated.batch.id)
    const cardId = [...repository.cards.values()][0]!.id
    const version = [...repository.versions.values()][0]!
    await storage.putObject(version.storageKey, Buffer.from('tampered'), 'application/pdf')

    await expect(
      service.getStoredPdf(admin, cardId, 1),
    ).rejects.toMatchObject({ statusCode: 500 })
  })

  it('enforces school and class assignment boundaries for released previews', async () => {
    const { service, repository } = setup()
    const generated = await service.generate(
      admin,
      {
        academicYearId: 'year-1',
        academicTermId: 'term-1',
        classId: 'class-1',
        scope: 'CLASS',
      },
      audit,
    )
    repository.markBatchReleased(generated.batch.id)
    const cardId = [...repository.cards.values()][0]!.id

    await expect(
      service.preview({ ...admin, schoolId: 'school-2' }, cardId),
    ).rejects.toMatchObject({ statusCode: 404 })

    await expect(
      service.preview(classTeacher, cardId),
    ).rejects.toMatchObject({ statusCode: 403 })

    repository.classTeacherAssignments.add(
      'school-1:membership-teacher:class-1',
    )
    const allowed = await service.preview(classTeacher, cardId)
    expect(allowed.data.subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('allows only the assigned class teacher to edit inputs', async () => {
    const { service, repository } = setup()
    const input = {
      academicYearId: 'year-1',
      academicTermId: 'term-1',
      classId: 'class-1',
      pupilId: 'pupil-ada',
      teacherRemarks: 'Authorized remark',
    }

    await expect(
      service.upsertInput(classTeacher, input, audit),
    ).rejects.toMatchObject({ statusCode: 403 })

    repository.classTeacherAssignments.add(
      'school-1:membership-teacher:class-1',
    )
    const saved = await service.upsertInput(classTeacher, input, audit)
    expect(saved.teacherRemarks).toBe('Authorized remark')

    await expect(
      service.upsertInput(admin, input, audit),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('limits term-record reads to administrators and the assigned class teacher', async () => {
    const { service, repository } = setup()
    const filter = { academicTermId: 'term-1', classId: 'class-1' }
    const eligibility = {
      academicYearId: 'year-1',
      academicTermId: 'term-1',
      classId: 'class-1',
    }

    await expect(
      service.listInputs(subjectTeacher, filter),
    ).rejects.toMatchObject({ statusCode: 403 })
    await expect(
      service.checkEligibility(subjectTeacher, eligibility),
    ).rejects.toMatchObject({ statusCode: 403 })
    await expect(
      service.listInputs(classTeacher, filter),
    ).rejects.toMatchObject({ statusCode: 403 })

    repository.classTeacherAssignments.add(
      'school-1:membership-teacher:class-1',
    )
    await expect(
      service.listInputs(classTeacher, filter),
    ).resolves.toEqual([])
    await expect(
      service.checkEligibility(classTeacher, eligibility),
    ).resolves.toMatchObject({ className: 'Basic 6' })

    await expect(service.listInputs(admin, filter)).resolves.toEqual([])

    // The platform reviewer re-runs the live eligibility preflight when it
    // approves a term request, so it must be able to read the same records.
    await expect(
      service.checkEligibility(platformReviewer, eligibility),
    ).resolves.toMatchObject({ className: 'Basic 6' })
    await expect(service.listInputs(platformReviewer, filter)).resolves.toEqual(
      [],
    )

    // An unassigned class in the same school is still out of bounds, even when
    // the same class teacher also has a subject-teacher assignment there.
    repository.subjectTeacherAssignments.add(
      'school-1:membership-teacher:class-2',
    )
    await expect(
      service.listInputs(classTeacher, {
        academicTermId: 'term-1',
        classId: 'class-2',
      }),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('keeps missing attendance null when only a remark or attitude is saved', async () => {
    const { service, repository } = setup()
    repository.classTeacherAssignments.add(
      'school-1:membership-teacher:class-1',
    )
    const base = {
      academicYearId: 'year-1',
      academicTermId: 'term-1',
      classId: 'class-1',
      pupilId: 'pupil-ada',
    }

    await service.upsertInput(
      classTeacher,
      { ...base, teacherRemarks: 'A thoughtful term.' },
      audit,
    )
    const withAttitude = await service.upsertInput(
      classTeacher,
      { ...base, attitude: 'Kind and cooperative.' },
      audit,
    )

    expect(withAttitude.teacherRemarks).toBe('A thoughtful term.')
    expect(withAttitude.attitude).toBe('Kind and cooperative.')
    // An omitted attendance field is not silently converted to zero.
    expect(withAttitude.daysOpened).toBeNull()
    expect(withAttitude.daysAttended).toBeNull()
  })
})
