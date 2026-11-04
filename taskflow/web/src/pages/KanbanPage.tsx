import { useMemo, useState, type DragEvent, type FormEvent } from 'react'
import { PRIORITIES, STATUS_LABEL, type Priority, type Task, type WorkStatus } from '../api'
import { PageHeader, Skeleton } from '../components/Feedback'
import { Icon } from '../components/Icon'
import { useTaskEditor } from '../components/TaskEditor'
import { dueLabel, formatTime } from '../dates'
import { emptyFilters, filterTasks } from '../taskFilters'
import { useSettings } from '../useSettings'
import { useTaskFlow, useToday } from '../useTaskFlow'
import './kanban.css'

const COLUMNS: WorkStatus[] = ['Todo', 'InProgress', 'Done']
export const DONE_LIMIT = 50

const byOrder = (a: Task, b: Task) => a.sortOrder - b.sortOrder || a.id - b.id

function ColumnAdd({ status, onAdd }: { status: WorkStatus; onAdd: (title: string) => Promise<string | null> }) {
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) { setError('Enter a title.'); return }
    const err = await onAdd(title.trim())
    if (err) setError(err)
    else { setTitle(''); setError(null) }
  }
  return (
    <form className="kb-add" onSubmit={submit} noValidate>
      <input
        aria-label={`Add task to ${STATUS_LABEL[status]}`}
        placeholder="Add a task…"
        value={title}
        maxLength={200}
        aria-invalid={error ? true : undefined}
        onChange={(e) => { setTitle(e.target.value); setError(null) }}
      />
      <button type="submit" aria-label={`Add to ${STATUS_LABEL[status]}`}><Icon name="plus" /></button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  )
}

export function KanbanPage() {
  const store = useTaskFlow()
  const today = useToday()
  const { settings } = useSettings()
  const editor = useTaskEditor()

  const [q, setQ] = useState('')
  const [priority, setPriority] = useState('')
  const [category, setCategory] = useState('')
  const [tag, setTag] = useState('')
  const [showAllDone, setShowAllDone] = useState(false)
  const [dragId, setDragId] = useState<number | null>(null)
  const [overCol, setOverCol] = useState<WorkStatus | null>(null)

  const visible = useMemo(
    () =>
      filterTasks(
        store.tasks,
        {
          ...emptyFilters, q,
          categoryId: category ? Number(category) : null,
          priorities: priority ? [priority as Priority] : [],
          tagIds: tag ? [Number(tag)] : [],
        },
        today,
      ),
    [store.tasks, q, priority, category, tag, today],
  )

  const columns = useMemo(() => {
    const out = {} as Record<WorkStatus, { cards: Task[]; total: number; hidden: number }>
    for (const s of COLUMNS) {
      let cards = visible.filter((t) => t.status === s).sort(byOrder)
      const total = cards.length
      let hidden = 0
      if (s === 'Done' && !showAllDone && total > DONE_LIMIT) {
        const recent = new Set(
          [...cards].sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt)).slice(0, DONE_LIMIT).map((t) => t.id),
        )
        cards = cards.filter((t) => recent.has(t.id))
        hidden = total - cards.length
      }
      out[s] = { cards, total, hidden }
    }
    return out
  }, [visible, showAllDone])

  /** Moves a card; `before` is the card it was dropped on (insert in front of it) or undefined to append. */
  function moveTo(id: number, status: WorkStatus, before?: Task) {
    if (before?.id === id) return
    let position: number | undefined
    if (before) {
      // Positions are relative to the whole column on the server, not just the cards currently shown.
      const full = store.tasks.filter((t) => t.status === status && t.id !== id).sort(byOrder)
      position = full.findIndex((t) => t.id === before.id)
      if (position < 0) position = undefined
    }
    void store.setStatus(id, status, position)
  }
  const draggedId = (e: DragEvent) => {
    const raw = e.dataTransfer?.getData('text/plain')
    return raw ? Number(raw) : dragId
  }

  const filtered = q !== '' || priority !== '' || category !== '' || tag !== ''

  return (
    <section aria-label="Kanban board">
      <PageHeader title="Kanban" subtitle="Drag cards between columns, or use the Move buttons. Changes are saved immediately.">
        <button type="button" className="primary" onClick={() => editor.open({})}><Icon name="plus" /> New task</button>
      </PageHeader>

      <div className="kb-toolbar">
        <div className="search-box">
          <Icon name="search" />
          <input type="search" aria-label="Search board" placeholder="Search the board…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select aria-label="Filter by priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
        </select>
        <select aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Any category</option>
          {store.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select aria-label="Filter by tag" value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">Any tag</option>
          {store.tags.map((t) => <option key={t.id} value={t.id}>#{t.name}</option>)}
        </select>
        {filtered && (
          <button type="button" onClick={() => { setQ(''); setPriority(''); setCategory(''); setTag('') }}>Clear filters</button>
        )}
      </div>

      {store.loading ? (
        <Skeleton rows={4} />
      ) : (
        <div className="kb-board">
          {COLUMNS.map((s) => {
            const col = columns[s]
            return (
              <section
                key={s}
                className={`kb-col${overCol === s ? ' drop' : ''}`}
                aria-label={`${STATUS_LABEL[s]} column`}
                data-status={s}
                onDragOver={(e) => { e.preventDefault(); setOverCol(s) }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverCol(null) }}
                onDrop={(e) => {
                  e.preventDefault()
                  setOverCol(null)
                  const id = draggedId(e)
                  setDragId(null)
                  if (id) moveTo(id, s)
                }}
              >
                <div className="kb-colhead">
                  <h3>{STATUS_LABEL[s]}</h3>
                  <span className="kb-count" aria-label={`${col.total} tasks`}>{col.total}</span>
                </div>
                <ColumnAdd
                  status={s}
                  onAdd={(title) => store.createTask({ title, priority: settings.defaultPriority, status: s })}
                />
                <ul className="kb-cards" aria-label={`${STATUS_LABEL[s]} cards`}>
                  {col.cards.map((t) => {
                    const due = t.dueDate ? dueLabel(t.dueDate, today, settings.dateFormat) : null
                    const late = !!due?.overdue && !t.isCompleted
                    return (
                      <li
                        key={t.id}
                        className={`kb-card${t.isCompleted ? ' done' : ''}${dragId === t.id ? ' dragging' : ''}`}
                        data-priority={t.priority}
                        draggable
                        onDragStart={(e) => {
                          setDragId(t.id)
                          e.dataTransfer?.setData?.('text/plain', String(t.id))
                          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
                        }}
                        onDragEnd={() => { setDragId(null); setOverCol(null) }}
                        onDragOver={(e) => { e.preventDefault(); setOverCol(s) }}
                        onDrop={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setOverCol(null)
                          const id = draggedId(e)
                          setDragId(null)
                          if (id) moveTo(id, s, t)
                        }}
                      >
                        <div className="kb-title">
                          <button type="button" className="linklike" onClick={() => editor.open({ task: t })}>{t.title}</button>
                          {t.isPinned && <Icon name="pin" className="flag pin" title="Pinned" />}
                          {t.isFavorite && <Icon name="star" className="flag fav" title="Favorite" />}
                        </div>
                        <div className="kb-meta">
                          <span className={`p-${t.priority.toLowerCase()}`} title={`Priority: ${t.priority}`}>{t.priority}</span>
                          {due && (
                            <span className={late ? 'overdue' : ''}>
                              {late ? 'Overdue · ' : ''}{due.text}{t.dueTime ? ` · ${formatTime(t.dueTime, settings.timeFormat)}` : ''}
                            </span>
                          )}
                          {t.categoryName && <span className="cat" style={{ ['--cat' as string]: t.categoryColor ?? '#888' }}>{t.categoryName}</span>}
                          {t.tags.map((g) => <span key={g.id} className="tag" style={{ ['--tag' as string]: g.color }}>#{g.name}</span>)}
                          {t.subtaskTotal > 0 && <span title="Subtasks done">{t.subtaskDone}/{t.subtaskTotal} subtasks</span>}
                          {t.recurrence?.isActive && <span><Icon name="repeat" /> Repeats</span>}
                        </div>
                        <div className="kb-move">
                          {COLUMNS.filter((c) => c !== s).map((c) => (
                            <button key={c} type="button" aria-label={`Move "${t.title}" to ${STATUS_LABEL[c]}`} onClick={() => moveTo(t.id, c)}>
                              {COLUMNS.indexOf(c) < COLUMNS.indexOf(s) ? '←' : '→'} {STATUS_LABEL[c]}
                            </button>
                          ))}
                        </div>
                      </li>
                    )
                  })}
                </ul>
                {col.hidden > 0 && (
                  <button type="button" className="kb-more" onClick={() => setShowAllDone(true)}>Show all {col.total} (older {col.hidden} hidden)</button>
                )}
                {s === 'Done' && showAllDone && col.total > DONE_LIMIT && (
                  <button type="button" className="kb-more" onClick={() => setShowAllDone(false)}>Show only the latest {DONE_LIMIT}</button>
                )}
              </section>
            )
          })}
        </div>
      )}
    </section>
  )
}
