import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppNotification } from './api'
import { NotificationBell } from './components/NotificationBell'
import { POLL_MS } from './useNotifications'
import { installFakeServer, makeTask, reply } from './testing/fakeServer'
import { renderWithProviders } from './testing/render'
import type { Settings } from './useSettings'

const note = (over: Partial<AppNotification> & { id: number; title: string }): AppNotification => ({
  taskId: null, kind: 'Reminder', message: null, createdAt: new Date().toISOString(), readAt: null, ...over,
})

const open = (settings?: Partial<Settings>) => renderWithProviders(<NotificationBell />, settings)
const bell = (name: RegExp | string = /^Notifications/) => screen.findByRole('button', { name })

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  Object.defineProperty(document, 'hidden', { value: false, configurable: true })
})

function stubNotification(permission: NotificationPermission) {
  const shown: string[] = []
  const requestPermission = vi.fn(async () => 'granted' as NotificationPermission)
  class Fake {
    static permission = permission
    static requestPermission = requestPermission
    constructor(title: string) { shown.push(title) }
  }
  Object.defineProperty(window, 'Notification', { value: Fake, configurable: true })
  return { shown, requestPermission }
}

describe('notification bell', () => {
  it('shows the unread count in its name', async () => {
    installFakeServer({ notifications: [note({ id: 1, title: 'A' }), note({ id: 2, title: 'B' }), note({ id: 3, title: 'C', readAt: '2026-10-21T00:00:00Z' })] })
    open()
    expect(await bell('Notifications, 2 unread')).toBeInTheDocument()
  })

  it('has no count when everything is read', async () => {
    installFakeServer()
    open()
    expect(await bell('Notifications')).toBeInTheDocument()
  })

  it('lists newest first, marks read/unread and dismisses', async () => {
    const server = installFakeServer({ notifications: [note({ id: 1, title: 'Pay rent' }), note({ id: 2, title: 'Call Sam' })] })
    open()
    await userEvent.click(await bell('Notifications, 2 unread'))
    const panel = screen.getByRole('dialog', { name: 'Notifications panel' })
    expect(within(panel).getByText('Pay rent')).toBeInTheDocument()

    await userEvent.click(within(panel).getByRole('button', { name: 'Mark "Pay rent" as read' }))
    await waitFor(() => expect(server.calls).toContain('PATCH /api/notifications/1/read?read=true'))
    expect(await screen.findByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument()
    await userEvent.click(within(panel).getByRole('button', { name: 'Mark "Pay rent" as unread' }))
    await waitFor(() => expect(server.calls).toContain('PATCH /api/notifications/1/read?read=false'))

    await userEvent.click(within(panel).getByRole('button', { name: 'Dismiss "Call Sam"' }))
    await waitFor(() => expect(within(panel).queryByText('Call Sam')).not.toBeInTheDocument())
  })

  it('marks all read and dismisses all', async () => {
    const server = installFakeServer({ notifications: [note({ id: 1, title: 'A' }), note({ id: 2, title: 'B' })] })
    open()
    await userEvent.click(await bell('Notifications, 2 unread'))
    await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }))
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss all' }))
    expect(await screen.findByText(/all caught up/)).toBeInTheDocument()
    expect(server.calls).toContain('DELETE /api/notifications')
  })

  it('opens the task from a task notification', async () => {
    installFakeServer({ tasks: [makeTask({ id: 5, title: 'Pay rent' })], notifications: [note({ id: 1, title: 'Pay rent', taskId: 5 })] })
    renderWithProviders(<NotificationBell />)
    await userEvent.click(await bell('Notifications, 1 unread'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pay rent' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Pay rent' }))
    expect(await screen.findByRole('dialog', { name: 'Edit task' })).toBeInTheDocument()
  })

  it('closes with Escape and returns focus to the bell', async () => {
    installFakeServer()
    open()
    const b = await bell('Notifications')
    await userEvent.click(b)
    expect(screen.getByRole('dialog', { name: 'Notifications panel' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(b).toHaveFocus()
  })

  it('upcoming tab lists reminders and overdue tasks', async () => {
    installFakeServer({
      tasks: [makeTask({ id: 9, title: 'Late thing', dueDate: '2020-01-01' })],
      handlers: {
        'GET /api/reminders/upcoming': () => reply({
          upcoming: [{ reminderId: 1, taskId: 3, taskTitle: 'Dentist', remindAt: '2026-10-22T08:00:00Z', minutesBefore: 30, dueDate: '2026-10-22', dueTime: '08:30:00' }],
          overdueTasks: [makeTask({ id: 9, title: 'Late thing', dueDate: '2020-01-01' })],
        }),
      },
    })
    open()
    await userEvent.click(await bell())
    await userEvent.click(screen.getByRole('tab', { name: 'Upcoming' }))
    expect(await screen.findByText('Dentist')).toBeInTheDocument()
    expect(screen.getByText('Late thing')).toBeInTheDocument()
    expect(screen.getByText(/Closed tab = no alerts/)).toBeInTheDocument()
  })

  it('shows an offline note instead of crashing when the API is down', async () => {
    installFakeServer({ handlers: { 'GET /api/notifications': () => reply({ title: 'down' }, 500) } })
    open()
    await userEvent.click(await bell())
    expect(await screen.findByText(/Can’t reach the server/)).toBeInTheDocument()
  })
})

describe('preferences', () => {
  it('requests browser permission only on an explicit click and stores the choice', async () => {
    const n = stubNotification('default')
    installFakeServer()
    open()
    await userEvent.click(await bell())
    expect(n.requestPermission).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Browser notifications' }))
    expect(n.requestPermission).toHaveBeenCalledTimes(1)
    expect(JSON.parse(window.localStorage.getItem('taskflow-settings')!).browserNotifications).toBe(true)
  })

  it('disables the browser option when notifications are blocked', async () => {
    stubNotification('denied')
    installFakeServer()
    open()
    await userEvent.click(await bell())
    expect(screen.getByRole('checkbox', { name: 'Browser notifications' })).toBeDisabled()
    expect(screen.getByText(/Blocked in your browser settings/)).toBeInTheDocument()
  })

  it('toggles sound and overdue alerts', async () => {
    installFakeServer()
    open()
    await userEvent.click(await bell())
    await userEvent.click(screen.getByRole('checkbox', { name: 'Sound' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Overdue alerts' }))
    const saved = JSON.parse(window.localStorage.getItem('taskflow-settings')!)
    expect(saved).toMatchObject({ notificationSound: true, overdueAlerts: false })
  })
})

describe('polling and system notifications', () => {
  it('does not fire a system notification for what was already there on first load', async () => {
    const n = stubNotification('granted')
    installFakeServer({ notifications: [note({ id: 1, title: 'Old' })] })
    open({ browserNotifications: true })
    await bell('Notifications, 1 unread')
    expect(n.shown).toEqual([])
  })

  it('fires one for a notification that appears later, and syncs with the overdue preference', async () => {
    const n = stubNotification('granted')
    const list: AppNotification[] = []
    const server = installFakeServer({
      handlers: { 'GET /api/notifications': () => reply({ items: list, unread: list.length }) },
    })
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    open({ browserNotifications: true, overdueAlerts: false })
    await vi.waitFor(() => expect(server.calls).toContain('POST /api/notifications/sync?overdue=false'))
    await vi.waitFor(() => expect(server.calls).toContain('GET /api/notifications'))
    await vi.advanceTimersByTimeAsync(50)
    list.push(note({ id: 5, title: 'New reminder' }))
    await vi.advanceTimersByTimeAsync(POLL_MS + 10)
    await vi.waitFor(() => expect(n.shown).toEqual(['New reminder']))
    await vi.advanceTimersByTimeAsync(POLL_MS + 10)
    expect(n.shown).toEqual(['New reminder']) // not repeated
  })

  it('does not notify when the user has not enabled browser notifications', async () => {
    const n = stubNotification('granted')
    const list: AppNotification[] = []
    installFakeServer({ handlers: { 'GET /api/notifications': () => reply({ items: list, unread: list.length }) } })
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    open({ browserNotifications: false })
    await vi.advanceTimersByTimeAsync(10)
    list.push(note({ id: 6, title: 'Quiet' }))
    await vi.advanceTimersByTimeAsync(POLL_MS + 10)
    expect(n.shown).toEqual([])
  })

  it('pauses polling while the tab is hidden and catches up when it is shown', async () => {
    const server = installFakeServer()
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    open()
    await vi.advanceTimersByTimeAsync(10)
    const syncs = () => server.calls.filter((c) => c.startsWith('POST /api/notifications/sync')).length
    const before = syncs()
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)
    expect(syncs()).toBe(before)

    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(10)
    expect(syncs()).toBe(before + 1)
  })

  it('stops polling after unmount', async () => {
    const server = installFakeServer()
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const r = open()
    await vi.advanceTimersByTimeAsync(10)
    r.unmount()
    const n = server.calls.length
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)
    expect(server.calls.length).toBe(n)
  })
})
