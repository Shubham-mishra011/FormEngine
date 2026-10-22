/** Local-date helpers. Due dates are plain calendar dates (yyyy-MM-dd), not instants. */
export function todayString(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function dueLabel(due: string, today = todayString()): { text: string; overdue: boolean } {
  const days = Math.round(
    (Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  )
  if (days === 0) return { text: 'Today', overdue: false }
  if (days === 1) return { text: 'Tomorrow', overdue: false }
  if (days === -1) return { text: 'Yesterday', overdue: true }
  if (days < 0) return { text: `${-days} days overdue`, overdue: true }
  const text = new Date(`${due}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
  return { text, overdue: false }
}
