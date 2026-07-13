// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import ReaderLoadProblem from './ReaderLoadProblem'

const tt = (key) => key
const themeStyle = { border: '#ddd', text: '#111', card: '#fff' }

test('announces and focuses a structured reader problem', () => {
    render(
        <ReaderLoadProblem
            problem={{ code: 'epub.invalid_archive', message: 'Damaged EPUB', retryable: false }}
            themeStyle={themeStyle}
            tt={tt}
        />,
    )

    const alert = screen.getByRole('alert')
    expect(document.activeElement).toBe(alert)
    expect(screen.getByText('Damaged EPUB')).toBeTruthy()
    expect(screen.getByText('epub.invalid_archive')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'retry' })).toBeNull()
})

test('offers retry and recovery actions when supplied', () => {
    const onRetry = vi.fn()
    const onBack = vi.fn()
    render(
        <ReaderLoadProblem
            problem={{ code: 'network_error', message: 'Offline', retryable: true, recovery: 'choose_another_file' }}
            themeStyle={themeStyle}
            tt={tt}
            onRetry={onRetry}
            onBack={onBack}
        />,
    )

    expect(screen.getByText('chooseAnotherFileHint')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'retry' }))
    fireEvent.click(screen.getByRole('button', { name: 'backToLibrary' }))
    expect(onRetry).toHaveBeenCalledOnce()
    expect(onBack).toHaveBeenCalledOnce()
})

test('forceRetry can expose chapter retry even for a deterministic diagnostic', () => {
    render(
        <ReaderLoadProblem
            problem={{ code: 'epub.chapter_unreadable', message: 'Bad chapter', retryable: false }}
            themeStyle={themeStyle}
            tt={tt}
            onRetry={() => {}}
            forceRetry
        />,
    )

    expect(screen.getByRole('button', { name: 'retry' })).toBeTruthy()
})
