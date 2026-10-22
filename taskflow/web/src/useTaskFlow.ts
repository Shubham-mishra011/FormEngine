import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Category, type Stats, type Task, type TaskInput, type TaskQuery } from './api'

export const defaultQuery: TaskQuery = {
  status: 'all',
  q: '',
  categoryId: null,
  priority: null,
  sort: 'created_desc',
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong')

export function useTaskFlow() {
  const [query, setQuery] = useState<TaskQuery>(defaultQuery)
  const [tasks, setTasks] = useState<Task[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(0)

  const refresh = useCallback(async (q: TaskQuery) => {
    const ticket = ++latest.current // ignore out-of-order responses (e.g. fast typing in search)
    try {
      const [t, c, s] = await Promise.all([api.listTasks(q), api.listCategories(), api.stats()])
      if (ticket !== latest.current) return
      setTasks(t)
      setCategories(c)
      setStats(s)
      setError(null)
    } catch (e) {
      if (ticket === latest.current) setError(messageOf(e))
    } finally {
      if (ticket === latest.current) setLoading(false)
    }
  }, [])

  // Debounce only the free-text search; other filter changes apply immediately.
  useEffect(() => {
    const id = setTimeout(() => void refresh(query), query.q ? 250 : 0)
    return () => clearTimeout(id)
  }, [query, refresh])

  /**
   * Runs a mutation, then reloads. Returns an error message instead of throwing.
   * Form-driven callers show the message inline (`inline: true`); others use the global banner.
   */
  const mutate = useCallback(
    async (fn: () => Promise<unknown>, inline = false): Promise<string | null> => {
      try {
        await fn()
        await refresh(query)
        return null
      } catch (e) {
        const msg = messageOf(e)
        if (!inline) setError(msg)
        return msg
      }
    },
    [query, refresh],
  )

  return {
    query,
    setQuery,
    tasks,
    categories,
    stats,
    loading,
    error,
    dismissError: () => setError(null),
    reload: () => refresh(query),
    createTask: (t: TaskInput) => mutate(() => api.createTask(t), true),
    updateTask: (id: number, t: TaskInput) => mutate(() => api.updateTask(id, t), true),
    // Optimistic: the checkbox flips immediately; if the server rejects it, flip it back.
    toggleTask: async (id: number) => {
      const flip = () =>
        setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, isCompleted: !t.isCompleted } : t)))
      flip()
      const err = await mutate(() => api.toggleTask(id))
      if (err) flip()
      return err
    },
    deleteTask: (id: number) => mutate(() => api.deleteTask(id)),
    clearCompleted: () => mutate(() => api.clearCompleted()),
    createCategory: (name: string, color: string) =>
      mutate(() => api.createCategory(name, color), true),
    deleteCategory: async (id: number) => {
      const err = await mutate(() => api.deleteCategory(id))
      if (!err && query.categoryId === id) setQuery((q) => ({ ...q, categoryId: null }))
      return err
    },
  }
}
