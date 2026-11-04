import { useState, type FormEvent, type KeyboardEvent } from 'react'
import type { Subtask } from '../api'

export interface SubtaskActions {
  onAdd: (title: string) => Promise<string | null>
  onToggle: (id: number) => void
  onRename: (id: number, title: string, isCompleted: boolean) => Promise<string | null>
  onDelete: (id: number) => void
}

interface Props extends SubtaskActions {
  taskTitle: string
  subtasks: Subtask[]
}

/** The checklist under a task. One level only: a subtask cannot have subtasks. */
export function Subtasks({ taskTitle, subtasks, onAdd, onToggle, onRename, onDelete }: Props) {
  const [newTitle, setNewTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState('')

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!newTitle.trim()) {
      setError('Enter a subtask.')
      return
    }
    const err = await onAdd(newTitle.trim())
    if (err) setError(err)
    else {
      setNewTitle('')
      setError(null)
    }
  }

  async function saveEdit(s: Subtask) {
    if (!draft.trim()) {
      setError('A subtask needs a title.')
      return
    }
    if (draft.trim() === s.title) {
      setEditingId(null)
      return
    }
    const err = await onRename(s.id, draft.trim(), s.isCompleted)
    if (err) setError(err)
    else {
      setEditingId(null)
      setError(null)
    }
  }

  function editKeys(e: KeyboardEvent<HTMLInputElement>, s: Subtask) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void saveEdit(s)
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      setEditingId(null)
      setError(null)
    }
  }

  return (
    <div className="subtasks" role="group" aria-label={`Subtasks of ${taskTitle}`}>
      <ul>
        {subtasks.map((s) => (
          <li key={s.id} className={s.isCompleted ? 'sub done' : 'sub'}>
            <input
              type="checkbox"
              aria-label={`Mark subtask "${s.title}" as ${s.isCompleted ? 'not done' : 'done'}`}
              checked={s.isCompleted}
              onChange={() => onToggle(s.id)}
            />
            {editingId === s.id ? (
              <input
                className="sub-edit"
                aria-label={`Edit subtask "${s.title}"`}
                value={draft}
                maxLength={200}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => editKeys(e, s)}
                onBlur={() => void saveEdit(s)}
              />
            ) : (
              <span className="sub-title">{s.title}</span>
            )}
            <span className="sub-actions">
              {editingId !== s.id && (
                <button
                  type="button"
                  className="icon"
                  aria-label={`Edit subtask "${s.title}"`}
                  onClick={() => {
                    setEditingId(s.id)
                    setDraft(s.title)
                    setError(null)
                  }}
                >
                  ✎
                </button>
              )}
              <button
                type="button"
                className="icon danger"
                aria-label={`Delete subtask "${s.title}"`}
                onClick={() => onDelete(s.id)}
              >
                ×
              </button>
            </span>
          </li>
        ))}
      </ul>
      <form className="sub-add" onSubmit={add} noValidate>
        <input
          aria-label={`New subtask for ${taskTitle}`}
          placeholder="Add a subtask…"
          value={newTitle}
          maxLength={200}
          onChange={(e) => {
            setNewTitle(e.target.value)
            setError(null)
          }}
        />
        <button type="submit">Add</button>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
