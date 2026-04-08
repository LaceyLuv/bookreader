import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useKeyboardNav } from './useKeyboardNav'

function Harness({ onNext, onPrev }) {
    useKeyboardNav({ onNext, onPrev, enabled: true })

    return (
        <div>
            <div data-testid="reader-root" tabIndex={-1}>reader</div>
            <input aria-label="page input" />
        </div>
    )
}

function InteractiveHarness({ onNext, onPrev, onButtonClick }) {
    const readerRootRef = { current: null }
    useKeyboardNav({ onNext, onPrev, enabled: true, readerRootRef })

    return (
        <div>
            <div ref={(node) => { readerRootRef.current = node }} data-testid="interactive-reader-root" tabIndex={-1}>reader</div>
            <button type="button" onClick={onButtonClick}>last clicked</button>
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

test('Space does not activate a focused button from the last mouse click', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    const onButtonClick = vi.fn()

    render(<InteractiveHarness onNext={onNext} onPrev={vi.fn()} onButtonClick={onButtonClick} />)

    const button = screen.getByRole('button', { name: 'last clicked' })
    button.focus()
    await user.keyboard(' ')

    expect(onNext).toHaveBeenCalledTimes(1)
    expect(onButtonClick).not.toHaveBeenCalled()
    expect(screen.getByTestId('interactive-reader-root')).toBe(document.activeElement)
})
