# CineTrack — Personal Film & Television Ledger

A local-first, archival-styled catalogue for the films and series you watch.
Track viewing states, log episodes season-by-season, rate titles, keep rewatch
histories, and read back your own statistics — all persisted to a portable
SQLite database that lives inside the project folder.

> **Local-first & private.** Your library never leaves your machine except for
> read-only metadata requests to [The Movie Database](https://www.themoviedb.org)
> (posters, synopses, cast, episode lists). No accounts, no analytics, no cloud.

---

## Features

### Library
- **Poster shelf** withDensity-aware grids, staggered entrances, and status badges
- **Statuses** — `Planned` · `Watching` · `Watched` · `Dropped` (series-only
  `Watching`; setting a show to `Watched` fills every real season while leaving
  Specials/extras untouched; back to `Planned` clears the episode log)
- **Filters** — Status chips, minimum rating (Any / 7+ / 8+ / 9+), text search
  (`⌘K` focuses it), and sorting by Recently added, Last watched, A–Z,
  My rating, or Year
- **Tabs** — All · Movies · TV · Favourites

### Catalogue entries (drawer)
- Full TMDb synopsis, genres, runtime, IMDb link, and cast reel
- **Series:** per-season episode tracking with stills, air dates, runtimes,
  season progress bars, bulk mark/unmark (unmarking a full season asks first),
  and spoiler-free mode
- **Rewatch log:** date-stamped repeat viewings with edit/remove + confirm
- **Edit Metadata:** draft-only editor (nothing saves until **Save**),
  ratings 1–10, favourite flag, watched date, custom titles/years/runtimes,
  poster overrides, personal notes, and one-click reset to TMDb
- Delete with confirmation

### Home
- Collection stats (titles, seen counts, episodes, time in seat)
- In-progress shelf, completions-only **Recently watched** ledger
- **Monthly log:** completions-per-month area chart (lazy-loaded)
- "Feeling lucky?" shuffle picks from your watchlist

### Personalisation
- Four themes — **Paper**, **Halide**, **Nitrate**, **Blueprint**
- Compact/comfortable density, adjustable grid columns, poster motion toggle,
  adult-content filter, auto-complete-series toggle
- JSON import/export with validation, plus full-archive wipe

---

## Tech stack

| Layer      | Choice                                              |
| ---------- | --------------------------------------------------- |
| UI         | React 19 + TypeScript 5.7 (strict + unused checks)  |
| Build      | Vite 8, Tailwind CSS v4                             |
| Charts     | Recharts (lazy-loaded, off the initial bundle)      |
| Storage    | `localStorage` (source of truth) + SQLite mirror   |
| SQLite     | `sql.js` (dev/preview server middleware only)       |
| Metadata   | TMDb via same-origin proxy (`/api/tmdb`)            |
| Tests      | Vitest + Testing Library + jsdom (51 tests)         |
| CI         | GitHub Actions: typecheck → tests → build           |

---

## Project structure

```
├── index.html                  # Shell + CSP/referrer meta, fonts, OG tags
├── vite.config.ts              # React/Tailwind, /api/tmdb proxy, /__data/* SQLite middleware
├── src/
│   ├── main.tsx                # Entry, error boundary, toast provider
│   ├── App.tsx                 # Shell, nav, drawer + settings mounting
│   ├── index.css               # Tailwind v4 + theme tokens + motion system
│   ├── components/
│   │   ├── Home.tsx            # Stats, in-progress, ledger, lucky picks
│   │   ├── MonthlyChart.tsx    # Lazy completions-per-month chart
│   │   ├── Discover.tsx        # TMDb search / trending / genres
│   │   ├── Library.tsx         # Shelf, tabs, filter popover, plates grid
│   │   ├── TitleDetail.tsx     # Catalogue drawer, seasons, edit + rewatch modals
│   │   ├── SettingsPanel.tsx   # Themes, columns, import/export, wipe
│   │   ├── InfoPages.tsx       # About / privacy / API info
│   │   ├── ui.tsx              # Shared primitives (badges, chips, dialogs, focus trap)
│   │   ├── Toast.tsx           # Toast provider (single live region)
│   │   └── Logo.tsx            # Brand mark + wordmark
│   ├── lib/
│   │   ├── library.ts          # Store: statuses, episodes, rewatches, metrics
│   │   ├── tmdb.ts             # Cached TMDb client (timeout + retry + abort)
│   │   ├── settings.ts         # Preferences store with schema passthrough
│   │   └── bodyLock.ts         # Ref-counted scroll lock
│   └── test/setup.ts           # localStorage + fetch mocks
├── data/cinetrack.db           # Your library (gitignored, portable)
└── .github/workflows/ci.yml    # Typecheck, tests, build
```

### Data model

Each entry (`movie:<id>` / `tv:<id>`) holds its title, year, poster, personal
rating, status, favourite flag, added/watched timestamps, runtime, per-episode
timestamps (`"season-episode" → watched-at`), total episodes, and a capped
rewatch log. Writes notify subscribers first, then persist — the UI can never
be wedged by a failing disk or network mirror.

---

## Getting started

### Prerequisites
- Node.js 22+ and npm
- A free [TMDb API key](https://www.themoviedb.org/settings/api) (v3 key or v4 token)

### Setup

```bash
npm install
```

Provide the key **either** as a `TMDB_KEY` environment variable **or** as the
contents of an `API.txt` file in the project root (already gitignored — never
commit it):

```bash
echo "your-key-here" > API.txt
```

### Run

```bash
npm run dev      # dev server on $PORT (default 8443)
npm test
npm run typecheck
npm run build
npm run preview  # serve the production build with data endpoints
```

> The catalogue (search, details, episode lists) and the SQLite mirror are
> served by the dev/preview server. A plain static host keeps full library
> tracking on `localStorage`, but TMDb features need the server. Treat
> `vite preview` (or an equivalent tiny Node host) as the production target.

---

## Design language

- **Archival paper catalogue** — Instrument Serif display, Inter UI,
  JetBrains Mono microcopy; hairline rules, stamps, and ledger mass tables
- **Two-ink system** — near-black ink + oxblood primary (per-theme), with
  fixed semantic status hues (grey / blue / green)
- **Restrained motion** — sheets settle, rules draw, plates fade; full
  `prefers-reduced-motion` support
- **Accessible** — focus-trapped dialogs with focus return, labelled inputs,
  keyboard-operable shelves, 24px+ targets, single toast live region

---

## Privacy & data

- Library + settings live in `data/cinetrack.db` (SQLite) and browser
  `localStorage`; either side can rebuild the other on startup
- The only network calls are same-origin `/api/tmdb` metadata requests
  (proxied, allowlisted, rate-limited, cached 24h) and TMDb image CDN loads
- Corrupt payloads are quarantined to `*.corrupt` backups, never deleted
- Export anytime from Settings; the database file itself is portable — copy
  the folder and your archive moves with it

---

*Metadata courtesy of The Movie Database (TMDb). This product uses the TMDb
API but is not endorsed or certified by TMDb.*
