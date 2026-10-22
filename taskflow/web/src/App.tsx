import { useEffect, useRef } from 'react'
import type { Priority, SortKey } from './api'
import { Sidebar } from './components/Sidebar'
import { TaskForm } from './components/TaskForm'
import { TaskRow } from './components/TaskRow'
import { useTaskFlow } from './useTaskFlow'

export default function App() {
  const tf = useTaskFlow()
  const { query, setQuery } = tf
  const filtered = query.q !== '' || query.categoryId !== null || query.priority !== null || query.status !== 'all'
  const searchRef = useRef<HTMLInputElement>(null)

  // "/" jumps to search, unless the user is already typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable) return
      e.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <header className="topbar">
        <h1>TaskFlow</h1>
        {tf.stats && (
          <p className="summary">
            {tf.stats.active} active · {tf.stats.completed} done
          </p>
        )}
      </header>

      {tf.error && (
        <div className="banner" role="alert">
          <span>{tf.error}</span>
          <button onClick={tf.dismissError}>Dismiss</button>
          <button onClick={() => void tf.reload()}>Retry</button>
        </div>
      )}

      <div className="layout">
        <Sidebar
          categories={tf.categories}
          stats={tf.stats}
          status={query.status}
          categoryId={query.categoryId}
          onStatus={(status) => setQuery({ ...query, status })}
          onCategory={(categoryId) => setQuery({ ...query, categoryId })}
          onAddCategory={tf.createCategory}
          onDeleteCategory={(id) => void tf.deleteCategory(id)}
        />

        <main>
          <section aria-label="Add task" className="card">
            <TaskForm categories={tf.categories} submitLabel="Add task" onSubmit={tf.createTask} />
          </section>

          <div className="toolbar">
            <input
              ref={searchRef}
              type="search"
              aria-label="Search tasks"
              placeholder="Search tasks…  ( / )"
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery({ ...query, q: '' })
              }}
              value={query.q}
              onChange={(e) => setQuery({ ...query, q: e.target.value })}
            />
            <select
              aria-label="Filter by priority"
              value={query.priority ?? ''}
              onChange={(e) => setQuery({ ...query, priority: (e.target.value || null) as Priority | null })}
            >
              <option value="">Any priority</option>
              <option>High</option>
              <option>Medium</option>
              <option>Low</option>
            </select>
            <select
              aria-label="Sort by"
              value={query.sort}
              onChange={(e) => setQuery({ ...query, sort: e.target.value as SortKey })}
            >
              <option value="created_desc">Newest first</option>
              <option value="due">Due date</option>
              <option value="priority">Priority</option>
              <option value="title">Title (A–Z)</option>
            </select>
            <button
              onClick={() => {
                if (window.confirm('Delete all completed tasks?')) void tf.clearCompleted()
              }}
              disabled={!tf.stats?.completed}
            >
              Clear completed
            </button>
          </div>

          {tf.loading ? (
            <p className="empty" role="status">
              Loading…
            </p>
          ) : tf.tasks.length === 0 ? (
            <p className="empty" role="status">
              {filtered ? 'No tasks match these filters.' : 'No tasks yet — add your first one above.'}
            </p>
          ) : (
            <ul className="tasks">
              {tf.tasks.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  categories={tf.categories}
                  onToggle={(id) => void tf.toggleTask(id)}
                  onDelete={(id) => void tf.deleteTask(id)}
                  onUpdate={tf.updateTask}
                />
              ))}
            </ul>
          )}
        </main>
      </div>
    </div>
  )
}
