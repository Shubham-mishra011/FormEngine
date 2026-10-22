export type Priority = 'Low' | 'Medium' | 'High'
export type StatusFilter = 'all' | 'active' | 'completed' | 'overdue' | 'today'
export type SortKey = 'created_desc' | 'due' | 'priority' | 'title'

export interface Task {
  id: number
  title: string
  notes: string | null
  isCompleted: boolean
  priority: Priority
  dueDate: string | null // yyyy-MM-dd
  categoryId: number | null
  categoryName: string | null
  categoryColor: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface TaskInput {
  title: string
  notes?: string | null
  priority: Priority
  dueDate?: string | null
  categoryId?: number | null
  isCompleted?: boolean
}

export interface Category {
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
}

export interface TaskQuery {
  status: StatusFilter
  q: string
  categoryId: number | null
  priority: Priority | null
  sort: SortKey
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

export const api = {
  listTasks: (q: TaskQuery) => request<Task[]>(`/api/tasks${buildTaskQuery(q)}`),
  stats: () => request<Stats>('/api/tasks/stats'),
  createTask: (t: TaskInput) => request<Task>('/api/tasks', { method: 'POST', body: json(t) }),
  updateTask: (id: number, t: TaskInput) =>
    request<Task>(`/api/tasks/${id}`, { method: 'PUT', body: json(t) }),
  toggleTask: (id: number) => request<Task>(`/api/tasks/${id}/toggle`, { method: 'PATCH' }),
  deleteTask: (id: number) => request<void>(`/api/tasks/${id}`, { method: 'DELETE' }),
  clearCompleted: () => request<void>('/api/tasks/completed', { method: 'DELETE' }),
  listCategories: () => request<Category[]>('/api/categories'),
  createCategory: (name: string, color: string) =>
    request<Category>('/api/categories', { method: 'POST', body: json({ name, color }) }),
  deleteCategory: (id: number) => request<void>(`/api/categories/${id}`, { method: 'DELETE' }),
}
