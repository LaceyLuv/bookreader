// @vitest-environment jsdom
import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import Dashboard from './Dashboard'

vi.mock('../hooks/useReadingProgress', () => ({
    getBookProgress: () => null,
}))

vi.mock('../i18n', () => ({
    createT: () => (key) => key,
}))

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom')
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    }
})

function createJsonResponse(body) {
    return {
        ok: true,
        status: 200,
        json: async () => body,
    }
}

beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = String(input)
        const book = {
            id: 'book-1',
            title: 'Clean Upload',
            filename: 'Clean Upload.epub',
            stored_filename: '9f3c2a1b-Clean Upload.epub',
            file_type: 'epub',
            reading_status: 'unread',
            size: 1024,
            upload_date: '2026-04-13T00:00:00.000Z',
            author: '',
            favorite: false,
            pinned: false,
            annotation_count: 0,
            tags: [],
            collections: [],
            library_folder_id: null,
            library_folder_name: null,
        }

        if (url.endsWith('/api/books')) {
            return createJsonResponse([book])
        }

        if (url.endsWith('/api/library/folders')) {
            return createJsonResponse([])
        }

        if (url.endsWith('/api/books/book-1')) {
            return createJsonResponse({
                ...book,
                path: '/books/9f3c2a1b-Clean Upload.epub',
            })
        }

        throw new Error(`Unexpected fetch call: ${url}`)
    })
})

test('file info keeps the original filename visible and hides storage-only details', async () => {
    const user = userEvent.setup()

    render(
        <MemoryRouter>
            <Dashboard />
        </MemoryRouter>,
    )

    await screen.findByText('Clean Upload')
    await user.click(screen.getByRole('button', { name: 'info' }))

    await screen.findByRole('heading', { name: 'Clean Upload' })
    expect(screen.getByText('Clean Upload.epub')).toBeTruthy()
    expect(screen.queryByText('9f3c2a1b-Clean Upload.epub')).toBeNull()
    expect(screen.queryByText('/books/9f3c2a1b-Clean Upload.epub')).toBeNull()
})
