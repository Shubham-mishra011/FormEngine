import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { installFakeServer, makeSub, makeTask, reply } from './testing/fakeServer'

const parent = (subs = [makeSub({ id: 1, taskId: 1, title: 'Draft' }), makeSub({ id: 2, taskId: 1, title: 'Review', isCompleted: true })]) =>
  makeTask({ id: 1, title: 'Write report', subtasks: subs, subtaskTotal: subs.length, subtaskDone: subs.filter((s) => s.isCompleted).length })

beforeEach(() => {
  window.localStorage.clear()
  window.location.hash = '#/tasks'
})
afterEach(() => vi.unstubAllGlobals())

async function open(title = 'Write report') {
  const user = userEvent.setup()
  render(<App />)
  await screen.findByText(title)
  await user.click(screen.getByRole('button', { name: new RegExp(`subtasks of "${title}"`) }))
  return { user, group: screen.getByRole('group', { name: `Subtasks of ${title}` }) }
}

describe('subtasks UI', () => {
  it('shows progress while collapsed, then the list when expanded', async () => {
    installFakeServer({ tasks: [parent()] })
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('Write report')

    const toggle = screen.getByRole('button', { name: /subtasks of "Write report"/ })
    expect(toggle).toHaveTextContent('1/2 subtasks')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('group', { name: /Subtasks of/ })).toBeNull()
    const bar = screen.getByRole('progressbar', { name: /Subtask progress/ })
    expect(bar).toHaveAttribute('aria-valuenow', '50')

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const group = screen.getByRole('group', { name: 'Subtasks of Write report' })
    expect(within(group).getByText('Draft')).toBeInTheDocument()
    expect(within(group).getByRole('checkbox', { name: /"Review" as not done/ })).toBeChecked()
  })

  it('a task without subtasks offers "Add subtasks" and has no progress bar', async () => {
    installFakeServer({ tasks: [makeTask({ id: 1, title: 'Plain' })] })
    render(<App />)
    await screen.findByText('Plain')
    expect(screen.getByRole('button', { name: /subtasks of "Plain"/ })).toHaveTextContent('Add subtasks')
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('adds a subtask, clears the field and updates the progress', async () => {
    const api = installFakeServer({ tasks: [makeTask({ id: 1, title: 'Plain' })] })
    const { user, group } = await open('Plain')
    await user.type(within(group).getByLabelText('New subtask for Plain'), '  First step  ')
    await user.click(within(group).getByRole('button', { name: 'Add' }))

    expect(await screen.findByText('First step')).toBeInTheDocument()
    expect(screen.getByLabelText('New subtask for Plain')).toHaveValue('')
    expect(api.bodies['POST /api/tasks/1/subtasks']).toEqual([JSON.stringify({ title: 'First step' })])
    expect(await screen.findByRole('button', { name: /subtasks of "Plain"/ })).toHaveTextContent('0/1 subtasks')
  })

  it('submits with Enter', async () => {
    installFakeServer({ tasks: [makeTask({ id: 1, title: 'Plain' })] })
    const { user, group } = await open('Plain')
    await user.type(within(group).getByLabelText('New subtask for Plain'), 'via enter{Enter}')
    expect(await screen.findByText('via enter')).toBeInTheDocument()
  })

  it('refuses a blank subtask without calling the API', async () => {
    const api = installFakeServer({ tasks: [makeTask({ id: 1, title: 'Plain' })] })
    const { user, group } = await open('Plain')
    await user.type(within(group).getByLabelText('New subtask for Plain'), '   ')
    await user.click(within(group).getByRole('button', { name: 'Add' }))
    expect(within(group).getByRole('alert')).toHaveTextContent('Enter a subtask.')
    expect(api.calls.some((c) => c.startsWith('POST /api/tasks/1/subtasks'))).toBe(false)
  })

  it('shows the server error inline and keeps what was typed', async () => {
    installFakeServer({
      tasks: [makeTask({ id: 1, title: 'Plain' })],
      handlers: { 'POST /api/tasks/1/subtasks': () => reply({ errors: { TaskId: ['A task can have at most 100 subtasks.'] } }, 400) },
    })
    const { user, group } = await open('Plain')
    await user.type(within(group).getByLabelText('New subtask for Plain'), 'one too many')
    await user.click(within(group).getByRole('button', { name: 'Add' }))
    expect(await within(group).findByRole('alert')).toHaveTextContent('at most 100 subtasks')
    expect(within(group).getByLabelText('New subtask for Plain')).toHaveValue('one too many')
    // inline only: the page-level banner stays quiet
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('completes and reopens a subtask and keeps progress in step', async () => {
    installFakeServer({ tasks: [parent()] })
    const { user, group } = await open()
    await user.click(within(group).getByRole('checkbox', { name: /"Draft" as done/ }))
    expect(await screen.findByRole('button', { name: /subtasks of "Write report"/ })).toHaveTextContent('2/2 subtasks')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')

    await user.click(within(group).getByRole('checkbox', { name: /"Draft" as not done/ }))
    expect(await screen.findByRole('button', { name: /subtasks of "Write report"/ })).toHaveTextContent('1/2 subtasks')
  })

  it('updates the checkbox and progress immediately, before the server answers', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    installFakeServer({ tasks: [parent()], gate })
    const { user, group } = await open()
    await user.click(within(group).getByRole('checkbox', { name: /"Draft" as done/ }))
    expect(within(group).getByRole('checkbox', { name: /"Draft" as not done/ })).toBeChecked()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
    release()
  })

  it('is not reverted by an older refresh that finishes after an optimistic toggle (race)', async () => {
    const stale = [parent([makeSub({ id: 1, taskId: 1, title: 'Draft' })])]
    let releaseList!: () => void
    const listGate = new Promise<void>((r) => (releaseList = r))
    let releaseToggle!: () => void
    const toggleGate = new Promise<void>((r) => (releaseToggle = r))
    let listCalls = 0
    installFakeServer({
      tasks: stale,
      gate: toggleGate,
      handlers: {
        // 2nd list request = the reload triggered by the pin. It captures the OLD data now
        // and answers late, i.e. after the user has already ticked the subtask.
        'GET /api/tasks': () => {
          listCalls++
          if (listCalls !== 2) return undefined
          const snapshot = JSON.stringify(stale)
          return listGate.then(() => new Response(snapshot, { status: 200, headers: { 'Content-Type': 'application/json' } }))
        },
      },
    })
    const { user, group } = await open()
    await user.click(screen.getByRole('button', { name: 'Pin "Write report"' })) // any mutation starts a reload; this one is the slow one
    await user.click(within(group).getByRole('checkbox', { name: /"Draft" as done/ }))   // optimistic tick
    expect(within(group).getByRole('checkbox', { name: /"Draft" as not done/ })).toBeChecked()

    releaseList() // the stale refresh lands now
    await new Promise((r) => setTimeout(r, 50))
    expect(within(screen.getByRole('group', { name: /Subtasks of/ })).getByRole('checkbox', { name: /"Draft" as not done/ })).toBeChecked()

    releaseToggle() // and the server finally confirms the toggle
    await waitFor(() => expect(screen.getByRole('button', { name: /subtasks of "Write report"/ })).toHaveTextContent('1/1 subtasks'))
  })

  it('rolls a rejected toggle back and reports the error', async () => {
    installFakeServer({
      tasks: [parent()],
      handlers: { 'PATCH /api/subtasks/1/toggle': () => reply({ title: 'Boom' }, 500) },
    })
    const { user, group } = await open()
    await user.click(within(group).getByRole('checkbox', { name: /"Draft" as done/ }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Boom'))
    expect(within(group).getByRole('checkbox', { name: /"Draft" as done/ })).not.toBeChecked()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')
  })

  it('edits a subtask title with Enter', async () => {
    const api = installFakeServer({ tasks: [parent()] })
    const { user, group } = await open()
    await user.click(within(group).getByRole('button', { name: 'Edit subtask "Draft"' }))
    const input = within(group).getByRole('textbox', { name: 'Edit subtask "Draft"' })
    await user.clear(input)
    await user.type(input, 'Rough draft{Enter}')
    expect(await within(group).findByText('Rough draft')).toBeInTheDocument()
    expect(api.bodies['PUT /api/subtasks/1']).toEqual([JSON.stringify({ title: 'Rough draft', isCompleted: false })])
  })

  it('cancels a subtask edit with Escape, sends nothing, and does not close the page', async () => {
    const api = installFakeServer({ tasks: [parent()] })
    const { user, group } = await open()
    await user.click(within(group).getByRole('button', { name: 'Edit subtask "Draft"' }))
    await user.type(within(group).getByRole('textbox', { name: 'Edit subtask "Draft"' }), ' changed{Escape}')
    expect(within(group).getByText('Draft')).toBeInTheDocument()
    expect(api.calls.some((c) => c.startsWith('PUT /api/subtasks'))).toBe(false)
  })

  it('rejects clearing a subtask title', async () => {
    const api = installFakeServer({ tasks: [parent()] })
    const { user, group } = await open()
    await user.click(within(group).getByRole('button', { name: 'Edit subtask "Draft"' }))
    const input = within(group).getByRole('textbox', { name: 'Edit subtask "Draft"' })
    await user.clear(input)
    await user.keyboard('{Enter}')
    expect(within(group).getByRole('alert')).toHaveTextContent('needs a title')
    expect(api.calls.some((c) => c.startsWith('PUT /api/subtasks'))).toBe(false)
  })

  it('keeps a completed subtask completed when its title is edited', async () => {
    const api = installFakeServer({ tasks: [parent()] })
    const { user, group } = await open()
    await user.click(within(group).getByRole('button', { name: 'Edit subtask "Review"' }))
    const input = within(group).getByRole('textbox', { name: 'Edit subtask "Review"' })
    await user.type(input, ' again{Enter}')
    await within(group).findByText('Review again')
    expect(api.bodies['PUT /api/subtasks/2']).toEqual([JSON.stringify({ title: 'Review again', isCompleted: true })])
  })

  it('deletes a subtask', async () => {
    installFakeServer({ tasks: [parent()] })
    const { user, group } = await open()
    await user.click(within(group).getByRole('button', { name: 'Delete subtask "Draft"' }))
    await waitFor(() => expect(within(group).queryByText('Draft')).toBeNull())
    expect(await screen.findByRole('button', { name: /subtasks of "Write report"/ })).toHaveTextContent('1/1 subtasks')
  })

  it('keeps subtask lists separate per task', async () => {
    installFakeServer({
      tasks: [
        makeTask({ id: 1, title: 'A', subtasks: [makeSub({ id: 1, taskId: 1, title: 'a-sub' })], subtaskTotal: 1 }),
        makeTask({ id: 2, title: 'B', subtasks: [makeSub({ id: 2, taskId: 2, title: 'b-sub' })], subtaskTotal: 1 }),
      ],
    })
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('A')
    await user.click(screen.getByRole('button', { name: /subtasks of "A"/ }))
    expect(screen.getByText('a-sub')).toBeInTheDocument()
    expect(screen.queryByText('b-sub')).toBeNull()
  })

  it('subtasks never offer to nest further', async () => {
    installFakeServer({ tasks: [parent()] })
    const { group } = await open()
    // one "add" form for the whole checklist; none inside individual subtasks
    expect(within(group).getAllByRole('textbox', { name: /New subtask/ })).toHaveLength(1)
    expect(within(group).queryByRole('button', { name: /Show subtasks of "Draft"/ })).toBeNull()
  })
})
