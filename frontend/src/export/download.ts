/**
 * Triggers a browser file download for an in-memory blob via a temporary
 * `<a download>` element (spec X4). Kept separate so the export dialog and the
 * home-page JSON export share one implementation.
 *
 * @param blob The file contents.
 * @param filename The suggested download file name.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
