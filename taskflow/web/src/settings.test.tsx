import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { SettingsPage } from './pages/SettingsPage'
import { installFakeServer } from './testing/fakeServer'
import { renderWithProviders } from './testing/render'
import { DEFAULT_SETTINGS, SETTINGS_KEY, type Settings } from './useSettings'

beforeEach(() => {
  window.localStorage.clear()
  window.location.hash = ''
})
afterEach(() => {
  vi.unstubAllGlobals()
  window.location.hash = ''
})

const stored = (): Settings => JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? '{}')

function openSettings(section: string | null = null) {
  installFakeServer({})
  const view = renderWithProviders(<SettingsPage section={section} onDataChanged={() => {}} />)
  return { user: userEvent.setup(), ...view }
}

describe('navigation', () => {
  it('lists every section, opens General by default and switches with the address', async () => {
    installFakeServer({})
    window.location.hash = '#/settings'
    const user = userEvent.setup()
    render(<App />)
    const nav = await screen.findByRole('navigation', { name: 'Settings sections' })
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual([
      'General', 'Tasks', 'Reminders', 'Focus timer', 'Dashboard', 'Backup & data', 'Keyboard shortcuts', 'About',
    ])
    expect(within(nav).getByRole('link', { name: 'General' })).toHaveAttribute('aria-current', 'page')

    await user.click(within(nav).getByRole('link', { name: 'Reminders' }))
    expect(window.location.hash).toBe('#/settings/reminders')
    expect(await screen.findByRole('heading', { name: 'Reminders' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Reminders' })).toHaveAttribute('aria-current', 'page')
  })

  it('opens the section named in the address, and falls back to General for junk', async () => {
    const { unmount } = openSettings('focus')
    expect(screen.getByRole('heading', { name: 'Focus timer' })).toBeInTheDocument()
    unmount()
    openSettings('nonsense')
    expect(screen.getByRole('heading', { name: 'General' })).toBeInTheDocument()
  })

  it('shows the shortcuts reference and the backup page', async () => {
    const { user } = openSettings('shortcuts')
    expect(screen.getByRole('row', { name: /Open the command palette/ })).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Backup & data' }))
    expect(await screen.findByRole('heading', { name: 'Backup & data' })).toBeInTheDocument()
  })
})

describe('general', () => {
  it('date and time formats persist and preview live', async () => {
    const { user } = openSettings('general')
    await user.selectOptions(screen.getByLabelText('Date format'), 'iso')
    expect(stored().dateFormat).toBe('iso')
    expect(screen.getByText(/Preview: \d{4}-\d{2}-\d{2}/)).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Time format'), '12h')
    expect(stored().timeFormat).toBe('12h')
    expect(screen.getByText('Preview: 2:30 PM')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Time format'), '24h')
    expect(screen.getByText('Preview: 14:30')).toBeInTheDocument()
  })

  it('week start persists', async () => {
    const { user } = openSettings('general')
    expect(screen.getByLabelText('Week starts on')).toHaveValue('1')
    await user.selectOptions(screen.getByLabelText('Week starts on'), 'Sunday')
    expect(stored().weekStart).toBe(0)
  })

  it('the choice survives a reload (fresh mount reads storage)', async () => {
    const first = openSettings('general')
    await first.user.selectOptions(screen.getByLabelText('Date format'), 'dmy')
    first.unmount()
    openSettings('general')
    expect(screen.getByLabelText('Date format')).toHaveValue('dmy')
  })
})

describe('tasks', () => {
  it('default priority and default view persist', async () => {
    const { user } = openSettings('tasks')
    await user.selectOptions(screen.getByLabelText('Default priority'), 'Urgent')
    await user.selectOptions(screen.getByLabelText('Default view'), 'Calendar')
    expect(stored()).toMatchObject({ defaultPriority: 'Urgent', defaultView: 'calendar' })
  })
})

describe('reminders', () => {
  it('default reminder and overdue/sound toggles persist', async () => {
    const { user } = openSettings('reminders')
    expect(screen.getByLabelText('Default reminder')).toHaveValue('')
    await user.selectOptions(screen.getByLabelText('Default reminder'), '30')
    expect(stored().defaultReminder).toBe(30)
    await user.selectOptions(screen.getByLabelText('Default reminder'), '0') // "at due time" is a real choice, not "none"
    expect(stored().defaultReminder).toBe(0)
    await user.selectOptions(screen.getByLabelText('Default reminder'), '')
    expect(stored().defaultReminder).toBeNull()

    await user.click(screen.getByRole('checkbox', { name: 'Tell me about overdue tasks' }))
    await user.click(screen.getByRole('checkbox', { name: 'Play a sound for notifications' }))
    expect(stored()).toMatchObject({ overdueAlerts: false, notificationSound: true })
  })

  it('is honest when the browser has no notification support', () => {
    vi.stubGlobal('Notification', undefined)
    openSettings('reminders')
    expect(screen.getByTestId('permission')).toHaveTextContent('unsupported')
    expect(screen.getByRole('button', { name: 'Allow browser notifications' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /browser notifications/ })).toBeDisabled()
    expect(screen.getByText(/only in-app notifications are shown/)).toBeInTheDocument()
  })

  it('asks for permission only when the button is pressed, then enables the option', async () => {
    const request = vi.fn(async () => 'granted' as NotificationPermission)
    vi.stubGlobal('Notification', Object.assign(function () {}, { permission: 'default', requestPermission: request }))
    const { user } = openSettings('reminders')
    expect(request).not.toHaveBeenCalled()
    expect(screen.getByTestId('permission')).toHaveTextContent('default')
    await user.click(screen.getByRole('button', { name: 'Allow browser notifications' }))
    expect(request).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByTestId('permission')).toHaveTextContent('granted'))
    expect(stored().browserNotifications).toBe(true)
    await user.click(screen.getByRole('checkbox', { name: 'Show reminders as browser notifications' }))
    expect(stored().browserNotifications).toBe(false)
  })

  it('explains a blocked permission and states the closed-tab limitation', () => {
    vi.stubGlobal('Notification', Object.assign(function () {}, { permission: 'denied', requestPermission: vi.fn() }))
    openSettings('reminders')
    expect(screen.getByTestId('permission')).toHaveTextContent('denied')
    expect(screen.getByText(/Blocked in the browser/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Allow browser notifications' })).toBeDisabled()
    expect(screen.getByText(/every TaskFlow tab is closed/)).toBeInTheDocument()
  })
})

describe('focus timer', () => {
  it('valid values persist', async () => {
    const { user } = openSettings('focus')
    const focus = screen.getByLabelText('Focus session (minutes)')
    await user.clear(focus)
    await user.type(focus, '50')
    expect(stored().focusMinutes).toBeUndefined() // nothing is saved until the box is left
    await user.tab()
    expect(stored().focusMinutes).toBe(50)
    const lng = screen.getByLabelText('Long break (minutes)')
    await user.clear(lng)
    await user.type(lng, '30{Enter}')
    expect(stored().longBreakMinutes).toBe(30)
    await user.click(screen.getByRole('checkbox', { name: 'Start the next session automatically' }))
    await user.click(screen.getByRole('checkbox', { name: 'Play a sound when a session ends' }))
    expect(stored()).toMatchObject({ autoStartNext: true, focusSound: false })
  })

  it.each([
    ['Focus session (minutes)', '0', 180],
    ['Focus session (minutes)', '181', 180],
    ['Short break (minutes)', '61', 60],
    ['Long break (minutes)', '121', 120],
  ])('rejects %s = %s and keeps the stored value', async (label, typed, max) => {
    const { user } = openSettings('focus')
    const input = screen.getByLabelText(label)
    const before = (input as HTMLInputElement).value
    await user.clear(input)
    await user.type(input, typed)
    expect(await screen.findByRole('alert')).toHaveTextContent(`from 1 to ${max}`)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    await user.tab()
    expect((input as HTMLInputElement).value).toBe(before) // leaving restores the saved value
    expect(stored()).not.toHaveProperty('focusMinutes') // nothing invalid (or half-typed) was saved
    expect(stored()).not.toHaveProperty('shortBreakMinutes')
    expect(stored()).not.toHaveProperty('longBreakMinutes')
  })

  it('rejects an empty or fractional value', async () => {
    const { user } = openSettings('focus')
    const input = screen.getByLabelText('Focus session (minutes)')
    await user.clear(input)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await user.type(input, '2.5')
    expect(screen.getByRole('alert')).toBeInTheDocument()
    await user.tab()
    expect(input).toHaveValue(25)
    expect(stored().focusMinutes).toBeUndefined()
  })
})

describe('dashboard preferences', () => {
  it('widget checkboxes persist', async () => {
    const { user } = openSettings('dashboard')
    await user.click(screen.getByRole('checkbox', { name: 'Focus summary' }))
    expect(stored().widgets.focus).toBe(false)
    expect(stored().widgets.today).toBe(true)
  })
})

describe('reset', () => {
  it('asks first, cancel keeps settings, confirm restores defaults without touching data', async () => {
    const { user } = openSettings('tasks')
    await user.selectOptions(screen.getByLabelText('Default priority'), 'Low')
    await user.click(screen.getByRole('button', { name: 'Reset settings to defaults' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reset settings?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(stored().defaultPriority).toBe('Low')

    await user.click(screen.getByRole('button', { name: 'Reset settings to defaults' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reset settings' }))
    expect(screen.getByLabelText('Default priority')).toHaveValue(DEFAULT_SETTINGS.defaultPriority)
    expect(stored()).toEqual(DEFAULT_SETTINGS)
  })
})

describe('about', () => {
  it('shows server details and truthful limitations', async () => {
    openSettings('about')
    expect(await screen.findByText('TaskFlow 1.0.0')).toBeInTheDocument()
    expect(screen.getByText('E:\\FormEngine\\data\\taskflow.db')).toBeInTheDocument()
    expect(screen.getByText('E:\\FormEngine\\data\\backups')).toBeInTheDocument()
    expect(screen.getByText('E:\\FormEngine\\data\\attachments')).toBeInTheDocument()
    expect(screen.getByText('UTC')).toBeInTheDocument()
    expect(screen.getByText(/Single user, local only/)).toBeInTheDocument()
    expect(screen.getByText(/only fire while a TaskFlow page is open/)).toBeInTheDocument()
    expect(screen.getByText(/not inside database backups or JSON exports/)).toBeInTheDocument()
    expect(screen.getByText(/run in your browser over all loaded tasks/)).toBeInTheDocument()
    expect(screen.getByText(/saved in this browser only/)).toBeInTheDocument()
  })

  it('reports when the server details cannot be loaded', async () => {
    installFakeServer({ handlers: { 'GET /api/about': () => new Response('{}', { status: 500 }) } })
    renderWithProviders(<SettingsPage section="about" onDataChanged={() => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load details')
    expect(screen.getByText(/Single user, local only/)).toBeInTheDocument()
  })
})

describe('storage trouble', () => {
  it('falls back to defaults if saved settings are junk', () => {
    window.localStorage.setItem(SETTINGS_KEY, '{not json')
    openSettings('tasks')
    expect(screen.getByLabelText('Default priority')).toHaveValue('Medium')
  })

  it('still works when storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { user } = openSettings('tasks')
    await user.selectOptions(screen.getByLabelText('Default priority'), 'High')
    expect(screen.getByLabelText('Default priority')).toHaveValue('High')
    vi.restoreAllMocks()
  })
})
