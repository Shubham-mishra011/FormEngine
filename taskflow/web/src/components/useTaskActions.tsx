import { useMemo, useState, type ReactNode } from 'react'
import type { Task } from '../api'
import { useTaskFlow } from '../useTaskFlow'
import { useToast } from '../useToast'
import { ConfirmDialog } from './Modal'
import type { SubtaskActions } from './Subtasks'
import type { RowActions } from './TaskRow'
import { useTaskEditor } from './TaskEditor'

/**
 * The handlers every task list/board/calendar needs, in one place. `dialogs` must be rendered by the caller
 * (it holds the delete confirmation).
 */
export function useTaskActions(): {
  rowActions: RowActions
  subtaskActions: (taskId: number) => SubtaskActions
  dialogs: ReactNode
} {
  const store = useTaskFlow()
  const editor = useTaskEditor()
  const { toast } = useToast()
  const [deleting, setDeleting] = useState<Task | null>(null)

  const rowActions = useMemo<RowActions>(
    () => ({
      onToggle: (id) => void store.toggleTask(id),
      onEdit: (task) => editor.open({ task }),
      onDuplicate: async (task) => {
        const err = await store.duplicateTask(task.id)
        if (!err) toast(`Duplicated "${task.title}".`)
      },
      onDelete: (task) => setDeleting(task),
      onPin: (task) => void store.setFlags(task.id, { isPinned: !task.isPinned }),
      onFavorite: (task) => void store.setFlags(task.id, { isFavorite: !task.isFavorite }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.toggleTask, store.duplicateTask, store.setFlags, editor, toast],
  )

  const subtaskActions = useMemo(
    () => (taskId: number): SubtaskActions => ({
      onAdd: (title) => store.addSubtask(taskId, title),
      onToggle: (id) => void store.toggleSubtask(id),
      onRename: store.renameSubtask,
      onDelete: (id) => void store.deleteSubtask(id),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.addSubtask, store.toggleSubtask, store.renameSubtask, store.deleteSubtask],
  )

  const dialogs = deleting && (
    <ConfirmDialog
      title="Delete task?"
      message={
        <>
          Delete <strong>{deleting.title}</strong>
          {deleting.subtaskTotal > 0 && <> and its {deleting.subtaskTotal} subtask{deleting.subtaskTotal === 1 ? '' : 's'}</>}
          {deleting.recurrence?.isActive && ' (this also ends its repeating series)'}? This cannot be undone.
        </>
      }
      confirmLabel="Delete"
      danger
      onCancel={() => setDeleting(null)}
      onConfirm={async () => {
        const t = deleting
        setDeleting(null)
        const err = await store.deleteTask(t.id)
        if (!err) toast(`Deleted "${t.title}".`)
      }}
    />
  )

  return { rowActions, subtaskActions, dialogs }
}
