import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  activityByMonth,
  formatRelativeDay,
  lastActivityAt,
  minutesWatched,
  normalizeEntry,
  parseLibraryImport,
  progress,
  watchedCount,
  recentActivity,
  recentCompletions,
  toDateInput,
  fromDateInput,
  useLibrary,
  type Entry,
} from './library'

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return normalizeEntry({
    id: 1,
    mediaType: 'movie',
    title: 'Test',
    year: '2024',
    poster: '/abc.jpg',
    backdrop: null,
    rating: null,
    status: 'planned',
    favorite: false,
    addedAt: Date.now(),
    watchedAt: null,
    runtime: 120,
    totalEpisodes: null,
    episodes: {},
    rewatches: [],
    ...overrides,
  } as Entry)
}

describe('normalizeEntry', () => {
  it('migrates completed -> watched', () => {
    const e = makeEntry({ status: 'completed' as unknown as Entry['status'] })
    expect(e.status).toBe('watched')
  })

  it('coerces unknown statuses to planned', () => {
    const e = makeEntry({ status: 'binge' as unknown as Entry['status'] })
    expect(e.status).toBe('planned')
  })

  it('drops malformed episode keys and non-numeric timestamps', () => {
    const e = makeEntry({
      episodes: { '1-1': 1000, nope: 2000, '1-x': 3000, '2-1': NaN, __proto__: 1 } as unknown as Record<string, number>,
      rewatches: [1000, 'soon', NaN] as unknown as number[],
      rating: 99,
    })
    expect(e.episodes).toEqual({ '1-1': 1000 })
    expect(e.rewatches).toEqual([1000])
    expect(e.rating).toBeNull()
  })

  it('initializes missing rewatches and episodes arrays/objects', () => {
    const raw = { id: 2, title: 'Sample', status: 'watching' } as unknown as Entry
    const normalized = normalizeEntry(raw)
    expect(Array.isArray(normalized.rewatches)).toBe(true)
    expect(typeof normalized.episodes).toBe('object')
  })

  it('is idempotent', () => {
    const e = makeEntry({ title: 'Hello', rating: 5, episodes: { '1-1': Date.now() } })
    const e2 = normalizeEntry({ ...e })
    expect(normalizeEntry(e2)).toEqual(e2)
  })
})

describe('progress', () => {
  it('movie watched -> 1, not watched -> 0', () => {
    expect(progress(makeEntry({ mediaType: 'movie', watchedAt: Date.now() }))).toBe(1)
    expect(progress(makeEntry({ mediaType: 'movie', watchedAt: null }))).toBe(0)
  })

  it('tv without totalEpisodes returns 0', () => {
    const e = makeEntry({ mediaType: 'tv', totalEpisodes: null, episodes: { '1-1': 1 } })
    expect(progress(e)).toBe(0)
  })

  it('tv watching uses watchedCount / totalEpisodes', () => {
    const e = makeEntry({
      mediaType: 'tv',
      status: 'watching',
      totalEpisodes: 10,
      episodes: { '1-1': 1, '1-2': 2 },
    })
    expect(progress(e)).toBe(0.2)
  })

  it('tv fully watched returns 1', () => {
    const episodes: Record<string, number> = {}
    for (let i = 1; i <= 5; i++) episodes[`1-${i}`] = Date.now()
    const e = makeEntry({
      mediaType: 'tv',
      status: 'watched',
      totalEpisodes: 5,
      episodes,
    })
    expect(progress(e)).toBe(1)
  })
})

describe('watchedCount', () => {
  it('counts episodes', () => {
    const e = makeEntry({ mediaType: 'tv', episodes: { '1-1': 1, '2-1': 2 } })
    expect(watchedCount(e)).toBe(2)
  })
})

describe('recentActivity', () => {
  it('correctly categorizes movies, episodes, and rewatches', () => {
    const e1 = makeEntry({ id: 1, mediaType: 'movie', watchedAt: 1000 })
    const e2 = makeEntry({ id: 2, mediaType: 'tv', watchedAt: null, episodes: { '1-1': 1500, '1-2': 1600 } })
    const e3 = makeEntry({ id: 3, mediaType: 'movie', watchedAt: null, rewatches: [2500] })

    const acts = recentActivity([e1, e2, e3], 10)
    const labels = acts.map((a) => a.label)

    expect(labels).toContain('Movie')
    expect(labels).toContain('S01E01')
    expect(labels).toContain('S01E02')
    expect(labels).toContain('Rewatch')
  })
})

describe('recentCompletions', () => {
  it('collapses a finished series to one row instead of per-episode rows', () => {
    const e = makeEntry({
      id: 2,
      mediaType: 'tv',
      status: 'watched',
      totalEpisodes: 3,
      episodes: { '1-1': 1500, '1-2': 1600, '1-3': 1700 },
    })
    const acts = recentCompletions([e], 10)
    expect(acts).toHaveLength(1)
    expect(acts[0].label).toBe('Series')
    expect(acts[0].at).toBe(1700)
  })

  it('prefers the recorded watch date over episode stamps', () => {
    const e = makeEntry({
      id: 2,
      mediaType: 'tv',
      status: 'watched',
      watchedAt: 1000,
      totalEpisodes: 3,
      episodes: { '1-1': 1500, '1-2': 1600, '1-3': 1700 },
    })
    const acts = recentCompletions([e], 10)
    expect(acts).toHaveLength(1)
    expect(acts[0].at).toBe(1000)
  })

  it('ignores in-progress episode logs', () => {
    const e = makeEntry({
      id: 2,
      mediaType: 'tv',
      status: 'watching',
      totalEpisodes: 10,
      episodes: { '1-1': 1500, '1-2': 1600 },
    })
    expect(recentCompletions([e], 10)).toHaveLength(0)
  })

  it('passes rewatch logs through alongside completions', () => {
    const e = makeEntry({
      id: 2,
      mediaType: 'tv',
      status: 'watched',
      totalEpisodes: 2,
      episodes: { '1-1': 1500, '1-2': 1600 },
      rewatches: [2500],
    })
    const acts = recentCompletions([e], 10)
    expect(acts.map((a) => a.label)).toEqual(['Rewatch', 'Series'])
  })
})
describe('activityByMonth', () => {
  it('counts a finished series once, not per episode, and ignores in-progress shows', () => {
    const done = makeEntry({
      mediaType: 'tv',
      status: 'watched',
      totalEpisodes: 3,
      episodes: { '1-1': 1000, '1-2': 2000, '1-3': 3000 },
    })
    const watching = makeEntry({
      mediaType: 'tv',
      status: 'watching',
      totalEpisodes: 10,
      episodes: { '1-1': 1000, '1-2': 2000 },
    })
    const out = activityByMonth([done, watching], 1200)
    expect(out.reduce((s, m) => s + m.count, 0)).toBe(1)
  })
})

describe('lastActivityAt', () => {
  it('prefers the recorded watch date over episode logs', () => {
    const e = makeEntry({
      mediaType: 'tv',
      status: 'watched',
      watchedAt: 1000,
      episodes: { '1-1': 5000, '1-2': 6000 },
      rewatches: [7000],
    })
    expect(lastActivityAt(e)).toBe(1000)
  })

  it('falls back to the latest log when no date is recorded', () => {
    const e = makeEntry({
      mediaType: 'tv',
      status: 'watching',
      watchedAt: null,
      episodes: { '1-1': 5000 },
      rewatches: [7000],
    })
    expect(lastActivityAt(e)).toBe(7000)
  })
})

describe('parseLibraryImport', () => {
  it('rejects oversize payloads', () => {
    expect(() => parseLibraryImport('x'.repeat(6 * 1024 * 1024), [])).toThrow(/5 MB/)
  })

  it('rejects malformed and non-list payloads', () => {
    expect(() => parseLibraryImport('nope{', [])).toThrow(/could not be read/)
    expect(() => parseLibraryImport('{"a":1}', [])).toThrow(/list of titles/)
  })

  it('imports valid rows and skips invalid ones', () => {
    const existing = [makeEntry({ id: 1 })]
    const { merged, imported, skipped } = parseLibraryImport(
      JSON.stringify([
        { id: 2, mediaType: 'movie', title: 'New', status: 'watched' },
        { id: 'bad', mediaType: 'movie' },
        { mediaType: 'tv' },
      ]),
      existing,
    )
    expect(imported).toBe(1)
    expect(skipped).toBe(2)
    expect(Object.keys(merged).sort()).toEqual(['movie:1', 'movie:2'])
  })
})

describe('minutesWatched', () => {  it('falls back to 110m for movies and 42m per episode without runtimes', () => {
    const movie = makeEntry({ mediaType: 'movie', watchedAt: 1000, runtime: null })
    const show = makeEntry({ mediaType: 'tv', episodes: { '1-1': 1, '1-2': 2 }, runtime: null })
    const unseen = makeEntry({ mediaType: 'movie', watchedAt: null })
    expect(minutesWatched([movie, show, unseen])).toBe(110 + 84)
  })
})

describe('store transitions', () => {
  let api: ReturnType<typeof useLibrary>

  beforeEach(async () => {
    const { result } = renderHook(() => useLibrary())
    api = result.current
    await act(async () => {
      api.clear()
    })
  })

  it('auto-completes a series when the last episode is toggled', async () => {
    await act(async () => {
      api.upsert('tv', 10, { totalEpisodes: 2, status: 'watching' })
    })
    await act(async () => {
      api.toggleEpisode(10, 1, 1, 1000)
    })
    expect(api.get('tv', 10).status).toBe('watching')
    await act(async () => {
      api.toggleEpisode(10, 1, 2, 2000)
    })
    const entry = api.get('tv', 10)
    expect(entry.status).toBe('watched')
    expect(Object.keys(entry.episodes)).toHaveLength(2)
  })

  it('unmarking a season resets status to planned and clears episodes', async () => {
    await act(async () => {
      api.upsert('tv', 11, { totalEpisodes: 2, status: 'watched', episodes: { '1-1': 1, '1-2': 2 } })
    })
    await act(async () => {
      api.setSeasonWatched(11, 1, [1, 2], false)
    })
    const entry = api.get('tv', 11)
    expect(entry.status).toBe('planned')
    expect(Object.keys(entry.episodes)).toHaveLength(0)
  })

  it('appends rewatch logs in chronological order', async () => {
    await act(async () => {
      api.upsert('movie', 12, { status: 'watched' })
    })
    await act(async () => {
      api.addRewatch('movie', 12, 3000)
    })
    await act(async () => {
      api.addRewatch('movie', 12, 2000)
    })
    expect(api.get('movie', 12).rewatches).toEqual([2000, 3000])
  })

  it('ignores non-integer season/episode numbers', async () => {
    await act(async () => {
      api.upsert('tv', 13, { totalEpisodes: 10, status: 'watching' })
    })
    await act(async () => {
      api.toggleEpisode(13, 1.5, 1)
      api.toggleEpisode(13, NaN, 1)
    })
    expect(Object.keys(api.get('tv', 13).episodes)).toHaveLength(0)
  })
})
describe('toDateInput / fromDateInput', () => {
  it('round-trips today', () => {
    const ts = Date.now()
    const s = toDateInput(ts)
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const back = fromDateInput(s)
    expect(back).not.toBeNull()
    expect(Math.abs((back as number) - ts)).toBeLessThan(24 * 60 * 60 * 1000)
  })

  it('rejects malformed input', () => {
    expect(fromDateInput('')).toBeNull()
    expect(fromDateInput('next friday')).toBeNull()
    expect(fromDateInput('2026-13-99')).toBeNull()
  })
})
describe('formatRelativeDay', () => {
  const noon = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime()
  it('names today and yesterday', () => {
    const now = noon(2026, 9, 11)
    expect(formatRelativeDay(now, now)).toBe('Today')
    expect(formatRelativeDay(noon(2026, 9, 10), now)).toBe('Yesterday')
  })
  it('counts days, weeks, then months', () => {
    const now = noon(2026, 9, 11)
    expect(formatRelativeDay(noon(2026, 9, 8), now)).toBe('3d ago')
    expect(formatRelativeDay(noon(2026, 8, 28), now)).toBe('2w ago')
    expect(formatRelativeDay(noon(2026, 7, 1), now)).toBe('2mo ago')
  })
  it('falls back to the absolute form past a year', () => {
    const now = noon(2026, 9, 11)
    expect(formatRelativeDay(noon(2025, 3, 4), now)).toMatch(/Mar/)
  })
  it('never goes negative for future stamps', () => {
    const now = noon(2026, 9, 11)
    expect(formatRelativeDay(noon(2026, 9, 20), now)).toBe('Today')
  })
})
