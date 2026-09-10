import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import fs from 'node:fs'

// Vite config — https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), cinetrackSqlitePersistence()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.PORT) > 0 && Number(process.env.PORT) < 65536 ? Number(process.env.PORT) : 8443,
    strictPort: true,
    watch: {
      ignored: ['**/data/**', '**/*.db', '**/API.txt'],
    },
    fs: {
      strict: true,
      allow: [
        path.resolve(import.meta.dirname, './src'),
        path.resolve(import.meta.dirname, './index.html'),
        path.resolve(import.meta.dirname, './node_modules/sql.js'),
      ],
    },
    headers: {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https://image.tmdb.org data:; connect-src 'self' https://api.themoviedb.org; object-src 'none'; base-uri 'none'; form-action 'self'",
    },
    cors: false,
  },
  preview: {
    host: '127.0.0.1',
    port: Number(process.env.PORT) > 0 && Number(process.env.PORT) < 65536 ? Number(process.env.PORT) : 8443,
    headers: {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https://image.tmdb.org data:; connect-src 'self' https://api.themoviedb.org; object-src 'none'; base-uri 'none'; form-action 'self'",
    },
  },
  build: {
    chunkSizeWarningLimit: 500,
    target: 'es2020',
    cssCodeSplit: true,
    sourcemap: false,
    assetsInlineLimit: 4096,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) return 'charts'
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/scheduler')) return 'vendor'
          return undefined
        },
      },
    },
  },
})

/**
 * Portable SQLite persistence — single source of truth at data/cinetrack.db
 * Works in both dev (`vite dev`) and preview (`vite preview`), so the
 * project folder is self-contained. Copy the folder and the DB moves with it.
 * Production/static fallback is localStorage + fetch seeding when server absent.
 */
function cinetrackSqlitePersistence(): Plugin {
  const DB_PATH = path.resolve(import.meta.dirname, 'data/cinetrack.db')
  const WASM_PATH = path.resolve(import.meta.dirname, 'node_modules/sql.js/dist/sql-wasm.wasm')
  const API_FILE = path.resolve(import.meta.dirname, 'API.txt')
  const TMDB_BASE = 'https://api.themoviedb.org/3'
  const MAX_BODY_BYTES = 10 * 1024 * 1024 // 10 MB — allows 5000 entries (~2.9MB) + headroom
  const MAX_BODY_BYTES_SETTINGS = 256 * 1024
  const CACHE_TTL_MS = 1000 * 60 * 60 * 24
  const MAX_CACHE_ENTRIES = 200
  const ALLOWED_TMDB_PREFIXES = ['/search/', '/discover/', '/trending/', '/movie/', '/tv/', '/genre/', '/person/']
  const ALLOWED_TMDB_QUERY_KEYS = new Set([
    'language',
    'query',
    'page',
    'include_adult',
    'sort_by',
    'with_genres',
    'vote_count.gte',
    'append_to_response',
  ])

  let cachedApiKey: string | null = null
  let cachedApiKeyMtime = 0
  let cachedDotEnv: Record<string, string> | null = null

  // Minimal .env reader (no new deps). Vite's own loadEnv only surfaces
  // VITE_-prefixed vars, so a plain TMDB_KEY would never reach this config —
  // read it ourselves. .env.local wins over .env.
  function readDotEnvFile(): Record<string, string> {
    if (cachedDotEnv) return cachedDotEnv
    const out: Record<string, string> = {}
    try {
      for (const name of ['.env', '.env.local']) {
        const p = path.resolve(import.meta.dirname, name)
        if (!fs.existsSync(p)) continue
        for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
          const t = line.trim()
          if (!t || t.startsWith('#')) continue
          const eq = t.indexOf('=')
          if (eq <= 0) continue
          let v = t.slice(eq + 1).trim()
          if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
            v = v.slice(1, -1)
          }
          if (v) out[t.slice(0, eq).trim()] = v
        }
      }
    } catch {
      /* missing/unreadable env file — fall through */
    }
    cachedDotEnv = out
    return out
  }

  function getTmdbApiKey(): string {
    // Cache and watch API.txt mtime to avoid per-request sync read
    try {
      const stat = fs.existsSync(API_FILE) ? fs.statSync(API_FILE).mtimeMs : 0
      if (cachedApiKey !== null && stat === cachedApiKeyMtime) return cachedApiKey
      if (fs.existsSync(API_FILE)) {
        const key = fs.readFileSync(API_FILE, 'utf8').trim()
        if (key) {
          cachedApiKey = key
          cachedApiKeyMtime = stat
          return key
        }
      }
    } catch {
      // fall through to env
    }
    const envKey = process.env.TMDB_KEY
    if (envKey) {
      cachedApiKey = envKey.trim()
      return cachedApiKey
    }
    const fileEnvKey = readDotEnvFile().TMDB_KEY
    if (fileEnvKey) {
      cachedApiKey = fileEnvKey.trim()
      return cachedApiKey
    }
    if (process.env.VITE_TMDB_KEY) {
      // VITE_ vars are embedded in client bundle — warn and ignore
      try {
        console.warn('[cinetrack] VITE_TMDB_KEY is exposed to client — use TMDB_KEY instead')
      } catch {}
    }
    // No fallback hardcoded key — fail explicitly
    throw new Error('TMDb API key missing: create API.txt or set TMDB_KEY env')
  }

  function isAllowedTmdbPath(subpath: string): boolean {
    // Normalize first to prevent /movie/../genre bypass — use dummy base to avoid /3 prefix
    let norm: string
    try {
      norm = new URL(subpath, 'http://localhost').pathname
    } catch {
      norm = subpath.split('?')[0]
    }
    // Block encoded traversal and double slash
    if (norm.includes('%2e') || norm.includes('%2E') || norm.includes('//') || norm.includes('/./')) return false
    return ALLOWED_TMDB_PREFIXES.some((prefix) => norm.startsWith(prefix))
  }

  function sanitizeSubpath(subpath: string): string {
    // Strip any injected api_key param to prevent duplication
    try {
      const u = new URL(subpath, TMDB_BASE)
      u.searchParams.delete('api_key')
      u.searchParams.delete('access_token')
      u.searchParams.delete('session_id')
      // Drop fragment entirely — TMDb doesn't use it
      return u.pathname + (u.search ? u.search : '')
    } catch {
      return subpath
    }
  }

  let sqlPromise: Promise<any> | null = null
  const getSql = () => {
    if (!sqlPromise) {
      sqlPromise = import('sql.js')
        .then((m) => (m.default as any)({ locateFile: () => WASM_PATH }))
        .catch((e) => {
          sqlPromise = null
          throw e
        })
    }
    return sqlPromise
  }

  async function openDb() {
    const SQL = await getSql()
    let buffer: Buffer | null = null
    if (fs.existsSync(DB_PATH)) {
      const st = fs.statSync(DB_PATH)
      // Bound what sql.js will parse — a runaway file must not OOM the server.
      // Oversize fails loudly (500): it must NOT fall through to an empty
      // handle, or the next write would persist empty over the real file.
      if (st.size > 64 * 1024 * 1024) throw new Error('DB file too large')
      try {
        buffer = fs.readFileSync(DB_PATH)
      } catch {
        buffer = null
      }
    }
    let db: any
    try {
      db = buffer ? new SQL.Database(buffer) : new SQL.Database()
    } catch {
      // Corrupt DB: quarantine it aside and start fresh instead of 500ing forever.
      try {
        const q = `${DB_PATH}.corrupt.${Date.now()}`
        fs.renameSync(DB_PATH, q)
        try {
          console.warn(`[cinetrack-sqlite] corrupt DB quarantined at ${q}`)
        } catch {}
      } catch {}
      db = new SQL.Database()
    }
    db.run(`
      CREATE TABLE IF NOT EXISTS library (
        key TEXT PRIMARY KEY,
        media_type TEXT,
        id INTEGER,
        title TEXT,
        year TEXT,
        poster TEXT,
        backdrop TEXT,
        rating REAL,
        status TEXT,
        favorite INTEGER DEFAULT 0,
        added_at INTEGER,
        watched_at INTEGER,
        runtime INTEGER,
        total_episodes INTEGER,
        episodes TEXT,
        rewatches TEXT,
        note TEXT,
        json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
    return db
  }

  let lastCleanup = 0
  function persist(db: any) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
    const tmp = `${DB_PATH}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`
    const data = Buffer.from(db.export())
    fs.writeFileSync(tmp, data, { mode: 0o600 })
    try {
      const fd = fs.openSync(tmp, 'r')
      fs.fsyncSync(fd)
      fs.closeSync(fd)
    } catch {}
    // ensure correct perms before rename
    try {
      fs.chmodSync(tmp, 0o600)
    } catch {}
    // atomic replace + fsync directory for durability
    fs.renameSync(tmp, DB_PATH)
    try {
      const dirFd = fs.openSync(path.dirname(DB_PATH), 'r')
      try { fs.fsyncSync(dirFd) } catch {}
      fs.closeSync(dirFd)
    } catch {}
    // throttled cleanup — hourly, not per write
    if (Date.now() - lastCleanup > 60 * 60 * 1000) {
      lastCleanup = Date.now()
      try {
        const dir = path.dirname(DB_PATH)
        for (const f of fs.readdirSync(dir)) {
          if (!f.startsWith('cinetrack.db.tmp.')) continue
          const full = path.join(dir, f)
          try {
            const st = fs.statSync(full)
            if (Date.now() - st.mtimeMs > 60 * 60 * 1000) fs.unlinkSync(full)
          } catch {}
        }
      } catch {}
    }
  }

  async function readBodyWithLimit(req: import('node:http').IncomingMessage, limit: number): Promise<Buffer> {
    const chunks: Buffer[] = []
    let size = 0
    const timeout = setTimeout(() => {
      try { req.destroy() } catch {}
    }, 10000)
    try {
      for await (const chunk of req) {
        const buf = chunk as Buffer
        size += buf.length
        if (size > limit) {
          req.destroy()
          throw new Error('PAYLOAD_TOO_LARGE')
        }
        chunks.push(buf)
      }
      return Buffer.concat(chunks)
    } finally {
      clearTimeout(timeout)
    }
  }

  // Simple LRU helpers for tmdbCache — fix FIFO and add sweeping
  function evictIfNeeded(cache: Map<string, any>) {
    if (cache.size > MAX_CACHE_ENTRIES) {
      const first = cache.keys().next().value as string | undefined
      if (first) cache.delete(first)
    }
    // Sweep expired on every 50 inserts and also when over limit
    if (cache.size % 50 === 0 || cache.size > MAX_CACHE_ENTRIES) {
      const now = Date.now()
      for (const [k, v] of cache) if (v.expires < now) cache.delete(k)
    }
  }

  // Rate limiter for TMDb proxy — 40 req per 10s per IP to avoid IP ban
  const tmdbRateMap = new Map<string, number[]>()
  function isTmdbRateLimited(ip: string): boolean {
    const now = Date.now()
    const windowMs = 10000
    const max = 40
    const arr = tmdbRateMap.get(ip) || []
    const recent = arr.filter((t) => now - t < windowMs)
    if (recent.length >= max) {
      tmdbRateMap.set(ip, recent)
      return true
    }
    recent.push(now)
    tmdbRateMap.set(ip, recent)
    if (tmdbRateMap.size > 100) {
      for (const [k, v] of tmdbRateMap) if (v.every((t) => now - t > windowMs)) tmdbRateMap.delete(k)
    }
    return false
  }

  let writeChain: Promise<void> = Promise.resolve()
  function queueWrite<T>(fn: () => Promise<T>): Promise<T> {
    const p = writeChain.then(fn) as Promise<T>
    // Keep chain alive even if fn rejects
    writeChain = (p as Promise<unknown>).catch(() => {}) as Promise<void>
    return p
  }

  // Shared attachment for both dev server and preview server — keeps data/cinetrack.db portable.
  // Preview is strict: headerless non-browser clients are rejected there,
  // while dev still allows local curl debugging.
  async function attachHandlers(
    server: { config: { logger: { warn: (m: string) => void } }; middlewares: { use: (fn: any) => void } },
    strictOriginChecks = false,
  ) {
    try {
      const initDb = await openDb()
      persist(initDb)
      initDb.close()
    } catch (e) {
      server.config.logger.warn(`[cinetrack-sqlite] DB init: ${(e as Error).message}`)
    }

      const tmdbCache = new Map<string, { status: number; contentType: string; body: string; expires: number }>()

      server.middlewares.use(async (req: any, res: any, next: any) => {
        const rawUrl = req.url || ''
        // Use URL to normalize pathname and guard against /api/tmdb-evil
        let pathname = ''
        try {
          const u = new URL(rawUrl, 'http://localhost')
          pathname = u.pathname
        } catch {
          pathname = rawUrl.split('?')[0]
        }

        // Block direct access to sensitive files (case-insensitive: macOS fs is too)
        const lowerPath = pathname.toLowerCase()
        if (lowerPath === '/api.txt' || lowerPath === '/vite.config.ts' || lowerPath.startsWith('/data/') || lowerPath === '/data') {
          res.statusCode = 404
          res.end()
          return
        }
        // Block Vite internal fs exposure
        if (pathname.startsWith('/@fs/')) {
          res.statusCode = 403
          res.end()
          return
        }

        // Same-origin gate shared by /__data/* and /api/tmdb (CSRF protection).
        // Browsers always send Origin or Sec-Fetch-Site; headerless clients
        // (curl) are allowed in dev only — preview mode is strict.
        const checkSameOrigin = (): boolean => {
          const origin = req.headers.origin as string | undefined
          const host = req.headers.host as string | undefined
          const secFetchSite = req.headers['sec-fetch-site'] as string | undefined
          if (origin && host) {
            try {
              return new URL(origin).host === host
            } catch {
              return false
            }
          }
          if (secFetchSite) return secFetchSite === 'same-origin'
          return !strictOriginChecks
        }

        // Enforce same-origin for __data endpoints (CSRF protection).
        // Applies to reads too: db-export dumps the whole library, so a
        // cross-site top-level navigation must not be able to pull it.
        const isDataEndpoint = pathname.startsWith('/__data/')
        if (isDataEndpoint) {
          if (!checkSameOrigin()) {
            res.statusCode = 403
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Forbidden origin' }))
            return
          }
        }

        // 1. Proxy TMDb requests securely with allowlist, sanitization, timeout, bounded cache
        if (pathname === '/api/tmdb' || pathname.startsWith('/api/tmdb/')) {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.statusCode = 405
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Method not allowed' }))
            return
          }
          if (!checkSameOrigin()) {
            res.statusCode = 403
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Forbidden origin' }))
            return
          }
          // Rate limit before any work — socket IP only (X-Forwarded-For is spoofable)
          const ip = (req.socket as unknown as { remoteAddress?: string })?.remoteAddress || 'local'
          if (isTmdbRateLimited(ip)) {
            res.statusCode = 429
            res.setHeader('Content-Type', 'application/json')
            res.setHeader('Retry-After', '10')
            res.end(JSON.stringify({ error: 'Too many requests — please retry after 10s' }))
            return
          }
          try {
            const subpathRaw = rawUrl.slice('/api/tmdb'.length) || '/'
            if (!isAllowedTmdbPath(subpathRaw)) {
              res.statusCode = 403
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'TMDb endpoint not allowed' }))
              return
            }
            if (subpathRaw.length > 800) {
              res.statusCode = 414
              res.end(JSON.stringify({ error: 'URI too long' }))
              return
            }
            const subpath = sanitizeSubpath(subpathRaw)
            // Allowlist query keys server-side too — the client allowlist is
            // bypassable with a direct fetch to the proxy.
            try {
              const qu = new URL(TMDB_BASE + subpath)
              for (const k of qu.searchParams.keys()) {
                const v = qu.searchParams.get(k) ?? ''
                if (!ALLOWED_TMDB_QUERY_KEYS.has(k) || v.length > 500) {
                  res.statusCode = 403
                  res.setHeader('Content-Type', 'application/json')
                  res.end(JSON.stringify({ error: 'Query parameter not allowed' }))
                  return
                }
              }
            } catch {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'Bad request' }))
              return
            }
            const cached = tmdbCache.get(subpath)
            if (cached && cached.expires > Date.now()) {
              res.statusCode = cached.status
              res.setHeader('Content-Type', cached.contentType)
              res.setHeader('X-Cache', 'HIT')
              res.setHeader('Cache-Control', 'public, max-age=60')
              if (req.method === 'HEAD') {
                res.setHeader('Content-Length', String(Buffer.byteLength(cached.body)))
                res.end()
              } else {
                res.end(cached.body)
              }
              return
            }
            if (cached && cached.expires <= Date.now()) tmdbCache.delete(subpath)

            let key: string
            try {
              key = getTmdbApiKey()
            } catch {
              res.statusCode = 503
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'Service unavailable' }))
              return
            }
            const isV4 = key.startsWith('eyJ') && key.split('.').length === 3
            // Build target via URL to avoid double api_key and handle encoding — TMDB_BASE is https://api.themoviedb.org/3
            let targetUrl: string
            try {
              const u = new URL(TMDB_BASE + subpath)
              if (!isV4) u.searchParams.set('api_key', key)
              targetUrl = u.toString()
            } catch {
              targetUrl = isV4 ? `${TMDB_BASE}${subpath}` : `${TMDB_BASE}${subpath}${subpath.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(key)}`
            }

            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 10000)
            let upstreamRes: Response
            try {
              upstreamRes = await fetch(targetUrl, {
                headers: isV4 ? { Authorization: `Bearer ${key}` } : undefined,
                signal: controller.signal,
              })
            } finally {
              clearTimeout(timeout)
            }

            const status = upstreamRes.status
            const rawContentType = upstreamRes.headers.get('content-type') || 'application/json'
            const contentType = rawContentType.includes('application/json') ? 'application/json' : 'application/json'
            // Bound upstream bodies to 1MB by bytes (not UTF-16 length), with a
            // content-length pre-check — larger payloads are rejected, never
            // truncated-and-cached (a truncated body would poison the cache).
            const declared = Number(upstreamRes.headers.get('content-length') ?? 0)
            if (Number.isFinite(declared) && declared > 1024 * 1024) {
              res.statusCode = 502
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'Upstream response too large' }))
              return
            }
            const text = await upstreamRes.text()
            if (Buffer.byteLength(text) > 1024 * 1024) {
              res.statusCode = 502
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'Upstream response too large' }))
              return
            }
            const body = text

            if (req.method !== 'HEAD' && upstreamRes.ok && contentType === 'application/json' && status === 200) {
              tmdbCache.set(subpath, { status, contentType, body, expires: Date.now() + CACHE_TTL_MS })
              evictIfNeeded(tmdbCache)
            }

            res.statusCode = status
            res.setHeader('Content-Type', contentType)
            res.setHeader('X-Cache', 'MISS')
            res.setHeader('Cache-Control', status === 200 ? 'public, max-age=60' : 'no-store')
            if (req.method === 'HEAD') {
              res.setHeader('Content-Length', String(Buffer.byteLength(body)))
              res.end()
            } else {
              res.end(body)
            }
            return
          } catch (err) {
            const isAbort = (err as Error).name === 'AbortError'
            server.config.logger.warn(`[cinetrack-tmdb-proxy] ${isAbort ? 'timeout' : (err as Error).message}`)
            res.statusCode = isAbort ? 504 : 502
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: isAbort ? 'TMDb upstream timeout' : 'Failed to contact TMDb upstream' }))
            return
          }
        }

        // 2. Library endpoints
        if (pathname === '/__data/library') {
          try {
            if (req.method === 'GET') {
              const db = await openDb()
              const out: Record<string, unknown> = {}
              const stmt = db.prepare('SELECT key, json FROM library')
              while (stmt.step()) {
                const [key, json] = stmt.get() as [string, string]
                try {
                  // Validate key shape to prevent prototype pollution
                  if (typeof key !== 'string' || !/^(movie|tv):\d+$/.test(key)) continue
                  if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
                  out[key] = JSON.parse(json)
                } catch {
                  /* skip malformed */
                }
              }
              stmt.free()
              db.close()
              res.setHeader('Content-Type', 'application/json')
              res.setHeader('Cache-Control', 'no-store')
              res.end(JSON.stringify(out))
              return
            }

            if (req.method === 'POST') {
              const buf = await readBodyWithLimit(req, MAX_BODY_BYTES).catch((e) => {
                if ((e as Error).message === 'PAYLOAD_TOO_LARGE') throw e
                throw e
              })
              let map: Record<string, any>
              try {
                map = JSON.parse(buf.toString('utf8') || '{}') as Record<string, any>
              } catch {
                res.statusCode = 400
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ error: 'Invalid JSON' }))
                return
              }
              if (typeof map !== 'object' || map === null || Array.isArray(map)) {
                res.statusCode = 400
                res.end(JSON.stringify({ error: 'Expected object' }))
                return
              }
              if (Object.keys(map).length > 5000) {
                res.statusCode = 413
                res.end(JSON.stringify({ error: 'Too many entries' }))
                return
              }

              await queueWrite(async () => {
                const db = await openDb()
                try {
                  db.run('BEGIN IMMEDIATE')
                  db.run('DELETE FROM library')
                  const stmt = db.prepare(`
                    INSERT INTO library (
                      key, media_type, id, title, year, poster, backdrop, rating,
                      status, favorite, added_at, watched_at, runtime, total_episodes,
                      episodes, rewatches, note, json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  `)
                  for (const [key, val] of Object.entries(map)) {
                    if (typeof key !== 'string' || !/^(movie|tv):\d+$/.test(key)) continue
                    if (key === '__proto__' || key === 'constructor') continue
                    if (!val || typeof val !== 'object') continue
                    stmt.run([
                      key,
                      val.mediaType ?? null,
                      val.id ?? null,
                      typeof val.title === 'string' ? val.title.slice(0, 200) : '',
                      typeof val.year === 'string' ? val.year.slice(0, 4) : null,
                      typeof val.poster === 'string' ? val.poster.slice(0, 500) : null,
                      typeof val.backdrop === 'string' ? val.backdrop.slice(0, 500) : null,
                      typeof val.rating === 'number' && val.rating >= 1 && val.rating <= 10 ? val.rating : null,
                      ['planned', 'watching', 'watched', 'dropped'].includes(val.status) ? val.status : 'planned',
                      val.favorite ? 1 : 0,
                      typeof val.addedAt === 'number' ? val.addedAt : Date.now(),
                      typeof val.watchedAt === 'number' ? val.watchedAt : null,
                      typeof val.runtime === 'number' && Number.isFinite(val.runtime) ? Math.min(600, Math.max(0, Math.floor(val.runtime))) : null,
                      typeof val.totalEpisodes === 'number' && Number.isFinite(val.totalEpisodes) ? Math.min(10000, Math.max(0, Math.floor(val.totalEpisodes))) : null,
                      JSON.stringify(val.episodes && typeof val.episodes === 'object' ? val.episodes : {}),
                      JSON.stringify(Array.isArray(val.rewatches) ? val.rewatches.slice(0, 500) : []),
                      typeof val.note === 'string' ? val.note.slice(0, 2000) : null,
                      JSON.stringify(val),
                    ])
                  }
                  stmt.free()
                  db.run('COMMIT')
                  persist(db)
                } catch (e) {
                  try {
                    db.run('ROLLBACK')
                  } catch {}
                  throw e
                } finally {
                  db.close()
                }
              })

              res.statusCode = 204
              res.end()
              return
            }

            res.statusCode = 405
            res.end()
            return
          } catch (err) {
            if ((err as Error).message === 'PAYLOAD_TOO_LARGE') {
              res.statusCode = 413
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'Payload too large' }))
              return
            }
            server.config.logger.warn(`[cinetrack-sqlite] library: ${(err as Error).message}`)
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Internal error' }))
            return
          }
        }

        // 3. Settings endpoints
        if (pathname === '/__data/settings') {
          try {
            if (req.method === 'GET') {
              const db = await openDb()
              const out: Record<string, any> = {}
              const stmt = db.prepare('SELECT key, value FROM settings')
              while (stmt.step()) {
                const [k, v] = stmt.get() as [string, string]
                try {
                  if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue
                  out[k] = JSON.parse(v)
                } catch {
                  out[k] = v
                }
              }
              stmt.free()
              db.close()
              res.setHeader('Content-Type', 'application/json')
              res.setHeader('Cache-Control', 'no-store')
              res.end(JSON.stringify(out))
              return
            }

            if (req.method === 'POST') {
              const buf = await readBodyWithLimit(req, MAX_BODY_BYTES_SETTINGS)
              let settingsMap: Record<string, any>
              try {
                settingsMap = JSON.parse(buf.toString('utf8') || '{}') as Record<string, any>
              } catch {
                res.statusCode = 400
                res.end(JSON.stringify({ error: 'Invalid JSON' }))
                return
              }
              if (typeof settingsMap !== 'object' || settingsMap === null || Array.isArray(settingsMap)) {
                res.statusCode = 400
                res.end(JSON.stringify({ error: 'Expected object' }))
                return
              }

              await queueWrite(async () => {
                const db = await openDb()
                try {
                  db.run('BEGIN IMMEDIATE')
                  db.run('DELETE FROM settings')
                  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
                  for (const [k, v] of Object.entries(settingsMap)) {
                    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue
                    if (typeof k !== 'string' || k.length > 100) continue
                    const serialized = JSON.stringify(v)
                    if (serialized.length > 10000) continue
                    stmt.run([k, serialized])
                  }
                  stmt.free()
                  db.run('COMMIT')
                  persist(db)
                } catch (e) {
                  try {
                    db.run('ROLLBACK')
                  } catch {}
                  throw e
                } finally {
                  db.close()
                }
              })
              res.statusCode = 204
              res.end()
              return
            }

            res.statusCode = 405
            res.end()
            return
          } catch (err) {
            if ((err as Error).message === 'PAYLOAD_TOO_LARGE') {
              res.statusCode = 413
              res.end(JSON.stringify({ error: 'Payload too large' }))
              return
            }
            server.config.logger.warn(`[cinetrack-sqlite] settings: ${(err as Error).message}`)
            res.statusCode = 500
            res.end(JSON.stringify({ error: 'Internal error' }))
            return
          }
        }

        // 4. Raw DB export endpoint
        if (pathname === '/__data/db-export' && (req.method === 'GET' || req.method === 'HEAD')) {
          try {
            if (!fs.existsSync(DB_PATH)) {
              const initDb = await openDb()
              persist(initDb)
              initDb.close()
            }
            // Copy to a uniquely-named tmp to avoid torn reads and concurrent-export races.
            const tmpExport = `${DB_PATH}.export.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`
            try {
              fs.copyFileSync(DB_PATH, tmpExport)
            } catch {}
            const stat = fs.statSync(fs.existsSync(tmpExport) ? tmpExport : DB_PATH)
            res.setHeader('Content-Type', 'application/vnd.sqlite3')
            res.setHeader('Content-Disposition', 'attachment; filename="cinetrack.db"')
            res.setHeader('Content-Length', String(stat.size))
            res.setHeader('Cache-Control', 'private, no-store')
            if (req.method === 'HEAD') {
              try { if (fs.existsSync(tmpExport)) fs.unlinkSync(tmpExport) } catch {}
              res.end()
              return
            }
            const stream = fs.createReadStream(fs.existsSync(tmpExport) ? tmpExport : DB_PATH)
            stream.on('error', (e) => {
              server.config.logger.warn(`[cinetrack-sqlite] export stream: ${(e as Error).message}`)
              if (!res.headersSent) {
                res.statusCode = 500
                res.end(JSON.stringify({ error: 'Export failed' }))
              } else {
                res.destroy()
              }
            })
            stream.on('close', () => {
              try { if (fs.existsSync(tmpExport)) fs.unlinkSync(tmpExport) } catch {}
            })
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;(stream as any).pipe(res)
            return
          } catch (err) {
            server.config.logger.warn(`[cinetrack-sqlite] export: ${(err as Error).message}`)
            res.statusCode = 500
            res.end(JSON.stringify({ error: 'Export failed' }))
            return
          }
        }

        return next()
      })
  }

  return {
    name: 'cinetrack-sqlite-persistence',
    async configureServer(server) {
      await attachHandlers(server)
    },
    async configurePreviewServer(server) {
      await attachHandlers(
        server as unknown as { config: { logger: { warn: (m: string) => void } }; middlewares: { use: (fn: any) => void } },
        true,
      )
    },
  }
}
