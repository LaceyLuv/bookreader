import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { useKeyboardNav } from './useKeyboardNav'

function Harness({ onNext, onPrev }) {
    const readerRootRef = useRef(null)
    useKeyboardNav({ onNext, onPrev, enabled: true, readerRootRef })

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

test('Space does not activate a focused button from the last mouse click', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    const onPrev = vi.fn()
    const { getByRole } = render(<Harness onNext={onNext} onPrev={onPrev} />)

    await user.click(getByRole('button', { name: 'toolbar button' }))
    await user.keyboard(' ')

    expect(onNext).toHaveBeenCalledTimes(1)
    expect(onPrev).not.toHaveBeenCalled()
})
