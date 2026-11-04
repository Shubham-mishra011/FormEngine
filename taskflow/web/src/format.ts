/** Human-readable average completion time. `null` means there is no completed task to average. */
export function formatDuration(hours: number | null): string {
  if (hours === null) return '—'
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`
  if (hours < 48) return `${hours.toFixed(1)} h`
  return `${(hours / 24).toFixed(1)} days`
}

/** "Oct 21" for a yyyy-MM-dd calendar date, independent of the viewer's time zone. */
export function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1048576).toFixed(1)} MB`
}
