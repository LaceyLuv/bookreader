import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { useReaderViewportAnchor } from '../hooks/useReaderViewportAnchor'

function AnchorHarness({ text, onRestore }) {
    const rootRef = useRef(null)
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
            <div data-testid="scroller">
                <div ref={rootRef}>{text}</div>
            </div>
            <button
                type="button"
                onClick={() => captureAnchor(rootRef.current)}
            >
                hide
            </button>
            <button
                type="button"
                onClick={() => {
                    const marker = rootRef.current?.querySelector('[data-reader-anchor="true"]')
                    if (marker) {
                        marker.scrollIntoView = onRestore
                    }
                    restoreAnchor(rootRef.current)
                }}
            >
                show
            </button>
        </div>
    )
}

test('bottom bar toggle preserves the visible top text block in TXT reader', async () => {
    const user = userEvent.setup()
    const onRestore = vi.fn()

    render(<AnchorHarness text={'alpha\n'.repeat(800)} onRestore={onRestore} />)

    await user.click(screen.getByRole('button', { name: 'hide' }))
    await user.click(screen.getByRole('button', { name: 'show' }))

    expect(onRestore).toHaveBeenCalledTimes(1)
})
