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
    // Retired Nitrate id migrates to Velvet.
    expect(mod.currentSettings().theme).toBe('velvet')

    const { renderHook: rh } = await import('@testing-library/react')
    const { result } = rh(() => mod.useSettings())
    await act(async () => {
      result.current.set('density', 'compact')
    })
    const raw = JSON.parse(localStorage.getItem('archive.settings.v1') as string) as Record<string, unknown>
    expect(raw.density).toBe('compact')
    expect(raw.futureFlag).toBe(123)
  })

  it('sanitizes the new customization keys', async () => {
    localStorage.setItem(
      'archive.settings.v1',
      JSON.stringify({
        archiveName: '  My Shelf  ',
        defaultStatus: 'binge',
        defaultShelfTab: 'tv',
        defaultSort: 'bogus',
        chartStyle: 'area',
        dateStyle: 'relative',
        posterQuality: 'saver',
        metadataLanguage: 'xx-YY',
        showCommunityScores: 1,
      }),
    )
    const mod = await import('./settings')
    const s = mod.currentSettings()
    expect(s.archiveName).toBe('My Shelf')
    expect(s.defaultStatus).toBe('planned')
    expect(s.defaultShelfTab).toBe('tv')
    expect(s.defaultSort).toBe('added')
    expect(s.dateStyle).toBe('relative')
    expect(s.posterQuality).toBe('saver')
    expect(s.metadataLanguage).toBe('en-US')
    expect(s.showCommunityScores).toBe(true)
  })

  it('falls back to the default archive name when cleared', async () => {
    localStorage.setItem('archive.settings.v1', JSON.stringify({ archiveName: 'Kept Name' }))
    const mod = await import('./settings')
    expect(mod.currentSettings().archiveName).toBe('Kept Name')
    const { renderHook: rh } = await import('@testing-library/react')
    const { result } = rh(() => mod.useSettings())
    await act(async () => {
      result.current.set('archiveName', '   ')
    })
    expect(mod.currentSettings().archiveName).toBe('The Standing Collection')
  })
})
