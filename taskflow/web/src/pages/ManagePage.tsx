import { useState, type FormEvent } from 'react'
import { EmptyState, PageHeader, Skeleton } from '../components/Feedback'
import { ConfirmDialog } from '../components/Modal'
import { useTaskFlow } from '../useTaskFlow'
import { useToast } from '../useToast'

interface Item {
  id: number
  name: string
  color: string
  taskCount: number
}

const palette = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#8b5cf6']

interface Props {
  kind: 'category' | 'tag'
}

/** One screen manages both categories (one per task) and tags (many per task): same shape, different copy. */
export function ManagePage({ kind }: Props) {
  const store = useTaskFlow()
  const { toast } = useToast()
  const isTag = kind === 'tag'
  const items: Item[] = isTag ? store.tags : store.categories
  const noun = isTag ? 'tag' : 'category'
  const Noun = isTag ? 'Tag' : 'Category'

  const create = isTag ? store.createTag : store.createCategory
  const update = isTag ? store.updateTag : store.updateCategory
  const remove = isTag ? store.deleteTag : store.deleteCategory

  const [name, setName] = useState('')
  const [pickedColor, setPickedColor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftColor, setDraftColor] = useState('#6366f1')
  const [editError, setEditError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Item | null>(null)
  const color = pickedColor ?? palette[items.length % palette.length]

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError(`Enter a ${noun} name.`)
      return
    }
    const err = await create(name.trim(), color)
    if (err) setError(err)
    else {
      toast(`${Noun} "${name.trim()}" added.`)
      setName('')
      setPickedColor(null)
      setError(null)
    }
  }

  async function save(item: Item) {
    if (!draftName.trim()) {
      setEditError('Name is required.')
      return
    }
    const err = await update(item.id, draftName.trim(), draftColor)
    if (err) setEditError(err)
    else {
      setEditingId(null)
      setEditError(null)
      toast(`${Noun} saved.`)
    }
  }

  return (
    <section aria-label={`${Noun} manager`}>
      <PageHeader
        title={isTag ? 'Tags' : 'Categories'}
        subtitle={isTag ? 'Labels you can combine: a task can have many tags.' : 'Each task belongs to at most one category.'}
      />

      <form className="card inline-form" onSubmit={add} noValidate>
        <input
          aria-label={`New ${noun} name`}
          placeholder={isTag ? 'New tag (no spaces)' : 'New category'}
          value={name}
          maxLength={isTag ? 30 : 50}
          aria-invalid={error ? true : undefined}
          onChange={(e) => { setName(e.target.value); setError(null) }}
        />
        <input type="color" aria-label={`${Noun} color`} value={color} onChange={(e) => setPickedColor(e.target.value)} />
        <button type="submit" className="primary">Add {noun}</button>
        {error && <p className="form-error" role="alert">{error}</p>}
      </form>

      {store.loading ? (
        <Skeleton rows={3} />
      ) : items.length === 0 ? (
        <EmptyState icon={isTag ? 'tags' : 'categories'} title={`No ${noun === 'tag' ? 'tags' : 'categories'} yet`}>
          {isTag ? 'Create a tag, then add it to tasks or type #tag in the quick-add bar.' : 'Create a category to group related tasks.'}
        </EmptyState>
      ) : (
        <ul className="manage-list">
          {items.map((c) => (
            <li key={c.id} className="card manage-row">
              {editingId === c.id ? (
                <form
                  className="inline-form"
                  onSubmit={(e) => { e.preventDefault(); void save(c) }}
                  onKeyDown={(e) => e.key === 'Escape' && setEditingId(null)}
                  noValidate
                >
                  <input aria-label={`${Noun} name`} value={draftName} maxLength={isTag ? 30 : 50} autoFocus onChange={(e) => { setDraftName(e.target.value); setEditError(null) }} />
                  <input type="color" aria-label={`${Noun} color`} value={draftColor} onChange={(e) => setDraftColor(e.target.value)} />
                  <button type="submit" className="primary">Save</button>
                  <button type="button" onClick={() => setEditingId(null)}>Cancel</button>
                  {editError && <p className="form-error" role="alert">{editError}</p>}
                </form>
              ) : (
                <>
                  <span className="dot big" style={{ background: c.color }} />
                  <span className="manage-name">{isTag ? `#${c.name}` : c.name}</span>
                  <span className="hint">{c.taskCount} task{c.taskCount === 1 ? '' : 's'}</span>
                  <span className="grow" />
                  <button type="button" onClick={() => { setEditingId(c.id); setDraftName(c.name); setDraftColor(c.color); setEditError(null) }} aria-label={`Edit ${noun} ${c.name}`}>Edit</button>
                  <button type="button" className="danger" onClick={() => setDeleting(c)} aria-label={`Delete ${noun} ${c.name}`}>Delete</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete ${noun}?`}
          message={
            <>
              Delete the {noun} <strong>{deleting.name}</strong>?{' '}
              {deleting.taskCount > 0
                ? `Its ${deleting.taskCount} task${deleting.taskCount === 1 ? '' : 's'} will be kept${isTag ? ' without this tag' : ' without a category'}.`
                : 'No tasks use it.'}
            </>
          }
          confirmLabel={`Delete ${noun}`}
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            const d = deleting
            setDeleting(null)
            const err = await remove(d.id)
            if (!err) toast(`${Noun} "${d.name}" deleted.`)
          }}
        />
      )}
    </section>
  )
}
