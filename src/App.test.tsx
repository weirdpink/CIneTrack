import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App'
import { ToastProvider } from './components/Toast'

function renderApp() {
  return render(
    <ToastProvider>
      <App />
    </ToastProvider>,
  )
}

describe('nav keyboard shortcuts', () => {
  it('Alt+2 jumps to Discover and Alt+3 to Library', async () => {
    renderApp()
    fireEvent.keyDown(window, { key: '2', code: 'Digit2', altKey: true })
    expect(await screen.findByRole('heading', { name: 'Discover' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: '3', code: 'Digit3', altKey: true })
    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument()
  })

  it('binds physical keys, so macOS Option glyphs (™£) still navigate', async () => {
    renderApp()
    fireEvent.keyDown(window, { key: '™', code: 'Digit2', altKey: true })
    expect(await screen.findByRole('heading', { name: 'Discover' })).toBeInTheDocument()
  })

  it('ignores plain digit presses without Alt', () => {
    renderApp()
    fireEvent.keyDown(window, { key: '3', code: 'Digit3' })
    expect(screen.queryByRole('heading', { name: 'Library' })).not.toBeInTheDocument()
  })

  it('Alt+, toggles settings and the gear shows only its shortcut', async () => {
    renderApp()
    fireEvent.keyDown(window, { key: ',', code: 'Comma', altKey: true })
    const dialog = await screen.findByRole('dialog', { name: 'Settings' })
    expect(dialog).not.toHaveAttribute('inert')

    fireEvent.keyDown(window, { key: ',', code: 'Comma', altKey: true })
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Settings' })).toHaveAttribute('inert')
    })

    const gear = screen.getByRole('button', { name: 'Open settings' })
    const hint = gear.parentElement?.textContent ?? ''
    expect(hint).toContain(',')
    expect(hint).not.toContain('1')
  })
})
