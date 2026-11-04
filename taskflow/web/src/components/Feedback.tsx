import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export function EmptyState({ icon, title, children, action }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state" role="status">
      {icon && (
        <span className="empty-icon">
          <Icon name={icon} />
        </span>
      )}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}

/** Placeholder rows while the first load is in flight (announced once as "Loading…"). */
export function Skeleton({ rows = 4, label = 'Loading…' }: { rows?: number; label?: string }) {
  return (
    <div className="skeleton-list" role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row" aria-hidden="true">
          <span className="sk sk-box" />
          <span className="sk-col">
            <span className="sk sk-line" style={{ width: `${70 - i * 8}%` }} />
            <span className="sk sk-line short" />
          </span>
        </div>
      ))}
    </div>
  )
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h2>{title}</h2>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  )
}
