const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** Formats an ISO timestamp as a short relative phrase ("just now", "3 h ago", ...). */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  const elapsed = now.getTime() - then.getTime()
  if (Number.isNaN(elapsed)) return iso
  if (elapsed < MINUTE_MS) return 'just now'
  if (elapsed < HOUR_MS) {
    const minutes = Math.floor(elapsed / MINUTE_MS)
    return `${minutes} min ago`
  }
  if (elapsed < DAY_MS) {
    const hours = Math.floor(elapsed / HOUR_MS)
    return `${hours} h ago`
  }
  if (elapsed < 7 * DAY_MS) {
    const days = Math.floor(elapsed / DAY_MS)
    return days === 1 ? 'yesterday' : `${days} days ago`
  }
  return then.toLocaleDateString()
}
