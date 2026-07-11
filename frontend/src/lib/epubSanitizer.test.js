import { expect, test } from 'vitest'

import { sanitizeEpubHtml } from './epubSanitizer'

test('sanitizeEpubHtml removes executable elements and event handlers', () => {
  const html = sanitizeEpubHtml(`
    <p onclick="alert(1)">Hello</p>
    <script>alert(2)</script>
    <iframe src="https://example.com"></iframe>
    <img src="/api/books/book-1/asset/image.png" onerror="alert(3)">
  `)

  expect(html).toContain('<p>Hello</p>')
  expect(html).toContain('<img src="/api/books/book-1/asset/image.png">')
  expect(html).not.toContain('<script')
  expect(html).not.toContain('<iframe')
  expect(html).not.toContain('onclick')
  expect(html).not.toContain('onerror')
})

test('sanitizeEpubHtml strips unsafe urls while preserving reader asset urls', () => {
  const html = sanitizeEpubHtml(`
    <a href="javascript:alert(1)">bad</a>
    <img src="data:image/png;base64,abc">
    <svg><image xlink:href="/api/books/book-1/asset/cover.svg"></image></svg>
    <img src="http://127.0.0.1:8000/api/books/book-1/asset/cover.png">
    <img src="http://localhost:8000/api/books/book-1/asset/cover.png">
    <img src="//evil.example/tracker.png">
    <img src="https://evil.example/tracker.png">
  `)

  expect(html).toContain('<a>bad</a>')
  expect(html).toContain('src="data:image/png;base64,abc"')
  expect(html).not.toContain('<svg')
  expect(html).toContain('src="http://127.0.0.1:8000/api/books/book-1/asset/cover.png"')
  expect(html).toContain('src="http://localhost:8000/api/books/book-1/asset/cover.png"')
  expect(html).toContain('<img>')
  expect(html).not.toContain('javascript:')
  expect(html).not.toContain('//evil.example')
  expect(html).not.toContain('https://evil.example')
})

test('sanitizeEpubHtml removes unsafe styles and scopes normal epub style blocks', () => {
  const html = sanitizeEpubHtml(`
    <style>p { margin: 0; }</style>
    <style>@import url("https://evil.example/style.css");</style>
    <style>body { background: url(http://evil.example/pixel.png); }</style>
    <p style="color: red">safe</p>
    <p style="background: url(javascript:alert(1))">bad</p>
    <p style="position: fixed; inset: 0; z-index: 9999">overlay</p>
  `)

  expect(html).toContain('.epub-content p { margin: 0; }')
  expect(html).toContain('<p style="color: red">safe</p>')
  expect(html).toContain('<p>bad</p>')
  expect(html).toContain('<p>overlay</p>')
  expect(html).not.toContain('@import')
  expect(html).not.toContain('javascript:')
  expect(html).not.toContain('http://evil.example')
  expect(html).not.toContain('position: fixed')
})

test('sanitizeEpubHtml keeps local api font-face urls while blocking remote css urls', () => {
  const html = sanitizeEpubHtml(`
    <style>@font-face { font-family: Novel; src: url("http://127.0.0.1:8000/api/books/book-1/asset/Fonts/%40NovelPortal.ttf"); }</style>
    <style>.cover { background-image: url(http://localhost:8000/api/books/book-1/asset/Images/cover.png); }</style>
    <style>.remote { background-image: url("https://evil.example/track.png"); }</style>
  `)

  expect(html).toContain('http://127.0.0.1:8000/api/books/book-1/asset/Fonts/%40NovelPortal.ttf')
  expect(html).toContain('http://localhost:8000/api/books/book-1/asset/Images/cover.png')
  expect(html).not.toContain('https://evil.example/track.png')
})

test('sanitizeEpubHtml strips dangerous srcset candidates', () => {
  const html = sanitizeEpubHtml(`
    <img
      srcset="/api/books/book-1/asset/a.png 1x, javascript:alert(1) 2x, https://evil.example/b.png 3x, data:image/png;base64,abc 4x"
      src="/api/books/book-1/asset/a.png"
    >
  `)

  expect(html).toContain('srcset="/api/books/book-1/asset/a.png 1x, data:image/png;base64,abc 4x"')
  expect(html).not.toContain('javascript:')
  expect(html).not.toContain('https://evil.example')
})

test('sanitizeEpubHtml removes embedded SVG and MathML subtrees', () => {
  const html = sanitizeEpubHtml(`
    <iframe srcdoc="<script>alert(1)</script>"></iframe>
    <svg onload="alert(1)" href="javascript:alert(2)">
      <animate href="javascript:alert(3)" attributeName="x"></animate>
      <use xlink:href="/api/books/book-1/asset/icon.svg#ok"></use>
    </svg>
    <math><mtext>hidden active namespace</mtext></math>
  `)

  expect(html).not.toContain('srcdoc')
  expect(html).not.toContain('onload')
  expect(html).not.toContain('javascript:')
  expect(html).not.toContain('<svg')
  expect(html).not.toContain('<math')
  expect(html).not.toContain('icon.svg')
})

test('sanitizeEpubHtml uses element and attribute allowlists', () => {
  const html = sanitizeEpubHtml(`
    <article data-secret="x"><custom-element title="kept text"><b tabindex="0">Readable</b></custom-element></article>
    <video autoplay src="/api/books/book-1/asset/movie.mp4">fallback</video>
    <img src="data:image/svg+xml,<svg onload=alert(1)>">
  `)

  expect(html).toContain('<article><b>Readable</b></article>')
  expect(html).toContain('fallback')
  expect(html).not.toContain('custom-element')
  expect(html).not.toContain('<video')
  expect(html).not.toContain('data-secret')
  expect(html).not.toContain('tabindex')
  expect(html).not.toContain('data:image/svg')
})

test('sanitizeEpubHtml rejects unscopable CSS and scopes global selectors', () => {
  const html = sanitizeEpubHtml(`
    <style>body, html .chapter { color: red; }</style>
    <style>@media screen { body { display: none; } }</style>
    <style>@font-face { font-family: Novel; src: url('/api/books/book-1/asset/font.woff2'); }</style>
  `)

  expect(html).toContain('.epub-content, .epub-content .chapter { color: red; }')
  expect(html).not.toContain('@media')
  expect(html).toContain('@font-face')
})

test('sanitizeEpubHtml rebases asset sources and css to the configured desktop API', () => {
  const html = sanitizeEpubHtml(`
    <img src="/api/books/book-1/asset/Images/cover.png?size=2#page" srcset="/api/books/book-1/asset/a.png 1x, data:image/png;base64,abc 2x">
    <p style="background-image: url('/api/books/book-1/asset/Images/bg.png')">text</p>
    <style>@font-face { src: url(/api/books/book-1/asset/Fonts/book.woff2); }</style>
    <a href="chapter2.xhtml#target">next</a>
  `, { assetBooksBase: 'http://127.0.0.1:49152/api/books' })

  expect(html).toContain('src="http://127.0.0.1:49152/api/books/book-1/asset/Images/cover.png?size=2#page"')
  expect(html).toContain('srcset="http://127.0.0.1:49152/api/books/book-1/asset/a.png 1x, data:image/png;base64,abc 2x"')
  expect(html).toContain("url('http://127.0.0.1:49152/api/books/book-1/asset/Images/bg.png')")
  expect(html).toContain('url(http://127.0.0.1:49152/api/books/book-1/asset/Fonts/book.woff2)')
  expect(html).toContain('href="chapter2.xhtml#target"')
})

test('sanitizeEpubHtml keeps web asset paths relative and replaces stale loopback origins', () => {
  const html = sanitizeEpubHtml(`
    <img src="http://localhost:8000/api/books/book-1/asset/cover.png">
    <img src="https://evil.example/api/books/book-1/asset/tracker.png">
  `, { assetBooksBase: '/api/books' })

  expect(html).toContain('src="/api/books/book-1/asset/cover.png"')
  expect(html).not.toContain('evil.example')
})

test('sanitizeEpubHtml applies an asset capability transform after rebasing', () => {
  const addCapability = (url) => url.includes('/asset/') ? `${url}${url.includes('?') ? '&' : '?'}asset_token=secret` : url
  const html = sanitizeEpubHtml(`
    <img src="/api/books/book-1/asset/cover.png" srcset="/api/books/book-1/asset/small.png 1x">
    <style>.page { background: url('/api/books/book-1/asset/paper.png'); }</style>
  `, {
    assetBooksBase: 'http://127.0.0.1:49152/api/books',
    assetUrlTransform: addCapability,
  })

  expect(html).toContain('cover.png?asset_token=secret')
  expect(html).toContain('small.png?asset_token=secret 1x')
  expect(html).toContain("paper.png?asset_token=secret')")
})
