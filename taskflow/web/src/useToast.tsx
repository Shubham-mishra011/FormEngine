import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

export interface Toast {
  id: number
  message: string
  kind: 'info' | 'error'
}

interface Ctx {
  toasts: Toast[]
  toast: (message: string, kind?: Toast['kind']) => void
  dismiss: (id: number) => void
}

const ToastContext = createContext<Ctx | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const next = useRef(1)

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const toast = useCallback(
    (message: string, kind: Toast['kind'] = 'info') => {
      const id = next.current++
      setToasts((t) => [...t.slice(-3), { id, message, kind }])
      setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 3500)
    },
    [dismiss],
  )
  const value = useMemo(() => ({ toasts, toast, dismiss }), [toasts, toast, dismiss])
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
}

export function useToast(): Ctx {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}

/** Polite live region that shows the current toasts; mounted once by the app shell. */
export function Toasts() {
  const { toasts, dismiss } = useToast()
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span>{t.message}</span>
          <button type="button" className="icon" aria-label="Dismiss message" onClick={() => dismiss(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
