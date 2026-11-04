/** Reads a user-chosen file as text. Blob.text() is missing in some environments, so fall back to FileReader. */
export function readFileText(file: Blob): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.readAsText(file)
  })
}
