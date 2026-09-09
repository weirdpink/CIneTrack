import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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

  it('Alt+, opens settings and the gear tooltip lists shortcuts', async () => {
    renderApp()
    fireEvent.keyDown(window, { key: ',', code: 'Comma', altKey: true })
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument()

    const gear = screen.getByRole('button', { name: 'Open settings' })
    const tip = gear.getAttribute('title') ?? ''
    expect(tip).toContain('1')
    expect(tip).toContain('2')
    expect(tip).toContain('3')
    expect(tip).toContain(',')
  })
})
