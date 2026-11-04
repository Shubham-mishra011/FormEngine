import type { KeyboardEvent, ReactNode } from 'react'
import type { ThemePreference } from '../useTheme'

const options: { value: ThemePreference; label: string; icon: ReactNode }[] = [
  {
    value: 'light',
    label: 'Light',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    ),
  },
  {
    value: 'system',
    label: 'System',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </svg>
    ),
  },
  {
    value: 'dark',
    label: 'Dark',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    ),
  },
]

interface Props {
  preference: ThemePreference
  onChange: (p: ThemePreference) => void
}

/** Segmented control. Arrow keys move between options, as in a native radio group. */
export function ThemeToggle({ preference, onChange }: Props) {
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = options.findIndex((o) => o.value === preference)
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : null
    if (next === null) return
    e.preventDefault()
    const target = options[(next + options.length) % options.length]
    onChange(target.value)
    ;(e.currentTarget.querySelector(`[data-value="${target.value}"]`) as HTMLElement | null)?.focus()
  }

  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Colour theme" onKeyDown={onKeyDown}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          data-value={o.value}
          aria-checked={preference === o.value}
          tabIndex={preference === o.value ? 0 : -1}
          title={o.label}
          className={preference === o.value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          <span className="sr-only">{o.label}</span>
        </button>
      ))}
    </div>
  )
}
