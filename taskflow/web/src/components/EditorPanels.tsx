import { useCallback, useEffect, useRef, useState } from 'react'
import { api, attachmentUrl, type Activity, type Attachment, type Frequency, type RecurrenceInput, type Tag } from '../api'
import { weekdayShort } from '../dates'
import { formatSize } from '../format'
import { describeRecurrence, formatMonthDays, parseMonthDays } from '../recurrence'
import { Icon } from './Icon'

// ------------------------------------------------------------------ tags

export function TagPicker({
  tags, selected, onChange, onCreate,
}: {
  tags: Tag[]
  selected: number[]
  onChange: (ids: number[]) => void
  onCreate?: (name: string) => Promise<string | null>
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function create() {
    if (!name.trim() || !onCreate) return
    const err = await onCreate(name.trim())
    if (err) setError(err)
    else {
      setName('')
      setError(null)
    }
  }

  return (
    <div className="tag-picker" role="group" aria-label="Tags">
      {tags.length === 0 && <span className="hint">No tags yet — create one below.</span>}
      {tags.map((t) => {
        const on = selected.includes(t.id)
        return (
          <button
            key={t.id}
            type="button"
            className={`tag-chip${on ? ' on' : ''}`}
            style={{ ['--tag' as string]: t.color }}
            aria-pressed={on}
            onClick={() => onChange(on ? selected.filter((x) => x !== t.id) : [...selected, t.id])}
          >
            <span className="dot" />#{t.name}
          </button>
        )
      })}
      {onCreate && (
        <span className="tag-new">
          <input
            aria-label="New tag name"
            placeholder="New tag"
            value={name}
            maxLength={30}
            onChange={(e) => { setName(e.target.value); setError(null) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void create()
              }
            }}
          />
          <button type="button" onClick={() => void create()}>Add tag</button>
        </span>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  )
}

// ------------------------------------------------------------------ reminders

const PRESETS: { minutes: number; label: string }[] = [
  { minutes: 0, label: 'At due time' },
  { minutes: 10, label: '10 min before' },
  { minutes: 30, label: '30 min before' },
  { minutes: 60, label: '1 hour before' },
  { minutes: 1440, label: '1 day before' },
]

export interface ReminderDraft {
  relative: number[]
  absolute: string[] // ISO instants
}

export function RemindersEditor({
  value, onChange, hasDueDate,
}: { value: ReminderDraft; onChange: (v: ReminderDraft) => void; hasDueDate: boolean }) {
  const [custom, setCustom] = useState('')
  const [at, setAt] = useState('')
  const toggle = (m: number) =>
    onChange({ ...value, relative: value.relative.includes(m) ? value.relative.filter((x) => x !== m) : [...value.relative, m].sort((a, b) => a - b) })

  function addCustom() {
    const n = Number(custom)
    if (!Number.isInteger(n) || n < 0 || n > 525600) return
    if (!value.relative.includes(n)) onChange({ ...value, relative: [...value.relative, n].sort((a, b) => a - b) })
    setCustom('')
  }
  function addAt() {
    if (!at) return
    const iso = new Date(at).toISOString()
    if (!value.absolute.includes(iso)) onChange({ ...value, absolute: [...value.absolute, iso] })
    setAt('')
  }
  const extraRelative = value.relative.filter((m) => !PRESETS.some((p) => p.minutes === m))

  return (
    <fieldset className="reminders">
      <legend>Reminders</legend>
      {!hasDueDate && <p className="hint">Set a due date to use reminders relative to it, or pick an exact time below.</p>}
      <div className="chip-row">
        {PRESETS.map((p) => (
          <button
            key={p.minutes}
            type="button"
            className={`chip${value.relative.includes(p.minutes) ? ' on' : ''}`}
            aria-pressed={value.relative.includes(p.minutes)}
            disabled={!hasDueDate}
            onClick={() => toggle(p.minutes)}
          >
            {p.label}
          </button>
        ))}
        {extraRelative.map((m) => (
          <button key={m} type="button" className="chip on" aria-pressed="true" onClick={() => toggle(m)} title="Click to remove">
            {m} min before ×
          </button>
        ))}
        {value.absolute.map((iso) => (
          <button
            key={iso}
            type="button"
            className="chip on"
            aria-pressed="true"
            title="Click to remove"
            onClick={() => onChange({ ...value, absolute: value.absolute.filter((x) => x !== iso) })}
          >
            {new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} ×
          </button>
        ))}
      </div>
      <div className="form-row">
        <label>
          Custom (minutes before)
          <span className="inline">
            <input type="number" min={0} max={525600} value={custom} disabled={!hasDueDate} onChange={(e) => setCustom(e.target.value)} />
            <button type="button" disabled={!hasDueDate || custom === ''} onClick={addCustom}>Add</button>
          </span>
        </label>
        <label>
          At an exact time
          <span className="inline">
            <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
            <button type="button" disabled={!at} onClick={addAt}>Add</button>
          </span>
        </label>
      </div>
    </fieldset>
  )
}

// ------------------------------------------------------------------ recurrence

export const defaultRecurrence: RecurrenceInput = { frequency: 'Weekly', interval: 1, weekdays: [], monthDays: [], endDate: null, maxOccurrences: null }

export function RecurrenceEditor({
  value, onChange, onStop,
}: {
  value: RecurrenceInput
  onChange: (v: RecurrenceInput) => void
  /** For an existing repeating task: ends the series now. */
  onStop?: () => void
}) {
  const [monthText, setMonthText] = useState(formatMonthDays(value.monthDays ?? []))
  const [monthError, setMonthError] = useState(false)
  const end = value.endDate ? 'date' : value.maxOccurrences ? 'count' : 'never'
  const set = (patch: Partial<RecurrenceInput>) => onChange({ ...value, ...patch })

  return (
    <fieldset className="recurrence">
      <legend>Repeat</legend>
      <div className="form-row">
        <label>
          Every
          <input
            type="number"
            min={1}
            max={99}
            aria-label="Repeat interval"
            value={value.interval}
            onChange={(e) => set({ interval: Math.min(99, Math.max(1, Number(e.target.value) || 1)) })}
          />
        </label>
        <label>
          Unit
          <select aria-label="Repeat frequency" value={value.frequency} onChange={(e) => set({ frequency: e.target.value as Frequency })}>
            <option value="Daily">day(s)</option>
            <option value="Weekly">week(s)</option>
            <option value="Monthly">month(s)</option>
            <option value="Yearly">year(s)</option>
          </select>
        </label>
        <label>
          Ends
          <select
            aria-label="Repeat ends"
            value={end}
            onChange={(e) =>
              set(
                e.target.value === 'never'
                  ? { endDate: null, maxOccurrences: null }
                  : e.target.value === 'date'
                    ? { endDate: value.endDate ?? '', maxOccurrences: null }
                    : { endDate: null, maxOccurrences: value.maxOccurrences ?? 10 },
              )
            }
          >
            <option value="never">Never</option>
            <option value="date">On a date</option>
            <option value="count">After a number of times</option>
          </select>
        </label>
        {end === 'date' && (
          <label>
            End date
            <input type="date" aria-label="Repeat end date" value={value.endDate ?? ''} onChange={(e) => set({ endDate: e.target.value || null })} />
          </label>
        )}
        {end === 'count' && (
          <label>
            Times
            <input
              type="number"
              min={1}
              aria-label="Repeat maximum occurrences"
              value={value.maxOccurrences ?? ''}
              onChange={(e) => set({ maxOccurrences: e.target.value ? Math.max(1, Number(e.target.value)) : null })}
            />
          </label>
        )}
      </div>

      {value.frequency === 'Weekly' && (
        <div className="chip-row" role="group" aria-label="Repeat on weekdays">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => {
            const on = value.weekdays?.includes(d) ?? false
            return (
              <button
                key={d}
                type="button"
                className={`chip${on ? ' on' : ''}`}
                aria-pressed={on}
                onClick={() => set({ weekdays: on ? value.weekdays!.filter((x) => x !== d) : [...(value.weekdays ?? []), d] })}
              >
                {weekdayShort(d)}
              </button>
            )
          })}
          <span className="hint">None selected = the same weekday as the due date.</span>
        </div>
      )}
      {value.frequency === 'Monthly' && (
        <label>
          Days of the month
          <input
            aria-label="Days of the month"
            placeholder="e.g. 1, 15, last (blank = same day as due date)"
            value={monthText}
            aria-invalid={monthError || undefined}
            onChange={(e) => {
              setMonthText(e.target.value)
              const parsed = parseMonthDays(e.target.value)
              setMonthError(parsed === null)
              if (parsed) set({ monthDays: parsed })
            }}
          />
          <span className="hint">Short months use their last day (31 → Feb 28/29).</span>
        </label>
      )}
      <p className="hint recurrence-summary">{describeRecurrence(value)}</p>
      {onStop && (
        <button type="button" className="danger" onClick={onStop}>
          Stop repeating
        </button>
      )}
    </fieldset>
  )
}

// ------------------------------------------------------------------ attachments

export function AttachmentsPanel({ taskId, onChanged }: { taskId: number; onChanged: () => void }) {
  const [items, setItems] = useState<Attachment[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      setItems(await api.listAttachments(taskId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load attachments.')
    }
  }, [taskId])
  useEffect(() => {
    void load()
  }, [load])

  async function upload(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      await api.uploadAttachment(taskId, file)
      await load()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  async function remove(a: Attachment) {
    try {
      await api.deleteAttachment(a.id)
      await load()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete.')
    }
  }

  return (
    <div className="attachments">
      <p className="hint">Files are stored on this computer (max 10 MB each, 20 per task). Documents, images, text and archives are accepted.</p>
      <label className="button upload">
        <Icon name="paperclip" /> {busy ? 'Uploading…' : 'Attach a file'}
        <input ref={input} type="file" aria-label="Attach a file" className="sr-only" disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      {items === null ? (
        <p className="hint">Loading…</p>
      ) : items.length === 0 ? (
        <p className="hint">No attachments.</p>
      ) : (
        <ul className="attachment-list">
          {items.map((a) => (
            <li key={a.id}>
              <a href={attachmentUrl(a.id)} download={a.fileName}>{a.fileName}</a>
              <span className="hint">{formatSize(a.sizeBytes)}</span>
              <button type="button" className="icon danger" aria-label={`Remove attachment ${a.fileName}`} onClick={() => void remove(a)}>×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ activity

const KIND_LABEL: Record<string, string> = {
  Created: 'Created', Updated: 'Edited', Completed: 'Completed', Reopened: 'Reopened', StatusChanged: 'Moved',
  Rescheduled: 'Rescheduled', Pinned: 'Pinned', Unpinned: 'Unpinned', Favorited: 'Favorited', Unfavorited: 'Unfavorited',
  RecurrenceChanged: 'Repeat changed', RecurrenceStopped: 'Repeat stopped', SeriesEnded: 'Series ended', Focus: 'Focus session',
  AttachmentAdded: 'File attached', AttachmentRemoved: 'File removed', Bulk: 'Bulk change', Imported: 'Imported',
}

export function ActivityPanel({ taskId }: { taskId: number }) {
  const [items, setItems] = useState<Activity[] | null>(null)
  useEffect(() => {
    let live = true
    api.taskActivity(taskId).then((a) => live && setItems(a), () => live && setItems([]))
    return () => { live = false }
  }, [taskId])

  if (items === null) return <p className="hint">Loading…</p>
  if (items.length === 0) return <p className="hint">No activity yet.</p>
  return (
    <ol className="activity-list">
      {items.map((a) => (
        <li key={a.id}>
          <strong>{KIND_LABEL[a.kind] ?? a.kind}</strong>
          {a.detail && <span> — {a.detail}</span>}
          <time dateTime={a.at}>{new Date(a.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</time>
        </li>
      ))}
    </ol>
  )
}
