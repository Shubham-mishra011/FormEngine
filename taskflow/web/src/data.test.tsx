import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import type { BackupInfo, ImportSummary } from './api'
import { emptySummary, installFakeServer, makeTask } from './testing/fakeServer'

const taskListCalls = (calls: string[]) => calls.filter((c) => c === 'GET /api/tasks').length

beforeEach(() => {
  window.localStorage.clear()
  window.location.hash = '#/data' // the old address of the backup page; it now opens Settings -> Backup & data
})
afterEach(() => {
  vi.unstubAllGlobals()
  window.location.hash = ''
})

const backup = (name: string): BackupInfo => ({ name, sizeBytes: 53248, createdAt: '2026-10-20T08:30:00Z' })

const file = (text = '{"schema":"taskflow-export"}', name = 'export.json') => new File([text], name, { type: 'application/json' })

async function openPage() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('heading', { name: 'Backup & data' })
  return user
}

const pick = (user: ReturnType<typeof userEvent.setup>, f: File) =>
  user.upload(screen.getByLabelText('Choose a TaskFlow JSON file to import'), f)

describe('export', () => {
  it('offers JSON and CSV downloads', async () => {
    installFakeServer({})
    await openPage()
    const json = screen.getByRole('link', { name: 'Download everything (JSON)' })
    const csv = screen.getByRole('link', { name: 'Download tasks (CSV)' })
    expect(json).toHaveAttribute('href', '/api/export')
    expect(json).toHaveAttribute('download')
    expect(csv).toHaveAttribute('href', '/api/export/tasks.csv')
    expect(csv).toHaveAttribute('download')
  })
})

describe('import preview', () => {
  it('shows what would be added and skipped, and writes nothing until confirmed', async () => {
    const api = installFakeServer({
      importSummary: () =>
        emptySummary({ categories: { add: 1, skip: 0 }, tasks: { add: 3, skip: 2 }, subtasks: { add: 4, skip: 1 } }),
    })
    const user = await openPage()
    await pick(user, file('{"a":1}', 'my-tasks.json'))

    expect(await screen.findByRole('heading', { name: /Import preview — my-tasks.json/ })).toBeInTheDocument()
    const rows = screen.getAllByRole('row').map((r) => r.textContent)
    expect(rows).toContain('Categories10')
    expect(rows).toContain('Tasks32')
    expect(rows).toContain('Subtasks41')
    expect(screen.getByRole('button', { name: 'Import 3 tasks' })).toBeEnabled()
    expect(api.calls).toContain('POST /api/import/preview')
    expect(api.calls).not.toContain('POST /api/import')
    expect(api.bodies['POST /api/import/preview']).toEqual(['{"a":1}'])
  })

  it('uses the singular for one task', async () => {
    installFakeServer({ importSummary: () => emptySummary({ tasks: { add: 1, skip: 0 } }) })
    const user = await openPage()
    await pick(user, file())
    expect(await screen.findByRole('button', { name: 'Import 1 task' })).toBeInTheDocument()
  })

  it('disables the import button when everything is a duplicate', async () => {
    installFakeServer({ importSummary: () => emptySummary({ tasks: { add: 0, skip: 5 } }) })
    const user = await openPage()
    await pick(user, file())
    expect(await screen.findByRole('button', { name: 'Nothing new to import' })).toBeDisabled()
  })

  it('lists every problem for an invalid file and offers no way to import it', async () => {
    const bad: ImportSummary = emptySummary({
      valid: false,
      errors: ['tasks[2].title is required.', 'tasks[5].dueDate must be a real date like 2026-12-31.'],
    })
    const api = installFakeServer({ importSummary: () => bad })
    const user = await openPage()
    await pick(user, file('garbage'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Nothing was changed')
    expect(within(alert).getByText('tasks[2].title is required.')).toBeInTheDocument()
    expect(within(alert).getByText(/tasks\[5\].dueDate/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Import/ })).toBeNull()
    expect(api.calls).not.toContain('POST /api/import')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows warnings in a collapsible list', async () => {
    installFakeServer({ importSummary: () => emptySummary({ tasks: { add: 1, skip: 0 }, warnings: ['tasks[0]: completedAt ignored'] }) })
    const user = await openPage()
    await pick(user, file())
    await user.click(await screen.findByText('1 note(s)'))
    expect(screen.getByText('tasks[0]: completedAt ignored')).toBeVisible()
  })

  it('cancel discards the preview without importing', async () => {
    const api = installFakeServer({ importSummary: () => emptySummary({ tasks: { add: 1, skip: 0 } }) })
    const user = await openPage()
    await pick(user, file())
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('heading', { name: /Import preview/ })).toBeNull()
    expect(api.calls).not.toContain('POST /api/import')
  })

  it('rejects an oversized file in the browser without uploading it', async () => {
    const api = installFakeServer({})
    const user = await openPage()
    const huge = file()
    Object.defineProperty(huge, 'size', { value: 21_000_000 })
    await pick(user, huge)
    expect(await screen.findByRole('alert')).toHaveTextContent('larger than 20 MB')
    expect(api.calls).not.toContain('POST /api/import/preview')
  })

  it('can pick the same file again after cancelling', async () => {
    const api = installFakeServer({ importSummary: () => emptySummary({ tasks: { add: 1, skip: 0 } }) })
    const user = await openPage()
    const f = file()
    await pick(user, f)
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    await pick(user, f)
    await screen.findByRole('button', { name: 'Import 1 task' })
    expect(api.calls.filter((c) => c === 'POST /api/import/preview')).toHaveLength(2)
  })
})

describe('confirming an import', () => {
  it('sends the same file, reports the result and the safety backup, and refreshes the task list', async () => {
    const api = installFakeServer({
      importSummary: () => emptySummary({ categories: { add: 1, skip: 0 }, tasks: { add: 2, skip: 1 }, subtasks: { add: 3, skip: 0 } }),
    })
    const user = await openPage()
    await pick(user, file('FILE-TEXT'))
    await user.click(await screen.findByRole('button', { name: 'Import 2 tasks' }))

    const note = (await screen.findByText(/^Imported 2 task/)).closest('p')!
    expect(note).toHaveTextContent('Imported 2 task(s), 3 subtask(s) and 1 category; 1 duplicate task(s) skipped.')
    expect(note).toHaveTextContent('Safety backup: taskflow-pre-import-20261021-120000.db')
    expect(api.bodies['POST /api/import']).toEqual(['FILE-TEXT'])
    expect(screen.queryByRole('heading', { name: /Import preview/ })).toBeNull()

    await waitFor(() => expect(taskListCalls(api.calls)).toBeGreaterThan(1))
    await user.click(screen.getByRole('link', { name: /^My Tasks/ }))
    expect(await screen.findByRole('heading', { name: /^My Tasks/ })).toBeInTheDocument()
  })

  it('reloads tasks right away so new data is visible without a page refresh', async () => {
    const api = installFakeServer({ importSummary: () => emptySummary({ tasks: { add: 1, skip: 0 } }) })
    const user = await openPage()
    const initial = taskListCalls(api.calls)
    await pick(user, file())
    await user.click(await screen.findByRole('button', { name: 'Import 1 task' }))
    await screen.findByText(/^Imported 1 task/)
    await waitFor(() => expect(taskListCalls(api.calls)).toBeGreaterThan(initial))
  })

  it('shows the server error if the import is refused at the last moment', async () => {
    let first = true
    installFakeServer({
      importSummary: () => {
        // valid for the preview, invalid when applied (e.g. the file changed on disk or the server rules differ)
        if (first) { first = false; return emptySummary({ tasks: { add: 1, skip: 0 } }) }
        return emptySummary({ valid: false, errors: ['tasks[0].title is required.'] })
      },
    })
    const user = await openPage()
    await pick(user, file())
    await user.click(await screen.findByRole('button', { name: 'Import 1 task' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('tasks[0].title is required.')
  })

  it('prevents a double submit while the import is running', async () => {
    let release!: () => void
    const gate = new Promise<Response>((r) => (release = () => r(new Response(JSON.stringify({ summary: emptySummary({ tasks: { add: 1, skip: 0 } }), safetyBackup: null }), { status: 200 }))))
    const api = installFakeServer({
      importSummary: () => emptySummary({ tasks: { add: 1, skip: 0 } }),
      handlers: { 'POST /api/import': () => gate as unknown as Response },
    })
    const user = await openPage()
    await pick(user, file())
    const btn = await screen.findByRole('button', { name: 'Import 1 task' })
    await user.click(btn)
    expect(btn).toBeDisabled()
    await user.click(btn)
    release()
    await screen.findByText(/^Imported 1 task/)
    expect(api.calls.filter((c) => c === 'POST /api/import')).toHaveLength(1)
  })
})

describe('backups', () => {
  it('says where backups are kept and lists existing ones', async () => {
    installFakeServer({ backups: [backup('taskflow-backup-20261020-083000.db')], backupFolder: 'E:\\FormEngine\\data\\backups' })
    await openPage()
    expect(await screen.findByText('taskflow-backup-20261020-083000.db')).toBeInTheDocument()
    expect(screen.getByText('E:\\FormEngine\\data\\backups')).toBeInTheDocument()
    expect(screen.getByText(/never overwritten or deleted/)).toBeInTheDocument()
  })

  it('shows an empty state with no backups', async () => {
    installFakeServer({})
    await openPage()
    expect(await screen.findByText('No backups yet.')).toBeInTheDocument()
  })

  it('creates a backup, confirms it by name and adds it to the list', async () => {
    const api = installFakeServer({})
    const user = await openPage()
    await screen.findByText('No backups yet.')
    await user.click(screen.getByRole('button', { name: 'Create backup now' }))
    expect(await screen.findByText(/Backup saved as taskflow-backup-.*\.db \(52\.0 KB\)/)).toBeInTheDocument()
    expect(api.calls).toContain('POST /api/backups')
    expect(screen.queryByText('No backups yet.')).toBeNull()
    expect(screen.getAllByRole('listitem').some((li) => /taskflow-backup-.*\.db/.test(li.textContent ?? ''))).toBe(true)
  })

  it('reports a backup failure', async () => {
    installFakeServer({ handlers: { 'POST /api/backups': () => new Response(JSON.stringify({ title: 'Disk full' }), { status: 500 }) } })
    const user = await openPage()
    await user.click(await screen.findByRole('button', { name: 'Create backup now' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Disk full')
  })

  it('previews restoring a backup through the normal import flow', async () => {
    const api = installFakeServer({
      backups: [backup('taskflow-backup-20261020-083000.db')],
      importSummary: () => emptySummary({ tasks: { add: 4, skip: 0 }, subtasks: { add: 2, skip: 0 } }),
    })
    const user = await openPage()
    await user.click(await screen.findByRole('button', { name: 'Preview restoring taskflow-backup-20261020-083000.db' }))
    expect(await screen.findByRole('heading', { name: /backup taskflow-backup-20261020-083000.db/ })).toBeInTheDocument()
    expect(api.calls).toContain('GET /api/backups/taskflow-backup-20261020-083000.db/export')

    await user.click(screen.getByRole('button', { name: 'Import 4 tasks' }))
    expect(await screen.findByText(/Imported 4 task\(s\)/)).toBeInTheDocument()
  })

  it('explains the restore workflow', async () => {
    installFakeServer({})
    const user = await openPage()
    await user.click(screen.getByText('How restoring works'))
    expect(screen.getByText(/Records that already exist are skipped/)).toBeVisible()
    expect(screen.getByText(/safety backup is made first/)).toBeVisible()
    expect(screen.getByText(/everything with the contents of that backup/)).toBeVisible()
  })

  it('tells the user when a backup file has disappeared', async () => {
    installFakeServer({
      backups: [backup('taskflow-backup-20200101-000000.db')],
      handlers: { 'GET /api/backups/.*/export': () => new Response(JSON.stringify({ title: 'No such backup.' }), { status: 404 }) },
    })
    const user = await openPage()
    await user.click(await screen.findByRole('button', { name: /Preview restoring/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer exists')
  })

  it('does not break when the backup list cannot be loaded', async () => {
    installFakeServer({ handlers: { 'GET /api/backups': () => new Response('{}', { status: 500 }) } })
    await openPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not list backups')
    expect(screen.getByRole('button', { name: 'Create backup now' })).toBeEnabled()
  })
})

describe('data page with existing tasks', () => {
  it('leaves the task list untouched while browsing backups', async () => {
    installFakeServer({ tasks: [makeTask({ id: 1, title: 'Existing' })] })
    const user = await openPage()
    await user.click(screen.getByRole('link', { name: /^My Tasks/ }))
    expect(await screen.findByText('Existing')).toBeInTheDocument()
  })
})

describe('restore (replace everything)', () => {
  const NAME = 'taskflow-backup-20261020-083000.db'

  it('shows the server-reported attachments folder', async () => {
    installFakeServer({})
    await openPage()
    expect(await screen.findByText(/Attached files live in/)).toHaveTextContent(String.raw`E:\FormEngine\data\attachments`)
  })

  it('asks for explicit confirmation naming the backup, and does nothing on cancel', async () => {
    const api = installFakeServer({ backups: [backup(NAME)] })
    const user = await openPage()
    await user.click(await screen.findByRole('button', { name: `Restore ${NAME}` }))
    const dialog = await screen.findByRole('dialog', { name: /Replace all data/ })
    expect(dialog).toHaveTextContent(NAME)
    expect(dialog).toHaveTextContent(/replaced/)
    expect(dialog).toHaveTextContent(/safety backup/)
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.calls.some((c) => c.includes('/restore'))).toBe(false)
  })

  it('restores after confirmation, reports before/after and the safety backup, and reloads the tasks', async () => {
    const api = installFakeServer({
      backups: [backup(NAME)],
      tasks: [makeTask({ id: 1, title: 'A' }), makeTask({ id: 2, title: 'B' })],
    })
    const user = await openPage()
    const before = taskListCalls(api.calls)
    await user.click(await screen.findByRole('button', { name: `Restore ${NAME}` }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Replace all data' }))

    const note = await screen.findByText(/^Restored taskflow-backup-/)
    expect(note).toHaveTextContent('2 task(s) before → 2 now')
    expect(note).toHaveTextContent('taskflow-pre-restore-20261021-120000.db')
    expect(api.calls).toContain(`POST /api/backups/${NAME}/restore?confirm=true`)
    await waitFor(() => expect(taskListCalls(api.calls)).toBeGreaterThan(before))
  })

  it('reports a failed restore and says nothing was changed', async () => {
    installFakeServer({
      backups: [backup(NAME)],
      handlers: { 'POST /api/backups/.*/restore': () => new Response(JSON.stringify({ title: 'That file is not a readable TaskFlow backup.' }), { status: 400 }) },
    })
    const user = await openPage()
    await user.click(await screen.findByRole('button', { name: `Restore ${NAME}` }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Replace all data' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('not a readable TaskFlow backup')
  })

  it('shows tags and focus rows in the import preview when the server reports them', async () => {
    installFakeServer({ importSummary: () => emptySummary({ tasks: { add: 1, skip: 0 }, tags: { add: 2, skip: 0 }, focusSessions: { add: 5, skip: 1 } }) })
    const user = await openPage()
    await pick(user, file())
    await screen.findByRole('button', { name: 'Import 1 task' })
    const rows = screen.getAllByRole('row').map((r) => r.textContent)
    expect(rows).toContain('Tags20')
    expect(rows).toContain('Focus sessions51')
  })
})

describe('backup page address', () => {
  it('#/data and #/settings/backup both open Backup & data inside Settings', async () => {
    installFakeServer({})
    window.location.hash = '#/settings/backup'
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Backup & data' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Backup & data' })).toHaveAttribute('aria-current', 'page')
  })
})
