import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { installFakeServer, reply, sampleAnalytics } from './testing/fakeServer'

beforeEach(() => {
  window.localStorage.clear()
  window.location.hash = '#/analytics'
})
afterEach(() => {
  vi.unstubAllGlobals()
  window.location.hash = ''
})

function openAnalytics() {
  render(<App />)
  return userEvent.setup()
}

const kpi = (label: string) => screen.getByText(label).closest('div')!

describe('analytics page', () => {
  it('shows the headline numbers from the API', async () => {
    installFakeServer({ analytics: sampleAnalytics() })
    openAnalytics()
    await screen.findByRole('heading', { name: 'Productivity' })
    expect(within(kpi('Completed today')).getByText('2')).toBeInTheDocument()
    expect(within(kpi('Completed this week')).getByText('5')).toBeInTheDocument()
    expect(within(kpi('Completed this month')).getByText('12')).toBeInTheDocument()
    expect(within(kpi('Completed this month')).getByText('15 created')).toBeInTheDocument()
    expect(within(kpi('Completion rate')).getByText('60%')).toBeInTheDocument()
    expect(within(kpi('Completion rate')).getByText('6 of 10 tasks')).toBeInTheDocument()
    expect(within(kpi('Avg. time to complete')).getByText('5.0 h')).toBeInTheDocument()
    expect(within(kpi('Overdue')).getByText('1')).toBeInTheDocument()
    expect(within(kpi('Completed this week')).getByText(/since Oct 19 \(Mon\)/)).toBeInTheDocument()
  })

  it('shows current and best streaks, and honest dashes when there is no history', async () => {
    installFakeServer({ analytics: sampleAnalytics({ currentStreak: 3, bestStreak: 7 }) })
    openAnalytics()
    await screen.findByRole('heading', { name: 'Productivity' })
    expect(within(kpi('Current streak')).getByText('3 days')).toBeInTheDocument()
    expect(within(kpi('Best streak')).getByText('7 days')).toBeInTheDocument()
  })

  it('does not invent a streak when nothing was ever completed', async () => {
    installFakeServer({ analytics: sampleAnalytics({ currentStreak: 0, bestStreak: 0 }) })
    openAnalytics()
    await screen.findByRole('heading', { name: 'Productivity' })
    expect(within(kpi('Current streak')).getByText('—')).toBeInTheDocument()
    expect(within(kpi('Best streak')).getByText('—')).toBeInTheDocument()
    expect(within(kpi('Best streak')).getByText('No completions recorded yet')).toBeInTheDocument()
  })

  it('explains a broken streak without hiding the best one', async () => {
    installFakeServer({ analytics: sampleAnalytics({ currentStreak: 0, bestStreak: 4 }) })
    openAnalytics()
    await screen.findByRole('heading', { name: 'Productivity' })
    expect(within(kpi('Current streak')).getByText('0 days')).toBeInTheDocument()
    expect(within(kpi('Current streak')).getByText(/Complete a task today/)).toBeInTheDocument()
    expect(within(kpi('Best streak')).getByText('4 days')).toBeInTheDocument()
  })

  it('draws the trend chart with an accessible summary and a data table alternative', async () => {
    installFakeServer({ analytics: sampleAnalytics() })
    const user = openAnalytics()
    const chart = await screen.findByRole('img', { name: /Tasks completed per day over the last 30 days: \d+ in total/ })
    expect(chart.querySelectorAll('rect.bar')).toHaveLength(30)

    await user.click(screen.getByText('View the data as a table'))
    const table = screen.getByText('View the data as a table').closest('details')!
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(31) // header + 30 days
    expect(within(rows[1]).getAllByRole('cell')).toHaveLength(2)
  })

  it('draws weekly (12) and monthly (12) charts with summaries and tables', async () => {
    installFakeServer({ analytics: sampleAnalytics() })
    const user = openAnalytics()
    const weekly = await screen.findByRole('img', { name: /Tasks completed per week over the last 12 weeks: 66 in total/ })
    expect(weekly.querySelectorAll('rect.bar')).toHaveLength(12)
    const monthly = screen.getByRole('img', { name: /Tasks completed per month over the last 12 months: 102 in total/ })
    expect(monthly.querySelectorAll('rect.bar')).toHaveLength(12)

    await user.click(screen.getByText('View weekly data as a table'))
    const rows = within(screen.getByText('View weekly data as a table').closest('details')!).getAllByRole('row')
    expect(rows).toHaveLength(13)
    expect(screen.getByRole('columnheader', { name: 'Week starting' })).toBeInTheDocument()
  })

  it('omits weekly and monthly sections when the server does not send them', async () => {
    installFakeServer({ analytics: sampleAnalytics({ weekly: undefined, monthly: undefined }) })
    openAnalytics()
    await screen.findByRole('heading', { name: 'Productivity' })
    expect(screen.queryByText('Weekly productivity')).toBeNull()
    expect(screen.queryByText('Monthly productivity')).toBeNull()
  })

  it('puts the chart in a keyboard-reachable scroll region that starts at the newest day', async () => {
    installFakeServer({ analytics: sampleAnalytics() })
    const user = openAnalytics()
    const region = await screen.findByRole('region', { name: /Completions chart/ })
    expect(region).toHaveAttribute('tabindex', '0')
    Object.defineProperty(region, 'scrollWidth', { configurable: true, value: 900 })
    // re-render with new data to trigger the scroll-to-end effect against the stubbed width
    await user.click(screen.getByRole('button', { name: '7 days' }))
    await waitFor(() => expect((screen.getByRole('region', { name: /Completions chart/ }) as HTMLElement).scrollLeft).toBe(900))
  })

  it('lists priority (including Urgent) and category breakdowns, including uncategorised', async () => {
    installFakeServer({ analytics: sampleAnalytics() })
    openAnalytics()
    const pri = await screen.findByRole('list', { name: 'Tasks by priority' })
    expect(within(pri).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('Urgent'),
      expect.stringContaining('High'),
      expect.stringContaining('Medium'),
      expect.stringContaining('Low'),
    ])
    expect(within(pri).getByRole('img', { name: 'High: 3 of 4 completed' })).toBeInTheDocument()
    const cat = screen.getByRole('list', { name: 'Tasks by category' })
    expect(within(cat).getByText('Uncategorised')).toBeInTheDocument()
    expect(within(cat).getByRole('img', { name: 'Work: 4 of 6 completed' })).toBeInTheDocument()
  })

  it('shows overdue statistics', async () => {
    installFakeServer({
      analytics: sampleAnalytics({
        overdueDetail: { count: 3, oldestDays: 9, byPriority: [{ priority: 'Urgent', total: 1 }, { priority: 'High', total: 0 }, { priority: 'Low', total: 2 }] },
      }),
    })
    openAnalytics()
    const card = await screen.findByRole('group', { name: 'Overdue statistics' })
    expect(card).toHaveTextContent('3 open tasks are past due')
    expect(card).toHaveTextContent('9 days late')
    const items = within(card).getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toEqual(['Urgent 1', 'Low 2']) // zero rows are not listed
  })

  it('says so when nothing is overdue', async () => {
    installFakeServer({ analytics: sampleAnalytics({ overdueDetail: { count: 0, oldestDays: 0, byPriority: [] } }) })
    openAnalytics()
    expect(await screen.findByText('Nothing is overdue.')).toBeInTheDocument()
  })

  it('asks the API for the chosen range and marks the active button', async () => {
    const api = installFakeServer({})
    const user = openAnalytics()
    await screen.findByRole('heading', { name: 'Productivity' })
    expect(api.calls).toContain('GET /api/analytics?days=30')
    expect(screen.getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: '7 days' }))
    await waitFor(() => expect(api.calls).toContain('GET /api/analytics?days=7'))
    expect(await screen.findByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: '90 days' }))
    await waitFor(() => expect(api.calls).toContain('GET /api/analytics?days=90'))
  })

  it('handles an empty dataset with a helpful message and no charts', async () => {
    installFakeServer({
      analytics: sampleAnalytics({
        total: 0, completed: 0, active: 0, overdue: 0, completedToday: 0, completedThisWeek: 0, completionRate: 0,
        averageHoursToComplete: null, byCategory: [],
        byPriority: [{ priority: 'High', total: 0, completed: 0 }],
      }),
    })
    openAnalytics()
    expect(await screen.findByText(/nothing to analyse/)).toBeInTheDocument()
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByText('Completed today')).toBeNull()
  })

  it('shows a dash instead of a number when nothing has been completed yet', async () => {
    installFakeServer({ analytics: sampleAnalytics({ averageHoursToComplete: null, completed: 0, completionRate: 0 }) })
    openAnalytics()
    await screen.findByText('Avg. time to complete')
    expect(within(kpi('Avg. time to complete')).getByText('—')).toBeInTheDocument()
    expect(within(kpi('Avg. time to complete')).getByText('No completed tasks yet')).toBeInTheDocument()
    expect(within(kpi('Completion rate')).getByText('0%')).toBeInTheDocument()
  })

  it('renders a single zero-height series without crashing (all zeros)', async () => {
    installFakeServer({
      analytics: sampleAnalytics({ daily: Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${15 + i}`, created: 0, completed: 0 })) }),
    })
    openAnalytics()
    const chart = await screen.findByRole('img', { name: /0 in total/ })
    expect(chart.querySelectorAll('rect.bar')).toHaveLength(7)
  })

  it('shows an error with a working retry', async () => {
    let fail = true
    installFakeServer({
      handlers: { 'GET /api/analytics': () => (fail ? reply({ title: 'Database is locked' }, 500) : undefined) },
    })
    const user = openAnalytics()
    expect(await screen.findByRole('alert')).toHaveTextContent('Database is locked')
    fail = false
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'Productivity' })).toBeInTheDocument()
  })

  it('explains an unreachable server', async () => {
    installFakeServer({})
    window.location.hash = '#/tasks'
    const user = openAnalytics()
    await screen.findByRole('heading', { name: 'My Tasks' })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network') }))
    await user.click(screen.getByRole('link', { name: 'Analytics' }))
    const alerts = await screen.findAllByRole('alert')
    expect(alerts.map((a) => a.textContent).join(' ')).toContain('Cannot reach the server')
  })
})
