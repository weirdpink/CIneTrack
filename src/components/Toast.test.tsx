import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ToastProvider, useToast } from './Toast'

function Probe() {
  const { toast } = useToast()
  return (
    <button type="button" onClick={() => toast('Hello archive', 'success')}>
      ping
    </button>
  )
}

describe('ToastProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows a toast with its kind marker and dismisses after 3s', () => {
    render(
      <ToastProvider>
        <Probe />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'ping' }))
    expect(screen.getByText('Hello archive')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(3100)
    })
    expect(screen.queryByText('Hello archive')).not.toBeInTheDocument()
  })
})
