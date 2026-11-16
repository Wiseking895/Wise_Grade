/**
 * Phase 6C report-card visual fixtures.
 *
 * Renders the real production PDF renderer against fully synthetic snapshots
 * and writes A4 PDFs plus PNG page images to backend/.artifacts/phase6c/.
 * No database, real pupil, or school data is used, and nothing outside the
 * artifacts directory is written.
 *
 * Two fixtures are produced:
 *   - standard: a typical one-page class report with 9 subjects
 *   - dense:    16 subjects and long labels, exercising pagination
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pdf as renderPng } from 'pdf-to-img'
import { A4_PORTRAIT } from '../src/reports/layout.js'
import { renderReportPdf } from '../src/reports/pdf.js'
import type {
  ReportSnapshot,
  SnapshotSubjectRow,
} from '../src/reports/snapshot.js'

const here = dirname(fileURLToPath(import.meta.url))
const artifactsDir = resolve(here, '../.artifacts/phase6c')
const outputDir = resolve(artifactsDir, 'report-cards')

const STANDARD_SUBJECTS = [
  'Mathematics',
  'English Language',
  'Integrated Science',
  'Social Studies',
  'Religious and Moral Education',
  'Computing',
  'Creative Arts and Design',
  'Ghanaian Language',
  'Physical Education',
]

const DENSE_SUBJECTS = [
  ...STANDARD_SUBJECTS,
  'French',
  'Career Technology',
  'History of Ghana',
  'Music and Dance',
  'Home Economics',
  'Agricultural Science',
  'Information and Communication Technology',
]

const GRADES = [
  { grade: 'A', remark: 'Excellent' },
  { grade: 'B', remark: 'Very good' },
  { grade: 'C', remark: 'Good' },
  { grade: 'D', remark: 'Satisfactory' },
  { grade: 'E', remark: 'Needs improvement' },
]

function subjectRow(
  index: number,
  name: string,
): SnapshotSubjectRow {
  // Class score is the 40% SBA contribution and exam score the 60% exam
  // contribution, so the displayed total is always out of 100.
  const classScore = 28 + (index % 5) * 3
  const examScore = 42 + (index % 4) * 4
  const total = classScore + examScore
  const band = GRADES[index % GRADES.length]

  return {
    subjectId: `fixture-subject-${index + 1}`,
    name,
    code: `SUB${String(index + 1).padStart(2, '0')}`,
    classScore: classScore.toFixed(2),
    examScore: examScore.toFixed(2),
    totalScore: total.toFixed(2),
    subjectPosition: (index % 4) + 1,
    grade: band.grade,
    remark: band.remark,
    weights: { sba: '40.00', exam: '60.00', total: '100.00' },
    policyId: 'fixture-policy',
    policyName: 'Phase 6C Public Policy',
    policyVersion: 1,
    calculationMode: 'COMPONENT_WEIGHTED',
    policyIsDefault: false,
    gradingSchemeId: 'fixture-grading',
    gradingSchemeName: 'Phase 6C Standards',
  }
}

function buildSnapshot(options: {
  variant: 'standard' | 'dense'
  subjects: string[]
  schoolName: string
  pupilName: string
}): ReportSnapshot {
  const subjects = options.subjects.map((name, index) =>
    subjectRow(index, name),
  )
  const totalCenti = subjects.reduce(
    (sum, row) => sum + Math.round(Number(row.totalScore) * 100),
    0,
  )
  const average = totalCenti / 100 / subjects.length
  const reportDate = '2026-11-06'

  return {
    schemaVersion: 1,
    draft: true,
    draftLabel: 'INTERNAL DRAFT — NOT RELEASED',
    fingerprint: `phase6c-${options.variant}-fixture`,
    generatedAt: `${reportDate}T12:00:00.000Z`,
    reportCardId: null,
    version: 1,
    school: {
      id: 'fixture-school',
      name: options.schoolName,
      address: '12 Fixture Road, Accra, Ghana',
      phone: '+233 30 000 0000',
      email: 'office@phase6c.test',
      timezone: 'Africa/Accra',
      emblemObjectKey: null,
      crestObjectKey: null,
    },
    pupil: {
      id: 'fixture-pupil',
      fullName: options.pupilName,
      firstName: 'Ama',
      lastName: 'Mensah',
      otherNames: 'Akua',
      admissionNumber: 'ADM-6C-FIX-001',
      gender: 'FEMALE',
      photoObjectKey: null,
    },
    class: { id: 'fixture-class', name: 'Basic 5A', level: 'PRIMARY' },
    academicYear: { id: 'fixture-year', name: '2026/2027' },
    academicTerm: { id: 'fixture-term', name: 'Term 1', sequence: 1 },
    document: {
      closingDate: '2026-12-18',
      reopeningDate: '2027-01-12',
      headteacherLabel: "HEADTEACHER'S SIGNATURE",
      signatureObjectKey: null,
      numberOnRoll: 42,
      classPosition: 3,
      classPositionDisplay: '3rd of 42',
    },
    attendance: {
      daysOpened: 62,
      daysAttended: 59,
      display: '59 / 62',
      complete: true,
    },
    academic: {
      subjects,
      subjectCount: subjects.length,
      earlyYears: false,
      sbaWeight: '40.00',
      examWeight: '60.00',
      calculationMode: 'COMPONENT_WEIGHTED',
      mixedSubjectWeights: false,
      aggregate: { policy: 'BEST_SIX', value: '18', display: '18' },
      average: average.toFixed(2),
      total: (totalCenti / 100).toFixed(2),
      examTotal: subjects
        .reduce((sum, row) => sum + Number(row.examScore), 0)
        .toFixed(2),
      grading: {
        id: 'fixture-grading',
        name: 'Phase 6C Standards',
        bands: [
          {
            minScore: '80.00',
            maxScore: '100.00',
            gradeLabel: 'A',
            remark: 'Excellent',
            sortOrder: 1,
          },
          {
            minScore: '70.00',
            maxScore: '79.99',
            gradeLabel: 'B',
            remark: 'Very good',
            sortOrder: 2,
          },
          {
            minScore: '60.00',
            maxScore: '69.99',
            gradeLabel: 'C',
            remark: 'Good',
            sortOrder: 3,
          },
          {
            minScore: '50.00',
            maxScore: '59.99',
            gradeLabel: 'D',
            remark: 'Satisfactory',
            sortOrder: 4,
          },
          {
            minScore: '0.00',
            maxScore: '49.99',
            gradeLabel: 'E',
            remark: 'Needs improvement',
            sortOrder: 5,
          },
        ],
      },
    },
    remarks: {
      teacher:
        'Ama has worked diligently this term. Continued practice in Mathematics and regular reading at home will consolidate her strong progress.',
      attitude:
        'Respectful, cooperative and punctual. She participates well in group work and shows care for her classmates.',
    },
    ranking: {
      enabled: true,
      tiePolicy: 'DENSE',
      classPosition: 3,
      numberOnRoll: 42,
      note: null,
    },
    source: {
      acceptedSubmissions: options.subjects.length,
      policyVersions: subjects.map((row) => ({
        subjectId: row.subjectId,
        policyId: row.policyId,
        policyVersion: row.policyVersion,
      })),
      gradingSchemeIds: ['fixture-grading'],
      attendanceInputId: 'fixture-attendance',
    },
  }
}

function pngSize(buffer: Buffer): { width: number; height: number } {
  // PNG IHDR: 8-byte signature, 4-byte length, 4-byte type, then width/height.
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

function mediaBoxes(pdfBuffer: Buffer): Array<[number, number]> {
  const text = pdfBuffer.toString('latin1')
  const boxes: Array<[number, number]> = []
  const pattern = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    boxes.push([Number(match[1]), Number(match[2])])
  }

  return boxes
}

async function generate(
  variant: 'standard' | 'dense',
  snapshot: ReportSnapshot,
): Promise<void> {
  const result = await renderReportPdf(snapshot)
  const pdfPath = resolve(outputDir, `report-card-${variant}.pdf`)
  await writeFile(pdfPath, result.data)

  const boxes = mediaBoxes(result.data)
  const a4Ok =
    boxes.length > 0 &&
    boxes.every(
      ([width, height]) =>
        Math.abs(width - A4_PORTRAIT.width) < 0.5 &&
        Math.abs(height - A4_PORTRAIT.height) < 0.5,
    )

  if (!a4Ok) {
    throw new Error(
      `Fixture "${variant}" is not A4 portrait: ${JSON.stringify(boxes)}`,
    )
  }

  const document = await renderPng(result.data, { scale: 2 })
  try {
    if (document.length !== result.pageCount) {
      throw new Error(
        `Page count mismatch for "${variant}": PDF ${result.pageCount}, PNG ${document.length}`,
      )
    }

    for (let page = 1; page <= document.length; page += 1) {
      const buffer = await document.getPage(page)
      const size = pngSize(buffer)
      const pngPath = resolve(
        outputDir,
        `report-card-${variant}-page-${page}.png`,
      )
      await writeFile(pngPath, buffer)
      console.log(
        `  ${variant} page ${page}: ${size.width}x${size.height}px, ${buffer.length} bytes -> ${pngPath}`,
      )
    }
  } finally {
    await document.destroy()
  }

  console.log(
    `  ${variant}: ${result.pageCount} page(s), ${result.byteSize} bytes, checksum ${result.checksum.slice(0, 16)}…, A4 portrait verified`,
  )
}

async function main(): Promise<void> {
  await mkdir(outputDir, { recursive: true })

  const standard = buildSnapshot({
    variant: 'standard',
    subjects: STANDARD_SUBJECTS,
    schoolName: 'Phase 6C Demo Academy',
    pupilName: 'Ama Mensah Akua',
  })

  const dense = buildSnapshot({
    variant: 'dense',
    subjects: DENSE_SUBJECTS,
    schoolName:
      'Phase 6C Demonstration Academy of Science and Technology (Fixture Campus)',
    pupilName: 'Ama Mensah Akua',
  })

  console.log('Rendering synthetic report-card fixtures…')
  await generate('standard', standard)
  await generate('dense', dense)
  console.log('PHASE6C REPORT FIXTURES OK')
  console.log(`artifacts: ${outputDir}`)
  console.log('all content is synthetic phase6c.test fixture data')
}

main().catch((error) => {
  console.error('PHASE6C REPORT FIXTURES FAILED:', error)
  process.exit(1)
})
