import type { Stats } from '../api'
import { Icon, type IconName } from './Icon'
import { hashFor, type Route } from '../useRoute'

interface Item {
  route: Route
  label: string
  icon: IconName
  count?: (s: Stats) => { n: number; alert?: boolean } | null
}

const GROUPS: { title?: string; items: Item[] }[] = [
  { items: [{ route: 'dashboard', label: 'Dashboard', icon: 'dashboard' }] },
  {
    title: 'Tasks',
    items: [
      { route: 'tasks', label: 'My Tasks', icon: 'tasks', count: (s) => ({ n: s.active }) },
      { route: 'inbox', label: 'Inbox', icon: 'inbox', count: (s) => ({ n: s.inbox }) },
      { route: 'today', label: 'Today', icon: 'today', count: (s) => ({ n: s.dueToday + s.overdue, alert: s.overdue > 0 }) },
      { route: 'upcoming', label: 'Upcoming', icon: 'upcoming', count: (s) => ({ n: s.upcoming }) },
      { route: 'completed', label: 'Completed', icon: 'completed', count: (s) => ({ n: s.completed }) },
    ],
  },
  {
    title: 'Plan',
    items: [
      { route: 'calendar', label: 'Calendar', icon: 'calendar' },
      { route: 'kanban', label: 'Kanban', icon: 'kanban' },
    ],
  },
  {
    title: 'Organize',
    items: [
      { route: 'categories', label: 'Categories', icon: 'categories' },
      { route: 'tags', label: 'Tags', icon: 'tags' },
    ],
  },
  {
    title: 'Insights',
    items: [
      { route: 'analytics', label: 'Analytics', icon: 'analytics' },
      { route: 'focus', label: 'Focus', icon: 'focus' },
    ],
  },
]

export function SideNav({ route, stats, onNavigate }: { route: Route; stats: Stats | null; onNavigate: () => void }) {
  const link = (it: Item) => {
    const c = stats && it.count ? it.count(stats) : null
    return (
      <li key={it.route}>
        <a
          className="nav-link"
          href={hashFor(it.route)}
          aria-current={route === it.route ? 'page' : undefined}
          onClick={onNavigate}
        >
          <Icon name={it.icon} />
          <span>{it.label}</span>
          {c && c.n > 0 && (
            <span className={`nav-count${c.alert ? ' alert' : ''}`} aria-label={`${c.n}${c.alert ? ', some overdue' : ''}`}>
              {c.n}
            </span>
          )}
        </a>
      </li>
    )
  }

  return (
    <nav aria-label="Main">
      {GROUPS.map((g, i) => (
        <div key={i}>
          {g.title && <h2>{g.title}</h2>}
          <ul>{g.items.map(link)}</ul>
        </div>
      ))}
      <div className="side-foot">
        <ul>{link({ route: 'settings', label: 'Settings', icon: 'settings' })}</ul>
      </div>
    </nav>
  )
}
