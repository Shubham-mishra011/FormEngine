import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DashboardPage } from './pages/DashboardPage'
import { installFakeServer, makeTask, reply } from './testing/fakeServer'
import { renderWithProviders } from './testing/render'
import { DEFAULT_SETTINGS, SETTINGS_KEY } from './useSettings'

const at = (h: number) => new Date(2026, 9, 21, h, 0) // Wed 2026-10-21, local time

function setClock(h = 9) {
  vi.useFakeTimers({ toFake: ['Date'] }) // only Date: timers and promises keep working
  vi.setSystemTime(at(h))
}

beforeEach(() => {
  window.localStorage.clear()
  setClock(9)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const region = (name: string) => screen.getByRole('region', { name })

const tasks = () => [
  makeTask({ id: 1, title: 'Due today A', dueDate: '2026-10-21', dueTime: '14:30:00' }),
  makeTask({ id: 2, title: 'Tomorrow B', dueDate: '2026-10-22' }),
  makeTask({ id: 3, title: 'Late C', dueDate: '2026-10-18', priority: 'High' }),
  makeTask({ id: 4, title: 'Urgent D', priority: 'Urgent' }),
  makeTask({ id: 5, title: 'Finished E', isCompleted: true, status: 'Done', completedAt: at(8).toISOString(), dueDate: '2026-10-21' }),
  makeTask({ id: 6, title: 'Far away F', dueDate: '2026-12-01' }),
]

describe('greeting', () => {
  it.each([
    [9, 'Good morning'],
    [13, 'Good afternoon'],
    [20, 'Good evening'],
  ])('at %i:00 says %s, with the date and no invented name', async (hour, text) => {
    setClock(hour)
    installFakeServer({})
    renderWithProviders(<DashboardPage />)
    expect(await screen.findByRole('heading', { name: text })).toBeInTheDocument()
    expect(screen.getByText('Wednesday, October 21')).toBeInTheDocument()
  })
})

describe('widgets', () => {
  it('show real data in the right place', async () => {
    installFakeServer({ tasks: tasks() })
    renderWithProviders(<DashboardPage />)
    await screen.findByText('Due today A')

    const today = region('Today')
    expect(within(today).getByText('Due today A')).toBeInTheDocument()
    expect(within(today).queryByText('Finished E')).toBeNull() // completed tasks are not "to do today"
    expect(within(today).queryByText('Tomorrow B')).toBeNull()

    expect(within(region('Overdue')).getByText('Late C')).toBeInTheDocument()
    expect(within(region('Overdue')).getByText('3 days overdue')).toBeInTheDocument()

    const upcoming = region('Upcoming (next 7 days)')
    expect(within(upcoming).getByText('Tomorrow B')).toBeInTheDocument()
    expect(within(upcoming).queryByText('Far away F')).toBeNull() // beyond a week
    expect(within(upcoming).queryByText('Due today A')).toBeNull()

    const high = region('High priority')
    expect(within(high).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('Urgent D'), // most urgent first, then by date
      expect.stringContaining('Late C'),
    ])
  })

  it('shows the due time in the chosen format', async () => {
    installFakeServer({ tasks: tasks() })
    renderWithProviders(<DashboardPage />, { ...DEFAULT_SETTINGS, timeFormat: '24h' })
    await screen.findByText('Due today A')
    expect(within(region('Today')).getByText(/Today · 14:30/)).toBeInTheDocument()
  })

  it('completion progress counts completed against all tasks', async () => {
    installFakeServer({ tasks: tasks() })
    renderWithProviders(<DashboardPage />)
    await screen.findByText('Due today A')
    const bar = within(region('Completion progress')).getByRole('progressbar', { name: '1 of 6 tasks completed' })
    expect(bar).toHaveAttribute('aria-valuenow', '17')
    expect(region('Completion progress')).toHaveTextContent('1 completed today · 5 open')
  })

  it('ticking a task in the dashboard completes it through the API', async () => {
    const api = installFakeServer({ tasks: tasks() })
    const user = userEvent.setup()
    renderWithProviders(<DashboardPage />)
    await user.click(await screen.findByRole('checkbox', { name: 'Mark "Due today A" as done' }))
    await waitFor(() => expect(api.calls).toContain('PATCH /api/tasks/1/toggle'))
    await waitFor(() => expect(within(region('Today')).queryByText('Due today A')).toBeNull())
  })

  it('has friendly empty states', async () => {
    installFakeServer({})
    renderWithProviders(<DashboardPage />)
    await screen.findByText('Nothing due today.')
    expect(screen.getByText('Nothing is overdue.')).toBeInTheDocument()
    expect(screen.getByText('Nothing due in the next week.')).toBeInTheDocument()
    expect(screen.getByText('No open High or Urgent tasks.')).toBeInTheDocument()
    expect(screen.getByText(/No tasks yet — add one with Q/)).toBeInTheDocument()
  })

  it('caps long lists and links to the full page', async () => {
    const many = Array.from({ length: 9 }, (_, i) => makeTask({ id: i + 1, title: `Today ${i + 1}`, dueDate: '2026-10-21' }))
    installFakeServer({ tasks: many })
    renderWithProviders(<DashboardPage />)
    await screen.findByText('Today 1')
    expect(within(region('Today')).getAllByRole('listitem')).toHaveLength(6)
    expect(within(region('Today')).getByRole('link', { name: '3 more due today' })).toHaveAttribute('href', '#/today')
  })

  it('shows skeleton placeholders until the first load finishes', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    installFakeServer({ handlers: { 'GET /api/tasks': () => gate.then(() => reply([])) as unknown as Response } })
    renderWithProviders(<DashboardPage />)
    expect(screen.getByRole('status', { name: 'Loading dashboard…' })).toBeInTheDocument()
    release()
    await screen.findByText('Nothing due today.')
    expect(screen.queryByRole('status', { name: 'Loading dashboard…' })).toBeNull()
  })

  it('opens the full editor from New task and explains quick add', async () => {
    installFakeServer({})
    const user = userEvent.setup()
    renderWithProviders(<DashboardPage />)
    expect(screen.getByText(/to quick-add/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /New task/ }))
    expect(await screen.findByRole('dialog', { name: 'New task' })).toBeInTheDocument()
  })
})

describe('focus and productivity widgets', () => {
  it('summarise real focus and completion numbers', async () => {
    const api = installFakeServer({ tasks: tasks() })
    renderWithProviders(<DashboardPage />)
    const focus = await waitFor(() => {
      const r = region('Focus')
      expect(within(r).getByText('50m')).toBeInTheDocument()
      return r
    })
    expect(focus).toHaveTextContent('Sessions today2')
    expect(focus).toHaveTextContent('Streak2 days')
    expect(within(focus).getByRole('link', { name: 'Open Focus' })).toHaveAttribute('href', '#/focus')
    expect(api.calls).toContain('GET /api/focus/stats?days=7')

    const prod = region('Productivity')
    await waitFor(() => expect(prod).toHaveTextContent('This week5'))
    expect(prod).toHaveTextContent('Done today2')
    expect(within(prod).getByRole('img', { name: /Tasks completed per day over the last \d+ days/ })).toBeInTheDocument()
    expect(api.calls).toContain('GET /api/analytics?days=14')
  })

  it('degrade gracefully when the statistics fail', async () => {
    installFakeServer({
      tasks: tasks(),
      handlers: {
        'GET /api/focus/stats': () => reply({ title: 'boom' }, 500),
        'GET /api/analytics': () => reply({ title: 'boom' }, 500),
      },
    })
    renderWithProviders(<DashboardPage />)
    expect(await screen.findByText('Focus statistics are unavailable right now.')).toBeInTheDocument()
    expect(screen.getByText('Productivity numbers are unavailable right now.')).toBeInTheDocument()
    expect(screen.getByText('Due today A')).toBeInTheDocument() // the rest of the page is unaffected
  })
})

describe('customizing', () => {
  it('hides a widget, remembers it, and restores it', async () => {
    installFakeServer({ tasks: tasks() })
    const user = userEvent.setup()
    const first = renderWithProviders(<DashboardPage />)
    await screen.findByText('Due today A')
    await user.click(screen.getByRole('button', { name: /Customize/ }))
    await user.click(screen.getByRole('checkbox', { name: 'Show Overdue' }))
    expect(screen.queryByRole('region', { name: 'Overdue' })).toBeNull()
    expect(JSON.parse(window.localStorage.getItem(SETTINGS_KEY)!).widgets.overdue).toBe(false)

    first.unmount() // a "reload"
    renderWithProviders(<DashboardPage />)
    await screen.findByText('Due today A')
    expect(screen.queryByRole('region', { name: 'Overdue' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Today' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Customize/ }))
    expect(screen.getByRole('checkbox', { name: 'Show Overdue' })).not.toBeChecked()
    await user.click(screen.getByRole('checkbox', { name: 'Show Overdue' }))
    expect(screen.getByRole('region', { name: 'Overdue' })).toBeInTheDocument()
  })

  it('respects widgets disabled in settings from the start', async () => {
    installFakeServer({ tasks: tasks() })
    renderWithProviders(<DashboardPage />, {
      widgets: { ...DEFAULT_SETTINGS.widgets, focus: false, productivity: false, shortcuts: false, progress: false },
    })
    await screen.findByText('Due today A')
    for (const name of ['Focus', 'Productivity', 'Shortcuts', 'Completion progress'])
      expect(screen.queryByRole('region', { name })).toBeNull()
    expect(screen.getByRole('region', { name: 'Today' })).toBeInTheDocument()
  })

  it('explains the empty page when every widget is hidden', async () => {
    installFakeServer({ tasks: tasks() })
    const none = Object.fromEntries(Object.keys(DEFAULT_SETTINGS.widgets).map((k) => [k, false])) as typeof DEFAULT_SETTINGS.widgets
    renderWithProviders(<DashboardPage />, { widgets: none })
    expect(await screen.findByText('All widgets are hidden')).toBeInTheDocument()
  })
})
