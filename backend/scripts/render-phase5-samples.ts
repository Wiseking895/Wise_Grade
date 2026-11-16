/**
 * Phase 5 visual verification helper.
 *
 * Renders representative synthetic report cards to PDF and PNG so the layout
 * can be inspected against the reference structure. Output is written under
 * backend/.artifacts (ignored by git) and is never used at runtime.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pdf } from 'pdf-to-img'
import { renderReportPdf, type ReportPdfAssets } from '../src/reports/pdf.js'
import { buildReportSet } from '../src/reports/snapshot.js'
import type { ReportGenerationData } from '../src/reports/repository.js'
import {
  DEFAULT_PUPILS,
  DEFAULT_SUBJECTS,
  makeReportData,
} from '../tests/helpers/report-fixtures.js'

const outputDir = resolve(process.cwd(), '.artifacts', 'phase5')

function pngDataUrl(): Buffer {
  // A 1x1 transparent PNG. Visual verification focuses on placement, not the
  // synthetic image content.
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  )
}

const ALL_ASSETS: ReportPdfAssets = {
  emblem: pngDataUrl(),
  crest: pngDataUrl(),
  pupilPhoto: pngDataUrl(),
  signature: pngDataUrl(),
}

function snapshotFor(data: ReportGenerationData, pupilId?: string) {
  const built = buildReportSet(data)
  const build = pupilId
    ? built.builds.find((item) => item.pupil.id === pupilId)
    : built.builds[0]

  if (!build?.snapshot) {
    throw new Error(`No eligible snapshot for ${pupilId ?? 'first pupil'}`)
  }

  return build.snapshot
}

interface RenderOptions {
  pupilId?: string
  assets?: ReportPdfAssets
}

async function render(
  name: string,
  data: ReportGenerationData,
  options: RenderOptions = {},
) {
  const snapshot = snapshotFor(data, options.pupilId)
  const result = await renderReportPdf(
    snapshot,
    options.assets ?? ALL_ASSETS,
  )
  const pdfPath = resolve(outputDir, `${name}.pdf`)
  await writeFile(pdfPath, result.data)

  const doc = await pdf(result.data, { scale: 2 })
  let pageNumber = 0

  for await (const image of doc) {
    pageNumber += 1
    await writeFile(
      resolve(outputDir, `${name}-page-${pageNumber}.png`),
      image,
    )
  }

  await doc.destroy()
  console.log(`${name}: ${result.pageCount} page(s), ${result.byteSize} bytes`)
}

function withGradingBands(
  data: ReportGenerationData,
  bands: Array<{
    minScore: string
    maxScore: string
    gradeLabel: string
    remark: string
    sortOrder: number
  }>,
): ReportGenerationData {
  const gradingSnapshot = {
    id: 'scheme-wide',
    name: 'Ten band scale',
    bands,
  }

  for (const submission of data.submissions) {
    submission.gradingSnapshot = gradingSnapshot
  }

  for (const score of data.scores) {
    const band = bands.find(
      (item) =>
        Number(score.finalScore) >= Number(item.minScore) &&
        Number(score.finalScore) <= Number(item.maxScore),
    )

    if (band) {
      score.gradeLabel = band.gradeLabel
      score.gradeRemark = band.remark
    }
    score.gradingSnapshot = gradingSnapshot
  }

  return data
}

async function main() {
  await mkdir(outputDir, { recursive: true })

  await render('01-normal-complete', makeReportData())

  await render(
    '02-long-name',
    makeReportData({
      pupils: [
        {
          ...DEFAULT_PUPILS[0]!,
          firstName:
            'Ama Serwaa Nkrumah-Adjei Boateng Mensah Owusu-Ansah',
          lastName: 'Agyeman-Danquah',
        },
      ],
    }),
  )

  const manySubjects = Array.from({ length: 14 }, (_, index) => ({
    id: `sub-many-${index}`,
    name: `Subject ${index + 1} with a descriptive curriculum title`,
    sortOrder: index,
  }))
  await render(
    '03-many-subjects',
    makeReportData({
      subjects: manySubjects,
      pupils: [
        {
          ...DEFAULT_PUPILS[0]!,
          scores: Object.fromEntries(
            manySubjects.map((subject, index) => [
              subject.id,
              `${62 + (index % 30)}.00`,
            ]),
          ),
        },
      ],
    }),
  )

  await render(
    '04-one-crest-only',
    makeReportData({
      settings: {
        emblemObjectKey: null,
        crestObjectKey: 'schools/school-1/report-assets/crest/crest.png',
      },
    }),
    { assets: { crest: pngDataUrl() } },
  )

  const weightedSubjects = DEFAULT_SUBJECTS.map((subject, index) =>
    index === 0
      ? { ...subject, sbaWeight: '40.00', examWeight: '60.00' }
      : subject,
  )
  await render(
    '05-different-weighting',
    makeReportData({ subjects: weightedSubjects }),
  )

  await render(
    '06-optional-fields-absent',
    makeReportData({
      settings: {
        aggregatePolicy: 'NONE',
        closingDate: null,
        reopeningDate: null,
        rankingEnabled: false,
        emblemObjectKey: null,
        crestObjectKey: null,
        signatureObjectKey: null,
      },
      pupils: [
        {
          ...DEFAULT_PUPILS[2]!,
          teacherRemarks: null,
          attitude: null,
        },
      ],
    }),
    { pupilId: 'pupil-esi', assets: {} },
  )

  await render(
    '07-long-school-name',
    makeReportData({
      schoolName:
        'Saint Augustine Roman Catholic Basic School Complex and Community Learning Centre, Ashanti Region',
    }),
  )

  await render(
    '08-long-remarks',
    makeReportData({
      pupils: [
        {
          ...DEFAULT_PUPILS[0]!,
          teacherRemarks:
            'A focused and consistent learner who contributes thoughtfully to group work. '.repeat(
              12,
            ),
          attitude:
            'Respectful, cooperative and punctual throughout the term. '.repeat(
              6,
            ),
        },
      ],
    }),
  )

  const tenBands = [
    { minScore: '80.00', maxScore: '100.00', gradeLabel: 'A', remark: 'Excellent', sortOrder: 0 },
    { minScore: '70.00', maxScore: '79.99', gradeLabel: 'B', remark: 'Very good', sortOrder: 1 },
    { minScore: '60.00', maxScore: '69.99', gradeLabel: 'C', remark: 'Good', sortOrder: 2 },
    { minScore: '50.00', maxScore: '59.99', gradeLabel: 'D', remark: 'Fair', sortOrder: 3 },
    { minScore: '45.00', maxScore: '49.99', gradeLabel: 'E1', remark: 'Pass', sortOrder: 4 },
    { minScore: '40.00', maxScore: '44.99', gradeLabel: 'E2', remark: 'Weak pass', sortOrder: 5 },
    { minScore: '30.00', maxScore: '39.99', gradeLabel: 'F1', remark: 'Needs support', sortOrder: 6 },
    { minScore: '20.00', maxScore: '29.99', gradeLabel: 'F2', remark: 'Needs support', sortOrder: 7 },
    { minScore: '10.00', maxScore: '19.99', gradeLabel: 'F3', remark: 'Needs support', sortOrder: 8 },
    { minScore: '0.00', maxScore: '9.99', gradeLabel: 'F4', remark: 'Needs support', sortOrder: 9 },
  ]
  await render(
    '09-many-grading-bands',
    withGradingBands(makeReportData(), tenBands),
  )

  await render(
    '10-missing-pupil-photo',
    makeReportData(),
    {
      assets: {
        emblem: pngDataUrl(),
        crest: pngDataUrl(),
        signature: pngDataUrl(),
      },
    },
  )

  await render(
    '11-missing-crest',
    makeReportData(),
    {
      assets: {
        emblem: pngDataUrl(),
        pupilPhoto: pngDataUrl(),
        signature: pngDataUrl(),
      },
    },
  )

  const pagedSubjects = Array.from({ length: 24 }, (_, index) => ({
    id: `sub-paged-${index}`,
    name: `Subject ${index + 1} with a deliberately descriptive curriculum title`,
    sortOrder: index,
  }))
  await render(
    '12-two-pages',
    makeReportData({
      subjects: pagedSubjects,
      pupils: [
        {
          ...DEFAULT_PUPILS[0]!,
          scores: Object.fromEntries(
            pagedSubjects.map((subject, index) => [
              subject.id,
              `${60 + (index % 35)}.00`,
            ]),
          ),
        },
      ],
    }),
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
