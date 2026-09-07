import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type Toast = { id: number; message: string; kind: 'info' | 'success' | 'error' }
type Ctx = { toast: (msg: string, kind?: Toast['kind']) => void }

const ToastCtx = createContext<Ctx>({ toast: () => {} })

let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef<number[]>([])
  useEffect(() => () => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
  }, [])

  const toast = useCallback((message: string, kind: Toast['kind'] = 'info') => {
    const id = nextId++
    setToasts((t) => [...t, { id, message, kind }])
    const timer = window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id))
      timers.current = timers.current.filter((t) => t !== timer)
    }, 3000)
    timers.current.push(timer)
  }, [])
  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastCtx.Provider value={value}>
      {children}
      {createPortal(
        <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`pointer-events-auto min-w-[280px] max-w-[420px] border px-4 py-3 font-sans text-[13px] leading-relaxed shadow-lg ${
                t.kind === 'error'
                  ? 'border-[var(--destructive)] bg-[var(--destructive)] text-[var(--destructive-foreground)]'
                  : t.kind === 'success'
                    ? 'border-[var(--primary)] bg-[var(--primary)] text-primary-foreground'
                    : 'border-border bg-card text-foreground'
              }`}
            >
              <span className="mr-2 font-mono text-[11px] uppercase tracking-[0.12em] opacity-80" aria-hidden>
                {t.kind === 'error' ? '!' : t.kind === 'success' ? '✓' : 'i'}
              </span>
              {t.message}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  )
}

export function useToast() {
  return useContext(ToastCtx)
}
