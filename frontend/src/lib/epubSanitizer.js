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
])

const URI_ATTRIBUTES = new Set([
  'href',
  'src',
  'xlink:href',
  'poster',
  'action',
])

const ALLOWED_URI_RE = /^(#|\/(?!\/)|\.{0,2}\/|data:image\/|blob:)/i
const UNSAFE_CSS_RE = /(?:expression\s*\(|javascript\s*:|@import\b|url\(\s*["']?(?:https?:|\/\/)|position\s*:\s*fixed|z-index\s*:\s*\d{3,}|inset\s*:\s*0)/i

function normalizeUrlValue(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f\s]+/g, '').trim().toLowerCase()
}

function isAllowedUri(value) {
  const normalizedValue = normalizeUrlValue(value)
  if (!normalizedValue) return true
  if (normalizedValue.startsWith('//')) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalizedValue)) {
    return normalizedValue.startsWith('data:image/') || normalizedValue.startsWith('blob:')
  }
  return ALLOWED_URI_RE.test(normalizedValue) || !normalizedValue.includes(':')
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

function isUnsafeAttribute(name, value) {
  const normalizedName = String(name || '').toLowerCase()
  const normalizedValue = String(value || '').trim()

  if (!normalizedName) return true
  if (normalizedName.startsWith('on')) return true
  if (normalizedName === 'srcdoc') return true
  if (normalizedName === 'style') return UNSAFE_CSS_RE.test(normalizedValue)
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

  for (const attr of Array.from(element.attributes)) {
    if (isUnsafeAttribute(attr.name, attr.value)) {
      element.removeAttribute(attr.name)
    }
  }

  if (element.hasAttribute('srcset')) {
    const sanitized = sanitizeSrcset(element.getAttribute('srcset'))
    if (sanitized) {
      element.setAttribute('srcset', sanitized)
    } else {
      element.removeAttribute('srcset')
    }
  }

  if (tagName === 'style' && UNSAFE_CSS_RE.test(element.textContent || '')) {
    element.remove()
  }
}

export function sanitizeEpubHtml(html) {
  const source = String(html ?? '')
  if (typeof document === 'undefined') return source

  const template = document.createElement('template')
  template.innerHTML = source
  const elements = Array.from(template.content.querySelectorAll('*'))
  for (const element of elements) {
    sanitizeElement(element)
  }

  return template.innerHTML
}
