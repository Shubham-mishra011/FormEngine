import { useCallback, useEffect, useState } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'

export const THEME_KEY = 'taskflow-theme'
const THEME_EVENT = 'taskflow:theme-changed'

/** Storage can be unavailable (private mode, blocked cookies); the app must still work. */
export function readStoredTheme(): ThemePreference {
  try {
    const v = window.localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

function writeStoredTheme(p: ThemePreference) {
  try {
    if (p === 'system') window.localStorage.removeItem(THEME_KEY)
    else window.localStorage.setItem(THEME_KEY, p)
  } catch {
    /* preference just won't persist */
  }
}

/** "system" removes the attribute so the OS setting (prefers-color-scheme) applies via CSS. */
export function applyTheme(p: ThemePreference) {
  const root = document.documentElement
  if (p === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', p)
}

const darkQuery = () => window.matchMedia?.('(prefers-color-scheme: dark)')

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(readStoredTheme)
  const [systemDark, setSystemDark] = useState(() => !!darkQuery()?.matches)

  useEffect(() => {
    const mq = darkQuery()
    if (!mq) return
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => applyTheme(preference), [preference])

  // Several components (top bar, Settings) call this hook; a change in one must reach the others.
  useEffect(() => {
    const onChange = (e: Event) => setPreference((e as CustomEvent<ThemePreference>).detail)
    window.addEventListener(THEME_EVENT, onChange)
    return () => window.removeEventListener(THEME_EVENT, onChange)
  }, [])

  const choose = useCallback((p: ThemePreference) => {
    writeStoredTheme(p)
    setPreference(p)
    window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: p }))
  }, [])

  const resolved: 'light' | 'dark' = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference
  return { preference, resolved, choose }
}
