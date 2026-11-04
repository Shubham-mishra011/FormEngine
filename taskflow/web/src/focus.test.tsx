import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FocusMiniTimer } from './focus/FocusProvider'
import { FOCUS_KEY, PENDING_KEY, durationFor, idleState, nextKind, remainingSeconds } from './focus/timerState'
import { FocusPage } from './pages/FocusPage'
import { installFakeServer, makeTask, reply } from './testing/fakeServer'
import { renderWithProviders } from './testing/render'
import type { Settings } from './useSettings'

const T0 = Date.UTC(2026, 9, 21, 12, 0, 0)
const MIN = 60_000

function ui() {
  return (
    <>
      <FocusMiniTimer />
      <FocusPage />
    </>
  )
}

/** Moves the (frozen) clock and lets the open page notice, the way a waking tab does. */
async function advance(ms: number) {
  await act(async () => {
    vi.setSystemTime(Date.now() + ms)
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

function sessionBodies(server: ReturnType<typeof installFakeServer>) {
  return (server.bodies['POST /api/focus/sessions'] ?? []).map((b) => JSON.parse(b as string))
}

const open = (settings?: Partial<Settings>) => renderWithProviders(ui(), settings)

beforeEach(() => {
  window.localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('timer helpers', () => {
  const s = { focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, sessionsBeforeLongBreak: 4 }
  it('durations and break cycle', () => {
    expect(durationFor('Focus', s)).toBe(1500)
    expect(durationFor('LongBreak', s)).toBe(900)
    expect(nextKind('Focus', 1, s)).toBe('ShortBreak')
    expect(nextKind('Focus', 4, s)).toBe('LongBreak')
    expect(nextKind('Focus', 8, s)).toBe('LongBreak')
    expect(nextKind('ShortBreak', 1, s)).toBe('Focus')
  })
  it('remaining time comes from the clock', () => {
    const idle = idleState('Focus', null, 0, s)
    const running = { ...idle, status: 'running' as const, endsAt: T0 + 100_000 }
    expect(remainingSeconds(running, T0)).toBe(100)
    expect(remainingSeconds(running, T0 + 40_000)).toBe(60)
    expect(remainingSeconds(running, T0 + 500_000)).toBe(0)
    expect(remainingSeconds({ ...idle, status: 'paused', remainingSeconds: 42 }, T0)).toBe(42)
    expect(remainingSeconds(idle, T0)).toBe(1500)
  })
})

describe('focus timer', () => {
  it('starts, shows the mini timer and counts from the clock', async () => {
    installFakeServer()
    open()
    expect(screen.queryByRole('timer', { name: /left/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Start/ }))
    expect(screen.getByRole('timer', { name: /Focus timer, 25:00 left/ })).toHaveAttribute('href', '#/focus')
    await advance(10 * MIN)
    expect(screen.getByRole('timer', { name: /15:00 left/ })).toBeInTheDocument()
    expect(document.title).toBe('15:00 · Focus')
  })

  it('pause freezes the time and resume continues from it', async () => {
    installFakeServer()
    open()
    await userEvent.click(screen.getByRole('button', { name: /Start/ }))
    await advance(5 * MIN)
    await userEvent.click(screen.getByRole('button', { name: /Pause/ }))
    expect(screen.getByRole('timer', { name: /20:00 left, paused/ })).toBeInTheDocument()
    await advance(30 * MIN)
    expect(screen.getByRole('timer', { name: /20:00 left, paused/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Resume/ }))
    await advance(MIN)
    expect(screen.getByRole('timer', { name: /19:00 left$|19:00 left\./ })).toBeInTheDocument()
  })

  it('reset discards the run without saving anything', async () => {
    const server = installFakeServer()
    open()
    await userEvent.click(screen.getByRole('button', { name: /Start/ }))
    await advance(10 * MIN)
    await userEvent.click(screen.getByRole('button', { name: /Reset/ }))
    expect(screen.getByRole('button', { name: /Start/ })).toBeInTheDocument()
    expect(sessionBodies(server)).toHaveLength(0)
    expect(screen.queryByRole('timer', { name: /Focus timer/ })).not.toBeInTheDocument()
  })

  it('records a completed session, then moves to a short break', async () => {
    const server = installFakeServer()
    open()
    await userEvent.click(screen.getByRole('button', { name: /Start/ }))
    await advance(25 * MIN)
    await waitFor(() => expect(sessionBodies(server)).toHaveLength(1))
    const b = sessionBodies(server)[0]
    expect(b).toMatchObject({ kind: 'Focus', taskId: null, plannedSeconds: 1500, actualSeconds: 1500, completed: true })
    expect(Date.parse(b.endedAt) - Date.parse(b.startedAt)).toBeGreaterThanOrEqual(b.actualSeconds * 1000)
    expect(screen.getByRole('tab', { name: 'Short break' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: /Start/ })).toBeInTheDocument()
    expect(screen.queryByText(/finished while/)).not.toBeInTheDocument()
  })

  it('earns a long break after the configured number of sessions', async () => {
    installFakeServer()
    open({ sessionsBeforeLongBreak: 2, focusMinutes: 10 })
    const finish = async (mins: number) => {
      await userEvent.click(screen.getByRole('button', { name: /Start/ }))
      await advance(mins * MIN)
    }
    await finish(10)
    expect(screen.getByRole('tab', { name: 'Short break' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Skip break' }))
    expect(screen.getByRole('tab', { name: 'Focus' })).toHaveAttribute('aria-selected', 'true')
    await finish(10)
    expect(screen.getByRole('tab', { name: 'Long break' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('timer', { name: '15:00 remaining' })).toBeInTheDocument()
  })

  it('auto-starts the next period when asked to', async () => {
    installFakeServer()
    open({ autoStartNext: true })
    await userEvent.click(screen.getByRole('button', { name: /Start/ }))
    await advance(25 * MIN)
    expect(screen.getByRole('timer', { name: /Short break timer, 05:00 left/ })).toBeInTheDocument()
  })

  it('associates the session with the chosen task', async () => {
    const server = installFakeServer({ tasks: [makeTask({ id: 7, title: 'Write report' }), makeTask({ id: 8, title: 'Done one', isCompleted: true, status: 'Done' })] })
    open()
    const select = await screen.findByRole('combobox', { name: 'Task for this session' })
    await waitFor(() => expect(within(select).getByRole('option', { name: 'Write report' })).toBeInTheDocument())
    expect(within(select).queryByRole('option', { name: 'Done one' })).not.toBeInTheDocument()
    await userEvent.selectOptions(select, 'Write report')
    await userEvent.click(screen.getByRole('button', { name: /Start/ }))
    await advance(25 * MIN)
    await waitFor(() => expect(sessionBodies(server)).toHaveLength(1))
    expect(sessionBodies(server)[0].taskId).toBe(7)
  })

  it('Stop & log saves a partial session only when it lasted a minute', async () => {
    const server = installFakeServer()
    open()
    await userEvent.click(screen.getByRole('button', { name: /Start/ }))
    await advance(30_000)
    await userEvent.click(screen.getByRole('button', { name: /Stop & log/ }))
    expect(sessionBodies(server)).toHaveLength(0)

    await userEvent.click(screen.getByRole('button', { name: /Start/ }))
    await advance(3 * MIN)
    await userEvent.click(screen.getByRole('button', { name: /Stop & log/ }))
    await waitFor(() => expect(sessionBodies(server)).toHaveLength(1))
    expect(sessionBodies(server)[0]).toMatchObject({ completed: false, actualSeconds: 180, plannedSeconds: 1500 })
  })

  it('survives a refresh while running and while paused', async () => {
    installFakeServer()
    const first = open()
    await userEvent.click(screen.getByRole('button', { name: /Start/ }))
    await advance(5 * MIN)
    first.unmount()
    expect(JSON.parse(window.localStorage.getItem(FOCUS_KEY)!)).toMatchObject({ status: 'running', kind: 'Focus' })

    await act(async () => { vi.setSystemTime(Date.now() + MIN) })
    const second = open()
    expect(screen.getByRole('timer', { name: /19:00 left/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Pause/ }))
    second.unmount()

    await act(async () => { vi.setSystemTime(Date.now() + 60 * MIN) })
    open()
    expect(screen.getByRole('timer', { name: /19:00 left, paused/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Resume/ })).toBeInTheDocument()
  })

  it('finishes a timer that expired while the page was closed and says so honestly', async () => {
    const server = installFakeServer()
    const first = open()
    await userEvent.click(screen.getByRole('button', { name: /Start/ }))
    first.unmount()
    await act(async () => { vi.setSystemTime(Date.now() + 40 * MIN) })
    open()
    await waitFor(() => expect(sessionBodies(server)).toHaveLength(1))
    expect(sessionBodies(server)[0]).toMatchObject({ completed: true, actualSeconds: 1500 })
    expect(Date.parse(sessionBodies(server)[0].endedAt)).toBe(T0 + 25 * MIN)
    expect(screen.getByText(/finished while TaskFlow was closed or suspended/)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Short break' })).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps the session for retry when the API fails', async () => {
    let down = true
    const server = installFakeServer({
      handlers: { 'POST /api/focus/sessions': () => (down ? reply({ title: 'Boom' }, 500) : undefined) },
    })
    open()
    await userEvent.click(screen.getByRole('button', { name: /Start/ }))
    await advance(25 * MIN)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Boom/)
    expect(JSON.parse(window.localStorage.getItem(PENDING_KEY)!)).toHaveLength(1)

    down = false
    await userEvent.click(screen.getByRole('button', { name: /Retry saving \(1\)/ }))
    await waitFor(() => expect(window.localStorage.getItem(PENDING_KEY)).toBeNull())
    expect(screen.queryByText(/Boom/)).not.toBeInTheDocument()
    expect(server.bodies['POST /api/focus/sessions']).toHaveLength(2)
  })
})

describe('focus alerts', () => {
  function stubNotification(permission: NotificationPermission) {
    const shown: string[] = []
    const requestPermission = vi.fn(async () => 'granted' as NotificationPermission)
    class Fake {
      static permission = permission
      static requestPermission = requestPermission
      constructor(title: string) { shown.push(title) }
    }
    vi.stubGlobal('Notification', Fake)
    Object.defineProperty(window, 'Notification', { value: Fake, configurable: true })
    return { shown, requestPermission }
  }

  it('notifies on completion only when permission is already granted', async () => {
    const n = stubNotification('granted')
    installFakeServer()
    open({ focusSound: false })
    await userEvent.click(screen.getByRole('button', { name: /Start/ }))
    await advance(25 * MIN)
    expect(n.shown).toEqual(['Focus session complete'])
  })

  it('never asks for permission on load, and not when permission is not granted', async () => {
    const n = stubNotification('default')
    installFakeServer()
    open()
    expect(n.requestPermission).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /Start/ }))
    await advance(25 * MIN)
    expect(n.shown).toEqual([])
    await userEvent.click(screen.getByRole('button', { name: 'Enable notifications' }))
    expect(n.requestPermission).toHaveBeenCalledTimes(1)
  })

  it('respects the setting that turns completion notifications off', async () => {
    const n = stubNotification('granted')
    installFakeServer()
    open({ focusBrowserNotification: false })
    await userEvent.click(screen.getByRole('button', { name: /Start/ }))
    await advance(25 * MIN)
    expect(n.shown).toEqual([])
  })
})

describe('focus page data', () => {
  it('shows real stats, the chart table and history, and deletes with confirmation', async () => {
    const server = installFakeServer({
      focusSessions: [
        { id: 1, taskId: null, taskTitle: 'Plan', kind: 'Focus', plannedSeconds: 1500, actualSeconds: 1500, completed: true, startedAt: '2026-10-20T09:00:00Z', endedAt: '2026-10-20T09:25:00Z' },
      ],
    })
    open()
    expect(await screen.findByText('Session history')).toBeInTheDocument()
    expect(await screen.findByText('50 min')).toBeInTheDocument() // today (3000 s) from the stats API
    expect(screen.getByText(/Last 14 days/)).toBeInTheDocument()
    expect(screen.getByText(/keep this tab open for alerts/)).toBeInTheDocument()
    expect(await screen.findByText('Plan', { exact: false })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Delete focus session of 25 min/ }))
    const dialog = screen.getByRole('dialog', { name: 'Delete session?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(server.calls).toContain('DELETE /api/focus/sessions/1'))
    await waitFor(() => expect(screen.getByText('No sessions yet')).toBeInTheDocument())
  })

  it('shows a load error with retry', async () => {
    installFakeServer({ handlers: { 'GET /api/focus/stats': () => reply({ title: 'Stats down' }, 500) } })
    open()
    expect(await screen.findByText('Stats down')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  })
})
