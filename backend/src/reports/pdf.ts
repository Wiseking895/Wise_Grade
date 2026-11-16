import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import PDFDocument from 'pdfkit'
import { sha256 } from '../storage/storage.js'
import {
  ACADEMIC_COLUMNS,
  A4_PORTRAIT,
  SUMMARY_CELLS,
  type AcademicColumnKey,
} from './layout.js'
import type { ReportSnapshot, SnapshotSubjectRow } from './snapshot.js'

export interface ReportPdfAssets {
  emblem?: Buffer | null
  crest?: Buffer | null
  pupilPhoto?: Buffer | null
  signature?: Buffer | null
  /** School profile logo. Rendered in the centred header branding slot. */
  schoolLogo?: Buffer | null
}

export interface ReportPdfResult {
  data: Buffer
  pageCount: number
  byteSize: number
  checksum: string
}

const PAGE = A4_PORTRAIT
const OUTER = 18
const LEFT = 32
const RIGHT = PAGE.width - 32
const TOP = 28
const BOTTOM = PAGE.height - 34
const CONTENT_WIDTH = RIGHT - LEFT

/**
 * Height reserved for the signature image, the signing line, the printed name
 * and the designation. The signature is the last narrative block before the
 * grading scale.
 */
const SIGNATURE_BLOCK = 64

/** Header geometry. The logo is centred and noticeably larger than before. */
const HEADER_LOGO_WIDTH = 132
const HEADER_LOGO_HEIGHT = 76

/**
 * The photograph frame was 74.4 × 91.2pt. It is a further 30% larger on both
 * axes (74.4 × 1.3 = 96.72, 91.2 × 1.3 = 118.56) while keeping the same 62:76
 * ratio, so the printed portrait stays proportional.
 */
const PUPIL_PHOTO_WIDTH = 96.72
const PUPIL_PHOTO_HEIGHT = 118.56

/**
 * Typography for the dense reference sections. The pupil information block
 * uses one bold size for labels *and* values. It was 10.9pt; 9pt is a 17.4%
 * reduction, which keeps the section readable without crowding the page.
 * The academic table and grading scale use one bold size throughout; the
 * column headings use a slightly smaller bold size so every heading can stay
 * on one horizontal line.
 */
const PUPIL_INFO_FONT_SIZE = 9
const ACADEMIC_FONT_SIZE = 9.6
const ACADEMIC_HEADER_FONT_SIZE = 7.8
const GRADING_FONT_SIZE = 8.6

/**
 * Target height for a single-line remarks panel. The previous design rendered
 * roughly 281pt; 30% of that is about 84pt. The value is a minimum, so a longer
 * written remark grows the panel rather than being clipped.
 */
const REMARK_PANEL_TARGET_HEIGHT = 84.3

const COLORS = {
  ink: '#111827',
  border: '#1f2937',
  muted: '#374151',
  draftInk: '#9b1c1c',
  draftFill: '#fdecec',
  photoFill: '#f3f4f6',
  photoLine: '#9ca3af',
  white: '#ffffff',
}

let regularFont: Buffer | null | undefined
let boldFont: Buffer | null | undefined

function loadFont(file: string): Buffer | null {
  try {
    return readFileSync(fileURLToPath(new URL(file, import.meta.url)))
  } catch {
    return null
  }
}

function fonts(): { regular: Buffer | null; bold: Buffer | null } {
  if (regularFont === undefined) {
    regularFont = loadFont('./fonts/NotoSans-Regular.ttf')
  }
  if (boldFont === undefined) {
    boldFont = loadFont('./fonts/NotoSans-Bold.ttf')
  }
  return { regular: regularFont, bold: boldFont }
}

function formatDate(value: string | null): string {
  if (!value) {
    return 'N/A'
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)

  if (!match) {
    return value
  }

  return `${match[3]}/${match[2]}/${match[1]}`
}

function display(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return 'N/A'
  }

  return String(value)
}

function safeText(value: string | null): string {
  return value && value.trim() !== '' ? value.trim() : ''
}

/**
 * Formats a saved subject position as an ordinal. The snapshot stores the
 * integer rank so historical reports keep the exact value that was released;
 * only the presentation changes here.
 */
function formatOrdinal(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return 'N/A'
  }

  const rank = Math.trunc(value)
  const mod100 = Math.abs(rank) % 100
  const mod10 = Math.abs(rank) % 10
  const suffix =
    mod100 >= 11 && mod100 <= 13
      ? 'th'
      : mod10 === 1
        ? 'st'
        : mod10 === 2
          ? 'nd'
          : mod10 === 3
            ? 'rd'
            : 'th'

  return `${rank}${suffix}`
}

interface RenderState {
  doc: PDFKit.PDFDocument
  y: number
  page: number
  fontRegular: string
  fontBold: string
  snapshot: ReportSnapshot
  assets: ReportPdfAssets
  label: string
  released: boolean
}

export interface ReportPdfOptions {
  /**
   * Released rendering removes the INTERNAL DRAFT band and watermark. The
   * released state is never printed as a banner: the header carries the
   * school's own logo and branding instead. The release status remains in the
   * database, audit trail and administrative workflow.
   */
  released?: boolean
}

export async function renderReportPdf(
  snapshot: ReportSnapshot,
  assets: ReportPdfAssets = {},
  options: ReportPdfOptions = {},
): Promise<ReportPdfResult> {
  const released = options.released === true
  const loaded = fonts()
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    autoFirstPage: false,
    compress: true,
    info: {
      Title: `Report Card - ${snapshot.pupil.fullName}`,
      Author: snapshot.school.name,
      Subject: `${snapshot.academicTerm.name}, ${snapshot.academicYear.name}`,
      Creator: 'Wise Grade',
      Producer: 'Wise Grade Phase 5',
      Keywords: `${snapshot.pupil.admissionNumber}, ${snapshot.class.name}`,
    },
  })

  const fontRegular = loaded.regular ? 'ReportRegular' : 'Helvetica'
  const fontBold = loaded.bold ? 'ReportBold' : 'Helvetica-Bold'

  if (loaded.regular) {
    doc.registerFont('ReportRegular', loaded.regular)
  }
  if (loaded.bold) {
    doc.registerFont('ReportBold', loaded.bold)
  }

  const state: RenderState = {
    doc,
    y: TOP,
    page: 0,
    fontRegular,
    fontBold,
    snapshot,
    assets,
    label: snapshot.draftLabel,
    released,
  }

  const chunks: Buffer[] = []
  doc.on('data', (chunk: Buffer) => chunks.push(chunk))

  const completed = new Promise<ReportPdfResult>((resolve, reject) => {
    doc.on('error', reject)
    doc.on('end', () => {
      const data = Buffer.concat(chunks)
      resolve({
        data,
        pageCount: state.page,
        byteSize: data.length,
        checksum: sha256(data),
      })
    })
  })

  newPage(state)
  drawSchoolHeader(state)

  state.y = drawPupilInformation(state, state.y)
  state.y = drawAcademicTable(state, state.y)
  state.y = ensureSpace(state, state.y, 48)
  state.y = drawSummary(state, state.y)

  // The grading scale is the document footer. The remark boxes previously
  // expanded into all remaining space. They now occupy about 30% of that
  // height so the page reads as one formal document without oversized empty
  // panels, while still growing when the written remark needs more room.
  const gradingH = gradingHeight(snapshot)
  let remarksHeight = preferredRemarksHeight(state, state.y, gradingH)

  state.y = ensureSpace(
    state,
    state.y,
    remarksHeight + SIGNATURE_BLOCK + 12,
  )
  // A page break gives the remarks more room, so re-measure before drawing.
  remarksHeight = preferredRemarksHeight(state, state.y, gradingH)
  state.y = drawRemarks(state, state.y, remarksHeight)

  // The signature follows the two boxes closely, and the grading scale follows
  // the signature. This keeps the footer compact instead of anchoring the
  // signing block at the bottom of the page and leaving a large empty gap.
  state.y = ensureSpace(state, state.y + 2, SIGNATURE_BLOCK + 4)
  state.y = drawSignature(state, state.y)

  state.y = ensureSpace(state, state.y + 8, gradingH)
  state.y = drawGradingScale(state, state.y)
  drawPageFooter(state)
  doc.end()

  return completed
}

function newPage(state: RenderState): void {
  const { doc } = state
  doc.addPage({ size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } })
  state.page += 1
  state.y = TOP
  doc.save()
  doc.strokeColor(COLORS.border).lineWidth(0.9)
  doc.rect(OUTER, OUTER, PAGE.width - OUTER * 2, PAGE.height - OUTER * 2).stroke()
  doc.restore()

  // Released reports deliberately show no release banner. The top of the page
  // belongs to the school's own logo and name. Draft reports keep the internal
  // review band and watermark so an unreleased copy can never be mistaken for
  // a released report.
  if (!state.released) {
    doc.save()
    doc.fillColor(COLORS.draftFill)
    doc.rect(LEFT, TOP, CONTENT_WIDTH, 13).fill()
    doc.restore()
    doc
      .font(state.fontBold)
      .fontSize(7.6)
      .fillColor(COLORS.draftInk)
      .text(state.label, LEFT, TOP + 3.2, {
        width: CONTENT_WIDTH,
        align: 'center',
        characterSpacing: 0.4,
      })

    doc.save()
    doc.rotate(-34, { origin: [PAGE.width / 2, PAGE.height / 2] })
    doc
      .font(state.fontBold)
      .fontSize(48)
      .fillColor('#b91c1c')
      .opacity(0.06)
      .text(state.label, 40, PAGE.height / 2 - 24, {
        width: PAGE.width - 80,
        align: 'center',
      })
    doc.restore()
  }

  doc.fillColor(COLORS.ink).opacity(1)
  state.y = TOP + (state.released ? 8 : 20)
}

function ensureSpace(
  state: RenderState,
  y: number,
  needed: number,
): number {
  if (y + needed <= BOTTOM) {
    return y
  }

  drawPageFooter(state)
  newPage(state)
  drawContinuationHeading(state)
  return Math.max(state.y, TOP + 16)
}

function drawContinuationHeading(state: RenderState): void {
  const { doc, snapshot } = state
  doc
    .font(state.fontBold)
    .fontSize(10)
    .fillColor(COLORS.ink)
    .text(snapshot.school.name, LEFT, state.y, {
      width: CONTENT_WIDTH,
      align: 'center',
      height: 15,
      ellipsis: true,
    })
  state.y += 18
}

function drawSchoolHeader(state: RenderState): void {
  const { doc, snapshot, assets } = state
  const headerTop = state.y

  // The photograph and the school logo form one top header row. Both start at
  // the same y coordinate so their top edges line up exactly. The photo keeps
  // the top-right corner; the branding column is limited to the space to its
  // left so a long school name, address or contact line can never run under it.
  drawPupilPhoto(
    state,
    assets.pupilPhoto,
    RIGHT - PUPIL_PHOTO_WIDTH,
    headerTop,
    PUPIL_PHOTO_WIDTH,
    PUPIL_PHOTO_HEIGHT,
  )

  const brandingRight = RIGHT - PUPIL_PHOTO_WIDTH - 12
  const brandingWidth = brandingRight - LEFT
  const brandingCenter = LEFT + brandingWidth / 2

  // The school logo is centred in the branding column. Older snapshots may only
  // have an emblem or crest, so those remain fallbacks.
  drawCenteredImage(
    state,
    assets.schoolLogo ?? assets.emblem ?? assets.crest,
    brandingCenter - HEADER_LOGO_WIDTH / 2,
    headerTop,
    HEADER_LOGO_WIDTH,
    HEADER_LOGO_HEIGHT,
  )

  // Keep the school name close beneath the logo. The previous design added 5pt
  // and then pushed the name below the photograph frame, which created a large
  // gap once the photo grew. Two points is enough visual breathing room.
  let y = headerTop + HEADER_LOGO_HEIGHT + 2

  const schoolName = snapshot.school.name.toUpperCase()
  doc.font(state.fontBold).fontSize(17.5)
  const nameHeight = Math.min(
    52,
    Math.max(
      21,
      doc.heightOfString(schoolName, {
        width: brandingWidth,
        lineGap: 1.2,
      }),
    ),
  )

  doc
    .fillColor(COLORS.ink)
    .text(schoolName, LEFT, y, {
      width: brandingWidth,
      align: 'center',
      height: nameHeight,
      lineGap: 1.2,
      ellipsis: true,
    })
  y += nameHeight + 1

  const address = [snapshot.school.landmark, snapshot.school.address]
    .map((value) => safeText(value ?? null))
    .filter((value) => value !== '')
    .join('  •  ')

  if (address) {
    doc.font(state.fontRegular).fontSize(8.8)
    const addressHeight = Math.min(
      24,
      Math.max(
        11,
        doc.heightOfString(address, {
          width: brandingWidth,
          lineGap: 0.4,
        }),
      ),
    )

    doc
      .fillColor(COLORS.muted)
      .text(address, LEFT, y, {
        width: brandingWidth,
        align: 'center',
        height: addressHeight,
        lineGap: 0.4,
        ellipsis: true,
      })
    y += addressHeight
  }

  const contact = [snapshot.school.phone, snapshot.school.email]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join('  •  ')

  if (contact) {
    doc
      .font(state.fontRegular)
      .fontSize(8.4)
      .fillColor(COLORS.muted)
      .text(contact, LEFT, y + 1, {
        width: brandingWidth,
        align: 'center',
        height: 11,
        ellipsis: true,
      })
    y += 12
  }

  // Clear separation between the school branding and the pupil details. The
  // pupil block also has to start below the taller top-right photograph.
  state.y = Math.max(y + 18, headerTop + PUPIL_PHOTO_HEIGHT + 10)
}

/**
 * Draws an image centred inside a box while preserving its aspect ratio. The
 * bytes are read from private storage through the service; no public URL is
 * ever embedded in the PDF.
 */
function drawCenteredImage(
  state: RenderState,
  data: Buffer | null | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  if (!data || data.length === 0) {
    return
  }

  try {
    state.doc.image(data, x, y, {
      fit: [width, height],
      align: 'center',
      valign: 'center',
    })
  } catch {
    // A corrupt image must never prevent the rest of the report from printing.
  }
}

/**
 * Neat, subtly rounded photograph frame. The image is clipped to the frame so
 * a wide or tall upload cannot spill into the school name. When no photograph
 * exists the frame is filled neutrally; no other pupil's image is ever used.
 */
function drawPupilPhoto(
  state: RenderState,
  data: Buffer | null | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const { doc } = state

  doc.save()
  doc.roundedRect(x, y, width, height, 3).clip()

  if (data && data.length > 0) {
    try {
      doc.image(data, x, y, {
        cover: [width, height],
        align: 'center',
        valign: 'center',
      })
    } catch {
      doc.rect(x, y, width, height).fill(COLORS.photoFill)
    }
  } else {
    doc.rect(x, y, width, height).fill(COLORS.photoFill)
  }

  doc.restore()

  if (!data || data.length === 0) {
    doc
      .font(state.fontBold)
      .fontSize(7)
      .fillColor(COLORS.photoLine)
      .text('PHOTO', x, y + height / 2 - 4, {
        width,
        align: 'center',
        height: 9,
        ellipsis: true,
      })
  }

  doc.save()
  doc.roundedRect(x, y, width, height, 3).lineWidth(0.8).strokeColor(COLORS.border).stroke()
  doc.restore()
}

function drawPupilInformation(state: RenderState, startY: number): number {
  const { doc, snapshot } = state
  const y = startY
  const blockWidths = [
    CONTENT_WIDTH * 0.37,
    CONTENT_WIDTH * 0.34,
    CONTENT_WIDTH * 0.29,
  ]
  const blocks: Array<{
    rows: Array<[string, string]>
    /** The first row carries the pupil's name and receives extra prominence. */
    nameRow?: boolean
  }> = [
    {
      rows: [
        ['PUPIL NAME', display(snapshot.pupil.fullName)],
        ['INDEX / ADMISSION NUMBER', display(snapshot.pupil.admissionNumber)],
        ['CLASS', display(snapshot.class.name)],
      ],
      nameRow: true,
    },
    {
      rows: [
        ['ACADEMIC YEAR', display(snapshot.academicYear.name)],
        ['TERM', display(snapshot.academicTerm.name)],
        ['CLASS POSITION', display(snapshot.document.classPositionDisplay)],
        ['NUMBER ON ROLL', display(snapshot.document.numberOnRoll)],
      ],
    },
    {
      // EXAMINATION TOTAL used to sit in this block. It was removed from the
      // pupil-information section; the examination score itself remains in the
      // academic performance table and in the underlying assessment data.
      rows: [
        ['CLOSING DATE', formatDate(snapshot.document.closingDate)],
        ['REOPENING DATE', formatDate(snapshot.document.reopeningDate)],
      ],
    },
  ]

  const fontSize = PUPIL_INFO_FONT_SIZE
  const measured = blocks.map((block, blockIndex) => {
    const width = (blockWidths[blockIndex] ?? CONTENT_WIDTH / 3) - 8

    return block.rows.map(([label, value], rowIndex) => {
      const labelHeight = doc
        .font(state.fontBold)
        .fontSize(fontSize)
        .heightOfString(label, { width, lineGap: 0.4 })
      const valueHeight = doc
        .font(state.fontBold)
        .fontSize(fontSize)
        .heightOfString(value, { width, lineGap: 0.4 })
      const prominence = block.nameRow && rowIndex === 0 ? 3 : 0

      return {
        label,
        value,
        labelHeight,
        valueHeight,
        height: labelHeight + valueHeight + 3 + prominence,
        prominence,
      }
    })
  })

  const naturalHeights = measured.map((rows) =>
    rows.reduce((sum, row) => sum + row.height, 0),
  )
  // Grow with wrapped names or admission numbers instead of clipping them, but
  // keep a sensible minimum for a two-pupil Nursery roll.
  const height = Math.max(80, ...naturalHeights)

  doc.save()
  doc.strokeColor(COLORS.border).lineWidth(0.8)
  doc.rect(LEFT, y, CONTENT_WIDTH, height).stroke()
  const firstDivider = LEFT + blockWidths[0]!
  const secondDivider = firstDivider + blockWidths[1]!
  doc
    .moveTo(firstDivider, y)
    .lineTo(firstDivider, y + height)
    .stroke()
  doc
    .moveTo(secondDivider, y)
    .lineTo(secondDivider, y + height)
    .stroke()
  doc.restore()

  let blockX = LEFT

  measured.forEach((rows, blockIndex) => {
    const blockWidth = blockWidths[blockIndex] ?? CONTENT_WIDTH / 3
    const spare = height - (naturalHeights[blockIndex] ?? height)
    const extraPerRow = rows.length > 0 ? spare / rows.length : 0

    // A very light tint lifts the pupil-name row without changing the type
    // size of either the label or the value.
    if (blockIndex === 0 && rows[0]) {
      const nameRowHeight = rows[0].height + extraPerRow
      doc.save()
      doc
        .fillColor('#f8fafc')
        .rect(LEFT + 0.6, y + 0.6, blockWidth - 1.2, nameRowHeight - 0.6)
        .fill()
      doc.restore()
    }

    let rowY = y

    rows.forEach((row) => {
      const rowHeight = row.height + extraPerRow
      const labelY = rowY + 2 + (row.prominence > 0 ? 1 : 0)

      doc
        .font(state.fontBold)
        .fontSize(fontSize)
        .fillColor(COLORS.muted)
        .text(row.label, blockX + 4, labelY, {
          width: blockWidth - 8,
          height: row.labelHeight + 1,
          lineGap: 0.4,
        })
      doc
        .font(state.fontBold)
        .fontSize(fontSize)
        .fillColor(COLORS.ink)
        .text(row.value, blockX + 4, labelY + row.labelHeight + 1, {
          width: blockWidth - 8,
          height: row.valueHeight + 1,
          lineGap: 0.4,
        })

      rowY += rowHeight
    })

    blockX += blockWidth
  })

  return y + height + 8
}

function academicColumnWidth(key: AcademicColumnKey): number {
  const column = ACADEMIC_COLUMNS.find((item) => item.key === key)
  return CONTENT_WIDTH * (column?.widthRatio ?? 0.14)
}

function academicColumnX(key: AcademicColumnKey): number {
  let x = LEFT

  for (const column of ACADEMIC_COLUMNS) {
    if (column.key === key) {
      return x
    }

    x += academicColumnWidth(column.key)
  }

  return x
}

function drawAcademicTable(state: RenderState, startY: number): number {
  const { doc, snapshot } = state
  let y = startY

  doc.save()
  doc.strokeColor(COLORS.border).lineWidth(0.8)
  doc.rect(LEFT, y, CONTENT_WIDTH, 18).stroke()
  doc.restore()
  doc
    .font(state.fontBold)
    .fontSize(10.5)
    .fillColor(COLORS.ink)
    .text('ACADEMIC PERFORMANCE', LEFT, y + 4.2, {
      width: CONTENT_WIDTH,
      align: 'center',
    })
  y += 18

  y = drawAcademicColumnHeader(state, y)

  if (snapshot.academic.mixedSubjectWeights) {
    doc
      .font(state.fontBold)
      .fontSize(8.6)
      .fillColor(COLORS.muted)
      .text(
        'Per-subject weights are shown beside each score as (weight %).',
        LEFT + 3,
        y + 1,
        { width: CONTENT_WIDTH - 6, height: 11 },
      )
    y += 12
  }

  snapshot.academic.subjects.forEach((subject, index) => {
    const rowHeight = academicRowHeight(state, subject)
    if (y + rowHeight > BOTTOM) {
      drawPageFooter(state)
      newPage(state)
      drawContinuationHeading(state)
      doc
        .font(state.fontBold)
        .fontSize(10.5)
        .fillColor(COLORS.ink)
        .text('ACADEMIC PERFORMANCE (CONTINUED)', LEFT, state.y, {
          width: CONTENT_WIDTH,
          align: 'center',
        })
      state.y += 16
      y = drawAcademicColumnHeader(state, state.y)
    }

    y = drawAcademicRow(state, y, subject, index, rowHeight)
  })

  return y + 8
}

function drawAcademicColumnHeader(state: RenderState, startY: number): number {
  const { doc, snapshot } = state
  // Two compact lines: the horizontal heading and, for score columns, the
  // weighting in parentheses. The previous header stacked three lines and
  // forced labels such as CLASS SCORE and the percentage apart.
  const height = 32
  const y = startY

  doc.save()
  doc.strokeColor(COLORS.border).lineWidth(0.8)
  doc.rect(LEFT, y, CONTENT_WIDTH, height).stroke()
  doc.restore()

  const weights = snapshot.academic.mixedSubjectWeights
    ? { sba: 'SBA', exam: 'EXAM' }
    : { sba: snapshot.academic.sbaWeight, exam: snapshot.academic.examWeight }
  const percent = (value: string) => (value.includes('%') ? value : `${value}%`)
  const headings: Record<AcademicColumnKey, string> = {
    subject: 'SUBJECT',
    classScore: 'CLASS SCORE',
    examScore: 'EXAMS SCORE',
    totalScore: 'TOTAL SCORE',
    subjectPosition: 'POSITION',
    grade: 'GRADE',
    remark: 'REMARK',
  }
  const percentages: Partial<Record<AcademicColumnKey, string>> = {
    classScore: `(${percent(weights.sba)})`,
    examScore: `(${percent(weights.exam)})`,
    totalScore: '(100%)',
  }

  for (const column of ACADEMIC_COLUMNS) {
    const x = academicColumnX(column.key)
    const width = academicColumnWidth(column.key)
    const align =
      column.key === 'subject' || column.key === 'remark' ? 'left' : 'center'

    if (column.key !== 'subject') {
      doc.save()
      doc.strokeColor(COLORS.border).lineWidth(0.6)
      doc.moveTo(x, y).lineTo(x, y + height).stroke()
      doc.restore()
    }

    const percentage = percentages[column.key]
    doc
      .font(state.fontBold)
      .fontSize(ACADEMIC_HEADER_FONT_SIZE)
      .fillColor(COLORS.ink)
      .text(headings[column.key], x + 2, y + 3.5, {
        width: width - 4,
        height: 10,
        align,
        lineBreak: false,
        ellipsis: true,
      })

    if (percentage) {
      doc
        .font(state.fontBold)
        .fontSize(ACADEMIC_HEADER_FONT_SIZE)
        .fillColor(COLORS.muted)
        .text(percentage, x + 2, y + 17, {
          width: width - 4,
          height: 10,
          align,
          lineBreak: false,
          ellipsis: true,
        })
    }
  }

  return y + height
}

function academicRowValues(
  snapshot: ReportSnapshot,
  subject: SnapshotSubjectRow,
): Record<AcademicColumnKey, string> {
  const mixed = snapshot.academic.mixedSubjectWeights

  return {
    subject: subject.name,
    classScore: withWeight(subject.classScore, subject.weights.sba, mixed),
    examScore: withWeight(subject.examScore, subject.weights.exam, mixed),
    totalScore: display(subject.totalScore),
    subjectPosition: formatOrdinal(subject.subjectPosition),
    grade: safeText(subject.grade),
    remark: subject.remark ?? '',
  }
}

function academicRowHeight(
  state: RenderState,
  subject: SnapshotSubjectRow,
): number {
  const { doc, snapshot } = state
  const values = academicRowValues(snapshot, subject)
  const textHeights = ACADEMIC_COLUMNS.map((column) =>
    doc
      .font(state.fontBold)
      .fontSize(ACADEMIC_FONT_SIZE)
      .heightOfString(values[column.key], {
        width: academicColumnWidth(column.key) - 5,
        lineGap: 0.4,
      }),
  )

  // Measure every cell, not just the subject and remark, so a long grade or a
  // weighted score that wraps onto a second line cannot be clipped.
  return Math.max(20, Math.min(80, Math.max(...textHeights) + 5))
}

function drawAcademicRow(
  state: RenderState,
  startY: number,
  subject: SnapshotSubjectRow,
  index: number,
  height: number,
): number {
  const { doc, snapshot } = state
  const y = startY

  doc.save()
  doc.strokeColor(COLORS.border).lineWidth(0.6)
  doc.rect(LEFT, y, CONTENT_WIDTH, height).stroke()

  for (const column of ACADEMIC_COLUMNS) {
    if (column.key === 'subject') {
      continue
    }

    const x = academicColumnX(column.key)
    doc.moveTo(x, y).lineTo(x, y + height).stroke()
  }
  doc.restore()

  const values = academicRowValues(snapshot, subject)

  for (const column of ACADEMIC_COLUMNS) {
    const x = academicColumnX(column.key)
    const width = academicColumnWidth(column.key)
    const align =
      column.key === 'subject' || column.key === 'remark' ? 'left' : 'center'

    doc
      .font(state.fontBold)
      .fontSize(ACADEMIC_FONT_SIZE)
      .fillColor(COLORS.ink)
      .text(values[column.key], x + 2.5, y + 3.5, {
        width: width - 5,
        height: height - 4.5,
        align,
        lineGap: 0.4,
      })
  }

  if (index % 2 === 1) {
    // Very light banding keeps dense tables readable in print without looking
    // like a dashboard card.
    doc.save()
    doc.moveTo(LEFT, y + height).lineTo(RIGHT, y + height).lineWidth(0.35).strokeColor('#cbd5e1').stroke()
    doc.restore()
  }

  return y + height
}

function withWeight(
  score: string | null,
  weight: string,
  mixed: boolean,
): string {
  const value = display(score)
  return mixed ? `${value} (${weight}%)` : value
}

function drawSummary(state: RenderState, startY: number): number {
  const { doc, snapshot } = state
  const y = startY
  const height = 38
  const width = CONTENT_WIDTH / 4
  const values = [
    snapshot.academic.aggregate.display,
    display(snapshot.academic.average),
    snapshot.attendance.display,
    display(snapshot.academic.total),
  ]

  doc.save()
  doc.strokeColor(COLORS.border).lineWidth(0.8)
  doc.rect(LEFT, y, CONTENT_WIDTH, height).stroke()

  for (let index = 1; index < 4; index += 1) {
    doc
      .moveTo(LEFT + width * index, y)
      .lineTo(LEFT + width * index, y + height)
      .stroke()
  }
  doc.restore()

  SUMMARY_CELLS.forEach((label, index) => {
    const x = LEFT + width * index
    doc
      .font(state.fontBold)
      .fontSize(6.8)
      .fillColor(COLORS.muted)
      .text(label, x + 3, y + 4, {
        width: width - 6,
        align: 'center',
        height: 9,
        ellipsis: true,
      })
    doc
      .font(state.fontBold)
      .fontSize(11.5)
      .fillColor(COLORS.ink)
      .text(values[index] ?? 'N/A', x + 3, y + 14, {
        width: width - 6,
        align: 'center',
        height: 16,
        ellipsis: true,
      })
  })

  return y + height + 8
}

function preferredRemarksHeight(
  state: RenderState,
  startY: number,
  gradingH: number,
): number {
  const natural = Math.max(100, remarksNaturalHeight(state))
  const available =
    BOTTOM - gradingH - SIGNATURE_BLOCK - 12 - startY

  // The original layout expanded the two remark boxes into all available
  // space, capped at 420pt. A previous revision kept 70% of that height. This
  // revision targets 30% of that previous height (about 84pt, and roughly a 70%
  // reduction from the immediately preceding design). The target is a floor so
  // the boxes stay readable, and the natural content height wins whenever a
  // written remark needs more room: the panels grow instead of clipping.
  const previous = Math.min(Math.max(natural, available), 420)
  const currentDesign = Math.max(58, previous * 0.7)
  const reduced = Math.max(REMARK_PANEL_TARGET_HEIGHT, currentDesign * 0.3)
  return Math.max(reduced, remarksNaturalHeight(state) + 4)
}

function remarksNaturalHeight(state: RenderState): number {
  const { doc, snapshot } = state
  const gap = 8
  const width = (CONTENT_WIDTH - gap) / 2
  const remarks = safeText(snapshot.remarks.teacher)
  const attitude = safeText(snapshot.remarks.attitude)

  return Math.max(
    60,
    Math.max(
      doc.font(state.fontRegular).fontSize(8.4).heightOfString(remarks, {
        width: width - 10,
        lineGap: 1.2,
      }),
      doc.font(state.fontRegular).fontSize(8.4).heightOfString(attitude, {
        width: width - 10,
        lineGap: 1.2,
      }),
    ) + 26,
  )
}

function drawRemarks(
  state: RenderState,
  startY: number,
  height: number,
): number {
  const { doc, snapshot } = state
  const y = startY
  const gap = 8
  const width = (CONTENT_WIDTH - gap) / 2
  const remarks = safeText(snapshot.remarks.teacher)
  const attitude = safeText(snapshot.remarks.attitude)

  const boxes = [
    ["TEACHER'S REMARKS", remarks],
    ['ATTITUDE', attitude],
  ] as const

  boxes.forEach(([label, value], index) => {
    const x = LEFT + index * (width + gap)
    doc.save()
    doc.strokeColor(COLORS.border).lineWidth(0.8)
    doc.rect(x, y, width, height).stroke()
    doc.restore()
    doc
      .font(state.fontBold)
      .fontSize(7.4)
      .fillColor(COLORS.ink)
      .text(label, x + 4, y + 3, {
        width: width - 8,
        height: 9,
        ellipsis: true,
      })
    doc
      .font(state.fontRegular)
      .fontSize(8.4)
      .fillColor(COLORS.ink)
      .text(value, x + 4, y + 14, {
        width: width - 8,
        height: height - 17,
        lineGap: 1.2,
        ellipsis: true,
      })
  })

  return y + height + 8
}

function drawSignature(state: RenderState, startY: number): number {
  const { doc, snapshot, assets } = state
  const y = startY
  const lineWidth = 240
  const lineX = PAGE.width / 2 - lineWidth / 2
  const lineY = y + 34

  if (assets.signature) {
    drawCenteredImage(
      state,
      assets.signature,
      PAGE.width / 2 - 70,
      y,
      140,
      32,
    )
  }

  doc.save()
  doc.strokeColor(COLORS.border).lineWidth(0.9)
  doc.moveTo(lineX, lineY).lineTo(lineX + lineWidth, lineY).stroke()
  doc.restore()

  const printedName = safeText(snapshot.document.signatureName ?? null)
  const designation = safeText(snapshot.document.signatureDesignation ?? null)

  if (printedName || designation) {
    if (printedName) {
      doc
        .font(state.fontBold)
        .fontSize(8.4)
        .fillColor(COLORS.ink)
        .text(printedName, lineX, lineY + 5, {
          width: lineWidth,
          align: 'center',
          height: 11,
          ellipsis: true,
        })
    }

    doc
      .font(state.fontRegular)
      .fontSize(7.4)
      .fillColor(COLORS.muted)
      .text(designation || 'School Administrator', lineX, lineY + (printedName ? 17 : 5), {
        width: lineWidth,
        align: 'center',
        height: 10,
        ellipsis: true,
      })

    return lineY + (printedName ? 30 : 17)
  }

  doc
    .font(state.fontBold)
    .fontSize(7.4)
    .fillColor(COLORS.ink)
    .text(
      snapshot.document.headteacherLabel || "SCHOOL ADMIN SIGNATURE",
      lineX,
      lineY + 5,
      {
        width: lineWidth,
        align: 'center',
        height: 10,
        ellipsis: true,
      },
    )

  return lineY + 18
}

function gradingHeight(snapshot: ReportSnapshot): number {
  const bands = snapshot.academic.grading.bands.length
  const rows = Math.max(1, Math.ceil(bands / 2))
  return 20 + rows * 13 + 6
}

function drawGradingScale(state: RenderState, startY: number): number {
  const { doc, snapshot } = state
  const y = startY
  const bands = snapshot.academic.grading.bands
  const rows = Math.max(1, Math.ceil(bands.length / 2))
  const height = 20 + rows * 13 + 6
  const columnWidth = (CONTENT_WIDTH - 10) / 2

  doc.save()
  doc.strokeColor(COLORS.border).lineWidth(0.8)
  doc.rect(LEFT, y, CONTENT_WIDTH, height).stroke()
  doc.restore()

  doc
    .font(state.fontBold)
    .fontSize(GRADING_FONT_SIZE)
    .fillColor(COLORS.ink)
    .text('GRADING SCALE:', LEFT + 4, y + 4, {
      width: CONTENT_WIDTH - 8,
      height: 11,
    })

  bands.forEach((band, index) => {
    const column = index % 2
    const row = Math.floor(index / 2)
    const x = LEFT + 4 + column * (columnWidth + 2)
    const bandY = y + 19 + row * 13
    const label = `${band.gradeLabel}: ${band.minScore} - ${band.maxScore}`

    doc
      .font(state.fontBold)
      .fontSize(GRADING_FONT_SIZE)
      .fillColor(COLORS.ink)
      .text(label, x, bandY, {
        width: columnWidth * 0.55,
        height: 11,
      })
    doc
      .font(state.fontBold)
      .fontSize(GRADING_FONT_SIZE)
      .fillColor(COLORS.muted)
      .text(band.remark, x + columnWidth * 0.55, bandY, {
        width: columnWidth * 0.45 - 2,
        height: 11,
      })
  })

  return y + height
}

function drawPageFooter(state: RenderState): void {
  const { doc, snapshot } = state
  const parts = [
    `Generated ${new Date(snapshot.generatedAt).toLocaleString('en-GB')}`,
    `Page ${state.page}`,
  ]

  // Draft copies carry the internal review label. Released copies show only
  // the document metadata: the visible release banner has been removed.
  if (!state.released) {
    parts.unshift(state.label)
  }

  doc
    .font(state.fontRegular)
    .fontSize(6.4)
    .fillColor(COLORS.muted)
    .text(parts.join('  •  '), LEFT, PAGE.height - 27, {
      width: CONTENT_WIDTH,
      align: 'center',
      height: 9,
      ellipsis: true,
    })
}
