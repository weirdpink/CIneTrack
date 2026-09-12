import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  details,
  img,
  season as fetchSeason,
  titleOf,
  yearOf,
  type Episode,
  type MediaType,
  type SeasonSummary,
  type TitleDetail as Detail,
  type TmdbTitle,
} from '../lib/tmdb'
import {
  epKey,
  fromDateInput,
  toDateInput,
  todayInput,
  useLibrary,
  watchedCount,
  type Entry,
  type Status,
} from '../lib/library'
import { useSettings } from '../lib/settings'
import { CarouselNav, ConfirmDialog, Spinner, STATUS_BADGE, STATUS_INACTIVE, STATUS_STYLE, useBodyScrollLock, useFocusTrap, useTimedTooltip } from './ui'
import { useToast } from './Toast'
import CastDetail from './CastDetail'

const STATUSES: Status[] = ['planned', 'watching', 'watched', 'dropped']
const MAX_AUTO_EPISODES = 20000

function markAllEpisodes(seasons: SeasonSummary[], at: number, seed: Record<string, number> = {}) {
  const marked = { ...seed }
  let count = Object.keys(marked).length
  outer: for (const season of seasons) {
    if (!Number.isInteger(season.season_number) || season.season_number <= 0) continue
    const episodeCount = typeof season.episode_count === 'number' && Number.isSafeInteger(season.episode_count)
      ? Math.min(10000, Math.max(0, season.episode_count))
      : 0
    for (let ep = 1; ep <= episodeCount; ep++) {
      if (count >= MAX_AUTO_EPISODES) break outer
      const key = epKey(season.season_number, ep)
      if (marked[key] == null) {
        marked[key] = at
        count++
      }
    }
  }
  return marked
}

export default function TitleDetail({
  type,
  id,
  seed,
  onClose: requestClose,
  onOpenTitle,
}: {
  type: MediaType
  id: number
  seed?: TmdbTitle
  onClose: () => void
  onOpenTitle?: (t: MediaType, id: number) => void
}) {
  const [data, setData] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [rewatchOpen, setRewatchOpen] = useState(false)
  const [pendingStatus, setPendingStatus] = useState<Status | null>(null)
  const [confirmDeaccession, setConfirmDeaccession] = useState(false)
  const [tvView, setTvView] = useState<'seasons' | 'cast'>('seasons')
  const [personId, setPersonId] = useState<number | null>(null)
  const [panelEl, setPanelEl] = useState<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const closeTimer = useRef<number | null>(null)
  const { toast } = useToast()
  useBodyScrollLock(true)
  useFocusTrap(panelRef)
  const { settings } = useSettings()
  const metadataLanguage = settings.metadataLanguage
  const castTrackRef = useRef<HTMLDivElement>(null)
  const {
    get,
    upsert,
    remove,
    toggleEpisode,
    setSeasonWatched,
    addRewatch,
    setRewatchDate,
    removeRewatch,
  } = useLibrary()
  const entry = get(type, id)

  // Slide the drawer in on mount, out on close.
  const [shown, setShown] = useState(false)
  const onClose = useCallback(() => {
    setShown(false)
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(requestClose, 420) // matches the panel slide-out duration
  }, [requestClose])

  useEffect(
    () => () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current)
    },
    [],
  )

  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const [detailAttempt, setDetailAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let live = true
    setData(null)
    setError(null)
    details(type, id, { signal: controller.signal })
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e.message))
    return () => {
      live = false
      controller.abort()
    }
  }, [type, id, detailAttempt, metadataLanguage])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Keep stored runtime / episode totals fresh once details land if not already set.
  useEffect(() => {
    if (!data || !entry) return
    const runtime = type === 'movie' ? (data.runtime ?? null) : (data.episode_run_time?.[0] ?? null)
    const totalEpisodes = type === 'tv' ? (data.number_of_episodes ?? null) : null
    const patch: Partial<Entry> = {}
    if (entry.runtime == null && runtime != null) patch.runtime = runtime
    if (entry.totalEpisodes == null && totalEpisodes != null) patch.totalEpisodes = totalEpisodes
    if (type === 'tv' && entry.status === 'watched' && watchedCount(entry) === 0 && data.seasons) {
      const at = entry.watchedAt ?? Date.now()
      const episodes = markAllEpisodes(data.seasons, at)
      if (Object.keys(episodes).length > 0) patch.episodes = episodes
    }
    if (Object.keys(patch).length > 0) {
      upsert(type, id, patch)
    }
  }, [data, entry, type, id, upsert])

  const source = data ?? seed ?? (entry ? ({
    id: entry.id,
    media_type: entry.mediaType,
    title: entry.title,
    poster_path: entry.poster,
    backdrop_path: entry.backdrop,
    overview: entry.note || '',
    vote_average: entry.rating || 0,
    release_date: entry.year,
  } as TmdbTitle) : null)
  const cast = data?.credits?.cast ?? []

  const add = (patch: Record<string, unknown> = {}) => {
    const runtime = data ? (type === 'movie' ? (data.runtime ?? null) : (data.episode_run_time?.[0] ?? null)) : null
    upsert(type, id, { runtime, totalEpisodes: type === 'tv' ? (data?.number_of_episodes ?? null) : null, ...patch }, source ?? undefined)
  }

  const rawRuntime = entry?.runtime ?? (type === 'movie' ? (data?.runtime ?? null) : (data?.episode_run_time?.[0] ?? null))
  const formattedRuntime = rawRuntime ? formatRuntime(rawRuntime) : null
  const releaseRaw =
    (data?.release_date ?? data?.first_air_date ?? source?.release_date ?? source?.first_air_date ?? '').trim()
  const releaseLabel = formatReleaseDate(releaseRaw)

  /** Single transition table for status changes (picker + confirms). */
  const applyStatus = (s: Status) => {
    if (!entry) return
    const now = Date.now()
    let episodesPatch: Record<string, number> | undefined
    let watchedAt: number | null | undefined
    if (type === 'tv' && s === 'watched' && data?.seasons) {
      episodesPatch = markAllEpisodes(data.seasons, now, entry.episodes)
    }
    if (s === 'planned' && type === 'tv') {
      // Starting over — clear every logged episode.
      episodesPatch = {}
    }
    watchedAt = s === 'watched' ? (entry.watchedAt ?? now) : null
    upsert(type, id, {
      status: s,
      ...(watchedAt !== undefined ? { watchedAt } : {}),
      ...(episodesPatch ? { episodes: episodesPatch } : {}),
    })
    toast(`Marked as ${STATUS_BADGE[s]?.label ?? s}`, 'info')
  }

  const metaParts: { text: string; isScore?: boolean }[] = source
    ? [
        { text: releaseLabel ?? entry?.year ?? yearOf(source) ?? '—' },
        ...(type === 'movie'
          ? (formattedRuntime ? [{ text: formattedRuntime }] : [])
          : [{ text: `${data?.number_of_episodes ?? entry?.totalEpisodes ?? '—'} EPISODES` }]),
        ...(typeof source.vote_average === 'number' && source.vote_average > 0
          ? [{ text: `TMDb ${source.vote_average.toFixed(1)}`, isScore: true }]
          : []),
      ]
    : []

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-end bg-[rgba(20,19,15,0.42)] transition-opacity duration-300 ${
        shown ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={onClose}
    >
      <div
        ref={(el) => {
          panelRef.current = el
          setPanelEl(el)
        }}
        role="dialog"
        aria-modal="true"
        aria-label={source ? `${entry?.title || titleOf(source)} — catalogue entry` : 'Catalogue entry'}
        className={`relative flex h-full w-full max-w-[920px] flex-col overflow-hidden bg-background shadow-[-30px_0_90px_-30px_rgba(0,0,0,0.5)] transition-transform duration-[420ms] will-change-transform [transition-timing-function:var(--ease-sheet)] ${
          shown ? 'translate-x-0' : 'translate-x-full'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b border-border bg-background px-6 py-3">
          <span className="rule-label">
            Catalogue entry · {type === 'movie' ? 'Movie' : 'Series'} · #{id}
          </span>
          <button
            onClick={onClose}
            className="press flex h-8 w-8 shrink-0 items-center justify-center border border-border text-muted-foreground hover:border-[var(--foreground)] hover:text-foreground"
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="quiet-scroll min-h-0 flex-1 overflow-y-auto">

        {error && !source && (
          <div className="flex min-h-[50vh] flex-col items-center justify-center p-12 text-center animate-fade">
            <span className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--primary)]">
              Failed to load catalogue entry
            </span>
            <p className="max-w-md text-[13px] text-muted-foreground">{error}</p>
            <button
              onClick={() => setDetailAttempt((a) => a + 1)}
              className="press mt-5 border border-border px-5 py-2 font-sans text-[11px] font-medium uppercase tracking-[0.14em] hover:border-[var(--foreground)]"
            >
              Retry
            </button>
          </div>
        )}

        {!source && !data && !error && (
          <div className="flex min-h-[65vh] flex-col items-center justify-center gap-3 animate-fade">
            <Spinner size={38} />
          </div>
        )}

        {source && (
          <div className="animate-fade">
            {error && (
              <div role="alert" className="mx-6 mt-4 flex flex-wrap items-center justify-between gap-3 border border-[var(--primary)]/20 bg-[var(--primary)]/5 px-3 py-2">
                <span className="font-mono text-[11px] text-[var(--primary)]">Latest catalogue details unavailable · {error}</span>
                <button
                  type="button"
                  onClick={() => setDetailAttempt((a) => a + 1)}
                  className="press border border-[var(--primary)] px-3 py-1 font-sans text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--primary)] hover:bg-[var(--primary)] hover:text-primary-foreground"
                >
                  Retry
                </button>
              </div>
            )}
            <div className="grid gap-8 px-6 py-7 lg:grid-cols-[190px_1fr]">
              <div>
                {img(entry?.poster ?? source.poster_path, 'w342') && (
                  <img
                    src={img(entry?.poster ?? source.poster_path, 'w342')!}
                    srcSet={`${img(entry?.poster ?? source.poster_path, 'w185')} 185w, ${img(entry?.poster ?? source.poster_path, 'w342')} 342w, ${img(entry?.poster ?? source.poster_path, 'w500')} 500w`}
                    sizes="(max-width: 1024px) 190px, 190px"
                    alt={`Poster for ${entry?.title || titleOf(source)}`}
                    width={342}
                    height={513}
                    decoding="async"
                    className="animate-plate w-full border border-border bg-muted"
                  />
                )}
              </div>

              <div className="animate-rise flex min-h-[285px] flex-col [animation-delay:80ms]">
                <h1 className="font-display text-[42px] leading-[1.05] tracking-tight">{entry?.title || titleOf(source)}</h1>
                <p className="mt-2 truncate font-mono text-[11px] tracking-[0.14em] text-muted-foreground">
                  {metaParts.map((part, idx) => (
                    <span key={idx}>
                      {idx > 0 && <span className="mx-2 text-border">·</span>}
                      {part.isScore ? (
                        <a
                          href={`https://www.themoviedb.org/${type}/${id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-[var(--primary)] underline decoration-[var(--primary)]/40 underline-offset-[3px] transition-opacity hover:opacity-75"
                          title="View on TMDb"
                        >
                          {part.text}
                        </a>
                      ) : (
                        part.text
                      )}
                    </span>
                  ))}
                </p>
                <p className="mt-4 line-clamp-4 max-w-prose text-[14px] leading-relaxed text-secondary-foreground">
                  {source.overview || 'No synopsis on file.'}
                </p>
                {entry?.note && (
                  <div className="mt-4 border-l-2 border-[var(--primary)] bg-card/60 px-3.5 py-2">
                    <span className="rule-label block text-[10px] text-[var(--primary)]">Personal Note</span>
                    <p className="mt-1 font-serif text-[14px] italic text-foreground leading-relaxed whitespace-pre-wrap">{entry.note}</p>
                  </div>
                )}

                {/* Control row — mirrors the reference: status · rating · date, then actions.
                    mt-auto floats it to the bottom edge of the poster beside it. */}
                <div className="mt-auto flex flex-wrap items-center gap-x-6 gap-y-4 border-t border-border pt-5">
                  {!entry ? (
                    <button
                      onClick={() => add({ status: settings.defaultStatus })}
                      className="press animate-tick flex h-8 items-center gap-2 bg-[var(--primary)] px-5 font-sans text-[11px] font-medium uppercase tracking-[0.16em] text-primary-foreground hover:opacity-85"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      <span>Add to library</span>
                    </button>
                  ) : (
                    <>
                      <div className="flex flex-1 flex-wrap items-center gap-3">
                        <StatusButtons
                          title={entry?.title || titleOf(source)}
                          status={entry.status}
                          mediaType={type}
                          container={panelEl}
                          onChange={(s) => {
                            // Back to Planned wipes the episode log — confirm first.
                            if (s === 'planned' && type === 'tv' && Object.keys(entry.episodes ?? {}).length > 0) {
                              setPendingStatus(s)
                              return
                            }
                            applyStatus(s)
                          }}
                        />
                        <div className="relative group">
                          <button
                            type="button"
                            onClick={() => setEditing(true)}
                            aria-label={entry.rating ? `Rating: ${entry.rating}/10` : 'Rate title'}
                            className={`press flex h-8 w-8 items-center justify-center transition-all ${
                              entry.rating
                                ? 'bg-[var(--accent)] text-accent-foreground font-mono text-[12px] font-medium tabular-nums shadow-xs hover:opacity-90'
                                : 'border border-dashed border-border text-muted-foreground hover:border-[var(--foreground)] hover:text-foreground font-mono text-[12px]'
                            }`}
                          >
                            {entry.rating ?? '—'}
                          </button>
                          <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap border border-border bg-foreground px-2 py-0.5 font-sans text-[10px] font-medium tracking-[0.04em] text-background opacity-0 transition-opacity duration-150 group-hover:opacity-100 z-30 shadow-xs select-none">
                            {entry.rating ? `Rating: ${entry.rating}/10` : 'Rate title'}
                          </span>
                        </div>
                        {entry.watchedAt != null && (
                          <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
                            {new Date(entry.watchedAt).toLocaleDateString('en-GB')}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <IconButton
                          label={entry.favorite ? 'Remove favourite' : 'Mark favourite'}
                          tooltip={entry.favorite ? 'Remove favourite' : 'Mark favourite'}
                          active={entry.favorite}
                          onClick={() => upsert(type, id, { favorite: !entry.favorite })}
                        >
                          <HeartIcon filled={entry.favorite} />
                        </IconButton>
                        <IconButton
                          label="Rewatches"
                          tooltip={entry.rewatches.length > 0 ? `Rewatches (${entry.rewatches.length})` : 'Rewatches'}
                          active={entry.rewatches.length > 0}
                          onClick={() => setRewatchOpen(true)}
                        >
                          <RewatchIcon />
                          {entry.rewatches.length > 0 && (
                            <span className="pointer-events-none absolute -right-1.5 -top-1.5 flex h-[17px] min-w-[17px] items-center justify-center border border-[var(--primary)] bg-[var(--primary)] px-1 font-mono text-[10px] font-bold leading-none text-primary-foreground shadow-xs">
                              {entry.rewatches.length}
                            </span>
                          )}
                        </IconButton>
                        <IconButton
                          label="Edit metadata"
                          tooltip="Edit metadata"
                          active={editing}
                          onClick={() => setEditing((v) => !v)}
                        >
                          <PencilIcon />
                        </IconButton>
                        <IconButton
                          label="Delete"
                          tooltip={null}
                          tone="danger"
                          onClick={() => setConfirmDeaccession(true)}
                        >
                          <TrashIcon />
                        </IconButton>
                      </div>
                    </>
                  )}
                </div>

              </div>
            </div>

            {/* Movies: cast only. Series: Seasons ⇄ Cast toggle, Seasons default. */}
            {type === 'movie' ? (
              <Panel
                title="Cast"
                right={
                  cast.length > 5 ? (
                    <CarouselNav
                      onPrev={() => castTrackRef.current?.scrollBy({ left: -640, behavior: 'smooth' })}
                      onNext={() => castTrackRef.current?.scrollBy({ left: 640, behavior: 'smooth' })}
                      prevLabel="Previous cast"
                      nextLabel="Next cast"
                    />
                  ) : null
                }
              >
                {!data ? (
                  error ? (
                    <div className="flex flex-col items-center gap-3 py-12 text-center">
                      <p className="rule-label">Catalogue data failed to load · {error}</p>
                      <button
                        onClick={() => setDetailAttempt((a) => a + 1)}
                        className="press border border-border px-5 py-2 font-sans text-[11px] font-medium uppercase tracking-[0.14em] hover:border-[var(--foreground)]"
                      >
                        Retry
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-12">
                      <Spinner size={28} />
                    </div>
                  )
                ) : (
                  <CastCarousel cast={cast} trackRef={castTrackRef} onSelect={setPersonId} />
                )}
              </Panel>
            ) : (
              <Panel
                title={tvView === 'seasons' ? 'Seasons' : 'Cast'}
                right={
                  <div className="flex items-center gap-3">
                    {tvView === 'cast' && cast.length > 5 && (
                      <CarouselNav
                        onPrev={() => castTrackRef.current?.scrollBy({ left: -640, behavior: 'smooth' })}
                        onNext={() => castTrackRef.current?.scrollBy({ left: 640, behavior: 'smooth' })}
                        prevLabel="Previous cast"
                        nextLabel="Next cast"
                      />
                    )}
                    <button
                      onClick={() => setTvView((v) => (v === 'seasons' ? 'cast' : 'seasons'))}
                      className="press border border-border px-4 py-1.5 font-sans text-[11px] font-medium uppercase tracking-[0.14em] hover:border-[var(--foreground)] hover:bg-card"
                    >
                      {tvView === 'seasons' ? 'View Cast' : 'View Seasons'}
                    </button>
                  </div>
                }
              >
                {!data ? (
                  error ? (
                    <div className="flex flex-col items-center gap-3 py-12 text-center">
                      <p className="rule-label">Catalogue data failed to load · {error}</p>
                      <button
                        onClick={() => setDetailAttempt((a) => a + 1)}
                        className="press border border-border px-5 py-2 font-sans text-[11px] font-medium uppercase tracking-[0.14em] hover:border-[var(--foreground)]"
                      >
                        Retry
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-12">
                      <Spinner size={28} />
                    </div>
                  )
                ) : tvView === 'cast' ? (
                  <CastCarousel cast={cast} trackRef={castTrackRef} onSelect={setPersonId} />
                ) : data?.seasons ? (
                  <Seasons
                    key={id}
                    showId={id}
                    seasons={data.seasons.filter((s) => s.episode_count > 0)}
                    watched={entry?.episodes ?? {}}
                    tracked={!!entry}
                    onAdd={() => add({ status: 'watching' })}
                    onToggle={(s, e) => toggleEpisode(id, s, e)}
                    onBulk={(s, nums, w) => setSeasonWatched(id, s, nums, w)}
                  />
                ) : null}
              </Panel>
            )}
          </div>
        )}
        </div>

        {entry && editing && (
          <EditModal
            title={entry.title || (source ? titleOf(source) : 'Entry')}
            type={type}
            entry={entry}
            source={source}
            seasons={data?.seasons}
            container={panelEl}
            onClose={() => setEditing(false)}
            onUpsert={(patch) => upsert(type, id, patch)}
          />
        )}

        {entry && rewatchOpen && (
          <RewatchModal
            title={source ? titleOf(source) : 'Entry'}
            entry={entry}
            container={panelEl}
            onClose={() => setRewatchOpen(false)}
            onAddRewatch={(at) => addRewatch(type, id, at)}
            onSetRewatchDate={(i, at) => setRewatchDate(type, id, i, at)}
            onRemoveRewatch={(i) => removeRewatch(type, id, i)}
          />
        )}

        {personId != null && (
          <CastDetail
            personId={personId}
            onClose={() => setPersonId(null)}
            onOpenTitle={(t, i) => onOpenTitle?.(t, i)}
          />
        )}

        <ConfirmDialog
          open={pendingStatus !== null}
          container={panelEl}
          title="Start Over"
          message={
            <>
              Setting <strong className="text-foreground">{source ? titleOf(source) : 'this title'}</strong> back
              to Planned will unmark every logged episode. This cannot be undone.
            </>
          }
          confirmLabel="Clear episodes"
          onCancel={() => setPendingStatus(null)}
          onConfirm={() => {
            if (pendingStatus) applyStatus(pendingStatus)
            setPendingStatus(null)
          }}
        />

        <ConfirmDialog
          open={confirmDeaccession}
          container={panelEl}
          title="Delete Title"
          message={
            <>
              Are you sure you want to delete <strong className="text-foreground">{source ? titleOf(source) : 'this title'}</strong> from your archive? All watch history, ratings, and logged episodes will be permanently removed.
            </>
          }
          confirmLabel="Delete"
          onCancel={() => setConfirmDeaccession(false)}
          onConfirm={() => {
            const name = source ? titleOf(source) : 'Title'
            setConfirmDeaccession(false)
            remove(type, id)
            toast(`Removed ${name} from your library`, 'info')
            onClose()
          }}
        />
      </div>
    </div>
  )
}

/* ---------- shared bits ---------- */

function Panel({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-t border-border px-6 py-7">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <h2 className="font-display text-[26px] leading-none">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  )
}

function IconButton({
  children,
  label,
  tooltip,
  active,
  tone = 'default',
  onClick,
}: {
  children: React.ReactNode
  label: string
  tooltip?: string | null
  active?: boolean
  tone?: 'default' | 'danger'
  onClick: () => void
}) {
  const showTooltip = tooltip !== null
  const tip = tooltip ?? label
  const hoverTip = useTimedTooltip()

  return (
    <div
      className="relative"
      onMouseEnter={hoverTip.show}
      onMouseLeave={hoverTip.scheduleHide}
      onFocus={hoverTip.show}
      onBlur={hoverTip.scheduleHide}
    >
      <button
        type="button"
        onClick={() => {
          hoverTip.hide()
          onClick()
        }}
        aria-label={label}
        aria-pressed={active}
        className={`press relative flex h-9 w-9 items-center justify-center border transition-colors ${
          tone === 'danger'
            ? 'border-[var(--destructive)]/40 bg-[var(--destructive)]/[0.06] text-[var(--destructive)] hover:border-[var(--destructive)] hover:bg-[var(--destructive)] hover:text-[var(--destructive-foreground)]'
            : active
              ? 'border-[var(--primary)] text-[var(--primary)]'
              : 'border-border text-muted-foreground hover:border-[var(--foreground)] hover:text-foreground'
        }`}
      >
        {children}
      </button>
      {showTooltip && (
        <span className={`pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap border border-border bg-foreground px-2 py-0.5 font-sans text-[10px] font-medium tracking-[0.04em] text-background transition-opacity duration-150 z-30 shadow-xs select-none ${hoverTip.visible ? 'opacity-100' : 'opacity-0'}`}>
          {tip}
        </span>
      )}
    </div>
  )
}

/* ---------- icons ---------- */

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}

function HeartIcon({ filled }: { filled?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  )
}

function formatRuntime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}M`
  if (m === 0) return `${h}H`
  return `${h}H ${m}M`
}

/** yyyy-mm-dd (TMDb) → DD/MM/YYYY for ledger microcopy. */
function formatEpisodeDate(raw: string | null): string {
  if (!raw) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw)
  if (!m) return raw
  return `${m[3]}/${m[2]}/${m[1]}`
}

/** yyyy-mm-dd → "09 JUL 2025" to match the mono meta row. Null when unparseable. */
function formatReleaseDate(raw: string | undefined): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}/.test(raw)) return null
  const d = new Date(`${raw.slice(0, 10)}T12:00:00`)
  if (isNaN(d.getTime())) return null
  return d
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    .replace(/,/g, '')
    .toUpperCase()
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

function RewatchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  )
}

/** Horizontally scrolling cast reel with snap controls in panel header. */
function CastCarousel({
  cast,
  trackRef,
  onSelect,
}: {
  cast: { id: number; name: string; character: string; profile_path: string | null }[]
  trackRef?: React.RefObject<HTMLDivElement | null>
  onSelect?: (personId: number) => void
}) {
  const localTrack = useRef<HTMLDivElement>(null)
  const track = trackRef ?? localTrack

  if (cast.length === 0) {
    return (
      <div className="animate-fade border border-dashed border-border px-6 py-12 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        No cast on file
      </div>
    )
  }

  return (
    <div className="relative">
      <div ref={track} className="quiet-scroll -mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-2">
        {cast.map((c, i) => (
          <div
            key={`${c.id}-${i}`}
            className="animate-plate w-[150px] shrink-0 snap-start"
            style={{ animationDelay: `${Math.min(i, 12) * 32}ms` }}
          >
            <button
              type="button"
              onClick={() => onSelect?.(c.id)}
              aria-label={`Open ${c.name}`}
              className="press block w-full text-left"
            >
              <span className="block aspect-[2/3] w-full overflow-hidden border border-border bg-muted transition-colors hover:border-[var(--foreground)]">
                {img(c.profile_path, 'w185') ? (
                  <img
                    src={img(c.profile_path, 'w185')!}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    width={185}
                    height={278}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="flex h-full items-center justify-center font-display text-[34px] text-muted-foreground">
                    {c.name.slice(0, 1)}
                  </span>
                )}
              </span>
              <span className="mt-2 block">
                <span className="block truncate font-display text-[16px] leading-tight">{c.name}</span>
                {c.character && (
                  <span className="mt-0.5 block truncate text-[12px] leading-tight text-muted-foreground">
                    {c.character}
                  </span>
                )}
              </span>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function StatusModal({
  title,
  status,
  mediaType,
  container,
  onSelect,
  onClose,
}: {
  title: string
  status: Status
  mediaType: MediaType
  container?: HTMLElement | null
  onSelect: (s: Status) => void
  onClose: () => void
}) {
  const [shown, setShown] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)
  useFocusTrap(boxRef)
  const closeTimer = useRef<number | null>(null)
  // Watching is a series-only state — movies are planned, watched, or dropped.
  const options = mediaType === 'movie' ? STATUSES.filter((s) => s !== 'watching') : STATUSES
  // Stable identity: onClose is an inline prop that changes every parent
  // render — depending on it would re-run the mount effect on every commit,
  // whose cleanup kills the dismiss timer (modal never closes on Save).
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const close = useCallback(() => {
    setShown(false)
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => onCloseRef.current(), 200)
  }, [])

  useEffect(() => {
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setShown(true))
    })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [close])

  // A pending close belongs to its timer: only unmount may cancel it, never
  // a re-render, or Save-style commits would wedge the modal open.
  useEffect(
    () => () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current)
    },
    [],
  )

  const content = (
    <div
      className="absolute inset-0 z-[60] flex items-center justify-center bg-[rgba(20,19,15,0.65)] p-4 transition-opacity duration-200"
      style={{ opacity: shown ? 1 : 0 }}
      onClick={close}
      onWheel={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Status — ${title}`}
        style={{ width: '100%', maxWidth: '320px' }}
        className={`origin-center border border-border bg-background shadow-[0_30px_90px_-20px_rgba(0,0,0,0.65)] transition-all duration-200 ${
          shown ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-2 scale-95 opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border px-4.5 py-3">
          <div className="min-w-0 pr-2">
            <span className="rule-label block text-[var(--primary)] text-[10px]">Status</span>
            <span className="mt-0.5 block truncate font-display text-[18px] leading-tight">{title}</span>
          </div>
          <button
            onClick={close}
            className="press flex h-8 w-8 shrink-0 items-center justify-center border border-border text-muted-foreground hover:border-[var(--foreground)] hover:text-foreground"
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="space-y-1.5 p-3.5">
          {options.map((s) => {
            const active = status === s
            return (
              <button
                key={s}
                type="button"
                onClick={() => {
                  onSelect(s)
                  close()
                }}
                className={`press flex h-9 w-full items-center justify-between border px-3 font-sans text-[11px] font-medium uppercase tracking-[0.14em] transition-all ${
                  active ? `${STATUS_STYLE[s]} shadow-xs` : STATUS_INACTIVE[s]
                }`}
                aria-pressed={active}
              >
                <span className="flex items-center gap-2.5">
                  <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">{STATUS_BADGE[s].icon}</span>
                  <span>{s}</span>
                </span>
                {active && (
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )

  if (!container) return null
  return createPortal(content, container)
}

function StatusButtons({
  title,
  status,
  mediaType,
  container,
  onChange,
}: {
  title: string
  status: Status
  mediaType: MediaType
  container?: HTMLElement | null
  onChange: (s: Status) => void
}) {
  const [modalOpen, setModalOpen] = useState(false)
  const badge = STATUS_BADGE[status] ?? STATUS_BADGE.planned
  const badgeStyle = STATUS_STYLE[status] ?? STATUS_STYLE.planned
  const hintTip = useTimedTooltip()

  return (
    <>
      <div
        className="relative"
        onMouseEnter={hintTip.show}
        onMouseLeave={hintTip.scheduleHide}
        onFocus={hintTip.show}
        onBlur={hintTip.scheduleHide}
      >
        <button
          type="button"
          onClick={(e) => {
            ;(e.currentTarget as HTMLButtonElement).blur()
            hintTip.hide()
            setModalOpen(true)
          }}
          aria-haspopup="dialog"
          aria-expanded={modalOpen}
          aria-label={`Status: ${badge?.label ?? status}. Activate to change status`}
          className={`press flex h-8 w-[108px] shrink-0 items-center justify-center px-3 font-sans text-[11px] font-medium uppercase tracking-[0.14em] shadow-xs transition-opacity hover:opacity-90 ${badgeStyle}`}
        >
          <span>{badge?.label ?? status}</span>
        </button>
        <span className={`pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap border border-border bg-foreground px-2 py-0.5 font-sans text-[10px] font-medium tracking-[0.04em] text-background transition-opacity duration-150 z-30 shadow-xs select-none ${hintTip.visible ? 'opacity-100' : 'opacity-0'}`}>
          Click to change status
        </span>
      </div>

      {modalOpen && (
        <StatusModal
          title={title}
          status={status}
          mediaType={mediaType}
          container={container}
          onSelect={(s) => {
            onChange(s)
          }}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  )
}

/* ---------- edit panel ---------- */

function EditModal({
  title,
  type,
  entry,
  source,
  seasons,
  container,
  onClose,
  onUpsert,
}: {
  title: string
  type: MediaType
  entry: Entry
  source?: TmdbTitle | null
  seasons?: SeasonSummary[]
  container?: HTMLElement | null
  onClose: () => void
  onUpsert: (patch: Partial<Entry>) => void
}) {
  const [shown, setShown] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const boxRef = useRef<HTMLFormElement | null>(null)
  useFocusTrap(boxRef)
  const closeTimer = useRef<number | null>(null)
  const { toast } = useToast()
  const prefillToday = useSettings().settings.defaultWatchDate === 'today'
  // See StatusModal: keep close identity stable across parent re-renders.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Draft-only editing — nothing commits until Save.
  const [draftRating, setDraftRating] = useState(entry.rating)
  const [draftFavorite, setDraftFavorite] = useState(entry.favorite)
  const [draftWatchedAt, setDraftWatchedAt] = useState(entry.watchedAt)
  const [draftStatus, setDraftStatus] = useState(entry.status)
  const [customTitle, setCustomTitle] = useState(entry.title ?? '')
  const [customYear, setCustomYear] = useState(entry.year ?? '')
  const [customRuntime, setCustomRuntime] = useState(entry.runtime != null ? String(entry.runtime) : '')
  const [customEpisodes, setCustomEpisodes] = useState(entry.totalEpisodes != null ? String(entry.totalEpisodes) : '')
  const [customPoster, setCustomPoster] = useState(entry.poster ?? '')
  const [customNote, setCustomNote] = useState(entry.note ?? '')

  const dismiss = useCallback(() => {
    setShown(false)
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => onCloseRef.current(), 260) // matches the exit transition duration
  }, [])

  const isDirty =
    draftRating !== entry.rating ||
    draftFavorite !== entry.favorite ||
    draftWatchedAt !== entry.watchedAt ||
    draftStatus !== entry.status ||
    customTitle.trim() !== (entry.title ?? '') ||
    customYear.trim() !== (entry.year ?? '') ||
    (type === 'movie'
      ? customRuntime.trim() !== (entry.runtime != null ? String(entry.runtime) : '')
      : customEpisodes.trim() !== (entry.totalEpisodes != null ? String(entry.totalEpisodes) : '')) ||
    customPoster.trim() !== (entry.poster ?? '') ||
    customNote.trim() !== (entry.note ?? '')

  /** X / backdrop / Escape: discard, but confirm first when dirty. */
  const dirtyRef = useRef(false)
  dirtyRef.current = isDirty
  const requestDismiss = useCallback(() => {
    if (dirtyRef.current) setConfirmDiscard(true)
    else dismiss()
  }, [dismiss])

  const save = useCallback(() => {
    if (draftStatus === 'watched' && draftWatchedAt == null) {
      toast('Add a watch date before saving a watched title', 'error')
      return
    }
    const patch: Partial<Entry> = {}
    if (draftRating !== entry.rating) patch.rating = draftRating
    if (draftFavorite !== entry.favorite) patch.favorite = draftFavorite
    if (draftWatchedAt !== entry.watchedAt) patch.watchedAt = draftWatchedAt
    if (draftStatus !== entry.status) patch.status = draftStatus
    const t = customTitle.trim()
    if (t && t !== entry.title) patch.title = t
    if (customYear.trim() !== entry.year) patch.year = customYear.trim()
    if (type === 'movie') {
      const r = customRuntime.trim() ? parseInt(customRuntime.trim(), 10) : null
      if (!isNaN(r as number) && r !== entry.runtime) patch.runtime = r
      else if (customRuntime.trim() === '' && entry.runtime !== null) patch.runtime = null
    } else {
      const ep = customEpisodes.trim() ? parseInt(customEpisodes.trim(), 10) : null
      if (!isNaN(ep as number) && ep !== entry.totalEpisodes) patch.totalEpisodes = ep
      else if (customEpisodes.trim() === '' && entry.totalEpisodes !== null) patch.totalEpisodes = null
    }
    const p = customPoster.trim()
    if (p !== (entry.poster ?? '')) patch.poster = p || null
    const n = customNote.trim()
    if (n !== (entry.note ?? '')) patch.note = n || undefined
    // Mirror the status picker's episode side-effects for shows: marking
    // watched fills every real season (Specials left alone), while planned
    // clears the log to start over.
    if (type === 'tv' && seasons && draftStatus !== entry.status) {
      if (draftStatus === 'watched') {
        const at = draftWatchedAt ?? Date.now()
        patch.episodes = markAllEpisodes(seasons, at, entry.episodes)
      } else if (draftStatus === 'planned') {
        patch.episodes = {}
      }
    }

    if (Object.keys(patch).length > 0) {
      onUpsert(patch)
      toast('Saved changes', 'success')
    }
    dismiss()
  }, [
    dismiss,
    draftRating,
    draftFavorite,
    draftWatchedAt,
    draftStatus,
    customTitle,
    customYear,
    customRuntime,
    customEpisodes,
    customPoster,
    customNote,
    entry,
    seasons,
    onUpsert,
    toast,
    type,
  ])

  const close = requestDismiss

  const resetToTmdb = () => {
    if (!source) return
    const defTitle = titleOf(source)
    const defYear = yearOf(source)
    const detail = source as Detail
    const defRuntime = type === 'movie' ? (detail.runtime ?? null) : null
    const defEpisodes = type === 'tv' ? (detail.number_of_episodes ?? null) : null
    const defPoster = source.poster_path ?? null

    setCustomTitle(defTitle)
    setCustomYear(defYear)
    setCustomRuntime(defRuntime != null ? String(defRuntime) : '')
    setCustomEpisodes(defEpisodes != null ? String(defEpisodes) : '')
    setCustomPoster(defPoster ?? '')
  }

  useEffect(() => {
    // Double rAF so the browser paints the initial (hidden) state before the
    // class flips — without this the enter transition frequently doesn't fire.
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setShown(true))
    })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    // Capture so Escape closes the modal before the drawer's own handler runs.
    window.addEventListener('keydown', onKey, true)
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [close])

  // See StatusModal: only unmount may cancel a pending close timer.
  useEffect(
    () => () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current)
    },
    [],
  )

  return (
    <div
      className={`absolute inset-0 z-[60] flex items-center justify-center bg-[rgba(20,19,15,0.65)] p-3 sm:p-4 transition-opacity duration-[260ms] ease-out ${
        shown ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={close}
    >
      <form
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit metadata — ${title}`}
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
        className={`flex h-[min(82vh,520px)] w-full max-w-[420px] origin-center flex-col border border-border bg-background shadow-[0_30px_90px_-20px_rgba(0,0,0,0.65)] transition-[opacity,transform] duration-[260ms] will-change-[opacity,transform] [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${
          shown ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-2 scale-[0.96] opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4.5 py-3">
          <div className="min-w-0 pr-2">
            <span className="rule-label block text-[var(--primary)] text-[10px]">Edit metadata</span>
            <span className="mt-0.5 block truncate font-display text-[18px] leading-tight">{customTitle || title}</span>
          </div>
          <button
            type="button"
            onClick={close}
            className="press flex h-8 w-8 shrink-0 items-center justify-center border border-border text-muted-foreground hover:border-[var(--foreground)] hover:text-foreground"
            aria-label="Close editor"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="quiet-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-4.5 py-3.5">
          <Field label={`Your rating${draftRating ? ` · ${draftRating}/10` : ' · Unrated'}`}>
            <div className="flex gap-1" role="radiogroup" aria-label="Your rating">
              <button
                type="button"
                role="radio"
                aria-checked={draftRating === null}
                onClick={() => setDraftRating(null)}
                aria-label="Set as unrated"
                title="Set as unrated"
                className={`group relative press aspect-square flex-1 border font-mono text-[11px] font-medium transition-colors ${
                  draftRating === null
                    ? 'border-[var(--foreground)] bg-foreground text-background'
                    : 'border-border text-muted-foreground hover:border-[var(--foreground)] hover:text-foreground'
                }`}
              >
                —
                <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap border border-border bg-foreground px-2 py-0.5 font-sans text-[10px] font-medium tracking-[0.04em] text-background opacity-0 transition-opacity duration-150 group-hover:opacity-100 z-30 shadow-xs select-none">
                  Unrated
                </span>
              </button>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={draftRating === n}
                  onClick={() => setDraftRating(draftRating === n ? null : n)}
                  aria-label={`Rate ${n}`}
                  className={`press aspect-square flex-1 border font-sans text-[11px] font-medium tabular-nums ${
                    draftRating && n <= draftRating
                      ? 'border-[var(--accent)] bg-[var(--accent)] text-accent-foreground'
                      : 'border-border text-muted-foreground hover:border-[var(--foreground)]'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </Field>

          <div className="space-y-3">
            <Field label="Favourite">
              <button
                type="button"
                onClick={() => setDraftFavorite(!draftFavorite)}
                aria-pressed={draftFavorite}
                className={`press flex h-8 w-full items-center justify-center gap-1.5 border px-2.5 font-sans text-[10px] font-medium uppercase tracking-[0.12em] ${
                  draftFavorite
                    ? 'border-[var(--primary)] text-[var(--primary)]'
                    : 'border-border text-muted-foreground hover:border-[var(--foreground)] hover:text-foreground'
                }`}
              >
                <HeartIcon filled={draftFavorite} />
                <span>{draftFavorite ? 'Favourited' : 'Favourite'}</span>
              </button>
            </Field>

            <Field label="Date watched">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (draftWatchedAt != null || draftStatus === 'watched') {
                      setDraftWatchedAt(null)
                      setDraftStatus('planned')
                    } else {
                      setDraftWatchedAt(prefillToday ? Date.now() : null)
                      setDraftStatus('watched')
                    }
                  }}
                  className={`press flex h-8 shrink-0 items-center gap-1.5 border px-3 font-sans text-[10px] font-medium uppercase tracking-[0.12em] ${
                    draftWatchedAt != null || draftStatus === 'watched'
                      ? 'border-[var(--primary)] text-[var(--primary)]'
                      : 'border-border text-muted-foreground hover:border-[var(--foreground)] hover:text-foreground'
                  }`}
                >
                  {draftWatchedAt != null || draftStatus === 'watched' ? <CheckIcon /> : null}
                  <span>{draftWatchedAt != null || draftStatus === 'watched' ? 'Watched' : 'Mark watched'}</span>
                </button>
                {(draftWatchedAt != null || draftStatus === 'watched') && (
                  <input
                    type="date"
                    aria-label="Date watched"
                    max={todayInput()}
                    value={draftWatchedAt != null ? toDateInput(draftWatchedAt) : ''}
                    onChange={(ev) => {
                      if (!ev.target.value) return
                      const at = fromDateInput(ev.target.value)
                      if (at == null) return
                      setDraftWatchedAt(at)
                      // Recording a watch date means watched.
                      if (draftStatus !== 'watched') setDraftStatus('watched')
                    }}
                    className="h-8 flex-1 border border-border bg-background px-2 font-mono text-[11px] outline-none focus:border-[var(--primary)]"
                  />
                )}
                {draftStatus === 'watched' && draftWatchedAt == null && (
                  <button
                    type="button"
                    onClick={() => setDraftWatchedAt(Date.now())}
                    className="press flex h-8 shrink-0 items-center border border-border px-3 font-sans text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground hover:border-[var(--foreground)] hover:text-foreground"
                  >
                    Today
                  </button>
                )}
              </div>
            </Field>
          </div>

          <div className="border-t border-border pt-3.5">
            <div className="mb-3 flex items-center justify-between">
              <span className="rule-label text-[var(--primary)] text-[10px]">Title & Metadata</span>
              {source && (
                <button
                  type="button"
                  onClick={resetToTmdb}
                  className="press font-sans text-[9.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-[var(--primary)]"
                >
                  Reset to TMDb
                </button>
              )}
            </div>

            <div className="space-y-3">
              <Field label="Title">
                <input
                  type="text"
                  aria-label="Title"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="Title"
                  className="h-8 w-full border border-border bg-background px-2.5 font-sans text-[11px] text-foreground outline-none transition-colors focus:border-[var(--primary)]"
                />
              </Field>

              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Release year">
                  <input
                    type="text"
                    aria-label="Release year"
                    value={customYear}
                    onChange={(e) => setCustomYear(e.target.value)}
                    placeholder="YYYY"
                    maxLength={4}
                    className="h-8 w-full border border-border bg-background px-2.5 font-mono text-[11px] text-foreground outline-none transition-colors focus:border-[var(--primary)]"
                  />
                </Field>

                <Field label={type === 'movie' ? 'Runtime (minutes)' : 'Total episodes'}>
                  {type === 'movie' ? (
                    <input
                      type="number"
                      aria-label="Runtime in minutes"
                      min="0"
                      value={customRuntime}
                      onChange={(e) => setCustomRuntime(e.target.value)}
                      placeholder="e.g. 150"
                      className="h-8 w-full border border-border bg-background px-2.5 font-mono text-[11px] text-foreground outline-none transition-colors focus:border-[var(--primary)]"
                    />
                  ) : (
                    <input
                      type="number"
                      aria-label="Total episodes"
                      min="0"
                      value={customEpisodes}
                      onChange={(e) => setCustomEpisodes(e.target.value)}
                      placeholder="e.g. 10"
                      className="h-8 w-full border border-border bg-background px-2.5 font-mono text-[11px] text-foreground outline-none transition-colors focus:border-[var(--primary)]"
                    />
                  )}
                </Field>
              </div>

              <Field label="Poster image path">
                <input
                  type="text"
                  aria-label="Poster image path"
                  value={customPoster}
                  onChange={(e) => setCustomPoster(e.target.value)}
                  placeholder="/path.jpg (TMDb image path)"
                  className="h-8 w-full border border-border bg-background px-2.5 font-mono text-[11px] text-foreground outline-none transition-colors focus:border-[var(--primary)]"
                />
              </Field>

              <Field label="Personal notes / review">
                <textarea
                  rows={2}
                  aria-label="Personal notes or review"
                  value={customNote}
                  onChange={(e) => setCustomNote(e.target.value)}
                  placeholder="Screening thoughts, personal review, or context..."
                  className="w-full resize-none border border-border bg-background p-2.5 font-sans text-[11px] text-foreground outline-none transition-colors focus:border-[var(--primary)]"
                />
              </Field>
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-border px-4.5 py-3">
          <span className="select-none font-mono text-[10px] tracking-[0.08em] text-muted-foreground/60" aria-hidden>
            ⏎ to save
          </span>
          <button
            type="submit"
            title="Save (Enter)"
            className="press h-8 bg-[var(--primary)] px-5 font-sans text-[10px] font-medium uppercase tracking-[0.14em] text-primary-foreground hover:opacity-85"
          >
            Save
          </button>
        </footer>
      </form>

      <ConfirmDialog
        open={confirmDiscard}
        container={container}
        title="Discard Changes"
        message="You have unsaved edits. Close without saving them?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        tone="neutral"
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setConfirmDiscard(false)
          dismiss()
        }}
      />
    </div>
  )
}

/* ---------- rewatch log ---------- */

function RewatchModal({
  title,
  entry,
  container,
  onClose,
  onAddRewatch,
  onSetRewatchDate,
  onRemoveRewatch,
}: {
  title: string
  entry: Entry
  container?: HTMLElement | null
  onClose: () => void
  onAddRewatch: (at: number) => void
  onSetRewatchDate: (index: number, at: number) => void
  onRemoveRewatch: (index: number) => void
}) {
  const [rewatchDate, setRewatchDate] = useState(todayInput())
  const [shown, setShown] = useState(false)
  const [confirmIndex, setConfirmIndex] = useState<number | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  useFocusTrap(boxRef)
  const closeTimer = useRef<number | null>(null)
  const { toast } = useToast()
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  // Subscribe directly: the list must reflect every commit even if a parent
  // re-render were ever swallowed, so never rely solely on the entry prop.
  const { get } = useLibrary()
  const live = get(entry.mediaType, entry.id) ?? entry

  const close = useCallback(() => {
    setShown(false)
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => onCloseRef.current(), 260) // matches the exit transition duration
  }, [])

  useEffect(() => {
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setShown(true))
    })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [close])

  // See StatusModal: only unmount may cancel a pending close timer.
  useEffect(
    () => () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current)
    },
    [],
  )

  return (
    <div
      className={`absolute inset-0 z-[60] flex items-center justify-center bg-[rgba(20,19,15,0.65)] p-3 sm:p-4 transition-opacity duration-[260ms] ease-out ${
        shown ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={close}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Rewatch log — ${title}`}
        className={`flex h-[min(80vh,500px)] w-full max-w-[420px] origin-center flex-col border border-border bg-background shadow-[0_30px_90px_-20px_rgba(0,0,0,0.65)] transition-[opacity,transform] duration-[260ms] will-change-[opacity,transform] [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${
          shown ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-2 scale-[0.96] opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4.5 py-3">
          <div className="min-w-0 pr-2">
            <span className="rule-label block text-[var(--primary)] text-[10px]">
              Rewatch log{live.rewatches.length ? ` · ${live.rewatches.length}` : ''}
            </span>
            <span className="mt-0.5 block truncate font-display text-[18px] leading-tight">{title}</span>
          </div>
          <button
            onClick={close}
            className="press flex h-8 w-8 shrink-0 items-center justify-center border border-border text-muted-foreground hover:border-[var(--foreground)] hover:text-foreground"
            aria-label="Close rewatch log"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="quiet-scroll min-h-0 flex-1 overflow-y-auto px-4.5 py-3.5">
          {live.rewatches?.length ? (
            <ul className="space-y-1.5">
              {live.rewatches.map((ts, i) => (
                <li key={`${ts}-${i}`} className="flex items-center gap-2">
                  <span className="rule-label w-6 text-[10px]">{String(i + 1).padStart(2, '0')}</span>
                  <input
                    type="date"
                    aria-label={`Rewatch ${i + 1} date`}
                    max={todayInput()}
                    value={toDateInput(ts)}
                    onChange={(ev) => {
                      if (!ev.target.value) return
                      const at = fromDateInput(ev.target.value)
                      if (at != null) onSetRewatchDate(i, at)
                    }}
                    className="h-8 flex-1 border border-border bg-background px-2 font-mono text-[11px] outline-none focus:border-[var(--primary)]"
                  />
                  <button
                    onClick={() => setConfirmIndex(i)}
                    aria-label="Remove rewatch"
                    className="press flex h-8 w-8 items-center justify-center border border-border text-muted-foreground hover:border-[var(--primary)] hover:text-[var(--primary)]"
                  >
                    <CloseIcon />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2.5 border border-dashed border-border py-8 text-center">
              <span className="text-muted-foreground">
                <RewatchIcon />
              </span>
              <p className="rule-label text-[10px]">No rewatches logged yet</p>
            </div>
          )}
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-border px-4.5 py-3">
          <input
            type="date"
            max={todayInput()}
            value={rewatchDate}
            onChange={(e) => e.target.value && setRewatchDate(e.target.value)}
            className="h-8 flex-1 border border-border bg-background px-2 font-mono text-[11px] outline-none focus:border-[var(--primary)]"
          />
          <button
            onClick={() => {
              const at = fromDateInput(rewatchDate)
              if (at == null) return
              onAddRewatch(at)
              toast('Rewatch logged', 'success')
            }}
            className="press h-8 bg-[var(--primary)] px-4 font-sans text-[10px] font-medium uppercase tracking-[0.14em] text-primary-foreground hover:opacity-85"
          >
            + Log rewatch
          </button>
        </footer>

        <ConfirmDialog
          open={confirmIndex !== null}
          container={container}
          title="Remove Rewatch"
          message="Are you sure you want to delete this logged rewatch date from your archive?"
          confirmLabel="Remove"
          onCancel={() => setConfirmIndex(null)}
          onConfirm={() => {
            if (confirmIndex !== null) {
              onRemoveRewatch(confirmIndex)
              setConfirmIndex(null)
              toast('Rewatch removed', 'info')
            }
          }}
        />
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="rule-label mb-2">{label}</div>
      {children}
    </div>
  )
}

/* ---------- seasons ---------- */

function Seasons({
  showId,
  seasons,
  watched,
  tracked,
  onAdd,
  onToggle,
  onBulk,
}: {
  showId: number
  seasons: { id: number; season_number: number; name: string; episode_count: number; air_date: string | null }[]
  watched: Record<string, number>
  tracked: boolean
  onAdd: () => void
  onToggle: (s: number, e: number) => void
  onBulk: (s: number, nums: number[], watched: boolean) => void
}) {
  const ordered = [...seasons].sort((a, b) =>
    a.season_number === 0 ? 1 : b.season_number === 0 ? -1 : a.season_number - b.season_number,
  )
  const [open, setOpen] = useState<number>(ordered[0]?.season_number ?? 1)
  const [episodes, setEpisodes] = useState<Record<number, Episode[]>>({})
  const [loading, setLoading] = useState(false)
  const [seasonError, setSeasonError] = useState<string | null>(null)
  const [seasonAttempt, setSeasonAttempt] = useState(0)
  const [confirmClear, setConfirmClear] = useState<number | null>(null)
  const fetchedRef = useRef<Set<number>>(new Set())
  const hideDescriptions = useSettings().settings.hideSpoilers
  const { toast } = useToast()

  // Reset fetched set when show changes
  useEffect(() => {
    fetchedRef.current.clear()
  }, [showId])

  const current = ordered.find((s) => s.season_number === open) ?? ordered[0]

  useEffect(() => {
    if (fetchedRef.current.has(open)) return
    const controller = new AbortController()
    let live = true
    setLoading(true)
    setSeasonError(null)
    fetchSeason(showId, open, { signal: controller.signal })
      .then((s) => {
        if (live) {
          fetchedRef.current.add(open)
          setEpisodes((prev) => ({ ...prev, [open]: s.episodes }))
        }
      })
      .catch((e) => {
        if (live) {
          setSeasonError(e instanceof Error ? e.message : 'Failed to load episodes')
        }
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
      controller.abort()
    }
  }, [open, showId, seasonAttempt])

  const seenIn = (s: { season_number: number; episode_count: number }) => {
    const eps = episodes[s.season_number]
    return eps
      ? eps.filter((e) => Object.prototype.hasOwnProperty.call(watched, epKey(s.season_number, e.episode_number))).length
      : Object.keys(watched).filter((k) => k.startsWith(`${s.season_number}-`)).length
  }

  return (
    <div>
      {!tracked && (
        <div className="mb-4">
          <button
            onClick={onAdd}
            className="press font-sans text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--primary)] underline underline-offset-4"
          >
            Add to library to track
          </button>
        </div>
      )}

      <div className="quiet-scroll -mx-1 mb-5 flex gap-2 overflow-x-auto px-1 pb-2">
        {ordered.map((s) => {
          const seen = seenIn(s)
          const active = s.season_number === open
          return (
            <button
              key={s.id}
              onClick={() => {
                setOpen(s.season_number)
                setConfirmClear(null)
              }}
              aria-pressed={active}
              className={`press shrink-0 border px-3 py-2 text-left transition-colors ${
                active ? 'border-[var(--primary)] bg-card' : 'border-border hover:border-[var(--foreground)]'
              }`}
            >
              <span
                className={`block font-sans text-[11px] font-medium uppercase tracking-[0.14em] ${
                  active ? 'text-[var(--primary)]' : 'text-muted-foreground'
                }`}
              >
                {s.season_number === 0 ? 'Specials' : `Season ${s.season_number}`}
              </span>
              <span className="mt-1.5 block h-[2px] w-full bg-secondary">
                <span
                  className="block h-full bg-[var(--primary)] transition-[width] duration-500 ease-out"
                  style={{ width: `${s.episode_count ? Math.min(100, (seen / s.episode_count) * 100) : 0}%` }}
                />
              </span>
            </button>
          )
        })}
      </div>

      <div className="border border-border">
        {[current].filter(Boolean).map((s) => {
          const eps = episodes[s.season_number]
          const seen = seenIn(s)
          return (
            <div key={s.id} className="animate-fade">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-card px-4 py-3">
                <span className="flex flex-1 items-baseline gap-4">
                  <span className="font-mono text-[11px] tabular-nums text-[var(--accent)]">
                    {String(s.season_number).padStart(2, '0')}
                  </span>
                  <span className="font-sans font-medium text-[16px] tracking-tight">{s.name}</span>
                  <span className="rule-label">{(s.air_date ?? '').slice(0, 4)}</span>
                </span>
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {seen}/{s.episode_count}
                </span>
                <span className="hidden h-[3px] w-24 bg-secondary sm:block">
                  <span
                    className="block h-full bg-[var(--primary)] transition-[width] duration-500 ease-out"
                    style={{ width: `${s.episode_count ? Math.min(100, (seen / s.episode_count) * 100) : 0}%` }}
                  />
                </span>
                {tracked && (
                  <button
                    disabled={loading && !eps}
                    onClick={() => {
                      const numbers =
                        eps?.map((e) => e.episode_number) ??
                        Array.from({ length: s.episode_count }, (_, i) => i + 1)
                      const complete = seen >= s.episode_count
                      if (!complete) {
                        onBulk(s.season_number, numbers, true)
                        toast(`Season ${s.season_number === 0 ? 'Specials' : s.season_number} marked watched`, 'success')
                        return
                      }
                      // Unmarking a whole season is destructive — confirm first.
                      if (confirmClear === s.season_number) {
                        onBulk(s.season_number, numbers, false)
                        setConfirmClear(null)
                        toast('Season unmarked', 'info')
                      } else {
                        setConfirmClear(s.season_number)
                      }
                    }}
                    className={`press border px-2.5 py-1 font-sans text-[11px] font-medium uppercase tracking-[0.12em] disabled:cursor-wait disabled:opacity-50 ${
                      confirmClear === s.season_number
                        ? 'border-[var(--destructive)] bg-[var(--destructive)] text-[var(--destructive-foreground)]'
                        : seen >= s.episode_count
                          ? 'border-[var(--primary)] bg-[var(--primary)] text-primary-foreground'
                          : 'border-border hover:border-[var(--primary)] hover:text-[var(--primary)]'
                    }`}
                  >
                    {confirmClear === s.season_number
                      ? 'Click again to unmark'
                      : seen >= s.episode_count
                        ? '✓ Season watched'
                        : 'Mark season watched'}
                  </button>
                )}
              </div>

              <div>
                {loading && !eps && !seasonError && <p className="rule-label px-4 py-4">Loading episodes…</p>}
                {seasonError && !eps && (
                  <div className="flex flex-wrap items-center gap-3 px-4 py-4">
                    <p className="rule-label">Episodes failed to load · {seasonError}</p>
                    <button
                      onClick={() => setSeasonAttempt((a) => a + 1)}
                      className="press border border-border px-3 py-1 font-sans text-[10px] font-medium uppercase tracking-[0.12em] hover:border-[var(--foreground)]"
                    >
                      Retry
                    </button>
                  </div>
                )}
                {eps?.map((e, i) => {
                  const loggedAt = watched[epKey(s.season_number, e.episode_number)]
                  const done = loggedAt != null
                  const descriptionHidden = hideDescriptions
                  return (
                    <div
                      key={e.id}
                      style={{ animationDelay: `${Math.min(i, 12) * 26}ms` }}
                      className={`group/ep animate-rise flex w-full items-center border-b border-border transition-colors duration-300 last:border-0 ${
                        done ? 'bg-muted' : ''
                      }`}
                    >
                      <button
                        disabled={!tracked}
                        aria-pressed={done}
                        onClick={() => onToggle(s.season_number, e.episode_number)}
                        className={`flex min-w-0 flex-1 items-center gap-4 px-4 py-3 text-left transition-colors ${
                          tracked ? 'hover:bg-secondary' : 'cursor-default'
                        }`}
                      >
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center border text-[10px] transition-colors duration-200 ${
                            done
                              ? 'border-[var(--primary)] bg-[var(--primary)] text-primary-foreground'
                              : 'border-border group-hover/ep:border-[var(--foreground)]'
                          }`}
                        >
                          {done && <span className="animate-tick block leading-none">✓</span>}
                        </span>
                        <span className="w-9 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                          E{String(e.episode_number).padStart(2, '0')}
                        </span>
                        <span className="relative hidden aspect-video w-[124px] shrink-0 overflow-hidden border border-border bg-muted sm:block">
                          {img(e.still_path, 'w185') ? (
                              <img
                                src={img(e.still_path, 'w185')!}
                                alt={`Still from ${e.name}`}
                                loading="lazy"
                                decoding="async"
                                width={185}
                                height={104}
                                className={`h-full w-full object-cover transition-all ${done ? 'opacity-55' : ''}`}
                              />
                          ) : (
                            <span className="flex h-full items-center justify-center font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                              No still
                            </span>
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={`block text-[14px] ${done ? 'text-muted-foreground line-through' : ''}`}>
                            {e.name}
                          </span>
                          {e.overview && !descriptionHidden && (
                            <span className="mt-0.5 line-clamp-2 block text-[12px] leading-relaxed text-muted-foreground">
                              {e.overview}
                            </span>
                          )}
                        </span>
                        <span className="hidden shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground sm:block">
                          <span className="block">{formatEpisodeDate(e.air_date)}</span>
                          {e.runtime ? <span className="block">{e.runtime} min</span> : null}
                        </span>
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      <p className="rule-label mt-3">{Object.keys(watched).length} episodes logged across this series</p>
    </div>
  )
}
