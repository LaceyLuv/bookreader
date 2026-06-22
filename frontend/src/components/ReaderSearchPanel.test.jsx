// @vitest-environment jsdom
import React from 'react'
import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

import ReaderSearchPanel from './ReaderSearchPanel'

const themeStyle = {
    border: '#ddd',
    text: '#111',
    card: '#fff',
}

test('renders formatted result location instead of raw locator text', () => {
    render(
        <ReaderSearchPanel
            open
            themeStyle={themeStyle}
            query="target"
            submittedQuery="target"
            loading={false}
            results={[
                {
                    index: 0,
                    snippet: 'alpha target beta',
                    locator: 'segment:12:offset:45',
                },
            ]}
            onQueryChange={vi.fn()}
            onSubmit={vi.fn()}
            onClose={vi.fn()}
            onResultClick={vi.fn()}
            formatResultLocation={() => 'Page 7'}
            tt={(key) => key}
        />,
    )

    expect(screen.getByText('Page 7')).toBeTruthy()
    expect(screen.queryByText('segment:12:offset:45')).toBeNull()
})
