// @vitest-environment jsdom
import React from 'react'
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import TitleBar from './TitleBar'

test('title bar uses the Gyeol display name and supplied icon', () => {
    const { container } = render(<TitleBar />)

    expect(screen.getByText('글결')).toBeTruthy()
    expect(container.querySelector('img')?.getAttribute('src')).toContain('gyeol-icon.png')
})
