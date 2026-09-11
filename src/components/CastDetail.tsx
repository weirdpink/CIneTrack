import { useCallback, useEffect, useRef, useState } from 'react'
import { img, person, personCredits, type MediaType, type PersonCredit, type PersonDetail } from '../lib/tmdb'
import { useSettings } from '../lib/settings'
import { useFocusTrap } from './ui'
import { Spinner } from './ui'

const creditTitle = (c: PersonCredit) => c.title ?? c.name ?? 'Untitled'
/** First billed role only — full slash-lists ("A / B / C (Voice)") blow out rows. */
const shortRole = (c: PersonCredit) => (c.character ?? '').split('/')[0]?.trim() ?? ''

function formatBirthday(raw: string | null): string | null {
  if (!raw) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw)
  if (!m) return raw
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export default function CastDetail({
  personId,
  onClose,
  onOpenTitle,
}: {
  personId: number
  onClose: () => void
  onOpenTitle: (type: MediaType, id: number) => void
}) {
  const [data, setData] = useState<PersonDetail | null>(null)
  const [credits, setCredits] = useState<PersonCredit[]>([])
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [shown, setShown] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)
  useFocusTrap(boxRef)
  const closeTimer = useRef<number | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const metadataLanguage = useSettings().settings.metadataLanguage

  const close = useCallback(() => {
    setShown(false)
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => onCloseRef.current(), 200)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let live = true
    setData(null)
    setCredits([])
    setError(null)
    Promise.all([person(personId, { signal: controller.signal }), personCredits(personId, { signal: controller.signal })])
      .then(([p, c]) => {
        if (!live) return
        setData(p)
        setCredits([...(c.cast ?? [])].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0)).slice(0, 12))
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : 'Failed to load cast file')
      })
    return () => {
      live = false
      controller.abort()
    }
  }, [personId, attempt, metadataLanguage])

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

  useEffect(
    () => () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current)
    },
    [],
  )

  const born = data ? formatBirthday(data.birthday) : null
  const facts = data
    ? [
        data.known_for_department,
        born ? `Born ${born}${data.place_of_birth ? ` · ${data.place_of_birth}` : ''}` : data.place_of_birth,
        data.deathday ? `Died ${formatBirthday(data.deathday) ?? data.deathday}` : null,
      ].filter(Boolean)
    : []

  return (
    <div
      className={`absolute inset-0 z-[70] flex items-center justify-center bg-[rgba(20,19,15,0.65)] p-3 sm:p-4 transition-opacity duration-200 ease-out ${
        shown ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={close}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label={data ? `Cast file — ${data.name}` : 'Cast file'}
        className={`flex h-[min(82vh,600px)] w-full max-w-[560px] origin-center flex-col border border-border bg-background shadow-[0_30px_90px_-20px_rgba(0,0,0,0.65)] transition-[opacity,transform] duration-200 will-change-[opacity,transform] [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${
          shown ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-2 scale-[0.96] opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4.5 py-3">
          <div className="min-w-0 pr-2">
            <span className="rule-label block text-[var(--primary)] text-[10px]">Cast file</span>
            <span className="mt-0.5 block truncate font-display text-[18px] leading-tight">{data?.name ?? '…'}</span>
          </div>
          <button
            type="button"
            onClick={close}
            className="press flex h-8 w-8 shrink-0 items-center justify-center border border-border text-muted-foreground hover:border-[var(--foreground)] hover:text-foreground"
            aria-label="Close cast file"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="quiet-scroll min-h-0 flex-1 overflow-y-auto px-4.5 py-4">
          {error && !data && (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="rule-label">Cast file failed to load · {error}</p>
              <button
                type="button"
                onClick={() => setAttempt((a) => a + 1)}
                className="press border border-border px-5 py-2 font-sans text-[11px] font-medium uppercase tracking-[0.14em] hover:border-[var(--foreground)]"
              >
                Retry
              </button>
            </div>
          )}
          {!error && !data && (
            <div className="flex items-center justify-center py-16">
              <Spinner size={30} />
            </div>
          )}
          {data && (
            <div className="animate-fade">
              <div className="flex gap-4">
                <div className="w-[112px] shrink-0 overflow-hidden border border-border bg-muted">
                  {img(data.profile_path, 'w185') ? (
                    <img
                      src={img(data.profile_path, 'w185')!}
                      alt={data.name}
                      loading="lazy"
                      decoding="async"
                      width={185}
                      height={278}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex aspect-[2/3] w-full items-center justify-center font-display text-[34px] text-muted-foreground">
                      {data.name.slice(0, 1)}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-display text-[26px] leading-tight tracking-tight">{data.name}</h3>
                  {facts.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {facts.map((f, i) => (
                        <li key={i} className="font-mono text-[11px] tracking-[0.06em] text-muted-foreground">
                          {f}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              {data.biography ? (
                <p className="mt-4 text-[13px] leading-relaxed text-secondary-foreground">{data.biography}</p>
              ) : (
                <p className="rule-label mt-4">No biography on file</p>
              )}
              {credits.length > 0 && (
                <div className="mt-5 border-t border-border pt-4">
                  <span className="rule-label block text-[var(--primary)] text-[10px]">Known for</span>
                  <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4">
                    {credits.map((c) => {
                      const type: MediaType = c.media_type ?? (c.title ? 'movie' : 'tv')
                      return (
                        <button
                          key={`${type}-${c.id}`}
                          type="button"
                          onClick={() => onOpenTitle(type, c.id)}
                          aria-label={`Open ${creditTitle(c)}`}
                          className="press group text-left"
                        >
                          <span className="block aspect-[2/3] w-full overflow-hidden border border-border bg-muted transition-colors group-hover:border-[var(--foreground)]">
                            {img(c.poster_path, 'w185') ? (
                              <img
                                src={img(c.poster_path, 'w185')!}
                                alt=""
                                loading="lazy"
                                decoding="async"
                                width={185}
                                height={278}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <span className="flex h-full items-center justify-center p-1 text-center font-display text-[13px] text-muted-foreground">
                                {creditTitle(c)}
                              </span>
                            )}
                          </span>
                          <span className="mt-1.5 block truncate font-display text-[14px] leading-tight group-hover:text-[var(--primary)]">
                            {creditTitle(c)}
                          </span>
                          <span className="rule-label mt-0.5 block truncate">
                            {shortRole(c) || '—'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
