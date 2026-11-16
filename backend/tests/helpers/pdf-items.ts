import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'

export interface PositionedPdfText {
  text: string
  /** Horizontal origin in PDF user space (points from the left edge). */
  x: number
  /** Baseline in PDF user space (points from the bottom edge). */
  y: number
  /** Approximate rendered font size in points. */
  fontSize: number
  /** PDF.js font resource name. Bold and regular text use different names. */
  fontName: string
}

export interface PdfBox {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Extracts visible text with its position and size. Layout tests use this to
 * assert that the header, photograph and remarks blocks stay in their intended
 * places instead of relying on brittle byte comparisons.
 */
export async function extractPdfTextItems(
  data: Buffer,
): Promise<PositionedPdfText[][]> {
  const loadingTask = getDocument({
    data: new Uint8Array(data),
    useSystemFonts: true,
  })
  const document = await loadingTask.promise

  try {
    const pages: PositionedPdfText[][] = []

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      pages.push(
        content.items
          .filter((item) => 'str' in item)
          .map((item) => {
            const text = item as {
              str: string
              transform: number[]
              fontName?: string
            }

            return {
              text: text.str,
              x: text.transform[4] ?? 0,
              y: text.transform[5] ?? 0,
              fontSize: Math.hypot(
                text.transform[2] ?? 0,
                text.transform[3] ?? 0,
              ),
              fontName: text.fontName ?? '',
            }
          }),
      )
    }

    return pages
  } finally {
    await loadingTask.destroy()
  }
}

/**
 * Extracts the bounding boxes of drawn paths (tables, panels, the photograph
 * frame). PDFKit emits rectangles as path operators, so layout tests inspect
 * the `constructPath` bounds rather than raw PDF bytes.
 */
export async function extractPdfBoxes(data: Buffer): Promise<PdfBox[][]> {
  const loadingTask = getDocument({
    data: new Uint8Array(data),
    useSystemFonts: true,
  })
  const document = await loadingTask.promise

  try {
    const pages: PdfBox[][] = []

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const operators = await page.getOperatorList()
      const boxes: PdfBox[] = []

      for (let index = 0; index < operators.fnArray.length; index += 1) {
        if (operators.fnArray[index] !== OPS.constructPath) continue

        const args = operators.argsArray[index] as unknown[]
        const bounds = args[2]

        if (!Array.isArray(bounds) && !ArrayBuffer.isView(bounds)) continue

        const [x0, y0, x1, y1] = Array.from(bounds as ArrayLike<number>).map(
          Number,
        )
        const width = (x1 ?? 0) - (x0 ?? 0)
        const height = (y1 ?? 0) - (y0 ?? 0)

        if (width > 1 && height > 1) {
          boxes.push({
            x: x0 ?? 0,
            y: y0 ?? 0,
            width,
            height,
          })
        }
      }

      pages.push(boxes)
    }

    return pages
  } finally {
    await loadingTask.destroy()
  }
}
