import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import type { Category, Task } from './api'

/** Minimal in-memory stand-in for the API, speaking the same HTTP contract. */
function installFakeApi(opts: { down?: boolean; failToggle?: boolean; toggleGate?: Promise<void> } = {}) {
  let nextId = 1
  let nextCat = 1
  let tasks: Task[] = []
  let cats: Category[] = []
  const calls: string[] = []

  const reply = (body: unknown, status = 200) =>
    Promise.resolve(
      new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (opts.down) throw new TypeError('network down')
    const url = new URL(String(input), 'http://x')
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push(`${method} ${url.pathname}${url.search}`)
    const path = url.pathname

    if (path === '/api/tasks/stats') {
      const done = tasks.filter((t) => t.isCompleted).length
      return reply({ total: tasks.length, completed: done, active: tasks.length - done, overdue: 0, dueToday: 0 })
    }
    if (path === '/api/tasks/completed') {
      tasks = tasks.filter((t) => !t.isCompleted)
      return reply(null, 204)
    }
    if (path === '/api/tasks' && method === 'GET') {
      const q = url.searchParams.get('q')?.toLowerCase()
      const status = url.searchParams.get('status')
      let out = tasks
      if (q) out = out.filter((t) => t.title.toLowerCase().includes(q))
      if (status === 'completed') out = out.filter((t) => t.isCompleted)
      if (status === 'active') out = out.filter((t) => !t.isCompleted)
      return reply(out)
    }
    if (path === '/api/tasks' && method === 'POST') {
      const cat = cats.find((c) => c.id === body.categoryId)
      const t: Task = {
        id: nextId++, title: body.title, notes: body.notes ?? null, isCompleted: false,
        priority: body.priority, dueDate: body.dueDate ?? null, categoryId: body.categoryId ?? null,
        categoryName: cat?.name ?? null, categoryColor: cat?.color ?? null,
        createdAt: '', updatedAt: '', completedAt: null,
      }
      tasks = [t, ...tasks]
      return reply(t, 201)
    }
    const m = path.match(/^\/api\/tasks\/(\d+)(\/toggle)?$/)
    if (m) {
      const id = Number(m[1])
      if (m[2] && opts.toggleGate) await opts.toggleGate
      if (m[2] && opts.failToggle) return reply({ title: 'Boom' }, 500)
      if (m[2]) tasks = tasks.map((t) => (t.id === id ? { ...t, isCompleted: !t.isCompleted } : t))
      else if (method === 'PUT') tasks = tasks.map((t) => (t.id === id ? { ...t, ...body } : t))
      else if (method === 'DELETE') tasks = tasks.filter((t) => t.id !== id)
      return reply(tasks.find((t) => t.id === id) ?? null, method === 'DELETE' ? 204 : 200)
    }
    if (path === '/api/categories' && method === 'GET') {
      return reply(cats.map((c) => ({ ...c, taskCount: tasks.filter((t) => t.categoryId === c.id).length })))
    }
    if (path === '/api/categories' && method === 'POST') {
      if (cats.some((c) => c.name === body.name)) return reply({ title: 'A category with that name already exists.' }, 409)
      const c = { id: nextCat++, name: body.name, color: body.color, taskCount: 0 }
      cats.push(c)
      return reply(c, 201)
    }
    const cm = path.match(/^\/api\/categories\/(\d+)$/)
    if (cm && method === 'DELETE') {
      cats = cats.filter((c) => c.id !== Number(cm[1]))
      return reply(null, 204)
    }
    return reply({ title: 'not found' }, 404)
  })

  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock, getTasks: () => tasks }
}

async function addTask(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.type(screen.getByLabelText('Title'), title)
  await user.click(screen.getByRole('button', { name: 'Add task' }))
}

afterEach(() => vi.unstubAllGlobals())

describe('TaskFlow app', () => {
  it('shows the empty state, then lists a newly added task', async () => {
    installFakeApi()
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByText(/No tasks yet/)).toBeInTheDocument()

    await addTask(user, 'Buy milk')
    expect(await screen.findByText('Buy milk')).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveValue('') // form resets after success
  })

  it('refuses a blank title without calling the API', async () => {
    const api = installFakeApi()
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText(/No tasks yet/)
    await user.click(screen.getByRole('button', { name: 'Add task' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Title is required.')
    expect(api.calls.some((c) => c.startsWith('POST'))).toBe(false)
  })

  it('toggles a task complete and updates the counters', async () => {
    installFakeApi()
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText(/No tasks yet/)
    await addTask(user, 'Walk dog')
    await user.click(await screen.findByRole('checkbox', { name: /Mark "Walk dog" as done/ }))
    expect(await screen.findByRole('checkbox', { name: /as not done/ })).toBeChecked()
    expect(await screen.findByText('0 active · 1 done')).toBeInTheDocument()
  })

  it('edits a task title', async () => {
    installFakeApi()
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText(/No tasks yet/)
    await addTask(user, 'Old title')
    await user.click(await screen.findByRole('button', { name: 'Edit "Old title"' }))
    const row = document.querySelector<HTMLElement>('li.editing')!
    const input = within(row).getByLabelText('Title')
    await user.clear(input)
    await user.type(input, 'New title')
    await user.click(within(row).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('New title')).toBeInTheDocument()
    expect(screen.queryByText('Old title')).not.toBeInTheDocument()
  })

  it('deletes a task', async () => {
    installFakeApi()
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText(/No tasks yet/)
    await addTask(user, 'Temp')
    await user.click(await screen.findByRole('button', { name: 'Delete "Temp"' }))
    await user.click(await screen.findByRole('button', { name: 'Confirm delete "Temp"' }))
    expect(await screen.findByText(/No tasks yet/)).toBeInTheDocument()
  })

  it('sends the search term to the API and shows the filtered empty message', async () => {
    const api = installFakeApi()
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText(/No tasks yet/)
    await addTask(user, 'Alpha')
    await screen.findByText('Alpha')
    await user.type(screen.getByLabelText('Search tasks'), 'zzz')
    expect(await screen.findByText('No tasks match these filters.')).toBeInTheDocument()
    expect(api.calls.some((c) => c.includes('q=zzz'))).toBe(true)
  })

  it('switches the status view via the sidebar', async () => {
    const api = installFakeApi()
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText(/No tasks yet/)
    await user.click(screen.getByRole('button', { name: /Completed/ }))
    await waitFor(() => expect(api.calls.some((c) => c.includes('status=completed'))).toBe(true))
  })

  it('creates a category, assigns it to a task and reports duplicates', async () => {
    installFakeApi()
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText(/No tasks yet/)

    await user.type(screen.getByLabelText('New category name'), 'Work')
    await user.click(screen.getByRole('button', { name: 'Add category' }))
    const option = await screen.findByRole('option', { name: 'Work' })
    expect(option).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Category'), 'Work')
    await addTask(user, 'Report')
    const row = (await screen.findByText('Report')).closest('li')!
    expect(within(row).getByText('Work')).toBeInTheDocument()

    await user.type(screen.getByLabelText('New category name'), 'Work')
    await user.click(screen.getByRole('button', { name: 'Add category' }))
    expect(await screen.findByText('A category with that name already exists.')).toBeInTheDocument()
  })

  it('shows a clear error with retry when the API is unreachable', async () => {
    installFakeApi({ down: true })
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the server')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})

describe('TaskFlow app: behaviour and safety', () => {
  it('resets priority, due date and category after adding so the next task starts clean', async () => {
    installFakeApi()
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText(/No tasks yet/)
    await user.type(screen.getByLabelText('New category name'), 'Work')
    await user.click(screen.getByRole('button', { name: 'Add category' }))
    await screen.findByRole('option', { name: 'Work' })

    await user.selectOptions(screen.getByLabelText('Priority'), 'High')
    await user.selectOptions(screen.getByLabelText('Category'), 'Work')
    await user.type(screen.getByLabelText('Due'), '2026-12-01')
    await addTask(user, 'First')
    await screen.findByText('First')

    expect(screen.getByLabelText('Priority')).toHaveValue('Medium')
    expect(screen.getByLabelText('Category')).toHaveValue('')
    expect(screen.getByLabelText('Due')).toHaveValue('')
    expect(screen.getByLabelText('Title')).toHaveFocus()
  })

  it('submits from the notes field with Ctrl+Enter', async () => {
    installFakeApi()
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText(/No tasks yet/)
    await user.type(screen.getByLabelText('Title'), 'Via shortcut')
    await user.type(screen.getByLabelText('Notes'), 'some notes{Control>}{Enter}{/Control}')
    expect(await screen.findByText('Via shortcut')).toBeInTheDocument()
  })

  it('cancels editing with Escape and discards the changes', async () => {
    installFakeApi()
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText(/No tasks yet/)
    await addTask(user, 'Keep me')
    await user.click(await screen.findByRole('button', { name: 'Edit "Keep me"' }))
    const input = document.querySelector<HTMLElement>('li.editing')!.querySelector('input')!
    await user.type(input, ' changed{Escape}')
    expect(document.querySelector('li.editing')).toBeNull()
    expect(screen.getByText('Keep me')).toBeInTheDocument()
  })

  it('needs two clicks to delete a task and disarms when focus leaves', async () => {
    const api = installFakeApi()
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText(/No tasks yet/)
    await addTask(user, 'Precious')

    await user.click(await screen.findByRole('button', { name: 'Delete "Precious"' }))
    expect(api.calls.some((c) => c.startsWith('DELETE'))).toBe(false)
    expect(screen.getByRole('button', { name: 'Confirm delete "Precious"' })).toBeInTheDocument()

    await user.click(screen.getByLabelText('Search tasks')) // focus moves away -> disarmed
    expect(await screen.findByRole('button', { name: 'Delete "Precious"' })).toBeInTheDocument()
    expect(api.getTasks()).toHaveLength(1)
  })

  it('shows a toggle immediately (optimistic) before the server answers', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    installFakeApi({ toggleGate: gate })
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText(/No tasks yet/)
    await addTask(user, 'Fast')
    const box = await screen.findByRole('checkbox', { name: /Mark "Fast" as done/ })
    await user.click(box)
    expect(await screen.findByRole('checkbox', { name: /Mark "Fast" as not done/ })).toBeChecked()
    release()
  })

  it('rolls the checkbox back and shows the error when the server rejects a toggle', async () => {
    installFakeApi({ failToggle: true })
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText(/No tasks yet/)
    await addTask(user, 'Stubborn')
    await user.click(await screen.findByRole('checkbox', { name: /Mark "Stubborn" as done/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Boom')
    expect(screen.getByRole('checkbox', { name: /Mark "Stubborn" as done/ })).not.toBeChecked()
  })

  it('focuses search with "/" but not while typing in another field', async () => {
    installFakeApi()
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText(/No tasks yet/)
    await user.keyboard('/')
    expect(screen.getByLabelText('Search tasks')).toHaveFocus()

    await user.click(screen.getByLabelText('Title'))
    await user.keyboard('a/b')
    expect(screen.getByLabelText('Title')).toHaveValue('a/b')
  })

  it('clears the search with Escape', async () => {
    installFakeApi()
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText(/No tasks yet/)
    const search = screen.getByLabelText('Search tasks')
    await user.type(search, 'abc{Escape}')
    expect(search).toHaveValue('')
  })

  it('asks before deleting a category and does nothing if declined', async () => {
    const api = installFakeApi()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText(/No tasks yet/)
    await user.type(screen.getByLabelText('New category name'), 'Work')
    await user.click(screen.getByRole('button', { name: 'Add category' }))
    await user.click(await screen.findByRole('button', { name: 'Delete category Work' }))
    expect(confirm).toHaveBeenCalledOnce()
    expect(api.calls.some((c) => c.startsWith('DELETE /api/categories'))).toBe(false)

    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Delete category Work' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete category Work' })).toBeNull())
    confirm.mockRestore()
  })

  it('shows an inline message for a blank category name without calling the API', async () => {
    const api = installFakeApi()
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText(/No tasks yet/)
    await user.click(screen.getByRole('button', { name: 'Add category' }))
    expect(screen.getByText('Enter a category name.')).toBeInTheDocument()
    expect(api.calls.some((c) => c.startsWith('POST /api/categories'))).toBe(false)
  })

  it('gives successive new categories different default colours', async () => {
    installFakeApi()
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText(/No tasks yet/)
    const colors: string[] = []
    for (const name of ['A', 'B', 'C']) {
      colors.push((screen.getByLabelText('Category color') as HTMLInputElement).value)
      await user.type(screen.getByLabelText('New category name'), name)
      await user.click(screen.getByRole('button', { name: 'Add category' }))
      await screen.findByRole('button', { name: `Delete category ${name}` })
    }
    expect(new Set(colors).size).toBe(3)
  })

  it('does not fire a request per keystroke while typing a search (debounced)', async () => {
    const api = installFakeApi()
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText(/No tasks yet/)
    const before = api.calls.filter((c) => c.startsWith('GET /api/tasks?')).length
    await user.type(screen.getByLabelText('Search tasks'), 'hello')
    await screen.findByText('No tasks match these filters.')
    const after = api.calls.filter((c) => c.startsWith('GET /api/tasks?')).length
    expect(after - before).toBeLessThanOrEqual(2)
  })
})
