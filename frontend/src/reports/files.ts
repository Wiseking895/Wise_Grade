export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onerror = () => reject(new Error('Could not read the selected file.'))
    reader.onload = () => {
      const result = reader.result

      if (typeof result !== 'string') {
        reject(new Error('Could not read the selected file.'))
        return
      }

      const comma = result.indexOf(',')

      if (comma < 0) {
        reject(new Error('The selected file is not valid image data.'))
        return
      }

      resolve(result.slice(comma + 1))
    }

    reader.readAsDataURL(file)
  })
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
