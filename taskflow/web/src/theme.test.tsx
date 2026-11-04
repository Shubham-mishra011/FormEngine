import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { ThemeToggle } from './components/ThemeToggle'
import { installFakeServer } from './testing/fakeServer'
import { THEME_KEY, applyTheme, readStoredTheme, useTheme } from './useTheme'

function mockOsTheme(dark: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>()
  const mq = {
    matches: dark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.delete(fn),
  }
  vi.stubGlobal('matchMedia', () => mq)
  return {
    change: (next: boolean) => {
      mq.matches = next
      listeners.forEach((fn) => fn({ matches: next } as MediaQueryListEvent))
    },
  }
}

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  mockOsTheme(false)
})
afterEach(() => vi.unstubAllGlobals())

describe('theme preference', () => {
  it('follows the operating system on first launch (nothing saved, no attribute set)', () => {
    mockOsTheme(true)
    const { result } = renderHook(() => useTheme())
    expect(result.current.preference).toBe('system')
    expect(result.current.resolved).toBe('dark')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(window.localStorage.getItem(THEME_KEY)).toBeNull()
  })

  it('reports light when the OS is light', () => {
    const { result } = renderHook(() => useTheme())
    expect(result.current.resolved).toBe('light')
  })

  it('tracks OS changes while on "system"', () => {
    const os = mockOsTheme(false)
    const { result } = renderHook(() => useTheme())
    expect(result.current.resolved).toBe('light')
    act(() => os.change(true))
    expect(result.current.resolved).toBe('dark')
  })

  it('a saved choice beats the OS setting', () => {
    window.localStorage.setItem(THEME_KEY, 'light')
    mockOsTheme(true)
    const { result } = renderHook(() => useTheme())
    expect(result.current.preference).toBe('light')
    expect(result.current.resolved).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('choosing a theme applies it and saves it; choosing "system" clears both', () => {
    const { result } = renderHook(() => useTheme())
    act(() => result.current.choose('dark'))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(window.localStorage.getItem(THEME_KEY)).toBe('dark')

    act(() => result.current.choose('system'))
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(window.localStorage.getItem(THEME_KEY)).toBeNull()
  })

  it('persists across a reload (a fresh mount reads what was saved)', () => {
    const first = renderHook(() => useTheme())
    act(() => first.result.current.choose('dark'))
    first.unmount()
    document.documentElement.removeAttribute('data-theme') // a reload starts with a clean document

    const second = renderHook(() => useTheme())
    expect(second.result.current.preference).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it.each(['purple', '', 'DARK', '{"a":1}'])('ignores an invalid saved value (%j)', (junk) => {
    window.localStorage.setItem(THEME_KEY, junk)
    expect(readStoredTheme()).toBe('system')
  })

  it('still works when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { result } = renderHook(() => useTheme())
    expect(result.current.preference).toBe('system')
    act(() => result.current.choose('dark'))
    expect(result.current.preference).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    vi.restoreAllMocks()
  })

  it('works when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined)
    const { result } = renderHook(() => useTheme())
    expect(result.current.resolved).toBe('light')
  })

  it('applyTheme sets and removes the attribute', () => {
    applyTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    applyTheme('system')
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })
})

describe('ThemeToggle', () => {
  it('is a labelled radio group with the current choice checked', () => {
    render(<ThemeToggle preference="dark" onChange={() => {}} />)
    expect(screen.getByRole('radiogroup', { name: 'Colour theme' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'false')
  })

  it('has a single tab stop (roving tabindex)', () => {
    render(<ThemeToggle preference="system" onChange={() => {}} />)
    const stops = screen.getAllByRole('radio').filter((r) => r.getAttribute('tabindex') === '0')
    expect(stops).toHaveLength(1)
    expect(stops[0]).toHaveAccessibleName('System')
  })

  it('calls onChange when clicked', async () => {
    const onChange = vi.fn()
    render(<ThemeToggle preference="system" onChange={onChange} />)
    await userEvent.setup().click(screen.getByRole('radio', { name: 'Light' }))
    expect(onChange).toHaveBeenCalledWith('light')
  })

  it('moves with arrow keys and wraps around', () => {
    const onChange = vi.fn()
    render(<ThemeToggle preference="dark" onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Dark' }), { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('light') // wraps from the last to the first
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Dark' }), { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith('system')
    onChange.mockClear()
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Dark' }), { key: 'a' })
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('theme in the app', () => {
  afterEach(() => {
    window.location.hash = ''
  })

  it('shows the toggle on every page and applies the choice to the whole document', async () => {
    installFakeServer()
    window.location.hash = '#/tasks'
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'My Tasks' })
    await user.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

    for (const page of ['Analytics', 'Settings', 'My Tasks']) {
      await user.click(screen.getByRole('link', { name: new RegExp(`^${page}`) }))
      const toggle = screen.getByRole('radiogroup', { name: 'Colour theme' }) // the one in the top bar
      expect(within(toggle).getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    }
  })

  it('can also be chosen in Settings > General, applies at once and is remembered', async () => {
    installFakeServer()
    window.location.hash = '#/settings/general'
    const user = userEvent.setup()
    render(<App />)
    const group = await screen.findByRole('radiogroup', { name: 'Theme' })
    expect(within(group).getByRole('radio', { name: 'Match system' })).toBeChecked()
    await user.click(within(group).getByRole('radio', { name: 'Dark' }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(window.localStorage.getItem(THEME_KEY)).toBe('dark')
    await user.click(within(group).getByRole('radio', { name: 'Light' }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    await user.click(within(group).getByRole('radio', { name: 'Match system' }))
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(window.localStorage.getItem(THEME_KEY)).toBeNull()
  })

  it('a saved dark theme is applied on load and shown as selected in Settings', async () => {
    window.localStorage.setItem(THEME_KEY, 'dark')
    installFakeServer()
    window.location.hash = '#/settings/general'
    render(<App />)
    const group = await screen.findByRole('radiogroup', { name: 'Theme' })
    expect(within(group).getByRole('radio', { name: 'Dark' })).toBeChecked()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})
