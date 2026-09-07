import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from '@testing-library/react'

beforeEach(() => {
  vi.resetModules()
})

describe('settings unknown-key passthrough', () => {
  it('preserves newer-client keys through read and write', async () => {
    localStorage.setItem(
      'archive.settings.v1',
      JSON.stringify({ theme: 'nitrate', futureFlag: 123 }),
    )
    const mod = await import('./settings')
    expect(mod.currentSettings().theme).toBe('nitrate')

    const { renderHook: rh } = await import('@testing-library/react')
    const { result } = rh(() => mod.useSettings())
    await act(async () => {
      result.current.set('density', 'compact')
    })
    const raw = JSON.parse(localStorage.getItem('archive.settings.v1') as string) as Record<string, unknown>
    expect(raw.density).toBe('compact')
    expect(raw.futureFlag).toBe(123)
  })
})
