// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { expect, test, vi } from 'vitest'
import { useReaderViewportAnchor } from '../hooks/useReaderViewportAnchor'

function AnchorHarness({ text, onRestore }) {
    const pageSurfaceRef = useRef(null)
    const { captureAnchor, restoreAnchor } = useReaderViewportAnchor({
        resolveRangeAtPoint: (root) => {
            const node = root.firstChild
            const range = document.createRange()
            range.setStart(node, 5)
            range.collapse(true)
            return range
        },
    })

    return (
        <div>
            <div data-testid="txt-spread">
                <div data-testid="txt-page-surface" ref={pageSurfaceRef}>{text}</div>
            </div>
            <button
                type="button"
                onClick={() => captureAnchor(pageSurfaceRef.current)}
            >
                hide
            </button>
            <button
                type="button"
                onClick={() => {
                    const marker = pageSurfaceRef.current?.querySelector('[data-reader-anchor="true"]')
                    if (marker) {
                        marker.scrollIntoView = () => onRestore(marker, pageSurfaceRef.current)
                    }
                    restoreAnchor(pageSurfaceRef.current)
                }}
            >
                show
            </button>
        </div>
    )
}

test('bottom bar toggle preserves the visible TXT page surface anchor', async () => {
    const user = userEvent.setup()
    const onRestore = vi.fn((marker, pageSurface) => {
        expect(marker.closest('[data-testid="txt-page-surface"]')).toBe(pageSurface)
    })

    render(<AnchorHarness text={'alpha\n'.repeat(800)} onRestore={onRestore} />)

    await user.click(screen.getByRole('button', { name: 'hide' }))
    await user.click(screen.getByRole('button', { name: 'show' }))

    expect(onRestore).toHaveBeenCalledTimes(1)
    expect(onRestore.mock.calls[0][1]).toBe(screen.getByTestId('txt-page-surface'))
})
