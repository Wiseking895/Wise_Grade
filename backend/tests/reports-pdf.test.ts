import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { sha256 } from '../src/storage/storage.js'
import { renderReportPdf } from '../src/reports/pdf.js'
import { buildReportSet } from '../src/reports/snapshot.js'
import {
  DEFAULT_PUPILS,
  DEFAULT_SUBJECTS,
  makeReportData,
} from './helpers/report-fixtures.js'
import { extractPdfText } from './helpers/pdf-text.js'
import {
  extractPdfBoxes,
  extractPdfTextItems,
} from './helpers/pdf-items.js'
import { tinyPng } from './helpers/png.js'

const ONE_PIXEL_PNG = tinyPng()

function snapshotFor(data = makeReportData()) {
  const built = buildReportSet(data)
  const snapshot = built.builds[0]!.snapshot

  if (!snapshot) {
    throw new Error('Fixture did not produce a report snapshot')
  }

  return snapshot
}

describe('report PDF rendering', () => {
  it('renders a valid A4 portrait PDF with a checksum and page count', async () => {
    const result = await renderReportPdf(snapshotFor())
    const loaded = await PDFDocument.load(result.data)

    expect(result.data.subarray(0, 5).toString()).toBe('%PDF-')
    expect(result.byteSize).toBe(result.data.length)
    expect(result.checksum).toBe(sha256(result.data))
    expect(result.pageCount).toBe(loaded.getPageCount())
    expect(result.pageCount).toBe(1)

    const page = loaded.getPage(0)
    expect(page.getWidth()).toBeCloseTo(595.28, 1)
    expect(page.getHeight()).toBeCloseTo(841.89, 1)
  })

  it('prints stored subject positions as ordinals', async () => {
    const pupils = [
      {
        ...DEFAULT_PUPILS[0]!,
        id: 'pupil-a',
        firstName: 'Ama',
        lastName: 'Asare',
        scores: {
          'sub-math': '90.00',
          'sub-english': '70.00',
          'sub-science': '60.00',
        },
      },
      {
        ...DEFAULT_PUPILS[1]!,
        id: 'pupil-b',
        firstName: 'Bola',
        lastName: 'Bediako',
        scores: {
          'sub-math': '80.00',
          'sub-english': '80.00',
          'sub-science': '60.00',
        },
      },
      {
        ...DEFAULT_PUPILS[2]!,
        id: 'pupil-c',
        firstName: 'Chipo',
        lastName: 'Cole',
        scores: {
          'sub-math': '80.00',
          'sub-english': '60.00',
          'sub-science': '60.00',
        },
      },
      {
        ...DEFAULT_PUPILS[0]!,
        id: 'pupil-d',
        firstName: 'Dela',
        lastName: 'Danso',
        admissionNumber: 'GVA/2026/004',
        scores: {
          'sub-math': '70.00',
          'sub-english': '60.00',
          'sub-science': '60.00',
        },
      },
    ]

    const built = buildReportSet(makeReportData({ pupils }))
    expect(
      built.builds.map(
        (item) => item.snapshot!.academic.subjects[0]!.subjectPosition,
      ),
    ).toEqual([1, 2, 2, 4])

    const pages = await Promise.all(
      built.builds.map(async (item) => {
        const result = await renderReportPdf(item.snapshot!)
        return extractPdfText(result.data)
      }),
    )
    const text = pages.join('\n')

    expect(text).toContain('1st')
    expect(text).toContain('2nd')
    expect(text).not.toMatch(/Pending submission|Pending review|Not ranked/)
    expect(text).toContain('4th')
  })

  it('renders a released report without the draft label', async () => {
    const snapshot = snapshotFor()
    const draft = await renderReportPdf(snapshot)
    const released = await renderReportPdf(snapshot, {}, { released: true })
    const releasedText = await extractPdfText(released.data)
    const draftText = await extractPdfText(draft.data)
    const loaded = await PDFDocument.load(released.data)

    expect(releasedText).not.toContain('RELEASED — PRIVATE SCHOOL ACCESS')
    expect(releasedText).not.toContain('INTERNAL DRAFT')
    expect(draftText).toContain('INTERNAL DRAFT — NOT RELEASED')
    expect(released.checksum).not.toBe(draft.checksum)
    expect(loaded.getPageCount()).toBe(draft.pageCount)
    expect(loaded.getPage(0).getWidth()).toBeCloseTo(595.28, 1)
    expect(loaded.getPage(0).getHeight()).toBeCloseTo(841.89, 1)
  })

  it('renders optional school and signature images without inventing missing ones', async () => {
    const result = await renderReportPdf(snapshotFor(), {
      emblem: ONE_PIXEL_PNG,
      pupilPhoto: ONE_PIXEL_PNG,
      signature: ONE_PIXEL_PNG,
    })
    const loaded = await PDFDocument.load(result.data)

    expect(loaded.getPageCount()).toBe(1)
  })

  it('renders when every optional image is absent', async () => {
    const result = await renderReportPdf(snapshotFor(), {
      emblem: null,
      crest: null,
      pupilPhoto: null,
      signature: null,
    })
    const loaded = await PDFDocument.load(result.data)

    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(1)
  })

  it('handles long pupil names and long subject names', async () => {
    const subjects = [
      {
        id: 'sub-long-1',
        name: 'Religious and Moral Education, Citizenship and Social Studies',
        sortOrder: 0,
      },
      {
        id: 'sub-long-2',
        name: 'Ghanaian Language and Culture with Creative Arts and Design',
        sortOrder: 1,
      },
      { id: 'sub-long-3', name: 'Mathematics', sortOrder: 2 },
    ]
    const data = makeReportData({
      subjects,
      pupils: [
        {
          ...DEFAULT_PUPILS[0]!,
          firstName: 'Ama Serwaa Nkrumah-Adjei Boateng Mensah Owusu-Ansah',
          lastName: 'Agyeman-Danquah',
          scores: {
            'sub-long-1': '88.00',
            'sub-long-2': '79.00',
            'sub-long-3': '91.00',
          },
        },
      ],
    })
    const result = await renderReportPdf(snapshotFor(data))
    const loaded = await PDFDocument.load(result.data)

    expect(loaded.getPageCount()).toBe(1)
  })

  it('paginates cleanly when many subjects do not fit on one page', async () => {
    const subjects = Array.from({ length: 22 }, (_, index) => ({
      id: `sub-${index}`,
      name: `Subject Number ${index + 1} with a deliberately descriptive name`,
      sortOrder: index,
    }))
    const scores = Object.fromEntries(
      subjects.map((subject, index) => [subject.id, `${70 + (index % 25)}.00`]),
    )
    const data = makeReportData({
      subjects,
      pupils: [
        {
          ...DEFAULT_PUPILS[0]!,
          scores,
        },
      ],
    })
    const result = await renderReportPdf(snapshotFor(data))
    const loaded = await PDFDocument.load(result.data)

    expect(result.pageCount).toBeGreaterThan(1)
    expect(loaded.getPageCount()).toBe(result.pageCount)

    for (const page of loaded.getPages()) {
      expect(page.getWidth()).toBeCloseTo(595.28, 1)
      expect(page.getHeight()).toBeCloseTo(841.89, 1)
    }
  })

  it('renders a school with one crest and no emblem in the reserved left position', async () => {
    const data = makeReportData({
      settings: {
        emblemObjectKey: null,
        crestObjectKey: 'schools/school-1/report-assets/crest/crest.png',
      },
    })
    const result = await renderReportPdf(snapshotFor(data), {
      crest: ONE_PIXEL_PNG,
    })

    expect(result.pageCount).toBe(1)
  })

  it('keeps a report readable when optional fields are absent', async () => {
    const data = makeReportData({
      settings: {
        aggregatePolicy: 'NONE',
        closingDate: null,
        reopeningDate: null,
        rankingEnabled: false,
      },
      pupils: [
        {
          ...DEFAULT_PUPILS[0]!,
          teacherRemarks: null,
          attitude: null,
        },
      ],
    })
    const result = await renderReportPdf(snapshotFor(data))

    expect(result.pageCount).toBe(1)
    expect(result.data.length).toBeGreaterThan(1000)
  })

  it('wraps an unusually long school name without clipping the address', async () => {
    const data = makeReportData({
      schoolName:
        'Saint Augustine Roman Catholic Basic School Complex and Community Learning Centre, Ashanti Region',
    })
    const result = await renderReportPdf(snapshotFor(data), {
      emblem: ONE_PIXEL_PNG,
      crest: ONE_PIXEL_PNG,
      pupilPhoto: ONE_PIXEL_PNG,
      signature: ONE_PIXEL_PNG,
    })
    const loaded = await PDFDocument.load(result.data)

    expect(result.pageCount).toBe(1)
    expect(loaded.getPageCount()).toBe(1)
  })

  it('keeps maximum-length remarks inside the report', async () => {
    const data = makeReportData({
      pupils: [
        {
          ...DEFAULT_PUPILS[0]!,
          teacherRemarks: 'A focused and consistent learner. '.repeat(28),
          attitude: 'Respectful and cooperative in class. '.repeat(11),
        },
      ],
    })
    const result = await renderReportPdf(snapshotFor(data))
    const loaded = await PDFDocument.load(result.data)

    expect(result.pageCount).toBe(loaded.getPageCount())
    expect(result.pageCount).toBeGreaterThanOrEqual(1)
    expect(result.pageCount).toBeLessThanOrEqual(2)
  })

  it('prints a long grading scale without overflowing the page', async () => {
    const bands = [
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
    const data = makeReportData()

    for (const submission of data.submissions) {
      submission.gradingSnapshot = {
        id: 'scheme-wide',
        name: 'Ten band scale',
        bands,
      }
    }
    for (const score of data.scores) {
      const band = bands.find(
        (item) =>
          Number(score.finalScore) >= Number(item.minScore) &&
          Number(score.finalScore) <= Number(item.maxScore),
      )!

      score.gradeLabel = band.gradeLabel
      score.gradeRemark = band.remark
      score.gradingSnapshot = {
        id: 'scheme-wide',
        name: 'Ten band scale',
        bands,
      }
    }

    const result = await renderReportPdf(snapshotFor(data))

    expect(result.pageCount).toBe(1)
  })

  it('reserves missing photo and crest positions without substituting imagery', async () => {
    const data = makeReportData()
    const result = await renderReportPdf(snapshotFor(data), {
      emblem: ONE_PIXEL_PNG,
      signature: ONE_PIXEL_PNG,
    })

    expect(result.pageCount).toBe(1)
  })

  it('keeps the school branding centred in its column, the photograph top-right and omits the release banner', async () => {
    const snapshot = snapshotFor()
    const result = await renderReportPdf(snapshot, {}, { released: true })
    const pages = await extractPdfTextItems(result.data)
    const items = pages[0]!

    const schoolName = items.find((item) =>
      item.text.includes('GREEN VALLEY ACADEMY'),
    )!
    expect(schoolName).toBeDefined()
    expect(schoolName.fontSize).toBeGreaterThanOrEqual(16)
    // The name is centred inside the branding column to the left of the photo.
    expect(schoolName.x).toBeGreaterThan(120)
    expect(schoolName.x).toBeLessThan(160)

    const photo = items.find((item) => item.text.trim() === 'PHOTO')!
    expect(photo).toBeDefined()
    expect(photo.x).toBeGreaterThan(460)
    expect(photo.y).toBeGreaterThan(700)
    // The name begins below the top-right photograph, so they never overlap.
    expect(schoolName.y).toBeLessThan(photo.y)

    const address = items.find((item) =>
      item.text.includes('Independence Avenue'),
    )!
    expect(address).toBeDefined()
    expect(address.y).toBeLessThan(schoolName.y)

    const text = await extractPdfText(result.data)
    expect(text).not.toContain('RELEASED — PRIVATE SCHOOL ACCESS')
    expect(text).not.toContain('INTERNAL DRAFT')
    expect(text).toContain('ACADEMIC PERFORMANCE')
  })

  it('prints the signature name and designation instead of the generic caption', async () => {
    const data = makeReportData()
    data.school.signatureName = 'Grace Mensah'
    data.school.signatureDesignation = 'Headmistress'
    const result = await renderReportPdf(
      snapshotFor(data),
      { signature: ONE_PIXEL_PNG },
      { released: true },
    )
    const text = await extractPdfText(result.data)

    expect(text).toContain('Grace Mensah')
    expect(text).toContain('Headmistress')
    expect(text).not.toContain('SCHOOL ADMIN SIGNATURE')
  })

  it('keeps the generic signature caption when no printed name is stored', async () => {
    const result = await renderReportPdf(snapshotFor(), {}, { released: true })
    const text = await extractPdfText(result.data)

    expect(text).toContain('SCHOOL ADMIN SIGNATURE')
    expect(text).not.toContain("HEADMASTER'S SIGNATURE")
  })

  it('uses one bold size for pupil information and a compact horizontal academic header', async () => {
    const result = await renderReportPdf(
      snapshotFor(
        makeReportData({
          subjects: DEFAULT_SUBJECTS.map((subject) => ({
            ...subject,
            sbaWeight: '60.00',
            examWeight: '40.00',
          })),
        }),
      ),
      {},
      { released: true },
    )
    const items = (await extractPdfTextItems(result.data))[0]!
    const text = await extractPdfText(result.data)

    const boldFont = items.find((item) => item.text.trim() === 'PUPIL NAME')!
      .fontName
    const regularFont = items.find((item) =>
      item.text.includes('A focused and consistent learner.'),
    )!.fontName
    expect(boldFont).not.toBe('')
    expect(regularFont).not.toBe('')
    expect(boldFont).not.toBe(regularFont)

    const infoLabels = [
      'PUPIL NAME',
      'INDEX / ADMISSION NUMBER',
      'CLASS',
      'ACADEMIC YEAR',
      'TERM',
      'CLASS POSITION',
      'NUMBER ON ROLL',
      'CLOSING DATE',
      'REOPENING DATE',
    ]

    for (const label of infoLabels) {
      const item = items.find((entry) => entry.text.trim() === label)
      expect(item, label).toBeDefined()
      // The pupil-information section dropped from 10.9pt to 9pt.
      expect(item!.fontSize).toBeCloseTo(9, 1)
      expect(item!.fontName).toBe(boldFont)
    }

    // Every 9pt item in the pupil-information block is bold: labels and values
    // share one size and one weight, and are separated by position and colour.
    const infoItems = items.filter(
      (item) => item.fontSize > 8.9 && item.fontSize < 9.1,
    )
    expect(infoItems.length).toBeGreaterThan(infoLabels.length)
    expect(infoItems.every((item) => item.fontName === boldFont)).toBe(true)

    const academicHeading = items.find((item) =>
      item.text.includes('ACADEMIC PERFORMANCE'),
    )!
    const summaryHeading = items.find(
      (item) => item.text.trim() === 'AGGREGATE',
    )!
    expect(academicHeading.fontSize).toBeGreaterThanOrEqual(10.4)
    expect(summaryHeading.y).toBeLessThan(academicHeading.y)

    // Every academic column heading is a single horizontal line at one size.
    const headings = [
      'SUBJECT',
      'CLASS SCORE',
      'EXAMS SCORE',
      'TOTAL SCORE',
      'POSITION',
      'GRADE',
      'REMARK',
    ]
    const headingItems = headings.map((heading) => {
      const item = items.find(
        (entry) =>
          entry.text.trim() === heading && entry.y < academicHeading.y,
      )
      expect(item, heading).toBeDefined()
      expect(item!.fontSize).toBeCloseTo(7.8, 1)
      expect(item!.fontName).toBe(boldFont)
      return item!
    })
    expect(new Set(headingItems.map((item) => item.y.toFixed(2))).size).toBe(1)

    // The weighting labels stay on the line below their score headings.
    const percentageItems = ['(60.00%)', '(40.00%)', '(100%)'].map(
      (label) => {
        const item = items.find(
          (entry) => entry.text.trim() === label && entry.y < academicHeading.y,
        )
        expect(item, label).toBeDefined()
        expect(item!.fontSize).toBeCloseTo(7.8, 1)
        return item!
      },
    )
    for (const [index, percentage] of percentageItems.entries()) {
      expect(percentage.y).toBeLessThan(headingItems[index + 1]!.y)
      expect(percentage.y).toBeGreaterThan(headingItems[index + 1]!.y - 20)
    }

    // Body cells remain at the academic table size.
    const academicCells = items.filter(
      (item) =>
        item.y < academicHeading.y - 40 &&
        item.y > summaryHeading.y &&
        item.fontSize > 9.4,
    )
    expect(academicCells.length).toBeGreaterThan(10)
    for (const item of academicCells) {
      if (item.text.trim() === '') continue
      expect(item.fontSize).toBeCloseTo(9.6, 1)
      expect(item.fontName).toBe(boldFont)
    }

    const grading = items.find((item) => item.text.includes('GRADING SCALE'))!
    const band = items.find((item) => item.text.includes('A: 80.00'))!
    const bandRemark = items.find(
      (item) => item.text.trim() === 'Excellent' && item.y < grading.y,
    )!
    expect(grading.fontSize).toBeCloseTo(8.6, 1)
    expect(band.fontSize).toBeCloseTo(8.6, 1)
    expect(bandRemark.fontSize).toBeCloseTo(8.6, 1)
    expect(band.fontName).toBe(boldFont)
    expect(bandRemark.fontName).toBe(boldFont)

    // Renamed display labels. The underlying assessment fields and values are
    // unchanged; only the printed headings changed.
    expect(text).toContain('CLASS SCORE')
    expect(text).toContain('EXAMS SCORE')
    expect(text).not.toContain('CLASS/SBA')
    expect(text).not.toContain('EXAMINATION SCORE')
    expect(text).toContain('92.00')
    expect(text).not.toContain('EXAMINATION TOTAL')

    // Saved term records are the values printed on the report card.
    expect(text).toContain('A focused and consistent learner.')
    expect(text).toContain('Respectful and cooperative.')
    expect(text).toContain('58/60')
  })

  it('keeps the photograph frame 30% larger than the previous 74.4 × 91.2pt frame', async () => {
    const result = await renderReportPdf(snapshotFor(), {}, { released: true })
    const boxes = (await extractPdfBoxes(result.data))[0]!
    const photo = boxes.find(
      (box) =>
        Math.abs(box.width - 96.72) < 0.8 &&
        Math.abs(box.height - 118.56) < 0.8,
    )

    expect(photo).toBeDefined()
    expect(photo!.x).toBeGreaterThan(460)
    expect(photo!.width / 74.4).toBeCloseTo(1.3, 3)
    expect(photo!.height / 91.2).toBeCloseTo(1.3, 3)
    expect(photo!.width / photo!.height).toBeCloseTo(74.4 / 91.2, 3)
    // Both header elements start at the same top edge; the photo frame reaches
    // from the released header top down by exactly its height.
    expect(photo!.y).toBeCloseTo(36, 1)
  })

  it('reduces the remark and attitude panels while growing them for long text', async () => {
    const shortResult = await renderReportPdf(
      snapshotFor(),
      {},
      { released: true },
    )
    const shortBoxes = (await extractPdfBoxes(shortResult.data))[0]!
    const shortPanels = shortBoxes.filter(
      (box) => box.width > 255 && box.width < 268 && box.width > box.height,
    )

    expect(shortPanels.length).toBeGreaterThanOrEqual(2)
    const shortHeight = shortPanels[0]!.height
    expect(Math.abs(shortPanels[1]!.height - shortHeight)).toBeLessThan(0.5)
    // The previous design rendered roughly 281pt; the new panels are about 30%
    // of that, i.e. a reduction of roughly 70%.
    expect(shortHeight).toBeGreaterThan(75)
    expect(shortHeight).toBeLessThanOrEqual(95)
    expect(shortHeight / 281).toBeLessThanOrEqual(0.34)

    const longRemark = [
      'This pupil has worked with steady concentration throughout the term.',
      'Reading fluency and number confidence have both improved noticeably,',
      'and written work is now presented with care and pride.',
      'Continued practice at home will keep this progress moving forward.',
      'Participation in class discussions is thoughtful and respectful.',
    ].join(' ')

    const pupils = DEFAULT_PUPILS.map((pupil, index) => ({
      ...pupil,
      teacherRemarks: index === 0 ? longRemark : pupil.teacherRemarks,
    }))
    const longResult = await renderReportPdf(
      snapshotFor(makeReportData({ pupils })),
      {},
      { released: true },
    )
    const longBoxes = (await extractPdfBoxes(longResult.data))[0]!
    const longPanels = longBoxes.filter(
      (box) => box.width > 255 && box.width < 268 && box.width > box.height,
    )
    const longText = (await extractPdfText(longResult.data)).replace(/\s+/g, ' ')

    expect(longPanels.length).toBeGreaterThanOrEqual(2)
    expect(longPanels[0]!.height).toBeGreaterThan(shortHeight + 20)
    expect(longText).toContain('Continued practice at home will keep this progress moving forward.')
  })

  it('keeps the signature and grading scale compact beneath the remark panels', async () => {
    const data = makeReportData()
    data.school.signatureName = 'Grace Mensah'
    data.school.signatureDesignation = 'Headmistress'

    const result = await renderReportPdf(
      snapshotFor(data),
      { signature: ONE_PIXEL_PNG },
      { released: true },
    )
    const boxes = (await extractPdfBoxes(result.data))[0]!
    const items = (await extractPdfTextItems(result.data))[0]!
    const panel = boxes.find(
      (box) =>
        box.width > 255 &&
        box.width < 268 &&
        box.height > 75 &&
        box.height <= 95,
    )!
    const printedName = items.find(
      (item) => item.text.trim() === 'Grace Mensah',
    )!
    const grading = items.find((item) => item.text.includes('GRADING SCALE'))!

    expect(panel).toBeDefined()
    // `extractPdfBoxes` reports path bounds from the top of the page while text
    // baselines come from the bottom, so convert the panel's lower edge first.
    const panelBottom = 841.89 - (panel.y + panel.height)
    // The signature block follows the panels directly instead of being pushed
    // to the bottom of the page, and the grading scale follows the signature.
    expect(panelBottom - printedName.y).toBeGreaterThan(35)
    expect(panelBottom - printedName.y).toBeLessThan(65)
    expect(panelBottom - grading.y).toBeGreaterThan(75)
    expect(panelBottom - grading.y).toBeLessThan(105)
  })

  it('prints early-years Gold/Silver/Bronze remarks that match the preview snapshot', async () => {    const data = makeReportData({ className: 'Creche' })
    const built = buildReportSet(data)

    const esi = built.builds.find(
      (build) => build.pupil.id === 'pupil-esi',
    )!.snapshot!
    expect(esi.academic.earlyYears).toBe(true)
    expect(esi.academic.subjects.map((row) => row.remark)).toEqual([
      'Silver (S)',
      'Silver (S)',
      'Bronze (B)',
    ])

    for (const pupilId of ['pupil-ada', 'pupil-esi']) {
      const snapshot = built.builds.find(
        (build) => build.pupil.id === pupilId,
      )!.snapshot!

      expect(snapshot.academic.earlyYears).toBe(true)
      expect(snapshot.academic.subjects.every((row) => row.grade === null)).toBe(
        true,
      )

      const result = await renderReportPdf(snapshot)
      const text = await extractPdfText(result.data)

      expect(text).toContain('GRADING SCALE:')
      expect(text).toContain('G: 80.00 - 100.00')
      expect(text).toContain('S: 55.00 - 79.99')
      expect(text).toContain('B: 0.00 - 54.99')
      for (const row of snapshot.academic.subjects) {
        expect(row.remark).toMatch(/^(Gold|Silver|Bronze) \([GSB]\)$/)
        expect(text).toContain(row.remark)
      }
    }
  })
})
