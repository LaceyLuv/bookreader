import { render, screen } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReaderProgressBar from './ReaderProgressBar'
import { useKeyboardNav } from '../hooks/useKeyboardNav'

function KeyboardHarness({ onNext, onPrev, readerRootRef }) {
    useKeyboardNav({ onNext, onPrev, enabled: true, readerRootRef })

    return (
        <div>
            <div ref={readerRootRef} data-testid="reader-root" tabIndex={-1}>reader</div>
        </div>
    )
}

test('collapse button returns focus to reader root after pointer interaction', async () => {
    const user = userEvent.setup()
    const readerRoot = document.createElement('div')
    readerRoot.tabIndex = -1
    document.body.appendChild(readerRoot)

    render(
        <ReaderProgressBar
            currentPage={3}
            totalPages={10}
            progress={0.2}
            readerFocusRef={{ current: readerRoot }}
        />,
    )

    await user.click(screen.getByRole('button', { name: /hide progress bar/i }))

    expect(document.activeElement).toBe(readerRoot)
})

test('Space does not activate the last clicked progress-bar control after pointer seek', async () => {
    const user = userEvent.setup()
    const readerRootRef = { current: null }
    const onNext = vi.fn()
    const onSeekProgress = vi.fn()

    render(
        <>
            <KeyboardHarness onNext={onNext} onPrev={vi.fn()} readerRootRef={readerRootRef} />
            <ReaderProgressBar
                currentPage={3}
                totalPages={10}
                progress={0.2}
                onSeekProgress={onSeekProgress}
                readerFocusRef={readerRootRef}
            />
        </>,
    )

    await user.click(screen.getByRole('slider'))
    expect(document.activeElement).toBe(readerRootRef.current)
    await user.keyboard(' ')

    expect(onNext).toHaveBeenCalledTimes(1)
})

test('page number input does not retain pointer focus after a mouse click', async () => {
    const user = userEvent.setup()
    const readerRootRef = { current: null }

    render(
        <>
            <KeyboardHarness onNext={vi.fn()} onPrev={vi.fn()} readerRootRef={readerRootRef} />
            <ReaderProgressBar
                currentPage={3}
                totalPages={10}
                progress={0.2}
                onSeekPage={vi.fn()}
                readerFocusRef={readerRootRef}
            />
        </>,
    )

    await user.click(screen.getByRole('spinbutton'))

    expect(document.activeElement).toBe(readerRootRef.current)
})

test('hide and show buttons release their own focus after pointer clicks', async () => {
    const user = userEvent.setup()
    const readerRootRef = { current: null }

    render(
        <>
            <KeyboardHarness onNext={vi.fn()} onPrev={vi.fn()} readerRootRef={readerRootRef} />
            <ReaderProgressBar
                currentPage={3}
                totalPages={10}
                progress={0.2}
                readerFocusRef={readerRootRef}
            />
        </>,
    )

    await user.click(screen.getByRole('button', { name: /hide progress bar/i }))
    expect(document.activeElement).toBe(readerRootRef.current)

    await user.click(screen.getByRole('button', { name: /show progress bar/i }))
    expect(document.activeElement).toBe(readerRootRef.current)
})

test('recent pointer interaction prevents Space from re-activating the hide button', async () => {
    const readerRoot = document.createElement('div')
    readerRoot.tabIndex = -1
    document.body.appendChild(readerRoot)

    render(
        <ReaderProgressBar
            currentPage={3}
            totalPages={10}
            progress={0.2}
            readerFocusRef={{ current: readerRoot }}
        />,
    )

    const hideButton = screen.getByRole('button', { name: /hide progress bar/i })

    fireEvent.pointerDown(hideButton)
    hideButton.focus()
    fireEvent.keyDown(hideButton, { key: ' ', code: 'Space' })
    await Promise.resolve()

    expect(document.activeElement).toBe(readerRoot)
})
