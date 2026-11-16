import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

/**
 * PDF text is stored in compressed UTF-16 streams, so a naive latin1 scan of
 * the raw bytes cannot see rendered labels. Extract the visible text instead.
 */
export async function extractPdfText(data: Buffer): Promise<string> {
  const loadingTask = getDocument({
    data: new Uint8Array(data),
    useSystemFonts: true,
  })
  const document = await loadingTask.promise

  try {
    const pages: string[] = []

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      pages.push(
        content.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' '),
      )
    }

    return pages.join('\n')
  } finally {
    await loadingTask.destroy()
  }
}
