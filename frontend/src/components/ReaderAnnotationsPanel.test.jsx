// @vitest-environment jsdom
import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'

import ReaderAnnotationsPanel from './ReaderAnnotationsPanel'

const themeStyle = { card: '#ffffff', border: '#dddddd', text: '#111111' }
const annotations = [
    { id: 'highlight-1', kind: 'highlight', selected_text: 'highlight text', snippet: 'highlight text', page: 0 },
    { id: 'note-1', kind: 'note', selected_text: 'note quote', note_text: 'my note', snippet: 'note quote', page: 1 },
]

test('provides an accessible panel, selected filters, close action, and whole-book export count', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
        <ReaderAnnotationsPanel
            open
            bookId="book-1"
            themeStyle={themeStyle}
            loading={false}
            annotations={annotations}
            activeAnnotationId={null}
            onClose={onClose}
            onItemClick={vi.fn()}
            onDeleteItem={vi.fn()}
            onEditItem={vi.fn()}
            onColorItem={vi.fn()}
            tt={(key) => key}
        />,
    )

    expect(screen.getByRole('complementary', { name: 'notesAndHighlights' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'all' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('(2)')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'notes' }))
    expect(screen.getByRole('button', { name: 'notes' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByText('highlight text')).toBeNull()
    expect(screen.getByText('note quote')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'closeAnnotations' }))
    expect(onClose).toHaveBeenCalledOnce()
})
