import type {
  Activity, Analytics, AppNotification, Attachment, BackupInfo, Category, FocusSession, FocusStats, ImportSummary, Subtask, Tag, Task,
} from '../api'
import { todayString } from '../dates'

type Handler = (body: unknown, url: URL) => Response | Promise<Response> | undefined

export interface FakeOptions {
  tasks?: Task[]
  categories?: Category[]
  tags?: Tag[]
  backups?: BackupInfo[]
  analytics?: Analytics
  notifications?: AppNotification[]
  focusSessions?: FocusSession[]
  /** Decides what the import endpoints answer for a given file text. */
  importSummary?: (text: string) => ImportSummary
  backupFolder?: string
  /** Custom handlers run first; return a Response to take over a request. Keys are "METHOD /path" regexes. */
  handlers?: Record<string, Handler>
  /** Delay (resolved by the test) before toggle endpoints answer, to observe optimistic UI. */
  gate?: Promise<void>
}

export const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(status === 204 || body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

export const makeTask = (over: Partial<Task> & { id: number; title: string }): Task => ({
  description: null, notes: null, isCompleted: false, status: 'Todo', priority: 'Medium', startDate: null, dueDate: null,
  dueTime: null, estimatedMinutes: null, actualMinutes: null, isPinned: false, isFavorite: false, sortOrder: over.id,
  categoryId: null, categoryName: null, categoryColor: null, createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z', completedAt: null, subtasks: [], subtaskTotal: 0, subtaskDone: 0, tags: [],
  recurrence: null, occurrenceNumber: 1, reminders: [], attachmentCount: 0, focusSeconds: 0, ...over,
})

export const makeSub = (over: Partial<Subtask> & { id: number; taskId: number; title: string }): Subtask => ({
  isCompleted: false, sortOrder: over.id, createdAt: '2026-01-01T00:00:00Z', completedAt: null, ...over,
})

export const makeTag = (over: Partial<Tag> & { id: number; name: string }): Tag => ({ color: '#8b5cf6', taskCount: 0, ...over })

export const makeCategory = (over: Partial<Category> & { id: number; name: string }): Category => ({
  color: '#6366f1', taskCount: 0, ...over,
})

export const emptySummary = (over: Partial<ImportSummary> = {}): ImportSummary => ({
  valid: true, errors: [], warnings: [],
  categories: { add: 0, skip: 0 }, tasks: { add: 0, skip: 0 }, subtasks: { add: 0, skip: 0 },
  tags: { add: 0, skip: 0 }, focusSessions: { add: 0, skip: 0 }, ...over,
})

export const sampleAnalytics = (over: Partial<Analytics> = {}): Analytics => ({
  today: '2026-10-21', weekStart: '2026-10-19', days: 30,
  completedToday: 2, completedThisWeek: 5, createdToday: 1, createdThisWeek: 4,
  total: 10, completed: 6, active: 4, overdue: 1, completionRate: 0.6, averageHoursToComplete: 5,
  daily: Array.from({ length: 30 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 8, 22 + i)).toISOString().slice(0, 10), created: i % 3, completed: i % 4,
  })),
  byPriority: [
    { priority: 'Urgent', total: 1, completed: 0 },
    { priority: 'High', total: 4, completed: 3 },
    { priority: 'Medium', total: 4, completed: 2 },
    { priority: 'Low', total: 2, completed: 1 },
  ],
  byCategory: [
    { categoryId: 1, name: 'Work', color: '#aa0000', total: 6, completed: 4 },
    { categoryId: null, name: 'Uncategorised', color: null, total: 4, completed: 2 },
  ],
  completedThisMonth: 12, createdThisMonth: 15, currentStreak: 3, bestStreak: 7,
  weekly: Array.from({ length: 12 }, (_, i) => ({ start: `2026-0${(i % 9) + 1}-01`, label: `W${i + 1}`, created: i + 1, completed: i })),
  monthly: Array.from({ length: 12 }, (_, i) => ({ start: `2026-${String(i + 1).padStart(2, '0')}-01`, label: `M${i + 1}`, created: 5 + i, completed: 3 + i })),
  overdueDetail: { count: 1, oldestDays: 4, byPriority: [{ priority: 'High', total: 1 }] },
  ...over,
})

export const sampleFocusStats = (over: Partial<FocusStats> = {}): FocusStats => ({
  today: todayString(), todaySeconds: 3000, todaySessions: 2, weekSeconds: 9000, totalSeconds: 30000, totalSessions: 20,
  currentStreak: 2, bestStreak: 5, averageSessionMinutes: 24.5,
  daily: Array.from({ length: 14 }, (_, i) => ({ date: `2026-10-${String(8 + i).padStart(2, '0')}`, seconds: i * 100, sessions: i % 3 })),
  topTasks: [], ...over,
})

/**
 * In-memory stand-in for the API that speaks the same HTTP contract and mimics the server's rules closely
 * enough for UI tests (completion/board invariant, stats, tags, bulk, recurrence is not simulated).
 * Records every call.
 */
export function installFakeServer(opts: FakeOptions = {}) {
  let tasks = structuredClone(opts.tasks ?? [])
  let categories = structuredClone(opts.categories ?? [])
  let tags = structuredClone(opts.tags ?? [])
  let backups = structuredClone(opts.backups ?? [])
  let notifications = structuredClone(opts.notifications ?? [])
  let sessions = structuredClone(opts.focusSessions ?? [])
  const attachments: Attachment[] = []
  const activity: Activity[] = []
  let nextId = Math.max(100, ...tasks.map((t) => t.id + 1))
  let nextSub = 1000
  let nextOther = 500
  const calls: string[] = []
  const bodies: Record<string, unknown[]> = {}

  const recount = (t: Task) => {
    t.subtaskTotal = t.subtasks.length
    t.subtaskDone = t.subtasks.filter((s) => s.isCompleted).length
  }
  const findSub = (id: number) => {
    for (const t of tasks) {
      const s = t.subtasks.find((x) => x.id === id)
      if (s) return { t, s }
    }
    return null
  }
  const now = () => new Date().toISOString()
  const log = (taskId: number, kind: string, detail: string | null = null) =>
    activity.unshift({ id: nextOther++, taskId, taskTitle: tasks.find((t) => t.id === taskId)?.title ?? null, kind, detail, at: now() })

  /** The invariant the server enforces: Done <=> completed. */
  const setStatus = (t: Task, status: Task['status']) => {
    t.status = status
    t.isCompleted = status === 'Done'
    t.completedAt = status === 'Done' ? (t.completedAt ?? now()) : null
    t.updatedAt = now()
  }
  const fillTags = (ids: number[] | undefined) =>
    (ids ?? []).map((id) => tags.find((g) => g.id === id)).filter(Boolean).map((g) => ({ id: g!.id, name: g!.name, color: g!.color }))
  const withCategory = (t: Task) => {
    const c = categories.find((x) => x.id === t.categoryId)
    t.categoryName = c?.name ?? null
    t.categoryColor = c?.color ?? null
  }
  const apply = (t: Task, b: Record<string, unknown>) => {
    const s = (k: string) => (b[k] === undefined ? undefined : b[k])
    t.title = String(b.title ?? t.title).trim()
    t.description = (s('description') as string | null) ?? null
    t.notes = (s('notes') as string | null) ?? null
    t.priority = (b.priority as Task['priority']) ?? t.priority
    t.startDate = (s('startDate') as string | null) ?? null
    t.dueDate = (s('dueDate') as string | null) ?? null
    t.dueTime = b.dueTime ? `${String(b.dueTime).slice(0, 5)}:00` : null
    t.estimatedMinutes = (s('estimatedMinutes') as number | null) ?? null
    t.actualMinutes = (s('actualMinutes') as number | null) ?? null
    t.categoryId = (s('categoryId') as number | null) ?? null
    if (typeof b.isPinned === 'boolean') t.isPinned = b.isPinned
    if (typeof b.isFavorite === 'boolean') t.isFavorite = b.isFavorite
    if (Array.isArray(b.tagIds)) t.tags = fillTags(b.tagIds as number[])
    if (Array.isArray(b.reminders))
      t.reminders = (b.reminders as { minutesBefore?: number; at?: string }[]).map((r, i) => ({
        id: nextOther++ + i, taskId: t.id, minutesBefore: r.minutesBefore ?? null, remindAt: r.at ?? '2026-12-31T00:00:00Z', notifiedAt: null,
      }))
    if (b.recurrence) {
      const r = b.recurrence as Record<string, unknown>
      t.recurrence = {
        id: t.recurrence?.id ?? nextOther++, frequency: r.frequency as never, interval: Number(r.interval ?? 1),
        weekdays: (r.weekdays as number[]) ?? [], monthDays: (r.monthDays as number[]) ?? [],
        anchorDate: t.dueDate ?? todayString(), endDate: (r.endDate as string | null) ?? null,
        maxOccurrences: (r.maxOccurrences as number | null) ?? null, occurrencesGenerated: 1, isActive: true, nextDue: null,
      }
    }
    const target = (b.status as Task['status'] | undefined) ?? (b.isCompleted ? 'Done' : t.isCompleted ? 'Todo' : t.status)
    setStatus(t, target)
    withCategory(t)
  }

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://x')
    const method = init?.method ?? 'GET'
    const raw = typeof init?.body === 'string' ? init.body : undefined
    let body: unknown
    try {
      body = raw ? JSON.parse(raw) : undefined
    } catch {
      body = raw
    }
    const key = `${method} ${url.pathname}`
    calls.push(`${key}${url.search}`)
    ;(bodies[key] ??= []).push(raw ?? body)

    for (const [pattern, handler] of Object.entries(opts.handlers ?? {})) {
      const re = new RegExp(`^${pattern}$`)
      if (re.test(key)) {
        const r = await handler(body, url)
        if (r) return r
      }
    }

    const p = url.pathname
    const b = (body ?? {}) as Record<string, unknown>
    const today = todayString()

    // ---- tasks
    if (p === '/api/tasks/stats') {
      const open = tasks.filter((t) => !t.isCompleted)
      return reply({
        total: tasks.length, completed: tasks.length - open.length, active: open.length,
        overdue: open.filter((t) => t.dueDate && t.dueDate < today).length,
        dueToday: open.filter((t) => t.dueDate === today).length,
        inbox: open.filter((t) => !t.categoryId && !t.dueDate).length,
        upcoming: open.filter((t) => t.dueDate && t.dueDate > today).length,
        inProgress: tasks.filter((t) => t.status === 'InProgress').length,
      })
    }
    if (p === '/api/tasks' && method === 'GET') return reply(tasks)
    if (p === '/api/tasks' && method === 'POST') {
      const title = String(b.title ?? '').trim()
      if (!title) return reply({ errors: { Title: ['Title is required.'] } }, 400)
      const t = makeTask({ id: nextId++, title, createdAt: now(), updatedAt: now() })
      apply(t, b)
      tasks = [...tasks, t]
      log(t.id, 'Created')
      return reply(t, 201)
    }
    if (p === '/api/tasks/completed' && method === 'DELETE') {
      tasks = tasks.filter((t) => !t.isCompleted)
      return reply(null, 204)
    }
    if (p === '/api/tasks/bulk' && method === 'POST') {
      const ids = (b.ids as number[]) ?? []
      const hit = tasks.filter((t) => ids.includes(t.id))
      for (const t of hit) {
        switch (b.action) {
          case 'complete': setStatus(t, 'Done'); break
          case 'reopen': setStatus(t, 'Todo'); break
          case 'priority': t.priority = b.value as Task['priority']; break
          case 'category': t.categoryId = (b.value as number | null) ?? null; withCategory(t); break
          case 'addTag': if (!t.tags.some((g) => g.id === b.value)) t.tags = [...t.tags, ...fillTags([b.value as number])]; break
          case 'removeTag': t.tags = t.tags.filter((g) => g.id !== b.value); break
          case 'pin': t.isPinned = true; break
          case 'unpin': t.isPinned = false; break
          case 'status': setStatus(t, b.value as Task['status']); break
          case 'dueDate': t.dueDate = (b.value as string | null) ?? null; break
        }
      }
      if (b.action === 'delete') tasks = tasks.filter((t) => !ids.includes(t.id))
      return reply({ affected: hit.length, missing: ids.length - hit.length })
    }
    let m = p.match(/^\/api\/tasks\/(\d+)$/)
    if (m) {
      const t = tasks.find((x) => x.id === Number(m![1]))
      if (!t) return reply({ title: 'Not found.' }, 404)
      if (method === 'GET') return reply(t)
      if (method === 'PUT') {
        if (!String(b.title ?? '').trim()) return reply({ errors: { Title: ['Title is required.'] } }, 400)
        apply(t, b)
        log(t.id, 'Updated')
        return reply(t)
      }
      if (method === 'DELETE') {
        tasks = tasks.filter((x) => x.id !== t.id)
        return reply(null, 204)
      }
    }
    m = p.match(/^\/api\/tasks\/(\d+)\/(toggle|status|reschedule|flags|duplicate|activity|occurrences)$/)
    if (m) {
      const t = tasks.find((x) => x.id === Number(m![1]))
      if (!t) return reply({ title: 'Not found.' }, 404)
      switch (m[2]) {
        case 'toggle':
          if (opts.gate) await opts.gate
          setStatus(t, t.isCompleted ? 'Todo' : 'Done')
          log(t.id, t.isCompleted ? 'Completed' : 'Reopened')
          return reply(t)
        case 'status': {
          if (opts.gate) await opts.gate
          setStatus(t, b.status as Task['status'])
          if (typeof b.position === 'number') {
            const col = tasks.filter((x) => x.status === t.status && x.id !== t.id).sort((x, y) => x.sortOrder - y.sortOrder)
            col.splice(b.position, 0, t)
            col.forEach((x, i) => (x.sortOrder = i))
          }
          return reply(t)
        }
        case 'reschedule':
          t.dueDate = (b.dueDate as string | null) ?? null
          if (!t.dueDate) t.dueTime = null
          else if (b.dueTime) t.dueTime = String(b.dueTime)
          log(t.id, 'Rescheduled')
          return reply(t)
        case 'flags':
          if (typeof b.isPinned === 'boolean') t.isPinned = b.isPinned
          if (typeof b.isFavorite === 'boolean') t.isFavorite = b.isFavorite
          return reply(t)
        case 'duplicate': {
          const copy = structuredClone(t)
          copy.id = nextId++
          copy.title = `${t.title} (copy)`
          copy.isCompleted = false
          copy.status = 'Todo'
          copy.isPinned = false
          copy.recurrence = null
          copy.subtasks = copy.subtasks.map((s) => ({ ...s, id: nextSub++, isCompleted: false }))
          tasks = [...tasks, copy]
          return reply(copy, 201)
        }
        case 'activity':
          return reply(activity.filter((a) => a.taskId === t.id))
        case 'occurrences':
          return reply([t])
      }
    }
    m = p.match(/^\/api\/tasks\/(\d+)\/recurrence\/stop$/)
    if (m) {
      const t = tasks.find((x) => x.id === Number(m![1]))
      if (!t?.recurrence) return reply({ errors: { Recurrence: ['This task does not repeat.'] } }, 400)
      t.recurrence.isActive = false
      return reply(t)
    }
    if (p === '/api/activity') return reply(activity.slice(0, Number(url.searchParams.get('limit') ?? 30)))

    // ---- subtasks
    m = p.match(/^\/api\/tasks\/(\d+)\/subtasks$/)
    if (m && method === 'POST') {
      const t = tasks.find((x) => x.id === Number(m![1]))
      if (!t) return reply({ title: 'Task not found.' }, 404)
      const s = makeSub({ id: nextSub++, taskId: t.id, title: (body as { title: string }).title })
      t.subtasks.push(s)
      recount(t)
      return reply(s, 201)
    }
    m = p.match(/^\/api\/subtasks\/(\d+)(\/toggle)?$/)
    if (m) {
      const hit = findSub(Number(m[1]))
      if (!hit) return reply({ title: 'not found' }, 404)
      if (m[2]) {
        if (opts.gate) await opts.gate
        hit.s.isCompleted = !hit.s.isCompleted
      } else if (method === 'PUT') {
        Object.assign(hit.s, { title: (body as { title: string }).title, isCompleted: (body as { isCompleted: boolean }).isCompleted })
      } else if (method === 'DELETE') {
        hit.t.subtasks = hit.t.subtasks.filter((x) => x.id !== hit.s.id)
      }
      recount(hit.t)
      return method === 'DELETE' ? reply(null, 204) : reply(hit.s)
    }

    // ---- categories & tags
    const crud = <T extends { id: number; name: string; color: string; taskCount: number }>(
      list: T[], set: (l: T[]) => void, base: string, label: string, countOf: (id: number) => number,
    ): Response | undefined => {
      if (p === base && method === 'GET') return reply(list.map((x) => ({ ...x, taskCount: countOf(x.id) })))
      if (p === base && method === 'POST') {
        const name = String(b.name ?? '').trim()
        if (!name) return reply({ errors: { Name: ['Name is required.'] } }, 400)
        if (list.some((x) => x.name.toLowerCase() === name.toLowerCase())) return reply({ title: `A ${label} with that name already exists.` }, 409)
        const item = { id: nextOther++, name, color: String(b.color ?? '#6366f1'), taskCount: 0 } as T
        set([...list, item])
        return reply(item, 201)
      }
      const mm = p.match(new RegExp(`^${base}/(\\d+)$`))
      if (mm) {
        const item = list.find((x) => x.id === Number(mm[1]))
        if (!item) return reply({ title: 'Not found.' }, 404)
        if (method === 'PUT') {
          const name = String(b.name ?? '').trim()
          if (list.some((x) => x.id !== item.id && x.name.toLowerCase() === name.toLowerCase())) return reply({ title: `A ${label} with that name already exists.` }, 409)
          item.name = name
          item.color = String(b.color ?? item.color)
          return reply(item)
        }
        if (method === 'DELETE') {
          set(list.filter((x) => x.id !== item.id))
          return reply(null, 204)
        }
      }
      return undefined
    }
    const c1 = crud(categories, (l) => (categories = l), '/api/categories', 'category', (id) => tasks.filter((t) => t.categoryId === id).length)
    if (c1) {
      if (method === 'DELETE') tasks.forEach((t) => { if (!categories.some((c) => c.id === t.categoryId)) { t.categoryId = null; withCategory(t) } })
      return c1
    }
    const c2 = crud(tags, (l) => (tags = l), '/api/tags', 'tag', (id) => tasks.filter((t) => t.tags.some((g) => g.id === id)).length)
    if (c2) {
      if (method === 'DELETE') tasks.forEach((t) => (t.tags = t.tags.filter((g) => tags.some((x) => x.id === g.id))))
      if (method === 'PUT') tasks.forEach((t) => (t.tags = t.tags.map((g) => { const f = tags.find((x) => x.id === g.id); return f ? { ...g, name: f.name, color: f.color } : g })))
      return c2
    }

    // ---- attachments
    m = p.match(/^\/api\/tasks\/(\d+)\/attachments$/)
    if (m) {
      const id = Number(m[1])
      if (method === 'GET') return reply(attachments.filter((a) => a.taskId === id))
      if (method === 'POST') {
        const a: Attachment = { id: nextOther++, taskId: id, fileName: 'upload.txt', contentType: 'text/plain', sizeBytes: 5, createdAt: now() }
        attachments.push(a)
        const t = tasks.find((x) => x.id === id)
        if (t) t.attachmentCount++
        return reply(a, 201)
      }
    }
    m = p.match(/^\/api\/attachments\/(\d+)$/)
    if (m && method === 'DELETE') {
      const i = attachments.findIndex((a) => a.id === Number(m![1]))
      if (i >= 0) {
        const [a] = attachments.splice(i, 1)
        const t = tasks.find((x) => x.id === a.taskId)
        if (t) t.attachmentCount--
      }
      return reply(null, 204)
    }

    // ---- notifications, reminders, focus
    if (p === '/api/notifications/sync') return reply({ created: 0 })
    if (p === '/api/notifications' && method === 'GET') {
      const items = notifications.filter((n) => !(n as AppNotification & { dismissed?: boolean }).dismissed)
      return reply({ items, unread: items.filter((n) => !n.readAt).length })
    }
    if (p === '/api/notifications' && method === 'DELETE') {
      notifications = []
      return reply({ dismissed: 0 })
    }
    if (p === '/api/notifications/read-all') {
      notifications.forEach((n) => (n.readAt ??= now()))
      return reply({ updated: 0 })
    }
    m = p.match(/^\/api\/notifications\/(\d+)(\/read)?$/)
    if (m) {
      const n = notifications.find((x) => x.id === Number(m![1]))
      if (!n) return reply({ title: 'Not found.' }, 404)
      if (m[2]) {
        n.readAt = url.searchParams.get('read') === 'false' ? null : now()
        return reply(n)
      }
      notifications = notifications.filter((x) => x.id !== n.id)
      return reply(null, 204)
    }
    if (p === '/api/reminders/upcoming') return reply({ upcoming: [], overdueTasks: tasks.filter((t) => !t.isCompleted && t.dueDate && t.dueDate < today) })
    if (p === '/api/focus/sessions' && method === 'GET') return reply(sessions)
    if (p === '/api/focus/sessions' && method === 'POST') {
      const s = { id: nextOther++, taskTitle: tasks.find((t) => t.id === b.taskId)?.title ?? null, ...b } as unknown as FocusSession
      sessions = [s, ...sessions]
      return reply(s, 201)
    }
    m = p.match(/^\/api\/focus\/sessions\/(\d+)$/)
    if (m && method === 'DELETE') {
      sessions = sessions.filter((s) => s.id !== Number(m![1]))
      return reply(null, 204)
    }
    if (p === '/api/focus/stats') return reply(sampleFocusStats())

    // ---- analytics, about, data
    if (p === '/api/analytics') return reply(opts.analytics ?? sampleAnalytics({ days: Number(url.searchParams.get('days')) }))
    if (p === '/api/about') {
      return reply({
        name: 'TaskFlow', version: '1.0.0', databasePath: 'E:\\FormEngine\\data\\taskflow.db',
        backupDirectory: opts.backupFolder ?? 'E:\\FormEngine\\data\\backups', attachmentsDirectory: 'E:\\FormEngine\\data\\attachments',
        timeZone: 'UTC', serverTimeUtc: now(), allowedAttachmentTypes: '.pdf, .png, .txt', maxAttachmentBytes: 10485760,
      })
    }
    if (p === '/api/import/preview' && method === 'POST') {
      const s = opts.importSummary?.(raw ?? '') ?? emptySummary()
      return reply(s, s.valid ? 200 : 400)
    }
    if (p === '/api/import' && method === 'POST') {
      const s = opts.importSummary?.(raw ?? '') ?? emptySummary()
      if (!s.valid) return reply(s, 400)
      return reply({ summary: s, safetyBackup: s.tasks.add > 0 ? 'taskflow-pre-import-20261021-120000.db' : null })
    }
    if (p === '/api/backups' && method === 'GET') {
      return reply(backups, 200, { 'X-Backup-Directory': opts.backupFolder ?? 'E:\\FormEngine\\data\\backups' })
    }
    if (p === '/api/backups' && method === 'POST') {
      const info: BackupInfo = { name: `taskflow-backup-2026102${backups.length}-120000.db`, sizeBytes: 53248, createdAt: '2026-10-21T12:00:00Z' }
      backups = [info, ...backups]
      return reply(info, 201)
    }
    m = p.match(/^\/api\/backups\/([^/]+)\/export$/)
    if (m) {
      return backups.some((b2) => b2.name === decodeURIComponent(m![1]))
        ? reply({ schema: 'taskflow-export', version: 2, categories: [], tasks: [] })
        : reply({ title: 'No such backup.' }, 404)
    }
    m = p.match(/^\/api\/backups\/([^/]+)\/restore$/)
    if (m && method === 'POST') {
      if (!backups.some((b2) => b2.name === decodeURIComponent(m![1]))) return reply({ title: 'No such backup.' }, 404)
      const before = tasks.length
      return reply({
        summary: emptySummary(), safetyBackup: 'taskflow-pre-restore-20261021-120000.db', tasksBefore: before, tasksAfter: before,
      })
    }
    return reply({ title: 'not found' }, 404)
  })

  vi.stubGlobal('fetch', fetchMock)
  return {
    calls,
    bodies,
    fetchMock,
    getTasks: () => tasks,
    setTasks: (t: Task[]) => (tasks = t),
    getTags: () => tags,
    getNotifications: () => notifications,
  }
}
