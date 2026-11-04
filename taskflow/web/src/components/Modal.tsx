import { useEffect, useRef, type ReactNode } from 'react'
import { Icon } from './Icon'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  /** Wide dialogs (task editor, command palette) use more of the screen. */
  size?: 'sm' | 'md' | 'lg'
  footer?: ReactNode
  /** Hide the visible title bar text (the dialog is still labelled for screen readers). */
  hideTitle?: boolean
}

/** Open dialogs, innermost last, so Escape closes only the top one (e.g. a confirmation above the editor). */
const stack: symbol[] = []

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/**
 * Accessible modal dialog: labelled, Escape / backdrop closes it, Tab cycles inside it, and focus returns to
 * whatever opened it. Content scrolls inside the dialog, never the page behind it.
 */
export function Modal({ title, onClose, children, size = 'md', footer, hideTitle }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const opener = useRef<Element | null>(document.activeElement)

  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  // Escape works even when focus has dropped out of the dialog (e.g. the focused button was just removed).
  useEffect(() => {
    const id = Symbol('modal')
    stack.push(id)
    document.body.classList.add('modal-open')
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || stack[stack.length - 1] !== id) return
      e.stopPropagation()
      closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      stack.splice(stack.indexOf(id), 1)
      if (stack.length === 0) document.body.classList.remove('modal-open')
    }
  }, [])

  useEffect(() => {
    const el = ref.current
    const first = el?.querySelector<HTMLElement>('[autofocus], input, textarea, select') ?? el?.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()
    const prev = opener.current as HTMLElement | null
    return () => prev?.focus?.()
  }, [])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Tab') return
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter((x) => x.offsetParent !== null || x === document.activeElement)
    if (items.length === 0) return
    const firstEl = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === firstEl) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      firstEl.focus()
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`modal modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={onKeyDown}
      >
        <header className="modal-head">
          {hideTitle ? <span /> : <h2>{title}</h2>}
          <button type="button" className="icon" aria-label="Close dialog" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  )
}

interface ConfirmProps {
  title: string
  message: ReactNode
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** Replaces window.confirm so confirmations match the app, can be tested, and never block the page. */
export function ConfirmDialog({ title, message, confirmLabel, danger, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Modal
      title={title}
      size="sm"
      onClose={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={danger ? 'primary danger-fill' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="confirm-message">{message}</p>
    </Modal>
  )
}
