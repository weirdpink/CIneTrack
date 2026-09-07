import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { type MediaType, type TmdbTitle } from './lib/tmdb'
import { useLibrary } from './lib/library'
import { Logo, Mark } from './components/Logo'
import { Spinner } from './components/ui'
import InfoPage, { INFO_LINKS, type InfoSlug } from './components/InfoPages'

const Home = lazy(() => import('./components/Home'))
const Discover = lazy(() => import('./components/Discover'))
const Library = lazy(() => import('./components/Library'))
const TitleDetail = lazy(() => import('./components/TitleDetail'))
const SettingsPanel = lazy(() => import('./components/SettingsPanel'))

type Page = 'home' | 'discover' | 'library'

const NAV: { id: Page; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'discover', label: 'Discover' },
  { id: 'library', label: 'Library' },
]

export default function App() {
  const [page, setPage] = useState<Page>(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash.slice(1) : ''
    if (hash === 'discover' || hash === 'library' || hash === 'home') return hash as Page
    return 'home'
  })
  const [info, setInfo] = useState<InfoSlug | null>(null)
  const [open, setOpen] = useState<{ type: MediaType; id: number; seed?: TmdbTitle } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { entries } = useLibrary()

  useEffect(() => {
    const h = page === 'home' ? '' : `#${page}`
    if (typeof window !== 'undefined' && window.location.hash !== h) {
      history.replaceState(null, '', `${window.location.pathname}${window.location.search}${h}`)
    }
  }, [page])

  useEffect(() => {
    const onHash = () => {
      const hash = window.location.hash.slice(1) as Page
      if (hash === 'discover' || hash === 'library' || hash === 'home') setPage(hash)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const openTitle = useCallback((type: MediaType, id: number, seed?: TmdbTitle) => setOpen({ type, id, seed }), [])
  const goPage = (p: Page) => {
    setInfo(null)
    setPage(p)
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/92 backdrop-blur">
        {/* Three tracks so the nav sits optically centred regardless of side widths. */}
        <div className="grid w-full grid-cols-2 items-center gap-3 px-6 py-3 md:grid-cols-[1fr_auto_1fr] md:gap-4 lg:px-10 xl:px-12">
          <button onClick={() => goPage('home')} aria-label="Go to home" className="press justify-self-start text-left">
            <Logo size={24} markSize={34} />
          </button>

          <nav className="quiet-scroll order-3 col-span-2 flex items-center justify-center gap-1 overflow-x-auto md:order-none md:col-span-1 md:col-start-2">
            {NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => goPage(n.id)}
                aria-current={page === n.id && !info ? 'page' : undefined}
                className={`relative px-3 pb-2 pt-1.5 font-sans text-[11px] font-medium uppercase tracking-[0.14em] transition-colors duration-200 ${
                  page === n.id && !info ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {n.label}
                <span
                  aria-hidden
                  className={`absolute inset-x-0 bottom-0 h-[2px] origin-left bg-[var(--primary)] transition-transform duration-300 ease-out ${
                    page === n.id && !info ? 'scale-x-100' : 'scale-x-0'
                  }`}
                />
              </button>
            ))}
          </nav>

          <div className="flex items-center justify-end gap-4">
            <span className="rule-label hidden lg:inline">{entries.length} titles held</span>
            <button
              onClick={() => setSettingsOpen(true)}
              aria-label="Open settings"
              title="Settings & themes"
              className="press group flex h-8 w-8 items-center justify-center border border-border text-muted-foreground hover:border-[var(--foreground)] hover:bg-card hover:text-foreground"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="transition-transform duration-500 group-hover:rotate-90"
                aria-hidden="true"
              >
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main className="w-full flex-1 px-6 pb-12 pt-6 lg:px-10 lg:pb-16 lg:pt-8 xl:px-12">
        <Suspense
          fallback={
            <div className="flex min-h-[40vh] items-center justify-center">
              <Spinner size={28} />
            </div>
          }
        >
          <div className="page-enter">
            {info ? (
              <InfoPage slug={info} onBack={() => setInfo(null)} />
            ) : (
              <>
                {page === 'home' && <Home onOpen={openTitle} />}
                {page === 'discover' && <Discover onOpen={openTitle} />}
                {page === 'library' && <Library onOpen={openTitle} />}
              </>
            )}
          </div>
        </Suspense>
      </main>

      <Footer entries={entries.length} onInfo={setInfo} onSettings={() => setSettingsOpen(true)} />

      <Suspense fallback={null}>
        <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        {open && <TitleDetail type={open.type} id={open.id} seed={open.seed} onClose={() => setOpen(null)} />}
      </Suspense>
    </div>
  )
}

function Footer({
  entries,
  onInfo,
  onSettings,
}: {
  entries: number
  onInfo: (slug: InfoSlug) => void
  onSettings: () => void
}) {
  return (
    <footer className="border-t border-border bg-card">
      <div className="grid w-full gap-10 px-6 py-12 lg:grid-cols-[1.4fr_1fr_1fr] lg:px-10 xl:px-12">
        <div>
          <Mark size={34} />
          <p className="mt-4 max-w-[36ch] text-[13px] leading-relaxed text-muted-foreground">
            A personal moving-image archive for the films and series you watch — catalogued, tracked, and stored in
            your local SQLite database.
          </p>
          <p className="rule-label mt-4">{entries} titles held · Stored in SQLite (data/cinetrack.db)</p>
        </div>

        <nav className="flex flex-col gap-2.5">
          <span className="rule-label mb-1">Information</span>
          {INFO_LINKS.map((l) => (
            <button
              key={l.slug}
              onClick={() => onInfo(l.slug)}
              className="link-draw self-start font-sans text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground"
            >
              {l.label}
            </button>
          ))}
        </nav>

        <nav className="flex flex-col gap-2.5">
          <span className="rule-label mb-1">Elsewhere</span>
          <button
            onClick={onSettings}
            className="link-draw self-start font-sans text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground"
          >
            Settings &amp; themes
          </button>
          <a
            href="https://www.themoviedb.org"
            target="_blank"
            rel="noopener noreferrer"
            className="link-draw self-start font-sans text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground"
          >
            The Movie Database ↗
          </a>
        </nav>
      </div>

      <div className="border-t border-border">
        <div className="flex w-full flex-wrap items-center justify-between gap-x-8 gap-y-2 px-6 py-5 lg:px-10 xl:px-12">
          <span className="rule-label">© {new Date().getFullYear()} CineTrack</span>
          <span className="rule-label">Metadata courtesy of The Movie Database · Not endorsed or certified by TMDb</span>
        </div>
      </div>
    </footer>
  )
}
