import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { parseQuickAdd } from '../quickAdd'
import { useSettings } from '../useSettings'
import { useToday, useTaskFlow } from '../useTaskFlow'
import { useToast } from '../useToast'
import { Icon } from './Icon'

export const QUICK_ADD_EVENT = 'taskflow:quick-add'

/** Always-visible one-line task entry. Understands dates, times, !priority, #tags, @category and "every …". */
export function QuickAdd() {
  const store = useTaskFlow()
  const { settings } = useSettings()
  const { toast } = useToast()
  const today = useToday()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const focus = () => ref.current?.focus()
    window.addEventListener(QUICK_ADD_EVENT, focus)
    return () => window.removeEventListener(QUICK_ADD_EVENT, focus)
  }, [])

  const parsed = useMemo(() => parseQuickAdd(text, { tags: store.tags, categories: store.categories, today }), [text, store.tags, store.categories, today])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    if (!parsed.title.trim()) {
      setError('Type a task title first.')
      return
    }
    setBusy(true)
    const err = await store.createTask({
      title: parsed.title,
      priority: parsed.priority ?? settings.defaultPriority,
      dueDate: parsed.dueDate,
      dueTime: parsed.dueTime,
      categoryId: parsed.categoryId,
      tagIds: parsed.tagIds,
      estimatedMinutes: parsed.estimatedMinutes,
      recurrence: parsed.recurrence,
      reminders: parsed.dueDate && settings.defaultReminder !== null ? [{ minutesBefore: settings.defaultReminder }] : undefined,
    })
    setBusy(false)
    if (err) {
      setError(err)
      return
    }
    toast(`Added "${parsed.title}".`)
    setText('')
    setError(null)
    ref.current?.focus()
  }

  return (
    <form className="quick-add" onSubmit={submit} noValidate role="search" aria-label="Quick add">
      <Icon name="plus" />
      <input
        ref={ref}
        aria-label="Quick add task"
        placeholder='Quick add — "Call Sam tomorrow 5pm !high #work"   (Q)'
        value={text}
        maxLength={300}
        aria-invalid={error ? true : undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => { setText(e.target.value); setError(null) }}
        onKeyDown={(e) => { if (e.key === 'Escape') { setText(''); ref.current?.blur() } }}
      />
      <button type="submit" className="primary" disabled={busy}>Add</button>
      {(error || (focused && parsed.summary.length > 0)) && (
        <div className="quick-preview" role={error ? 'alert' : undefined}>
          {error ? (
            <span className="form-error">{error}</span>
          ) : (
            parsed.summary.map((s, i) => <span key={i} className="chip on static">{s}</span>)
          )}
        </div>
      )}
    </form>
  )
}
