import type { Category, Frequency, Priority, RecurrenceInput, Tag } from './api'
import { addDays, weekday } from './dates'

export interface QuickAddResult {
  title: string
  priority: Priority | null
  dueDate: string | null
  dueTime: string | null
  categoryId: number | null
  tagIds: number[]
  estimatedMinutes: number | null
  recurrence: RecurrenceInput | null
  /** Human-readable chips describing what was understood, for the live preview. */
  summary: string[]
}

const PRIORITY_WORDS: Record<string, Priority> = {
  '!low': 'Low', '!l': 'Low', '!medium': 'Medium', '!med': 'Medium', '!m': 'Medium',
  '!high': 'High', '!h': 'High', '!urgent': 'Urgent', '!u': 'Urgent',
}

const DAY_NAMES: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
}

function nextWeekday(today: string, target: number): string {
  const diff = (target - weekday(today) + 7) % 7
  return addDays(today, diff === 0 ? 7 : diff)
}

function parseTime(token: string): string | null {
  const m = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/i.exec(token)
  if (!m) return null
  let h = Number(m[1])
  const min = m[2] ? Number(m[2]) : 0
  const mer = m[3]?.toLowerCase()
  if (!m[2] && !mer) return null // a bare number is not a time
  if (mer) {
    if (h < 1 || h > 12) return null
    h = (h % 12) + (mer === 'pm' ? 12 : 0)
  }
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/**
 * Understands a one-line task such as `Pay rent tomorrow at 9am !high #home @Finance ~30m every month`.
 * Anything not recognised stays in the title, so ordinary sentences are never mangled.
 */
export function parseQuickAdd(
  text: string,
  ctx: { tags: Tag[]; categories: Category[]; today: string },
): QuickAddResult {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const keep: string[] = []
  const out: QuickAddResult = {
    title: '', priority: null, dueDate: null, dueTime: null, categoryId: null, tagIds: [],
    estimatedMinutes: null, recurrence: null, summary: [],
  }

  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const lower = w.toLowerCase()

    if (PRIORITY_WORDS[lower]) {
      out.priority = PRIORITY_WORDS[lower]
      out.summary.push(out.priority)
      continue
    }
    if (lower.startsWith('#') && lower.length > 1) {
      const tag = ctx.tags.find((t) => t.name.toLowerCase() === lower.slice(1))
      if (tag) {
        if (!out.tagIds.includes(tag.id)) out.tagIds.push(tag.id)
        out.summary.push(`#${tag.name}`)
        continue
      }
    }
    if (lower.startsWith('@') && lower.length > 1) {
      const name = lower.slice(1).replace(/_/g, ' ')
      const cat = ctx.categories.find((c) => c.name.toLowerCase() === name)
      if (cat) {
        out.categoryId = cat.id
        out.summary.push(cat.name)
        continue
      }
    }
    const est = /^~(\d+)(m|h)$/.exec(lower)
    if (est) {
      out.estimatedMinutes = Number(est[1]) * (est[2] === 'h' ? 60 : 1)
      out.summary.push(`~${est[1]}${est[2]}`)
      continue
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(w) && !Number.isNaN(Date.parse(`${w}T00:00:00Z`))) {
      out.dueDate = w
      out.summary.push(w)
      continue
    }
    if (lower === 'today') { out.dueDate = ctx.today; out.summary.push('Today'); continue }
    if (lower === 'tomorrow' || lower === 'tmrw') { out.dueDate = addDays(ctx.today, 1); out.summary.push('Tomorrow'); continue }
    if (lower === 'next' && words[i + 1]?.toLowerCase() === 'week') {
      out.dueDate = addDays(ctx.today, 7)
      out.summary.push('Next week')
      i++
      continue
    }
    if (lower === 'in' && /^\d+$/.test(words[i + 1] ?? '') && /^(day|days|week|weeks)$/i.test(words[i + 2] ?? '')) {
      const n = Number(words[i + 1]) * (/^week/i.test(words[i + 2]) ? 7 : 1)
      out.dueDate = addDays(ctx.today, n)
      out.summary.push(`In ${words[i + 1]} ${words[i + 2].toLowerCase()}`)
      i += 2
      continue
    }
    if (lower === 'every' || lower === 'daily' || lower === 'weekly' || lower === 'monthly' || lower === 'yearly') {
      const rec = parseRecurrence(words, i)
      if (rec) {
        out.recurrence = rec.value
        out.summary.push(rec.label)
        i += rec.consumed - 1
        continue
      }
    }
    if (DAY_NAMES[lower] !== undefined && !words.slice(0, i).some((p) => p.toLowerCase() === 'every')) {
      out.dueDate = nextWeekday(ctx.today, DAY_NAMES[lower])
      out.summary.push(w[0].toUpperCase() + lower.slice(1))
      continue
    }
    if (lower === 'at' && words[i + 1]) {
      const t = parseTime(words[i + 1])
      if (t) { out.dueTime = t; out.summary.push(t); i++; continue }
    }
    const bare = parseTime(lower)
    if (bare) { out.dueTime = bare; out.summary.push(bare); continue }

    keep.push(w)
  }

  out.title = keep.join(' ')
  // A time or a repeat without a date means "today" (a repeating task needs a date to start from).
  if (!out.dueDate && (out.dueTime || out.recurrence)) out.dueDate = ctx.today
  return out
}

function parseRecurrence(words: string[], i: number): { value: RecurrenceInput; label: string; consumed: number } | null {
  const w = words[i].toLowerCase()
  const single: Record<string, Frequency> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' }
  if (single[w]) return { value: { frequency: single[w], interval: 1 }, label: `Repeats ${w}`, consumed: 1 }

  const next = (words[i + 1] ?? '').toLowerCase()
  const units: Record<string, Frequency> = {
    day: 'Daily', days: 'Daily', week: 'Weekly', weeks: 'Weekly', month: 'Monthly', months: 'Monthly', year: 'Yearly', years: 'Yearly',
  }
  if (units[next]) return { value: { frequency: units[next], interval: 1 }, label: `Repeats every ${next}`, consumed: 2 }
  if (/^\d+$/.test(next) && units[(words[i + 2] ?? '').toLowerCase()]) {
    const unit = (words[i + 2] ?? '').toLowerCase()
    return { value: { frequency: units[unit], interval: Number(next) }, label: `Repeats every ${next} ${unit}`, consumed: 3 }
  }
  if (next === 'weekday') {
    return { value: { frequency: 'Weekly', interval: 1, weekdays: [1, 2, 3, 4, 5] }, label: 'Repeats every weekday', consumed: 2 }
  }
  if (DAY_NAMES[next] !== undefined) {
    return { value: { frequency: 'Weekly', interval: 1, weekdays: [DAY_NAMES[next]] }, label: `Repeats every ${next}`, consumed: 2 }
  }
  return null
}
