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
const REMARK_GAP = 8

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

/**
 * Vertical layout profiles, tried from the most comfortable to the most
 * compact. Typography stays inside the required readable range for the first
 * three profiles; the last profile is only used for genuinely extreme subject
 * counts. If even that cannot fit, rendering fails loudly instead of clipping
 * content or spilling onto a second page.
 */
interface ReportStyle {
  id: 'standard' | 'compact' | 'dense' | 'extreme'
  schoolNameSize: number
  reportHeadingSize: number
  pupilNameSize: number
  pupilValueSize: number
  pupilLabelSize: number
  sectionHeadingSize: number
  tableSize: number
  tableHeaderSize: number
  remarkSize: number
  remarkLabelSize: number
  gradingSize: number
  footerSize: number
  metaSize: number
  rowPadding: number
  sectionGap: number
  headerGap: number
  logoWidth: number
  logoHeight: number
  photoWidth: number
  photoHeight: number
  pupilInfoMin: number
  academicTitleHeight: number
  columnHeaderHeight: number
  summaryHeight: number
  remarksMin: number
  signatureHeight: number
  gradingHeader: number
  gradingRow: number
}

const STANDARD_STYLE: ReportStyle = {
  id: 'standard',
  schoolNameSize: 17.5,
  reportHeadingSize: 13.5,
  pupilNameSize: 10.5,
  pupilValueSize: 9,
  pupilLabelSize: 9,
  sectionHeadingSize: 10,
  tableSize: 8.8,
  tableHeaderSize: 8,
  remarkSize: 8.6,
  remarkLabelSize: 7.4,
  gradingSize: 8.6,
  footerSize: 7.2,
  metaSize: 8,
  rowPadding: 3.5,
  sectionGap: 8,
  headerGap: 10,
  logoWidth: 132,
  logoHeight: 76,
  photoWidth: 96.72,
  photoHeight: 118.56,
  pupilInfoMin: 80,
  academicTitleHeight: 18,
  columnHeaderHeight: 30,
  summaryHeight: 38,
  remarksMin: 84.3,
  signatureHeight: 64,
  gradingHeader: 20,
  gradingRow: 13,
}

const COMPACT_STYLE: ReportStyle = {
  ...STANDARD_STYLE,
  id: 'compact',
  reportHeadingSize: 13,
  pupilNameSize: 10,
  pupilValueSize: 8.8,
  pupilLabelSize: 8.6,
  sectionHeadingSize: 9.5,
  tableSize: 8.4,
  tableHeaderSize: 7.8,
  remarkSize: 8.2,
  gradingSize: 8.2,
  footerSize: 7,
  metaSize: 7.8,
  rowPadding: 2.2,
  sectionGap: 5,
  headerGap: 6,
  logoWidth: 108,
  logoHeight: 62,
  photoWidth: 80,
  photoHeight: 98,
  pupilInfoMin: 72,
  academicTitleHeight: 16,
  columnHeaderHeight: 26,
  summaryHeight: 34,
  remarksMin: 66,
  signatureHeight: 52,
  gradingHeader: 17,
  gradingRow: 11.5,
}

const DENSE_STYLE: ReportStyle = {
  ...COMPACT_STYLE,
  id: 'dense',
  schoolNameSize: 17.2,
  reportHeadingSize: 13,
  pupilValueSize: 8.6,
  pupilLabelSize: 8.4,
  sectionHeadingSize: 9,
  tableSize: 8,
  tableHeaderSize: 7.4,
  remarkSize: 8,
  gradingSize: 8,
  metaSize: 7.6,
  rowPadding: 1.4,
  sectionGap: 3,
  headerGap: 4,
  logoWidth: 88,
  logoHeight: 50,
  photoWidth: 68,
  photoHeight: 84,
  pupilInfoMin: 66,
  academicTitleHeight: 14,
  columnHeaderHeight: 23,
  summaryHeight: 30,
  remarksMin: 56,
  signatureHeight: 48,
  gradingHeader: 15,
  gradingRow: 10.5,
}

const EXTREME_STYLE: ReportStyle = {
  ...DENSE_STYLE,
  id: 'extreme',
  schoolNameSize: 17,
  pupilValueSize: 8.4,
  pupilLabelSize: 8.2,
  // The extreme profile never drops table or remark text below the 8pt
  // readability floor. If this still cannot fit, rendering reports an overflow
  // instead of shrinking below the agreed typography targets.
  tableSize: 8,
  tableHeaderSize: 7.2,
  remarkSize: 8,
  gradingSize: 8,
  metaSize: 7.4,
  rowPadding: 0.8,
  sectionGap: 2,
  headerGap: 3,
  logoWidth: 72,
  logoHeight: 40,
  photoWidth: 56,
  photoHeight: 70,
  pupilInfoMin: 60,
  academicTitleHeight: 12,
  columnHeaderHeight: 20,
  summaryHeight: 27,
  remarksMin: 48,
  signatureHeight: 42,
  gradingHeader: 13,
  gradingRow: 9.5,
}

const STYLES: ReportStyle[] = [
  STANDARD_STYLE,
  COMPACT_STYLE,
  DENSE_STYLE,
  EXTREME_STYLE,
]

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

/**
 * Raised when even the most compact readable layout cannot fit the report on a
 * single A4 page. The error carries the exact dataset figures so the platform
 * can report the case instead of silently hiding content.
 */
export class ReportLayoutOverflowError extends Error {
  readonly subjectCount: number
  readonly requiredHeight: number
  readonly availableHeight: number

  constructor(input: {
    subjectCount: number
    requiredHeight: number
    availableHeight: number
  }) {
    super(
      `The report cannot fit on one A4 page: ${input.subjectCount} subjects require ${input.requiredHeight.toFixed(1)}pt but only ${input.availableHeight.toFixed(1)}pt are available. Reduce the subject count or shorten the remarks.`,
    )
    this.name = 'ReportLayoutOverflowError'
    this.subjectCount = input.subjectCount
    this.requiredHeight = input.requiredHeight
    this.availableHeight = input.availableHeight
  }
}

interface LayoutPlan {
  style: ReportStyle
  headerHeight: number
  pupilHeight: number
  academicHeight: number
  summaryHeight: number
  remarksHeight: number
  signatureHeight: number
  gradingHeight: number
  totalHeight: number
  availableHeight: number
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

  startPage(state)

  let plan: LayoutPlan

  try {
    plan = planLayout(state)
  } catch (error) {
    // Close the in-memory document before surfacing the overflow so the
    // renderer never leaves a half-open stream behind.
    doc.end()
    throw error
  }

  const style = plan.style

  state.y = drawSchoolHeader(state, style)
  state.y = drawPupilInformation(state, state.y, style)
  state.y = drawAcademicTable(state, state.y, style)
  state.y = drawSummary(state, state.y, style)
  state.y = drawRemarks(state, state.y, style)
  state.y = drawSignature(state, state.y, style)
  state.y = drawGradingScale(state, state.y, style)
  drawPageFooter(state, style)
  doc.end()

  return completed
}

function startPage(state: RenderState): void {
  const { doc } = state
  doc.addPage({ size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } })
  state.page = 1
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
        lineBreak: false,
        ellipsis: true,
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
        lineBreak: false,
        ellipsis: true,
      })
    doc.restore()
  }

  doc.fillColor(COLORS.ink).opacity(1)
  state.y = TOP + (state.released ? 8 : 20)
}

function textHeight(
  state: RenderState,
  value: string,
  weight: 'regular' | 'bold',
  size: number,
  width: number,
  lineGap: number,
): number {
  const font = weight === 'bold' ? state.fontBold : state.fontRegular

  return state.doc
    .font(font)
    .fontSize(size)
    .heightOfString(value.trim() || ' ', { width, lineGap })
}

function reportHeading(snapshot: ReportSnapshot): string {
  return `${snapshot.academicTerm.name.toUpperCase()} REPORT CARD`
}

function schoolAddress(snapshot: ReportSnapshot): string {
  return [snapshot.school.landmark, snapshot.school.address]
    .map((value) => safeText(value ?? null))
    .filter((value) => value !== '')
    .join('  •  ')
}

function schoolContact(snapshot: ReportSnapshot): string {
  return [snapshot.school.phone, snapshot.school.email]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join('  •  ')
}

function brandingWidth(style: ReportStyle): number {
  return RIGHT - style.photoWidth - 12 - LEFT
}

function measureHeaderHeight(state: RenderState, style: ReportStyle): number {
  const { snapshot } = state
  const width = brandingWidth(style)
  let height = style.logoHeight + 2

  height += textHeight(
    state,
    snapshot.school.name.toUpperCase(),
    'bold',
    style.schoolNameSize,
    width,
    1.2,
  )
  height += 1
  height += textHeight(
    state,
    reportHeading(snapshot),
    'bold',
    style.reportHeadingSize,
    width,
    0.8,
  )
  height += 1

  const address = schoolAddress(snapshot)

  if (address) {
    height += textHeight(state, address, 'regular', style.metaSize, width, 0.4)
  }

  const contact = schoolContact(snapshot)

  if (contact) {
    height +=
      1 +
      textHeight(
        state,
        contact,
        'regular',
        Math.max(7, style.metaSize - 0.4),
        width,
        0.4,
      )
  }

  return Math.max(style.photoHeight, height) + style.headerGap
}

function measurePupilInformation(
  state: RenderState,
  style: ReportStyle,
): {
  blocks: Array<
    Array<{
      label: string
      value: string
      labelHeight: number
      valueHeight: number
      height: number
      prominence: number
      valueSize: number
    }>
  >
  widths: number[]
  naturalHeights: number[]
  height: number
} {
  const { snapshot } = state
  const blockWidths = [
    CONTENT_WIDTH * 0.37,
    CONTENT_WIDTH * 0.34,
    CONTENT_WIDTH * 0.29,
  ]
  const blocks: Array<{
    rows: Array<[string, string]>
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
      rows: [
        ['CLOSING DATE', formatDate(snapshot.document.closingDate)],
        ['REOPENING DATE', formatDate(snapshot.document.reopeningDate)],
      ],
    },
  ]

  const measured = blocks.map((block, blockIndex) => {
    const width = (blockWidths[blockIndex] ?? CONTENT_WIDTH / 3) - 8

    return block.rows.map(([label, value], rowIndex) => {
      const isName = block.nameRow === true && rowIndex === 0
      const valueSize = isName ? style.pupilNameSize : style.pupilValueSize
      const labelHeight = textHeight(
        state,
        label,
        'bold',
        style.pupilLabelSize,
        width,
        0.4,
      )
      const valueHeight = textHeight(
        state,
        value,
        'bold',
        valueSize,
        width,
        0.4,
      )
      const prominence = isName ? 3 : 0

      return {
        label,
        value,
        labelHeight,
        valueHeight,
        height: labelHeight + valueHeight + 3 + prominence,
        prominence,
        valueSize,
      }
    })
  })

  const naturalHeights = measured.map((rows) =>
    rows.reduce((sum, row) => sum + row.height, 0),
  )
  const height = Math.max(style.pupilInfoMin, ...naturalHeights)

  return { blocks: measured, widths: blockWidths, naturalHeights, height }
}

function measureAcademicRowHeight(
  state: RenderState,
  style: ReportStyle,
  subject: SnapshotSubjectRow,
): number {
  const values = academicRowValues(state.snapshot, subject)
  const textHeights = ACADEMIC_COLUMNS.map((column) =>
    textHeight(
      state,
      values[column.key],
      'bold',
      style.tableSize,
      academicColumnWidth(column.key) - 5,
      0.3,
    ),
  )

  return Math.max(
    style.tableSize + style.rowPadding * 2 + 2,
    Math.max(...textHeights) + style.rowPadding * 2,
  )
}

function measureAcademicHeight(
  state: RenderState,
  style: ReportStyle,
): number {
  let height = style.academicTitleHeight + style.columnHeaderHeight

  if (state.snapshot.academic.mixedSubjectWeights) {
    height +=
      textHeight(
        state,
        'Per-subject weights are shown beside each score as (weight %).',
        'bold',
        style.metaSize,
        CONTENT_WIDTH - 6,
        0.3,
      ) + 2
  }

  for (const subject of state.snapshot.academic.subjects) {
    height += measureAcademicRowHeight(state, style, subject)
  }

  return height
}

function measureRemarksHeight(
  state: RenderState,
  style: ReportStyle,
): number {
  const width = (CONTENT_WIDTH - REMARK_GAP) / 2 - 8
  const teacher = safeText(state.snapshot.remarks.teacher)
  const attitude = safeText(state.snapshot.remarks.attitude)
  const textHeightValue = Math.max(
    textHeight(state, teacher, 'regular', style.remarkSize, width, 1),
    textHeight(state, attitude, 'regular', style.remarkSize, width, 1),
  )

  return Math.max(style.remarksMin, textHeightValue + 17)
}

function gradingRows(
  state: RenderState,
  style: ReportStyle,
): Array<{
  bands: Array<{ gradeLabel: string; minScore: string; maxScore: string; remark: string }>
  height: number
}> {
  const bands = state.snapshot.academic.grading.bands
  const columnWidth = (CONTENT_WIDTH - 10) / 2
  const rows: Array<{
    bands: Array<{ gradeLabel: string; minScore: string; maxScore: string; remark: string }>
    height: number
  }> = []

  for (let index = 0; index < bands.length; index += 2) {
    const pair = bands.slice(index, index + 2)
    const heights = pair.map((band) =>
      Math.max(
        textHeight(
          state,
          `${band.gradeLabel}: ${band.minScore} - ${band.maxScore}`,
          'bold',
          style.gradingSize,
          columnWidth * 0.55,
          0.2,
        ),
        textHeight(
          state,
          band.remark,
          'bold',
          style.gradingSize,
          columnWidth * 0.45 - 2,
          0.2,
        ),
      ),
    )

    rows.push({
      bands: pair,
      height: Math.max(style.gradingRow, Math.max(...heights) + 2),
    })
  }

  return rows
}

function measureGradingHeight(
  state: RenderState,
  style: ReportStyle,
): number {
  const rows = gradingRows(state, style)
  const rowHeight = rows.reduce((sum, row) => sum + row.height, 0)

  return style.gradingHeader + rowHeight + 4
}

function signatureLineOffset(style: ReportStyle): number {
  return Math.max(12, style.signatureHeight - 30)
}

function measureSignatureHeight(
  state: RenderState,
  style: ReportStyle,
): number {
  const printedName = safeText(state.snapshot.document.signatureName ?? null)
  const designation = safeText(
    state.snapshot.document.signatureDesignation ?? null,
  )
  const textTop = signatureLineOffset(style) + 5

  if (printedName || designation) {
    const nameHeight = printedName
      ? textHeight(state, printedName, 'bold', 8.4, 240, 0.3)
      : 0
    const designationHeight = textHeight(
      state,
      designation || 'School Administrator',
      'regular',
      7.4,
      240,
      0.3,
    )

    return Math.max(
      style.signatureHeight,
      textTop + nameHeight + (printedName ? 1 : 0) + designationHeight + 2,
    )
  }

  const caption = textHeight(
    state,
    safeText(state.snapshot.document.headteacherLabel ?? null) ||
      'SCHOOL ADMIN SIGNATURE',
    'bold',
    7.4,
    240,
    0.3,
  )

  return Math.max(style.signatureHeight, textTop + caption + 2)
}

function measureLayout(state: RenderState, style: ReportStyle): LayoutPlan {
  const headerHeight = measureHeaderHeight(state, style)
  const pupilHeight = measurePupilInformation(state, style).height
  const academicHeight = measureAcademicHeight(state, style)
  const summaryHeight = style.summaryHeight
  const remarksHeight = measureRemarksHeight(state, style)
  const signatureHeight = measureSignatureHeight(state, style)
  const gradingHeight = measureGradingHeight(state, style)
  const gap = style.sectionGap
  const totalHeight =
    headerHeight +
    gap +
    pupilHeight +
    gap +
    academicHeight +
    gap +
    summaryHeight +
    gap +
    remarksHeight +
    gap +
    signatureHeight +
    gap +
    gradingHeight
  const availableHeight = BOTTOM - state.y

  return {
    style,
    headerHeight,
    pupilHeight,
    academicHeight,
    summaryHeight,
    remarksHeight,
    signatureHeight,
    gradingHeight,
    totalHeight,
    availableHeight,
  }
}

function planLayout(state: RenderState): LayoutPlan {
  let smallest: LayoutPlan | null = null

  for (const style of STYLES) {
    const plan = measureLayout(state, style)

    if (plan.totalHeight <= plan.availableHeight) {
      return plan
    }

    smallest = plan
  }

  throw new ReportLayoutOverflowError({
    subjectCount: state.snapshot.academic.subjects.length,
    requiredHeight: smallest?.totalHeight ?? 0,
    availableHeight: smallest?.availableHeight ?? 0,
  })
}

function drawSchoolHeader(state: RenderState, style: ReportStyle): number {
  const { doc, snapshot, assets } = state
  const headerTop = state.y

  drawPupilPhoto(
    state,
    assets.pupilPhoto,
    RIGHT - style.photoWidth,
    headerTop,
    style.photoWidth,
    style.photoHeight,
  )

  const width = brandingWidth(style)
  const brandingCenter = LEFT + width / 2

  drawCenteredImage(
    state,
    assets.schoolLogo ?? assets.emblem ?? assets.crest,
    brandingCenter - style.logoWidth / 2,
    headerTop,
    style.logoWidth,
    style.logoHeight,
  )

  let y = headerTop + style.logoHeight + 2
  const schoolName = snapshot.school.name.toUpperCase()
  const nameHeight = textHeight(
    state,
    schoolName,
    'bold',
    style.schoolNameSize,
    width,
    1.2,
  )

  doc
    .fillColor(COLORS.ink)
    .font(state.fontBold)
    .fontSize(style.schoolNameSize)
    .text(schoolName, LEFT, y, {
      width,
      align: 'center',
      height: nameHeight + 1,
      lineGap: 1.2,
    })
  y += nameHeight + 1

  const heading = reportHeading(snapshot)
  const headingHeight = textHeight(
    state,
    heading,
    'bold',
    style.reportHeadingSize,
    width,
    0.8,
  )

  doc
    .fillColor(COLORS.muted)
    .font(state.fontBold)
    .fontSize(style.reportHeadingSize)
    .text(heading, LEFT, y, {
      width,
      align: 'center',
      height: headingHeight + 1,
      lineGap: 0.8,
    })
  y += headingHeight + 1

  const address = schoolAddress(snapshot)

  if (address) {
    const addressHeight = textHeight(
      state,
      address,
      'regular',
      style.metaSize,
      width,
      0.4,
    )

    doc
      .fillColor(COLORS.muted)
      .font(state.fontRegular)
      .fontSize(style.metaSize)
      .text(address, LEFT, y, {
        width,
        align: 'center',
        height: addressHeight + 1,
        lineGap: 0.4,
      })
    y += addressHeight
  }

  const contact = schoolContact(snapshot)

  if (contact) {
    const contactSize = Math.max(7, style.metaSize - 0.4)
    const contactHeight = textHeight(
      state,
      contact,
      'regular',
      contactSize,
      width,
      0.4,
    )

    doc
      .font(state.fontRegular)
      .fontSize(contactSize)
      .fillColor(COLORS.muted)
      .text(contact, LEFT, y + 1, {
        width,
        align: 'center',
        height: contactHeight + 1,
        lineGap: 0.4,
      })
  }

  return headerTop + measureHeaderHeight(state, style)
}

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
  doc
    .roundedRect(x, y, width, height, 3)
    .lineWidth(0.8)
    .strokeColor(COLORS.border)
    .stroke()
  doc.restore()
}

function drawPupilInformation(
  state: RenderState,
  startY: number,
  style: ReportStyle,
): number {
  const { doc } = state
  const y = startY
  const measured = measurePupilInformation(state, style)
  const height = measured.height

  doc.save()
  doc.strokeColor(COLORS.border).lineWidth(0.8)
  doc.rect(LEFT, y, CONTENT_WIDTH, height).stroke()
  const firstDivider = LEFT + measured.widths[0]!
  const secondDivider = firstDivider + measured.widths[1]!
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

  measured.blocks.forEach((rows, blockIndex) => {
    const blockWidth = measured.widths[blockIndex] ?? CONTENT_WIDTH / 3
    const spare = height - (measured.naturalHeights[blockIndex] ?? height)
    const extraPerRow = rows.length > 0 ? spare / rows.length : 0

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
        .fontSize(style.pupilLabelSize)
        .fillColor(COLORS.muted)
        .text(row.label, blockX + 4, labelY, {
          width: blockWidth - 8,
          height: row.labelHeight + 1,
          lineGap: 0.4,
        })
      doc
        .font(state.fontBold)
        .fontSize(row.valueSize)
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

  return y + height + style.sectionGap
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

function drawAcademicTable(
  state: RenderState,
  startY: number,
  style: ReportStyle,
): number {
  const { doc, snapshot } = state
  let y = startY

  doc.save()
  doc.strokeColor(COLORS.border).lineWidth(0.8)
  doc.rect(LEFT, y, CONTENT_WIDTH, style.academicTitleHeight).stroke()
  doc.restore()
  doc
    .font(state.fontBold)
    .fontSize(style.sectionHeadingSize)
    .fillColor(COLORS.ink)
    .text(
      'ACADEMIC PERFORMANCE',
      LEFT,
      y + (style.academicTitleHeight - style.sectionHeadingSize) / 2 + 1,
      {
        width: CONTENT_WIDTH,
        align: 'center',
        height: style.sectionHeadingSize + 2,
      },
    )
  y += style.academicTitleHeight

  y = drawAcademicColumnHeader(state, y, style)

  if (snapshot.academic.mixedSubjectWeights) {
    const note =
      'Per-subject weights are shown beside each score as (weight %).'
    const noteHeight = textHeight(
      state,
      note,
      'bold',
      style.metaSize,
      CONTENT_WIDTH - 6,
      0.3,
    )

    doc
      .font(state.fontBold)
      .fontSize(style.metaSize)
      .fillColor(COLORS.muted)
      .text(note, LEFT + 3, y + 1, {
        width: CONTENT_WIDTH - 6,
        height: noteHeight + 1,
      })
    y += noteHeight + 2
  }

  snapshot.academic.subjects.forEach((subject, index) => {
    const rowHeight = measureAcademicRowHeight(state, style, subject)
    y = drawAcademicRow(state, y, subject, index, rowHeight, style)
  })

  return y + style.sectionGap
}

function drawAcademicColumnHeader(
  state: RenderState,
  startY: number,
  style: ReportStyle,
): number {
  const { doc, snapshot } = state
  const height = style.columnHeaderHeight
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
      .fontSize(style.tableHeaderSize)
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
        .fontSize(style.tableHeaderSize)
        .fillColor(COLORS.muted)
        .text(percentage, x + 2, y + height - 13, {
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

function drawAcademicRow(
  state: RenderState,
  startY: number,
  subject: SnapshotSubjectRow,
  index: number,
  height: number,
  style: ReportStyle,
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
      .fontSize(style.tableSize)
      .fillColor(COLORS.ink)
      .text(values[column.key], x + 2.5, y + style.rowPadding, {
        width: width - 5,
        height: height - style.rowPadding * 2 + 1,
        align,
        lineGap: 0.3,
      })
  }

  if (index % 2 === 1) {
    doc.save()
    doc
      .moveTo(LEFT, y + height)
      .lineTo(RIGHT, y + height)
      .lineWidth(0.35)
      .strokeColor('#cbd5e1')
      .stroke()
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

function drawSummary(
  state: RenderState,
  startY: number,
  style: ReportStyle,
): number {
  const { doc, snapshot } = state
  const y = startY
  const height = style.summaryHeight
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
        height: height - 16,
        ellipsis: true,
      })
  })

  return y + height + style.sectionGap
}

function drawRemarks(
  state: RenderState,
  startY: number,
  style: ReportStyle,
): number {
  const { doc, snapshot } = state
  const y = startY
  const height = measureRemarksHeight(state, style)
  const width = (CONTENT_WIDTH - REMARK_GAP) / 2
  const remarks = safeText(snapshot.remarks.teacher)
  const attitude = safeText(snapshot.remarks.attitude)

  const boxes = [
    ["TEACHER'S REMARKS", remarks],
    ['ATTITUDE', attitude],
  ] as const

  boxes.forEach(([label, value], index) => {
    const x = LEFT + index * (width + REMARK_GAP)
    doc.save()
    doc.strokeColor(COLORS.border).lineWidth(0.8)
    doc.rect(x, y, width, height).stroke()
    doc.restore()
    doc
      .font(state.fontBold)
      .fontSize(style.remarkLabelSize)
      .fillColor(COLORS.ink)
      .text(label, x + 4, y + 3, {
        width: width - 8,
        height: 9,
        ellipsis: true,
      })
    doc
      .font(state.fontRegular)
      .fontSize(style.remarkSize)
      .fillColor(COLORS.ink)
      .text(value, x + 4, y + 14, {
        width: width - 8,
        height: height - 17,
        lineGap: 1,
      })
  })

  return y + height + style.sectionGap
}

function drawSignature(
  state: RenderState,
  startY: number,
  style: ReportStyle,
): number {
  const { doc, snapshot, assets } = state
  const y = startY
  const height = measureSignatureHeight(state, style)
  const lineWidth = 240
  const lineX = PAGE.width / 2 - lineWidth / 2
  const lineY = y + signatureLineOffset(style)

  if (assets.signature) {
    drawCenteredImage(
      state,
      assets.signature,
      PAGE.width / 2 - 70,
      y,
      140,
      Math.max(12, lineY - y - 2),
    )
  }

  doc.save()
  doc.strokeColor(COLORS.border).lineWidth(0.9)
  doc.moveTo(lineX, lineY).lineTo(lineX + lineWidth, lineY).stroke()
  doc.restore()

  const printedName = safeText(snapshot.document.signatureName ?? null)
  const designation = safeText(snapshot.document.signatureDesignation ?? null)

  if (printedName || designation) {
    let textY = lineY + 5

    if (printedName) {
      const nameHeight = textHeight(
        state,
        printedName,
        'bold',
        8.4,
        lineWidth,
        0.3,
      )

      doc
        .font(state.fontBold)
        .fontSize(8.4)
        .fillColor(COLORS.ink)
        .text(printedName, lineX, textY, {
          width: lineWidth,
          align: 'center',
          height: nameHeight + 1,
          lineGap: 0.3,
        })
      textY += nameHeight + 1
    }

    const designationText = designation || 'School Administrator'
    const designationHeight = textHeight(
      state,
      designationText,
      'regular',
      7.4,
      lineWidth,
      0.3,
    )

    doc
      .font(state.fontRegular)
      .fontSize(7.4)
      .fillColor(COLORS.muted)
      .text(designationText, lineX, textY, {
        width: lineWidth,
        align: 'center',
        height: designationHeight + 1,
        lineGap: 0.3,
      })
  } else {
    const caption =
      snapshot.document.headteacherLabel || 'SCHOOL ADMIN SIGNATURE'
    const captionHeight = textHeight(
      state,
      caption,
      'bold',
      7.4,
      lineWidth,
      0.3,
    )

    doc
      .font(state.fontBold)
      .fontSize(7.4)
      .fillColor(COLORS.ink)
      .text(caption, lineX, lineY + 5, {
        width: lineWidth,
        align: 'center',
        height: captionHeight + 1,
        lineGap: 0.3,
      })
  }

  return y + height + style.sectionGap
}

function drawGradingScale(
  state: RenderState,
  startY: number,
  style: ReportStyle,
): number {
  const { doc } = state
  const y = startY
  const rows = gradingRows(state, style)
  const height = measureGradingHeight(state, style)
  const columnWidth = (CONTENT_WIDTH - 10) / 2

  doc.save()
  doc.strokeColor(COLORS.border).lineWidth(0.8)
  doc.rect(LEFT, y, CONTENT_WIDTH, height).stroke()
  doc.restore()

  doc
    .font(state.fontBold)
    .fontSize(style.gradingSize)
    .fillColor(COLORS.ink)
    .text('GRADING SCALE:', LEFT + 4, y + 3, {
      width: CONTENT_WIDTH - 8,
      height: 11,
    })

  let rowY = y + style.gradingHeader

  rows.forEach((row) => {
    row.bands.forEach((band, column) => {
      const x = LEFT + 4 + column * (columnWidth + 2)
      const label = `${band.gradeLabel}: ${band.minScore} - ${band.maxScore}`

      doc
        .font(state.fontBold)
        .fontSize(style.gradingSize)
        .fillColor(COLORS.ink)
        .text(label, x, rowY, {
          width: columnWidth * 0.55,
          height: row.height - 2,
          lineGap: 0.2,
        })
      doc
        .font(state.fontBold)
        .fontSize(style.gradingSize)
        .fillColor(COLORS.muted)
        .text(band.remark, x + columnWidth * 0.55, rowY, {
          width: columnWidth * 0.45 - 2,
          height: row.height - 2,
          lineGap: 0.2,
        })
    })

    rowY += row.height
  })

  return y + height
}

function drawPageFooter(state: RenderState, style: ReportStyle): void {
  const { doc, snapshot } = state
  const parts = [
    `Generated ${new Date(snapshot.generatedAt).toLocaleString('en-GB')}`,
    'Page 1 of 1',
  ]

  if (!state.released) {
    parts.unshift(state.label)
  }

  doc
    .font(state.fontRegular)
    .fontSize(style.footerSize)
    .fillColor(COLORS.muted)
    .text(parts.join('  •  '), LEFT, PAGE.height - 27, {
      width: CONTENT_WIDTH,
      align: 'center',
      height: 9,
      ellipsis: true,
    })
}
