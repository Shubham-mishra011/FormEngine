import type { FocusKind } from '../api'
import type { Settings } from '../useSettings'

export const FOCUS_KEY = 'taskflow-focus'
export const PENDING_KEY = 'taskflow-focus-pending'

export type TimerStatus = 'idle' | 'running' | 'paused'

/** Everything needed to rebuild the timer after a refresh. Time is stored as instants, never as tick counts. */
export interface TimerState {
  kind: FocusKind
  taskId: number | null
  plannedSeconds: number
  startedAt: number // ms; 0 while idle
  status: TimerStatus
  endsAt: number | null // ms; only while running
  remainingSeconds: number | null // only while paused
  completedFocusCount: number
}

export interface PendingSession {
  kind: FocusKind
  taskId: number | null
  plannedSeconds: number
  actualSeconds: number
  completed: boolean
  startedAt: string
  endedAt: string
}

export const KIND_LABEL: Record<FocusKind, string> = { Focus: 'Focus', ShortBreak: 'Short break', LongBreak: 'Long break' }

type Durations = Pick<Settings, 'focusMinutes' | 'shortBreakMinutes' | 'longBreakMinutes' | 'sessionsBeforeLongBreak'>

export function durationFor(kind: FocusKind, s: Durations): number {
  const minutes = kind === 'Focus' ? s.focusMinutes : kind === 'ShortBreak' ? s.shortBreakMinutes : s.longBreakMinutes
  return Math.max(1, Math.round(minutes)) * 60
}

/** Focus → (short | long break) → Focus. Every Nth completed focus session earns the long break. */
export function nextKind(finished: FocusKind, completedFocusCount: number, s: Durations): FocusKind {
  if (finished !== 'Focus') return 'Focus'
  const n = Math.max(1, s.sessionsBeforeLongBreak)
  return completedFocusCount > 0 && completedFocusCount % n === 0 ? 'LongBreak' : 'ShortBreak'
}

export function idleState(kind: FocusKind, taskId: number | null, count: number, s: Durations): TimerState {
  return { kind, taskId, plannedSeconds: durationFor(kind, s), startedAt: 0, status: 'idle', endsAt: null, remainingSeconds: null, completedFocusCount: count }
}

/** Seconds left. A running timer is derived from the clock, so a throttled or suspended tab is still right. */
export function remainingSeconds(st: TimerState, now: number): number {
  if (st.status === 'running' && st.endsAt !== null) return Math.max(0, Math.ceil((st.endsAt - now) / 1000))
  if (st.status === 'paused' && st.remainingSeconds !== null) return st.remainingSeconds
  return st.plannedSeconds
}

export function loadTimer(fallback: TimerState): TimerState {
  try {
    const raw = window.localStorage.getItem(FOCUS_KEY)
    if (!raw) return fallback
    const p = JSON.parse(raw) as Partial<TimerState>
    const kinds: FocusKind[] = ['Focus', 'ShortBreak', 'LongBreak']
    if (!p.kind || !kinds.includes(p.kind) || !['idle', 'running', 'paused'].includes(p.status ?? '')) return fallback
    if (p.status === 'running' && typeof p.endsAt !== 'number') return fallback
    if (p.status === 'paused' && typeof p.remainingSeconds !== 'number') return fallback
    return { ...fallback, ...p } as TimerState
  } catch {
    return fallback
  }
}

export function saveTimer(st: TimerState) {
  try {
    window.localStorage.setItem(FOCUS_KEY, JSON.stringify(st))
  } catch {
    /* the timer just will not survive a refresh */
  }
}

export function loadPending(): PendingSession[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(PENDING_KEY) ?? '[]')
    return Array.isArray(v) ? (v as PendingSession[]) : []
  } catch {
    return []
  }
}

export function savePending(list: PendingSession[]) {
  try {
    if (list.length === 0) window.localStorage.removeItem(PENDING_KEY)
    else window.localStorage.setItem(PENDING_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}
