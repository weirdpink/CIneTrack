import { afterEach, describe, expect, it, vi } from 'vitest'
import { __clearTmdbCache, person, personCredits, searchMulti, tmdb } from './tmdb'

afterEach(() => {
  vi.restoreAllMocks()
  __clearTmdbCache()
})

function mockDelayedJson(payload: unknown, delayMs = 30) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    () =>
      new Promise((resolve) =>
        setTimeout(
          () =>
            resolve(
              new Response(JSON.stringify(payload), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              }),
            ),
          delayMs,
        ),
      ) as Promise<Response>,
  )
}

describe('tmdb shared requests', () => {
  it('second caller still resolves when the first caller aborts a shared request', async () => {
    mockDelayedJson({ id: 99991 })
    const first = new AbortController()
    const second = new AbortController()
    const p1 = tmdb('/tv/99991', {}, { signal: first.signal })
    // Same URL while the first request is still in flight → shared promise.
    const p2 = tmdb('/tv/99991', {}, { signal: second.signal })

    first.abort()
    await expect(p1).rejects.toThrow('Request cancelled')
    await expect(p2).resolves.toEqual({ id: 99991 })
  })

  it('already-aborted callers reject without killing the shared request', async () => {
    mockDelayedJson({ id: 99992 })
    const dead = new AbortController()
    dead.abort()
    await expect(tmdb('/tv/99992', {}, { signal: dead.signal })).rejects.toThrow('Request cancelled')
    // Shared fetch still ran to completion and is now cached.
    await expect(tmdb('/tv/99992', {})).resolves.toEqual({ id: 99992 })
  })

  it('rejects non-object upstream JSON and drops malformed result rows', async () => {
    mockDelayedJson([])
    await expect(tmdb('/tv/99993', {})).rejects.toThrow('invalid response')

    __clearTmdbCache()
    mockDelayedJson({
      page: 1,
      total_pages: 1,
      results: [{ id: 0 }, { id: 10, media_type: 'movie', title: 'Valid' }],
    })
    await expect(searchMulti('valid')).resolves.toMatchObject({ results: [{ id: 10, title: 'Valid' }] })
  })
})

describe('person endpoints', () => {
  it('fetches a person profile and combined credits', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: any) => {
      const url = String(typeof input === 'string' ? input : (input?.url ?? input))
      const body = url.includes('/combined_credits')
        ? { cast: [{ id: 10, media_type: 'movie', title: 'Dune', popularity: 5 }] }
        : { id: 123, name: 'Actor', biography: 'Bio.' }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch)

    await expect(person(123)).resolves.toMatchObject({ name: 'Actor' })
    await expect(personCredits(123)).resolves.toMatchObject({ cast: [{ id: 10 }] })
  })

  it('rejects invalid person ids', async () => {
    await expect(person(0)).rejects.toThrow('Invalid TMDb id')
    await expect(personCredits(-5)).rejects.toThrow('Invalid TMDb id')
  })
})
