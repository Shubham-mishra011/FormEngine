import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { Category, Priority, Task, TaskInput } from '../api'

interface Props {
  categories: Category[]
  initial?: Task
  submitLabel: string
  onSubmit: (input: TaskInput) => Promise<string | null>
  onCancel?: () => void
}

/** Used both for adding a task and for editing an existing one. */
export function TaskForm({ categories, initial, submitLabel, onSubmit, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [priority, setPriority] = useState<Priority>(initial?.priority ?? 'Medium')
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '')
  const [categoryId, setCategoryId] = useState<string>(initial?.categoryId?.toString() ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    if (!title.trim()) {
      setError('Title is required.')
      titleRef.current?.focus()
      return
    }
    setBusy(true)
    const err = await onSubmit({
      title: title.trim(),
      notes: notes.trim() || null,
      priority,
      dueDate: dueDate || null,
      categoryId: categoryId ? Number(categoryId) : null,
      isCompleted: initial?.isCompleted ?? false,
    })
    setBusy(false)
    if (err) {
      setError(err)
    } else if (!initial) {
      // Back to a clean slate so the next task never inherits the previous one's settings.
      setTitle('')
      setNotes('')
      setPriority('Medium')
      setDueDate('')
      setCategoryId('')
      setError(null)
      titleRef.current?.focus()
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key === 'Escape' && onCancel) onCancel()
  }

  return (
    <form className="task-form" onSubmit={handleSubmit} onKeyDown={handleKeyDown} noValidate>
      <input
        ref={titleRef}
        aria-label="Title"
        placeholder="What needs doing?"
        value={title}
        maxLength={200}
        autoFocus={!!initial}
        aria-invalid={error ? true : undefined}
        onChange={(e) => {
          setTitle(e.target.value)
          setError(null)
        }}
      />
      <textarea
        aria-label="Notes"
        placeholder="Notes (optional) — Ctrl+Enter to save"
        value={notes}
        maxLength={4000}
        rows={initial ? 3 : 1}
        onChange={(e) => setNotes(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) e.currentTarget.form?.requestSubmit()
        }}
      />
      <div className="form-row">
        <label>
          Priority
          <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            <option>Low</option>
            <option>Medium</option>
            <option>High</option>
          </select>
        </label>
        <label>
          Due
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
        <label>
          Category
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">None</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="primary" disabled={busy}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
