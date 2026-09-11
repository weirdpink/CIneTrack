import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { type MediaType, type TmdbTitle } from '../lib/tmdb'
import { lastActivityAt, useLibrary, type Entry, type Status } from '../lib/library'
import { useSettings } from '../lib/settings'
import { Chip, Empty, Poster, PosterGrid, SearchInput, SectionHead, STATUS_INACTIVE, STATUS_STYLE } from './ui'

type Tab = 'all' | 'movie' | 'tv' | 'favorites'
const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'movie', label: 'Movies' },
  { id: 'tv', label: 'TV' },
  { id: 'favorites', label: 'Favourites' },
]

const FILTERS: (Status | 'all')[] = ['all', 'watching', 'planned', 'watched', 'dropped']
const SORTS = [
  { id: 'added', label: 'Recently added' },
  { id: 'lastWatched', label: 'Last watched' },
  { id: 'title', label: 'A–Z' },
  { id: 'rating', label: 'My rating' },
  { id: 'year', label: 'Year' },
] as const
const RATING_OPTIONS = [
  { id: 0, label: 'Any' },
  { id: 7, label: '7+' },
  { id: 8, label: '8+' },
  { id: 9, label: '9+' },
] as const

export type ShelfSort = (typeof SORTS)[number]['id']

export function applyShelfFilters(
  pool: Entry[],
  opts: { status: Status | 'all'; minRating: number; query: string; sort: ShelfSort },
): Entry[] {
  let list = pool
  if (opts.status !== 'all') list = list.filter((e) => e.status === opts.status)
  if (opts.minRating > 0) list = list.filter((e) => (e.rating ?? -1) >= opts.minRating)
  const trimmed = opts.query.trim().toLowerCase()
  if (trimmed) {
    list = list.filter((e) => e.title.toLowerCase().includes(trimmed))
  }
  const sorted = [...list]
  sorted.sort((a, b) => {
    if (opts.sort === 'title') return a.title.localeCompare(b.title)
    if (opts.sort === 'rating') return (b.rating ?? -1) - (a.rating ?? -1)
    if (opts.sort === 'year') return (Number(b.year) || 0) - (Number(a.year) || 0)
    if (opts.sort === 'lastWatched') return (lastActivityAt(b) ?? -1) - (lastActivityAt(a) ?? -1)
    return b.addedAt - a.addedAt
  })
  return sorted
}

export default function Library({
  onOpen,
}: {
  onOpen: (t: MediaType, id: number, seed?: TmdbTitle) => void
}) {
  const { entries, get } = useLibrary()
  const { settings } = useSettings()
  const [tab, setTab] = useState<Tab>(settings.defaultShelfTab)
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all')
  const [sort, setSort] = useState<(typeof SORTS)[number]['id']>(settings.defaultSort)
  const [minRating, setMinRating] = useState<(typeof RATING_OPTIONS)[number]['id']>(0)
  const [q, setQ] = useState('')

  const pool = useMemo(() => {
    if (tab === 'favorites') return entries.filter((e) => e.favorite)
    if (tab === 'movie') return entries.filter((e) => e.mediaType === 'movie')
    if (tab === 'tv') return entries.filter((e) => e.mediaType === 'tv')
    return entries
  }, [entries, tab])

  const deferredQ = useDeferredValue(q)
  const shown = useMemo(
    () => applyShelfFilters(pool, { status: filter, minRating, query: deferredQ, sort }),
    [pool, filter, minRating, deferredQ, sort],
  )

  const [page, setPage] = useState(1)
  const PAGE_SIZE = 48
  const paged = useMemo(() => shown.slice(0, page * PAGE_SIZE), [shown, page])
  useEffect(() => setPage(1), [tab, filter, minRating, deferredQ, sort])

  return (
    <div className="space-y-8">
      <SectionHead
        title="Library"
        note="Your complete collection of movies and series, with personal ratings and viewing state."
        right={
          <div className="flex flex-wrap items-center justify-end gap-3">
            <FilterBar
              filter={filter}
              sort={sort}
              minRating={minRating}
              count={shown.length}
              onFilter={setFilter}
              onSort={setSort}
              onMinRating={setMinRating}
            />
            <SearchInput value={q} onChange={setQ} className="w-56 md:w-72" />
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <Chip
            key={t.id}
            active={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </Chip>
        ))}
      </div>

      {entries.length === 0 ? (
        <div className="space-y-3 text-center">
          <Empty>No titles on this shelf yet</Empty>
          <a
            href="#discover"
            className="press inline-block font-sans text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground underline underline-offset-4 hover:text-[var(--primary)]"
          >
            Find something in Discover
          </a>
        </div>
      ) : shown.length === 0 ? (
        <div className="space-y-3">
          <Empty>No matches for current filters</Empty>
          <button
            onClick={() => {
              setFilter('all')
              setSort(settings.defaultSort)
              setMinRating(0)
              setQ('')
            }}
            className="press font-sans text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground underline underline-offset-4 hover:text-[var(--primary)]"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <>
          <PosterGrid columns={settings.libraryColumns}>
            {paged.map((e) => (
              <Poster
                key={`${e.mediaType}-${e.id}`}
                item={
                  {
                    id: e.id,
                    media_type: e.mediaType,
                    title: e.title,
                    poster_path: e.poster,
                    backdrop_path: e.backdrop,
                    overview: '',
                    vote_average: 0,
                    release_date: e.year,
                  } as TmdbTitle
                }
                entry={get(e.mediaType, e.id)}
                onOpen={onOpen}
              />
            ))}
          </PosterGrid>
          {paged.length < shown.length && (
            <div className="flex justify-center pt-6">
              <button
                onClick={() => setPage((p) => p + 1)}
                className="press border border-border bg-card px-6 py-2 font-sans text-[11px] font-medium uppercase tracking-[0.12em] hover:border-[var(--foreground)] hover:bg-background"
                aria-label={`Load more, ${shown.length - paged.length} remaining`}
              >
                Load more · {paged.length} of {shown.length}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** Collapses filter / sort controls into a single popover button. */
function FilterBar({
  filter,
  sort,
  minRating,
  count,
  onFilter,
  onSort,
  onMinRating,
}: {
  filter: (typeof FILTERS)[number]
  sort: (typeof SORTS)[number]['id']
  minRating: (typeof RATING_OPTIONS)[number]['id']
  count: number
  onFilter: (v: (typeof FILTERS)[number]) => void
  onSort: (v: (typeof SORTS)[number]['id']) => void
  onMinRating: (v: (typeof RATING_OPTIONS)[number]['id']) => void
}) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const { settings } = useSettings()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const active = filter !== 'all' || sort !== settings.defaultSort || minRating > 0
  const activeCount = (filter !== 'all' ? 1 : 0) + (sort !== settings.defaultSort ? 1 : 0) + (minRating > 0 ? 1 : 0)
  const sortLabel = SORTS.find((s) => s.id === sort)?.label

  return (
    <div className="relative z-20 shrink-0" ref={wrap}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Filter shelf${activeCount ? `, ${activeCount} active` : ''}`}
        className={`press relative flex h-9 items-center justify-center border px-4 font-sans text-[11px] font-medium uppercase tracking-[0.14em] transition-colors duration-200 ${
          open || active
            ? 'border-[var(--primary)] bg-card text-[var(--primary)]'
            : 'border-border bg-background text-muted-foreground hover:border-[var(--foreground)] hover:text-foreground'
        }`}
      >
        <span>Filter</span>
        {activeCount > 0 && (
          <span className="absolute -right-2 -top-2 flex h-[18px] min-w-[18px] items-center justify-center border border-[var(--primary)] bg-[var(--primary)] px-1 font-mono text-[10px] font-bold leading-none text-primary-foreground">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="quiet-scroll animate-[ct-tick_180ms_var(--ease-sheet)_both] absolute right-0 top-[calc(100%+6px)] z-50 max-h-[min(70vh,520px)] w-[300px] origin-top-right overflow-y-auto border border-border bg-background p-4 shadow-[0_12px_40px_rgba(0,0,0,0.22)]">
          <div className="rule-label mb-3 border-b border-border pb-2">
            {count} shown · sorted by {sortLabel}
          </div>
          <FilterGroup label="Status">
            {FILTERS.map((f) => {
              const isActive = filter === f
              const isStatus = f !== 'all'
              const statusKey = f as import('../lib/library').Status
              const activeStyle = isStatus ? STATUS_STYLE[statusKey] : 'border-[var(--primary)] bg-[var(--primary)] text-primary-foreground'
              const inactiveStyle = isStatus
                ? STATUS_INACTIVE[statusKey]
                : 'border-border text-muted-foreground hover:border-[var(--foreground)] hover:text-foreground'
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => onFilter(f)}
                  className={`press shrink-0 whitespace-nowrap border px-3 py-1.5 font-sans text-[11px] font-medium uppercase tracking-[0.14em] ${isActive ? activeStyle : inactiveStyle}`}
                >
                  {f}
                </button>
              )
            })}
          </FilterGroup>
          <FilterGroup label="Order">
            {SORTS.map((s) => (
              <Chip key={s.id} active={sort === s.id} onClick={() => onSort(s.id)}>
                {s.label}
              </Chip>
            ))}
          </FilterGroup>
          <FilterGroup label="Minimum rating">
            {RATING_OPTIONS.map((r) => (
              <Chip key={r.id} active={minRating === r.id} onClick={() => onMinRating(r.id)}>
                {r.label}
              </Chip>
            ))}
          </FilterGroup>
          {active && (
            <button
              onClick={() => {
                onFilter('all')
                onSort(settings.defaultSort)
                onMinRating(0)
              }}
              className="press mt-1 font-sans text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground underline underline-offset-4 hover:text-[var(--primary)]"
            >
              Reset filters
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-2">
      <div className="rule-label mb-2">{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}
