const BLOCKED_ELEMENTS = new Set([
  'script',
  'iframe',
  'object',
  'embed',
  'applet',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'meta',
  'base',
  'svg',
  'math',
])

const ALLOWED_ELEMENTS = new Set([
  'a', 'abbr', 'address', 'article', 'aside', 'b', 'bdi', 'bdo', 'blockquote', 'br',
  'caption', 'cite', 'code', 'col', 'colgroup', 'dd', 'del', 'details', 'dfn', 'div',
  'dl', 'dt', 'em', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5',
  'h6', 'header', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'main', 'mark', 'nav', 'ol',
  'p', 'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'section', 'small', 'source',
  'span', 'strong', 'style', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot',
  'th', 'thead', 'time', 'tr', 'u', 'ul', 'var', 'wbr',
])

const GLOBAL_ATTRIBUTES = new Set([
  'class', 'dir', 'hidden', 'id', 'lang', 'role', 'style', 'title', 'translate',
])

const ELEMENT_ATTRIBUTES = {
  a: new Set(['href', 'name']),
  img: new Set(['alt', 'height', 'loading', 'src', 'srcset', 'width']),
  source: new Set(['media', 'src', 'srcset', 'type']),
  col: new Set(['span']), colgroup: new Set(['span']),
  td: new Set(['colspan', 'headers', 'rowspan']), th: new Set(['colspan', 'headers', 'rowspan', 'scope']),
  ol: new Set(['reversed', 'start', 'type']), li: new Set(['value']),
  time: new Set(['datetime']), q: new Set(['cite']), blockquote: new Set(['cite']),
}

const URI_ATTRIBUTES = new Set([
  'href',
  'src',
  'xlink:href',
  'poster',
  'action',
])

const ALLOWED_URI_RE = /^(#|\/(?!\/)|\.{0,2}\/|data:image\/(?:png|jpe?g|gif|webp|avif);)/i
const UNSAFE_CSS_BASE_RE = /(?:expression\s*\(|javascript\s*:|@import\b|position\s*:\s*fixed|z-index\s*:\s*\d{3,}|inset\s*:\s*0)/i
const CSS_URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi

function normalizeUrlValue(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f\s]+/g, '').trim().toLowerCase()
}

function isLoopbackApiAssetUrl(value) {
  try {
    const parsed = new URL(value)
    const hostname = parsed.hostname.toLowerCase()
    const isLoopbackHost = hostname === 'localhost' || hostname === '::1' || hostname.startsWith('127.')
    const isHttp = parsed.protocol === 'http:' || parsed.protocol === 'https:'
    return isHttp && isLoopbackHost && parsed.pathname.startsWith('/api/books/') && parsed.pathname.includes('/asset/')
  } catch {
    return false
  }
}

function isAllowedUri(value) {
  const normalizedValue = normalizeUrlValue(value)
  if (!normalizedValue) return true
  if (normalizedValue.startsWith('//')) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalizedValue)) {
    return /^data:image\/(?:png|jpe?g|gif|webp|avif);/i.test(normalizedValue) || isLoopbackApiAssetUrl(normalizedValue)
  }
  return ALLOWED_URI_RE.test(normalizedValue) || !normalizedValue.includes(':')
}

function hasUnsafeCss(value) {
  const cssText = String(value || '')
  if (UNSAFE_CSS_BASE_RE.test(cssText)) return true

  for (const match of cssText.matchAll(CSS_URL_RE)) {
    const rawUrl = match[1] ?? match[2] ?? match[3] ?? ''
    if (!isAllowedUri(rawUrl.trim())) return true
  }

  return false
}

function scopeStyleSheet(value) {
  const css = String(value || '').replace(/\/\*[\s\S]*?\*\//g, '')
  if (hasUnsafeCss(css) || /@(?:import|namespace|media|supports|document|layer|container|keyframes|-\w+-keyframes)\b/i.test(css)) return ''

  // Keep font declarations and page metadata, but ensure ordinary selectors cannot
  // target the reader chrome or the host document.
  return css.replace(/(^|})\s*([^@}{][^{]*)\{/g, (match, boundary, selectorList) => {
    const scoped = selectorList.split(',').map((selector) => {
      const trimmed = selector.trim()
      if (!trimmed) return ''
      const normalized = trimmed.replace(/^(?:html|body|:root)\b/i, '').trim()
      return normalized ? `.epub-content ${normalized}` : '.epub-content'
    }).filter(Boolean).join(', ')
    return scoped ? `${boundary}\n${scoped} {` : ''
  })
}

function splitSrcset(value) {
  const source = String(value || '')
  const candidates = []
  let index = 0

  while (index < source.length) {
    while (index < source.length && /[\s,]/.test(source[index])) index += 1
    if (index >= source.length) break

    const urlStart = index
    const lowerTail = source.slice(index).toLowerCase()
    if (lowerTail.startsWith('data:')) {
      while (index < source.length && !/\s/.test(source[index])) index += 1
    } else {
      while (index < source.length && !/[\s,]/.test(source[index])) index += 1
    }
    const url = source.slice(urlStart, index)

    const descriptorStart = index
    while (index < source.length && source[index] !== ',') index += 1
    const descriptor = source.slice(descriptorStart, index).trim()
    candidates.push({ url, descriptor })

    if (source[index] === ',') index += 1
  }

  return candidates
}

function sanitizeSrcset(value) {
  const safeCandidates = splitSrcset(value).filter((candidate) => isAllowedUri(candidate.url))
  return safeCandidates.map(({ url, descriptor }) => [url, descriptor].filter(Boolean).join(' ')).join(', ')
}

function getAssetBase(assetBooksBase) {
  const value = String(assetBooksBase || '').replace(/\/+$/, '')
  if (!value) return null
  try {
    const parsed = new URL(value, 'https://bookreader.local/')
    if (parsed.pathname.replace(/\/+$/, '') !== '/api/books') return null
    return {
      prefix: value,
    }
  } catch {
    return null
  }
}

function rebaseAssetUrl(value, assetBase) {
  const raw = String(value || '').trim()
  if (!raw || raw.startsWith('#') || raw.toLowerCase().startsWith('data:') || raw.toLowerCase().startsWith('blob:')) {
    return raw
  }

  try {
    const parsed = new URL(raw, 'https://bookreader.local/')
    if (!/^\/api\/books\/[^/]+\/asset(?:\/|$)/.test(parsed.pathname)) return raw
    if (parsed.origin !== 'https://bookreader.local' && !isLoopbackApiAssetUrl(raw)) return raw
    return `${assetBase.prefix}${parsed.pathname.slice('/api/books'.length)}${parsed.search}${parsed.hash}`
  } catch {
    return raw
  }
}

function rebaseCssAssetUrls(value, assetBase, transformAssetUrl) {
  return String(value || '').replace(CSS_URL_RE, (match, doubleQuoted, singleQuoted, unquoted) => {
    const rawUrl = doubleQuoted ?? singleQuoted ?? unquoted ?? ''
    const rebased = transformAssetUrl(rebaseAssetUrl(rawUrl, assetBase))
    if (rebased === rawUrl) return match
    const quote = doubleQuoted != null ? '"' : singleQuoted != null ? "'" : ''
    return `url(${quote}${rebased}${quote})`
  })
}

function rebaseSanitizedAssets(fragment, assetBooksBase, assetUrlTransform) {
  const assetBase = getAssetBase(assetBooksBase)
  if (!assetBase) return

  for (const element of fragment.querySelectorAll('*')) {
    for (const attributeName of ['src', 'poster']) {
      if (element.hasAttribute(attributeName)) {
        const rebased = rebaseAssetUrl(element.getAttribute(attributeName), assetBase)
        element.setAttribute(attributeName, assetUrlTransform(rebased))
      }
    }
    if (element.hasAttribute('srcset')) {
      const candidates = splitSrcset(element.getAttribute('srcset'))
      element.setAttribute('srcset', candidates.map(({ url, descriptor }) => {
        const rebased = rebaseAssetUrl(url, assetBase)
        return [assetUrlTransform(rebased), descriptor].filter(Boolean).join(' ')
      }).join(', '))
    }
    if (element.hasAttribute('style')) {
      element.setAttribute('style', rebaseCssAssetUrls(element.getAttribute('style'), assetBase, assetUrlTransform))
    }
    if (element.tagName.toLowerCase() === 'style') {
      element.textContent = rebaseCssAssetUrls(element.textContent, assetBase, assetUrlTransform)
    }
  }
}

function isUnsafeAttribute(name, value) {
  const normalizedName = String(name || '').toLowerCase()
  const normalizedValue = String(value || '').trim()

  if (!normalizedName) return true
  if (normalizedName.startsWith('on')) return true
  if (normalizedName === 'srcdoc') return true
  if (normalizedName === 'style') return hasUnsafeCss(normalizedValue)
  if (normalizedName === 'srcset') return false
  if (URI_ATTRIBUTES.has(normalizedName)) {
    return !isAllowedUri(normalizedValue)
  }
  return false
}

function sanitizeElement(element) {
  const tagName = element.tagName.toLowerCase()
  if (BLOCKED_ELEMENTS.has(tagName)) {
    element.remove()
    return
  }
  if (!ALLOWED_ELEMENTS.has(tagName)) {
    element.replaceWith(...Array.from(element.childNodes))
    return
  }

  for (const attr of Array.from(element.attributes)) {
    const attrName = attr.name.toLowerCase()
    const allowedForElement = ELEMENT_ATTRIBUTES[tagName]
    const isAllowed = GLOBAL_ATTRIBUTES.has(attrName)
      || attrName.startsWith('aria-')
      || Boolean(allowedForElement?.has(attrName))
    if (!isAllowed || isUnsafeAttribute(attr.name, attr.value)) {
      element.removeAttribute(attr.name)
    }
  }

  // Reader typography settings own the weight. EPUB inline declarations,
  // especially ones using !important, otherwise outrank the reader override.
  if (element.hasAttribute('style')) {
    element.style.removeProperty('font-weight')
    element.style.removeProperty('font-variation-settings')
    if (!element.getAttribute('style')?.trim()) element.removeAttribute('style')
  }

  if (element.hasAttribute('srcset')) {
    const sanitized = sanitizeSrcset(element.getAttribute('srcset'))
    if (sanitized) {
      element.setAttribute('srcset', sanitized)
    } else {
      element.removeAttribute('srcset')
    }
  }

  if (tagName === 'style') {
    const scopedCss = scopeStyleSheet(element.textContent || '')
    if (scopedCss) element.textContent = scopedCss
    else element.remove()
  }
}

export function sanitizeEpubHtml(html, { assetBooksBase = '', assetUrlTransform = (url) => url } = {}) {
  const source = String(html ?? '')
  if (typeof document === 'undefined') return source

  const template = document.createElement('template')
  template.innerHTML = source
  const elements = Array.from(template.content.querySelectorAll('*'))
  for (const element of elements) {
    sanitizeElement(element)
  }

  rebaseSanitizedAssets(template.content, assetBooksBase, assetUrlTransform)

  return template.innerHTML
}
