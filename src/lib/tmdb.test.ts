import { afterEach, describe, expect, it, vi } from 'vitest'
import { __clearTmdbCache, tmdb } from './tmdb'

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
})
