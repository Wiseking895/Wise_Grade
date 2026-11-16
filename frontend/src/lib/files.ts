/** Reads a browser File as raw base64 (without the data URL prefix). */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the selected file'))
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      resolve(result.replace(/^data:[^;]+;base64,/, ''))
    }
    reader.readAsDataURL(file)
  })
}
