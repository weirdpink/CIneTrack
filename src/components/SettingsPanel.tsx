import { useEffect, useRef, useState } from 'react'
import { LANGUAGES, THEMES, useSettings } from '../lib/settings'
import { minutesWatched, parseLibraryImport, useLibrary, watchedCount } from '../lib/library'
import { ConfirmDialog, Chip, useBodyScrollLock, useFocusTrap } from './ui'
import { useToast } from './Toast'

export default function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, set } = useSettings()
  const { entries, replaceAll, clear } = useLibrary()
  const { toast } = useToast()
  const [confirmWipe, setConfirmWipe] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  useFocusTrap(panelRef, open)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  useBodyScrollLock(open)

  useEffect(() => {
    if (!open) setConfirmWipe(false)
  }, [open])

  const exportLibrary = () => {
    try {
      const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `cinetrack-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast('Library exported', 'success')
    } catch {
      toast('Export failed', 'error')
    }
  }

  const exportSqliteDb = () => {
    const a = document.createElement('a')
    a.href = '/__data/db-export'
    a.download = 'cinetrack.db'
    a.click()
  }

  const importLibrary = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast('File too large — max 5 MB.', 'error')
      return
    }
    try {
      const text = await file.text()
      const { merged, imported, skipped } = parseLibraryImport(text, entries)
      replaceAll(merged)
      toast(`Imported ${imported} titles${skipped ? `, skipped ${skipped} invalid` : ''}`, skipped ? 'info' : 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That file could not be read as a CineTrack export.', 'error')
    }
  }

  const counts = {
    movie: entries.filter((e) => e.mediaType === 'movie').length,
    tv: entries.filter((e) => e.mediaType === 'tv').length,
    total: entries.length,
  }

  const episodes = entries.reduce((s, e) => s + watchedCount(e), 0)
  const minutes = minutesWatched(entries)
  const hours = Math.round(minutes / 60)
  const days = (minutes / 1440).toFixed(1)

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden
        className={`fixed inset-0 z-50 bg-[rgba(20,19,15,0.42)] transition-opacity duration-300 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        inert={!open}
        className={`quiet-scroll fixed right-0 top-0 z-50 h-full w-full max-w-[420px] overflow-y-auto border-l border-border bg-background transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-6 py-3 backdrop-blur">
          <span className="rule-label">Settings · Archive preferences</span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="press flex h-8 w-8 items-center justify-center border border-border bg-background text-muted-foreground hover:border-[var(--foreground)] hover:text-foreground"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="divide-y divide-border">
          <Group title="Theme" note="Ground and ink for the whole archive.">
            <div className="grid grid-cols-4 gap-3">
              {THEMES.map((t) => {
                const active = settings.theme === t.id
                const [ground, ink, accent] = t.swatch
                return (
                  <span key={t.id} className="min-w-0">
                    <button
                      onClick={() => set('theme', t.id)}
                      title={`${t.name} — ${t.note}`}
                      aria-label={`${t.name} theme`}
                      aria-pressed={active}
                      className="press flex aspect-square w-full items-center justify-center overflow-hidden border transition-[filter] duration-200 hover:brightness-[0.96]"
                      style={{
                        background: ground,
                        borderColor: active ? accent : `${ink}24`,
                        boxShadow: active ? `inset 0 0 0 1px ${accent}` : undefined,
                      }}
                    >
                      <span aria-hidden className="flex">
                        <span className="block h-6 w-6" style={{ background: ink }} />
                        <span aria-hidden className="block h-6 w-6" style={{ background: accent }} />
                      </span>
                    </button>
                    <span className="mt-2 flex items-center justify-center gap-1">
                      <span
                        className={`truncate font-mono text-[10px] uppercase tracking-[0.14em] ${
                          active ? '' : 'text-muted-foreground'
                        }`}
                        style={active ? { color: accent } : undefined}
                      >
                        {t.name}
                      </span>
                      {active && (
                        <span aria-hidden className="font-mono text-[10px]" style={{ color: accent }}>
                          ✓
                        </span>
                      )}
                    </span>
                  </span>
                )
              })}
            </div>
          </Group>

          <Group title="Identity" note="Name the archive and its chrome.">
            <div>
              <span className="block text-[13px]">Archive name</span>
              <span className="rule-label mt-0.5 block">Shown in the home masthead</span>
              <input
                value={settings.archiveName}
                onChange={(e) => set('archiveName', e.target.value)}
                maxLength={48}
                spellCheck={false}
                autoComplete="off"
                aria-label="Archive name"
                className="mt-2 h-9 w-full border border-border bg-card px-3 font-display text-[16px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-[var(--primary)]"
                placeholder="The Standing Collection"
              />
            </div>
            <Toggle
              label="Shortcut hints"
              note="Show keyboard hints in the navigation bar."
              value={settings.showNavHints}
              onChange={(v) => set('showNavHints', v)}
            />
          </Group>

          <Group title="Presentation" note="How plates and ledgers are laid out.">
            <NumberStepper
              label="Library items per row"
              note="Columns in library plates grid"
              value={settings.libraryColumns}
              min={3}
              max={12}
              onChange={(v) => set('libraryColumns', v)}
            />
            <NumberStepper
              label="Discover items per row"
              note="Columns in discover plates grid"
              value={settings.discoverColumns}
              min={3}
              max={12}
              onChange={(v) => set('discoverColumns', v)}
            />
            <OptionsRow
              label="Poster image quality"
              note="Data-saver fetches smaller artwork"
              value={settings.posterQuality}
              options={[
                { id: 'standard', label: 'Standard' },
                { id: 'saver', label: 'Data-saver' },
              ]}
              onChange={(v) => set('posterQuality', v)}
            />
            <OptionsRow
              label="Ledger dates"
              note="How viewing dates read in Recently watched"
              value={settings.dateStyle}
              options={[
                { id: 'absolute', label: 'Absolute' },
                { id: 'relative', label: 'Relative' },
              ]}
              onChange={(v) => set('dateStyle', v)}
            />
            <Toggle
              label="Community scores"
              note="Show TMDb vote averages beside release years."
              value={settings.showCommunityScores}
              onChange={(v) => set('showCommunityScores', v)}
            />
          </Group>

          <Group title="Tracking" note="Defaults for logging what you watch.">
            <OptionsRow
              label="New titles land in"
              note="Starting status for additions from Discover"
              value={settings.defaultStatus}
              options={[
                { id: 'planned', label: 'Planned' },
                { id: 'watching', label: 'Watching' },
              ]}
              onChange={(v) => set('defaultStatus', v)}
            />
            <Toggle
              label="Open title after adding"
              note="Jump into the title sheet right after accession."
              value={settings.openAfterAdd}
              onChange={(v) => set('openAfterAdd', v)}
            />
            <OptionsRow
              label="Watch date prefill"
              note="Date stamped when marking a title watched"
              value={settings.defaultWatchDate}
              options={[
                { id: 'today', label: 'Today' },
                { id: 'blank', label: 'Blank' },
              ]}
              onChange={(v) => set('defaultWatchDate', v)}
            />
            <Toggle
              label="Hide episode descriptions"
              note="Hide descriptions for every installment."
              value={settings.hideSpoilers}
              onChange={(v) => set('hideSpoilers', v)}
            />
          </Group>

          <Group title="Library defaults" note="Where the shelves open.">
            <OptionsRow
              label="Default shelf tab"
              note="Tab selected when Library opens"
              value={settings.defaultShelfTab}
              options={[
                { id: 'all', label: 'All' },
                { id: 'movie', label: 'Movies' },
                { id: 'tv', label: 'TV' },
                { id: 'favorites', label: 'Favourites' },
              ]}
              onChange={(v) => set('defaultShelfTab', v)}
            />
            <OptionsRow
              label="Default order"
              note="Sort applied when Library opens"
              value={settings.defaultSort}
              options={[
                { id: 'added', label: 'Recently added' },
                { id: 'lastWatched', label: 'Last watched' },
                { id: 'title', label: 'A–Z' },
                { id: 'rating', label: 'My rating' },
                { id: 'year', label: 'Year' },
              ]}
              onChange={(v) => set('defaultSort', v)}
            />
          </Group>

          <Group title="Catalogue" note="Upstream catalogue behaviour.">
            <Toggle
              label="Show adult titles"
              note="Include adult-rated movies and series in search and discover results."
              value={settings.includeAdult}
              onChange={(v) => set('includeAdult', v)}
            />
            <div>
              <span className="block text-[13px]">Metadata language</span>
              <span className="rule-label mt-0.5 block">Titles and synopses served by TMDb</span>
              <select
                value={settings.metadataLanguage}
                onChange={(e) => set('metadataLanguage', e.target.value)}
                aria-label="Metadata language"
                className="mt-2 h-9 w-full cursor-pointer border border-border bg-card px-2 text-[13px] text-foreground outline-none focus:border-[var(--primary)]"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
          </Group>

          <Group title="Holdings & storage" note="Local archive state and persistence.">
            <div className="space-y-2">
              <div className="rule-label text-[10px]">Collection Overview</div>
              <div className="grid grid-cols-3 gap-2 border border-border bg-card p-3">
                <div>
                  <dt className="rule-label text-[9px]">Movies</dt>
                  <dd className="mt-1 font-display text-[26px] leading-none tabular-nums text-foreground">{counts.movie}</dd>
                </div>
                <div>
                  <dt className="rule-label text-[9px]">Series</dt>
                  <dd className="mt-1 font-display text-[26px] leading-none tabular-nums text-foreground">{counts.tv}</dd>
                </div>
                <div>
                  <dt className="rule-label text-[9px]">Total</dt>
                  <dd className="mt-1 font-display text-[26px] leading-none tabular-nums text-foreground">{counts.total}</dd>
                </div>
                <div>
                  <dt className="rule-label text-[9px]">Episodes</dt>
                  <dd className="mt-1 font-display text-[26px] leading-none tabular-nums text-foreground">{episodes}</dd>
                </div>
                <div>
                  <dt className="rule-label text-[9px]">Hours</dt>
                  <dd className="mt-1 font-display text-[26px] leading-none tabular-nums text-foreground">{hours}</dd>
                </div>
                <div>
                  <dt className="rule-label text-[9px]">Days</dt>
                  <dd className="mt-1 font-display text-[26px] leading-none tabular-nums text-foreground">{days}</dd>
                </div>
              </div>
            </div>

            <div className="pt-2">
              <div className="rule-label mb-2 text-[10px]">Database Engine</div>
              <div className="flex items-center justify-between gap-3 border border-border bg-card p-3">
                <div className="min-w-0">
                  <div className="font-mono text-[11px] font-medium text-foreground">data/cinetrack.db</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">Local SQLite storage</div>
                </div>
                <button
                  type="button"
                  onClick={exportSqliteDb}
                  className="press shrink-0 border border-border bg-background px-3 py-1.5 font-sans text-[11px] font-medium uppercase tracking-[0.14em] text-foreground hover:border-[var(--foreground)] hover:bg-card"
                >
                  Export .db
                </button>
              </div>
            </div>

            <div className="pt-2">
              <div className="rule-label mb-2 text-[10px]">Backup &amp; Portability</div>
            <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={exportLibrary}
                  className="press flex items-center justify-center border border-border bg-card py-2 font-sans text-[11px] font-medium uppercase tracking-[0.14em] text-foreground hover:border-[var(--foreground)] hover:bg-background"
                >
                  Export JSON
                </button>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="press flex items-center justify-center border border-border bg-card py-2 font-sans text-[11px] font-medium uppercase tracking-[0.14em] text-foreground hover:border-[var(--foreground)] hover:bg-background"
                >
                  Import JSON
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) importLibrary(f)
                    e.target.value = ''
                  }}
                />
              </div>
            </div>

            <div className="pt-3 border-t border-border">
              <div className="rule-label mb-2 text-[10px] text-[var(--destructive)]">Danger Zone</div>
              <button
                type="button"
                onClick={() => setConfirmWipe(true)}
                className="press flex w-full items-center justify-center border border-[var(--destructive)] bg-[var(--destructive)] py-2 font-sans text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--destructive-foreground)] hover:opacity-90"
              >
                Erase entire library
              </button>
            </div>
          </Group>
        </div>

        <ConfirmDialog
          open={confirmWipe}
          title="Erase Entire Archive"
          message={
            <span>
              This will permanently delete all <strong>{entries.length}</strong> titles and logged episodes from your local database.
              Export a backup before proceeding if you want to preserve your records.
            </span>
          }
          confirmLabel="Erase all records"
          onCancel={() => setConfirmWipe(false)}
          onConfirm={() => {
            clear()
            setConfirmWipe(false)
          }}
        />
      </aside>
    </>
  )
}

function Group({
  title,
  note,
  children,
}: {
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <section className="px-6 py-6">
      <div className="mb-4">
        <h3 className="font-display text-[22px] leading-none">{title}</h3>
        {note && <p className="mt-1 text-[12px] text-muted-foreground">{note}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function Toggle({
  label,
  note,
  value,
  onChange,
}: {
  label: string
  note: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className="flex w-full items-center justify-between gap-4 text-left"
    >
      <span>
        <span className="block text-[13px]">{label}</span>
        <span className="rule-label">{note}</span>
      </span>
      <span
        className={`relative box-border block h-5 w-10 shrink-0 border transition-colors ${
          value ? 'border-[var(--primary)] bg-[var(--primary)]' : 'border-border bg-secondary'
        }`}
      >
        <span
          className={`absolute left-0 top-[2px] block h-[14px] w-[14px] transition-transform duration-200 ${
            value ? 'translate-x-[22px] bg-[var(--primary-foreground)]' : 'translate-x-[2px] bg-background'
          }`}
        />
      </span>
    </button>
  )
}

/** Labelled single-choice chip row bound to a string-union setting. */
function OptionsRow<T extends string>({
  label,
  note,
  value,
  options,
  onChange,
}: {
  label: string
  note?: string
  value: T
  options: { id: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div>
      <span className="block text-[13px]">{label}</span>
      {note && <span className="rule-label mt-0.5 block">{note}</span>}
      <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <Chip key={o.id} role="radio" active={value === o.id} onClick={() => onChange(o.id)}>
            {o.label}
          </Chip>
        ))}
      </div>
    </div>
  )
}

function NumberStepper({
  label,
  note,
  value,
  min = 3,
  max = 12,
  onChange,
}: {
  label: string
  note?: string
  value: number
  min?: number
  max?: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <span className="block text-[13px]">{label}</span>
        {note && <span className="rule-label mt-0.5 block text-[10px]">{note}</span>}
      </div>
      <div className="flex items-center border border-border bg-card">
        <button
          type="button"
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
          aria-label={`Decrease ${label}`}
          className="press flex h-7 w-7 items-center justify-center font-sans text-[13px] font-medium text-muted-foreground hover:bg-background hover:text-foreground disabled:pointer-events-none disabled:opacity-25"
        >
          −
        </button>
        <span className="flex h-7 w-8 items-center justify-center border-x border-border font-mono text-[11px] font-medium tabular-nums text-foreground">
          {value}
        </span>
        <button
          type="button"
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
          aria-label={`Increase ${label}`}
          className="press flex h-7 w-7 items-center justify-center font-sans text-[13px] font-medium text-muted-foreground hover:bg-background hover:text-foreground disabled:pointer-events-none disabled:opacity-25"
        >
          +
        </button>
      </div>
    </div>
  )
}
