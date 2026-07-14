import { render, screen } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReaderProgressBar from './ReaderProgressBar'
import { useKeyboardNav } from '../hooks/useKeyboardNav'
import { KeyboardShortcutsProvider } from '../hooks/useKeyboardShortcuts'

function KeyboardHarness({ onNext, onPrev, readerRootRef }) {
    useKeyboardNav({ onNext, onPrev, enabled: true, readerRootRef })

    return (
        <div>
            <div ref={readerRootRef} data-testid="reader-root" tabIndex={-1}>reader</div>
        </div>
    )
}

test('keeps the progress control visible but disables seeking until pagination is ready', () => {
    render(<ReaderProgressBar currentPage={1} totalPages={null} progress={0} />)

    expect(screen.getByRole('slider').disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Edit page number' }).textContent).toContain('? / ?')
})

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

test('clicking the centered page number opens the page input in place', async () => {
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

    await user.click(screen.getByRole('button', { name: /edit page number/i }))

    expect(screen.getByRole('spinbutton', { name: /page number/i })).toBe(document.activeElement)
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

    const showButton = screen.getByRole('button', { name: /show progress bar/i })
    expect(showButton.className).toContain('left-4')
    expect(showButton.className).toContain('bottom-0')
    await user.click(showButton)
    expect(document.activeElement).toBe(readerRootRef.current)
})

test('expanded and collapsed progress bars stay in the shared overlay layer', async () => {
    const user = userEvent.setup()

    render(<ReaderProgressBar currentPage={3} totalPages={10} progress={0.2} />)

    const hideButton = screen.getByRole('button', { name: /hide progress bar/i })
    expect(hideButton.closest('.reader-progress-layer')).toBeTruthy()

    await user.click(hideButton)

    const showButton = screen.getByRole('button', { name: /show progress bar/i })
    expect(showButton.closest('.reader-progress-layer')).toBeTruthy()
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

test('TXT progress seek callback is wired to viewport pages', () => {
    const onSeekPage = vi.fn()

    render(
        <ReaderProgressBar
            currentPage={1}
            totalPages={12}
            onSeekPage={onSeekPage}
            progress={0}
        />,
    )

    fireEvent.click(screen.getByRole('button', { name: /edit page number/i }))
    fireEvent.change(screen.getByRole('spinbutton', { name: /page number/i }), { target: { value: '6' } })
    fireEvent.blur(screen.getByRole('spinbutton', { name: /page number/i }))

    expect(onSeekPage).toHaveBeenCalledWith(6)
})

test('side page information is removed while percent stays on the right', () => {
    render(
        <ReaderProgressBar
            currentPage={3}
            totalPages={10}
            progress={2 / 9}
            extraInfo="TXT 3/10"
            onSeekPage={vi.fn()}
        />,
    )

    expect(screen.queryByText('TXT 3/10')).toBeNull()
    expect(screen.getByRole('button', { name: /edit page number/i }).textContent).toContain('3 / 10')
    expect(screen.getByText('22%')).toBeTruthy()
})

test('Ctrl+H and Ctrl+ㅗ toggle the progress bar without browser history', () => {
    const onVisibilityChange = vi.fn()
    render(<ReaderProgressBar currentPage={3} totalPages={10} progress={0.2} onVisibilityChange={onVisibilityChange} />)

    const hideEvent = new KeyboardEvent('keydown', { key: 'h', code: 'KeyH', ctrlKey: true, bubbles: true, cancelable: true })
    fireEvent(window, hideEvent)
    expect(hideEvent.defaultPrevented).toBe(true)
    expect(screen.getByRole('button', { name: /show progress bar/i })).toBeTruthy()
    expect(onVisibilityChange).toHaveBeenLastCalledWith(false)

    const showEvent = new KeyboardEvent('keydown', { key: 'ㅗ', ctrlKey: true, bubbles: true, cancelable: true })
    fireEvent(window, showEvent)
    expect(showEvent.defaultPrevented).toBe(true)
    expect(screen.getByRole('button', { name: /hide progress bar/i })).toBeTruthy()
    expect(onVisibilityChange).toHaveBeenLastCalledWith(true)
})

test('Ctrl+H does not toggle the progress bar while editing a page number', async () => {
    const user = userEvent.setup()
    render(<ReaderProgressBar currentPage={3} totalPages={10} progress={0.2} onSeekPage={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /edit page number/i }))
    const input = screen.getByRole('spinbutton', { name: /page number/i })
    fireEvent.keyDown(input, { key: 'h', code: 'KeyH', ctrlKey: true })

    expect(screen.queryByRole('button', { name: /show progress bar/i })).toBeNull()
    expect(input).toBe(document.activeElement)
})

test('Ctrl+Shift+H remains available to the host', () => {
    render(<ReaderProgressBar currentPage={3} totalPages={10} progress={0.2} />)
    const event = new KeyboardEvent('keydown', {
        key: 'h', code: 'KeyH', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
    })

    fireEvent(window, event)

    expect(event.defaultPrevented).toBe(false)
    expect(screen.getByRole('button', { name: /hide progress bar/i })).toBeTruthy()
})

test('disabled shortcuts leave Ctrl+H available to the host without collapsing the bar', () => {
    localStorage.setItem('bookreader_settings', JSON.stringify({ keyboardShortcutsEnabled: false }))
    render(
        <KeyboardShortcutsProvider>
            <ReaderProgressBar currentPage={3} totalPages={10} progress={0.2} />
        </KeyboardShortcutsProvider>,
    )
    const event = new KeyboardEvent('keydown', {
        key: 'h', code: 'KeyH', ctrlKey: true, bubbles: true, cancelable: true,
    })

    fireEvent(window, event)

    expect(event.defaultPrevented).toBe(false)
    expect(screen.getByRole('button', { name: /hide progress bar/i })).toBeTruthy()
})
