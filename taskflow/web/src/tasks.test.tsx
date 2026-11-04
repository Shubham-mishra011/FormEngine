import { screen, waitFor, within } from '@testing-library/react'
import { addDays, todayString } from './dates'
import { installFakeServer, makeCategory, makeTag, makeTask, reply } from './testing/fakeServer'
import { renderApp } from './testing/helpers'

afterEach(() => {
  vi.unstubAllGlobals()
  window.location.hash = ''
})

const list = () => screen.getByRole('list', { name: /list$/ })
const titles = () => within(list()).getAllByRole('button', { name: /^(?!Edit|Delete|Duplicate|Pin|Unpin|Favorite|Unfavorite|Show|Hide)/, hidden: false })
  .filter((b) => b.classList.contains('task-title')).map((b) => b.textContent)

describe('task lists', () => {
  it('shows an empty state, then a skeleton-free list once tasks exist', async () => {
    installFakeServer()
    renderApp('#/tasks')
    expect(await screen.findByText('No tasks yet')).toBeInTheDocument()
  })

  it('creates a task through the full editor', async () => {
    const api = installFakeServer()
    const { user } = renderApp('#/tasks')
    await screen.findByText('No tasks yet')
    await user.click(screen.getByRole('button', { name: 'New task' }))
    const dlg = await screen.findByRole('dialog', { name: 'New task' })
    await user.type(within(dlg).getByLabelText('Title'), 'Write the report')
    await user.selectOptions(within(dlg).getByLabelText('Priority'), 'Urgent')
    await user.type(within(dlg).getByLabelText('Due date'), '2026-12-24')
    await user.type(within(dlg).getByLabelText('Due time'), '14:30')
    await user.type(within(dlg).getByLabelText('Estimate in minutes'), '90')
    await user.click(within(dlg).getByRole('button', { name: 'Add task' }))

    expect(await screen.findByText('Write the report')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    const sent = JSON.parse(String(api.bodies['POST /api/tasks'][0]))
    expect(sent).toMatchObject({ title: 'Write the report', priority: 'Urgent', dueDate: '2026-12-24', dueTime: '14:30', estimatedMinutes: 90 })
  })

  it('refuses a blank title without calling the API and keeps the dialog open', async () => {
    const api = installFakeServer()
    const { user } = renderApp('#/tasks')
    await screen.findByText('No tasks yet')
    await user.click(screen.getByRole('button', { name: 'New task' }))
    const dlg = await screen.findByRole('dialog', { name: 'New task' })
    await user.click(within(dlg).getByRole('button', { name: 'Add task' }))
    expect(within(dlg).getByRole('alert')).toHaveTextContent('Title is required.')
    expect(api.calls.some((c) => c.startsWith('POST /api/tasks'))).toBe(false)
  })

  it('edits a task and keeps unrelated fields', async () => {
    const api = installFakeServer({ tasks: [makeTask({ id: 1, title: 'Old title', priority: 'High', notes: 'keep me' })] })
    const { user } = renderApp('#/tasks')
    await user.click(await screen.findByRole('button', { name: 'Edit "Old title"' }))
    const dlg = await screen.findByRole('dialog', { name: 'Edit task' })
    const title = within(dlg).getByLabelText('Title')
    await user.clear(title)
    await user.type(title, 'New title')
    await user.click(within(dlg).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('New title')).toBeInTheDocument()
    expect(screen.queryByText('Old title')).toBeNull()
    expect(JSON.parse(String(api.bodies['PUT /api/tasks/1'][0]))).toMatchObject({ title: 'New title', priority: 'High', notes: 'keep me' })
  })

  it('completes and reopens a task, instantly and persistently', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    installFakeServer({ tasks: [makeTask({ id: 1, title: 'Tick me' })], gate })
    const { user } = renderApp('#/tasks')
    const box = await screen.findByRole('checkbox', { name: /Mark "Tick me" as done/ })
    await user.click(box)
    // optimistic: flipped before the server answers
    expect(await screen.findByRole('checkbox', { name: /Mark "Tick me" as not done/ })).toBeChecked()
    release()
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /as not done/ })).toBeChecked())
  })

  it('rolls the checkbox back and shows an error when the server refuses', async () => {
    installFakeServer({
      tasks: [makeTask({ id: 1, title: 'Nope' })],
      handlers: { 'PATCH /api/tasks/1/toggle': () => reply({ title: 'Boom' }, 500) },
    })
    const { user } = renderApp('#/tasks')
    await user.click(await screen.findByRole('checkbox', { name: /Mark "Nope" as done/ }))
    expect(await screen.findByText('Boom')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Mark "Nope" as done/ })).not.toBeChecked()
  })

  it('deletes only after confirmation', async () => {
    const api = installFakeServer({ tasks: [makeTask({ id: 1, title: 'Doomed' }), makeTask({ id: 2, title: 'Safe' })] })
    const { user } = renderApp('#/tasks')
    await user.click(await screen.findByRole('button', { name: 'Delete "Doomed"' }))
    const dlg = await screen.findByRole('dialog', { name: 'Delete task?' })
    await user.click(within(dlg).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Doomed')).toBeInTheDocument()
    expect(api.calls.some((c) => c.startsWith('DELETE'))).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Delete "Doomed"' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByText('Doomed')).toBeNull())
    expect(screen.getByText('Safe')).toBeInTheDocument()
  })

  it('duplicates, pins and favorites', async () => {
    const api = installFakeServer({ tasks: [makeTask({ id: 1, title: 'Original' })] })
    const { user } = renderApp('#/tasks')
    await user.click(await screen.findByRole('button', { name: 'Duplicate "Original"' }))
    expect(await screen.findByText('Original (copy)')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pin "Original"' }))
    await user.click(screen.getByRole('button', { name: 'Favorite "Original"' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Unpin "Original"' })).toHaveAttribute('aria-pressed', 'true'))
    expect(JSON.parse(String(api.bodies['PATCH /api/tasks/1/flags'][0]))).toEqual({ isPinned: true })
    expect(await screen.findByRole('button', { name: 'Unfavorite "Original"' })).toBeInTheDocument()
  })

  it('shows priority, tags, category, due label, repeat and estimate on the card', async () => {
    const today = todayString()
    installFakeServer({
      tasks: [makeTask({
        id: 1, title: 'Rich card', priority: 'Urgent', dueDate: addDays(today, -3), dueTime: '09:00:00', estimatedMinutes: 90,
        categoryId: 1, categoryName: 'Work', categoryColor: '#aa0000', tags: [{ id: 1, name: 'deep', color: '#123456' }],
        recurrence: { id: 1, frequency: 'Weekly', interval: 1, weekdays: [1], monthDays: [], anchorDate: today, endDate: null, maxOccurrences: null, occurrencesGenerated: 1, isActive: true, nextDue: null },
      })],
    })
    renderApp('#/tasks')
    const card = (await screen.findByText('Rich card')).closest('li')!
    expect(within(card).getByText('Urgent')).toBeInTheDocument()
    expect(within(card).getByText(/3 days overdue/)).toHaveClass('overdue')
    expect(within(card).getByText('Work')).toBeInTheDocument()
    expect(within(card).getByText('#deep')).toBeInTheDocument()
    expect(within(card).getByText('Repeats')).toBeInTheDocument()
    expect(within(card).getByText('1h 30m')).toBeInTheDocument()
  })
})

describe('searching, filtering and sorting', () => {
  const many = () => [
    makeTask({ id: 1, title: 'Alpha report', priority: 'Low', createdAt: '2026-01-01T00:00:00Z', categoryId: 1, categoryName: 'Work' }),
    makeTask({ id: 2, title: 'Beta call', priority: 'Urgent', createdAt: '2026-01-02T00:00:00Z', tags: [{ id: 5, name: 'phone', color: '#000000' }], dueDate: '2026-12-01' }),
    makeTask({ id: 3, title: 'Gamma', description: 'about alpha things', priority: 'High', createdAt: '2026-01-03T00:00:00Z', isCompleted: true, status: 'Done' }),
  ]

  it('searches title, description, category and #tags, case-insensitively', async () => {
    installFakeServer({ tasks: many(), tags: [makeTag({ id: 5, name: 'phone' })] })
    const { user } = renderApp('#/tasks')
    await screen.findByText('Alpha report')
    const search = screen.getByLabelText('Search tasks')
    await user.type(search, 'ALPHA')
    expect(titles()).toEqual(expect.arrayContaining(['Alpha report', 'Gamma']))
    expect(screen.queryByText('Beta call')).toBeNull()
    await user.clear(search)
    await user.type(search, 'work')
    expect(titles()).toEqual(['Alpha report'])
    await user.clear(search)
    await user.type(search, '#phone')
    expect(titles()).toEqual(['Beta call'])
    await user.clear(search)
    await user.type(search, 'zzz')
    expect(await screen.findByText('No tasks match these filters')).toBeInTheDocument()
  })

  it('filters by priority, state, tag and category from the filter panel', async () => {
    installFakeServer({ tasks: many(), tags: [makeTag({ id: 5, name: 'phone' })], categories: [makeCategory({ id: 1, name: 'Work' })] })
    const { user } = renderApp('#/tasks')
    await screen.findByText('Alpha report')
    await user.click(screen.getByRole('button', { name: /Filters/ }))
    const panel = screen.getByRole('group', { name: 'Filters' })
    await user.click(within(panel).getByRole('button', { name: 'Urgent' }))
    expect(titles()).toEqual(['Beta call'])
    await user.click(within(panel).getByRole('button', { name: 'Urgent' }))
    await user.selectOptions(within(panel).getByLabelText('Filter by state'), 'completed')
    expect(titles()).toEqual(['Gamma'])
    await user.selectOptions(within(panel).getByLabelText('Filter by state'), 'all')
    await user.selectOptions(within(panel).getByLabelText('Filter by category'), '1')
    expect(titles()).toEqual(['Alpha report'])
    await user.click(within(panel).getByRole('button', { name: 'Clear filters' }))
    expect(titles()).toHaveLength(3)
    await user.click(within(panel).getByRole('button', { name: /#phone/ }))
    expect(titles()).toEqual(['Beta call'])
  })

  it('sorts by priority, due date, title and recency', async () => {
    installFakeServer({ tasks: many() })
    const { user } = renderApp('#/tasks')
    await screen.findByText('Alpha report')
    expect(titles()).toEqual(['Gamma', 'Beta call', 'Alpha report'])           // newest first
    await user.selectOptions(screen.getByLabelText('Sort by'), 'priority')
    expect(titles()).toEqual(['Beta call', 'Gamma', 'Alpha report'])           // Urgent, High, Low
    await user.selectOptions(screen.getByLabelText('Sort by'), 'title')
    expect(titles()).toEqual(['Alpha report', 'Beta call', 'Gamma'])
    await user.selectOptions(screen.getByLabelText('Sort by'), 'due')
    expect(titles()[0]).toBe('Beta call')                                     // only dated task first
  })

  it('floats pinned tasks to the top whatever the sort', async () => {
    installFakeServer({ tasks: [makeTask({ id: 1, title: 'Zed', isPinned: true }), makeTask({ id: 2, title: 'Abe' })] })
    const { user } = renderApp('#/tasks')
    await screen.findByText('Zed')
    await user.selectOptions(screen.getByLabelText('Sort by'), 'title')
    expect(titles()).toEqual(['Zed', 'Abe'])
  })

  it('"/" focuses the search box', async () => {
    installFakeServer({ tasks: many() })
    const { user } = renderApp('#/tasks')
    await screen.findByText('Alpha report')
    await user.keyboard('/')
    expect(screen.getByLabelText('Search tasks')).toHaveFocus()
  })
})

describe('smart views', () => {
  const today = todayString()
  const set = () => [
    makeTask({ id: 1, title: 'Overdue one', dueDate: addDays(today, -2) }),
    makeTask({ id: 2, title: 'Due today', dueDate: today }),
    makeTask({ id: 3, title: 'Next week', dueDate: addDays(today, 7) }),
    makeTask({ id: 4, title: 'Loose end' }),
    makeTask({ id: 5, title: 'Finished', isCompleted: true, status: 'Done' }),
  ]

  it('Today lists due-today and overdue tasks', async () => {
    installFakeServer({ tasks: set() })
    renderApp('#/today')
    await screen.findByText('Due today')
    expect(titles()).toEqual(['Overdue one', 'Due today'])
  })

  it('Upcoming lists only future-dated open tasks, soonest first', async () => {
    installFakeServer({ tasks: set() })
    renderApp('#/upcoming')
    await screen.findByText('Next week')
    expect(titles()).toEqual(['Next week'])
  })

  it('Inbox lists open tasks with no category or date', async () => {
    installFakeServer({ tasks: set() })
    renderApp('#/inbox')
    await screen.findByText('Loose end')
    expect(titles()).toEqual(['Loose end'])
  })

  it('Completed lists finished tasks and can clear them after confirmation', async () => {
    const api = installFakeServer({ tasks: set() })
    const { user } = renderApp('#/completed')
    await screen.findByText('Finished')
    expect(titles()).toEqual(['Finished'])
    await user.click(screen.getByRole('button', { name: 'Clear completed' }))
    const dlg = await screen.findByRole('dialog', { name: 'Clear completed tasks?' })
    await user.click(within(dlg).getByRole('button', { name: 'Cancel' }))
    expect(api.calls.some((c) => c.startsWith('DELETE /api/tasks/completed'))).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Clear completed' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete completed' }))
    await waitFor(() => expect(api.calls).toContain('DELETE /api/tasks/completed'))
    expect(await screen.findByText('Nothing completed yet')).toBeInTheDocument()
  })
})

describe('bulk selection', () => {
  const three = () => [makeTask({ id: 1, title: 'One' }), makeTask({ id: 2, title: 'Two' }), makeTask({ id: 3, title: 'Three' })]

  it('selects several tasks and applies an action to all of them', async () => {
    const api = installFakeServer({ tasks: three() })
    const { user } = renderApp('#/tasks')
    await screen.findByText('One')
    await user.click(screen.getByRole('button', { name: 'Select' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select "One"' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select "Three"' }))
    const bar = screen.getByRole('region', { name: 'Bulk actions' })
    expect(bar).toHaveTextContent('2 selected')
    await user.selectOptions(within(bar).getByLabelText('Bulk set priority'), 'High')
    await waitFor(() => expect(api.calls).toContain('POST /api/tasks/bulk'))
    expect(JSON.parse(String(api.bodies['POST /api/tasks/bulk'][0]))).toEqual({ ids: [1, 3], action: 'priority', value: 'High' })
    await waitFor(() => expect(within(list()).getAllByText('High')).toHaveLength(2))
  })

  it('select-all, then complete', async () => {
    const api = installFakeServer({ tasks: three() })
    const { user } = renderApp('#/tasks')
    await screen.findByText('One')
    await user.click(screen.getByRole('button', { name: 'Select' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select all shown' }))
    await user.click(screen.getByRole('button', { name: 'Complete' }))
    await waitFor(() => expect(api.getTasks().every((t) => t.isCompleted)).toBe(true))
  })

  it('bulk delete asks first and does nothing on cancel', async () => {
    const api = installFakeServer({ tasks: three() })
    const { user } = renderApp('#/tasks')
    await screen.findByText('One')
    await user.click(screen.getByRole('button', { name: 'Select' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select "Two"' }))
    await user.click(within(screen.getByRole('region', { name: 'Bulk actions' })).getByRole('button', { name: 'Delete' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(api.calls).not.toContain('POST /api/tasks/bulk')
    await user.click(within(screen.getByRole('region', { name: 'Bulk actions' })).getByRole('button', { name: 'Delete' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByText('Two')).toBeNull())
  })

  it('leaving select mode clears the selection', async () => {
    installFakeServer({ tasks: three() })
    const { user } = renderApp('#/tasks')
    await screen.findByText('One')
    const toggle = screen.getByRole('button', { name: 'Select' })
    await user.click(toggle)
    await user.click(screen.getByRole('checkbox', { name: 'Select "One"' }))
    await user.click(toggle)
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull()
    await user.click(toggle)
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toHaveTextContent('0 selected')
  })
})

describe('task editor extras', () => {
  it('assigns tags, creating one on the fly, and sends them', async () => {
    const api = installFakeServer({ tags: [makeTag({ id: 1, name: 'home' })] })
    const { user } = renderApp('#/tasks')
    await screen.findByText('No tasks yet')
    await user.click(screen.getByRole('button', { name: 'New task' }))
    const dlg = await screen.findByRole('dialog', { name: 'New task' })
    await user.type(within(dlg).getByLabelText('Title'), 'Tagged')
    await user.click(within(dlg).getByRole('button', { name: '#home' }))
    await user.type(within(dlg).getByLabelText('New tag name'), 'urgent-fix')
    await user.click(within(dlg).getByRole('button', { name: 'Add tag' }))
    expect(await within(dlg).findByRole('button', { name: '#urgent-fix' })).toBeInTheDocument()
    await user.click(within(dlg).getByRole('button', { name: '#urgent-fix' }))
    await user.click(within(dlg).getByRole('button', { name: 'Add task' }))
    await waitFor(() => expect(api.bodies['POST /api/tasks']).toBeDefined())
    expect(JSON.parse(String(api.bodies['POST /api/tasks'][0])).tagIds).toHaveLength(2)
  })

  it('configures reminders and a weekly repeat and sends them', async () => {
    const api = installFakeServer()
    const { user } = renderApp('#/tasks')
    await screen.findByText('No tasks yet')
    await user.click(screen.getByRole('button', { name: 'New task' }))
    const dlg = await screen.findByRole('dialog', { name: 'New task' })
    await user.type(within(dlg).getByLabelText('Title'), 'Recurring')
    expect(within(dlg).getByRole('button', { name: '30 min before' })).toBeDisabled() // needs a due date
    await user.type(within(dlg).getByLabelText('Due date'), '2026-12-07')
    await user.click(within(dlg).getByRole('button', { name: '30 min before' }))
    await user.click(within(dlg).getByRole('checkbox', { name: 'Repeat this task' }))
    await user.selectOptions(within(dlg).getByLabelText('Repeat frequency'), 'Weekly')
    await user.click(within(dlg).getByRole('button', { name: 'Mon' }))
    await user.click(within(dlg).getByRole('button', { name: 'Wed' }))
    expect(within(dlg).getByText('Every week on Mon, Wed')).toBeInTheDocument()
    await user.click(within(dlg).getByRole('button', { name: 'Add task' }))
    await waitFor(() => expect(api.bodies['POST /api/tasks']).toBeDefined())
    const sent = JSON.parse(String(api.bodies['POST /api/tasks'][0]))
    expect(sent.reminders).toEqual([{ minutesBefore: 30 }])
    expect(sent.recurrence).toMatchObject({ frequency: 'Weekly', interval: 1, weekdays: [1, 3] })
  })

  it('shows the existing repeat when editing and can stop it after confirmation', async () => {
    const today = todayString()
    const api = installFakeServer({
      tasks: [makeTask({
        id: 1, title: 'Water plants', dueDate: today,
        recurrence: { id: 9, frequency: 'Daily', interval: 2, weekdays: [], monthDays: [], anchorDate: today, endDate: null, maxOccurrences: null, occurrencesGenerated: 1, isActive: true, nextDue: addDays(today, 2) },
      })],
    })
    const { user } = renderApp('#/tasks')
    await user.click(await screen.findByRole('button', { name: 'Edit "Water plants"' }))
    const dlg = await screen.findByRole('dialog', { name: 'Edit task' })
    expect(within(dlg).getByRole('checkbox', { name: 'Repeat this task' })).toBeChecked()
    expect(within(dlg).getByLabelText('Repeat interval')).toHaveValue(2)
    await user.click(within(dlg).getByRole('button', { name: 'Stop repeating' }))
    const confirm = await screen.findByRole('dialog', { name: 'Stop repeating?' })
    await user.click(within(confirm).getByRole('button', { name: 'Stop repeating' }))
    await waitFor(() => expect(api.calls).toContain('POST /api/tasks/1/recurrence/stop'))
  })

  it('saving an edit does not drop an existing repeat (it is sent back unchanged)', async () => {
    const today = todayString()
    const api = installFakeServer({
      tasks: [makeTask({
        id: 1, title: 'Keep repeating', dueDate: today,
        recurrence: { id: 9, frequency: 'Weekly', interval: 1, weekdays: [3], monthDays: [], anchorDate: today, endDate: null, maxOccurrences: null, occurrencesGenerated: 1, isActive: true, nextDue: null },
      })],
    })
    const { user } = renderApp('#/tasks')
    await user.click(await screen.findByRole('button', { name: 'Edit "Keep repeating"' }))
    const dlg = await screen.findByRole('dialog', { name: 'Edit task' })
    await user.click(within(dlg).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.bodies['PUT /api/tasks/1']).toBeDefined())
    expect(JSON.parse(String(api.bodies['PUT /api/tasks/1'][0])).recurrence).toMatchObject({ frequency: 'Weekly', weekdays: [3] })
  })

  it('shows the history tab and an attachments tab for an existing task', async () => {
    installFakeServer({ tasks: [makeTask({ id: 1, title: 'Has history' })] })
    const { user } = renderApp('#/tasks')
    await user.click(await screen.findByRole('button', { name: 'Edit "Has history"' }))
    const dlg = await screen.findByRole('dialog', { name: 'Edit task' })
    await user.click(within(dlg).getByRole('tab', { name: 'History' }))
    expect(await within(dlg).findByText('No activity yet.')).toBeInTheDocument()
    await user.click(within(dlg).getByRole('tab', { name: /Files/ }))
    expect(await within(dlg).findByText('No attachments.')).toBeInTheDocument()
    expect(within(dlg).getByLabelText('Attach a file')).toBeInTheDocument()
  })

  it('closes with Escape without saving', async () => {
    const api = installFakeServer({ tasks: [makeTask({ id: 1, title: 'Untouched' })] })
    const { user } = renderApp('#/tasks')
    await user.click(await screen.findByRole('button', { name: 'Edit "Untouched"' }))
    await screen.findByRole('dialog', { name: 'Edit task' })
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.calls.some((c) => c.startsWith('PUT'))).toBe(false)
  })
})

describe('categories and tags pages', () => {
  it('adds, renames and deletes a category with confirmation (tasks are kept)', async () => {
    const api = installFakeServer({
      categories: [makeCategory({ id: 1, name: 'Work', taskCount: 1 })],
      tasks: [makeTask({ id: 1, title: 'Keep me', categoryId: 1, categoryName: 'Work', categoryColor: '#6366f1' })],
    })
    const { user } = renderApp('#/categories')
    await screen.findByText('Work')
    await user.type(screen.getByLabelText('New category name'), 'Home')
    await user.click(screen.getByRole('button', { name: 'Add category' }))
    expect(await screen.findByText('Home')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit category Home' }))
    const name = screen.getByLabelText('Category name')
    await user.clear(name)
    await user.type(name, 'Household')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Household')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete category Work' }))
    const dlg = await screen.findByRole('dialog', { name: 'Delete category?' })
    expect(dlg).toHaveTextContent('will be kept without a category')
    await user.click(within(dlg).getByRole('button', { name: 'Delete category' }))
    await waitFor(() => expect(screen.queryByText('Work')).toBeNull())
    expect(api.getTasks()).toHaveLength(1)
  })

  it('rejects duplicate and blank names with a clear message', async () => {
    installFakeServer({ tags: [makeTag({ id: 1, name: 'home' })] })
    const { user } = renderApp('#/tags')
    await screen.findByText('#home')
    await user.click(screen.getByRole('button', { name: 'Add tag' }))
    expect(await screen.findByText('Enter a tag name.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('New tag name'), 'HOME')
    await user.click(screen.getByRole('button', { name: 'Add tag' }))
    expect(await screen.findByText('A tag with that name already exists.')).toBeInTheDocument()
  })

  it('deleting a tag keeps the tasks that used it', async () => {
    const api = installFakeServer({
      tags: [makeTag({ id: 1, name: 'temp', taskCount: 1 })],
      tasks: [makeTask({ id: 1, title: 'Still here', tags: [{ id: 1, name: 'temp', color: '#8b5cf6' }] })],
    })
    const { user } = renderApp('#/tags')
    await user.click(await screen.findByRole('button', { name: 'Delete tag temp' }))
    const dlg = await screen.findByRole('dialog', { name: 'Delete tag?' })
    expect(dlg).toHaveTextContent('will be kept without this tag')
    await user.click(within(dlg).getByRole('button', { name: 'Delete tag' }))
    await waitFor(() => expect(screen.queryByText('#temp')).toBeNull())
    expect(api.getTasks()).toHaveLength(1)
    expect(api.getTasks()[0].tags).toEqual([])
  })
})
