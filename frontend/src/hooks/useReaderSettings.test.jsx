// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { useReaderSettings } from './useReaderSettings'

function SettingsProbe() {
    const settings = useReaderSettings()
    return (
        <output data-testid="font-mode">{settings.fontMode}</output>
    )
}

beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
})

test('reader settings default to EPUB embedded font mode', () => {
    render(<SettingsProbe />)

    expect(screen.getByTestId('font-mode').textContent).toBe('embedded')
})

test('legacy saved settings migrate to EPUB embedded font mode by default', () => {
    localStorage.setItem('bookreader_settings', JSON.stringify({
        theme: 'dark',
        fontMode: 'user',
    }))

    render(<SettingsProbe />)

    expect(screen.getByTestId('font-mode').textContent).toBe('embedded')
})
