import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addDays, addMonths, formatMonthTitle, todayString } from './dates'
import { CalendarPage } from './pages/CalendarPage'
import { installFakeServer, makeCategory, makeTask } from './testing/fakeServer'
import { renderWithProviders } from './testing/render'

const today = todayString()
const lastBody = (fake: ReturnType<typeof installFakeServer>, key: string) =>
  JSON.parse(String(fake.bodies[key].at(-1))) as Record<string, unknown>

const tasks = () => [
  makeTask({ id: 1, title: 'Pay rent', dueDate: today, dueTime: '09:30:00', priority: 'High', categoryId: 7, categoryName: 'Home' }),
  makeTask({ id: 2, title: 'Old report', dueDate: addDays(today, -3), priority: 'Urgent' }),
  makeTask({ id: 3, title: 'Soon thing', dueDate: addDays(today, 2) }),
  makeTask({ id: 4, title: 'Someday', dueDate: null }),
  makeTask({ id: 5, title: 'Finished', dueDate: today, isCompleted: true, status: 'Done' }),
]
const cats = [makeCategory({ id: 7, name: 'Home' })]

const cellOf = (iso: string) => document.querySelector(`[data-date="${iso}"]`) as HTMLElement

beforeEach(() => { window.location.hash = '' })
afterEach(() => vi.unstubAllGlobals())

async function open(opts: Parameters<typeof installFakeServer>[0] = {}) {
  const fake = installFakeServer({ tasks: tasks(), categories: cats, ...opts })
  renderWithProviders(<CalendarPage />)
  await within(await screen.findByRole('group', { name: /Month of/ })).findByRole('button', { name: /Pay rent/ })
  return fake
}

describe('Calendar', () => {
  it('shows tasks on their due date in the month grid, with time and completed state', async () => {
    await open()
    const cell = cellOf(today)
    expect(within(cell).getByRole('button', { name: /Pay rent/ })).toHaveTextContent(/9:30|09:30/)
    expect(within(cell).getByRole('button', { name: /Finished/ })).toHaveClass('done')
    expect(within(cellOf(addDays(today, 2))).getByRole('button', { name: /Soon thing/ })).toBeInTheDocument()
    expect(within(cell).queryByRole('button', { name: /Someday/ })).toBeNull()
  })

  it('navigates months, weeks and days, and Today returns', async () => {
    const user = userEvent.setup()
    await open()
    const title = screen.getByTestId('cal-title')
    expect(title).toHaveTextContent(formatMonthTitle(today))
    await user.click(screen.getByRole('button', { name: 'Next month' }))
    expect(title).toHaveTextContent(formatMonthTitle(addMonths(today, 1)))
    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(title).toHaveTextContent(formatMonthTitle(addMonths(today, -1)))
    await user.click(screen.getByRole('button', { name: 'Today' }))
    expect(title).toHaveTextContent(formatMonthTitle(today))

    await user.click(screen.getByRole('button', { name: 'Week' }))
    expect(screen.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(screen.getByRole('group', { name: 'Week' })).getByRole('button', { name: /Pay rent/ })).toBeInTheDocument()
    const weekTitle = title.textContent
    await user.click(screen.getByRole('button', { name: 'Next week' }))
    expect(title.textContent).not.toBe(weekTitle)

    await user.click(screen.getByRole('button', { name: 'Day' }))
    await user.click(screen.getByRole('button', { name: 'Today' }))
    expect(screen.getByRole('region', { name: `Tasks on ${today}` })).toHaveTextContent('Pay rent')
    await user.click(screen.getByRole('button', { name: 'Next day' }))
    expect(screen.getByRole('region', { name: `Tasks on ${addDays(today, 1)}` })).toHaveTextContent('Nothing due on this day')
  })

  it('opens the editor with the day pre-filled when adding from a day', async () => {
    const user = userEvent.setup()
    await open()
    const target = addDays(today, 2)
    await user.click(screen.getByRole('button', { name: `Add task on ${target}` }))
    const dialog = await screen.findByRole('dialog', { name: 'New task' })
    expect(within(dialog).getByLabelText('Due date')).toHaveValue(target)
  })

  it('opens an existing task for editing when its chip is clicked', async () => {
    const user = userEvent.setup()
    await open()
    await user.click(within(cellOf(today)).getByRole('button', { name: /Pay rent/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit task' })
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Pay rent')
  })

  it('reschedules with the keyboard-accessible date control', async () => {
    const fake = await open()
    const target = addDays(today, 4)
    fireEvent.change(screen.getByLabelText('Move "Pay rent"'), { target: { value: target } })
    await waitFor(() => expect(fake.calls).toContain('PATCH /api/tasks/1/reschedule'))
    expect(lastBody(fake, 'PATCH /api/tasks/1/reschedule').dueDate).toBe(target)
    await waitFor(() => expect(within(cellOf(target)).getByRole('button', { name: /Pay rent/ })).toBeInTheDocument())
  })

  it('reschedules by dragging a task onto another day', async () => {
    const fake = await open()
    const target = addDays(today, 1)
    const chip = within(cellOf(today)).getByRole('button', { name: /Pay rent/ })
    const dataTransfer = { setData: vi.fn(), getData: () => '1', effectAllowed: '' }
    fireEvent.dragStart(chip, { dataTransfer })
    fireEvent.dragOver(cellOf(target), { dataTransfer })
    fireEvent.drop(cellOf(target), { dataTransfer })
    await waitFor(() => expect(fake.calls).toContain('PATCH /api/tasks/1/reschedule'))
    expect(lastBody(fake, 'PATCH /api/tasks/1/reschedule').dueDate).toBe(target)
  })

  it('lists overdue and upcoming tasks, and unscheduled ones separately', async () => {
    const user = userEvent.setup()
    await open()
    const overdue = screen.getByRole('list', { name: 'Overdue tasks' })
    expect(within(overdue).getByText('Old report')).toBeInTheDocument()
    expect(within(overdue).queryByText('Pay rent')).toBeNull()
    const upcoming = screen.getByRole('list', { name: 'Upcoming tasks' })
    expect(within(upcoming).getByText('Pay rent')).toBeInTheDocument()
    expect(within(upcoming).getByText('Soon thing')).toBeInTheDocument()
    expect(within(upcoming).queryByText('Finished')).toBeNull() // completed work is not upcoming
    await user.click(screen.getByText(/Unscheduled \(1\)/))
    expect(within(screen.getByRole('list', { name: 'Unscheduled tasks' })).getByText('Someday')).toBeInTheDocument()
  })

  it('schedules an unscheduled task', async () => {
    const user = userEvent.setup()
    const fake = await open()
    await user.click(screen.getByText(/Unscheduled/))
    fireEvent.change(screen.getByLabelText('Schedule "Someday"'), { target: { value: addDays(today, 1) } })
    await waitFor(() => expect(fake.calls).toContain('PATCH /api/tasks/4/reschedule'))
  })

  it('filters by category, priority and status', async () => {
    const user = userEvent.setup()
    await open()
    const cell = cellOf(today)
    await user.selectOptions(screen.getByLabelText('Filter by category'), 'Home')
    expect(within(cell).getByRole('button', { name: /Pay rent/ })).toBeInTheDocument()
    expect(within(cell).queryByRole('button', { name: /Finished/ })).toBeNull()
    await user.selectOptions(screen.getByLabelText('Filter by category'), '')

    await user.selectOptions(screen.getByLabelText('Filter by priority'), 'Urgent')
    expect(within(cell).queryByRole('button', { name: /Pay rent/ })).toBeNull()
    expect(within(cellOf(addDays(today, -3))).getByRole('button', { name: /Old report/ })).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Filter by priority'), '')

    await user.selectOptions(screen.getByLabelText('Filter by status'), 'completed')
    expect(within(cell).getByRole('button', { name: /Finished/ })).toBeInTheDocument()
    expect(within(cell).queryByRole('button', { name: /Pay rent/ })).toBeNull()
    await user.selectOptions(screen.getByLabelText('Filter by status'), 'open')
    expect(within(cell).queryByRole('button', { name: /Finished/ })).toBeNull()
  })

  it('selecting a day shows its tasks below the grid', async () => {
    const user = userEvent.setup()
    await open()
    const day = addDays(today, 2)
    await user.click(screen.getByRole('button', { name: `Show ${day}` }))
    expect(screen.getByRole('region', { name: `Tasks on ${day}` })).toHaveTextContent('Soon thing')
  })

  it('respects the week-start setting', async () => {
    const fake = installFakeServer({ tasks: tasks() })
    renderWithProviders(<CalendarPage />, { weekStart: 0 })
    await screen.findByRole('group', { name: /Month of/ })
    const firstCell = document.querySelector('.cal-grid .cal-cell') as HTMLElement
    expect(new Date(`${firstCell.dataset.date}T00:00:00Z`).getUTCDay()).toBe(0)
    expect(fake.calls).toContain('GET /api/tasks')
  })
})
