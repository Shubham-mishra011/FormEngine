import { cloneElement, useEffect, useId, useState, type ReactElement } from 'react'
import { PRIORITIES, api, type About, type Priority } from '../api'
import { PageHeader } from '../components/Feedback'
import { ConfirmDialog } from '../components/Modal'
import { formatDate, formatTime, todayString, type DateFormat, type TimeFormat } from '../dates'
import { ShortcutTable } from '../shortcuts'
import { ROUTES, type Route } from '../useRoute'
import { WIDGETS, useSettings, type Settings } from '../useSettings'
import { useTheme, type ThemePreference } from '../useTheme'
import { DataPage } from './DataPage'
import './settings.css'

const SECTIONS = [
  { id: 'general', label: 'General' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'reminders', label: 'Reminders' },
  { id: 'focus', label: 'Focus timer' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'backup', label: 'Backup & data' },
  { id: 'shortcuts', label: 'Keyboard shortcuts' },
  { id: 'about', label: 'About' },
] as const
type SectionId = (typeof SECTIONS)[number]['id']

const ROUTE_LABEL: Record<Route, string> = {
  dashboard: 'Dashboard', tasks: 'My Tasks', inbox: 'Inbox', today: 'Today', upcoming: 'Upcoming', calendar: 'Calendar',
  kanban: 'Kanban', completed: 'Completed', categories: 'Categories', tags: 'Tags', analytics: 'Analytics', focus: 'Focus', settings: 'Settings',
}

function toSection(s: string | null): SectionId {
  return (SECTIONS.find((x) => x.id === s)?.id ?? 'general') as SectionId
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactElement<{ id?: string }> }) {
  const id = useId()
  return (
    <div className="setting">
      <label className="setting-label" htmlFor={id}>
        {label}
      </label>
      {cloneElement(children, { id })}
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}

/** A number box that only commits valid values, and says so when the typed value is out of range. */
function NumberField({
  label, value, min, max, onCommit, hint,
}: { label: string; value: number; min: number; max: number; onCommit: (n: number) => void; hint?: string }) {
  const id = useId()
  const [draft, setDraft] = useState(String(value))
  const [bad, setBad] = useState(false)
  useEffect(() => setDraft(String(value)), [value])
  return (
    <div className="setting">
      <label className="setting-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        value={draft}
        aria-invalid={bad || undefined}
        onChange={(e) => {
          setDraft(e.target.value)
          const n = Number(e.target.value)
          const ok = e.target.value !== '' && Number.isInteger(n) && n >= min && n <= max
          setBad(!ok)
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        onBlur={() => {
          // Commit only a finished, valid value; a half-typed "18" on the way to "181" must not be saved.
          const n = Number(draft)
          if (draft !== '' && Number.isInteger(n) && n >= min && n <= max) onCommit(n)
          else setDraft(String(value))
          setBad(false)
        }}
      />
      <span className={bad ? 'form-error' : 'hint'} role={bad ? 'alert' : undefined}>
        {bad ? `Enter a whole number from ${min} to ${max}.` : hint ?? `${min}–${max}`}
      </span>
    </div>
  )
}

function Check({ label, checked, onChange, disabled, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  return (
    <div className="setting">
      <label className="check">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /> {label}
      </label>
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}

function General({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  const theme = useTheme()
  const today = todayString()
  return (
    <>
      <fieldset className="setting-group">
        <legend>Theme</legend>
        <div className="radio-row" role="radiogroup" aria-label="Theme">
          {(['light', 'dark', 'system'] as ThemePreference[]).map((t) => (
            <label key={t} className="check">
              <input type="radio" name="theme" checked={theme.preference === t} onChange={() => theme.choose(t)} />{' '}
              {t === 'system' ? 'Match system' : t[0].toUpperCase() + t.slice(1)}
            </label>
          ))}
        </div>
        <span className="hint">Stored in this browser. “Match system” follows your operating system and changes with it.</span>
      </fieldset>
      <Field label="Date format" hint={`Preview: ${formatDate(today, s.dateFormat, true)}`}>
        <select value={s.dateFormat} onChange={(e) => set({ dateFormat: e.target.value as DateFormat })}>
          <option value="auto">Automatic (browser language)</option>
          <option value="iso">2026-10-21</option>
          <option value="dmy">21 Oct</option>
          <option value="mdy">Oct 21</option>
        </select>
      </Field>
      <Field label="Time format" hint={`Preview: ${formatTime('14:30:00', s.timeFormat)}`}>
        <select value={s.timeFormat} onChange={(e) => set({ timeFormat: e.target.value as TimeFormat })}>
          <option value="auto">Automatic (browser language)</option>
          <option value="24h">24-hour</option>
          <option value="12h">12-hour</option>
        </select>
      </Field>
      <Field label="Week starts on" hint="Used by the calendar.">
        <select value={s.weekStart} onChange={(e) => set({ weekStart: Number(e.target.value) as 0 | 1 })}>
          <option value={1}>Monday</option>
          <option value={0}>Sunday</option>
        </select>
      </Field>
    </>
  )
}

function Tasks({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  return (
    <>
      <Field label="Default priority" hint="Used for new tasks unless you choose another.">
        <select value={s.defaultPriority} onChange={(e) => set({ defaultPriority: e.target.value as Priority })}>
          {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
        </select>
      </Field>
      <Field label="Default view" hint="The page TaskFlow opens on when no page is in the address.">
        <select value={s.defaultView} onChange={(e) => set({ defaultView: e.target.value as Route })}>
          {ROUTES.map((r) => <option key={r} value={r}>{ROUTE_LABEL[r]}</option>)}
        </select>
      </Field>
    </>
  )
}

type Permission = NotificationPermission | 'unsupported'
const permissionNow = (): Permission => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)

function Reminders({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  const [permission, setPermission] = useState<Permission>(permissionNow)

  async function ask() {
    if (typeof Notification === 'undefined') return
    const result = await Notification.requestPermission()
    setPermission(result)
    set({ browserNotifications: result === 'granted' })
  }

  const explain: Record<Permission, string> = {
    unsupported: 'This browser does not support notifications, so only in-app notifications are shown.',
    default: 'Not asked yet. Press the button to allow notifications from this site.',
    granted: 'Allowed. Notifications appear while TaskFlow is open in a browser tab.',
    denied: 'Blocked in the browser. Re-enable notifications for this site in the browser’s site settings, then reload.',
  }

  return (
    <>
      <Field label="Default reminder for new tasks with a due date">
        <select
          aria-label="Default reminder"
          value={s.defaultReminder === null ? '' : String(s.defaultReminder)}
          onChange={(e) => set({ defaultReminder: e.target.value === '' ? null : Number(e.target.value) })}
        >
          <option value="">None</option>
          <option value="0">At due time</option>
          <option value="10">10 minutes before</option>
          <option value="30">30 minutes before</option>
          <option value="60">1 hour before</option>
          <option value="1440">1 day before</option>
        </select>
      </Field>
      <Check label="Tell me about overdue tasks" checked={s.overdueAlerts} onChange={(v) => set({ overdueAlerts: v })} hint="One summary per day, plus timed tasks that pass their time." />
      <Check label="Play a sound for notifications" checked={s.notificationSound} onChange={(v) => set({ notificationSound: v })} />
      <fieldset className="setting-group">
        <legend>Browser notifications</legend>
        <p className="hint" data-testid="permission">Status: <strong>{permission}</strong>. {explain[permission]}</p>
        <div className="form-actions">
          <button type="button" onClick={() => void ask()} disabled={permission === 'unsupported' || permission === 'granted' || permission === 'denied'}>
            Allow browser notifications
          </button>
        </div>
        <Check
          label="Show reminders as browser notifications"
          checked={s.browserNotifications && permission === 'granted'}
          disabled={permission !== 'granted'}
          onChange={(v) => set({ browserNotifications: v })}
        />
        <p className="hint">
          Limitation: reminders are checked by the open TaskFlow page. If every TaskFlow tab is closed (or the browser suspends it),
          nothing can notify you until you open it again; missed reminders then appear in the notification list.
        </p>
      </fieldset>
    </>
  )
}

function Focus({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  return (
    <>
      <NumberField label="Focus session (minutes)" value={s.focusMinutes} min={1} max={180} onCommit={(n) => set({ focusMinutes: n })} />
      <NumberField label="Short break (minutes)" value={s.shortBreakMinutes} min={1} max={60} onCommit={(n) => set({ shortBreakMinutes: n })} />
      <NumberField label="Long break (minutes)" value={s.longBreakMinutes} min={1} max={120} onCommit={(n) => set({ longBreakMinutes: n })} />
      <NumberField label="Focus sessions before a long break" value={s.sessionsBeforeLongBreak} min={1} max={12} onCommit={(n) => set({ sessionsBeforeLongBreak: n })} />
      <Check label="Start the next session automatically" checked={s.autoStartNext} onChange={(v) => set({ autoStartNext: v })} />
      <Check label="Play a sound when a session ends" checked={s.focusSound} onChange={(v) => set({ focusSound: v })} />
      <Check label="Show a browser notification when a session ends" checked={s.focusBrowserNotification} onChange={(v) => set({ focusBrowserNotification: v })} hint="Needs browser permission (see Reminders)." />
    </>
  )
}

function DashboardPrefs({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  return (
    <fieldset className="setting-group">
      <legend>Widgets on the dashboard</legend>
      {WIDGETS.map((w) => (
        <Check key={w.id} label={w.label} checked={s.widgets[w.id]} onChange={(v) => set({ widgets: { ...s.widgets, [w.id]: v } })} />
      ))}
    </fieldset>
  )
}

function AboutSection() {
  const [about, setAbout] = useState<About | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    api.about().then((a) => live && setAbout(a), () => live && setFailed(true))
    return () => {
      live = false
    }
  }, [])
  return (
    <>
      {failed && <p className="banner" role="alert"><span>Could not load details from the server.</span></p>}
      {about ? (
        <dl className="about-list">
          <dt>Application</dt><dd>{about.name} {about.version}</dd>
          <dt>Database file</dt><dd><code>{about.databasePath}</code></dd>
          <dt>Backups folder</dt><dd><code>{about.backupDirectory}</code></dd>
          <dt>Attachments folder</dt><dd><code>{about.attachmentsDirectory}</code></dd>
          <dt>Server time zone</dt><dd>{about.timeZone}</dd>
          <dt>Attachment limit</dt><dd>{Math.round(about.maxAttachmentBytes / 1048576)} MB per file</dd>
        </dl>
      ) : (
        !failed && <p className="hint">Loading…</p>
      )}
      <h3>Known limitations</h3>
      <ul className="limits">
        <li>Single user, local only: there are no accounts and no sync. Keep the API bound to localhost.</li>
        <li>Reminders and browser notifications only fire while a TaskFlow page is open; nothing runs in the background.</li>
        <li>Attachments are stored as files in the folder above. They are not inside database backups or JSON exports.</li>
        <li>Search and filters run in your browser over all loaded tasks, which is fast for personal lists (thousands of tasks).</li>
        <li>“Today” and “overdue” use the computer’s local date; use TaskFlow on the same machine or time zone as the API.</li>
        <li>These preferences are saved in this browser only, not in the database or in backups.</li>
      </ul>
    </>
  )
}

export function SettingsPage({ section, onDataChanged }: { section: string | null; onDataChanged: () => void }) {
  const { settings, update, reset } = useSettings()
  const [current, setCurrent] = useState<SectionId>(toSection(section))
  const [confirmReset, setConfirmReset] = useState(false)
  useEffect(() => setCurrent(toSection(section)), [section])

  const go = (id: SectionId) => {
    setCurrent(id)
    window.location.hash = `#/settings/${id}`
  }
  const title = SECTIONS.find((x) => x.id === current)!.label

  return (
    <section aria-label="Settings" className="settings">
      <PageHeader title="Settings" subtitle="Preferences are stored in this browser." />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          <ul>
            {SECTIONS.map((x) => (
              <li key={x.id}>
                <a
                  href={`#/settings/${x.id}`}
                  aria-current={current === x.id ? 'page' : undefined}
                  onClick={(e) => {
                    e.preventDefault()
                    go(x.id)
                  }}
                >
                  {x.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="settings-body">
          {current !== 'backup' && <h3 className="settings-title">{title}</h3>}
          {current === 'general' && <General s={settings} set={update} />}
          {current === 'tasks' && <Tasks s={settings} set={update} />}
          {current === 'reminders' && <Reminders s={settings} set={update} />}
          {current === 'focus' && <Focus s={settings} set={update} />}
          {current === 'dashboard' && <DashboardPrefs s={settings} set={update} />}
          {current === 'backup' && <DataPage onDataChanged={onDataChanged} />}
          {current === 'shortcuts' && <ShortcutTable />}
          {current === 'about' && <AboutSection />}

          {current !== 'backup' && current !== 'about' && current !== 'shortcuts' && (
            <div className="reset-row">
              <button type="button" className="danger" onClick={() => setConfirmReset(true)}>
                Reset settings to defaults
              </button>
            </div>
          )}
        </div>
      </div>

      {confirmReset && (
        <ConfirmDialog
          title="Reset settings?"
          message="All preferences on this page (formats, defaults, reminders, focus timer, dashboard widgets) go back to their defaults. Your tasks and data are not touched."
          confirmLabel="Reset settings"
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            setConfirmReset(false)
            reset()
          }}
        />
      )}
    </section>
  )
}
