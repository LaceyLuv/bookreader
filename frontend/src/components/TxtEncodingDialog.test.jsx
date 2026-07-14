// @vitest-environment jsdom
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import TxtEncodingDialog from './TxtEncodingDialog'

const tt = (key) => key
const previewPayload = {
    detected_encoding: 'utf-8',
    encoding_confidence: 0.92,
    encoding_override: null,
    encoding_source: 'auto',
    encoding_candidates: [
        { encoding: 'utf-8', label: 'UTF-8', valid: true, preview: '정상 미리보기', confidence: 0.92 },
        { encoding: 'cp949', label: 'CP949', valid: true, preview: 'CP949 미리보기', confidence: null },
        { encoding: 'utf-16-le', label: 'UTF-16 LE', valid: false, preview: '', confidence: null },
    ],
}

afterEach(() => {
    vi.restoreAllMocks()
})

test('compares server previews and applies a selected per-book encoding', async () => {
    const user = userEvent.setup()
    const onApplied = vi.fn()
    const onClose = vi.fn()
    global.fetch = vi.fn(async (_url, options = {}) => {
        if (options.method === 'PATCH') {
            return new Response(JSON.stringify({ id: 'book-1', txt_encoding_override: 'cp949' }), { status: 200 })
        }
        return new Response(JSON.stringify(previewPayload), { status: 200 })
    })

    render(
        <TxtEncodingDialog
            open
            bookId="book-1"
            initialData={previewPayload}
            onApplied={onApplied}
            onClose={onClose}
            tt={tt}
        />,
    )

    expect(await screen.findByText('정상 미리보기')).toBeTruthy()
    expect(screen.getByText('CP949 미리보기')).toBeTruthy()
    expect(screen.getByRole('radio', { name: /UTF-16 LE/ }).disabled).toBe(true)

    await user.click(screen.getByRole('radio', { name: /CP949/ }))
    await user.click(screen.getByRole('button', { name: 'applyEncoding' }))

    await waitFor(() => expect(onApplied).toHaveBeenCalledOnce())
    const patchCall = global.fetch.mock.calls.find(([, options]) => options?.method === 'PATCH')
    expect(patchCall[0]).toContain('/api/books/book-1')
    expect(JSON.parse(patchCall[1].body)).toEqual({ txt_encoding_override: 'cp949' })
    expect(onClose).toHaveBeenCalledOnce()
})

test('auto reset sends null and a failed apply keeps the dialog open', async () => {
    const user = userEvent.setup()
    const onApplied = vi.fn()
    const onClose = vi.fn()
    const manualPayload = { ...previewPayload, encoding_override: 'cp949', encoding_source: 'override' }
    global.fetch = vi.fn(async (_url, options = {}) => {
        if (options.method === 'PATCH') {
            return new Response(JSON.stringify({ detail: 'cannot update encoding' }), { status: 500 })
        }
        return new Response(JSON.stringify(manualPayload), { status: 200 })
    })

    render(
        <TxtEncodingDialog
            open
            bookId="book-1"
            initialData={manualPayload}
            onApplied={onApplied}
            onClose={onClose}
            tt={tt}
        />,
    )

    await screen.findByText('CP949 미리보기')
    await waitFor(() => expect(screen.getByRole('radio', { name: /CP949/ }).checked).toBe(true))
    await user.click(screen.getByRole('radio', { name: /^automaticEncoding/ }))
    await user.click(screen.getByRole('button', { name: 'applyEncoding' }))

    expect((await screen.findByRole('alert')).textContent).toContain('cannot update encoding')
    const patchCall = global.fetch.mock.calls.find(([, options]) => options?.method === 'PATCH')
    expect(JSON.parse(patchCall[1].body)).toEqual({ txt_encoding_override: null })
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(onApplied).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
})
