import { useState } from 'react'
import type { Category, Task, TaskInput } from '../api'
import { dueLabel } from '../dates'
import { TaskForm } from './TaskForm'

interface Props {
  task: Task
  categories: Category[]
  onToggle: (id: number) => void
  onDelete: (id: number) => void
  onUpdate: (id: number, input: TaskInput) => Promise<string | null>
}

export function TaskRow({ task, categories, onToggle, onDelete, onUpdate }: Props) {
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  if (editing) {
    return (
      <li className="task editing">
        <TaskForm
          categories={categories}
          initial={task}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
          onSubmit={async (input) => {
            const err = await onUpdate(task.id, input)
            if (!err) setEditing(false)
            return err
          }}
        />
      </li>
    )
  }

  const due = task.dueDate ? dueLabel(task.dueDate) : null
  const overdue = !!due?.overdue && !task.isCompleted
  const dueToday = due?.text === 'Today' && !task.isCompleted

  return (
    <li className={`task${task.isCompleted ? ' done' : ''}`}>
      <input
        type="checkbox"
        aria-label={`Mark "${task.title}" as ${task.isCompleted ? 'not done' : 'done'}`}
        checked={task.isCompleted}
        onChange={() => onToggle(task.id)}
      />
      <div className="task-body">
        <span className="task-title">{task.title}</span>
        {task.notes && <p className="task-notes">{task.notes}</p>}
        <div className="task-meta">
          <span className={`badge p-${task.priority.toLowerCase()}`}>{task.priority}</span>
          {due && (
            <span className={`due${overdue ? ' overdue' : ''}${dueToday ? ' today' : ''}`}>
              {due.text}
            </span>
          )}
          {task.categoryName && (
            <span className="cat" style={{ ['--cat' as string]: task.categoryColor ?? '#888' }}>
              {task.categoryName}
            </span>
          )}
        </div>
      </div>
      <div className="task-actions">
        <button onClick={() => setEditing(true)} aria-label={`Edit "${task.title}"`}>
          Edit
        </button>
        {/* Two-step delete: the first click arms it, the second confirms. Leaving the button disarms it. */}
        <button
          className={`danger${confirmingDelete ? ' armed' : ''}`}
          aria-label={confirmingDelete ? `Confirm delete "${task.title}"` : `Delete "${task.title}"`}
          onBlur={() => setConfirmingDelete(false)}
          onClick={() => {
            if (confirmingDelete) onDelete(task.id)
            else setConfirmingDelete(true)
          }}
        >
          {confirmingDelete ? 'Confirm?' : 'Delete'}
        </button>
      </div>
    </li>
  )
}
