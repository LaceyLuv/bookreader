// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { useReaderSettings } from './useReaderSettings'

function SettingsProbe() {
    const settings = useReaderSettings()
    return (
        <>
            <output data-testid="font-mode">{settings.fontMode}</output>
            <output data-testid="background-color">{settings.bgColor}</output>
            <output data-testid="text-color">{settings.textColor}</output>
            <output data-testid="title-bar">{String(settings.showTitleBar)}</output>
        </>
    )
}

beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
})

test('reader settings default to EPUB embedded font mode', () => {
    render(<SettingsProbe />)

    expect(screen.getByTestId('font-mode').textContent).toBe('embedded')
    expect(screen.getByTestId('background-color').textContent).toBe('#fbfaf6')
    expect(screen.getByTestId('text-color').textContent).toBe('#38342f')
    expect(screen.getByTestId('title-bar').textContent).toBe('false')
})

test('legacy saved settings migrate to EPUB embedded font mode by default', () => {
    localStorage.setItem('bookreader_settings', JSON.stringify({
        theme: 'dark',
        fontMode: 'user',
        showTitleBar: true,
    }))

    render(<SettingsProbe />)

    expect(screen.getByTestId('font-mode').textContent).toBe('embedded')
    expect(screen.getByTestId('title-bar').textContent).toBe('false')
})
