import { useEffect, useMemo, useRef, useState } from 'react'
import { matchesQuery } from '../taskFilters'
import { useTaskFlow } from '../useTaskFlow'
import { useTaskEditor } from './TaskEditor'
import { Icon } from './Icon'
import { Modal } from './Modal'

export interface Command {
  id: string
  label: string
  group: 'Go to' | 'Actions' | 'Theme'
  /** Extra words that should match, e.g. "dark mode". */
  keywords?: string
  shortcut?: string
  run: () => void
}

function score(c: Command, q: string): number {
  if (!q) return 1
  const hay = `${c.label} ${c.keywords ?? ''}`.toLowerCase()
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.every((t) => hay.includes(t))) return 0
  return hay.startsWith(terms[0]) ? 3 : 2
}

/** Ctrl+K: jump anywhere, run an action, or find a task by typing. Arrow keys + Enter; Escape closes. */
export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const store = useTaskFlow()
  const editor = useTaskEditor()
  const [q, setQ] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  type Item = { key: string; label: string; hint?: string; group: string; run: () => void }
  const items = useMemo<Item[]>(() => {
    const cmds = commands
      .map((c) => ({ c, s: score(c, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map(({ c }) => ({ key: c.id, label: c.label, hint: c.shortcut, group: c.group as string, run: c.run }))
    const tasks = q.trim()
      ? store.tasks
          .filter((t) => matchesQuery(t, q))
          .slice(0, 8)
          .map((t) => ({
            key: `task-${t.id}`,
            label: t.title,
            hint: t.isCompleted ? 'Completed' : (t.dueDate ?? undefined),
            group: 'Tasks',
            run: () => editor.open({ task: t }),
          }))
      : []
    return [...cmds, ...tasks]
  }, [commands, q, store.tasks, editor])

  // The list shrinks as you type; never let a stale index point past the end (Enter would do nothing).
  const active = Math.max(0, Math.min(index, items.length - 1))
  useEffect(() => setIndex(0), [q])
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  function run(item: Item | undefined) {
    if (!item) return
    onClose()
    // Let the palette unmount (and return focus) before the action opens another dialog.
    setTimeout(item.run, 0)
  }

  let lastGroup = ''
  return (
    <Modal title="Command palette" size="md" hideTitle onClose={onClose}>
      <div className="palette">
        <div className="palette-input">
          <Icon name="search" />
          <input
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[active] ? `palette-${items[active].key}` : undefined}
            aria-label="Type a command or search tasks"
            placeholder="Type a command or search tasks…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(Math.min(items.length - 1, active + 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(Math.max(0, active - 1)) }
              else if (e.key === 'Enter') { e.preventDefault(); run(items[active]) }
            }}
          />
        </div>
        <ul id="palette-list" role="listbox" aria-label="Results" ref={listRef} className="palette-list">
          {items.length === 0 && <li className="palette-empty">Nothing matches “{q}”.</li>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null
            lastGroup = it.group
            return (
              <li key={it.key} role="presentation">
                {header && <div className="palette-group">{header}</div>}
                <div
                  id={`palette-${it.key}`}
                  role="option"
                  aria-selected={i === active}
                  className={`palette-item${i === active ? ' active' : ''}`}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => run(it)}
                >
                  <span>{it.label}</span>
                  {it.hint && <kbd>{it.hint}</kbd>}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </Modal>
  )
}
