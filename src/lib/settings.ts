import { useCallback, useSyncExternalStore } from 'react'

export type ThemeId = 'paper' | 'halide' | 'velvet' | 'blueprint'

export const THEMES: { id: ThemeId; name: string; note: string; tone: 'light' | 'dark'; swatch: [string, string, string] }[] = [
  { id: 'paper', name: 'Paper', note: 'True white stock, oxblood ink', tone: 'light', swatch: ['#ffffff', '#14130f', '#7a2318'] },
  { id: 'blueprint', name: 'Blueprint', note: 'Cool slate, technical ink', tone: 'light', swatch: ['#eef1f4', '#131a21', '#1f5673'] },
  { id: 'halide', name: 'Halide', note: 'Cold darkroom grey, silver-blue', tone: 'dark', swatch: ['#0f1417', '#e6edf1', '#6fa8c4'] },
  { id: 'velvet', name: 'Velvet', note: 'Cinema velvet, curtain-red house', tone: 'dark', swatch: ['#100e0d', '#f2ede1', '#b3402e'] },
]

export type Settings = {
  theme: ThemeId
  density: 'comfortable' | 'compact'
  hideSpoilers: boolean
  autoCompleteSeries: boolean
  posterMotion: boolean
  libraryColumns: number
  discoverColumns: number
  includeAdult: boolean
}

const DEFAULTS: Settings = {
  theme: 'paper',
  density: 'comfortable',
  hideSpoilers: false,
  autoCompleteSeries: true,
  posterMotion: true,
  libraryColumns: 6,
  discoverColumns: 7,
  includeAdult: false,
}

const STORAGE = 'archive.settings.v1'
const STORAGE_CORRUPT = 'archive.settings.v1.corrupt'

function clamp(n: unknown, min: number, max: number, def: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, Math.round(n as number)))
}

function sanitize(s: Partial<Settings> & Record<string, unknown>): Settings {
  const out: Settings = { ...DEFAULTS }
  // Retired id: Nitrate became Velvet (amber lamp → curtain red).
  const theme = (s.theme as string) === 'nitrate' ? 'velvet' : s.theme
  if (THEMES.some((t) => t.id === theme)) out.theme = theme as ThemeId
  if (s.density === 'comfortable' || s.density === 'compact') out.density = s.density
  out.hideSpoilers = !!s.hideSpoilers
  out.autoCompleteSeries = s.autoCompleteSeries !== false
  out.posterMotion = s.posterMotion !== false
  out.libraryColumns = clamp(s.libraryColumns, 3, 12, DEFAULTS.libraryColumns)
  out.discoverColumns = clamp(s.discoverColumns, 3, 12, DEFAULTS.discoverColumns)
  out.includeAdult = !!s.includeAdult
  return out
}

/**
 * Unknown keys (written by a newer client) ride along untouched so an older
 * client can never delete them on its next write — only known keys sanitize.
 */
let extraKeys: Record<string, unknown> = {}
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
function stashExtras(s: Record<string, unknown>, opts?: { merge?: boolean }) {
  if (!opts?.merge) extraKeys = {}
  for (const [k, v] of Object.entries(s)) {
    if (k in DEFAULTS || UNSAFE_KEYS.has(k)) continue
    extraKeys[k] = v
  }
}
function withExtras(s: Settings): Record<string, unknown> {
  return { ...extraKeys, ...s }
}

function read(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE)
    if (!raw) return { ...DEFAULTS }
    if (raw.length > 100000) {
      console.warn('[settings] blob too large, resetting')
      return { ...DEFAULTS }
    }
    const parsed = JSON.parse(raw) as Partial<Settings>
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ...DEFAULTS }
    stashExtras(parsed as Record<string, unknown>)
    return sanitize(parsed)
  } catch (e) {
    try {
      const raw = localStorage.getItem(STORAGE) ?? ''
      localStorage.setItem(STORAGE_CORRUPT, raw.slice(0, 5000))
      localStorage.removeItem(STORAGE)
      console.warn('[settings] corrupted, backed up', e)
    } catch {}
    return { ...DEFAULTS }
  }
}

let cache: Settings = read()
const listeners = new Set<() => void>()
let hydrating = true
let hasMutatedDuringHydration = false
/** Keys changed locally — these win over server values during hydrate merge. */
const dirtyKeys = new Set<keyof Settings>()

function getSnapshot(): Settings {
  return cache
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
function notify() {
  for (const fn of [...listeners]) {
    try {
      fn()
    } catch (e) {
      console.error(e)
    }
  }
}

export function applyTheme(theme: ThemeId) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = theme
}
try {
  applyTheme(cache.theme)
} catch {}

const SETTINGS_ENDPOINT = '/__data/settings'

function mirrorToSqlite(s: Settings) {
  if (typeof fetch !== 'function') return
  if (hydrating) {
    hasMutatedDuringHydration = true
    return
  }
  const body = JSON.stringify(withExtras(s))
  const isUnloading = typeof document !== 'undefined' && document.visibilityState === 'hidden'
  void fetch(SETTINGS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: isUnloading,
  }).catch(() => {})
}

async function hydrateFromSqlite() {
  if (typeof fetch !== 'function') {
    hydrating = false
    return
  }
  try {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), 2500)
    const res = await fetch(SETTINGS_ENDPOINT, { signal: controller.signal }).catch(() => null as unknown as Response)
    clearTimeout(t)
    if (!res || !res.ok) {
      hydrating = false
      if (JSON.stringify(cache) !== JSON.stringify(DEFAULTS)) setTimeout(() => mirrorToSqlite(cache), 800)
      return
    }
    const ct = res.headers.get('content-type') || ''
    if (!ct.includes('application/json')) {
      hydrating = false
      return
    }
    const stored = (await res.json().catch(() => ({}))) as Partial<Settings>
    if (!stored || typeof stored !== 'object' || Object.keys(stored).length === 0) {
      hydrating = false
      if (JSON.stringify(cache) !== JSON.stringify(DEFAULTS)) mirrorToSqlite(cache)
      return
    }
    stashExtras(stored as Record<string, unknown>, { merge: true })
    const sanitized = sanitize(stored)
    // Merge per-key: locally changed keys win, untouched keys take the
    // server value — a whole-object overwrite would wipe server-side edits
    // to keys this tab never touched.
    const merged: Record<string, unknown> = { ...sanitized }
    for (const [k, v] of Object.entries(cache)) {
      if (dirtyKeys.has(k as keyof Settings) || JSON.stringify(v) !== JSON.stringify(DEFAULTS[k as keyof Settings])) {
        merged[k] = v
      }
    }
    const next = sanitize(merged)
    if (JSON.stringify(next) !== JSON.stringify(cache)) {
      cache = next
      // push merged back to make DB portable if local had newer prefs
      setTimeout(() => mirrorToSqlite(next), 100)
    } else if (JSON.stringify(sanitized) !== JSON.stringify(cache)) {
      cache = sanitized
    }
    try {
      applyTheme(cache.theme)
    } catch {}
    try {
      localStorage.setItem(STORAGE, JSON.stringify(withExtras(cache)))
    } catch (e) {
      console.warn('[settings] quota', e)
    }
    notify()
  } catch {
    // offline
  } finally {
    hydrating = false
    if (hasMutatedDuringHydration) setTimeout(() => mirrorToSqlite(cache), 200)
  }
}
void hydrateFromSqlite()

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE) {
      const next = read()
      if (JSON.stringify(next) !== JSON.stringify(cache)) {
        cache = next
        try {
          applyTheme(cache.theme)
        } catch {}
        notify()
      }
    }
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && hasMutatedDuringHydration) mirrorToSqlite(cache)
  })
}

/** Non-reactive read, for modules that aren't components. Returns copy. */
export const currentSettings = (): Settings => ({ ...cache })

export function useSettings() {
  const settings = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const set = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    let sanitized: Settings[K] = value
    // Validate per-key
    if (key === 'theme' && !THEMES.some((t) => t.id === value)) sanitized = DEFAULTS.theme as Settings[K]
    if ((key === 'libraryColumns' || key === 'discoverColumns') && typeof value === 'number') {
      sanitized = clamp(value as unknown as number, 3, 12, (DEFAULTS as Record<string, unknown>)[key] as number) as Settings[K]
    }
    if ((key === 'density' && value !== 'comfortable' && value !== 'compact')) {
      return
    }
    const next = sanitize({ ...cache, [key]: sanitized })
    cache = next
    dirtyKeys.add(key)
    try {
      localStorage.setItem(STORAGE, JSON.stringify(withExtras(cache)))
    } catch (e) {
      console.error('[settings] quota', e)
      return
    }
    if (key === 'theme')
      try {
        applyTheme(cache.theme)
      } catch {}
    if (hydrating) hasMutatedDuringHydration = true
    else mirrorToSqlite(cache)
    notify()
  }, [])

  return { settings, set }
}
