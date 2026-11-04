import type { Recurrence, RecurrenceInput } from './api'
import { weekdayShort } from './dates'

type Describable = Pick<RecurrenceInput, 'frequency' | 'interval' | 'weekdays' | 'monthDays' | 'endDate' | 'maxOccurrences'>

const UNIT: Record<string, [string, string]> = {
  Daily: ['day', 'days'],
  Weekly: ['week', 'weeks'],
  Monthly: ['month', 'months'],
  Yearly: ['year', 'years'],
}

function ordinal(n: number): string {
  if (n === -1) return 'last day'
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

/** "Every 2 weeks on Mon, Wed, until Dec 31" – shown in the editor and on task cards. */
export function describeRecurrence(r: Describable): string {
  const [one, many] = UNIT[r.frequency]
  let text = r.interval === 1 ? (r.frequency === 'Daily' ? 'Every day' : `Every ${one}`) : `Every ${r.interval} ${many}`
  if (r.frequency === 'Weekly' && r.weekdays?.length) {
    text += ` on ${[...r.weekdays].sort((a, b) => a - b).map(weekdayShort).join(', ')}`
  }
  if (r.frequency === 'Monthly' && r.monthDays?.length) {
    text += ` on the ${[...r.monthDays].sort((a, b) => (a === -1 ? 99 : a) - (b === -1 ? 99 : b)).map(ordinal).join(', ')}`
  }
  if (r.endDate) text += `, until ${r.endDate}`
  if (r.maxOccurrences) text += `, ${r.maxOccurrences} times`
  return text
}

export function toInput(r: Recurrence): RecurrenceInput {
  return {
    frequency: r.frequency,
    interval: r.interval,
    weekdays: r.weekdays,
    monthDays: r.monthDays,
    endDate: r.endDate,
    maxOccurrences: r.maxOccurrences,
  }
}

/** Parses "1, 15, last" into month days; returns null when a token is invalid. */
export function parseMonthDays(text: string): number[] | null {
  const out: number[] = []
  for (const raw of text.split(/[,\s]+/).filter(Boolean)) {
    const t = raw.toLowerCase()
    const n = t === 'last' ? -1 : Number(t)
    if (!Number.isInteger(n) || (n !== -1 && (n < 1 || n > 31))) return null
    if (!out.includes(n)) out.push(n)
  }
  return out
}

export function formatMonthDays(days: number[]): string {
  return days.map((d) => (d === -1 ? 'last' : String(d))).join(', ')
}
