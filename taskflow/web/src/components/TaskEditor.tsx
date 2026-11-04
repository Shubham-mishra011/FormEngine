import { createContext, useCallback, useContext, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { PRIORITIES, STATUS_LABEL, type Priority, type RecurrenceInput, type Task, type TaskInput, type WorkStatus } from '../api'
import { toInput } from '../recurrence'
import { useSettings } from '../useSettings'
import { useTaskFlow } from '../useTaskFlow'
import { useToast } from '../useToast'
import { ActivityPanel, AttachmentsPanel, RecurrenceEditor, RemindersEditor, TagPicker, defaultRecurrence, type ReminderDraft } from './EditorPanels'
import { Modal, ConfirmDialog } from './Modal'
import { Subtasks } from './Subtasks'

type Tab = 'details' | 'subtasks' | 'files' | 'history'

export interface EditorRequest {
  /** Edit this task. Omit to create one. */
  task?: Task
  /** Pre-filled values for a new task (e.g. a due date chosen on the calendar). */
  defaults?: Partial<TaskInput>
}

const EditorContext = createContext<{ open: (r: EditorRequest) => void } | null>(null)

export function useTaskEditor() {
  const ctx = useContext(EditorContext)
  if (!ctx) throw new Error('useTaskEditor must be used inside <TaskEditorProvider>')
  return ctx
}

export function TaskEditorProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<EditorRequest | null>(null)
  const open = useCallback((r: EditorRequest) => setRequest(r), [])
  const value = useMemo(() => ({ open }), [open])
  return (
    <EditorContext.Provider value={value}>
      {children}
      {/* key: opening another task/defaults resets the form instead of leaking the previous one's state */}
      {request && <TaskEditor key={request.task?.id ?? `new-${JSON.stringify(request.defaults ?? {})}`} request={request} onClose={() => setRequest(null)} />}
    </EditorContext.Provider>
  )
}

function reminderDraft(t?: Task, defaultMinutes?: number | null, hasDue?: boolean): ReminderDraft {
  if (t) {
    return {
      relative: t.reminders.filter((r) => r.minutesBefore !== null).map((r) => r.minutesBefore!).sort((a, b) => a - b),
      absolute: t.reminders.filter((r) => r.minutesBefore === null).map((r) => r.remindAt),
    }
  }
  return { relative: defaultMinutes !== null && defaultMinutes !== undefined && hasDue ? [defaultMinutes] : [], absolute: [] }
}

function TaskEditor({ request, onClose }: { request: EditorRequest; onClose: () => void }) {
  const store = useTaskFlow()
  const { settings } = useSettings()
  const { toast } = useToast()
  const editing = request.task
  // Always edit the live version from the store, so subtasks/attachments changes show up immediately.
  const live = editing ? (store.tasks.find((t) => t.id === editing.id) ?? editing) : undefined
  const d = request.defaults ?? {}

  const [tab, setTab] = useState<Tab>('details')
  const [title, setTitle] = useState(editing?.title ?? d.title ?? '')
  const [description, setDescription] = useState(editing?.description ?? d.description ?? '')
  const [notes, setNotes] = useState(editing?.notes ?? d.notes ?? '')
  const [priority, setPriority] = useState<Priority>(editing?.priority ?? d.priority ?? settings.defaultPriority)
  const [status, setStatus] = useState<WorkStatus>(editing?.status ?? d.status ?? 'Todo')
  const [startDate, setStartDate] = useState(editing?.startDate ?? d.startDate ?? '')
  const [dueDate, setDueDate] = useState(editing?.dueDate ?? d.dueDate ?? '')
  const [dueTime, setDueTime] = useState((editing?.dueTime ?? d.dueTime ?? '').slice(0, 5))
  const [estimate, setEstimate] = useState(String(editing?.estimatedMinutes ?? d.estimatedMinutes ?? ''))
  const [actual, setActual] = useState(String(editing?.actualMinutes ?? d.actualMinutes ?? ''))
  const [categoryId, setCategoryId] = useState(String(editing?.categoryId ?? d.categoryId ?? ''))
  const [tagIds, setTagIds] = useState<number[]>(editing?.tags.map((t) => t.id) ?? d.tagIds ?? [])
  const [pinned, setPinned] = useState(editing?.isPinned ?? d.isPinned ?? false)
  const [favorite, setFavorite] = useState(editing?.isFavorite ?? d.isFavorite ?? false)
  const [reminders, setReminders] = useState<ReminderDraft>(() => reminderDraft(editing, settings.defaultReminder, !!(editing?.dueDate ?? d.dueDate)))
  const [repeat, setRepeat] = useState<RecurrenceInput | null>(
    editing?.recurrence ? toInput(editing.recurrence) : (d.recurrence ?? null),
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmStop, setConfirmStop] = useState(false)

  const hasDue = dueDate !== ''
  const stopped = editing?.recurrence && !editing.recurrence.isActive

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    if (!title.trim()) {
      setError('Title is required.')
      setTab('details')
      return
    }
    if (startDate && dueDate && startDate > dueDate) {
      setError('The start date is after the due date.')
      return
    }
    const input: TaskInput = {
      title: title.trim(),
      description: description.trim() || null,
      notes: notes.trim() || null,
      priority,
      status,
      startDate: startDate || null,
      dueDate: dueDate || null,
      dueTime: dueDate && dueTime ? dueTime : null,
      estimatedMinutes: estimate ? Number(estimate) : null,
      actualMinutes: actual ? Number(actual) : null,
      categoryId: categoryId ? Number(categoryId) : null,
      tagIds,
      isPinned: pinned,
      isFavorite: favorite,
      reminders: [
        ...(hasDue ? reminders.relative.map((m) => ({ minutesBefore: m })) : []),
        ...reminders.absolute.map((at) => ({ at })),
      ],
    }
    // null keeps an existing repeat as it is; sending the edited rule changes (and reactivates) it.
    if (repeat) input.recurrence = repeat
    setBusy(true)
    const err = editing ? await store.updateTask(editing.id, input) : await store.createTask(input)
    setBusy(false)
    if (err) {
      setError(err)
      return
    }
    toast(editing ? 'Task saved.' : 'Task added.')
    onClose()
  }

  async function stopRepeating() {
    if (!editing) return
    setConfirmStop(false)
    const err = await store.stopRecurrence(editing.id)
    if (err) setError(err)
    else {
      setRepeat(null)
      toast('Repeating stopped. This task stays; no further copies will be made.')
    }
  }

  const tabs: [Tab, string][] = editing
    ? [['details', 'Details'], ['subtasks', `Subtasks${live?.subtaskTotal ? ` (${live.subtaskDone}/${live.subtaskTotal})` : ''}`], ['files', `Files${live?.attachmentCount ? ` (${live.attachmentCount})` : ''}`], ['history', 'History']]
    : [['details', 'Details']]

  return (
    <Modal
      title={editing ? 'Edit task' : 'New task'}
      size="lg"
      onClose={onClose}
      footer={
        <>
          {error && <span className="form-error" role="alert">{error}</span>}
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" form="task-editor-form" className="primary" disabled={busy}>
            {editing ? 'Save' : 'Add task'}
          </button>
        </>
      }
    >
      {tabs.length > 1 && (
        <div className="tabs" role="tablist" aria-label="Task sections">
          {tabs.map(([id, label]) => (
            <button key={id} role="tab" type="button" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
      )}

      <form id="task-editor-form" className="editor-form" onSubmit={submit} noValidate hidden={tab !== 'details'}>
        <input
          aria-label="Title"
          placeholder="What needs doing?"
          value={title}
          maxLength={200}
          aria-invalid={error && !title.trim() ? true : undefined}
          onChange={(e) => { setTitle(e.target.value); setError(null) }}
          autoFocus
        />
        <textarea aria-label="Description" placeholder="Description (optional)" rows={2} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} />
        <textarea
          aria-label="Notes"
          placeholder="Notes (optional) — Ctrl+Enter to save"
          rows={3}
          maxLength={4000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) e.currentTarget.form?.requestSubmit() }}
        />
        <div className="form-row">
          <label>Priority
            <select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
            </select>
          </label>
          <label>Status
            <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as WorkStatus)}>
              {(Object.keys(STATUS_LABEL) as WorkStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label>Category
            <select aria-label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">None</option>
              {store.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>
        <div className="form-row">
          <label>Start date
            <input type="date" aria-label="Start date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label>Due date
            <input type="date" aria-label="Due date" value={dueDate} onChange={(e) => { setDueDate(e.target.value); if (!e.target.value) setDueTime('') }} />
          </label>
          <label>Due time
            <input type="time" aria-label="Due time" value={dueTime} disabled={!hasDue} onChange={(e) => setDueTime(e.target.value)} />
          </label>
        </div>
        <div className="form-row">
          <label>Estimate (minutes)
            <input type="number" aria-label="Estimate in minutes" min={1} max={100000} value={estimate} onChange={(e) => setEstimate(e.target.value)} />
          </label>
          <label>Time spent (minutes)
            <input type="number" aria-label="Time spent in minutes" min={0} max={100000} value={actual} onChange={(e) => setActual(e.target.value)} />
          </label>
          {editing && editing.focusSeconds > 0 && <span className="hint self-end">Focus timer: {Math.round(editing.focusSeconds / 60)} min logged</span>}
        </div>
        <label className="check"><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pin to the top of lists</label>
        <label className="check"><input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} /> Favorite</label>

        <fieldset>
          <legend>Tags</legend>
          <TagPicker
            tags={store.tags}
            selected={tagIds}
            onChange={setTagIds}
            onCreate={async (name) => {
              const err = await store.createTag(name, '#8b5cf6')
              return err
            }}
          />
        </fieldset>

        <RemindersEditor value={reminders} onChange={setReminders} hasDueDate={hasDue} />

        <label className="check">
          <input
            type="checkbox"
            aria-label="Repeat this task"
            checked={repeat !== null}
            onChange={(e) => {
              if (e.target.checked) setRepeat(editing?.recurrence ? toInput(editing.recurrence) : { ...defaultRecurrence, ...(d.recurrence ?? {}) })
              else if (editing?.recurrence?.isActive) setConfirmStop(true)
              else setRepeat(null)
            }}
          />{' '}
          Repeat this task
        </label>
        {stopped && repeat && <p className="hint">Repeating is stopped for this task. Saving with these settings will start it again.</p>}
        {repeat && (
          <RecurrenceEditor
            value={repeat}
            onChange={setRepeat}
            onStop={editing?.recurrence?.isActive ? () => setConfirmStop(true) : undefined}
          />
        )}
        {editing?.recurrence?.nextDue && editing.recurrence.isActive && (
          <p className="hint">Next occurrence after this one: {editing.recurrence.nextDue}. Occurrence #{editing.occurrenceNumber}.</p>
        )}
      </form>

      {editing && tab === 'subtasks' && live && (
        <Subtasks
          taskTitle={live.title}
          subtasks={live.subtasks}
          onAdd={(t) => store.addSubtask(live.id, t)}
          onToggle={(id) => void store.toggleSubtask(id)}
          onRename={store.renameSubtask}
          onDelete={(id) => void store.deleteSubtask(id)}
        />
      )}
      {editing && tab === 'files' && <AttachmentsPanel taskId={editing.id} onChanged={() => void store.reload()} />}
      {editing && tab === 'history' && <ActivityPanel taskId={editing.id} />}

      {confirmStop && (
        <ConfirmDialog
          title="Stop repeating?"
          message="This task stays, but no further copies will be created when it is completed. Completed past occurrences are kept."
          confirmLabel="Stop repeating"
          danger
          onConfirm={() => void stopRepeating()}
          onCancel={() => setConfirmStop(false)}
        />
      )}
    </Modal>
  )
}
