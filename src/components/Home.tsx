import { Suspense, lazy, useMemo, useState } from 'react'
import { img, type MediaType, type TmdbTitle } from '../lib/tmdb'
import { formatDayMonth, formatRelativeDay, minutesWatched, progress, recentCompletions, useLibrary, watchedCount } from '../lib/library'
import { useSettings } from '../lib/settings'
import { Empty, SectionHead, Stat } from './ui'

const MonthlyChart = lazy(() => import('./MonthlyChart'))

export default function Home({ onOpen }: { onOpen: (t: MediaType, id: number, seed?: TmdbTitle) => void }) {
  const { entries } = useLibrary()
  const { settings } = useSettings()

  const stats = useMemo(() => {
    const movies = entries.filter((e) => e.mediaType === 'movie')
    const shows = entries.filter((e) => e.mediaType === 'tv')
    const moviesSeen = movies.filter((m) => m.status === 'watched' || m.watchedAt).length
    const showsSeen = shows.filter((s) => s.status === 'watched').length
    const eps = shows.reduce((s, e) => s + watchedCount(e), 0)
    const mins = minutesWatched(entries)
    const rated = entries.filter((e) => e.rating)
    return {
      total: entries.length,
      moviesSeen,
      moviesTotal: movies.length,
      showsSeen,
      showsTotal: shows.length,
      episodes: eps,
      hours: Math.round(mins / 60),
      days: (mins / 1440).toFixed(1),
      avg: rated.length ? (rated.reduce((s, e) => s + (e.rating ?? 0), 0) / rated.length).toFixed(1) : '—',
      inProgress: entries.filter((e) => e.status === 'watching'),
      planned: entries.filter((e) => e.status === 'planned'),
    }
  }, [entries])

  const activity = useMemo(() => recentCompletions(entries, 7), [entries])
  const hasData = entries.length > 0

  const [shuffleKey, setShuffleKey] = useState(0)
  const suggestions = useMemo(() => {
    if (stats.planned.length === 0) return []
    const arr = [...stats.planned]
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr.slice(0, 3)
  }, [stats.planned, shuffleKey])

  return (
    <div className="space-y-16">
      <section>
        <div className="border-b border-border pb-6">
          <p className="animate-fade rule-label">Personal moving-image archive · Est. {new Date().getFullYear()}</p>
          {/* Masthead sets in two beats: roman first, then the italic. */}
          <h1 className="mt-3 max-w-[14ch] font-display text-[clamp(48px,7vw,92px)] leading-[0.95] tracking-tight">
            <MastheadName name={settings.archiveName} />
          </h1>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Titles held" value={stats.total} />
          <Stat label="Movies seen" value={stats.moviesSeen} unit={`/ ${stats.moviesTotal}`} />
          <Stat label="Shows seen" value={stats.showsSeen} unit={`/ ${stats.showsTotal}`} />
          <Stat label="Episodes logged" value={stats.episodes} />
          <Stat label="Time in seat" value={stats.hours} unit="hrs" />
        </div>
      </section>

      <section>
        <SectionHead title="Currently in progress" note="Series and movies left mid-viewing." rule={false} />
        {stats.inProgress.length === 0 ? (
          <Empty>Nothing underway — visit Discover to begin a title</Empty>
        ) : (
          <div className="grid gap-px border border-border bg-border md:grid-cols-2">
            {stats.inProgress.slice(0, 2).map((e, i) => (
              <button
                key={`${e.mediaType}-${e.id}`}
                onClick={() => onOpen(e.mediaType, e.id)}
                style={{ animationDelay: `${i * 55}ms` }}
                className={`group animate-rise flex items-center gap-4 bg-background p-4 text-left transition-colors duration-300 hover:bg-card ${
                  stats.inProgress.length === 1 ? 'md:col-span-2' : ''
                }`}
              >
                {img(e.poster, 'w185') && (
                  <img
                    src={img(e.poster, 'w185')!}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    width={64}
                    height={96}
                    className="h-24 w-16 shrink-0 border border-border object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-[21px] leading-tight group-hover:text-[var(--primary)]">
                    {e.title}
                  </span>
                  <span className="rule-label">
                    {e.mediaType === 'tv'
                      ? `${watchedCount(e)} of ${e.totalEpisodes ?? '?'} episodes`
                      : 'Movie · in progress'}
                  </span>
                  {e.mediaType === 'tv' && (
                    <span className="mt-2 block h-[3px] w-full bg-secondary">
                      <span
                        className="animate-grow block h-full bg-[var(--primary)] transition-[width] duration-500 ease-out"
                        style={{ width: `${progress(e) * 100}%` }}
                      />
                    </span>
                  )}
                </span>
                {e.mediaType === 'tv' && (
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {Math.round(progress(e) * 100)}%
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-12 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <SectionHead title="Recently watched" note="A running ledger of the last entries marked seen." rule={false} />
          {activity.length === 0 ? (
            <Empty>No viewings recorded</Empty>
          ) : (
            <ol className="divide-y divide-border border-y border-border">
              {activity.map((a, i) => (
                <li key={`${a.entry.id}-${a.at}-${i}`} className="animate-rise" style={{ animationDelay: `${i * 40}ms` }}>
                  <button
                    onClick={() => onOpen(a.entry.mediaType, a.entry.id)}
                    className="group flex w-full items-baseline gap-4 py-3 text-left transition-colors duration-200 hover:text-[var(--primary)]"
                  >
                    <span className="w-16 shrink-0 font-mono text-[10px] tabular-nums text-[var(--accent)]">{a.label}</span>
                    <span className="min-w-0 flex-1 truncate font-display text-[19px] transition-transform duration-300 group-hover:translate-x-1">
                      {a.entry.title}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                      {settings.dateStyle === 'relative' ? formatRelativeDay(a.at) : formatDayMonth(a.at)}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="flex flex-col">
          <SectionHead
            title="Feeling lucky?"
            note="Three random picks from your shelf."
            rule={false}
            right={
              stats.planned.length > 3 ? (
                <button
                  onClick={() => setShuffleKey((k) => k + 1)}
                  className="press inline-flex items-center gap-1.5 border border-border px-3 py-1.5 font-sans text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground hover:border-[var(--foreground)] hover:text-foreground"
                >
                  <span aria-hidden className="text-[13px] leading-none">↻</span> Shuffle
                </button>
              ) : undefined
            }
          />
          {stats.planned.length === 0 ? (
            <Empty>
              Watchlist empty —{' '}
              <a href="#discover" className="underline underline-offset-4 hover:text-[var(--primary)]">
                add titles from Discover
              </a>
            </Empty>
          ) : (
            <div className="space-y-3">
              {suggestions.map((e, i) => (
                <button
                  key={`${e.mediaType}-${e.id}-${shuffleKey}-${i}`}
                  onClick={() => onOpen(e.mediaType, e.id)}
                  style={{ animationDelay: `${i * 60}ms` }}
                  className="group animate-rise flex w-full gap-4 border border-border bg-card p-3 text-left transition-colors duration-300 hover:border-[var(--foreground)] hover:bg-background"
                >
                  <div className="h-[86px] w-[58px] shrink-0 overflow-hidden border border-border bg-muted">
                    {img(e.poster, 'w185') ? (
                      <img src={img(e.poster, 'w185')!} alt="" loading="lazy" decoding="async" width={58} height={87} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center font-display text-[18px] text-muted-foreground">
                        {e.title.slice(0, 1)}
                      </div>
                    )}
                  </div>
                  <span className="min-w-0 flex-1 py-1">
                    <span className="block truncate font-display text-[19px] leading-tight group-hover:text-[var(--primary)]">{e.title}</span>
                    <span className="rule-label mt-1 block">
                      {e.mediaType === 'movie' ? 'Movie' : 'TV'} · {e.year || '—'}
                    </span>
                    <span className="mt-2 inline-flex items-center gap-1 font-sans text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground group-hover:text-[var(--primary)]">
                      View <span aria-hidden>→</span>
                    </span>
                  </span>
                  <span className="hidden shrink-0 self-center font-mono text-[10px] tabular-nums text-muted-foreground sm:block">
                    0{i + 1}
                  </span>
                </button>
              ))}
              <p className="rule-label mt-auto pt-4">
                {stats.planned.length} on the shelf · {suggestions.length} shown
              </p>
            </div>
          )}
        </div>
      </section>

      <Suspense
        fallback={
          <section aria-label="Monthly log loading">
            <SectionHead title="Monthly log" note="Completed titles in each of the trailing twelve months." rule={false} />
            <div className="w-full border border-border bg-card p-4 shimmer" style={{ height: 232 }} />
          </section>
        }
      >
        <MonthlyChart entries={entries} />
      </Suspense>

      {!hasData && (
        <p className="border-t border-border pt-6 text-[13px] leading-relaxed text-muted-foreground">
          Your archive is empty. Head to{' '}
          <a href="#discover" className="font-medium text-foreground underline underline-offset-4 hover:text-[var(--primary)]">
            Discover
          </a>{' '}
          to search TMDb and add your first title — everything is persisted to SQLite (<code>data/cinetrack.db</code>).
        </p>
      )}
    </div>
  )
}

/** Archive masthead: leading words set roman, the closing word italic in the
 *  house accent — the two-beat entrance is preserved for custom names. */
function MastheadName({ name }: { name: string }) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return null
  if (words.length === 1) {
    return (
      <span className="animate-rise inline-block italic text-[var(--primary)] [animation-delay:180ms]">
        {words[0]}
      </span>
    )
  }
  const head = words.slice(0, -1).join(' ')
  const tail = words[words.length - 1]
  return (
    <>
      <span className="animate-rise inline-block [animation-delay:60ms]">{head}</span>{' '}
      <span className="animate-rise inline-block italic text-[var(--primary)] [animation-delay:180ms]">
        {tail}
      </span>
    </>
  )
}
