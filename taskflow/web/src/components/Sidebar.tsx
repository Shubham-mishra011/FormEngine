import { useState, type FormEvent } from 'react'
import type { Category, StatusFilter, Stats } from '../api'

interface Props {
  categories: Category[]
  stats: Stats | null
  status: StatusFilter
  categoryId: number | null
  onStatus: (s: StatusFilter) => void
  onCategory: (id: number | null) => void
  onAddCategory: (name: string, color: string) => Promise<string | null>
  onDeleteCategory: (id: number) => void
}

const views: { key: StatusFilter; label: string; count?: (s: Stats) => number }[] = [
  { key: 'all', label: 'All', count: (s) => s.total },
  { key: 'active', label: 'Active', count: (s) => s.active },
  { key: 'today', label: 'Due today', count: (s) => s.dueToday },
  { key: 'overdue', label: 'Overdue', count: (s) => s.overdue },
  { key: 'completed', label: 'Completed', count: (s) => s.completed },
]

// New categories cycle through distinct colours so they are told apart at a glance.
const palette = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#8b5cf6']

export function Sidebar(p: Props) {
  const [name, setName] = useState('')
  const [pickedColor, setPickedColor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const color = pickedColor ?? palette[p.categories.length % palette.length]

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError('Enter a category name.')
      return
    }
    const err = await p.onAddCategory(name.trim(), color)
    if (err) setError(err)
    else {
      setName('')
      setPickedColor(null)
      setError(null)
    }
  }

  function remove(c: Category) {
    const kept = c.taskCount === 0 ? '' : ` Its ${c.taskCount} task${c.taskCount === 1 ? '' : 's'} will be kept without a category.`
    if (window.confirm(`Delete category "${c.name}"?${kept}`)) p.onDeleteCategory(c.id)
  }

  return (
    <aside className="sidebar">
      <nav aria-label="Views">
        <ul className="views">
          {views.map((v) => (
            <li key={v.key}>
              <button
                className={p.status === v.key ? 'nav active' : 'nav'}
                aria-current={p.status === v.key ? 'true' : undefined}
                onClick={() => p.onStatus(v.key)}
              >
                <span>{v.label}</span>
                {p.stats && v.count && <span className="count">{v.count(p.stats)}</span>}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <h2>Categories</h2>
      <ul className="cats">
        <li>
          <button
            className={p.categoryId === null ? 'nav active' : 'nav'}
            aria-current={p.categoryId === null ? 'true' : undefined}
            onClick={() => p.onCategory(null)}
          >
            Any category
          </button>
        </li>
        {p.categories.map((c) => (
          <li key={c.id} className="cat-row">
            <button
              className={p.categoryId === c.id ? 'nav active' : 'nav'}
              aria-current={p.categoryId === c.id ? 'true' : undefined}
              onClick={() => p.onCategory(c.id)}
            >
              <span className="dot" style={{ background: c.color }} />
              <span>{c.name}</span>
              <span className="count">{c.taskCount}</span>
            </button>
            <button
              className="icon danger"
              aria-label={`Delete category ${c.name}`}
              onClick={() => remove(c)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <form className="cat-form" onSubmit={add} noValidate>
        <input
          aria-label="New category name"
          placeholder="New category"
          value={name}
          maxLength={50}
          onChange={(e) => {
            setName(e.target.value)
            setError(null)
          }}
        />
        <div className="cat-form-row">
          <input
            type="color"
            aria-label="Category color"
            value={color}
            onChange={(e) => setPickedColor(e.target.value)}
          />
          <button type="submit">Add category</button>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </aside>
  )
}
