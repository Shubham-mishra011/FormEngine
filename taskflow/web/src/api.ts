export type Priority = 'Low' | 'Medium' | 'High' | 'Urgent'
export const PRIORITIES: Priority[] = ['Low', 'Medium', 'High', 'Urgent']
export type WorkStatus = 'Todo' | 'InProgress' | 'Done'
export const STATUS_LABEL: Record<WorkStatus, string> = { Todo: 'To Do', InProgress: 'In Progress', Done: 'Done' }
export type StatusFilter = 'all' | 'active' | 'completed' | 'overdue' | 'today' | 'upcoming' | 'inbox'
export type SortKey = 'created_desc' | 'due' | 'priority' | 'title' | 'updated_desc' | 'manual'
export type Frequency = 'Daily' | 'Weekly' | 'Monthly' | 'Yearly'

export interface Subtask {
  id: number
  taskId: number
  title: string
  isCompleted: boolean
  sortOrder: number
  createdAt: string
  completedAt: string | null
}

export interface TagRef {
  id: number
  name: string
  color: string
}

export interface Recurrence {
  id: number
  frequency: Frequency
  interval: number
  weekdays: number[] // 0 = Sunday … 6 = Saturday
  monthDays: number[] // 1–31, -1 = last day
  anchorDate: string
  endDate: string | null
  maxOccurrences: number | null
  occurrencesGenerated: number
  isActive: boolean
  nextDue: string | null
}

export interface RecurrenceInput {
  frequency: Frequency
  interval: number
  weekdays?: number[]
  monthDays?: number[]
  endDate?: string | null
  maxOccurrences?: number | null
}

export interface Reminder {
  id: number
  taskId: number
  minutesBefore: number | null
  remindAt: string
  notifiedAt: string | null
}

export interface ReminderInput {
  minutesBefore?: number
  at?: string
}

export interface Task {
  id: number
  title: string
  description: string | null
  notes: string | null
  isCompleted: boolean
  status: WorkStatus
  priority: Priority
  startDate: string | null // yyyy-MM-dd
  dueDate: string | null // yyyy-MM-dd
  dueTime: string | null // HH:mm:ss
  estimatedMinutes: number | null
  actualMinutes: number | null
  isPinned: boolean
  isFavorite: boolean
  sortOrder: number
  categoryId: number | null
  categoryName: string | null
  categoryColor: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  subtasks: Subtask[]
  subtaskTotal: number
  subtaskDone: number
  tags: TagRef[]
  recurrence: Recurrence | null
  occurrenceNumber: number
  reminders: Reminder[]
  attachmentCount: number
  focusSeconds: number
}

export interface TaskInput {
  title: string
  description?: string | null
  notes?: string | null
  priority: Priority
  startDate?: string | null
  dueDate?: string | null
  dueTime?: string | null
  estimatedMinutes?: number | null
  actualMinutes?: number | null
  categoryId?: number | null
  isCompleted?: boolean
  status?: WorkStatus
  isPinned?: boolean
  isFavorite?: boolean
  tagIds?: number[]
  recurrence?: RecurrenceInput | null
  reminders?: ReminderInput[]
}

export interface Category {
  id: number
  name: string
  color: string
  taskCount: number
}

export interface Tag {
  id: number
  name: string
  color: string
  taskCount: number
}

export interface Stats {
  total: number
  completed: number
  active: number
  overdue: number
  dueToday: number
  inbox: number
  upcoming: number
  inProgress: number
}

export interface Activity {
  id: number
  taskId: number
  taskTitle: string | null
  kind: string
  detail: string | null
  at: string
}

export interface Attachment {
  id: number
  taskId: number
  fileName: string
  contentType: string
  sizeBytes: number
  createdAt: string
}

export interface AppNotification {
  id: number
  taskId: number | null
  kind: 'Reminder' | 'Overdue' | 'System'
  title: string
  message: string | null
  createdAt: string
  readAt: string | null
}

export interface UpcomingReminder {
  reminderId: number
  taskId: number
  taskTitle: string
  remindAt: string
  minutesBefore: number | null
  dueDate: string | null
  dueTime: string | null
}

export type FocusKind = 'Focus' | 'ShortBreak' | 'LongBreak'

export interface FocusSession {
  id: number
  taskId: number | null
  taskTitle: string | null
  kind: FocusKind
  plannedSeconds: number
  actualSeconds: number
  completed: boolean
  startedAt: string
  endedAt: string
}

export interface FocusSessionInput {
  kind: FocusKind
  taskId: number | null
  plannedSeconds: number
  actualSeconds: number
  completed: boolean
  startedAt: string
  endedAt: string
}

export interface FocusStats {
  today: string
  todaySeconds: number
  todaySessions: number
  weekSeconds: number
  totalSeconds: number
  totalSessions: number
  currentStreak: number
  bestStreak: number
  averageSessionMinutes: number
  daily: { date: string; seconds: number; sessions: number }[]
  topTasks: { taskId: number; title: string; seconds: number; sessions: number }[]
}

export interface BulkResult {
  affected: number
  missing: number
}

export interface TaskQuery {
  status: StatusFilter
  q: string
  categoryId: number | null
  priority: Priority | null
  sort: SortKey
}

export interface Tally {
  add: number
  skip: number
}

export interface ImportSummary {
  valid: boolean
  errors: string[]
  warnings: string[]
  categories: Tally
  tasks: Tally
  subtasks: Tally
  tags?: Tally
  focusSessions?: Tally
}

export interface ImportResult {
  summary: ImportSummary
  safetyBackup: string | null
}

export interface RestoreResult {
  summary: ImportSummary
  safetyBackup: string
  tasksBefore: number
  tasksAfter: number
}

export interface BackupInfo {
  name: string
  sizeBytes: number
  createdAt: string
}

export interface About {
  name: string
  version: string
  databasePath: string
  backupDirectory: string
  attachmentsDirectory: string
  timeZone: string
  serverTimeUtc: string
  allowedAttachmentTypes: string
  maxAttachmentBytes: number
}

export interface PeriodPoint {
  start: string
  label: string
  created: number
  completed: number
}

export interface Analytics {
  today: string
  weekStart: string
  days: number
  completedToday: number
  completedThisWeek: number
  createdToday: number
  createdThisWeek: number
  total: number
  completed: number
  active: number
  overdue: number
  completionRate: number
  averageHoursToComplete: number | null
  daily: { date: string; created: number; completed: number }[]
  byPriority: { priority: Priority; total: number; completed: number }[]
  byCategory: { categoryId: number | null; name: string; color: string | null; total: number; completed: number }[]
  completedThisMonth?: number
  createdThisMonth?: number
  currentStreak?: number
  bestStreak?: number
  weekly?: PeriodPoint[]
  monthly?: PeriodPoint[]
  overdueDetail?: { count: number; oldestDays: number; byPriority: { priority: Priority; total: number }[] }
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
  } catch {
    throw new ApiError('Cannot reach the server. Is the API running?', 0)
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const body = await res.json()
      const first = body?.errors ? Object.values<string[]>(body.errors)[0]?.[0] : undefined
      message = first ?? body?.title ?? message
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, res.status)
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

export function buildTaskQuery(q: TaskQuery): string {
  const p = new URLSearchParams()
  if (q.status !== 'all') p.set('status', q.status)
  if (q.q.trim()) p.set('q', q.q.trim())
  if (q.categoryId !== null) p.set('categoryId', String(q.categoryId))
  if (q.priority) p.set('priority', q.priority)
  p.set('sort', q.sort)
  return `?${p}`
}

const json = (body: unknown) => JSON.stringify(body)

/** Import endpoints answer 400 with a structured summary; that body is the useful part, so return it. */
async function postImport<T>(path: string, text: string): Promise<{ ok: boolean; body: T }> {
  let res: Response
  try {
    res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text })
  } catch {
    throw new ApiError('Cannot reach the server. Is the API running?', 0)
  }
  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new ApiError(`Request failed (${res.status})`, res.status)
  }
  return { ok: res.ok, body: body as T }
}

export const exportUrls = { json: '/api/export', csv: '/api/export/tasks.csv' }
export const attachmentUrl = (id: number) => `/api/attachments/${id}`

export const api = {
  // ---- tasks
  listTasks: (q?: TaskQuery) => request<Task[]>(`/api/tasks${q ? buildTaskQuery(q) : ''}`),
  stats: () => request<Stats>('/api/tasks/stats'),
  getTask: (id: number) => request<Task>(`/api/tasks/${id}`),
  createTask: (t: TaskInput) => request<Task>('/api/tasks', { method: 'POST', body: json(t) }),
  updateTask: (id: number, t: TaskInput) => request<Task>(`/api/tasks/${id}`, { method: 'PUT', body: json(t) }),
  toggleTask: (id: number) => request<Task>(`/api/tasks/${id}/toggle`, { method: 'PATCH' }),
  setStatus: (id: number, status: WorkStatus, position?: number) =>
    request<Task>(`/api/tasks/${id}/status`, { method: 'PATCH', body: json({ status, position }) }),
  reschedule: (id: number, dueDate: string | null, dueTime?: string | null) =>
    request<Task>(`/api/tasks/${id}/reschedule`, { method: 'PATCH', body: json({ dueDate, dueTime }) }),
  setFlags: (id: number, flags: { isPinned?: boolean; isFavorite?: boolean }) =>
    request<Task>(`/api/tasks/${id}/flags`, { method: 'PATCH', body: json(flags) }),
  duplicateTask: (id: number) => request<Task>(`/api/tasks/${id}/duplicate`, { method: 'POST' }),
  deleteTask: (id: number) => request<void>(`/api/tasks/${id}`, { method: 'DELETE' }),
  clearCompleted: () => request<void>('/api/tasks/completed', { method: 'DELETE' }),
  stopRecurrence: (id: number) => request<Task>(`/api/tasks/${id}/recurrence/stop`, { method: 'POST' }),
  skipOccurrence: (id: number) => request<Task | undefined>(`/api/tasks/${id}/skip`, { method: 'POST' }),
  occurrences: (id: number) => request<Task[]>(`/api/tasks/${id}/occurrences`),
  taskActivity: (id: number) => request<Activity[]>(`/api/tasks/${id}/activity`),
  recentActivity: (limit = 30) => request<Activity[]>(`/api/activity?limit=${limit}`),
  bulk: (ids: number[], action: string, value?: unknown) =>
    request<BulkResult>('/api/tasks/bulk', { method: 'POST', body: json({ ids, action, value }) }),

  // ---- subtasks
  addSubtask: (taskId: number, title: string) =>
    request<Subtask>(`/api/tasks/${taskId}/subtasks`, { method: 'POST', body: json({ title }) }),
  updateSubtask: (id: number, title: string, isCompleted: boolean) =>
    request<Subtask>(`/api/subtasks/${id}`, { method: 'PUT', body: json({ title, isCompleted }) }),
  toggleSubtask: (id: number) => request<Subtask>(`/api/subtasks/${id}/toggle`, { method: 'PATCH' }),
  deleteSubtask: (id: number) => request<void>(`/api/subtasks/${id}`, { method: 'DELETE' }),

  // ---- categories & tags
  listCategories: () => request<Category[]>('/api/categories'),
  createCategory: (name: string, color: string) =>
    request<Category>('/api/categories', { method: 'POST', body: json({ name, color }) }),
  updateCategory: (id: number, name: string, color: string) =>
    request<Category>(`/api/categories/${id}`, { method: 'PUT', body: json({ name, color }) }),
  deleteCategory: (id: number) => request<void>(`/api/categories/${id}`, { method: 'DELETE' }),
  listTags: () => request<Tag[]>('/api/tags'),
  createTag: (name: string, color: string) => request<Tag>('/api/tags', { method: 'POST', body: json({ name, color }) }),
  updateTag: (id: number, name: string, color: string) =>
    request<Tag>(`/api/tags/${id}`, { method: 'PUT', body: json({ name, color }) }),
  deleteTag: (id: number) => request<void>(`/api/tags/${id}`, { method: 'DELETE' }),

  // ---- attachments
  listAttachments: (taskId: number) => request<Attachment[]>(`/api/tasks/${taskId}/attachments`),
  uploadAttachment: async (taskId: number, file: File): Promise<Attachment> => {
    const form = new FormData()
    form.append('file', file)
    let res: Response
    try {
      res = await fetch(`/api/tasks/${taskId}/attachments`, { method: 'POST', body: form })
    } catch {
      throw new ApiError('Cannot reach the server. Is the API running?', 0)
    }
    if (!res.ok) {
      let message = `Upload failed (${res.status})`
      try {
        const body = await res.json()
        message = (body?.errors ? Object.values<string[]>(body.errors)[0]?.[0] : undefined) ?? body?.title ?? message
      } catch {
        /* ignore */
      }
      throw new ApiError(message, res.status)
    }
    return (await res.json()) as Attachment
  },
  deleteAttachment: (id: number) => request<void>(`/api/attachments/${id}`, { method: 'DELETE' }),

  // ---- reminders & notifications
  syncNotifications: (overdue: boolean) =>
    request<{ created: number }>(`/api/notifications/sync?overdue=${overdue}`, { method: 'POST' }),
  listNotifications: () => request<{ items: AppNotification[]; unread: number }>('/api/notifications'),
  markNotificationRead: (id: number, read = true) =>
    request<AppNotification>(`/api/notifications/${id}/read?read=${read}`, { method: 'PATCH' }),
  markAllRead: () => request<{ updated: number }>('/api/notifications/read-all', { method: 'POST' }),
  dismissNotification: (id: number) => request<void>(`/api/notifications/${id}`, { method: 'DELETE' }),
  dismissAllNotifications: () => request<{ dismissed: number }>('/api/notifications', { method: 'DELETE' }),
  upcomingReminders: (days = 7) =>
    request<{ upcoming: UpcomingReminder[]; overdueTasks: Task[] }>(`/api/reminders/upcoming?days=${days}`),

  // ---- focus
  recordFocus: (s: FocusSessionInput) => request<FocusSession>('/api/focus/sessions', { method: 'POST', body: json(s) }),
  focusSessions: (days = 30, limit = 100) => request<FocusSession[]>(`/api/focus/sessions?days=${days}&limit=${limit}`),
  deleteFocusSession: (id: number) => request<void>(`/api/focus/sessions/${id}`, { method: 'DELETE' }),
  focusStats: (days = 14) => request<FocusStats>(`/api/focus/stats?days=${days}`),

  // ---- analytics, data, about
  analytics: (days: number) => request<Analytics>(`/api/analytics?days=${days}`),
  about: () => request<About>('/api/about'),
  previewImport: async (text: string) => (await postImport<ImportSummary>('/api/import/preview', text)).body,
  applyImport: async (text: string): Promise<ImportResult> => {
    const { ok, body } = await postImport<ImportResult | ImportSummary>('/api/import', text)
    if (!ok) throw new ApiError((body as ImportSummary).errors?.[0] ?? 'Import failed', 400)
    return body as ImportResult
  },
  listBackups: async (): Promise<{ backups: BackupInfo[]; folder: string | null }> => {
    let res: Response
    try {
      res = await fetch('/api/backups')
    } catch {
      throw new ApiError('Cannot reach the server. Is the API running?', 0)
    }
    if (!res.ok) throw new ApiError(`Could not list backups (${res.status})`, res.status)
    return { backups: (await res.json()) as BackupInfo[], folder: res.headers.get('X-Backup-Directory') }
  },
  createBackup: () => request<BackupInfo>('/api/backups', { method: 'POST' }),
  /** Raw JSON text of a stored backup, ready for previewImport / applyImport. */
  readBackup: async (name: string): Promise<string> => {
    let res: Response
    try {
      res = await fetch(`/api/backups/${encodeURIComponent(name)}/export`)
    } catch {
      throw new ApiError('Cannot reach the server. Is the API running?', 0)
    }
    if (!res.ok) throw new ApiError(res.status === 404 ? 'That backup no longer exists.' : 'That backup could not be read.', res.status)
    return res.text()
  },
  /** Replaces ALL data with the backup (a safety snapshot is taken first). */
  restoreBackup: (name: string) =>
    request<RestoreResult>(`/api/backups/${encodeURIComponent(name)}/restore?confirm=true`, { method: 'POST' }),
}
