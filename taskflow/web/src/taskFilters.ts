import type { Priority, SortKey, Task, WorkStatus } from './api'
import { todayString } from './dates'

export type View = 'all' | 'active' | 'completed' | 'overdue' | 'today' | 'upcoming' | 'inbox'

export interface Filters {
  view: View
  q: string
  categoryId: number | null
  priorities: Priority[]
  tagIds: number[]
  pinned: boolean
  favorite: boolean
  board: WorkStatus | null
  sort: SortKey
}

export const emptyFilters: Filters = {
  view: 'all',
  q: '',
  categoryId: null,
  priorities: [],
  tagIds: [],
  pinned: false,
  favorite: false,
  board: null,
  sort: 'created_desc',
}

export function isFiltered(f: Filters, baseView: View = 'all'): boolean {
  return (
    f.q !== '' || f.categoryId !== null || f.priorities.length > 0 || f.tagIds.length > 0 || f.pinned || f.favorite ||
    f.board !== null || f.view !== baseView
  )
}

const PRIORITY_RANK: Record<Priority, number> = { Low: 0, Medium: 1, High: 2, Urgent: 3 }

/** Mirrors the server's search: every word must match somewhere; "#tag" must equal a tag name. */
export function matchesQuery(t: Task, q: string): boolean {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)
  if (terms.length === 0) return true
  const hay = [
    t.title, t.description ?? '', t.notes ?? '', t.categoryName ?? '',
    ...t.tags.map((x) => x.name), ...t.subtasks.map((s) => s.title),
  ]
    .join('\n')
    .toLowerCase()
  return terms.every((term) =>
    term.length > 1 && term.startsWith('#')
      ? t.tags.some((x) => x.name.toLowerCase() === term.slice(1))
      : hay.includes(term),
  )
}

export function filterTasks(tasks: Task[], f: Filters, today = todayString()): Task[] {
  return tasks.filter((t) => {
    switch (f.view) {
      case 'active': if (t.isCompleted) return false; break
      case 'completed': if (!t.isCompleted) return false; break
      case 'overdue': if (t.isCompleted || !t.dueDate || t.dueDate >= today) return false; break
      case 'today': if (t.isCompleted || t.dueDate !== today) return false; break
      case 'upcoming': if (t.isCompleted || !t.dueDate || t.dueDate <= today) return false; break
      case 'inbox': if (t.isCompleted || t.categoryId !== null || t.dueDate !== null) return false; break
    }
    if (f.categoryId !== null && t.categoryId !== f.categoryId) return false
    if (f.priorities.length > 0 && !f.priorities.includes(t.priority)) return false
    if (f.tagIds.length > 0 && !t.tags.some((x) => f.tagIds.includes(x.id))) return false
    if (f.pinned && !t.isPinned) return false
    if (f.favorite && !t.isFavorite) return false
    if (f.board && t.status !== f.board) return false
    return matchesQuery(t, f.q)
  })
}

export function sortTasks(tasks: Task[], sort: SortKey, pinnedFirst = true): Task[] {
  const desc = sort.endsWith('_desc')
  const key = desc ? sort.slice(0, -5) : sort
  const dir = desc ? -1 : 1
  const cmp = (a: Task, b: Task): number => {
    switch (key) {
      case 'due':
        return (
          dir * ((a.dueDate ?? '9999-99-99').localeCompare(b.dueDate ?? '9999-99-99') ||
            (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99'))
        )
      case 'priority':
        return -dir * (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
      case 'title':
        return dir * a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
      case 'updated':
        return dir * a.updatedAt.localeCompare(b.updatedAt)
      case 'manual':
        return dir * (a.sortOrder - b.sortOrder)
      default:
        return dir * a.createdAt.localeCompare(b.createdAt)
    }
  }
  return [...tasks].sort((a, b) => (pinnedFirst ? Number(b.isPinned) - Number(a.isPinned) : 0) || cmp(a, b) || a.id - b.id)
}

export function applyFilters(tasks: Task[], f: Filters, today = todayString(), pinnedFirst = true): Task[] {
  return sortTasks(filterTasks(tasks, f, today), f.sort, pinnedFirst)
}
