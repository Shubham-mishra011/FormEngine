import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Priority } from './api'
import type { DateFormat, TimeFormat } from './dates'
import type { Route } from './useRoute'

export type WidgetId = 'today' | 'upcoming' | 'overdue' | 'high' | 'progress' | 'focus' | 'productivity' | 'shortcuts'
export const WIDGETS: { id: WidgetId; label: string }[] = [
  { id: 'today', label: "Today's tasks" },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'high', label: 'High priority' },
  { id: 'progress', label: 'Completion progress' },
  { id: 'focus', label: 'Focus summary' },
  { id: 'productivity', label: 'Productivity' },
  { id: 'shortcuts', label: 'Shortcuts' },
]

export interface Settings {
  defaultPriority: Priority
  defaultView: Route
  weekStart: 0 | 1
  dateFormat: DateFormat
  timeFormat: TimeFormat
  /** Reminder (minutes before due) added automatically to new tasks with a due date. null = none. */
  defaultReminder: number | null
  overdueAlerts: boolean
  notificationSound: boolean
  browserNotifications: boolean
  focusMinutes: number
  shortBreakMinutes: number
  longBreakMinutes: number
  sessionsBeforeLongBreak: number
  autoStartNext: boolean
  focusSound: boolean
  focusBrowserNotification: boolean
  widgets: Record<WidgetId, boolean>
}

export const DEFAULT_SETTINGS: Settings = {
  defaultPriority: 'Medium',
  defaultView: 'dashboard',
  weekStart: 1,
  dateFormat: 'auto',
  timeFormat: 'auto',
  defaultReminder: null,
  overdueAlerts: true,
  notificationSound: false,
  browserNotifications: false,
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  sessionsBeforeLongBreak: 4,
  autoStartNext: false,
  focusSound: true,
  focusBrowserNotification: true,
  widgets: {
    today: true, upcoming: true, overdue: true, high: true, progress: true, focus: true, productivity: true, shortcuts: true,
  },
}

export const SETTINGS_KEY = 'taskflow-settings'

/** Storage can be unavailable or hold junk; fall back to defaults field by field. */
export function readSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<Settings>
    return { ...DEFAULT_SETTINGS, ...parsed, widgets: { ...DEFAULT_SETTINGS.widgets, ...(parsed.widgets ?? {}) } }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function writeSettings(s: Settings) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    /* the preference just won't persist */
  }
}

interface Ctx {
  settings: Settings
  update: (patch: Partial<Settings>) => void
  reset: () => void
}

const SettingsContext = createContext<Ctx | null>(null)

export function SettingsProvider({ children, initial }: { children: ReactNode; initial?: Partial<Settings> }) {
  const [settings, setSettings] = useState<Settings>(() => ({ ...readSettings(), ...initial }))

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      writeSettings(next)
      return next
    })
  }, [])
  const reset = useCallback(() => {
    writeSettings(DEFAULT_SETTINGS)
    setSettings(DEFAULT_SETTINGS)
  }, [])

  const value = useMemo(() => ({ settings, update, reset }), [settings, update, reset])
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used inside <SettingsProvider>')
  return ctx
}
