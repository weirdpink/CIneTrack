import { describe, expect, it } from 'vitest'
import { applyShelfFilters } from './Library'
import { normalizeEntry, type Entry } from '../lib/library'

function entry(overrides: Partial<Entry> = {}): Entry {
  return normalizeEntry({
    id: Math.floor(Math.random() * 100000),
    mediaType: 'movie',
    title: 'Test',
    year: '2024',
    poster: null,
    backdrop: null,
    rating: null,
    status: 'planned',
    favorite: false,
    addedAt: 1000,
    watchedAt: null,
    runtime: null,
    totalEpisodes: null,
    episodes: {},
    rewatches: [],
    ...overrides,
  } as Entry)
}

const baseOpts = { status: 'all' as const, minRating: 0, query: '', sort: 'added' as const }

describe('applyShelfFilters', () => {
  it('filters by status', () => {
    const pool = [entry({ status: 'watched' }), entry({ status: 'planned' })]
    const out = applyShelfFilters(pool, { ...baseOpts, status: 'watched' })
    expect(out).toHaveLength(1)
    expect(out[0]?.status).toBe('watched')
  })

  it('filters by minimum rating, excluding unrated', () => {
    const pool = [entry({ rating: 9 }), entry({ rating: 6 }), entry({ rating: null })]
    const out = applyShelfFilters(pool, { ...baseOpts, minRating: 8 })
    expect(out.map((e) => e.rating)).toEqual([9])
  })

  it('searches titles case-insensitively', () => {
    const pool = [entry({ title: 'The Batman' }), entry({ title: 'Superman' })]
    const out = applyShelfFilters(pool, { ...baseOpts, query: 'bat' })
    expect(out.map((e) => e.title)).toEqual(['The Batman'])
  })

  it('sorts by last watched with recorded dates first', () => {
    const old = entry({ watchedAt: 1000 })
    const recent = entry({ watchedAt: 5000 })
    const never = entry({ watchedAt: null })
    const out = applyShelfFilters([old, never, recent], { ...baseOpts, sort: 'lastWatched' })
    expect(out.map((e) => e.watchedAt)).toEqual([5000, 1000, null])
  })

  it('sorts by rating with unrated last', () => {
    const pool = [entry({ rating: null }), entry({ rating: 5 }), entry({ rating: 9 })]
    const out = applyShelfFilters(pool, { ...baseOpts, sort: 'rating' })
    expect(out.map((e) => e.rating)).toEqual([9, 5, null])
  })

  it('combines status, rating, and query', () => {
    const pool = [
      entry({ title: 'Dune', status: 'watched', rating: 9 }),
      entry({ title: 'Dune Messiah', status: 'watched', rating: 6 }),
      entry({ title: 'Dune', status: 'planned', rating: 9 }),
    ]
    const out = applyShelfFilters(pool, { ...baseOpts, status: 'watched', minRating: 8, query: 'dune' })
    expect(out).toHaveLength(1)
    expect(out[0]?.rating).toBe(9)
  })
})
