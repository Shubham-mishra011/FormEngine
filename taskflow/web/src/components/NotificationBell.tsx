import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Task, type UpcomingReminder } from '../api'
import { formatDate, formatTime } from '../dates'
import { notificationPermission, requestNotificationPermission } from '../sound'
import { useNotifications } from '../useNotifications'
import { useSettings } from '../useSettings'
import { useTaskFlow } from '../useTaskFlow'
import { Icon } from './Icon'
import { useTaskEditor } from './TaskEditor'
import './notifications.css'

type Tab = 'notifications' | 'upcoming'

function ago(iso: string): string {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  if (min < 1440) return `${Math.round(min / 60)} h ago`
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function NotificationBell() {
  const n = useNotifications()
  const { settings, update } = useSettings()
  const store = useTaskFlow()
  const editor = useTaskEditor()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('notifications')
  const [upcoming, setUpcoming] = useState<{ upcoming: UpcomingReminder[]; overdueTasks: Task[] } | null>(null)
  const [upcomingError, setUpcomingError] = useState(false)
  const [perm, setPerm] = useState(notificationPermission())
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  const close = useCallback(() => { setOpen(false); button.current?.focus() }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }
    const onDown = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown) }
  }, [open, close])

  useEffect(() => {
    if (!open || tab !== 'upcoming') return
    let live = true
    api.upcomingReminders(7).then(
      (u) => { if (live) { setUpcoming(u); setUpcomingError(false) } },
      () => { if (live) setUpcomingError(true) },
    )
    return () => { live = false }
  }, [open, tab])

  function openTask(taskId: number | null) {
    const task = taskId === null ? undefined : store.tasks.find((t) => t.id === taskId)
    if (!task) return
    setOpen(false)
    editor.open({ task })
  }

  async function toggleBrowser(on: boolean) {
    if (!on) { update({ browserNotifications: false }); return }
    const p = await requestNotificationPermission()
    setPerm(p)
    if (p === 'granted') update({ browserNotifications: true })
  }

  const label = n.unread > 0 ? `Notifications, ${n.unread} unread` : 'Notifications'

  return (
    <div className="bell" ref={root}>
      <button ref={button} type="button" className="icon-btn bell-btn" aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name="bell" />
        {n.unread > 0 && <span className="bell-badge" aria-hidden="true">{n.unread > 99 ? '99+' : n.unread}</span>}
      </button>

      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications panel">
          <div className="tabs" role="tablist" aria-label="Notification sections">
            <button type="button" role="tab" aria-selected={tab === 'notifications'} className={tab === 'notifications' ? 'on' : ''} onClick={() => setTab('notifications')}>Notifications</button>
            <button type="button" role="tab" aria-selected={tab === 'upcoming'} className={tab === 'upcoming' ? 'on' : ''} onClick={() => setTab('upcoming')}>Upcoming</button>
          </div>
          {n.offline && <p className="hint bell-offline" role="status">Can’t reach the server — showing the last known state.</p>}

          {tab === 'notifications' && (
            <>
              <div className="bell-actions">
                <button type="button" disabled={n.unread === 0} onClick={() => void n.markAllRead()}>Mark all read</button>
                <button type="button" disabled={n.items.length === 0} onClick={() => void n.dismissAll()}>Dismiss all</button>
              </div>
              {n.items.length === 0 ? (
                <p className="hint bell-empty">{n.loaded ? 'You’re all caught up.' : 'Loading…'}</p>
              ) : (
                <ul className="bell-list">
                  {n.items.map((it) => (
                    <li key={it.id} className={`bell-item${it.readAt ? '' : ' unread'} kind-${it.kind}`}>
                      <div className="bell-main">
                        {it.taskId !== null && store.tasks.some((t) => t.id === it.taskId) ? (
                          <button type="button" className="linklike bell-title" onClick={() => openTask(it.taskId)}>{it.title}</button>
                        ) : (
                          <span className="bell-title">{it.title}</span>
                        )}
                        {it.message && <span className="hint">{it.message}</span>}
                        <time className="hint" dateTime={it.createdAt}>{ago(it.createdAt)}</time>
                      </div>
                      <button type="button" className="icon-btn" aria-label={`Mark "${it.title}" as ${it.readAt ? 'unread' : 'read'}`} title={it.readAt ? 'Mark unread' : 'Mark read'} onClick={() => void n.markRead(it.id, !it.readAt)}>
                        <Icon name="check" />
                      </button>
                      <button type="button" className="icon-btn danger" aria-label={`Dismiss "${it.title}"`} title="Dismiss" onClick={() => void n.dismiss(it.id)}>
                        <Icon name="close" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {tab === 'upcoming' && (
            <div className="bell-upcoming">
              {upcomingError && <p className="form-error" role="alert">Could not load upcoming reminders.</p>}
              {!upcoming && !upcomingError && <p className="hint">Loading…</p>}
              {upcoming && (
                <>
                  <h3>Next 7 days</h3>
                  {upcoming.upcoming.length === 0 ? <p className="hint">No reminders are scheduled.</p> : (
                    <ul className="bell-list">
                      {upcoming.upcoming.map((u) => (
                        <li key={u.reminderId} className="bell-item">
                          <div className="bell-main">
                            <button type="button" className="linklike bell-title" onClick={() => openTask(u.taskId)}>{u.taskTitle}</button>
                            <span className="hint">
                              {new Date(u.remindAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                              {u.dueDate && ` · due ${formatDate(u.dueDate, settings.dateFormat)}${u.dueTime ? ` ${formatTime(u.dueTime, settings.timeFormat)}` : ''}`}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  <h3>Overdue</h3>
                  {upcoming.overdueTasks.length === 0 ? <p className="hint">Nothing is overdue.</p> : (
                    <ul className="bell-list">
                      {upcoming.overdueTasks.map((t) => (
                        <li key={t.id} className="bell-item kind-Overdue">
                          <div className="bell-main">
                            <button type="button" className="linklike bell-title" onClick={() => openTask(t.id)}>{t.title}</button>
                            <span className="hint">Was due {t.dueDate ? formatDate(t.dueDate, settings.dateFormat) : ''}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}

          <fieldset className="bell-prefs">
            <legend>Alerts</legend>
            <label className="check">
              <input type="checkbox" checked={settings.browserNotifications && perm === 'granted'} disabled={perm === 'unsupported' || perm === 'denied'} onChange={(e) => void toggleBrowser(e.target.checked)} /> Browser notifications
            </label>
            {perm === 'denied' && <span className="hint">Blocked in your browser settings.</span>}
            {perm === 'unsupported' && <span className="hint">Not supported by this browser.</span>}
            <label className="check"><input type="checkbox" checked={settings.notificationSound} onChange={(e) => update({ notificationSound: e.target.checked })} /> Sound</label>
            <label className="check"><input type="checkbox" checked={settings.overdueAlerts} onChange={(e) => update({ overdueAlerts: e.target.checked })} /> Overdue alerts</label>
          </fieldset>
          <p className="hint bell-footer">Reminders are checked while TaskFlow is open in a browser tab. Closed tab = no alerts until you open it again.</p>
        </div>
      )}
    </div>
  )
}
