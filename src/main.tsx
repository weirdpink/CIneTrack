import React, { Component, type ErrorInfo, type ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { ToastProvider } from './components/Toast'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('CineTrack Error:', error, info)
  }

  render() {
    if (this.state.error) {
      const err = this.state.error as Error
      const isDev = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-foreground">
          <div className="max-w-lg border border-border bg-card p-6 shadow-lg">
            <h1 className="font-display text-[26px] text-[var(--primary)]">Something went wrong</h1>
            <p className="mt-2 font-mono text-[12px] text-muted-foreground">{err.message}</p>
            {isDev && err.stack && (
              <pre className="mt-4 max-h-40 overflow-auto bg-muted p-3 font-mono text-[10px] text-muted-foreground">
                {err.stack}
              </pre>
            )}
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                onClick={() => this.setState({ error: null })}
                className="press border border-border bg-[var(--primary)] px-4 py-2 font-sans text-[11px] font-medium uppercase tracking-[0.14em] text-primary-foreground"
              >
                Try Again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="press border border-border bg-background px-4 py-2 font-sans text-[11px] font-medium uppercase tracking-[0.14em] hover:bg-muted"
              >
                Reload Page
              </button>
            </div>
            <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">If this keeps happening, export your library from Settings and share the error ID with support.</p>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
