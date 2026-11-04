import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { addDays, todayString } from './dates'
import { DONE_LIMIT, KanbanPage } from './pages/KanbanPage'
import { installFakeServer, makeCategory, makeSub, makeTag, makeTask } from './testing/fakeServer'
import { renderWithProviders } from './testing/render'

const today = todayString()
const body = (fake: ReturnType<typeof installFakeServer>, key: string) =>
  JSON.parse(String(fake.bodies[key].at(-1))) as Record<string, unknown>

const tasks = () => [
  makeTask({ id: 1, title: 'Write spec', status: 'Todo', sortOrder: 0, priority: 'High', dueDate: addDays(today, -2), categoryId: 3, categoryName: 'Work', categoryColor: '#aa0000',
    tags: [{ id: 9, name: 'deep', color: '#00aa00' }], subtasks: [makeSub({ id: 50, taskId: 1, title: 's', isCompleted: true }), makeSub({ id: 51, taskId: 1, title: 't' })], subtaskTotal: 2, subtaskDone: 1, isPinned: true }),
  makeTask({ id: 2, title: 'Buy milk', status: 'Todo', sortOrder: 1, priority: 'Low' }),
  makeTask({ id: 3, title: 'Review PR', status: 'InProgress', sortOrder: 0, priority: 'Urgent' }),
  makeTask({ id: 4, title: 'Ship v1', status: 'Done', isCompleted: true, sortOrder: 0, completedAt: '2026-01-02T00:00:00Z' }),
  makeTask({ id: 5, title: 'Deploy', status: 'Done', isCompleted: true, sortOrder: 1, completedAt: '2026-01-03T00:00:00Z' }),
]

afterEach(() => vi.unstubAllGlobals())

async function open(opts: Parameters<typeof installFakeServer>[0] = {}) {
  const fake = installFakeServer({ tasks: tasks(), categories: [makeCategory({ id: 3, name: 'Work' })], tags: [makeTag({ id: 9, name: 'deep' })], ...opts })
  renderWithProviders(<KanbanPage />)
  await screen.findByText('Write spec')
  return fake
}
const col = (name: string) => screen.getByRole('region', { name: `${name} column` })
const dt = (id: number) => ({ setData: vi.fn(), getData: () => String(id), effectAllowed: '' })

describe('Kanban', () => {
  it('puts each task in the column for its status, ordered, with counts', async () => {
    await open()
    expect(within(col('To Do')).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('Write spec'), expect.stringContaining('Buy milk'),
    ])
    expect(within(col('In Progress')).getByText('Review PR')).toBeInTheDocument()
    expect(within(col('Done')).getByText('Ship v1')).toBeInTheDocument()
    expect(within(col('To Do')).getByLabelText('2 tasks')).toBeInTheDocument()
    expect(within(col('Done')).getByLabelText('2 tasks')).toBeInTheDocument()
  })

  it('cards show priority, overdue due date, category, tags, subtask progress and flags', async () => {
    await open()
    const card = within(col('To Do')).getByText('Write spec').closest('li') as HTMLElement
    expect(within(card).getByText('High')).toBeInTheDocument()
    expect(within(card).getByText(/Overdue/)).toHaveClass('overdue')
    expect(within(card).getByText('Work')).toBeInTheDocument()
    expect(within(card).getByText('#deep')).toBeInTheDocument()
    expect(within(card).getByText('1/2 subtasks')).toBeInTheDocument()
    expect(within(card).getByTitle('Pinned')).toBeInTheDocument()
  })

  it('moves a card with the Move buttons and persists via the API', async () => {
    const user = userEvent.setup()
    const fake = await open()
    await user.click(screen.getByRole('button', { name: 'Move "Buy milk" to In Progress' }))
    await waitFor(() => expect(fake.calls).toContain('PATCH /api/tasks/2/status'))
    expect(body(fake, 'PATCH /api/tasks/2/status').status).toBe('InProgress')
    await waitFor(() => expect(within(col('In Progress')).getByText('Buy milk')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Move "Buy milk" to Done' }))
    await waitFor(() => expect(within(col('Done')).getByText('Buy milk')).toBeInTheDocument())
    expect(fake.getTasks().find((t) => t.id === 2)).toMatchObject({ status: 'Done', isCompleted: true })
  })

  it('moves a card by dragging it onto another column', async () => {
    const fake = await open()
    const card = within(col('To Do')).getByText('Buy milk').closest('li') as HTMLElement
    fireEvent.dragStart(card, { dataTransfer: dt(2) })
    fireEvent.dragOver(col('In Progress'), { dataTransfer: dt(2) })
    fireEvent.drop(col('In Progress'), { dataTransfer: dt(2) })
    await waitFor(() => expect(fake.calls).toContain('PATCH /api/tasks/2/status'))
    expect(body(fake, 'PATCH /api/tasks/2/status')).toEqual({ status: 'InProgress' }) // appended: no position
  })

  it('dropping on a card inserts before it, positioned in the full column', async () => {
    const fake = await open()
    const target = within(col('Done')).getByText('Deploy').closest('li') as HTMLElement
    fireEvent.drop(target, { dataTransfer: dt(1) })
    await waitFor(() => expect(fake.calls).toContain('PATCH /api/tasks/1/status'))
    expect(body(fake, 'PATCH /api/tasks/1/status')).toEqual({ status: 'Done', position: 1 })
  })

  it('reorders inside a column', async () => {
    const fake = await open()
    const target = within(col('To Do')).getByText('Write spec').closest('li') as HTMLElement
    fireEvent.drop(target, { dataTransfer: dt(2) })
    await waitFor(() => expect(fake.calls).toContain('PATCH /api/tasks/2/status'))
    expect(body(fake, 'PATCH /api/tasks/2/status')).toEqual({ status: 'Todo', position: 0 })
    await waitFor(() => expect(within(col('To Do')).getAllByRole('listitem')[0]).toHaveTextContent('Buy milk'))
  })

  it('quick-adds a task straight into a column', async () => {
    const user = userEvent.setup()
    const fake = await open()
    await user.type(screen.getByLabelText('Add task to In Progress'), 'Fix bug{Enter}')
    await waitFor(() => expect(fake.calls).toContain('POST /api/tasks'))
    expect(body(fake, 'POST /api/tasks')).toMatchObject({ title: 'Fix bug', status: 'InProgress', priority: 'Medium' })
    await waitFor(() => expect(within(col('In Progress')).getByText('Fix bug')).toBeInTheDocument())
    expect(screen.getByLabelText('Add task to In Progress')).toHaveValue('')
  })

  it('refuses an empty quick add', async () => {
    const user = userEvent.setup()
    const fake = await open()
    await user.click(screen.getByRole('button', { name: 'Add to To Do' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a title')
    expect(fake.calls).not.toContain('POST /api/tasks')
  })

  it('filters by search, priority, category and tag', async () => {
    const user = userEvent.setup()
    await open()
    await user.type(screen.getByLabelText('Search board'), 'milk')
    expect(screen.queryByText('Write spec')).toBeNull()
    expect(screen.getByText('Buy milk')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Search board'))

    await user.selectOptions(screen.getByLabelText('Filter by priority'), 'Urgent')
    expect(screen.getByText('Review PR')).toBeInTheDocument()
    expect(screen.queryByText('Buy milk')).toBeNull()
    await user.selectOptions(screen.getByLabelText('Filter by priority'), '')

    await user.selectOptions(screen.getByLabelText('Filter by category'), 'Work')
    expect(screen.getByText('Write spec')).toBeInTheDocument()
    expect(screen.queryByText('Review PR')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))

    await user.selectOptions(screen.getByLabelText('Filter by tag'), '#deep')
    expect(screen.getByText('Write spec')).toBeInTheDocument()
    expect(screen.queryByText('Buy milk')).toBeNull()
  })

  it('limits the Done column to the latest cards until "show all"', async () => {
    const user = userEvent.setup()
    const many = Array.from({ length: DONE_LIMIT + 10 }, (_, i) =>
      makeTask({ id: 100 + i, title: `Done ${i}`, status: 'Done', isCompleted: true, sortOrder: i, completedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() }))
    installFakeServer({ tasks: many })
    renderWithProviders(<KanbanPage />)
    await screen.findByText('Done 59')
    expect(within(col('Done')).getAllByRole('listitem')).toHaveLength(DONE_LIMIT)
    expect(within(col('Done')).getByLabelText(`${DONE_LIMIT + 10} tasks`)).toBeInTheDocument()
    expect(within(col('Done')).queryByText('Done 0')).toBeNull() // the oldest are hidden
    await user.click(screen.getByRole('button', { name: /Show all/ }))
    expect(within(col('Done')).getAllByRole('listitem')).toHaveLength(DONE_LIMIT + 10)
  })

  it('opens the editor from a card title', async () => {
    const user = userEvent.setup()
    await open()
    await user.click(within(col('In Progress')).getByRole('button', { name: 'Review PR' }))
    expect(await screen.findByRole('dialog', { name: 'Edit task' })).toBeInTheDocument()
  })

  it('shows a rollback when the server refuses a move', async () => {
    const user = userEvent.setup()
    const fake = await open({ handlers: { 'PATCH /api/tasks/2/status': () => new Response(JSON.stringify({ title: 'nope' }), { status: 500, headers: { 'Content-Type': 'application/json' } }) } })
    await user.click(screen.getByRole('button', { name: 'Move "Buy milk" to Done' }))
    await waitFor(() => expect(fake.calls).toContain('PATCH /api/tasks/2/status'))
    await waitFor(() => expect(within(col('To Do')).getByText('Buy milk')).toBeInTheDocument())
    expect(within(col('Done')).queryByText('Buy milk')).toBeNull()
  })
})
