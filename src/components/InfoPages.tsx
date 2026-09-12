import { SectionHead } from './ui'

export type InfoSlug = 'privacy' | 'api' | 'about' | 'terms'

export const INFO_LINKS: { slug: InfoSlug; label: string }[] = [
  { slug: 'about', label: 'About' },
  { slug: 'privacy', label: 'Privacy Policy' },
  { slug: 'api', label: 'API Information' },
  { slug: 'terms', label: 'Terms' },
]

const LAST_UPDATED = 'September 2026'

/** Long-form informational pages linked from the footer. */
export default function InfoPage({ slug, onBack }: { slug: InfoSlug; onBack: () => void }) {
  const meta = INFO_LINKS.find((l) => l.slug === slug)
  return (
    <div className="space-y-8">
      <SectionHead
        title={meta?.label ?? 'Information'}
        note={`Last updated ${LAST_UPDATED}`}
        right={
          <button
            onClick={onBack}
            className="press border border-border px-4 py-2 font-sans text-[11px] font-medium uppercase tracking-[0.14em] hover:border-[var(--foreground)] hover:bg-card"
          >
            ← Back
          </button>
        }
      />
      <article className="max-w-[68ch] space-y-6 text-[14px] leading-relaxed text-secondary-foreground">
        {slug === 'about' && <About />}
        {slug === 'privacy' && <Privacy />}
        {slug === 'api' && <Api />}
        {slug === 'terms' && <Terms />}
      </article>
    </div>
  )
}

function H({ children }: { children: React.ReactNode }) {
  return <h3 className="font-display text-[22px] leading-tight text-foreground">{children}</h3>
}

function About() {
  return (
    <>
      <p>
        CineTrack is a personal moving-image archive — a single place to catalogue the films and television you watch,
        track individual episodes and seasons, log rewatches, and read back your own viewing statistics over time.
      </p>
      <H>What it does</H>
      <p>
        Search The Movie Database for any title, accession it to your library, and record status, personal ratings, and
        the dates you watched. Series carry full season-and-episode state; every title supports a running rewatch log.
        A discovery feed suggests new titles based on what you have already enjoyed.
      </p>
      <H>Where your data lives</H>
      <p>
        Everything you record is stored locally in your browser and mirrored to the on-disk SQLite database at <code>data/cinetrack.db</code>
        when the local server is available. There is no remote account or third-party server holding your library — your data travels
        with the project wherever you copy or clone it. You can also export your collection as a JSON or SQLite (.db) file at any time from Settings.
      </p>
    </>
  )
}

function Privacy() {
  return (
    <>
      <p>
        CineTrack is built to collect as little as possible. This policy explains what data exists and where it is kept.
      </p>
      <H>Data stored in SQLite</H>
      <p>
        Your library — titles, ratings, watch dates, episode progress, rewatches — and your preferences are persisted in
        the local SQLite database (<code>data/cinetrack.db</code>) on your own device. This data never leaves your machine
        unless you explicitly export or move the database file.
      </p>
      <H>Third-party requests</H>
      <p>
        Title metadata, posters, and stills are retrieved via the local backend proxy from The Movie Database (themoviedb.org).
        Those upstream requests are subject to TMDb&rsquo;s own privacy policy. We do not run analytics, advertising, or
        third-party trackers.
      </p>
      <H>Cookies</H>
      <p>CineTrack sets no cookies. State is persisted in your local SQLite database.</p>
      <H>Your control</H>
      <p>
        You may export or erase your entire library from Settings at any time, or directly manage the <code>data/cinetrack.db</code>
        SQLite file.
      </p>
    </>
  )
}

function Api() {
  return (
    <>
      <p>
        CineTrack uses the public API provided by The Movie Database (TMDb) for title metadata, imagery, cast,
        and season/episode data.
      </p>
      <H>Attribution</H>
      <p>
        This product uses the TMDb API but is not endorsed or certified by TMDb. All film and television metadata,
        posters, and stills are © their respective owners and are served via TMDb.
      </p>
      <H>How the key is handled</H>
      <p>
        The TMDb API key is managed securely on the local backend server (configured via a <code>TMDB_KEY</code> environment variable or a gitignored <code>.env</code> file in the project root)
        and proxied automatically. No credentials or API keys are exposed to the client or stored in the browser.
      </p>
      <H>Rate limits</H>
      <p>
        TMDb enforces its own request rate limits. If metadata fails to load, you may have exceeded those limits
        temporarily; requests will resume automatically after a short wait.
      </p>
    </>
  )
}

function Terms() {
  return (
    <>
      <p>
        CineTrack is provided as-is for personal, non-commercial use. By using it you agree to the terms below.
      </p>
      <H>Acceptable use</H>
      <p>
        Use CineTrack to catalogue your own viewing. Do not use it to redistribute TMDb data in violation of TMDb&rsquo;s
        terms of use, and respect all applicable copyright in the metadata and imagery it displays.
      </p>
      <H>No warranty</H>
      <p>
        The application is offered without warranty of any kind. Metadata accuracy depends on TMDb, and your locally
        stored data is your responsibility — export regularly if it matters to you.
      </p>
      <H>Changes</H>
      <p>These terms may be updated as the application evolves; the date above reflects the most recent revision.</p>
    </>
  )
}
