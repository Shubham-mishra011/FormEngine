import { useMemo, useRef, useState, type DragEvent } from 'react'
import { PRIORITIES, type Priority, type Task } from '../api'
import { EmptyState, PageHeader, Skeleton } from '../components/Feedback'
import { Icon } from '../components/Icon'
import { useTaskEditor } from '../components/TaskEditor'
import {
  addDays, addMonths, formatDate, formatLongDate, formatMonthTitle, formatTime, monthGrid, monthStart, weekDays, weekdayShort,
} from '../dates'
import { applyFilters, emptyFilters } from '../taskFilters'
import { useSettings } from '../useSettings'
import { useTaskFlow, useToday } from '../useTaskFlow'
import { useToast } from '../useToast'
import './calendar.css'

type View = 'month' | 'week' | 'day'
const VIEWS: [View, string][] = [['month', 'Month'], ['week', 'Week'], ['day', 'Day']]

/** Date input that lets keyboard and touch users reschedule without dragging. */
function MoveDate({ task, label, onMove }: { task: Task; label: string; onMove: (t: Task, date: string) => void }) {
  return (
    <input
      type="date"
      aria-label={`${label} "${task.title}"`}
      value={task.dueDate ?? ''}
      onChange={(e) => e.target.value && onMove(task, e.target.value)}
    />
  )
}

export function CalendarPage() {
  const store = useTaskFlow()
  const today = useToday()
  const { settings } = useSettings()
  const editor = useTaskEditor()
  const { toast } = useToast()

  const [view, setView] = useState<View>('month')
  const [cursor, setCursor] = useState(today)
  const [selected, setSelected] = useState(today)
  const [category, setCategory] = useState('')
  const [priority, setPriority] = useState('')
  const [status, setStatus] = useState<'all' | 'open' | 'completed'>('all')
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const dragId = useRef<number | null>(null)

  const filtered = useMemo(
    () =>
      applyFilters(
        store.tasks,
        {
          ...emptyFilters,
          view: status === 'open' ? 'active' : status === 'completed' ? 'completed' : 'all',
          categoryId: category ? Number(category) : null,
          priorities: priority ? [priority as Priority] : [],
          sort: 'due',
        },
        today,
        false,
      ),
    [store.tasks, status, category, priority, today],
  )
  const scheduled = filtered.filter((t) => t.dueDate)
  const unscheduled = filtered.filter((t) => !t.dueDate)
  const byDate = useMemo(() => {
    const m = new Map<string, Task[]>()
    for (const t of scheduled) m.set(t.dueDate!, [...(m.get(t.dueDate!) ?? []), t])
    return m
  }, [scheduled])
  const on = (iso: string) => byDate.get(iso) ?? []

  const overdue = filtered.filter((t) => !t.isCompleted && t.dueDate && t.dueDate < today)
  const upcoming = filtered.filter((t) => !t.isCompleted && t.dueDate && t.dueDate >= today && t.dueDate <= addDays(today, 7))

  const unit = view
  function shift(dir: -1 | 1) {
    const next = view === 'month' ? addMonths(cursor, dir) : addDays(cursor, view === 'week' ? 7 * dir : dir)
    setCursor(next)
    if (view === 'day') setSelected(next)
  }
  function goToday() {
    setCursor(today)
    setSelected(today)
  }

  const weekStart = settings.weekStart
  const weekHead = weekDays(today, weekStart)
  const title =
    view === 'month'
      ? formatMonthTitle(cursor)
      : view === 'week'
        ? `${formatDate(weekDays(cursor, weekStart)[0], settings.dateFormat)} – ${formatDate(weekDays(cursor, weekStart)[6], settings.dateFormat, true)}`
        : formatLongDate(cursor)
  const panelDate = view === 'day' ? cursor : selected

  async function move(task: Task, date: string) {
    if (!date || date === task.dueDate) return
    const err = await store.reschedule(task.id, date)
    if (!err) toast(`Moved "${task.title}" to ${formatDate(date, settings.dateFormat)}.`)
  }
  function onDrop(e: DragEvent, iso: string) {
    e.preventDefault()
    setDropTarget(null)
    const raw = e.dataTransfer?.getData('text/plain')
    const id = raw ? Number(raw) : dragId.current
    dragId.current = null
    setDragging(null)
    const t = store.tasks.find((x) => x.id === id)
    if (t) void move(t, iso)
  }
  const dropProps = (iso: string) => ({
    onDragOver: (e: DragEvent) => { e.preventDefault(); setDropTarget(iso) },
    onDragLeave: () => setDropTarget((d) => (d === iso ? null : d)),
    onDrop: (e: DragEvent) => onDrop(e, iso),
  })

  function chip(t: Task) {
    return (
      <button
        key={t.id}
        type="button"
        draggable
        className={`cal-chip p-${t.priority.toLowerCase()}${t.isCompleted ? ' done' : ''}${dragging === t.id ? ' dragging' : ''}`}
        title={`${t.title} — ${t.priority}${t.isCompleted ? ' (done)' : ''}`}
        onDragStart={(e) => {
          dragId.current = t.id
          setDragging(t.id)
          e.dataTransfer?.setData?.('text/plain', String(t.id))
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
        }}
        onDragEnd={() => { dragId.current = null; setDragging(null); setDropTarget(null) }}
        onClick={() => editor.open({ task: t })}
      >
        {t.dueTime && <span className="cal-time">{formatTime(t.dueTime, settings.timeFormat)}</span>}
        {t.title}
      </button>
    )
  }

  function cell(iso: string, outside: boolean, all: boolean) {
    const items = on(iso)
    const shown = all ? items : items.slice(0, 3)
    return (
      <div
        key={iso}
        className={`cal-cell${outside ? ' out' : ''}${iso === today ? ' today' : ''}${iso === selected ? ' selected' : ''}${dropTarget === iso ? ' drop' : ''}`}
        data-date={iso}
        {...dropProps(iso)}
      >
        <div className="cal-cellhead">
          <button type="button" className="cal-daynum" aria-label={`Show ${iso}`} title={formatLongDate(iso)} onClick={() => setSelected(iso)}>
            {Number(iso.slice(8))}
          </button>
          <button type="button" className="cal-add" aria-label={`Add task on ${iso}`} title="Add a task on this day" onClick={() => { setSelected(iso); editor.open({ defaults: { dueDate: iso } }) }}>
            <Icon name="plus" />
          </button>
        </div>
        <div className="cal-chips">{shown.map(chip)}</div>
        {!all && items.length > 3 && (
          <button type="button" className="cal-more" onClick={() => setSelected(iso)}>+{items.length - 3} more</button>
        )}
        {items.length > 0 && (
          <div className="cal-dots" aria-hidden="true">
            {items.slice(0, 4).map((t) => <i key={t.id} className={t.isCompleted ? 'done' : ''} />)}
          </div>
        )}
      </div>
    )
  }

  const dayItems = on(panelDate)

  return (
    <section aria-label="Calendar">
      <PageHeader title="Calendar" subtitle="Your tasks by due date. Drag a task onto another day to reschedule it.">
        <button type="button" className="primary" onClick={() => editor.open({ defaults: { dueDate: panelDate } })}>
          <Icon name="plus" /> New task
        </button>
      </PageHeader>

      <div className="cal-toolbar">
        <div className="tabs" role="group" aria-label="Calendar view">
          {VIEWS.map(([v, l]) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>{l}</button>
          ))}
        </div>
        <div className="cal-nav">
          <button type="button" className="icon-btn" aria-label={`Previous ${unit}`} onClick={() => shift(-1)}><Icon name="chevronLeft" /></button>
          <button type="button" onClick={goToday}>Today</button>
          <button type="button" className="icon-btn" aria-label={`Next ${unit}`} onClick={() => shift(1)}><Icon name="chevronRight" /></button>
          <h3 className="cal-title" aria-live="polite" data-testid="cal-title">{title}</h3>
        </div>
        <div className="cal-filters">
          <select aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Any category</option>
            {store.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select aria-label="Filter by priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="">Any priority</option>
            {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
          </select>
          <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="all">All tasks</option>
            <option value="open">Open</option>
            <option value="completed">Completed</option>
          </select>
        </div>
      </div>

      {store.loading ? (
        <Skeleton rows={4} />
      ) : (
        <div className="cal-layout">
          <div className="cal-main">
            {view === 'month' && (
              <>
                <div className="cal-head" aria-hidden="true">
                  {weekHead.map((d) => <span key={d}>{weekdayShort(new Date(`${d}T00:00:00Z`).getUTCDay())}</span>)}
                </div>
                <div className="cal-grid" role="group" aria-label={`Month of ${formatMonthTitle(cursor)}`}>
                  {monthGrid(cursor, weekStart).flat().map((iso) => cell(iso, iso.slice(0, 7) !== monthStart(cursor).slice(0, 7), false))}
                </div>
              </>
            )}
            {view === 'week' && (
              <div className="cal-week" role="group" aria-label="Week">
                {weekDays(cursor, weekStart).map((iso) => (
                  <div key={iso}>
                    <div className="hint" style={{ margin: '0 0 0.2rem' }}>{formatLongDate(iso)}</div>
                    {cell(iso, false, true)}
                  </div>
                ))}
              </div>
            )}

            <div
              className={`cal-panel${dropTarget === `panel-${panelDate}` ? ' drop' : ''}`}
              role="region"
              aria-label={`Tasks on ${panelDate}`}
              onDragOver={(e) => { e.preventDefault(); setDropTarget(`panel-${panelDate}`) }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(e) => onDrop(e, panelDate)}
            >
              <h3>
                {formatLongDate(panelDate)}{' '}
                <button type="button" className="cal-add" aria-label={`Add task to ${panelDate}`} onClick={() => editor.open({ defaults: { dueDate: panelDate } })}>
                  <Icon name="plus" /> Add
                </button>
              </h3>
              {dayItems.length === 0 ? (
                <p className="hint">Nothing due on this day.</p>
              ) : (
                <ul className="cal-rows">
                  {dayItems.map((t) => (
                    <li key={t.id} className={`cal-row${t.isCompleted ? ' done' : ''}`}>
                      <button type="button" className="linklike row-title" onClick={() => editor.open({ task: t })}>
                        {t.dueTime && <strong>{formatTime(t.dueTime, settings.timeFormat)} </strong>}
                        {t.title}
                      </button>
                      <span className={`badge p-${t.priority.toLowerCase()}`}>{t.priority}</span>
                      <MoveDate task={t} label="Move" onMove={(x, d) => void move(x, d)} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <aside className="cal-side" aria-label="Agenda">
            <div className="card cal-overdue">
              <h3>Overdue ({overdue.length})</h3>
              {overdue.length === 0 ? <p className="hint">Nothing overdue.</p> : (
                <ul className="cal-rows" aria-label="Overdue tasks">
                  {overdue.map((t) => (
                    <li key={t.id} className="cal-row">
                      <button type="button" className="linklike row-title" onClick={() => editor.open({ task: t })}>{t.title}</button>
                      <span className="hint">{formatDate(t.dueDate!, settings.dateFormat)}</span>
                      <MoveDate task={t} label="Reschedule" onMove={(x, d) => void move(x, d)} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="card">
              <h3>Upcoming — next 7 days ({upcoming.length})</h3>
              {upcoming.length === 0 ? <p className="hint">Nothing coming up.</p> : (
                <ul className="cal-rows" aria-label="Upcoming tasks">
                  {upcoming.map((t) => (
                    <li key={t.id} className="cal-row">
                      <button type="button" className="linklike row-title" onClick={() => editor.open({ task: t })}>{t.title}</button>
                      <span className="hint">{t.dueDate === today ? 'Today' : formatDate(t.dueDate!, settings.dateFormat)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="card cal-unscheduled">
              <details>
                <summary>Unscheduled ({unscheduled.length})</summary>
                {unscheduled.length === 0 ? <EmptyState title="Everything has a date" /> : (
                  <ul className="cal-rows" aria-label="Unscheduled tasks">
                    {unscheduled.map((t) => (
                      <li key={t.id} className={`cal-row${t.isCompleted ? ' done' : ''}`}>
                        <button type="button" className="linklike row-title" onClick={() => editor.open({ task: t })}>{t.title}</button>
                        <MoveDate task={t} label="Schedule" onMove={(x, d) => void move(x, d)} />
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            </div>
          </aside>
        </div>
      )}
    </section>
  )
}
