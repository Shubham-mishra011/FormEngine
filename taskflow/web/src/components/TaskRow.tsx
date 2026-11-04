import { memo, useState } from 'react'
import type { Task } from '../api'
import { dueLabel, formatMinutes, formatTime } from '../dates'
import { describeRecurrence, toInput } from '../recurrence'
import { useSettings } from '../useSettings'
import { Icon } from './Icon'
import { Subtasks, type SubtaskActions } from './Subtasks'

export interface RowActions {
  onToggle: (id: number) => void
  onEdit: (task: Task) => void
  onDuplicate: (task: Task) => void
  onDelete: (task: Task) => void
  onPin: (task: Task) => void
  onFavorite: (task: Task) => void
}

interface Props extends RowActions {
  task: Task
  today: string
  subtaskActions: (taskId: number) => SubtaskActions
  selectMode?: boolean
  selected?: boolean
  onSelect?: (id: number, on: boolean) => void
  /** Compact cards for the board and calendar side panels. */
  compact?: boolean
}

export const TaskRow = memo(function TaskRow({
  task, today, subtaskActions, selectMode, selected, onSelect, compact,
  onToggle, onEdit, onDuplicate, onDelete, onPin, onFavorite,
}: Props) {
  const { settings } = useSettings()
  const [showSubtasks, setShowSubtasks] = useState(false)

  const due = task.dueDate ? dueLabel(task.dueDate, today, settings.dateFormat) : null
  const overdue = !!due?.overdue && !task.isCompleted
  const dueToday = task.dueDate === today && !task.isCompleted
  const pct = task.subtaskTotal === 0 ? 0 : Math.round((task.subtaskDone / task.subtaskTotal) * 100)

  return (
    <li className={`task${task.isCompleted ? ' done' : ''}${selected ? ' selected' : ''}${compact ? ' compact' : ''}`} data-priority={task.priority}>
      {selectMode && (
        <input
          type="checkbox"
          className="select-box"
          aria-label={`Select "${task.title}"`}
          checked={!!selected}
          onChange={(e) => onSelect?.(task.id, e.target.checked)}
        />
      )}
      <input
        type="checkbox"
        className="done-box"
        aria-label={`Mark "${task.title}" as ${task.isCompleted ? 'not done' : 'done'}`}
        checked={task.isCompleted}
        onChange={() => onToggle(task.id)}
      />
      <div className="task-body">
        <div className="task-titlebar">
          <button type="button" className="task-title linklike" onClick={() => onEdit(task)} title="Open task">
            {task.title}
          </button>
          {task.isPinned && <Icon name="pin" className="flag pin" title="Pinned" />}
          {task.isFavorite && <Icon name="star" className="flag fav" title="Favorite" />}
        </div>
        {!compact && (task.description || task.notes) && (
          <p className="task-notes">{task.description ?? task.notes}</p>
        )}
        <div className="task-meta">
          <span className={`badge p-${task.priority.toLowerCase()}`}>{task.priority}</span>
          {task.status === 'InProgress' && <span className="badge status-doing">In progress</span>}
          {due && (
            <span className={`due${overdue ? ' overdue' : ''}${dueToday ? ' today' : ''}`}>
              {due.text}
              {task.dueTime && ` · ${formatTime(task.dueTime, settings.timeFormat)}`}
            </span>
          )}
          {task.categoryName && (
            <span className="cat" style={{ ['--cat' as string]: task.categoryColor ?? '#888' }}>
              {task.categoryName}
            </span>
          )}
          {task.tags.map((t) => (
            <span key={t.id} className="tag" style={{ ['--tag' as string]: t.color }}>
              #{t.name}
            </span>
          ))}
          {task.recurrence && (
            <span className={`repeat${task.recurrence.isActive ? '' : ' stopped'}`} title={describeRecurrence(toInput(task.recurrence)) + (task.recurrence.isActive ? '' : ' (stopped)')}>
              <Icon name="repeat" /> {task.recurrence.isActive ? 'Repeats' : 'Stopped'}
            </span>
          )}
          {task.estimatedMinutes && (
            <span className="est" title="Estimated time"><Icon name="clock" /> {formatMinutes(task.estimatedMinutes)}</span>
          )}
          {task.attachmentCount > 0 && (
            <span className="est" title="Attachments"><Icon name="paperclip" /> {task.attachmentCount}</span>
          )}
          {task.reminders.length > 0 && (
            <span className="est" title={`${task.reminders.length} reminder(s)`}><Icon name="bell" /> {task.reminders.length}</span>
          )}
        </div>

        {!compact && (
          <>
            <button
              type="button"
              className="sub-toggle"
              aria-expanded={showSubtasks}
              aria-label={`${showSubtasks ? 'Hide' : 'Show'} subtasks of "${task.title}"`}
              onClick={() => setShowSubtasks((v) => !v)}
            >
              <span aria-hidden="true">{showSubtasks ? '▾' : '▸'}</span>
              {task.subtaskTotal === 0 ? (
                <span>Add subtasks</span>
              ) : (
                <>
                  <span>{task.subtaskDone}/{task.subtaskTotal} subtasks</span>
                  <span
                    className="progress"
                    role="progressbar"
                    aria-label={`Subtask progress for "${task.title}"`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={pct}
                  >
                    <span style={{ width: `${pct}%` }} />
                  </span>
                </>
              )}
            </button>
            {showSubtasks && <Subtasks taskTitle={task.title} subtasks={task.subtasks} {...subtaskActions(task.id)} />}
          </>
        )}
      </div>
      <div className="task-actions">
        <button type="button" className={`icon-btn${task.isPinned ? ' on' : ''}`} aria-pressed={task.isPinned} aria-label={`${task.isPinned ? 'Unpin' : 'Pin'} "${task.title}"`} title={task.isPinned ? 'Unpin' : 'Pin to top'} onClick={() => onPin(task)}>
          <Icon name="pin" />
        </button>
        <button type="button" className={`icon-btn${task.isFavorite ? ' on' : ''}`} aria-pressed={task.isFavorite} aria-label={`${task.isFavorite ? 'Unfavorite' : 'Favorite'} "${task.title}"`} title={task.isFavorite ? 'Remove favorite' : 'Favorite'} onClick={() => onFavorite(task)}>
          <Icon name="star" />
        </button>
        <button type="button" className="icon-btn" onClick={() => onEdit(task)} aria-label={`Edit "${task.title}"`} title="Edit">
          <Icon name="edit" />
        </button>
        <button type="button" className="icon-btn" onClick={() => onDuplicate(task)} aria-label={`Duplicate "${task.title}"`} title="Duplicate">
          <Icon name="copy" />
        </button>
        <button type="button" className="icon-btn danger" onClick={() => onDelete(task)} aria-label={`Delete "${task.title}"`} title="Delete">
          <Icon name="trash" />
        </button>
      </div>
    </li>
  )
})
