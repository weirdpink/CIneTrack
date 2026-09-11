import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  discover,
  genreList,
  recommendations,
  searchMulti,
  trending,
  type MediaType,
  type Page,
  type TmdbTitle,
} from '../lib/tmdb'
import { useLibrary } from '../lib/library'
import { useSettings } from '../lib/settings'
import { CarouselNav, Chip, Empty, Poster, PosterGrid, PosterSkeleton, SearchInput, SectionHead } from './ui'

type Mode = 'suggested' | 'trending' | 'movie' | 'tv'

const SORTS = [
  { id: 'popularity.desc', label: 'Popular' },
  { id: 'vote_average.desc', label: 'Top rated' },
  { id: 'primary_release_date.desc', label: 'Newest' },
  { id: 'revenue.desc', label: 'Highest grossing' },
]

type Shelf = { key: string; title: string; note?: string; items: TmdbTitle[] }

/** Deterministic spread pick of genres so shelves vary by library but stay stable per session. */
function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function pickGenres(genres: { id: number; name: string }[], sig: string, n: number) {
  if (genres.length === 0) return []
  const out: { id: number; name: string }[] = []
  const used = new Set<number>()
  const start = hashStr(sig || 'cinetrack') % genres.length
  for (let k = 0; k < genres.length && out.length < n; k++) {
    const g = genres[(start + k * 7) % genres.length]
    if (used.has(g.id)) continue
    used.add(g.id)
    out.push(g)
  }
  return out
}

/** One horizontally scrolling shelf row with step controls. */
function ShelfRow({ shelf, onOpen }: { shelf: Shelf; onOpen: (t: MediaType, id: number, seed?: TmdbTitle) => void }) {
  const { get } = useLibrary()
  const track = useRef<HTMLDivElement>(null)
  const step = (dir: number) => track.current?.scrollBy({ left: dir * 560, behavior: 'smooth' })
  return (
    <section aria-label={shelf.title}>
      <div className="mb-4 flex items-end justify-between gap-4 border-b border-border pb-2">
        <div className="min-w-0">
          <h3 className="font-display truncate text-[22px]">{shelf.title}</h3>
          {shelf.note && <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{shelf.note}</p>}
        </div>
        <CarouselNav
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          prevLabel={`Scroll ${shelf.title} back`}
          nextLabel={`Scroll ${shelf.title} forward`}
        />
      </div>
      <div ref={track} className="quiet-scroll -mx-1 flex snap-x gap-5 overflow-x-auto px-1 pb-2">
        {shelf.items.map((item) => {
          const t: MediaType = (item.media_type ?? 'movie') as MediaType
          return (
            <div key={`${t}-${item.id}`} className="w-36 shrink-0 snap-start sm:w-40">
              <Poster
                item={item}
                entry={get(t, item.id)}
                onOpen={onOpen}
              />
            </div>
          )
        })}
      </div>
    </section>
  )
}

function ShelfSkeleton() {
  return (
    <div className="space-y-10" aria-hidden>
      {[0, 1, 2].map((row) => (
        <div key={row}>
          <div className="mb-4 flex items-end justify-between gap-4 border-b border-border pb-2">
            <div className="min-w-0 space-y-2">
              <div className="shimmer h-6 w-56 bg-muted" />
              <div className="shimmer h-3.5 w-80 bg-muted/60" />
            </div>
            <div className="flex shrink-0 gap-2">
              <div className="h-8 w-8 border border-border bg-muted/30 shimmer" />
              <div className="h-8 w-8 border border-border bg-muted/30 shimmer" />
            </div>
          </div>
          <div className="-mx-1 flex gap-5 overflow-hidden px-1 pb-2">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="w-36 shrink-0 sm:w-40">
                <PosterSkeleton />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function GenrePicker({
  genres,
  selected,
  onSelect,
}: {
  genres: { id: number; name: string }[]
  selected: number | null
  onSelect: (id: number | null) => void
}) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const selectedGenre = genres.find((g) => g.id === selected)

  return (
    <div className="relative z-30 shrink-0" ref={wrap}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Genre filter${selectedGenre ? `: ${selectedGenre.name}` : ''}`}
        className={`press shrink-0 whitespace-nowrap border px-3 py-1.5 font-sans text-[11px] font-medium uppercase tracking-[0.14em] transition-colors duration-200 ${
          selected !== null || open
            ? 'border-[var(--primary)] bg-[var(--primary)] text-primary-foreground font-semibold shadow-xs'
            : 'border-border bg-card/50 text-muted-foreground hover:border-[var(--foreground)] hover:text-foreground'
        }`}
      >
        <span>{selectedGenre ? `Genre: ${selectedGenre.name}` : 'Genre'}</span>
      </button>

      {open && (
        <div className="quiet-scroll animate-[ct-tick_180ms_var(--ease-sheet)_both] absolute right-0 top-[calc(100%+6px)] z-50 max-h-[min(70vh,460px)] w-[320px] max-w-[calc(100vw-32px)] origin-top-right overflow-y-auto border border-border bg-background p-4 shadow-[0_16px_48px_rgba(0,0,0,0.35)] sm:w-[380px]">
          <div className="mb-3 flex items-center justify-between border-b border-border pb-2">
            <span className="rule-label">Filter by genre</span>
            {selected !== null && (
              <button
                type="button"
                onClick={() => {
                  onSelect(null)
                  setOpen(false)
                }}
                className="press font-sans text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground underline underline-offset-4 hover:text-[var(--primary)]"
              >
                Reset
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => {
                onSelect(null)
                setOpen(false)
              }}
              className={`press shrink-0 whitespace-nowrap border px-2.5 py-1.5 font-sans text-[11px] font-medium uppercase tracking-[0.14em] transition-colors ${
                selected === null
                  ? 'border-[var(--primary)] bg-[var(--primary)] text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:border-[var(--foreground)] hover:text-foreground'
              }`}
            >
              All genres
            </button>
            {genres.map((g) => {
              const isSelected = selected === g.id
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => {
                    onSelect(isSelected ? null : g.id)
                    setOpen(false)
                  }}
                  className={`press shrink-0 whitespace-nowrap border px-2.5 py-1.5 font-sans text-[11px] font-medium uppercase tracking-[0.14em] transition-colors ${
                    isSelected
                      ? 'border-[var(--primary)] bg-[var(--primary)] text-primary-foreground'
                      : 'border-border bg-card text-muted-foreground hover:border-[var(--foreground)] hover:text-foreground'
                  }`}
                >
                  {g.name}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default function Discover({ onOpen }: { onOpen: (t: MediaType, id: number, seed?: TmdbTitle) => void }) {
  const { entries, get } = useLibrary()
  const { settings } = useSettings()
  const [mode, setMode] = useState<Mode>('suggested')
  const [sort, setSort] = useState('popularity.desc')
  const [genre, setGenre] = useState<number | null>(null)
  const [genres, setGenres] = useState<{ id: number; name: string }[]>([])
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')

  const [results, setResults] = useState<TmdbTitle[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [shelves, setShelves] = useState<Shelf[]>([])
  const [shelvesLoading, setShelvesLoading] = useState(false)
  const [shelvesError, setShelvesError] = useState<string | null>(null)
  const [shelfRetry, setShelfRetry] = useState(0)

  const type: MediaType = mode === 'tv' ? 'tv' : 'movie'
  const searching = !!debounced
  // For You browses shelf rows; every other view is the infinite grid
  const gridActive = mode !== 'suggested' || searching

  const seedSig = useMemo(
    () =>
      [...entries]
        .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.addedAt - a.addedAt)
        .slice(0, 8)
        .map((e) => `${e.mediaType}:${e.id}`)
        .join(','),
    [entries],
  )
  const seeds = useMemo(
    () =>
      seedSig
        ? seedSig.split(',').map((k) => {
            const [mediaType, idStr] = k.split(':')
            const id = Number(idStr)
            if (!Number.isInteger(id) || id <= 0) return null
            return { id, mediaType: mediaType as MediaType, title: get(mediaType as MediaType, id)?.title ?? '' }
          }).filter(Boolean) as { id: number; mediaType: MediaType; title: string }[]
        : [],
    [seedSig, entries],
  )
  const seedsRef = useRef(seeds)
  useEffect(() => { seedsRef.current = seeds }, [seeds])

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 350)
    return () => clearTimeout(t)
  }, [query])

  // Load genres for movie/tv modes — use live flag to avoid stale set
  useEffect(() => {
    if (mode !== 'movie' && mode !== 'tv') return
    const controller = new AbortController()
    let live = true
    genreList(type, { signal: controller.signal })
      .then((g) => { if (live) setGenres(g) })
      .catch(() => { if (live) setGenres([]) })
    setGenre(null)
    return () => {
      live = false
      controller.abort()
    }
  }, [mode, type, settings.metadataLanguage])

  const shelfToken = useRef(0)

  // For You shelves: per-seed picks + genre exploration + trending, assembled in parallel.
  // Seeds drive the personal rows; genre rows deliberately reach beyond the library.
  useEffect(() => {
    if (gridActive) return
    const controller = new AbortController()
    let live = true
    const token = ++shelfToken.current
    setShelvesLoading(true)
    setShelvesError(null)
    setShelves([])
    const sig = seedSig
    ;(async () => {
      try {
        const topSeeds = seedsRef.current.slice(0, 3)
        const [seedPages, trendItems, movieGenres] = await Promise.all([
          Promise.all(
            topSeeds.map((s) =>
              recommendations(s.mediaType, s.id, 1, { signal: controller.signal }).then(
                (r) => ({ seed: s, items: r.results.map((x) => ({ ...x, media_type: x.media_type ?? s.mediaType })) }),
                () => ({ seed: s, items: [] as TmdbTitle[] }),
              ),
            ),
          ),
          trending('all', 'week', 1, { signal: controller.signal }).then(
            (r) => r.results,
            () => [] as TmdbTitle[],
          ),
          genreList('movie', { signal: controller.signal }).then(
            (g) => g,
            () => [] as { id: number; name: string }[],
          ),
        ])
        if (!live || token !== shelfToken.current) return
        const genrePicks = pickGenres(movieGenres, sig, 3)
        const genreSorts = [
          { id: 'vote_average.desc', label: 'Top rated', gte: 200 },
          { id: 'popularity.desc', label: 'Popular now', gte: 100 },
          { id: 'primary_release_date.desc', label: 'Newest', gte: 50 },
        ]
        const genrePages = await Promise.all(
          genrePicks.map((g, i) =>
            discover('movie', {
              page: 1,
              sort_by: genreSorts[i % genreSorts.length].id,
              with_genres: String(g.id),
              'vote_count.gte': genreSorts[i % genreSorts.length].gte,
            }, { signal: controller.signal }).then(
              (r) => ({ genre: g, sortLabel: genreSorts[i % genreSorts.length].label, items: r.results.map((x) => ({ ...x, media_type: 'movie' as MediaType })) }),
              () => ({ genre: g, sortLabel: '', items: [] as TmdbTitle[] }),
            ),
          ),
        )
        if (!live || token !== shelfToken.current) return
        // First occurrence wins — the same title never repeats across shelves
        const seen = new Set<string>()
        const take = (items: TmdbTitle[], n: number) => {
          const out: TmdbTitle[] = []
          for (const it of items) {
            const k = `${it.media_type}-${it.id}`
            if (seen.has(k)) continue
            seen.add(k)
            out.push(it)
            if (out.length >= n) break
          }
          return out
        }
        const next: Shelf[] = []
        const allSeedItems: TmdbTitle[] = []
        for (const { items } of seedPages) {
          allSeedItems.push(...items)
        }
        const libraryPicked = take(allSeedItems, 20)
        if (libraryPicked.length >= 4) {
          next.push({
            key: 'from-library',
            title: 'From your library',
            items: libraryPicked,
          })
        }
        genrePages.forEach(({ genre, sortLabel, items }) => {
          const picked = take(items, 15)
          if (picked.length >= 4) {
            next.push({
              key: `genre-${genre.id}-${sortLabel}`,
              title: `${sortLabel} ${genre.name}`,
              note: 'Beyond your library — something unlike the usual shelf.',
              items: picked,
            })
          }
        })
        const trendPicked = take(trendItems, 15)
        if (trendPicked.length >= 4) {
          next.push({ key: 'trending-week', title: 'Trending this week', note: 'Across movies and series.', items: trendPicked })
        }
        setShelves(next)
      } catch (e) {
        if (live && token === shelfToken.current) setShelvesError(e instanceof Error ? e.message : 'Failed to load suggestions')
      } finally {
        if (live && token === shelfToken.current) setShelvesLoading(false)
      }
    })()
    return () => {
      live = false
      controller.abort()
    }
  }, [gridActive, seedSig, settings.includeAdult, settings.metadataLanguage, shelfRetry])

  /** One page of whichever feed is active. Suggestions walk the seed list. */
  const fetchPage = useCallback(
    (p: number, signal?: AbortSignal): Promise<Page> => {
      if (searching) return searchMulti(debounced, p, { signal })
      if (mode === 'trending') return trending('all', 'week', p, { signal })
      if (mode === 'suggested') {
        const currentSeeds = seedsRef.current
        if (currentSeeds.length === 0) return trending('all', 'week', p, { signal })
        const seed = currentSeeds[(p - 1) % currentSeeds.length]
        const innerPage = Math.floor((p - 1) / currentSeeds.length) + 1
        return recommendations(seed.mediaType, seed.id, innerPage, { signal }).then((r) => ({
          ...r,
          results: r.results.map((x) => ({ ...x, media_type: x.media_type ?? seed.mediaType })),
          total_pages: r.total_pages,
        }))
      }
      return discover(type, {
        page: p,
        sort_by: mode === 'tv' && sort === 'primary_release_date.desc' ? 'first_air_date.desc' : sort,
        ...(genre ? { with_genres: String(genre) } : {}),
      }, { signal }).then((r) => ({ ...r, results: r.results.map((x) => ({ ...x, media_type: type })) }))
    },
    [searching, debounced, mode, type, sort, genre, settings.includeAdult, settings.metadataLanguage],
  )

  const feedToken = useRef(0)
  const feedControllerRef = useRef<AbortController | null>(null)

  // Reset and load page one when feed identity changes (mode/search/sort/genre/includeAdult)
  // Note: seedsRef is intentionally NOT a dep — adding a library item shouldn't wipe the grid
  // Shelved For You has its own fetch path — the grid stays idle there
  useEffect(() => {
    if (!gridActive) return
    feedControllerRef.current?.abort()
    const controller = new AbortController()
    feedControllerRef.current = controller
    let live = true
    const token = ++feedToken.current
    setLoading(true)
    setError(null)
    setResults([])
    setPage(1)
    setTotalPages(1)
    loadingRef.current = true
    fetchPage(1, controller.signal)
      .then((r) => {
        if (!live || token !== feedToken.current) return
        setResults(r.results)
        setTotalPages(r.total_pages ?? 1)
      })
      .catch((e) => {
        if (live && token === feedToken.current && e instanceof Error && e.message !== 'Request cancelled') setError(e.message)
      })
      .finally(() => {
        if (live && token === feedToken.current) {
          setLoading(false)
          loadingRef.current = false
        }
      })
    return () => {
      live = false
      controller.abort()
    }
  }, [fetchPage, gridActive])

  // Also reset when includeAdult toggles — fetchPage already depends on it, so above effect handles it

  const loadingRef = useRef(loading)
  loadingRef.current = loading

  const loadMoreRef = useRef<() => void>(() => {})
  const loadMore = useCallback(() => {
    if (loadingRef.current || page >= totalPages) return
    loadingRef.current = true
    setLoading(true)
    const next = page + 1
    const token = feedToken.current
      fetchPage(next, feedControllerRef.current?.signal)
      .then((r) => {
        if (token !== feedToken.current) return
        setPage(next)
        setTotalPages(r.total_pages ?? next)
        setResults((prev) => {
          const seen = new Set(prev.map((x) => `${x.media_type}-${x.id}`))
          const filtered = r.results.filter((x) => !seen.has(`${x.media_type}-${x.id}`))
          // Cap at 300 to avoid DOM blowup
          const nextResults = [...prev, ...filtered]
          return nextResults.length > 300 ? nextResults.slice(0, 300) : nextResults
        })
      })
      .catch((e) => {
        if (token === feedToken.current && e instanceof Error && e.message !== 'Request cancelled') setError(e.message)
      })
      .finally(() => {
        if (token === feedToken.current) {
          setLoading(false)
          loadingRef.current = false
        }
      })
  }, [fetchPage, page, totalPages])

  useEffect(() => { loadMoreRef.current = loadMore }, [loadMore])

  // IntersectionObserver with proper re-attach when sentinel changes
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const setSentinel = useCallback((node: HTMLDivElement | null) => {
    sentinelRef.current = node
  }, [])
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !gridActive) return
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) loadMoreRef.current()
    }, { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [results.length, gridActive])

  const exhausted = page >= totalPages && results.length > 0

  return (
    <div className="space-y-8">
      <SectionHead
        title="Discover"
        note="Query the TMDb catalogue, then accession anything worth keeping."
        right={<SearchInput value={query} onChange={setQuery} className="w-56 md:w-72" />}
      />

      <div className="relative z-30 flex flex-wrap items-center justify-between gap-x-4 gap-y-3" role="group" aria-label="Discover modes">
        <div className="flex flex-wrap items-center gap-2">
          {(['suggested', 'trending', 'movie', 'tv'] as Mode[]).map((m) => (
            <Chip
              key={m}
              active={mode === m && !searching}
              onClick={() => {
                setQuery('')
                setDebounced('')
                setMode(m)
              }}
            >
              {m === 'movie' ? 'Movies' : m === 'tv' ? 'TV Shows' : m === 'suggested' ? 'For you' : 'Trending'}
            </Chip>
          ))}
        </div>

        {(mode === 'movie' || mode === 'tv') && !searching && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {SORTS.map((s) => (
              <Chip
                key={s.id}
                active={sort === s.id}
                onClick={() => setSort(s.id)}
              >
                {s.label}
              </Chip>
            ))}
            {genres.length > 0 && (
              <>
                <span className="mx-1 h-3.5 w-px bg-border" aria-hidden />
                <GenrePicker
                  genres={genres}
                  selected={genre}
                  onSelect={(id) => setGenre(id)}
                />
              </>
            )}
          </div>
        )}
      </div>

      {searching && (
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2">
          <h3 className="font-display text-[22px]">{`Search — "${debounced}"`}</h3>
          {loading && <span className="rule-label" aria-live="polite">loading…</span>}
        </div>
      )}
      {!searching && (gridActive ? loading : shelvesLoading) && (
        <span className="rule-label" aria-live="polite">loading…</span>
      )}
      {!gridActive ? (
        <>
          {shelvesError && (
            <div role="alert" className="animate-fade flex items-center justify-between gap-4 border border-[var(--primary)]/20 bg-[var(--primary)]/5 px-4 py-3">
              <p className="font-mono text-[12px] text-[var(--primary)]">{shelvesError}</p>
              <button
                onClick={() => setShelfRetry((n) => n + 1)}
                className="press shrink-0 border border-[var(--primary)] bg-[var(--primary)] px-3 py-1 font-sans text-[11px] font-medium uppercase tracking-[0.12em] text-primary-foreground hover:opacity-90"
              >
                Retry
              </button>
            </div>
          )}
          {shelvesLoading && shelves.length === 0 && !shelvesError && <ShelfSkeleton />}
          {!shelvesLoading && !shelvesError && shelves.length === 0 && (
            <Empty>No suggestions yet — rate something in your library or try Trending</Empty>
          )}
          {shelves.map((s, idx) => (
            <div key={s.key} className="animate-fade" style={{ animationDelay: `${idx * 40}ms` }}>
              <ShelfRow shelf={s} onOpen={onOpen} />
            </div>
          ))}
        </>
      ) : (
        <>
          {error && (
            <div role="alert" className="animate-fade flex items-center justify-between gap-4 border border-[var(--primary)]/20 bg-[var(--primary)]/5 px-4 py-3">
              <p className="font-mono text-[12px] text-[var(--primary)]">{error}</p>
              <button
                onClick={() => {
                  setError(null)
                  setLoading(true)
                  const token = feedToken.current
                  const controller = new AbortController()
                  feedControllerRef.current?.abort()
                  feedControllerRef.current = controller
                  loadingRef.current = true
                  fetchPage(1, controller.signal)
                    .then((r) => {
                      if (token !== feedToken.current) return
                      setResults(r.results)
                      setTotalPages(r.total_pages ?? 1)
                    })
                    .catch((e) => {
                      if (e instanceof Error && e.message !== 'Request cancelled') setError(e.message)
                    })
                    .finally(() => {
                      setLoading(false)
                      loadingRef.current = false
                    })
                }}
                className="press shrink-0 border border-[var(--primary)] bg-[var(--primary)] px-3 py-1 font-sans text-[11px] font-medium uppercase tracking-[0.12em] text-primary-foreground hover:opacity-90"
              >
                Retry
              </button>
            </div>
          )}
          {!loading && !error && results.length === 0 && <Empty>No records match — try a different search or clear filters</Empty>}

          {loading && results.length === 0 && !error && (
            <PosterGrid columns={settings.discoverColumns}>
              {Array.from({ length: (settings.discoverColumns || 6) * 2 }, (_, i) => (
                <PosterSkeleton
                  key={`init-skel-${i}`}
                  compact={settings.density === 'compact'}
                />
              ))}
            </PosterGrid>
          )}

          {results.length > 0 && (
            <PosterGrid columns={settings.discoverColumns}>
              {results.map((item) => {
                const t: MediaType = (item.media_type ?? type) as MediaType
                return (
                  <Poster
                    key={`${t}-${item.id}`}
                    item={item}
                    entry={get(t, item.id)}
                    onOpen={onOpen}
                  />
                )
              })}
              {loading &&
                Array.from({ length: settings.discoverColumns || 6 }, (_, i) => (
                  <PosterSkeleton
                    key={`append-skel-${i}`}
                    compact={settings.density === 'compact'}
                  />
                ))}
            </PosterGrid>
          )}

          <div ref={setSentinel} className="h-px" aria-hidden />

          {loading && results.length > 0 && (
            <div className="flex items-center justify-center gap-3 py-6" aria-live="polite">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--primary)] animate-pulse" />
              <span className="rule-label">Retrieving further records…</span>
            </div>
          )}
          {exhausted && !loading && (
            <p className="animate-fade rule-label border-t border-border py-6 text-center">
              End of catalogue · {results.length} records
            </p>
          )}
        </>
      )}
    </div>
  )
}
