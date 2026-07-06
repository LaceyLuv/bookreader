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
    <image xlink:href="/api/books/book-1/asset/cover.svg"></image>
    <img src="//evil.example/tracker.png">
    <img src="https://evil.example/tracker.png">
  `)

  expect(html).toContain('<a>bad</a>')
  expect(html).toContain('src="data:image/png;base64,abc"')
  expect(html).toContain('xlink:href="/api/books/book-1/asset/cover.svg"')
  expect(html).toContain('<img>')
  expect(html).not.toContain('javascript:')
  expect(html).not.toContain('//evil.example')
  expect(html).not.toContain('https://evil.example')
})

test('sanitizeEpubHtml removes unsafe styles but keeps normal epub style blocks', () => {
  const html = sanitizeEpubHtml(`
    <style>p { margin: 0; }</style>
    <style>@import url("https://evil.example/style.css");</style>
    <style>body { background: url(http://evil.example/pixel.png); }</style>
    <p style="color: red">safe</p>
    <p style="background: url(javascript:alert(1))">bad</p>
    <p style="position: fixed; inset: 0; z-index: 9999">overlay</p>
  `)

  expect(html).toContain('<style>p { margin: 0; }</style>')
  expect(html).toContain('<p style="color: red">safe</p>')
  expect(html).toContain('<p>bad</p>')
  expect(html).toContain('<p>overlay</p>')
  expect(html).not.toContain('@import')
  expect(html).not.toContain('javascript:')
  expect(html).not.toContain('http://evil.example')
  expect(html).not.toContain('position: fixed')
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

test('sanitizeEpubHtml removes srcdoc and risky svg attributes', () => {
  const html = sanitizeEpubHtml(`
    <iframe srcdoc="<script>alert(1)</script>"></iframe>
    <svg onload="alert(1)" href="javascript:alert(2)">
      <animate href="javascript:alert(3)" attributeName="x"></animate>
      <use xlink:href="/api/books/book-1/asset/icon.svg#ok"></use>
    </svg>
  `)

  expect(html).not.toContain('srcdoc')
  expect(html).not.toContain('onload')
  expect(html).not.toContain('javascript:')
  expect(html).toContain('xlink:href="/api/books/book-1/asset/icon.svg#ok"')
})
