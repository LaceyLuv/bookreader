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

const ALLOWED_URI_RE = /^(#|\/|\.{0,2}\/|https?:|data:image\/|blob:)/i
const UNSAFE_CSS_RE = /(?:expression\s*\(|javascript\s*:|@import\b)/i

function isUnsafeAttribute(name, value) {
  const normalizedName = String(name || '').toLowerCase()
  const normalizedValue = String(value || '').trim()

  if (!normalizedName) return true
  if (normalizedName.startsWith('on')) return true
  if (normalizedName === 'srcdoc') return true
  if (normalizedName === 'style') return UNSAFE_CSS_RE.test(normalizedValue)
  if (URI_ATTRIBUTES.has(normalizedName)) {
    if (normalizedValue.startsWith('//')) return true
    return normalizedValue !== '' && !ALLOWED_URI_RE.test(normalizedValue)
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
