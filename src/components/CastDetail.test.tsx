import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CastDetail from './CastDetail'
import { __clearTmdbCache } from '../lib/tmdb'

const PERSON = {
  id: 500,
  name: 'Test Actor',
  biography: 'A storied career.',
  birthday: '1970-01-15',
  deathday: null,
  place_of_birth: 'London',
  profile_path: '/face.jpg',
  known_for_department: 'Acting',
  popularity: 10,
}

const CREDITS = {
  cast: [
    {
      id: 10,
      media_type: 'movie',
      title: 'Dune',
      poster_path: '/dune.jpg',
      character: 'Paul',
      release_date: '2021-10-22',
      popularity: 9,
    },
  ],
}

function mockFetch() {
  vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: any) => {
    const url = String(typeof input === 'string' ? input : (input?.url ?? input))
    if (url.includes('/combined_credits')) {
      return new Response(JSON.stringify(CREDITS), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.includes('/person/')) {
      return new Response(JSON.stringify(PERSON), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    throw new Error(`unexpected fetch ${url}`)
  }) as typeof fetch)
}

beforeEach(() => {
  mockFetch()
})

afterEach(() => {
  vi.restoreAllMocks()
  __clearTmdbCache()
})

describe('CastDetail', () => {
  it('shows the profile, facts, biography, and credits', async () => {
    const noop = () => {}
    render(<CastDetail personId={500} onClose={noop} onOpenTitle={noop} />)

    expect(await screen.findByText('A storied career.')).toBeInTheDocument()
    expect(screen.getAllByText('Test Actor')).toHaveLength(2)
    expect(screen.getByText('Born 15 Jan 1970 · London')).toBeInTheDocument()
    expect(screen.getByText('Dune')).toBeInTheDocument()
  })

  it('opens the title when a credit is clicked', async () => {
    const user = userEvent.setup()
    const onOpenTitle = vi.fn()
    const noop = () => {}
    render(<CastDetail personId={500} onClose={noop} onOpenTitle={onOpenTitle} />)

    await user.click(await screen.findByRole('button', { name: 'Open Dune' }))
    expect(onOpenTitle).toHaveBeenCalledWith('movie', 10)
  })

  it('shows a retry affordance when loading fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.reject(new Error('Down')));
    const noop = () => {}
    render(<CastDetail personId={500} onClose={noop} onOpenTitle={noop} />)

    expect(await screen.findByText(/Cast file failed to load/)).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    })
  })
})
