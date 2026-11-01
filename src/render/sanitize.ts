/**
 * Strip everything a rendering page must not do.
 *
 * The page is rendered by a real Chromium with scripts disabled and DNS
 * mapped to nowhere, so this is defence in depth rather than the only guard:
 * removing the tags keeps a hostile document from even asking, and keeps a
 * render deterministic when a template accidentally points at the network.
 *
 * @module dsh-arya-image-gen/render/sanitize
 */

/** Elements that can execute or embed foreign content. */
const BLOCKED_ELEMENTS = ['script', 'iframe', 'object', 'embed', 'frame', 'frameset', 'base', 'link']

/** URL schemes a rendered page may still reference. */
const ALLOWED_SCHEMES = ['data:', 'file:', 'about:', 'blob:']

/**
 * Remove blocking elements, inline handlers and remote URLs.
 *
 * @param markup - HTML or SVG source.
 * @returns sanitized markup.
 */
export function sanitizeMarkup(markup: string): string {
  let out = markup
  for (const tag of BLOCKED_ELEMENTS) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'gi'), '')
    out = out.replace(new RegExp(`<${tag}\\b[^>]*/?>`, 'gi'), '')
  }
  // Inline handlers (`onclick=`, `onload=` ...). Quotes are optional in HTML.
  out = out.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  out = dropRemoteUrls(out)
  return out
}

/**
 * Blank out http(s) and protocol-relative URLs anywhere in the markup.
 *
 * @param markup - sanitized markup.
 * @returns markup with remote references replaced by `about:blank`.
 */
function dropRemoteUrls(markup: string): string {
  const urlAttribute = /(\s(?:src|href|xlink:href|poster|data)\s*=\s*)(["'])([^"']*)\2/gi
  let out = markup.replace(urlAttribute, (whole, prefix: string, quote: string, value: string) => {
    const trimmed = value.trim().toLowerCase()
    if (trimmed.startsWith('http:') || trimmed.startsWith('https:') || trimmed.startsWith('//')) {
      return `${prefix}${quote}about:blank${quote}`
    }
    return whole
  })
  // CSS url(...) and @import.
  out = out.replace(/@import\s+[^;]+;?/gi, '')
  out = out.replace(/url\(\s*(['"]?)(https?:|\/\/)[^)]*\)/gi, 'url(about:blank)')
  return out
}

/**
 * The content security policy injected into every rendered page.
 *
 * Inline styles stay allowed because templates are style-heavy by nature;
 * scripts never are.
 */
export const RENDER_CSP =
  "default-src 'none'; img-src data: file: blob:; style-src 'unsafe-inline' data: file:; font-src data: file:; media-src data: file:"

/**
 * True when a URL scheme is one a rendered page may load.
 *
 * @param url - candidate URL.
 * @returns whether the scheme is allowed.
 */
export function isAllowedUrl(url: string): boolean {
  const lower = url.trim().toLowerCase()
  if (lower.startsWith('//')) return false
  return ALLOWED_SCHEMES.some(scheme => lower.startsWith(scheme))
}
