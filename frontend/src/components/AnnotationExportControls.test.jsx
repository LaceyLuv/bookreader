// @vitest-environment jsdom
import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

import { exportBookAnnotations } from '../lib/annotationExportClient'
import AnnotationExportControls from './AnnotationExportControls'

vi.mock('../lib/annotationExportClient', () => ({ exportBookAnnotations: vi.fn() }))

const tt = (key) => key

beforeEach(() => {
    vi.clearAllMocks()
})

test('exports the whole book in either format and announces download start', async () => {
    const user = userEvent.setup()
    exportBookAnnotations.mockResolvedValue('book-annotations.md')
    render(<AnnotationExportControls bookId="book-1" annotationCount={7} tt={tt} />)

    expect(screen.getByText('(7)')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'exportMarkdown' }))

    expect(exportBookAnnotations).toHaveBeenCalledWith('book-1', 'markdown')
    expect((await screen.findByRole('status')).textContent).toContain('book-annotations.md')
    expect(screen.getByText('annotationExportPrivacyWarning')).toBeTruthy()
})

test('disables both formats while one request is pending', async () => {
    const user = userEvent.setup()
    let finish
    exportBookAnnotations.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    render(<AnnotationExportControls bookId="book-1" annotationCount={2} tt={tt} />)

    await user.click(screen.getByRole('button', { name: 'exportMarkdown' }))
    expect(screen.getByRole('button', { name: 'exportingAnnotations' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'exportJson' }).disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: 'exportJson' }))
    expect(exportBookAnnotations).toHaveBeenCalledOnce()

    finish('done.md')
    expect(await screen.findByRole('status')).toBeTruthy()
})

test('shows a retryable inline error and disables empty exports', async () => {
    const user = userEvent.setup()
    exportBookAnnotations.mockRejectedValue(new Error('network down'))
    const { rerender } = render(<AnnotationExportControls bookId="book-1" annotationCount={1} tt={tt} />)

    await user.click(screen.getByRole('button', { name: 'exportJson' }))
    expect((await screen.findByRole('alert')).textContent).toContain('network down')

    rerender(<AnnotationExportControls bookId="book-1" annotationCount={0} tt={tt} />)
    expect(screen.getByRole('button', { name: 'exportMarkdown' }).disabled).toBe(true)
    expect(screen.getByText('noAnnotationsToExport')).toBeTruthy()
})
