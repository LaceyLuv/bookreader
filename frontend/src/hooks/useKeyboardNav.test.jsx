import { fireEvent, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { useKeyboardNav } from './useKeyboardNav'
import { KeyboardShortcutsProvider } from './useKeyboardShortcuts'

function Harness({ onNext, onPrev, enabled = true }) {
    const readerRootRef = useRef(null)
    useKeyboardNav({ onNext, onPrev, enabled, readerRootRef })

    return (
        <div>
            <div ref={readerRootRef} data-testid="reader-root" tabIndex={-1}>reader</div>
            <input aria-label="page input" />
            <button type="button">toolbar button</button>
        </div>
    )
}

test('Space moves to next page when focus is returned to reader root', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    const onPrev = vi.fn()
    const { getByTestId } = render(<Harness onNext={onNext} onPrev={onPrev} />)

    getByTestId('reader-root').focus()
    await user.keyboard(' ')

    expect(onNext).toHaveBeenCalledTimes(1)
    expect(onPrev).not.toHaveBeenCalled()
})

test('first page key after navigation is enabled uses the latest callback', () => {
    const staleOnNext = vi.fn()
    const latestOnNext = vi.fn()
    const onPrev = vi.fn()
    const { rerender } = render(<Harness onNext={staleOnNext} onPrev={onPrev} enabled={false} />)

    rerender(<Harness onNext={latestOnNext} onPrev={onPrev} enabled />)
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    window.dispatchEvent(event)

    expect(staleOnNext).not.toHaveBeenCalled()
    expect(latestOnNext).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
})

test('Space stays with a focused toolbar button instead of turning the page', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    const onPrev = vi.fn()
    const { getByRole } = render(<Harness onNext={onNext} onPrev={onPrev} />)

    await user.click(getByRole('button', { name: 'toolbar button' }))
    await user.keyboard(' ')

    expect(onNext).not.toHaveBeenCalled()
    expect(onPrev).not.toHaveBeenCalled()
})

test('Escape is left available when the reader has no escape action', () => {
    render(<Harness onNext={vi.fn()} onPrev={vi.fn()} />)
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })

    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
})

test('disabled shortcuts leave page keys untouched', () => {
    localStorage.setItem('bookreader_settings', JSON.stringify({ keyboardShortcutsEnabled: false }))
    const onNext = vi.fn()
    const onPrev = vi.fn()
    render(<KeyboardShortcutsProvider><Harness onNext={onNext} onPrev={onPrev} /></KeyboardShortcutsProvider>)
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })

    window.dispatchEvent(event)

    expect(onNext).not.toHaveBeenCalled()
    expect(onPrev).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
})

test('modifier arrow keys are not mistaken for page turns', () => {
    const onNext = vi.fn()
    const onPrev = vi.fn()
    render(<Harness onNext={onNext} onPrev={onPrev} />)

    fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true })
    fireEvent.keyDown(window, { key: 'ArrowRight', ctrlKey: true })

    expect(onNext).not.toHaveBeenCalled()
    expect(onPrev).not.toHaveBeenCalled()
})
