import { useCallback, useSyncExternalStore } from 'react'
import type { MediaType, TmdbTitle } from './tmdb'
import { titleOf, yearOf } from './tmdb'
import { currentSettings } from './settings'

export type Status = 'watching' | 'planned' | 'watched' | 'dropped'

export type Entry = {
  id: number
  mediaType: MediaType
  title: string
  year: string
  poster: string | null
  backdrop: string | null
  rating: number | null // personal 1–10
  status: Status
  favorite: boolean
  addedAt: number
  /** Movies: timestamp of the watch. */
  watchedAt: number | null
  runtime: number | null
  /** TV: "season-episode" → timestamp watched. */
  episodes: Record<string, number>
  totalEpisodes: number | null
  /** Timestamps of additional complete watch-throughs, beyond the first. */
  rewatches: number[]
  /** Retired: free-text notes were removed from the UI. Kept for back-compat. */
  note?: string
}

const STORAGE = 'archive.library.v1'
const STORAGE_CORRUPT = 'archive.library.v1.corrupt'
/** Server truncates rewatches at 500 — mirror that client-side. */
const MAX_REWATCHES = 500

export const epKey = (s: number, e: number) => `${s}-${e}`
export const entryKey = (type: MediaType, id: number) => `${type}:${id}`

/** Hard bounds mirroring the server's truncations, so a crafted import can
 *  never persist a multi-MB title the UI then has to render. */
const MAX_TITLE_LEN = 200
const MAX_NOTE_LEN = 2000
const MAX_POSTER_LEN = 500
const MAX_BACKDROP_LEN = 500
const MAX_RUNTIME = 600
const MAX_TOTAL_EPISODES = 10000
const MAX_EPISODE_KEYS = 20000
const MAX_TIMESTAMP = 8_640_000_000_000_000

/** Map keys must be `movie:<id>` / `tv:<id>` — anything else (incl. __proto__
 *  style keys from crafted imports) is dropped before it can touch the store. */
export function isSafeKey(key: unknown): key is string {
  if (typeof key !== 'string') return false
  const match = /^(movie|tv):(\d+)$/.exec(key)
  return !!match && Number.isSafeInteger(Number(match[2])) && Number(match[2]) > 0
}

const STATUSES: Status[] = ['planned', 'watching', 'watched', 'dropped']

function finiteOrNull(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

export function isValidTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= MAX_TIMESTAMP
}

/**
 * Bring a stored/imported record up to the current shape in place: rename the
 * retired 'completed' status, coerce every scalar, and drop malformed episode
 * / rewatch timestamps — so one bad row can never crash a whole view.
 */
export function normalizeEntry(entry: Entry): Entry {
  if ((entry.status as string) === 'completed') entry.status = 'watched'
  if (!STATUSES.includes(entry.status)) entry.status = 'planned'
  if (entry.mediaType !== 'movie' && entry.mediaType !== 'tv') entry.mediaType = 'movie'
  if (!Number.isSafeInteger(entry.id) || (entry.id as number) <= 0) entry.id = 0
  if (typeof entry.title !== 'string' || !entry.title) entry.title = 'Untitled'
  else entry.title = entry.title.slice(0, MAX_TITLE_LEN)
  if (typeof entry.year !== 'string') entry.year = ''
  else entry.year = entry.year.slice(0, 4)
  if (typeof entry.poster !== 'string') entry.poster = null
  else if (entry.poster.length > MAX_POSTER_LEN) entry.poster = null
  if (typeof entry.backdrop !== 'string') entry.backdrop = null
  else if (entry.backdrop.length > MAX_BACKDROP_LEN) entry.backdrop = null
  if (typeof entry.rating !== 'number' || !Number.isInteger(entry.rating) || entry.rating < 1 || entry.rating > 10) {
    entry.rating = null
  }
  entry.favorite = !!entry.favorite
  entry.addedAt = isValidTimestamp(entry.addedAt) ? entry.addedAt : Date.now()
  entry.watchedAt = isValidTimestamp(entry.watchedAt) ? entry.watchedAt : null
  const runtime = finiteOrNull(entry.runtime)
  entry.runtime = runtime == null ? null : Math.min(MAX_RUNTIME, Math.max(0, Math.floor(runtime)))
  const total = finiteOrNull(entry.totalEpisodes)
  entry.totalEpisodes = total == null ? null : Math.min(MAX_TOTAL_EPISODES, Math.max(0, Math.floor(total)))
  if (!entry.episodes || typeof entry.episodes !== 'object') entry.episodes = {}
  else {
    const keys = Object.keys(entry.episodes)
    for (const [k, v] of Object.entries(entry.episodes)) {
      if (!/^\d+-\d+$/.test(k) || !isValidTimestamp(v)) delete entry.episodes[k]
    }
    // Bound per-entry growth so one crafted row can't stall every commit.
    if (keys.length > MAX_EPISODE_KEYS) {
      const keep = new Set(keys.filter((k) => /^\d+-\d+$/.test(k)).slice(-MAX_EPISODE_KEYS))
      for (const k of Object.keys(entry.episodes)) if (!keep.has(k)) delete entry.episodes[k]
    }
  }
  if (!Array.isArray(entry.rewatches)) entry.rewatches = []
  else entry.rewatches = entry.rewatches.filter(isValidTimestamp).slice(-MAX_REWATCHES)
  if (typeof entry.note === 'string' && entry.note.length > MAX_NOTE_LEN) entry.note = entry.note.slice(0, MAX_NOTE_LEN)
  else if (entry.note != null && typeof entry.note !== 'string') entry.note = undefined
  return entry
}

/** Validate + normalize a raw id-keyed map, dropping unsafe keys entirely. */
function sanitizeMap(raw: unknown): Record<string, Entry> {
  const out: Record<string, Entry> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  let dropped = 0
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isSafeKey(k) || !v || typeof v !== 'object') {
      dropped++
      continue
    }
    try {
      out[k] = normalizeEntry(v as Entry)
    } catch {
      dropped++
    }
  }
  if (dropped > 0) console.warn(`[library] dropped ${dropped} invalid rows on import`)
  return out
}

let localSnapshotPresent = false

function read(): Record<string, Entry> {
  try {
    const raw = localStorage.getItem(STORAGE)
    if (!raw) return {}
    localSnapshotPresent = true
    return sanitizeMap(JSON.parse(raw))
  } catch {
    try {
      const raw = localStorage.getItem(STORAGE) ?? ''
      localStorage.setItem(STORAGE_CORRUPT, raw.slice(0, 20000))
      localStorage.removeItem(STORAGE)
      localSnapshotPresent = false
      console.warn('[library] local data corrupted, backed up')
    } catch {}
    return {}
  }
}

const listeners = new Set<() => void>()
const noopSubscribe = () => () => {}
let cache = read()
/**
 * Stable array snapshot. Rebuilt only on commit, so consumers can safely use
 * `entries` as a hook dependency — a fresh Object.values() per render would
 * invalidate every downstream useMemo/useCallback and loop their effects.
 */
let snapshot = Object.values(cache)

/**
 * Portable SQLite mirror at data/cinetrack.db, served by a dev-only Vite
 * middleware (see vite.config.ts). localStorage stays the synchronous source
 * of truth; the DB is written best-effort so a failed request never disturbs
 * the UI. In a static production build the endpoint is absent — every call
 * simply no-ops and the app runs on localStorage alone.
 */
const DB_ENDPOINT = '/__data/library'

let hydrating = true
let mutatedDuringHydration = false

/** Coalesce rapid full-snapshot writes so bulk episode updates do not queue stale payloads. */
let pendingMirrorBody: string | null = null
let mirrorRunning = false
function mirrorToSqlite(map: Record<string, Entry>) {
  if (hydrating) {
    mutatedDuringHydration = true
    return
  }
  try {
    if (typeof fetch !== 'function') return
    pendingMirrorBody = JSON.stringify(map)
    if (mirrorRunning) return
    mirrorRunning = true
    void (async () => {
      while (pendingMirrorBody !== null) {
        const body = pendingMirrorBody
        pendingMirrorBody = null
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 8000)
        try {
          const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
          const keepalive = hidden && new TextEncoder().encode(body).byteLength <= 64 * 1024
          const res = await fetch(DB_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            keepalive,
            signal: controller.signal,
          })
          if (!res.ok) console.warn(`[library] SQLite mirror rejected snapshot (${res.status})`)
        } catch (e) {
          console.warn('[library] SQLite mirror unavailable', e)
        } finally {
          clearTimeout(timeout)
        }
      }
      mirrorRunning = false
    })()
  } catch {
    /* a synchronously-throwing fetch must never break UI updates */
  }
}

/**
 * Hydrate from on-disk SQLite database at data/cinetrack.db on initial load.
 * If SQLite has entries, it populates the app; if SQLite is fresh and localStorage
 * has existing records, it seeds SQLite so the collection is saved to disk immediately.
 * Writes made while hydration is in flight always win over the snapshot.
 */
async function hydrateFromSqlite() {
  if (typeof fetch !== 'function') {
    hydrating = false
    return
  }
  try {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), 2500)
    const res = await fetch(DB_ENDPOINT, { signal: controller.signal }).catch(() => null as unknown as Response)
    clearTimeout(t)
    if (!res || !res.ok) {
      hydrating = false
      if (Object.keys(cache).length > 0) mirrorToSqlite(cache)
      return
    }
    const ct = res.headers.get('content-type') || ''
    if (!ct.includes('application/json')) {
      hydrating = false
      return
    }
    const map = sanitizeMap(await res.json().catch(() => ({})))
    if (Object.keys(map).length > 0 && !localSnapshotPresent) {
      commit(map)
    } else if (localSnapshotPresent || Object.keys(cache).length > 0) {
      // localStorage is authoritative. A present empty snapshot is meaningful:
      // it can represent an intentional archive wipe.
      hydrating = false
      mirrorToSqlite(cache)
      return
    }
  } catch {
    /* offline or static build — stay on localStorage */
  } finally {
    hydrating = false
    if (mutatedDuringHydration) mirrorToSqlite(cache)
  }
}

function commit(next: Record<string, Entry>) {
  cache = next
  snapshot = Object.values(next)
  // Subscribers first: the UI must reflect the write even if persistence
  // below throws (private-mode quota, blocked endpoint, …).
  for (const fn of [...listeners]) {
    try {
      fn()
    } catch (e) {
      console.error('[library] subscriber failed', e)
    }
  }
  try {
    localStorage.setItem(STORAGE, JSON.stringify(next))
    localSnapshotPresent = true
  } catch (e) {
    // Memory + UI stay live and the SQLite mirror may still land; warn loudly
    // instead of failing silently, and retry on the next commit.
    console.warn('[library] local persistence failed', e)
  }
  mirrorToSqlite(next)
}

void hydrateFromSqlite()

export function useLibrary(subscribeToStore = true) {
  const entries = useSyncExternalStore(
    subscribeToStore
      ? (fn) => {
          listeners.add(fn)
          return () => listeners.delete(fn)
        }
      : noopSubscribe,
    () => snapshot,
    () => snapshot,
  )

  const get = useCallback((type: MediaType, id: number) => cache[entryKey(type, id)], [])

  const upsert = useCallback((type: MediaType, id: number, patch: Partial<Entry>, seed?: TmdbTitle) => {
    if ((type !== 'movie' && type !== 'tv') || !Number.isSafeInteger(id) || id <= 0) return
    const key = entryKey(type, id)
    const existing = cache[key]
    const base: Entry = existing ?? {
      id,
      mediaType: type,
      title: seed ? titleOf(seed) : 'Untitled',
      year: seed ? yearOf(seed) : '',
      poster: seed?.poster_path ?? null,
      backdrop: null, // retired: no backdrop UI ships, so don't mirror dead weight
      rating: null,
      status: 'planned',
      favorite: false,
      addedAt: Date.now(),
      watchedAt: null,
      runtime: null,
      episodes: {},
      totalEpisodes: null,
      rewatches: [],
    }
    commit({ ...cache, [key]: normalizeEntry({ ...base, ...patch }) })
  }, [])

  const remove = useCallback((type: MediaType, id: number) => {
    if ((type !== 'movie' && type !== 'tv') || !Number.isSafeInteger(id) || id <= 0) return
    const next = { ...cache }
    delete next[entryKey(type, id)]
    commit(next)
  }, [])

  /** `at` backdates the log; defaults to now. Ignores non-integer season/episodes. */
  const toggleEpisode = useCallback((id: number, s: number, e: number, at?: number) => {
    if (!Number.isInteger(id) || !Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e < 0) return
    const key = entryKey('tv', id)
    const entry = cache[key]
    if (!entry) return
    const k = epKey(s, e)
    const stamp = isValidTimestamp(at) ? at : Date.now()
    const episodes = { ...entry.episodes }
    if (Object.prototype.hasOwnProperty.call(episodes, k)) delete episodes[k]
    else episodes[k] = Number.isFinite(stamp) ? stamp : Date.now()
    const watched = Object.keys(episodes).length
    const finished = currentSettings().autoCompleteSeries && !!entry.totalEpisodes && watched >= entry.totalEpisodes
    // An empty log is never "watched" — fall back to planned (dropped stays dropped).
    const status: Status = finished ? 'watched' : watched > 0 ? 'watching' : entry.status === 'dropped' ? 'dropped' : 'planned'
    commit({ ...cache, [key]: { ...entry, episodes, status } })
  }, [])

  const setSeasonWatched = useCallback(
    (id: number, s: number, numbers: number[], watched: boolean, at?: number) => {
    if (!Number.isInteger(id) || !Number.isInteger(s) || s < 0 || !Array.isArray(numbers)) return
    const key = entryKey('tv', id)
    const entry = cache[key]
    if (!entry) return
    const episodes = { ...entry.episodes }
    for (const n of numbers) {
      if (!Number.isInteger(n) || n < 0) continue
      if (watched) episodes[epKey(s, n)] = episodes[epKey(s, n)] ?? (isValidTimestamp(at) ? at : Date.now())
      else delete episodes[epKey(s, n)]
    }
    const count = Object.keys(episodes).length
    const finished = currentSettings().autoCompleteSeries && !!entry.totalEpisodes && count >= entry.totalEpisodes
    const status: Status =
      finished ? 'watched' : count > 0 ? 'watching' : entry.status === 'dropped' ? 'dropped' : 'planned'
    commit({ ...cache, [key]: { ...entry, episodes, status } })
    },
    [],
  )

  /** Log an additional watch-through at `at` (defaults to now). Capped at MAX_REWATCHES. */
  const addRewatch = useCallback((type: MediaType, id: number, at?: number) => {
    const key = entryKey(type, id)
    const entry = cache[key]
    if (!entry) return
    const stamp = at ?? Date.now()
    if (!isValidTimestamp(stamp)) return
    const rewatches = [...(entry.rewatches ?? []), stamp].sort((a, b) => a - b).slice(-MAX_REWATCHES)
    commit({ ...cache, [key]: { ...entry, rewatches } })
  }, [])

  /** Rewrite one logged rewatch date by its index. */
  const setRewatchDate = useCallback((type: MediaType, id: number, index: number, at: number) => {
    if (!isValidTimestamp(at)) return
    const key = entryKey(type, id)
    const entry = cache[key]
    if (!entry?.rewatches || !Number.isInteger(index) || index < 0 || index >= entry.rewatches.length) return
    const rewatches = [...entry.rewatches]
    rewatches[index] = at
    rewatches.sort((a, b) => a - b)
    commit({ ...cache, [key]: { ...entry, rewatches } })
  }, [])

  const removeRewatch = useCallback((type: MediaType, id: number, index: number) => {
    const key = entryKey(type, id)
    const entry = cache[key]
    if (!entry?.rewatches) return
    const rewatches = entry.rewatches.filter((_, i) => i !== index)
    commit({ ...cache, [key]: { ...entry, rewatches } })
  }, [])

  const replaceAll = useCallback((next: Record<string, Entry>) => commit(sanitizeMap(next)), [])
  const clear = useCallback(() => commit({}), [])

  return {
    entries,
    get,
    upsert,
    remove,
    toggleEpisode,
    setSeasonWatched,
    addRewatch,
    setRewatchDate,
    removeRewatch,
    replaceAll,
    clear,
  }
}

if (typeof window !== 'undefined') {
  // Cross-tab sync: another tab's commit re-reads here (the event never fires
  // in the tab that wrote, so this cannot loop). Comparison is key-order
  // insensitive so identical maps don't ping-pong rewrites between tabs.
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE) return
    if (e.newValue === null) {
      commit({})
      return
    }
    try {
      const next = sanitizeMap(JSON.parse(e.newValue))
      if (stableStringify(next) !== stableStringify(cache)) commit(next)
    } catch {
      /* ignore malformed cross-tab payloads */
    }
  })
}

/** Order-insensitive JSON for comparing id-keyed maps across tabs. */
function stableStringify(map: Record<string, Entry>): string {
  const keys = Object.keys(map).sort()
  return JSON.stringify(keys.map((k) => [k, map[k]]))
}

export type ImportResult = { merged: Record<string, Entry>; imported: number; skipped: number }

/** Validate an import payload: throws a user-actionable error, otherwise
 *  returns the merged map plus import/skip counts. */
export function parseLibraryImport(text: string, existing: Entry[]): ImportResult {
  if (text.length > 5 * 1024 * 1024) throw new Error('File too large — max 5 MB.')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Not a CineTrack JSON export — file could not be read.')
  }
  if (!Array.isArray(parsed)) throw new Error('Not a CineTrack JSON export — expected a list of titles.')
  if (parsed.length > 5000) throw new Error('Too many entries — max 5000 titles per import.')
  const merged: Record<string, Entry> = {}
  for (const e of existing) merged[`${e.mediaType}:${e.id}`] = e
  let imported = 0
  let skipped = 0
  for (const raw of parsed) {
    const e = raw as Partial<Entry>
    if (!Number.isSafeInteger(e?.id) || (e?.id as number) <= 0 || (e?.mediaType !== 'movie' && e?.mediaType !== 'tv')) {
      skipped++
      continue
    }
    try {
      const key = `${e.mediaType}:${e.id}`
      if (!isSafeKey(key)) {
        skipped++
        continue
      }
      merged[key] = normalizeEntry(e as Entry)
      imported++
    } catch {
      skipped++
    }
  }
  return { merged, imported, skipped }
}

/* ---------- date helpers ---------- */

/** Timestamp → yyyy-mm-dd in local time (toISOString would shift the day). */
export function toDateInput(ts: number) {
  if (!isValidTimestamp(ts)) return ''
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** yyyy-mm-dd → timestamp at local midday, keeping the day stable across zones.
 *  Returns null for malformed input (including rolled-over dates like Feb 30)
 *  instead of NaN or a silently wrong day. */
export function fromDateInput(value: string): number | null {
  if (typeof value !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const ts = new Date(y, mo - 1, d, 12).getTime()
  if (!Number.isFinite(ts)) return null
  const check = new Date(ts)
  if (check.getFullYear() !== y || check.getMonth() !== mo - 1 || check.getDate() !== d) return null
  return ts
}

export const todayInput = () => toDateInput(Date.now())

/* ---------- derived metrics ---------- */

export const watchedCount = (e: Entry) => Object.keys(e.episodes ?? {}).length

/** Latest timestamp in a list without spread (avoids stack overflow on huge maps). */
function maxTime(times: readonly unknown[]): number | null {
  let max: number | null = null
  for (const t of times) {
    if (typeof t !== 'number' || !Number.isFinite(t)) continue
    if (max == null || t > max) max = t
  }
  return max
}

function latestTime(a: number | null, b: number | null): number | null {
  if (a == null) return b
  if (b == null) return a
  return Math.max(a, b)
}

function validStamp(at: unknown): at is number {
  return isValidTimestamp(at)
}

export function progress(e: Entry) {
  if (e.mediaType === 'movie') return e.watchedAt != null && validStamp(e.watchedAt) ? 1 : 0
  if (!e.totalEpisodes || e.totalEpisodes <= 0) return 0
  return Math.min(1, Math.max(0, watchedCount(e) / e.totalEpisodes))
}

/** Approximate minutes watched: movies use runtime, episodes assume 42m when unknown. */
export function minutesWatched(entries: Entry[]) {
  return entries.reduce((sum, e) => {
    const runtime = typeof e.runtime === 'number' && Number.isFinite(e.runtime) ? Math.max(0, e.runtime) : 0
    if (e.mediaType === 'movie') return sum + (e.watchedAt != null && validStamp(e.watchedAt) ? (runtime || 110) : 0)
    return sum + watchedCount(e) * (runtime || 42)
  }, 0)
}

/** Consistent short date for ledger microcopy (en-GB: "05 Sept"). */
export function formatDayMonth(at: number) {
  if (!isValidTimestamp(at)) return 'Unknown date'
  return new Date(at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

/** Friendly relative date for the ledger ("Today", "3d ago"); falls back to
 *  the absolute form once the stamp is a year or more old. */
export function formatRelativeDay(at: number, now = Date.now()) {
  if (!isValidTimestamp(at) || !isValidTimestamp(now)) return 'Unknown date'
  const day = 86_400_000
  const startOfDay = (ts: number) => {
    const d = new Date(ts)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  const diff = Math.max(0, Math.round((startOfDay(now) - startOfDay(at)) / day))
  if (diff <= 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7) return `${diff}d ago`
  if (diff < 30) {
    const w = Math.floor(diff / 7)
    return w <= 1 ? '1w ago' : `${w}w ago`
  }
  if (diff < 365) {
    const m = Math.floor(diff / 30)
    return m <= 1 ? '1mo ago' : `${m}mo ago`
  }
  return formatDayMonth(at)
}

/** Latest viewing timestamp: your recorded watch date wins when present,
 *  otherwise the latest logged episode or rewatch. */
export function lastActivityAt(e: Entry): number | null {
  if (validStamp(e.watchedAt)) return e.watchedAt
  return latestTime(maxTime(Object.values(e.episodes ?? {})), maxTime(e.rewatches ?? []))
}

export type Activity = { entry: Entry; at: number; label: string }

/** Completed viewings only — no per-episode rows. Movies use watchedAt,
 *  finished series collapse to a single row at their latest episode
 *  timestamp, and rewatch logs pass through. */
export function recentCompletions(entries: Entry[], limit = 8): Activity[] {
  const events: Activity[] = []
  for (const e of entries) {
    if (e.mediaType === 'movie') {
      if (validStamp(e.watchedAt)) events.push({ entry: e, at: e.watchedAt, label: 'Movie' })
    } else if (e.status === 'watched') {
      const at = validStamp(e.watchedAt) ? e.watchedAt : maxTime(Object.values(e.episodes ?? {}))
      if (at != null) events.push({ entry: e, at, label: 'Series' })
    }
    for (const at of e.rewatches ?? []) {
      if (validStamp(at)) events.push({ entry: e, at, label: 'Rewatch' })
    }
  }
  return events.sort((a, b) => b.at - a.at).slice(0, limit)
}

export function recentActivity(entries: Entry[], limit = 12): Activity[] {
  const events: Activity[] = []
  for (const e of entries) {
    if (e.mediaType === 'movie' && validStamp(e.watchedAt)) {
      events.push({ entry: e, at: e.watchedAt, label: 'Movie' })
    } else {
      for (const [k, at] of Object.entries(e.episodes ?? {})) {
        const parts = k.split('-')
        if (parts.length !== 2) continue
        const [s, ep] = parts as [string, string]
        if (!/^\d+$/.test(s) || !/^\d+$/.test(ep) || !validStamp(at)) continue
        events.push({ entry: e, at, label: `S${s.padStart(2, '0')}E${ep.padStart(2, '0')}` })
      }
    }
    // Rewatches are logged viewings too — fold them into the ledger and charts.
    for (const at of e.rewatches ?? []) {
      if (validStamp(at)) events.push({ entry: e, at, label: 'Rewatch' })
    }
  }
  return events.sort((a, b) => b.at - a.at).slice(0, limit)
}

/** Completed titles per calendar month for the trailing `months` window —
 *  each finished movie/series counts once (never per episode); rewatch logs
 *  each count as one completed viewing. */
export function activityByMonth(entries: Entry[], months = 12) {
  const buckets = new Map<string, number>()
  const bump = (at: unknown) => {
    if (!validStamp(at)) return
    const d = new Date(at)
    const key = `${d.getFullYear()}-${d.getMonth()}`
    buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }
  for (const e of entries) {
    if (e.mediaType === 'movie') {
      if (e.watchedAt != null) bump(e.watchedAt)
    } else if (e.status === 'watched') {
      const at = validStamp(e.watchedAt) ? e.watchedAt : maxTime(Object.values(e.episodes ?? {}))
      if (at != null) bump(at)
    }
    for (const at of e.rewatches ?? []) bump(at)
  }

  const out: { month: string; label: string; count: number }[] = []
  const cursor = new Date()
  cursor.setDate(1)
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(cursor.getFullYear(), cursor.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${d.getMonth()}`
    out.push({
      month: key,
      label: d.toLocaleDateString(undefined, { month: 'short' }),
      count: buckets.get(key) ?? 0,
    })
  }
  return out
}
