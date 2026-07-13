// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import ReaderShell, {
    ReaderBookmarkStrip,
    ReaderNoticeBar,
    ReaderPageTurnControls,
    ReaderTopBar,
} from './ReaderShell'

const themeStyle = { border: '#ddd', card: '#fff', text: '#111' }

test('ReaderShell preserves the focus root and renders slots in order', () => {
    const rootRef = React.createRef()
    render(
        <ReaderShell
            rootRef={rootRef}
            topBar={<div data-testid="slot-top" />}
            notice={<div data-testid="slot-notice" />}
            bookmarkBar={<div data-testid="slot-bookmarks" />}
            main={<div data-testid="slot-main" />}
            bottom={<div data-testid="slot-bottom" />}
            overlays={<div data-testid="slot-overlays" />}
            tail={<div data-testid="slot-tail" />}
        />,
    )

    expect(rootRef.current).toBeInstanceOf(HTMLElement)
    expect(rootRef.current.tabIndex).toBe(-1)
    expect(rootRef.current.classList.contains('readerRoot')).toBe(true)
    expect([...rootRef.current.children].map((node) => node.dataset.testid)).toEqual([
        'slot-top',
        'slot-notice',
        'slot-bookmarks',
        'slot-main',
        'slot-bottom',
        'slot-overlays',
        'slot-tail',
    ])
})

test('ReaderTopBar keeps back, meta, and action areas separate', () => {
    const onBack = vi.fn()
    render(
        <ReaderTopBar
            themeStyle={themeStyle}
            backLabel="Back to library"
            onBack={onBack}
            meta={<span>TXT</span>}
            actions={<button type="button">Settings</button>}
        />,
    )

    fireEvent.click(screen.getByTitle('Back to library'))
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(screen.getByText('TXT').closest('.reader-topbar-meta')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Settings' }).closest('.reader-topbar-actions')).toBeTruthy()
})

test('ReaderPageTurnControls delegates one click to each reader callback', () => {
    const onPrev = vi.fn()
    const onNext = vi.fn()
    render(
        <ReaderPageTurnControls
            themeStyle={themeStyle}
            showPrev
            showNext
            onPrev={onPrev}
            onNext={onNext}
        />,
    )

    fireEvent.click(screen.getByTestId('reader-prev-control'))
    fireEvent.click(screen.getByTestId('reader-next-control'))
    expect(screen.getByRole('button', { name: 'Previous' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy()
    expect(onPrev).toHaveBeenCalledTimes(1)
    expect(onNext).toHaveBeenCalledTimes(1)
})

test('ReaderBookmarkStrip uses separate activate and remove buttons', () => {
    const item = { id: 'bookmark-1', label: 'Page 3' }
    const onActivate = vi.fn()
    const onRemove = vi.fn()
    render(
        <ReaderBookmarkStrip
            items={[item]}
            label="Bookmarks"
            themeStyle={themeStyle}
            onActivate={onActivate}
            onRemove={onRemove}
            removeLabel="Close"
        />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close: Page 3' }))
    expect(onRemove).toHaveBeenCalledWith(item)
    expect(onActivate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Page 3' }))
    expect(onActivate).toHaveBeenCalledWith(item)
})

test('ReaderNoticeBar renders only actionable diagnostic codes', () => {
    const { rerender } = render(
        <ReaderNoticeBar themeStyle={themeStyle} message="Limited support" issues={[]} />,
    )
    expect(screen.queryByRole('status')).toBeNull()

    rerender(
        <ReaderNoticeBar
            themeStyle={themeStyle}
            message="Limited support"
            issues={[{ code: 'missing_asset' }, {}, { code: 'unsupported_css' }]}
        />,
    )
    expect(screen.getByRole('status').textContent).toContain('missing_asset, unsupported_css')
})
