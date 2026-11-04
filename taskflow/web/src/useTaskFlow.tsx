import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, type Category, type Stats, type Tag, type Task, type TaskInput, type WorkStatus } from './api'
import { todayString } from './dates'

const messageOf = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong')

/** null means success; a string is the error message (also shown by the global banner unless `inline`). */
type Result = Promise<string | null>

export interface TaskFlowStore {
  tasks: Task[]
  categories: Category[]
  tags: Tag[]
  stats: Stats | null
  loading: boolean
  error: string | null
  dismissError: () => void
  reload: () => Promise<void>
  createTask: (t: TaskInput) => Result
  updateTask: (id: number, t: TaskInput) => Result
  toggleTask: (id: number) => Result
  setStatus: (id: number, status: WorkStatus, position?: number) => Result
  reschedule: (id: number, dueDate: string | null, dueTime?: string | null) => Result
  setFlags: (id: number, flags: { isPinned?: boolean; isFavorite?: boolean }) => Result
  duplicateTask: (id: number) => Result
  deleteTask: (id: number) => Result
  clearCompleted: () => Result
  bulk: (ids: number[], action: string, value?: unknown) => Result
  stopRecurrence: (id: number) => Result
  skipOccurrence: (id: number) => Result
  addSubtask: (taskId: number, title: string) => Result
  renameSubtask: (id: number, title: string, done: boolean) => Result
  deleteSubtask: (id: number) => Result
  toggleSubtask: (id: number) => Result
  createCategory: (name: string, color: string) => Result
  updateCategory: (id: number, name: string, color: string) => Result
  deleteCategory: (id: number) => Result
  createTag: (name: string, color: string) => Result
  updateTag: (id: number, name: string, color: string) => Result
  deleteTag: (id: number) => Result
}

const Ctx = createContext<TaskFlowStore | null>(null)

/**
 * Loads every task once and keeps it in memory; pages filter and sort client-side with `taskFilters`.
 * That keeps every view (list, calendar, board, dashboard) consistent with one source of truth and makes search
 * and filter changes instant. The server still supports the same filters for other clients.
 */
export function TaskFlowProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(0)

  const refresh = useCallback(async () => {
    const ticket = ++latest.current // ignore out-of-order responses
    try {
      const [t, c, g, s] = await Promise.all([api.listTasks(), api.listCategories(), api.listTags(), api.stats()])
      if (ticket !== latest.current) return
      setTasks(t)
      setCategories(c)
      setTags(g)
      setStats(s)
      setError(null)
    } catch (e) {
      if (ticket === latest.current) setError(messageOf(e))
    } finally {
      if (ticket === latest.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Another tab (or an import/restore elsewhere) may have changed the data: reload when this tab is shown again.
  useEffect(() => {
    let last = Date.now()
    const onShow = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 5000) return
      last = Date.now()
      void refresh()
    }
    document.addEventListener('visibilitychange', onShow)
    window.addEventListener('focus', onShow)
    return () => {
      document.removeEventListener('visibilitychange', onShow)
      window.removeEventListener('focus', onShow)
    }
  }, [refresh])

  /** Runs a mutation, then reloads. Returns an error message instead of throwing. */
  const mutate = useCallback(
    async (fn: () => Promise<unknown>, inline = false): Promise<string | null> => {
      // Anything fetched before this change is already out of date; invalidating it stops a slow, older
      // response from landing later and undoing an optimistic update.
      latest.current += 1
      try {
        await fn()
        await refresh()
        return null
      } catch (e) {
        const msg = messageOf(e)
        if (!inline) setError(msg)
        setLoading(false)
        return msg
      }
    },
    [refresh],
  )

  /** Applies a local change immediately and rolls it back if the server refuses. */
  const optimistic = useCallback(
    async (patch: (t: Task) => Task, id: number, call: () => Promise<unknown>): Promise<string | null> => {
      const before = tasks.find((t) => t.id === id)
      setTasks((ts) => ts.map((t) => (t.id === id ? patch(t) : t)))
      const err = await mutate(call)
      if (err && before) setTasks((ts) => ts.map((t) => (t.id === id ? before : t)))
      return err
    },
    [mutate, tasks],
  )

  const store = useMemo<TaskFlowStore>(
    () => ({
      tasks, categories, tags, stats, loading, error,
      dismissError: () => setError(null),
      reload: refresh,
      createTask: (t) => mutate(() => api.createTask(t), true),
      updateTask: (id, t) => mutate(() => api.updateTask(id, t), true),
      toggleTask: (id) =>
        optimistic(
          (t) => ({ ...t, isCompleted: !t.isCompleted, status: t.isCompleted ? 'Todo' : 'Done' }),
          id,
          () => api.toggleTask(id),
        ),
      setStatus: (id, status, position) =>
        optimistic((t) => ({ ...t, status, isCompleted: status === 'Done' }), id, () => api.setStatus(id, status, position)),
      reschedule: (id, dueDate, dueTime) =>
        optimistic((t) => ({ ...t, dueDate, dueTime: dueDate ? (dueTime ?? t.dueTime) : null }), id, () =>
          api.reschedule(id, dueDate, dueTime),
        ),
      setFlags: (id, flags) => optimistic((t) => ({ ...t, ...flags }), id, () => api.setFlags(id, flags)),
      duplicateTask: (id) => mutate(() => api.duplicateTask(id)),
      deleteTask: (id) => mutate(() => api.deleteTask(id)),
      clearCompleted: () => mutate(() => api.clearCompleted()),
      bulk: (ids, action, value) => mutate(() => api.bulk(ids, action, value)),
      stopRecurrence: (id) => mutate(() => api.stopRecurrence(id), true),
      skipOccurrence: (id) => mutate(() => api.skipOccurrence(id)),
      addSubtask: (taskId, title) => mutate(() => api.addSubtask(taskId, title), true),
      renameSubtask: (id, title, done) => mutate(() => api.updateSubtask(id, title, done), true),
      deleteSubtask: (id) => mutate(() => api.deleteSubtask(id)),
      // Optimistic like task toggles: flip the checkbox and progress now, undo if the server refuses.
      toggleSubtask: async (id) => {
        const flip = () =>
          setTasks((ts) =>
            ts.map((t) => {
              if (!t.subtasks.some((s) => s.id === id)) return t
              const subtasks = t.subtasks.map((s) => (s.id === id ? { ...s, isCompleted: !s.isCompleted } : s))
              return { ...t, subtasks, subtaskDone: subtasks.filter((s) => s.isCompleted).length }
            }),
          )
        flip()
        const err = await mutate(() => api.toggleSubtask(id))
        if (err) flip()
        return err
      },
      createCategory: (name, color) => mutate(() => api.createCategory(name, color), true),
      updateCategory: (id, name, color) => mutate(() => api.updateCategory(id, name, color), true),
      deleteCategory: (id) => mutate(() => api.deleteCategory(id)),
      createTag: (name, color) => mutate(() => api.createTag(name, color), true),
      updateTag: (id, name, color) => mutate(() => api.updateTag(id, name, color), true),
      deleteTag: (id) => mutate(() => api.deleteTag(id)),
    }),
    [tasks, categories, tags, stats, loading, error, refresh, mutate, optimistic],
  )

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}

export function useTaskFlow(): TaskFlowStore {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTaskFlow must be used inside <TaskFlowProvider>')
  return ctx
}

/** Today's date, refreshed when the tab becomes visible again so "Today" never goes stale overnight. */
export function useToday(): string {
  const [today, setToday] = useState(todayString())
  useEffect(() => {
    const update = () => setToday(todayString())
    document.addEventListener('visibilitychange', update)
    const id = setInterval(update, 60_000)
    return () => {
      document.removeEventListener('visibilitychange', update)
      clearInterval(id)
    }
  }, [])
  return today
}
