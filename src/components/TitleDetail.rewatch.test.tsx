import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { ToastProvider } from './Toast'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TitleDetail from './TitleDetail'
import { useLibrary } from '../lib/library'
import { __clearTmdbCache } from '../lib/tmdb'

const SEED = {
  id: 99,
  media_type: 'tv',
  title: 'The Batman',
  name: 'The Batman',
  poster_path: '/p.jpg',
  backdrop_path: null,
  overview: 'Vengeance.',
  vote_average: 7.5,
  first_air_date: '2022-03-01',
}

const DETAIL = {
  ...SEED,
  overview: 'Loaded from TMDb.',
  genres: [],
  seasons: [
    { id: 101, season_number: 1, name: 'Season 1', episode_count: 2, air_date: '2022-01-01', poster_path: null },
    { id: 100, season_number: 0, name: 'Specials', episode_count: 1, air_date: '2022-06-01', poster_path: null },
  ],
  credits: { cast: [] },
  number_of_episodes: 3,
}

const MOVIE_SEED = {
  id: 101,
  media_type: 'movie',
  title: 'The Maze Runner',
  poster_path: '/m.jpg',
  backdrop_path: null,
  overview: 'Maze.',
  vote_average: 7,
  release_date: '2014-09-10',
}

let failNextSeasonFetch = false

function mockFetch() {
  vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: any) => {
    const url = String(typeof input === 'string' ? input : (input?.url ?? input))
    if (url.includes('/__data/')) {
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.includes('/season/')) {
      if (failNextSeasonFetch) {
        failNextSeasonFetch = false
        return Promise.reject(new Error('Season exploded'))
      }
      return new Response(
        JSON.stringify({
          episodes: [
            { id: 1, episode_number: 1, season_number: 1, name: 'Pilot', overview: '', still_path: null, air_date: '2022-01-01', runtime: 22 },
            { id: 2, episode_number: 2, season_number: 1, name: 'Second', overview: '', still_path: null, air_date: '2022-01-08', runtime: 22 },
          ],
          name: 'Season 1',
          overview: '',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }
    if (url.includes('/api/tmdb/')) {
      return new Response(JSON.stringify(DETAIL), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    throw new Error(`unexpected fetch ${url}`)
  }) as typeof fetch)
}

afterEach(() => {
  vi.restoreAllMocks()
  __clearTmdbCache()
})

async function seedEntry() {
  let api: ReturnType<typeof useLibrary> | null = null
  function Probe() {
    api = useLibrary()
    return null
  }
  const probe = render(<Probe />)
  await act(async () => {
    api!.clear()
  })
  await act(async () => {
    api!.upsert('tv', 99, { status: 'watching' }, SEED as any)
  })
  await act(async () => {
    api!.upsert('movie', 101, { status: 'planned' }, MOVIE_SEED as any)
  })
  probe.unmount()
}

beforeEach(async () => {
  failNextSeasonFetch = false
  mockFetch()
  await seedEntry()
})

describe('RewatchModal live updates', () => {
  it('loads catalogue data under StrictMode remount instead of sticking on the seed fallback', async () => {
    render(
      <StrictMode>
        <TitleDetail type="tv" id={99} seed={SEED as any} onClose={() => {}} />
      </StrictMode>,
    )
    // First effect's shared request is aborted by the StrictMode remount;
    // the second effect must still resolve with TMDb data.
    expect(await screen.findByText('Loaded from TMDb.', {}, { timeout: 3000 })).toBeInTheDocument()
  })

  it('closes the edit modal on the first Save click', async () => {
    const user = userEvent.setup()
    render(
      <ToastProvider>
        <StrictMode>
          <TitleDetail type="movie" id={101} seed={MOVIE_SEED as any} onClose={() => {}} />
        </StrictMode>
      </ToastProvider>,
    )

    await user.click(await screen.findByRole('button', { name: 'Edit metadata' }))
    // Make a change so there is something to save.
    await user.click(await screen.findByRole('radio', { name: 'Rate 7' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.queryByText('Personal notes / review')).not.toBeInTheDocument()
    })
  })

  it('saves with the Enter key from a text field', async () => {
    const user = userEvent.setup()
    render(<TitleDetail type="movie" id={101} seed={MOVIE_SEED as any} onClose={() => {}} />)

    await user.click(await screen.findByRole('button', { name: 'Edit metadata' }))
    const titleInput = screen.getByLabelText('Title')
    await user.clear(titleInput)
    await user.type(titleInput, 'The Maze Runner{enter}')

    await waitFor(() => {
      expect(screen.queryByText('Personal notes / review')).not.toBeInTheDocument()
    })
  })

  it('hides Watching for movies but offers it for series', async () => {
    const user = userEvent.setup()
    render(<TitleDetail type="movie" id={101} seed={MOVIE_SEED as any} onClose={() => {}} />)

    await user.click(await screen.findByRole('button', { name: /Status:/ }))
    expect(screen.queryByText('watching')).not.toBeInTheDocument()
    expect(screen.getByText('planned')).toBeInTheDocument()
    expect(screen.getByText('watched')).toBeInTheDocument()
    expect(screen.getByText('dropped')).toBeInTheDocument()
  })

  it('offers Watching for series', async () => {
    const user = userEvent.setup()
    render(<TitleDetail type="tv" id={99} seed={SEED as any} onClose={() => {}} />)

    await user.click(await screen.findByRole('button', { name: /Status:/ }))
    expect(screen.getByText('watching')).toBeInTheDocument()
  })

  it('marking a show watched in the editor fills every season except Specials', async () => {
    const user = userEvent.setup()
    const { result } = renderHook(() => useLibrary())
    render(<TitleDetail type="tv" id={99} seed={SEED as any} onClose={() => {}} />)

    await user.click(await screen.findByRole('button', { name: 'Edit metadata' }))
    await user.click(await screen.findByRole('button', { name: 'Mark watched' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.queryByText('Personal notes / review')).not.toBeInTheDocument()
    })
    expect(result.current.get('tv', 99)?.status).toBe('watched')
    expect(result.current.get('tv', 99)?.episodes).toEqual({ '1-1': expect.any(Number), '1-2': expect.any(Number) })
  })

  it('switching a show back to planned in the editor clears the episode log', async () => {
    const user = userEvent.setup()
    const { result } = renderHook(() => useLibrary())
    await act(async () => {
      result.current.upsert('tv', 99, { status: 'watched', watchedAt: 1000, episodes: { '1-1': 1000, '1-2': 2000 } })
    })
    render(<TitleDetail type="tv" id={99} seed={SEED as any} onClose={() => {}} />)

    await user.click(await screen.findByRole('button', { name: 'Edit metadata' }))
    await user.click(await screen.findByRole('button', { name: 'Watched' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.queryByText('Personal notes / review')).not.toBeInTheDocument()
    })
    expect(result.current.get('tv', 99)?.status).toBe('planned')
    expect(result.current.get('tv', 99)?.episodes).toEqual({})
  })

  it('shows a newly logged rewatch without closing the modal', async () => {
    const user = userEvent.setup()
    render(<TitleDetail type="tv" id={99} seed={SEED as any} onClose={() => {}} />)

    await user.click(await screen.findByRole('button', { name: 'Rewatches' }))
    expect(await screen.findByText('No rewatches logged yet')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '+ Log rewatch' }))

    await waitFor(() => {
      expect(screen.queryByText('No rewatches logged yet')).not.toBeInTheDocument()
    })
    expect(screen.getByLabelText('Remove rewatch')).toBeInTheDocument()
  })

  it('still updates live when the sqlite mirror throws synchronously', async () => {
    const user = userEvent.setup()
    render(<TitleDetail type="tv" id={99} seed={SEED as any} onClose={() => {}} />)

    await user.click(await screen.findByRole('button', { name: 'Rewatches' }))
    expect(await screen.findByText('No rewatches logged yet')).toBeInTheDocument()

    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('mirror blocked')
    })
    await user.click(screen.getByRole('button', { name: '+ Log rewatch' }))

    await waitFor(() => {
      expect(screen.queryByText('No rewatches logged yet')).not.toBeInTheDocument()
    })
    expect(screen.getByLabelText('Remove rewatch')).toBeInTheDocument()
  })

  it('asks before discarding a dirty edit, and keeps editing on cancel', async () => {
    const user = userEvent.setup()
    render(<TitleDetail type="movie" id={101} seed={MOVIE_SEED as any} onClose={() => {}} />)

    await user.click(await screen.findByRole('button', { name: 'Edit metadata' }))
    await user.click(await screen.findByRole('radio', { name: 'Rate 7' }))
    await user.click(screen.getByRole('button', { name: 'Close editor' }))

    expect(await screen.findByText('You have unsaved edits. Close without saving them?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    // Still editing: the draft survived.
    expect(screen.getByText('Personal notes / review')).toBeInTheDocument()
  })

  it('discarding from the confirm closes without saving', async () => {
    const user = userEvent.setup()
    const { result } = renderHook(() => useLibrary())
    await act(async () => {
      result.current.upsert('movie', 101, { rating: null })
    })
    render(<TitleDetail type="movie" id={101} seed={MOVIE_SEED as any} onClose={() => {}} />)

    await user.click(await screen.findByRole('button', { name: 'Edit metadata' }))
    await user.click(await screen.findByRole('radio', { name: 'Rate 7' }))
    await user.click(screen.getByRole('button', { name: 'Close editor' }))
    await user.click(await screen.findByRole('button', { name: 'Discard' }))

    await waitFor(() => {
      expect(screen.queryByText('Personal notes / review')).not.toBeInTheDocument()
    })
    expect(result.current.get('movie', 101)?.rating).toBeNull()
  })

  it('bulk season unmark needs two clicks and clears the log', async () => {
    const user = userEvent.setup()
    const { result } = renderHook(() => useLibrary())
    render(<TitleDetail type="tv" id={99} seed={SEED as any} onClose={() => {}} />)

    await user.click(await screen.findByRole('button', { name: 'Mark season watched' }))
    await waitFor(() => {
      expect(Object.keys(result.current.get('tv', 99)?.episodes ?? {})).toHaveLength(2)
    })
    await user.click(await screen.findByRole('button', { name: /Season watched/ }))
    expect(await screen.findByRole('button', { name: 'Click again to unmark' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Click again to unmark' }))
    await waitFor(() => {
      expect(result.current.get('tv', 99)?.episodes).toEqual({})
    })
  })

  it('shows a retry affordance when season episodes fail to load', async () => {
    failNextSeasonFetch = true
    const user = userEvent.setup()
    render(<TitleDetail type="tv" id={99} seed={SEED as any} onClose={() => {}} />)

    expect(await screen.findByText(/Episodes failed to load/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => {
      expect(screen.queryByText(/Episodes failed to load/)).not.toBeInTheDocument()
    })
  })

  it('keeps Tab focus inside the status dialog', async () => {
    const user = userEvent.setup()
    render(<TitleDetail type="tv" id={99} seed={SEED as any} onClose={() => {}} />)

    await user.click(await screen.findByRole('button', { name: /Status:/ }))
    const dialog = await screen.findByRole('dialog', { name: /Status —/ })
    for (let i = 0; i < 8; i++) {
      await user.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
  })
})
