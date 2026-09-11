import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { img, titleOf, yearOf, type MediaType, type TmdbTitle } from '../lib/tmdb'
import { progress, useLibrary, type Entry, type Status } from '../lib/library'
import { useSettings } from '../lib/settings'
import { useToast } from './Toast'

/** CineTrack brand marks. */
const PINK = '#D93D87'
const BLUE = '#263C92'

export function Mark({ size = 28, className }: { size?: number; className?: string }) {
  const height = (size * 100) / 170
  return (
    <svg
      width={size}
      height={height}
      viewBox="0 0 170 100"
      fill="none"
      role="img"
      aria-label="CineTrack"
      className={className}
    >
      <circle cx="50" cy="50" r="50" fill={PINK} />
      <circle cx="120" cy="50" r="50" fill={BLUE} />
    </svg>
  )
}

export function Logo({
  size = 26,
  markSize,
  className,
  wordmark = true,
}: {
  size?: number
  markSize?: number
  className?: string
  wordmark?: boolean
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ''}`}>
      <Mark size={markSize ?? size} />
      {wordmark && (
        <span
          className="font-display italic leading-none tracking-tight text-foreground"
          style={{ fontSize: size * 1.02 }}
        >
          CineTrack
        </span>
      )}
    </span>
  )
}

let scrollLockCount = 0
let previousOverflow: string | null = null
let previousPaddingRight: string | null = null

export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked || typeof document === 'undefined') return
    if (scrollLockCount === 0) {
      previousOverflow = document.body.style.overflow
      previousPaddingRight = document.body.style.paddingRight
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
      document.body.style.overflow = 'hidden'
      if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`
    }
    scrollLockCount++
    return () => {
      scrollLockCount = Math.max(0, scrollLockCount - 1)
      if (scrollLockCount === 0 && typeof document !== 'undefined') {
        document.body.style.overflow = previousOverflow ?? ''
        document.body.style.paddingRight = previousPaddingRight ?? ''
        previousOverflow = null
        previousPaddingRight = null
      }
    }
  }, [locked])
}

/** Fixed semantic status colors — distinct tokens like delete red, via CSS vars. */
export const STATUS_STYLE: Record<Status, string> = {
  planned: 'bg-[var(--status-planned)] text-[var(--status-planned-foreground)] border border-[var(--status-planned)]',
  watching: 'bg-[var(--status-watching)] text-[var(--status-watching-foreground)] border border-[var(--status-watching)]',
  watched: 'bg-[var(--status-watched)] text-[var(--status-watched-foreground)] border border-[var(--status-watched)]',
  dropped: 'bg-muted text-muted-foreground border border-border',
}

export const STATUS_INACTIVE: Record<Status, string> = {
  planned:
    'border border-[var(--status-planned)]/30 bg-[var(--status-planned)]/[0.06] text-[var(--status-planned)] hover:bg-[var(--status-planned)] hover:text-[var(--status-planned-foreground)] hover:border-[var(--status-planned)]',
  watching:
    'border border-[var(--status-watching)]/30 bg-[var(--status-watching)]/[0.06] text-[var(--status-watching)] hover:bg-[var(--status-watching)] hover:text-[var(--status-watching-foreground)] hover:border-[var(--status-watching)]',
  watched:
    'border border-[var(--status-watched)]/30 bg-[var(--status-watched)]/[0.06] text-[var(--status-watched)] hover:bg-[var(--status-watched)] hover:text-[var(--status-watched-foreground)] hover:border-[var(--status-watched)]',
  dropped:
    'border border-border bg-muted/20 text-muted-foreground hover:bg-muted hover:text-foreground',
}

/** Per-status colour + glyph, so a shelf reads at a glance without the text. */
export const STATUS_BADGE: Record<Status, { bg: string; label: string; icon: ReactNode }> = {
  planned: {
    bg: STATUS_STYLE.planned,
    label: 'Planned',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z" />
      </svg>
    ),
  },
  watching: {
    bg: STATUS_STYLE.watching,
    label: 'Watching',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M6 4.5v15a1 1 0 0 0 1.53.85l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 6 4.5Z" />
      </svg>
    ),
  },
  watched: {
    bg: STATUS_STYLE.watched,
    label: 'Watched',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M20 6 9 17l-5-5" />
      </svg>
    ),
  },
  dropped: {
    bg: STATUS_STYLE.dropped,
    label: 'Dropped',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    ),
  },
}

export function StatusBadge({ status }: { status: Status }) {
  const s = STATUS_BADGE[status] ?? STATUS_BADGE.planned
  return (
    <span
      role="img"
      title={s.label}
      aria-label={s.label}
      className={`flex h-6 w-6 items-center justify-center ${s.bg}`}
    >
      {s.icon}
    </span>
  )
}

export function SectionHead({ index, title, note, right, rule = true }: { index?: string; title: string; note?: string; right?: ReactNode; rule?: boolean }) {
  return (
    <div className={`relative z-30 flex items-end justify-between gap-6 ${rule ? 'mb-6 pb-3' : 'mb-4'}`}>
      {/* The rule beneath the head draws itself in rather than appearing. */}
      {rule && <span aria-hidden className="animate-rule absolute inset-x-0 bottom-0 h-px bg-border" />}
      <div className="flex items-baseline gap-4 min-w-0">
        {index && <span className="animate-fade font-mono text-[11px] tracking-[0.2em] text-[var(--accent)]">{index}</span>}
        <div className="min-w-0">
          <h2 className="font-display text-[34px] sm:text-[38px] italic leading-none tracking-tight">{title}</h2>
          {note && <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground whitespace-normal md:whitespace-nowrap">{note}</p>}
        </div>
      </div>
      {right}
    </div>
  )
}

/**
 * Counts a number up to its target on mount and whenever it changes, so the
 * figures on a dashboard tally rather than blink. Non-numeric values pass
 * straight through; reduced-motion users get the final value immediately.
 */
function useTally(value: string | number) {
  const target = typeof value === 'number' ? value : Number.NaN
  const [shown, setShown] = useState(target)
  const from = useRef(target)

  useEffect(() => {
    if (Number.isNaN(target)) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const start = from.current
    if (reduced || start === target) {
      from.current = target
      setShown(target)
      return
    }
    const t0 = performance.now()
    const span = 620
    let raf = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / span)
      // easeOutQuart — fast off the mark, long settle.
      const eased = 1 - Math.pow(1 - t, 4)
      setShown(Math.round(start + (target - start) * eased))
      if (t < 1) raf = requestAnimationFrame(step)
      else from.current = target
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target])

  return Number.isNaN(target) ? value : shown
}

export function Stat({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  const shown = useTally(value)
  return (
    <div className="animate-tick border-l border-border pl-5 py-0.5">
      <div className="rule-label text-[11px] tracking-[0.18em]">{label}</div>
      <div className="mt-2.5 flex items-baseline gap-2">
        <span className="font-display text-[48px] sm:text-[54px] leading-none tracking-tight tabular-nums">{shown}</span>
        {unit && <span className="font-mono text-[13px] text-muted-foreground">{unit}</span>}
      </div>
    </div>
  )
}

export function Chip({
  active,
  children,
  onClick,
  className,
  role,
}: {
  active?: boolean
  children: ReactNode
  onClick?: () => void
  className?: string
  role?: 'radio'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role={role}
      aria-pressed={role ? undefined : active ? 'true' : 'false'}
      aria-checked={role === 'radio' ? active : undefined}
      className={`press shrink-0 whitespace-nowrap border px-3 py-1.5 font-sans text-[11px] font-medium uppercase tracking-[0.14em] ${
        active
          ? 'border-[var(--primary)] bg-[var(--primary)] text-primary-foreground'
          : 'border-border text-muted-foreground hover:border-[var(--foreground)] hover:text-foreground'
      } ${className ?? ''}`}
    >
      {children}
    </button>
  )
}

export function CarouselNav({
  onPrev,
  onNext,
  prevLabel = 'Scroll back',
  nextLabel = 'Scroll forward',
  className,
}: {
  onPrev: () => void
  onNext: () => void
  prevLabel?: string
  nextLabel?: string
  className?: string
}) {
  return (
    <div className={`flex shrink-0 gap-2 ${className ?? ''}`}>
      <button
        type="button"
        onClick={onPrev}
        aria-label={prevLabel}
        className="press flex h-8 w-8 items-center justify-center border border-border text-muted-foreground hover:border-[var(--foreground)] hover:text-foreground"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onNext}
        aria-label={nextLabel}
        className="press flex h-8 w-8 items-center justify-center border border-border text-muted-foreground hover:border-[var(--foreground)] hover:text-foreground"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  )
}

export const Poster = memo(function Poster({
  item,
  entry,
  onOpen,
  style,
}: {
  item: TmdbTitle
  entry?: Entry
  onOpen: (type: MediaType, id: number, seed: TmdbTitle) => void
  /** PosterGrid injects the stagger delay here. */
  style?: CSSProperties
}) {
  const { settings } = useSettings()
  // Posters receive their entry from the shelf parent. Avoid subscribing each
  // individual card to the whole store; one shelf-level subscription is enough.
  const { upsert } = useLibrary(false)
  const { toast } = useToast()
  const type: MediaType = (item.media_type ?? (item.title ? 'movie' : 'tv')) as MediaType
  const saver = settings.posterQuality === 'saver'
  const src = img(item.poster_path, saver ? 'w185' : 'w342')
  const srcSet = saver
    ? `${img(item.poster_path, 'w185')} 185w`
    : `${img(item.poster_path, 'w185')} 185w, ${img(item.poster_path, 'w342')} 342w, ${img(item.poster_path, 'w500')} 500w`
  const compact = settings.density === 'compact'
  const pct = entry ? progress(entry) : 0
  const community =
    settings.showCommunityScores && item.vote_average > 0 ? item.vote_average.toFixed(1) : null

  const [imgLoaded, setImgLoaded] = useState(false)
  const [imgError, setImgError] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    setImgLoaded(false)
    setImgError(false)
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      setImgLoaded(true)
    }
  }, [src])

  return (
    <div style={style} className="group animate-plate select-none">
      <div className="relative aspect-[2/3] w-full overflow-hidden border border-border bg-muted transition-colors duration-300 group-hover:border-[var(--foreground)]">
        {src && !imgLoaded && !imgError && (
          <div className="absolute inset-0 shimmer opacity-70" aria-hidden="true" />
        )}
        <button
          type="button"
          onClick={() => onOpen(type, item.id, item)}
          aria-label={`Open ${titleOf(item)}`}
          className="absolute inset-0 h-full w-full cursor-pointer press"
        >
          {src && !imgError ? (
            <img
              ref={imgRef}
              src={src}
              srcSet={srcSet}
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 16vw"
              alt={`Poster for ${titleOf(item)}`}
              loading="lazy"
              decoding="async"
              width={342}
              height={513}
              onLoad={() => setImgLoaded(true)}
              onError={() => {
                setImgError(true)
                setImgLoaded(false)
              }}
              className={`h-full w-full object-cover transition-all duration-500 ease-out ${
                imgLoaded ? 'opacity-100' : 'opacity-0'
              } ${
                settings.posterMotion ? 'group-hover:scale-[1.03]' : 'group-hover:opacity-85'
              }`}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-3 text-center font-display text-lg text-muted-foreground">
              {titleOf(item)}
            </div>
          )}
        </button>
        <div className="absolute left-2 top-2 z-10">
          {entry ? (
            <div className="pointer-events-none">
              <StatusBadge status={entry.status} />
            </div>
          ) : (
            <button
              type="button"
              aria-label={`Add ${titleOf(item)} to library`}
              title="Add to library"
              onClick={(e) => {
                e.stopPropagation()
                try {
                  upsert(type, item.id, {
                    title: titleOf(item),
                    poster: item.poster_path,
                    year: yearOf(item),
                    status: settings.defaultStatus,
                    totalEpisodes: (item as unknown as { number_of_episodes?: number | null }).number_of_episodes ?? null,
                  })
                  toast(`Added ${titleOf(item)} to library`, 'success')
                  if (settings.openAfterAdd) onOpen(type, item.id, item)
                } catch (err) {
                  console.error(err)
                  toast(`Couldn't add ${titleOf(item)} — please retry`, 'error')
                }
              }}
              className="press flex h-6 w-6 cursor-pointer items-center justify-center bg-[var(--primary)] text-primary-foreground opacity-0 shadow-md transition-all duration-200 hover:scale-110 hover:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
            >
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
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          )}
        </div>
        {pct > 0 && pct < 1 && (
          <span className="absolute inset-x-0 bottom-0 h-[3px] bg-black/25">
            <span
              className="animate-grow block h-full bg-[var(--accent)] transition-[width] duration-500"
              style={{ width: `${pct * 100}%` }}
            />
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => onOpen(type, item.id, item)}
        className="mt-2 flex w-full items-baseline justify-between gap-2 text-left"
      >
        <span
          className={`truncate font-display leading-tight transition-colors duration-200 group-hover:text-[var(--primary)] ${
            compact ? 'text-[15px]' : 'text-[17px]'
          }`}
        >
          {titleOf(item)}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {yearOf(item) || '—'}
          {community && <span className="text-[var(--accent)]"> · ★ {community}</span>}
        </span>
      </button>
      <div className="rule-label mt-0.5">{type === 'movie' ? 'Movie' : 'Series'}</div>
    </div>
  )
})

export function PosterSkeleton({
  compact,
  style,
  className = '',
}: {
  compact?: boolean
  style?: CSSProperties
  className?: string
}) {
  return (
    <div style={style} className={`animate-plate select-none ${className}`}>
      <div className="relative aspect-[2/3] w-full overflow-hidden border border-border bg-muted shimmer" />
      <div className="mt-2 flex w-full items-baseline justify-between gap-2">
        <div className={`h-4 w-3/4 bg-muted shimmer ${compact ? 'text-[15px]' : 'text-[17px]'}`} />
        <div className="h-3 w-8 bg-muted shimmer" />
      </div>
      <div className="mt-1 h-2.5 w-12 bg-muted/70 shimmer" />
    </div>
  )
}

export function PosterGrid({
  children,
  columns,
  className = '',
}: {
  children: ReactNode
  columns?: number
  className?: string
}) {
  const { settings } = useSettings()
  const cols = columns ?? (settings.density === 'compact' ? 8 : 6)

  return (
    <div
      className={`poster-grid-dynamic grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 md:grid-cols-4 ${className}`}
      style={
        {
          '--grid-desktop-cols': cols,
        } as CSSProperties
      }
    >
      {children}
    </div>
  )
}

/** Minimal search field — editorial, no chrome, ⌘K to focus. */
export function SearchInput({
  value,
  onChange,
  placeholder = 'SEARCH…',
  className,
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  autoFocus?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
      if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        inputRef.current?.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      className={`group flex h-9 items-center gap-2.5 border bg-background px-3 transition-colors duration-200 ${
        focused ? 'border-[var(--primary)]' : 'border-border hover:border-[var(--foreground)]/20'
      } ${className ?? ''}`}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className={`shrink-0 transition-colors duration-200 ${focused ? 'text-[var(--primary)]' : 'text-muted-foreground group-hover:text-foreground'}`}
      >
        <circle cx="11" cy="11" r="6.5" />
        <path d="M15.5 15.5L20 20" />
      </svg>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        aria-label={placeholder}
        style={{ outline: 'none', boxShadow: 'none' }}
        className="min-w-0 flex-1 bg-transparent font-sans text-[13px] tracking-[0.01em] !outline-none focus:!outline-none focus-visible:!outline-none focus:ring-0 focus-visible:ring-0 placeholder:text-muted-foreground/60"
      />
      {value ? (
        <button
          onClick={() => {
            onChange('')
            inputRef.current?.focus()
          }}
          aria-label="Clear search"
          className="press shrink-0 p-1 font-sans text-[12px] leading-none text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>
      ) : (
        <span className="hidden select-none font-sans text-[10px] tracking-[0.08em] text-muted-foreground/40 sm:block" aria-hidden>
          ⌘K
        </span>
      )}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="animate-fade border border-dashed border-border px-6 py-14 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </div>
  )
}

/**
 * Trap Tab cycling inside `ref` while mounted, move focus to the first
 * control on open, and restore the trigger's focus on close. Nested traps
 * cooperate: an inner trap that handled the key sets defaultPrevented.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    if (!active) return
    const el = ref.current
    if (!el || typeof document === 'undefined') return
    const prev = document.activeElement as HTMLElement | null
    const isVisible = (n: HTMLElement) => {
      if (n.hasAttribute('disabled')) return false
      if (n.closest('[hidden]')) return false
      // getClientRects is layout-dependent (empty under jsdom) — fall back to
      // computed style so focusable controls are never filtered out in tests.
      if (typeof window !== 'undefined' && typeof n.getClientRects === 'function' && n.getClientRects().length > 0) {
        return true
      }
      try {
        const cs = window.getComputedStyle(n)
        return cs.display !== 'none' && cs.visibility !== 'hidden'
      } catch {
        return true
      }
    }
    const items = () =>
      [
        ...el.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter(isVisible)
    try {
      items()[0]?.focus({ preventScroll: true })
    } catch {
      /* older browsers ignore focus options */
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.defaultPrevented) return
      const list = items()
      if (list.length === 0) {
        e.preventDefault()
        return
      }
      const first = list[0] as HTMLElement
      const last = list[list.length - 1] as HTMLElement
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    el.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('keydown', onKey)
      try {
        prev?.focus?.({ preventScroll: true })
      } catch {
        prev?.focus?.()
      }
    }
  }, [ref, active])
}

/**
 * Tooltips that show on hover/focus and vanish the moment the pointer
 * leaves (the CSS fade keeps it smooth) or immediately on activation —
 * so they never get stuck open when a click moves focus elsewhere.
 */
export function useTimedTooltip() {
  const [visible, setVisible] = useState(false)
  const show = useCallback(() => {
    setVisible(true)
  }, [])
  const scheduleHide = useCallback(() => {
    setVisible(false)
  }, [])
  const hide = useCallback(() => {
    setVisible(false)
  }, [])
  return { visible, show, scheduleHide, hide }
}

export function Spinner({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      className={`animate-spin text-[var(--primary)] ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Loading"
      role="status"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  container,
  tone = 'danger',
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  container?: HTMLElement | null
  /** danger (default): red ! badge + red confirm. neutral: ink badge + primary confirm. */
  tone?: 'danger' | 'neutral'
  onConfirm: () => void
  onCancel: () => void
}) {
  const [shown, setShown] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)
  useFocusTrap(boxRef, open)

  useEffect(() => {
    if (!open) {
      setShown(false)
      return
    }
    const raf = requestAnimationFrame(() => setShown(true))
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open, onCancel])

  if (!open) return null

  const content = (
    <div
      className={`${container ? 'absolute' : 'fixed'} inset-0 z-[100] flex items-center justify-center bg-[rgba(20,19,15,0.65)] p-4 transition-opacity duration-200 ${
        shown ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={onCancel}
      onWheel={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      <div
        ref={boxRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-desc"
        className={`w-full max-w-[440px] border border-border bg-background p-6 shadow-[0_30px_90px_-20px_rgba(0,0,0,0.65)] transition-all duration-200 ${
          shown ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-2 scale-95 opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border pb-3">
          <span
            aria-hidden
            className={`flex h-7 w-7 items-center justify-center text-xs font-bold ${
              tone === 'danger'
                ? 'bg-[var(--destructive)] text-[var(--destructive-foreground)]'
                : 'bg-[var(--foreground)] text-[var(--background)]'
            }`}
          >
            {tone === 'danger' ? '!' : '?'}
          </span>
          <h3 id="confirm-dialog-title" className="font-display text-[22px] leading-none">
            {title}
          </h3>
        </div>

        <div id="confirm-dialog-desc" className="my-4 text-[13px] leading-relaxed text-muted-foreground">
          {message}
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="press border border-border px-4 py-2 font-sans text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground hover:border-[var(--foreground)] hover:text-foreground"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`press border px-4 py-2 font-sans text-[11px] font-medium uppercase tracking-[0.14em] hover:opacity-90 ${
              tone === 'danger'
                ? 'border-[var(--destructive)] bg-[var(--destructive)] text-[var(--destructive-foreground)]'
                : 'border-[var(--primary)] bg-[var(--primary)] text-primary-foreground'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(content, container ?? document.body)
}
