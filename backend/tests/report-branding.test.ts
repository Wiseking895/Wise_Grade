import { describe, expect, it } from 'vitest'
import { renderReportPdf, type ReportPdfAssets } from '../src/reports/pdf.js'
import type {
  ReportActor,
  ReportGenerationData,
} from '../src/reports/repository.js'
import { ReportService } from '../src/reports/service.js'
import { buildReportSet } from '../src/reports/snapshot.js'
import { MemoryStorageAdapter, sha256 } from '../src/storage/storage.js'
import { FakeReportRepository } from './helpers/fake-report-repository.js'
import { extractPdfText } from './helpers/pdf-text.js'
import { tinyPng } from './helpers/png.js'
import { makeReportData } from './helpers/report-fixtures.js'

const admin: ReportActor = {
  schoolId: 'school-1',
  userId: 'user-admin',
  membershipId: 'membership-admin',
  role: 'SCHOOL_ADMIN',
}

const audit = {
  actorUserId: admin.userId,
  actorMembershipId: admin.membershipId,
  ipAddress: '127.0.0.1',
  userAgent: 'vitest',
}

const request = {
  academicYearId: 'year-1',
  academicTermId: 'term-1',
  classId: 'class-1',
  scope: 'CLASS' as const,
}

function setup(data: ReportGenerationData = makeReportData()) {
  const repository = new FakeReportRepository([data])
  const storage = new MemoryStorageAdapter()
  const service = new ReportService({ repository, storage })
  return { data, repository, storage, service }
}

function firstSnapshot(data: ReportGenerationData) {
  const snapshot = buildReportSet(data).builds[0]!.snapshot

  if (!snapshot) {
    throw new Error('Fixture did not produce a report snapshot')
  }

  return snapshot
}

describe('report school identity', () => {
  it('captures the school name, logo, landmark, postal address and phone in the snapshot', () => {
    const snapshot = firstSnapshot(makeReportData())

    expect(snapshot.school).toMatchObject({
      id: 'school-1',
      name: 'Green Valley Academy',
      landmark: 'Opposite the central market',
      address: '12 Independence Avenue, Accra',
      phone: '+233 24 000 0000',
      logoObjectKey: 'schools/school-1/school-logo/logo.png',
    })
  })

  it('changes the report fingerprint when school identity changes', () => {
    const original = firstSnapshot(makeReportData())
    const changedData = makeReportData()
    changedData.school.landmark = 'Beside the new community library'
    const changed = firstSnapshot(changedData)

    expect(changed.fingerprint).not.toBe(original.fingerprint)
  })

  it('prints the saved school identity on the report', async () => {
    const snapshot = firstSnapshot(makeReportData())
    const result = await renderReportPdf(snapshot, {
      schoolLogo: tinyPng(6),
      pupilPhoto: tinyPng(6),
    })
    const text = await extractPdfText(result.data)

    expect(text).toContain('GREEN VALLEY ACADEMY')
    expect(text).toContain('Opposite the central market')
    expect(text).toContain('12 Independence Avenue, Accra')
    expect(text).toContain('+233 24 000 0000')
  })

  it('renders the school logo from the snapshot storage key, not the pupil photo', async () => {
    const data = makeReportData()
    const repository = new FakeReportRepository([data])
    const storage = new MemoryStorageAdapter()
    const schoolLogo = tinyPng(6)
    const pupilPhoto = tinyPng(4)

    data.pupils[0]!.photoReference = 'schools/school-1/pupils/photo.png'
    await storage.putObject(data.school.logoObjectKey!, schoolLogo, 'image/png')
    await storage.putObject(data.pupils[0]!.photoReference, pupilPhoto, 'image/png')

    const captured = new Map<string, ReportPdfAssets>()
    const service = new ReportService({
      repository,
      storage,
      renderPdf: async (snapshot, assets) => {
        captured.set(snapshot.pupil.id, assets ?? {})
        const bytes = Buffer.from('%PDF-1.4 test')
        return {
          data: bytes,
          pageCount: 1,
          byteSize: bytes.length,
          checksum: sha256(bytes),
        }
      },
    })

    const result = await service.generate(admin, request, audit)

    expect(result.batch.generatedCount).toBe(3)
    expect(captured.get('pupil-ada')?.schoolLogo?.equals(schoolLogo)).toBe(true)
    expect(captured.get('pupil-ada')?.pupilPhoto?.equals(pupilPhoto)).toBe(true)
  })
})

describe('report generation school identity guard', () => {
  it.each([
    ['school logo', (data: ReportGenerationData) => {
      data.school.logoObjectKey = null
    }],
    ['landmark', (data: ReportGenerationData) => {
      data.school.landmark = null
    }],
    ['postal address', (data: ReportGenerationData) => {
      data.school.address = null
    }],
    ['mobile number', (data: ReportGenerationData) => {
      data.school.phone = null
    }],
  ])(
    'blocks new report generation when the %s is missing',
    async (_field, mutate) => {
      const { data, repository, service } = setup()
      mutate(data)

      await expect(service.generate(admin, request, audit)).rejects.toMatchObject(
        {
          statusCode: 400,
          message: expect.stringContaining('Complete the school profile'),
        },
      )
      expect(repository.batches.size).toBe(0)
      expect(repository.cards.size).toBe(0)
      expect(repository.versions.size).toBe(0)
    },
  )

  it('blocks generation for every missing field and names them together', async () => {
    const { data, service } = setup()
    data.school.logoObjectKey = null
    data.school.landmark = null
    data.school.address = null
    data.school.phone = null

    await expect(service.generate(admin, request, audit)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining(
        'Missing: school logo, landmark, postal address, mobile number.',
      ),
    })
  })
})

describe('historical report school identity', () => {
  it('keeps the generation-time identity after the school profile changes', async () => {
    const { data, repository, service } = setup()
    const generated = await service.generate(admin, request, audit)
    repository.markBatchReleased(generated.batch.id)
    const cardId = [...repository.cards.values()][0]!.id

    // The school later renames itself, moves and replaces its logo.
    data.school.name = 'Renamed Academy'
    data.school.landmark = 'New landmark'
    data.school.address = 'New postal address'
    data.school.phone = '+233200000000'
    data.school.logoObjectKey = 'schools/school-1/school-logo/new.png'

    const preview = await service.preview(admin, cardId)
    const previewText = await extractPdfText(preview.data)

    expect(previewText).toContain('GREEN VALLEY ACADEMY')
    expect(previewText).toContain('Opposite the central market')
    expect(previewText).toContain('12 Independence Avenue, Accra')
    expect(previewText).toContain('+233 24 000 0000')
    expect(previewText).not.toContain('Renamed Academy')
    expect(previewText).not.toContain('New landmark')

    const download = await service.getStoredPdf(admin, cardId, 1)
    const downloadText = await extractPdfText(download.data)

    expect(download.data.subarray(0, 5).toString()).toBe('%PDF-')
    expect(downloadText).toContain('GREEN VALLEY ACADEMY')
    expect(downloadText).toContain('Opposite the central market')
    expect(downloadText).not.toContain('Renamed Academy')
  })

  it('keeps released preview and download working after a logo replacement', async () => {
    const { data, repository, storage, service } = setup()
    const generated = await service.generate(admin, request, audit)
    repository.markBatchReleased(generated.batch.id)
    const cardId = [...repository.cards.values()][0]!.id

    // Replacing a logo adds a new object; the old snapshot key still renders.
    await storage.putObject(
      'schools/school-1/school-logo/new.png',
      tinyPng(6),
      'image/png',
    )
    data.school.logoObjectKey = 'schools/school-1/school-logo/new.png'

    const preview = await service.preview(admin, cardId)
    const download = await service.getStoredPdf(admin, cardId, 1)

    expect(preview.data.subarray(0, 5).toString()).toBe('%PDF-')
    expect(download.data.subarray(0, 5).toString()).toBe('%PDF-')
    expect(preview.fileName).toMatch(/^report-.*-v1\.pdf$/)
    expect(download.fileName).toMatch(/^report-.*-v1\.pdf$/)
  })
})
