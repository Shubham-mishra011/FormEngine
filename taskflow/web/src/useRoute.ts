import { useCallback, useEffect, useState } from 'react'

export type Route =
  | 'dashboard'
  | 'tasks'
  | 'inbox'
  | 'today'
  | 'upcoming'
  | 'calendar'
  | 'kanban'
  | 'completed'
  | 'categories'
  | 'tags'
  | 'analytics'
  | 'focus'
  | 'settings'

export const ROUTES: Route[] = [
  'dashboard', 'tasks', 'inbox', 'today', 'upcoming', 'calendar', 'kanban', 'completed',
  'categories', 'tags', 'analytics', 'focus', 'settings',
]

export interface ParsedRoute {
  route: Route
  /** Optional second hash segment, e.g. "backup" in #/settings/backup. */
  param: string | null
}

/**
 * Hash routing (#/calendar) keeps the app a static bundle with no server-side routes.
 * `#/data` is the old name of the backup page and now opens Settings → Backup.
 * An empty or unknown hash resolves to `fallback` (the user's default view).
 */
export function parseRoute(hash: string, fallback: Route = 'dashboard'): ParsedRoute {
  const [name, param] = hash.replace(/^#\/?/, '').split('/')
  if (name === 'data') return { route: 'settings', param: 'backup' }
  if ((ROUTES as string[]).includes(name)) return { route: name as Route, param: param || null }
  return { route: fallback, param: null }
}

export function hashFor(route: Route, param?: string | null): string {
  return `#/${route}${param ? `/${param}` : ''}`
}

export function useRoute(fallback: Route = 'dashboard') {
  const [parsed, setParsed] = useState<ParsedRoute>(() => parseRoute(window.location.hash, fallback))

  useEffect(() => {
    const onChange = () => setParsed(parseRoute(window.location.hash, fallback))
    onChange()
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [fallback])

  const go = useCallback((r: Route, param?: string | null) => {
    window.location.hash = hashFor(r, param)
  }, [])

  return { route: parsed.route, param: parsed.param, go }
}
