import { useCallback, useEffect, useState } from 'react'
import { api, type FocusKind, type FocusSession, type FocusStats } from '../api'
import { clock, formatDate } from '../dates'
import { EmptyState, PageHeader } from '../components/Feedback'
import { Icon } from '../components/Icon'
import { ConfirmDialog } from '../components/Modal'
import { KIND_LABEL } from '../focus/timerState'
import { useFocus } from '../focus/FocusProvider'
import { notificationPermission, requestNotificationPermission } from '../sound'
import { useSettings } from '../useSettings'
import { useTaskFlow } from '../useTaskFlow'
import '../focus/focus.css'

const KINDS: FocusKind[] = ['Focus', 'ShortBreak', 'LongBreak']

export function minutesLabel(seconds: number): string {
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${m % 60} min`
}

function Ring({ fraction, children }: { fraction: number; children: React.ReactNode }) {
  const r = 90
  const c = 2 * Math.PI * r
  return (
    <div className="focus-ring">
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <circle className="ring-track" cx="100" cy="100" r={r} />
        <circle className="ring-value" cx="100" cy="100" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, Math.max(0, fraction)))} transform="rotate(-90 100 100)" />
      </svg>
      <div className="ring-label">{children}</div>
    </div>
  )
}

function Chart({ daily }: { daily: FocusStats['daily'] }) {
  const max = Math.max(60, ...daily.map((d) => d.seconds))
  const w = 640
  const h = 180
  const bw = w / daily.length
  return (
    <figure className="chart focus-chart">
      <figcaption className="sr-only">Focus minutes per day, last {daily.length} days</figcaption>
      <div className="chart-scroll">
        <svg viewBox={`0 0 ${w} ${h + 22}`} role="img" aria-label={`Focus minutes per day over the last ${daily.length} days`}>
          <line className="grid" x1="0" x2={w} y1={h} y2={h} />
          {daily.map((d, i) => {
            const bh = (d.seconds / max) * (h - 16)
            return (
              <g key={d.date}>
                <rect className="bar" x={i * bw + 4} width={bw - 8} y={h - bh} height={bh} rx="3">
                  <title>{`${d.date}: ${minutesLabel(d.seconds)}`}</title>
                </rect>
                <text className="axis" x={i * bw + bw / 2} y={h + 15} textAnchor="middle">{d.date.slice(8)}</text>
              </g>
            )
          })}
        </svg>
      </div>
      <details>
        <summary>View as table</summary>
        <table className="data-table">
          <thead><tr><th scope="col">Day</th><th scope="col" className="num">Focus</th><th scope="col" className="num">Sessions</th></tr></thead>
          <tbody>
            {daily.map((d) => (
              <tr key={d.date}><th scope="row">{d.date}</th><td className="num">{minutesLabel(d.seconds)}</td><td className="num">{d.sessions}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

export function FocusPage() {
  const f = useFocus()
  const store = useTaskFlow()
  const { settings } = useSettings()
  const [stats, setStats] = useState<FocusStats | null>(null)
  const [sessions, setSessions] = useState<FocusSession[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<FocusSession | null>(null)
  const [perm, setPerm] = useState(notificationPermission())

  const load = useCallback(async () => {
    try {
      const [s, list] = await Promise.all([api.focusStats(14), api.focusSessions(30, 50)])
      setStats(s)
      setSessions(list)
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load focus data.')
    }
  }, [])
  useEffect(() => { void load() }, [load, f.sessionsVersion])

  // #/focus?task=ID would be handled here, but the route parser only knows #/focus; startFor() is the supported entry.
  const idle = f.state.status === 'idle'
  const running = f.state.status === 'running'
  const openTasks = store.tasks.filter((t) => !t.isCompleted)
  const fraction = f.planned === 0 ? 0 : 1 - f.remaining / f.planned
  const isBreak = f.state.kind !== 'Focus'
  const taskTitle = store.tasks.find((t) => t.id === f.state.taskId)?.title

  return (
    <section aria-label="Focus" className="focus-page">
      <PageHeader title="Focus" subtitle="Work in timed sessions, with breaks in between." />

      {f.awayNotice && (
        <div className="notice" role="status">
          <span>{f.awayNotice}</span>
          <button type="button" onClick={f.dismissNotice}>Dismiss</button>
        </div>
      )}
      {f.error && (
        <div className="banner" role="alert">
          <span>{f.error}</span>
          {f.pendingCount > 0 && <button type="button" onClick={() => void f.retryPending()}>Retry saving ({f.pendingCount})</button>}
        </div>
      )}

      <div className="card focus-card">
        <div className="tabs" role="tablist" aria-label="Timer mode">
          {KINDS.map((k) => (
            <button key={k} role="tab" type="button" aria-selected={f.state.kind === k} className={f.state.kind === k ? 'on' : ''} disabled={!idle && f.state.kind !== k} onClick={() => f.setKind(k)}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>

        <Ring fraction={idle ? 0 : fraction}>
          <span className="ring-time" role="timer" aria-live="off" aria-label={`${clock(f.remaining)} remaining`}>{clock(f.remaining)}</span>
          <span className="ring-sub">{f.state.status === 'paused' ? 'Paused' : running ? KIND_LABEL[f.state.kind] : 'Ready'}</span>
        </Ring>

        {!isBreak && (
          <label className="focus-task">
            Working on
            <select aria-label="Task for this session" value={f.state.taskId ?? ''} onChange={(e) => f.setTask(e.target.value ? Number(e.target.value) : null)}>
              <option value="">No specific task</option>
              {openTasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              {f.state.taskId !== null && !openTasks.some((t) => t.id === f.state.taskId) && taskTitle && <option value={f.state.taskId}>{taskTitle}</option>}
            </select>
          </label>
        )}

        <div className="focus-controls">
          {idle && <button type="button" className="primary" onClick={() => f.start()}><Icon name="play" /> Start</button>}
          {running && <button type="button" onClick={f.pause}><Icon name="pause" /> Pause</button>}
          {f.state.status === 'paused' && <button type="button" className="primary" onClick={f.resume}><Icon name="play" /> Resume</button>}
          {!idle && <button type="button" onClick={() => void f.stopAndLog()}>Stop &amp; log</button>}
          {!idle && <button type="button" onClick={f.reset}><Icon name="reset" /> Reset</button>}
          {isBreak && <button type="button" onClick={f.skip}>Skip break</button>}
        </div>
        <p className="hint focus-note">
          Stop &amp; log saves a partial session (if at least a minute passed). Reset throws the current run away without saving.
          Sessions completed in this cycle: {f.state.completedFocusCount}. Long break every {settings.sessionsBeforeLongBreak} sessions.
        </p>
        <p className="hint focus-note">
          The timer is calculated from the clock, but a browser may pause background tabs — keep this tab open for alerts.
        </p>
        {perm !== 'unsupported' && perm !== 'granted' && (
          <p className="hint">
            {perm === 'denied'
              ? 'Browser notifications are blocked for this site in your browser settings.'
              : <button type="button" onClick={async () => setPerm(await requestNotificationPermission())}>Enable notifications</button>}
          </p>
        )}
      </div>

      {loadError && <div className="banner" role="alert"><span>{loadError}</span><button type="button" onClick={() => void load()}>Retry</button></div>}

      {stats && (
        <>
          <dl className="kpis focus-kpis">
            <div className="kpi"><dt>Today</dt><dd>{minutesLabel(stats.todaySeconds)}</dd><span className="kpi-hint">{stats.todaySessions} completed session{stats.todaySessions === 1 ? '' : 's'}</span></div>
            <div className="kpi"><dt>This week</dt><dd>{minutesLabel(stats.weekSeconds)}</dd></div>
            <div className="kpi"><dt>All time</dt><dd>{minutesLabel(stats.totalSeconds)}</dd><span className="kpi-hint">{stats.totalSessions} sessions</span></div>
            <div className="kpi"><dt>Streak</dt><dd>{stats.currentStreak} day{stats.currentStreak === 1 ? '' : 's'}</dd><span className="kpi-hint">Best {stats.bestStreak}</span></div>
            <div className="kpi"><dt>Avg session</dt><dd>{stats.averageSessionMinutes ? `${stats.averageSessionMinutes} min` : '—'}</dd></div>
          </dl>
          <h3>Last {stats.daily.length} days</h3>
          <Chart daily={stats.daily} />
          {stats.topTasks.length > 0 && (
            <>
              <h3>Most focused tasks</h3>
              <ul className="split">
                {stats.topTasks.map((t) => (
                  <li key={t.taskId}><div className="split-head"><span className="split-name">{t.title}</span><span className="split-num">{minutesLabel(t.seconds)} · {t.sessions}</span></div></li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      <h3>Session history</h3>
      {sessions === null ? (
        <p className="hint">Loading…</p>
      ) : sessions.length === 0 ? (
        <EmptyState icon="focus" title="No sessions yet">Start the timer and finished sessions will be listed here.</EmptyState>
      ) : (
        <ul className="session-list">
          {sessions.map((s) => (
            <li key={s.id} className="card session-row">
              <span className={`kind-pill k-${s.kind}`}>{KIND_LABEL[s.kind]}</span>
              <span className="session-main">
                <strong>{minutesLabel(s.actualSeconds)}</strong>{s.completed ? '' : ' (stopped early)'}
                {s.taskTitle && <span className="hint"> · {s.taskTitle}</span>}
              </span>
              <time className="hint" dateTime={s.startedAt}>{formatDate(s.startedAt.slice(0, 10), settings.dateFormat)} {new Date(s.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
              <button type="button" className="icon-btn danger" aria-label={`Delete ${KIND_LABEL[s.kind].toLowerCase()} session of ${minutesLabel(s.actualSeconds)}`} onClick={() => setDeleting(s)}><Icon name="trash" /></button>
            </li>
          ))}
        </ul>
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete session?"
          message={`Remove this ${minutesLabel(deleting.actualSeconds)} ${KIND_LABEL[deleting.kind].toLowerCase()} from your history and statistics?`}
          confirmLabel="Delete"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            const s = deleting
            setDeleting(null)
            try { await api.deleteFocusSession(s.id) } catch (e) { setLoadError(e instanceof Error ? e.message : 'Could not delete.') }
            await load()
          }}
        />
      )}
    </section>
  )
}
