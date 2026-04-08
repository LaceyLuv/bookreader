import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReaderProgressBar from './ReaderProgressBar'

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

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '6' } })
    fireEvent.blur(screen.getByRole('spinbutton'))

    expect(onSeekPage).toHaveBeenCalledWith(6)
})
