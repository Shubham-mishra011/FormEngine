import { useEffect, useMemo, useRef, useState } from 'react'
import { PRIORITIES, type Priority, type SortKey } from '../api'
import { EmptyState, PageHeader, Skeleton } from '../components/Feedback'
import { Icon } from '../components/Icon'
import { ConfirmDialog } from '../components/Modal'
import { useTaskEditor } from '../components/TaskEditor'
import { TaskRow } from '../components/TaskRow'
import { useTaskActions } from '../components/useTaskActions'
import { applyFilters, isFiltered, type Filters, type View } from '../taskFilters'
import { useToday, useTaskFlow } from '../useTaskFlow'
import { useToast } from '../useToast'
import type { Route } from '../useRoute'

type ListRoute = Extract<Route, 'tasks' | 'inbox' | 'today' | 'upcoming' | 'completed'>

const PAGES: Record<ListRoute, { title: string; subtitle: string; view: View; sort: SortKey; empty: string; emptyHint: string }> = {
  tasks: { title: 'My Tasks', subtitle: 'Everything, pinned items first.', view: 'all', sort: 'created_desc', empty: 'No tasks yet', emptyHint: 'Add your first task with the quick-add bar above, or press N.' },
  inbox: { title: 'Inbox', subtitle: 'Open tasks with no category and no date — sort them out here.', view: 'inbox', sort: 'created_desc', empty: 'Inbox zero', emptyHint: 'Everything has a home. Nice.' },
  today: { title: 'Today', subtitle: 'Due today, plus what is overdue.', view: 'today', sort: 'priority', empty: 'Nothing due today', emptyHint: 'Enjoy the quiet, or pull something forward from Upcoming.' },
  upcoming: { title: 'Upcoming', subtitle: 'Open tasks with a future due date.', view: 'upcoming', sort: 'due', empty: 'Nothing scheduled', emptyHint: 'Give a task a due date and it will appear here.' },
  completed: { title: 'Completed', subtitle: 'Finished tasks, newest first.', view: 'completed', sort: 'updated_desc', empty: 'Nothing completed yet', emptyHint: 'Tick a task off and it will show up here.' },
}

const SORTS: [SortKey, string][] = [
  ['created_desc', 'Newest first'], ['updated_desc', 'Recently modified'], ['due', 'Due date'], ['priority', 'Priority'], ['title', 'Title (A–Z)'], ['manual', 'Board order'],
]

export function TasksPage({ route }: { route: ListRoute }) {
  const store = useTaskFlow()
  const today = useToday()
  const editor = useTaskEditor()
  const { toast } = useToast()
  const { rowActions, subtaskActions, dialogs } = useTaskActions()
  const page = PAGES[route]

  const [filters, setFilters] = useState<Filters>(() => ({
    view: page.view, q: '', categoryId: null, priorities: [], tagIds: [], pinned: false, favorite: false, board: null, sort: page.sort,
  }))
  const [showFilters, setShowFilters] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
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

  // Overdue tasks belong on Today as well: you want them in front of you, not hidden.
  const visible = useMemo(() => {
    let list = applyFilters(store.tasks, filters, today)
    if (route === 'today') {
      const overdue = applyFilters(store.tasks, { ...filters, view: 'overdue' }, today)
      const seen = new Set(list.map((t) => t.id))
      list = [...overdue.filter((t) => !seen.has(t.id)), ...list]
    }
    return list
  }, [store.tasks, filters, today, route])

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }))
  const filtered = isFiltered(filters, page.view)
  const selectedIds = [...selected].filter((id) => visible.some((t) => t.id === id))

  function togglePriority(p: Priority) {
    set({ priorities: filters.priorities.includes(p) ? filters.priorities.filter((x) => x !== p) : [...filters.priorities, p] })
  }

  async function bulk(action: string, value?: unknown, message?: string) {
    const err = await store.bulk(selectedIds, action, value)
    if (!err) {
      toast(message ?? 'Done.')
      if (action === 'delete') { setSelected(new Set()); setSelectMode(false) }
    }
  }

  return (
    <section aria-label={page.title}>
      <PageHeader title={page.title} subtitle={page.subtitle}>
        <button type="button" className="primary" onClick={() => editor.open({ defaults: route === 'today' ? { dueDate: today } : {} })}>
          <Icon name="plus" /> New task
        </button>
      </PageHeader>

      <div className="toolbar">
        <div className="search-box">
          <Icon name="search" />
          <input
            ref={searchRef}
            type="search"
            aria-label="Search tasks"
            placeholder="Search titles, notes, tags (#tag)…  ( / )"
            onKeyDown={(e) => { if (e.key === 'Escape') set({ q: '' }) }}
            value={filters.q}
            onChange={(e) => set({ q: e.target.value })}
          />
        </div>
        <select aria-label="Sort by" value={filters.sort} onChange={(e) => set({ sort: e.target.value as SortKey })}>
          {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button type="button" aria-expanded={showFilters} onClick={() => setShowFilters((v) => !v)} className={filtered ? 'on' : ''}>
          <Icon name="filter" /> Filters{filtered ? ' •' : ''}
        </button>
        <button type="button" aria-pressed={selectMode} className={selectMode ? 'on' : ''} onClick={() => { setSelectMode((v) => !v); setSelected(new Set()) }}>
          <Icon name="check" /> Select
        </button>
        {route === 'completed' && (
          <button type="button" className="danger" onClick={() => setConfirmClear(true)} disabled={!store.stats?.completed}>
            Clear completed
          </button>
        )}
      </div>

      {showFilters && (
        <div className="filter-panel card" role="group" aria-label="Filters">
          <div className="chip-row" role="group" aria-label="Filter by priority">
            {PRIORITIES.map((p) => (
              <button key={p} type="button" className={`chip${filters.priorities.includes(p) ? ' on' : ''}`} aria-pressed={filters.priorities.includes(p)} onClick={() => togglePriority(p)}>
                {p}
              </button>
            ))}
            <button type="button" className={`chip${filters.pinned ? ' on' : ''}`} aria-pressed={filters.pinned} onClick={() => set({ pinned: !filters.pinned })}>Pinned</button>
            <button type="button" className={`chip${filters.favorite ? ' on' : ''}`} aria-pressed={filters.favorite} onClick={() => set({ favorite: !filters.favorite })}>Favorites</button>
          </div>
          <div className="form-row">
            <label>Category
              <select aria-label="Filter by category" value={filters.categoryId ?? ''} onChange={(e) => set({ categoryId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Any category</option>
                {store.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label>Column
              <select aria-label="Filter by status" value={filters.board ?? ''} onChange={(e) => set({ board: (e.target.value || null) as Filters['board'] })}>
                <option value="">Any</option>
                <option value="Todo">To Do</option>
                <option value="InProgress">In Progress</option>
                <option value="Done">Done</option>
              </select>
            </label>
            {route === 'tasks' && (
              <label>Show
                <select aria-label="Filter by state" value={filters.view} onChange={(e) => set({ view: e.target.value as View })}>
                  <option value="all">All</option>
                  <option value="active">Active</option>
                  <option value="today">Due today</option>
                  <option value="overdue">Overdue</option>
                  <option value="upcoming">Upcoming</option>
                  <option value="completed">Completed</option>
                </select>
              </label>
            )}
          </div>
          {store.tags.length > 0 && (
            <div className="chip-row" role="group" aria-label="Filter by tag">
              {store.tags.map((t) => {
                const on = filters.tagIds.includes(t.id)
                return (
                  <button key={t.id} type="button" className={`tag-chip${on ? ' on' : ''}`} style={{ ['--tag' as string]: t.color }} aria-pressed={on}
                    onClick={() => set({ tagIds: on ? filters.tagIds.filter((x) => x !== t.id) : [...filters.tagIds, t.id] })}>
                    <span className="dot" />#{t.name}
                  </button>
                )
              })}
            </div>
          )}
          {filtered && (
            <button type="button" onClick={() => setFilters({ view: page.view, q: '', categoryId: null, priorities: [], tagIds: [], pinned: false, favorite: false, board: null, sort: page.sort })}>
              Clear filters
            </button>
          )}
        </div>
      )}

      {selectMode && (
        <div className="bulk-bar" role="region" aria-label="Bulk actions">
          <label className="check">
            <input
              type="checkbox"
              aria-label="Select all shown"
              checked={visible.length > 0 && selectedIds.length === visible.length}
              onChange={(e) => setSelected(e.target.checked ? new Set(visible.map((t) => t.id)) : new Set())}
            />{' '}
            {selectedIds.length} selected
          </label>
          <button type="button" disabled={!selectedIds.length} onClick={() => void bulk('complete', undefined, 'Completed.')}>Complete</button>
          <button type="button" disabled={!selectedIds.length} onClick={() => void bulk('reopen', undefined, 'Reopened.')}>Reopen</button>
          <select aria-label="Bulk set priority" disabled={!selectedIds.length} value="" onChange={(e) => e.target.value && void bulk('priority', e.target.value, `Priority set to ${e.target.value}.`)}>
            <option value="">Priority…</option>
            {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
          </select>
          <select aria-label="Bulk set category" disabled={!selectedIds.length} value="" onChange={(e) => e.target.value !== '' && void bulk('category', e.target.value === 'none' ? null : Number(e.target.value), 'Category updated.')}>
            <option value="">Category…</option>
            <option value="none">No category</option>
            {store.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select aria-label="Bulk add tag" disabled={!selectedIds.length || !store.tags.length} value="" onChange={(e) => e.target.value && void bulk('addTag', Number(e.target.value), 'Tag added.')}>
            <option value="">Add tag…</option>
            {store.tags.map((t) => <option key={t.id} value={t.id}>#{t.name}</option>)}
          </select>
          <button type="button" disabled={!selectedIds.length} onClick={() => void bulk('pin', undefined, 'Pinned.')}>Pin</button>
          <button type="button" className="danger" disabled={!selectedIds.length} onClick={() => setConfirmBulkDelete(true)}>Delete</button>
        </div>
      )}

      {store.loading ? (
        <Skeleton rows={5} />
      ) : visible.length === 0 ? (
        filtered ? (
          <EmptyState icon="search" title="No tasks match these filters">Try clearing a filter or searching for something else.</EmptyState>
        ) : (
          <EmptyState icon={route === 'completed' ? 'completed' : route === 'inbox' ? 'inbox' : 'tasks'} title={page.empty}>{page.emptyHint}</EmptyState>
        )
      ) : (
        <ul className="tasks" aria-label={`${page.title} list`}>
          {visible.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              today={today}
              subtaskActions={subtaskActions}
              selectMode={selectMode}
              selected={selected.has(t.id)}
              onSelect={(id, on) => setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n })}
              {...rowActions}
            />
          ))}
        </ul>
      )}

      {confirmClear && (
        <ConfirmDialog
          title="Clear completed tasks?"
          message={`Permanently delete all ${store.stats?.completed ?? 0} completed tasks? Open tasks are not touched. This cannot be undone.`}
          confirmLabel="Delete completed"
          danger
          onCancel={() => setConfirmClear(false)}
          onConfirm={async () => {
            setConfirmClear(false)
            const err = await store.clearCompleted()
            if (!err) toast('Completed tasks deleted.')
          }}
        />
      )}
      {confirmBulkDelete && (
        <ConfirmDialog
          title="Delete selected tasks?"
          message={`Permanently delete ${selectedIds.length} task${selectedIds.length === 1 ? '' : 's'}? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirmBulkDelete(false)}
          onConfirm={() => { setConfirmBulkDelete(false); void bulk('delete', undefined, 'Deleted.') }}
        />
      )}
      {dialogs}
    </section>
  )
}
