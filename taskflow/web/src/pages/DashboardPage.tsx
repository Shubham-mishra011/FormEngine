import { useEffect, useMemo, useState } from 'react'
import { api, type Analytics, type FocusStats, type Task } from '../api'
import { EmptyState, PageHeader, Skeleton } from '../components/Feedback'
import { Icon } from '../components/Icon'
import { useTaskEditor } from '../components/TaskEditor'
import { addDays, dueLabel, formatLongDate, formatMinutes, formatTime, greeting, toISO } from '../dates'
import { hashFor, type Route } from '../useRoute'
import { WIDGETS, useSettings, type WidgetId } from '../useSettings'
import { useTaskFlow, useToday } from '../useTaskFlow'
import './dashboard.css'

const LIMIT = 6

function Widget({ id, title, link, children }: { id: string; title: string; link?: { route: Route; label: string; param?: string }; children: React.ReactNode }) {
  return (
    <section className={`widget widget-${id}`} aria-labelledby={`w-${id}`}>
      <header>
        <h3 id={`w-${id}`}>{title}</h3>
        {link && (
          <a href={hashFor(link.route, link.param)} className="widget-link">
            {link.label}
          </a>
        )}
      </header>
      {children}
    </section>
  )
}

function MiniList({ tasks, today, more, route, empty }: { tasks: Task[]; today: string; more: string; route: Route; empty: string }) {
  const store = useTaskFlow()
  const editor = useTaskEditor()
  const { settings } = useSettings()
  if (tasks.length === 0) return <p className="widget-empty">{empty}</p>
  return (
    <>
      <ul className="mini-list">
        {tasks.slice(0, LIMIT).map((t) => {
          const due = t.dueDate ? dueLabel(t.dueDate, today, settings.dateFormat) : null
          return (
            <li key={t.id} className={t.isCompleted ? 'done' : ''}>
              <input
                type="checkbox"
                aria-label={`Mark "${t.title}" as ${t.isCompleted ? 'not done' : 'done'}`}
                checked={t.isCompleted}
                onChange={() => void store.toggleTask(t.id)}
              />
              <button type="button" className="linklike mini-title" onClick={() => editor.open({ task: t })}>
                {t.title}
              </button>
              {t.priority === 'Urgent' || t.priority === 'High' ? <span className={`badge p-${t.priority.toLowerCase()}`}>{t.priority}</span> : null}
              {due && (
                <span className={`mini-due${due.overdue ? ' overdue' : ''}`}>
                  {due.text}
                  {t.dueTime && ` · ${formatTime(t.dueTime, settings.timeFormat)}`}
                </span>
              )}
            </li>
          )
        })}
      </ul>
      {tasks.length > LIMIT && (
        <a className="widget-link" href={hashFor(route)}>
          {tasks.length - LIMIT} more {more}
        </a>
      )}
    </>
  )
}

function Ring({ pct, label }: { pct: number; label: string }) {
  const r = 38
  const c = 2 * Math.PI * r
  return (
    <svg className="ring" viewBox="0 0 100 100" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <circle cx="50" cy="50" r={r} className="ring-track" />
      <circle cx="50" cy="50" r={r} className="ring-fill" strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 50 50)" />
      <text x="50" y="56" textAnchor="middle" className="ring-text">
        {pct}%
      </text>
    </svg>
  )
}

function Sparkline({ values, label }: { values: number[]; label: string }) {
  const W = 160
  const H = 40
  const max = Math.max(1, ...values)
  const step = W / values.length
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {values.map((v, i) => (
        <rect key={i} x={i * step + 1} width={Math.max(1, step - 2)} y={H - (v / max) * (H - 2) - 1} height={(v / max) * (H - 2) + 1} rx="1.5" />
      ))}
    </svg>
  )
}

function FocusWidget() {
  const [stats, setStats] = useState<FocusStats | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    api.focusStats(7).then(
      (s) => live && setStats(s),
      () => live && setFailed(true),
    )
    return () => {
      live = false
    }
  }, [])
  if (failed) return <p className="widget-empty">Focus statistics are unavailable right now.</p>
  if (!stats) return <p className="widget-empty">Loading…</p>
  if (stats.totalSessions === 0 && stats.todaySeconds === 0)
    return <p className="widget-empty">No focus sessions yet. Start a timer to build your history.</p>
  return (
    <dl className="mini-kpis">
      <div><dt>Today</dt><dd>{formatMinutes(Math.round(stats.todaySeconds / 60))}</dd></div>
      <div><dt>Sessions today</dt><dd>{stats.todaySessions}</dd></div>
      <div><dt>Streak</dt><dd>{stats.currentStreak} day{stats.currentStreak === 1 ? '' : 's'}</dd></div>
    </dl>
  )
}

function ProductivityWidget() {
  const [data, setData] = useState<Analytics | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    api.analytics(14).then(
      (d) => live && setData(d),
      () => live && setFailed(true),
    )
    return () => {
      live = false
    }
  }, [])
  if (failed) return <p className="widget-empty">Productivity numbers are unavailable right now.</p>
  if (!data) return <p className="widget-empty">Loading…</p>
  if (data.total === 0) return <p className="widget-empty">Complete a few tasks and your trends will appear here.</p>
  const done = data.daily.map((d) => d.completed)
  return (
    <>
      <dl className="mini-kpis">
        <div><dt>Done today</dt><dd>{data.completedToday}</dd></div>
        <div><dt>This week</dt><dd>{data.completedThisWeek}</dd></div>
        <div><dt>Streak</dt><dd>{data.bestStreak ? `${data.currentStreak ?? 0} day${data.currentStreak === 1 ? '' : 's'}` : '—'}</dd></div>
      </dl>
      <Sparkline values={done} label={`Tasks completed per day over the last ${done.length} days: ${done.reduce((a, b) => a + b, 0)} in total`} />
    </>
  )
}

export function DashboardPage() {
  const store = useTaskFlow()
  const today = useToday()
  const editor = useTaskEditor()
  const { settings, update } = useSettings()
  const [customizing, setCustomizing] = useState(false)

  const data = useMemo(() => {
    const open = store.tasks.filter((t) => !t.isCompleted)
    const byDue = (a: Task, b: Task) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || (a.dueTime ?? '').localeCompare(b.dueTime ?? '') || a.id - b.id
    const weekEnd = addDays(today, 7)
    return {
      today: open.filter((t) => t.dueDate === today).sort(byDue),
      upcoming: open.filter((t) => t.dueDate && t.dueDate > today && t.dueDate <= weekEnd).sort(byDue),
      overdue: open.filter((t) => t.dueDate && t.dueDate < today).sort(byDue),
      high: open
        .filter((t) => t.priority === 'High' || t.priority === 'Urgent')
        .sort((a, b) => Number(b.priority === 'Urgent') - Number(a.priority === 'Urgent') || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.id - b.id),
      doneToday: store.tasks.filter((t) => t.completedAt && toISO(new Date(t.completedAt)) === today).length,
    }
  }, [store.tasks, today])

  const total = store.tasks.length
  const completed = store.tasks.filter((t) => t.isCompleted).length
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100)
  const on = (id: WidgetId) => settings.widgets[id]
  const anyOn = WIDGETS.some((w) => on(w.id))

  return (
    <section aria-label="Dashboard" className="dashboard">
      <PageHeader title={greeting()} subtitle={formatLongDate(today)}>
        <button type="button" className="primary" onClick={() => editor.open({})}>
          <Icon name="plus" /> New task
        </button>
        <button type="button" aria-expanded={customizing} onClick={() => setCustomizing((v) => !v)}>
          <Icon name="settings" /> Customize
        </button>
      </PageHeader>

      <p className="quick-hint">
        Press <kbd>Q</kbd> to quick-add — try <em>“Call Sam tomorrow 5pm !high #work”</em>. <kbd>Ctrl</kbd> <kbd>K</kbd> opens the command palette.
      </p>

      {customizing && (
        <div className="card customize" role="group" aria-label="Dashboard widgets">
          <strong>Show on the dashboard</strong>
          <div className="customize-grid">
            {WIDGETS.map((w) => (
              <label key={w.id} className="check">
                <input
                  type="checkbox"
                  aria-label={`Show ${w.label}`}
                  checked={on(w.id)}
                  onChange={(e) => update({ widgets: { ...settings.widgets, [w.id]: e.target.checked } })}
                />
                {w.label}
              </label>
            ))}
          </div>
        </div>
      )}

      {store.loading ? (
        <Skeleton rows={4} label="Loading dashboard…" />
      ) : !anyOn ? (
        <EmptyState icon="dashboard" title="All widgets are hidden">
          Use Customize to bring some back.
        </EmptyState>
      ) : (
        <div className="widget-grid">
          {on('today') && (
            <Widget id="today" title="Today" link={{ route: 'today', label: 'Open Today' }}>
              <MiniList tasks={data.today} today={today} route="today" more="due today" empty="Nothing due today." />
            </Widget>
          )}
          {on('overdue') && (
            <Widget id="overdue" title="Overdue" link={{ route: 'today', label: 'Open Today' }}>
              <MiniList tasks={data.overdue} today={today} route="today" more="overdue" empty="Nothing is overdue." />
            </Widget>
          )}
          {on('upcoming') && (
            <Widget id="upcoming" title="Upcoming (next 7 days)" link={{ route: 'upcoming', label: 'Open Upcoming' }}>
              <MiniList tasks={data.upcoming} today={today} route="upcoming" more="upcoming" empty="Nothing due in the next week." />
            </Widget>
          )}
          {on('high') && (
            <Widget id="high" title="High priority" link={{ route: 'tasks', label: 'All tasks' }}>
              <MiniList tasks={data.high} today={today} route="tasks" more="high-priority" empty="No open High or Urgent tasks." />
            </Widget>
          )}
          {on('progress') && (
            <Widget id="progress" title="Completion progress">
              {total === 0 ? (
                <p className="widget-empty">No tasks yet — add one with Q.</p>
              ) : (
                <div className="progress-row">
                  <Ring pct={pct} label={`${completed} of ${total} tasks completed`} />
                  <p>
                    <strong>{completed}</strong> of {total} tasks done
                    <br />
                    <span className="hint">{data.doneToday} completed today · {total - completed} open</span>
                  </p>
                </div>
              )}
            </Widget>
          )}
          {on('focus') && (
            <Widget id="focus" title="Focus" link={{ route: 'focus', label: 'Open Focus' }}>
              <FocusWidget />
            </Widget>
          )}
          {on('productivity') && (
            <Widget id="productivity" title="Productivity" link={{ route: 'analytics', label: 'Full analytics' }}>
              <ProductivityWidget />
            </Widget>
          )}
          {on('shortcuts') && (
            <Widget id="shortcuts" title="Shortcuts" link={{ route: 'settings', param: 'shortcuts', label: 'All shortcuts' }}>
              <ul className="shortcut-hints">
                <li><kbd>Q</kbd> quick add</li>
                <li><kbd>N</kbd> new task</li>
                <li><kbd>Ctrl</kbd> <kbd>K</kbd> command palette</li>
                <li><kbd>G</kbd> then <kbd>C</kbd> calendar</li>
                <li><kbd>?</kbd> all shortcuts</li>
              </ul>
            </Widget>
          )}
        </div>
      )}
    </section>
  )
}
