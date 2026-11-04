import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, type FocusKind } from '../api'
import { clock } from '../dates'
import { beep, showNotification } from '../sound'
import { useSettings } from '../useSettings'
import {
  KIND_LABEL, durationFor, idleState, loadPending, loadTimer, nextKind, remainingSeconds, saveTimer, savePending,
  type PendingSession, type TimerState,
} from './timerState'
import './focus.css'

export interface FocusApi {
  state: TimerState
  /** Seconds left (or the full length while idle). */
  remaining: number
  planned: number
  active: boolean
  /** Sessions that could not be saved and are waiting for a retry. */
  pendingCount: number
  error: string | null
  /** Honest note shown when a timer finished while the page was closed or suspended. */
  awayNotice: string | null
  /** Increments whenever a session was saved, so pages can refetch stats/history. */
  sessionsVersion: number
  start: (opts?: { kind?: FocusKind; taskId?: number | null }) => void
  startFor: (taskId: number) => void
  pause: () => void
  resume: () => void
  reset: () => void
  stopAndLog: () => Promise<void>
  skip: () => void
  setKind: (kind: FocusKind) => void
  setTask: (taskId: number | null) => void
  retryPending: () => Promise<void>
  dismissNotice: () => void
}

const Ctx = createContext<FocusApi | null>(null)

export function useFocus(): FocusApi {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useFocus must be used inside <FocusProvider>')
  return ctx
}

const AWAY_GRACE_MS = 5000

export function FocusProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings()
  const settingsRef = useRef(settings)
  useEffect(() => {
    settingsRef.current = settings // latest value for timers/callbacks without re-subscribing them
  }, [settings])

  const [state, setState] = useState<TimerState>(() => loadTimer(idleState('Focus', null, 0, settings)))
  const stRef = useRef(state)
  const [now, setNow] = useState(() => Date.now())
  const [pending, setPending] = useState<PendingSession[]>(loadPending)
  const pendingRef = useRef(pending)
  const [error, setError] = useState<string | null>(null)
  const [awayNotice, setAwayNotice] = useState<string | null>(null)
  const [sessionsVersion, setSessionsVersion] = useState(0)

  const commit = useCallback((next: TimerState) => {
    stRef.current = next
    setState(next)
    saveTimer(next)
  }, [])
  const setPendingList = useCallback((list: PendingSession[]) => {
    pendingRef.current = list
    setPending(list)
    savePending(list)
  }, [])

  /** Saves a finished session; if the API is down it is kept (and persisted) for retry instead of being lost. */
  const record = useCallback(async (s: PendingSession) => {
    try {
      await api.recordFocus(s)
      setSessionsVersion((v) => v + 1)
      setError(null)
    } catch (e) {
      setPendingList([...pendingRef.current, s])
      setError(`${e instanceof Error ? e.message : 'Could not save the session.'} The session is kept here; use “Retry saving” when the server is back.`)
    }
  }, [setPendingList])

  const retryPending = useCallback(async () => {
    const queue = [...pendingRef.current]
    const left: PendingSession[] = []
    let failed: string | null = null
    for (const s of queue) {
      if (failed) { left.push(s); continue }
      try {
        await api.recordFocus(s)
      } catch (e) {
        failed = e instanceof Error ? e.message : 'Could not save the session.'
        left.push(s)
      }
    }
    setPendingList(left)
    if (left.length < queue.length) setSessionsVersion((v) => v + 1)
    setError(failed ? `${failed} ${left.length} session(s) still waiting.` : null)
  }, [setPendingList])

  const begin = useCallback((kind: FocusKind, taskId: number | null) => {
    const planned = durationFor(kind, settingsRef.current)
    const t = Date.now()
    setNow(t)
    commit({ ...stRef.current, kind, taskId, plannedSeconds: planned, startedAt: t, status: 'running', endsAt: t + planned * 1000, remainingSeconds: null })
  }, [commit])

  const complete = useCallback((away: boolean) => {
    const s = stRef.current
    if (s.status !== 'running' || s.endsAt === null) return
    const cfg = settingsRef.current
    const endedMs = s.endsAt
    const startedMs = Math.min(s.startedAt, endedMs - s.plannedSeconds * 1000)
    const count = s.kind === 'Focus' ? s.completedFocusCount + 1 : s.completedFocusCount
    const nk = nextKind(s.kind, count, cfg)
    void record({
      kind: s.kind, taskId: s.kind === 'Focus' ? s.taskId : null, plannedSeconds: s.plannedSeconds, actualSeconds: s.plannedSeconds,
      completed: true, startedAt: new Date(startedMs).toISOString(), endedAt: new Date(endedMs).toISOString(),
    })
    commit(idleState(nk, s.taskId, count, cfg))
    if (away) {
      setAwayNotice(`Your ${KIND_LABEL[s.kind].toLowerCase()} finished while TaskFlow was closed or suspended. It was logged as completed from the clock; the browser did not tell us exactly when.`)
      return
    }
    if (cfg.focusSound) beep()
    if (cfg.focusBrowserNotification)
      showNotification(s.kind === 'Focus' ? 'Focus session complete' : 'Break is over', s.kind === 'Focus' ? `Time for a ${KIND_LABEL[nk].toLowerCase()}.` : 'Ready for the next focus session?')
    if (cfg.autoStartNext) begin(nk, s.taskId)
  }, [begin, commit, record])

  // Tick: only refreshes what the clock says. Remaining time is never counted down by ticks.
  useEffect(() => {
    if (state.status !== 'running') return
    const id = setInterval(() => setNow(Date.now()), 1000)
    const wake = () => setNow(Date.now())
    document.addEventListener('visibilitychange', wake)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', wake) }
  }, [state.status])

  useEffect(() => {
    if (state.status === 'running' && state.endsAt !== null && now >= state.endsAt) complete(now - state.endsAt > AWAY_GRACE_MS)
  }, [state, now, complete])

  // A refresh while running: check immediately rather than waiting for the first tick.
  useEffect(() => {
    const s = stRef.current
    const t = Date.now()
    if (s.status === 'running' && s.endsAt !== null && t >= s.endsAt) complete(true)
  }, [complete])

  const remaining = state.status === 'idle' ? durationFor(state.kind, settings) : remainingSeconds(state, now)
  const planned = state.status === 'idle' ? durationFor(state.kind, settings) : state.plannedSeconds

  useEffect(() => {
    if (state.status !== 'running') return
    const original = document.title
    document.title = `${clock(remaining)} · ${KIND_LABEL[state.kind]}`
    return () => { document.title = original }
  }, [state.status, state.kind, remaining])

  const api2 = useMemo<FocusApi>(() => ({
    state, remaining, planned, active: state.status !== 'idle', pendingCount: pending.length, error, awayNotice, sessionsVersion,
    start: (opts) => { setAwayNotice(null); begin(opts?.kind ?? stRef.current.kind, opts?.taskId !== undefined ? opts.taskId : stRef.current.taskId) },
    startFor: (taskId) => { setAwayNotice(null); begin('Focus', taskId) },
    pause: () => {
      const s = stRef.current
      if (s.status !== 'running') return
      commit({ ...s, status: 'paused', remainingSeconds: remainingSeconds(s, Date.now()), endsAt: null })
    },
    resume: () => {
      const s = stRef.current
      if (s.status !== 'paused' || s.remainingSeconds === null) return
      const t = Date.now()
      setNow(t)
      commit({ ...s, status: 'running', endsAt: t + s.remainingSeconds * 1000, remainingSeconds: null })
    },
    reset: () => {
      const s = stRef.current
      commit(idleState(s.kind, s.taskId, s.completedFocusCount, settingsRef.current))
    },
    stopAndLog: async () => {
      const s = stRef.current
      if (s.status === 'idle') return
      const t = Date.now()
      const left = remainingSeconds(s, t)
      const actual = Math.min(s.plannedSeconds - left, Math.floor((t - s.startedAt) / 1000))
      commit(idleState(s.kind, s.taskId, s.completedFocusCount, settingsRef.current))
      if (actual >= 60)
        await record({
          kind: s.kind, taskId: s.kind === 'Focus' ? s.taskId : null, plannedSeconds: s.plannedSeconds, actualSeconds: actual,
          completed: false, startedAt: new Date(s.startedAt).toISOString(), endedAt: new Date(t).toISOString(),
        })
    },
    skip: () => {
      const s = stRef.current
      commit(idleState('Focus', s.taskId, s.completedFocusCount, settingsRef.current))
    },
    setKind: (kind) => {
      const s = stRef.current
      if (s.status === 'idle') commit(idleState(kind, s.taskId, s.completedFocusCount, settingsRef.current))
    },
    setTask: (taskId) => commit({ ...stRef.current, taskId }),
    retryPending,
    dismissNotice: () => setAwayNotice(null),
  }), [state, remaining, planned, pending.length, error, awayNotice, sessionsVersion, begin, commit, record, retryPending])

  return <Ctx.Provider value={api2}>{children}</Ctx.Provider>
}

/** Topbar chip: only visible while a timer is running or paused. It does not announce every second. */
export function FocusMiniTimer() {
  const f = useFocus()
  if (!f.active) return null
  const paused = f.state.status === 'paused'
  return (
    <a
      className={`focus-mini${paused ? ' paused' : ''}`}
      href="#/focus"
      role="timer"
      aria-live="off"
      aria-label={`${KIND_LABEL[f.state.kind]} timer, ${clock(f.remaining)} left${paused ? ', paused' : ''}. Open focus page`}
    >
      <span className="focus-mini-kind">{paused ? 'Paused' : KIND_LABEL[f.state.kind]}</span>
      <span className="focus-mini-time">{clock(f.remaining)}</span>
    </a>
  )
}
