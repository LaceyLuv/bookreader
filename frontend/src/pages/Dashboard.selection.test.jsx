// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import Dashboard from './Dashboard'

vi.mock('../hooks/useReadingProgress', () => ({
    clearLocalBookProgress: vi.fn(),
    getBookProgress: () => null,
    pruneLocalBookProgress: vi.fn(),
}))

vi.mock('../i18n', () => ({
    createT: () => (key) => key,
}))

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom')
    return {
        ...actual,
        useNavigate: () => vi.fn(),
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
    const book = {
        id: 'book-1',
        title: 'Clean Upload',
        filename: 'Clean Upload.epub',
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

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = String(input)
        if (url.endsWith('/api/books')) return createJsonResponse([book])
        if (url.endsWith('/api/library/folders')) return createJsonResponse([])
        if (url.endsWith('/api/fonts')) return createJsonResponse([])
        throw new Error(`Unexpected fetch call: ${url}`)
    })
})

test('finishing selection exposes bulk actions on the library screen and moves focus to them', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><Dashboard /></MemoryRouter>)

    await screen.findByText('Clean Upload')
    await user.click(screen.getByRole('button', { name: 'librarySettings' }))
    await user.click(await screen.findByRole('checkbox', { name: 'selectionMode' }))

    const bookSelection = screen.getByRole('checkbox', { name: 'selection: Clean Upload' })
    const finishSelection = screen.getByRole('button', { name: 'finishSelection' })
    expect(finishSelection.disabled).toBe(false)

    await user.click(bookSelection)
    await user.click(finishSelection)

    const actions = screen.getByRole('region', { name: 'selectedBooks' })
    expect(document.activeElement).toBe(actions)
    expect(screen.queryByRole('checkbox', { name: 'selection: Clean Upload' })).toBeNull()
    expect(within(actions).getByRole('combobox', { name: 'libraryFolder' })).toBeTruthy()
    expect(within(actions).getByRole('button', { name: 'moveSelected' })).toBeTruthy()

    await user.click(within(actions).getByRole('button', { name: 'editSelection' }))
    expect(screen.getByRole('checkbox', { name: 'selection: Clean Upload' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'selectedBooks' })).toBeNull()
})

test('selection mode can be finished from the library without selecting a book', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><Dashboard /></MemoryRouter>)

    await screen.findByText('Clean Upload')
    await user.click(screen.getByRole('button', { name: 'librarySettings' }))
    await user.click(await screen.findByRole('checkbox', { name: 'selectionMode' }))
    await user.click(screen.getByRole('button', { name: 'finishSelection' }))

    expect(screen.queryByRole('button', { name: 'finishSelection' })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'selection: Clean Upload' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'selectedBooks' })).toBeNull()
})

test('dashboard shortcuts open files and settings, focus search, and select visible books', async () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>)
    await screen.findByText('Clean Upload')

    fireEvent.keyDown(window, { key: ',', code: 'Comma', ctrlKey: true })
    expect(await screen.findByRole('dialog', { name: 'librarySettings' })).toBeTruthy()

    fireEvent.keyDown(window, { key: ',', code: 'Comma', ctrlKey: true })
    expect(screen.queryByRole('dialog', { name: 'librarySettings' })).toBeNull()

    fireEvent.keyDown(window, { key: 'f', code: 'KeyF', ctrlKey: true })
    const search = document.querySelector('[data-dashboard-search="true"]')
    expect(search).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(search))

    fireEvent.keyDown(window, { key: ',', code: 'Comma', ctrlKey: true })
    const fileInput = document.querySelector('input[type="file"][accept=".txt,.epub,.zip"]')
    const fileClick = vi.spyOn(fileInput, 'click')
    fireEvent.keyDown(window, { key: 'o', code: 'KeyO', ctrlKey: true })
    expect(fileClick).toHaveBeenCalledOnce()

    const bookButton = screen.getByRole('button', { name: 'Clean Upload - read' })
    bookButton.focus()
    fireEvent.keyDown(window, { key: 'a', code: 'KeyA', ctrlKey: true })

    const selectedBook = await screen.findByRole('checkbox', { name: 'selection: Clean Upload' })
    expect(selectedBook.checked).toBe(true)
})
