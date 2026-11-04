import { useEffect } from 'react'
import type { Route } from './useRoute'

export interface Shortcut {
  keys: string
  description: string
}

/** The reference shown in Settings and in the “?” overlay. Keep in sync with <see cref="useGlobalShortcuts"/>. */
export const SHORTCUTS: Shortcut[] = [
  { keys: 'Ctrl K', description: 'Open the command palette' },
  { keys: 'Q', description: 'Focus the quick-add bar' },
  { keys: 'N', description: 'New task (full editor)' },
  { keys: '/', description: 'Search tasks (on a task list)' },
  { keys: '?', description: 'Show keyboard shortcuts' },
  { keys: 'G then D', description: 'Go to Dashboard' },
  { keys: 'G then T', description: 'Go to My Tasks' },
  { keys: 'G then I', description: 'Go to Inbox' },
  { keys: 'G then Y', description: 'Go to Today' },
  { keys: 'G then U', description: 'Go to Upcoming' },
  { keys: 'G then C', description: 'Go to Calendar' },
  { keys: 'G then K', description: 'Go to Kanban board' },
  { keys: 'G then A', description: 'Go to Analytics' },
  { keys: 'G then F', description: 'Go to Focus timer' },
  { keys: 'G then S', description: 'Go to Settings' },
  { keys: 'Esc', description: 'Close a dialog / clear a search' },
  { keys: 'Ctrl Enter', description: 'Save from the notes box' },
]

const GO: Record<string, Route> = {
  d: 'dashboard', t: 'tasks', i: 'inbox', y: 'today', u: 'upcoming', c: 'calendar', k: 'kanban', a: 'analytics', f: 'focus', s: 'settings',
}

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  return !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable)
}

/**
 * Single-letter shortcuts only fire when no field has focus and no dialog is open, and never with
 * Ctrl/Alt/Meta held, so they cannot clash with browser shortcuts. Ctrl+K is the one exception (the palette).
 */
export function useGlobalShortcuts(handlers: {
  palette: () => void
  quickAdd: () => void
  newTask: () => void
  help: () => void
  go: (r: Route) => void
}) {
  useEffect(() => {
    let pendingG = 0
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        handlers.palette()
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return
      if (document.body.classList.contains('modal-open')) return

      if (pendingG && Date.now() - pendingG < 1200) {
        pendingG = 0
        const r = GO[e.key.toLowerCase()]
        if (r) { e.preventDefault(); handlers.go(r) }
        return
      }
      switch (e.key) {
        case 'g': pendingG = Date.now(); break
        case 'q': e.preventDefault(); handlers.quickAdd(); break
        case 'n': e.preventDefault(); handlers.newTask(); break
        case '?': e.preventDefault(); handlers.help(); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handlers])
}

export function ShortcutTable() {
  return (
    <table className="data-table shortcut-table">
      <caption className="sr-only">Keyboard shortcuts</caption>
      <tbody>
        {SHORTCUTS.map((s) => (
          <tr key={s.keys}>
            <th scope="row">
              {s.keys.split(' ').map((k, i) => (k === 'then' ? <span key={i} className="then"> then </span> : <kbd key={i}>{k}</kbd>))}
            </th>
            <td>{s.description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
