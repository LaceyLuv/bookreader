// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import ResumeToast from './ResumeToast'

beforeEach(() => {
    vi.useFakeTimers()
})

afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
})

test('shows an undo action and dismisses itself after the configured duration', () => {
    const onAction = vi.fn()
    render(
        <ResumeToast
            message="Resuming from where you left off"
            actionLabel="Start Over"
            onAction={onAction}
            durationMs={5000}
        />,
    )

    expect(screen.getByRole('status')).toBeTruthy()
    act(() => vi.advanceTimersByTime(5000))
    expect(screen.queryByRole('status')).toBeNull()
    expect(onAction).not.toHaveBeenCalled()
})

test('runs the undo action and closes immediately', () => {
    const onAction = vi.fn()
    render(
        <ResumeToast
            message="Resuming from where you left off"
            actionLabel="Start Over"
            onAction={onAction}
        />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Start Over' }))
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('status')).toBeNull()
})
