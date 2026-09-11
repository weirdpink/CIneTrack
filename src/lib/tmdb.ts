import { currentSettings, LANGUAGES } from './settings'

const BASE = '/api/tmdb'

export type MediaType = 'movie' | 'tv'

export type TmdbTitle = {
  id: number
  media_type?: MediaType
  title?: string
  name?: string
  poster_path: string | null
  backdrop_path: string | null
  overview: string
  vote_average: number
  release_date?: string
  first_air_date?: string
  genre_ids?: number[]
}

export type Episode = {
  id: number
  episode_number: number
  season_number: number
  name: string
  overview: string
  still_path: string | null
  air_date: string | null
  runtime: number | null
}

export type SeasonSummary = {
  id: number
  season_number: number
  name: string
  episode_count: number
  air_date: string | null
  poster_path: string | null
}

export type TitleDetail = TmdbTitle & {
  runtime?: number
  episode_run_time?: number[]
  number_of_seasons?: number
  number_of_episodes?: number
  status?: string
  tagline?: string
  imdb_id?: string | null
  external_ids?: { imdb_id?: string | null }
  genres?: { id: number; name: string }[]
  seasons?: SeasonSummary[]
  credits?: { cast: { id: number; name: string; character: string; profile_path: string | null }[] }
}

const MAX_CACHE_ENTRIES = 200
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes for client, server has 24h
type CacheEntry = { promise: Promise<unknown>; expires: number }
const clientCache = new Map<string, CacheEntry>()
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
type RequestOptions = { signal?: AbortSignal }

async function readResponseText(response: Response): Promise<string> {
  if (!response.body) {
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new Error('TMDb response was too large')
    return text
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error('TMDb response was too large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  let out = ''
  for (const chunk of chunks) out += decoder.decode(chunk, { stream: true })
  return out + decoder.decode()
}

/** Test-only: drop the client cache so tests never share inflight responses. */
export function __clearTmdbCache() {
  clientCache.clear()
}

function getCache(url: string): Promise<unknown> | undefined {
  const e = clientCache.get(url)
  if (!e) return undefined
  if (e.expires < Date.now()) {
    clientCache.delete(url)
    return undefined
  }
  // Promote on hit so hot entries survive eviction.
  clientCache.delete(url)
  clientCache.set(url, e)
  return e.promise
}

function setCache(url: string, promise: Promise<unknown>) {
  // Sweep expired entries first so dead weight never evicts live ones.
  const now = Date.now()
  for (const [k, v] of clientCache) {
    if (v.expires < now) clientCache.delete(k)
  }
  if (clientCache.size >= MAX_CACHE_ENTRIES) {
    const first = clientCache.keys().next().value as string | undefined
    if (first) clientCache.delete(first)
  }
  clientCache.set(url, { promise, expires: Date.now() + CACHE_TTL_MS })
}

/** Allowlisted UI locale for TMDb metadata; unknown values fall back to en-US. */
function sanitizeLanguage(lang: unknown): string {
  return typeof lang === 'string' && LANGUAGES.some((l) => l.id === lang) ? lang : 'en-US'
}

export async function tmdb<T>(  path: string,
  params: Record<string, string | number> = {},
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  // Allowlist params to prevent injection
  const allowedKeys = new Set([
    'language',
    'query',
    'page',
    'include_adult',
    'sort_by',
    'with_genres',
    'vote_count.gte',
    'append_to_response',
  ])
  const filtered: Record<string, string> = { language: sanitizeLanguage(currentSettings().metadataLanguage) }
  for (const [k, v] of Object.entries(params)) {
    if (!allowedKeys.has(k)) continue
    const val = String(v)
    if (val.length > 500) continue
    filtered[k] = val
  }

  const search = new URLSearchParams(filtered)
  const qs = search.toString() ? `?${search.toString()}` : ''
  const url = `${BASE}${path}${qs}`

  const timeoutMs = opts.timeoutMs ?? 10000
  const callerSignal = opts.signal

  const cached = getCache(url)
  if (cached) return raceAbort(cached as Promise<T>)

  // Detach a single caller on abort without killing the shared fetch other
  // callers may be waiting on — aborting shared work is what wedged detail
  // views when an effect cleanup fired while a remount reused the promise.
  function raceAbort(shared: Promise<T>): Promise<T> {
    if (!callerSignal) return shared
    if (callerSignal.aborted) return Promise.reject(new Error('Request cancelled'))
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(new Error('Request cancelled'))
      callerSignal.addEventListener('abort', onAbort, { once: true })
      shared.then(
        (v) => {
          callerSignal.removeEventListener('abort', onAbort)
          resolve(v)
        },
        (e) => {
          callerSignal.removeEventListener('abort', onAbort)
          reject(e)
        },
      )
    })
  }

  const promise = (async () => {
    // Offline fast-fail
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('You appear offline — check your connection')
    for (let attempt = 0; attempt < 2; attempt++) {
      // Timeout-only controller: only genuine timeouts abort shared work.
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      let res: Response
      try {
        res = await fetch(url, { signal: controller.signal, redirect: 'error' })
        const text = await readResponseText(res)
        clearTimeout(timeout)

        if (!res.ok) {
          const ct = res.headers.get('content-type') || ''
          let body: unknown = {}
          try {
            if (ct.includes('application/json')) body = JSON.parse(text)
            else body = { status_message: text.slice(0, 500) }
          } catch {}
          const msg = (body as { status_message?: string; error?: string })?.status_message ?? (body as { error?: string })?.error
          const retry = res.headers.get('retry-after')
          throw new Error(msg ?? `TMDb request failed (${res.status})${retry ? ` — retry after ${retry}s` : ''}`)
        }

        const ct = res.headers.get('content-type') || ''
        if (!ct.includes('application/json')) throw new Error(`Unexpected TMDb response: ${text.slice(0, 200)}`)
        try {
          return JSON.parse(text) as T
        } catch {
          throw new Error('TMDb returned malformed JSON')
        }
      } catch (e) {
        clearTimeout(timeout)
        const err = e as Error
        // Retry once on timeout.
        if (err.name === 'AbortError' && attempt === 0) continue
        if (err.name === 'AbortError') throw new Error('TMDb request timed out — please retry')
        throw e
      }
    }
    throw new Error('TMDb request timed out — please retry')
  })()

  const handled = promise.catch((err) => {
    clientCache.delete(url)
    throw err
  })

  // Don't cache 4xx/5xx — only cache on success, so wrap
  const cachedPromise = handled.then((v) => v) as Promise<unknown>
  // Insert after creating, but will be removed on rejection via catch above
  setCache(url, cachedPromise)
  // If it rejects, the catch above already deleted; keep map clean.
  // Guard the stored derived promise too — consumers attach to `handled`
  // via raceAbort, so without this every failure reports unhandled.
  cachedPromise.catch(() => {})
  handled.catch(() => {})
  return raceAbort(handled as Promise<T>)
}

// Only allow TMDb-relative paths; reject data:, blob:, http, and traversal
export const img = (path: string | null | undefined, size: 'w185' | 'w342' | 'w500' | 'w780' | 'original' = 'w342') => {
  if (!path) return null
  // Reject absolute URLs and data/blob — only allow TMDb relative paths like /abc.jpg
  if (path.startsWith('data:') || path.startsWith('blob:') || path.startsWith('http://') || path.startsWith('https://')) return null
  if (path.includes('..') || path.includes('\\') || !path.startsWith('/')) return null
  // Basic allowlist: / + alphanum + / . - _ 
  if (!/^\/[A-Za-z0-9/_\-.]+$/.test(path)) return null
  return `https://image.tmdb.org/t/p/${size}${path}`
}

export const titleOf = (t: TmdbTitle) => t.title ?? t.name ?? 'Untitled'
export const yearOf = (t: TmdbTitle) => (t.release_date ?? t.first_air_date ?? '').slice(0, 4)

export type Page = { results: TmdbTitle[]; page: number; total_pages: number }

export const searchMulti = (query: string, page = 1, opts?: RequestOptions) => {
  const q = query.trim().slice(0, 100)
  if (!q) return Promise.resolve({ results: [], page: 1, total_pages: 1 } as Page)
  return tmdb<Page>('/search/multi', { query: q, include_adult: String(currentSettings().includeAdult), page }, opts).then((r) => ({
    ...r,
    results: r.results.filter((x) => x.media_type === 'movie' || x.media_type === 'tv'),
  }))
}

export const trending = (type: 'all' | MediaType, window: 'day' | 'week' = 'week', page = 1, opts?: RequestOptions) => {
  if (page < 1 || page > 1000) page = 1
  return tmdb<Page>(`/trending/${type}/${window}`, { page }, opts)
}

export const recommendations = (type: MediaType, id: number, page = 1, opts?: RequestOptions) => {
  if (!Number.isInteger(id) || id <= 0 || id > 1e9) return Promise.reject(new Error('Invalid TMDb id'))
  if (page < 1 || page > 1000) page = 1
  return tmdb<Page>(`/${type}/${id}/recommendations`, { page }, opts)
}

export const discover = (
  type: MediaType,
  opts: { sort_by?: string; with_genres?: string; page?: number; 'vote_count.gte'?: number } = {},
  requestOpts?: RequestOptions,
) =>
  tmdb<Page>(`/discover/${type}`, {
    page: 1,
    'vote_count.gte': 50,
    include_adult: String(currentSettings().includeAdult),
    ...opts,
  }, requestOpts)
export const details = (type: MediaType, id: number, opts?: { signal?: AbortSignal }) => {
  if (!Number.isInteger(id) || id <= 0 || id > 1e9) return Promise.reject(new Error('Invalid TMDb id'))
  return tmdb<TitleDetail>(`/${type}/${id}`, { append_to_response: 'credits,external_ids' }, opts)
}

export const season = (id: number, seasonNumber: number, opts?: { signal?: AbortSignal }) => {
  if (!Number.isInteger(id) || id <= 0 || id > 1e9) return Promise.reject(new Error('Invalid TMDb id'))
  if (!Number.isInteger(seasonNumber) || seasonNumber < 0 || seasonNumber > 1000) return Promise.reject(new Error('Invalid season number'))
  return tmdb<{ episodes: Episode[]; name: string; overview: string }>(`/tv/${id}/season/${seasonNumber}`, {}, opts)
}
export const genreList = (type: MediaType, opts?: RequestOptions) =>
  tmdb<{ genres: { id: number; name: string }[] }>(`/genre/${type}/list`, {}, opts).then((r) => r.genres)

export type PersonDetail = {
  id: number
  name: string
  biography: string
  birthday: string | null
  deathday: string | null
  place_of_birth: string | null
  profile_path: string | null
  known_for_department: string | null
  popularity: number
}

export type PersonCredit = {
  id: number
  media_type?: MediaType
  title?: string
  name?: string
  poster_path: string | null
  character?: string
  release_date?: string
  first_air_date?: string
  vote_average?: number
  popularity?: number
}

export const person = (id: number, opts?: { signal?: AbortSignal }) => {
  if (!Number.isInteger(id) || id <= 0 || id > 1e9) return Promise.reject(new Error('Invalid TMDb id'))
  return tmdb<PersonDetail>(`/person/${id}`, {}, opts)
}

export const personCredits = (id: number, opts?: { signal?: AbortSignal }) => {
  if (!Number.isInteger(id) || id <= 0 || id > 1e9) return Promise.reject(new Error('Invalid TMDb id'))
  return tmdb<{ cast: PersonCredit[] }>(`/person/${id}/combined_credits`, {}, opts)
}
