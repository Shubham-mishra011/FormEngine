/** Local-date helpers. Due dates are plain calendar dates (yyyy-MM-dd), not instants. */
export function todayString(now = new Date()): string {
  return toISO(now)
}

export function toISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Calendar arithmetic on yyyy-MM-dd strings, done in UTC so DST never shifts a date. */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function addMonths(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + n)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d.toISOString().slice(0, 10)
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay()
}

/** First day of the week containing `iso`. weekStart: 0 = Sunday, 1 = Monday. */
export function startOfWeek(iso: string, weekStart: 0 | 1 = 1): string {
  const back = (weekday(iso) - weekStart + 7) % 7
  return addDays(iso, -back)
}

export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`
}

/** The 6 × 7 grid of dates (6 weeks) that displays the month containing `iso`. */
export function monthGrid(iso: string, weekStart: 0 | 1 = 1): string[][] {
  const first = startOfWeek(monthStart(iso), weekStart)
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(first, w * 7 + d)))
}

export function weekDays(iso: string, weekStart: 0 | 1 = 1): string[] {
  const first = startOfWeek(iso, weekStart)
  return Array.from({ length: 7 }, (_, i) => addDays(first, i))
}

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function weekdayShort(day: number): string {
  return WEEKDAY_NAMES[day].slice(0, 3)
}

export type DateFormat = 'auto' | 'iso' | 'dmy' | 'mdy'
export type TimeFormat = 'auto' | '24h' | '12h'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Short date such as "Oct 21" / "21 Oct" / "10/21" according to the user's preference. */
export function formatDate(iso: string, fmt: DateFormat = 'auto', withYear = false): string {
  const [y, m, d] = iso.split('-').map(Number)
  switch (fmt) {
    case 'iso':
      return iso
    case 'dmy':
      return `${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ''}`
    case 'mdy':
      return `${MONTHS[m - 1]} ${d}${withYear ? `, ${y}` : ''}`
    default:
      return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: withYear ? 'numeric' : undefined,
        timeZone: 'UTC',
      })
  }
}

/** "14:30" or "2:30 PM" from an API time such as "14:30:00". */
export function formatTime(time: string, fmt: TimeFormat = 'auto'): string {
  const [h, m] = time.split(':').map(Number)
  if (fmt === '24h') return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  if (fmt === '12h') return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
  return new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
}

export function formatMonthTitle(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export function formatLongDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export function dueLabel(due: string, today = todayString(), fmt: DateFormat = 'auto'): { text: string; overdue: boolean } {
  const days = daysBetween(today, due)
  if (days === 0) return { text: 'Today', overdue: false }
  if (days === 1) return { text: 'Tomorrow', overdue: false }
  if (days === -1) return { text: 'Yesterday', overdue: true }
  if (days < 0) return { text: `${-days} days overdue`, overdue: true }
  return { text: formatDate(due, fmt), overdue: false }
}

export function greeting(now = new Date()): string {
  const h = now.getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

/** "1h 30m" / "45m" from minutes. */
export function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/** "25:00" style countdown. */
export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
