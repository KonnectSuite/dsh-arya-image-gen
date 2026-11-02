/**
 * Does this markup look like a web page rather than a standalone card?
 *
 * `render_html` draws one isolated document: it strips scripts, never touches
 * the network, and knows nothing about a project's stylesheets, routes or dev
 * server. A model asked to check a website will still reach for it, because the
 * tool *looks* like a page renderer and returns a picture that seems to prove
 * the site works. This check names that mistake in the tool result so the model
 * can correct itself instead of reporting a screenshot that is not the site.
 *
 * Deliberately advisory: a card that embeds a local logo still renders, and the
 * warning says what was missing rather than refusing the call.
 *
 * @module dsh-arya-image-gen/render/web-page-guard
 */

/** Signals that the markup is a page rather than a card. */
const PAGE_SIGNALS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /<script\b/iu, reason: 'it contains script tags, and no JavaScript runs in this renderer' },
  { pattern: /<link\b[^>]*\brel\s*=\s*["']?stylesheet/iu, reason: 'it links a stylesheet the renderer cannot fetch' },
  { pattern: /<(nav|header|footer|main|aside)\b/iu, reason: 'it has page landmarks (nav/header/main/footer)' },
  { pattern: /(?:src|href)\s*=\s*["'](?!data:|#|mailto:|tel:|https?:|\/\/)[^"']+\.(?:css|js|mjs|png|jpe?g|gif|svg|webp|avif|woff2?|ttf)\b/iu, reason: 'it points at project files by relative path, which do not resolve here' },
]

/**
 * Explain why this markup looks like a web page, or return undefined when it
 * reads as a standalone card.
 *
 * @param markup - the HTML handed to `render_html`.
 * @returns one short reason, or undefined.
 */
export function looksLikeWebPage(markup: string): string | undefined {
  for (const signal of PAGE_SIGNALS) {
    if (signal.pattern.test(markup)) return signal.reason
  }
  return undefined
}

/** The sentence appended to the tool result when the guard fires. */
export function pageWarning(reason: string): string {
  return `Heads up: this markup looks like a web page, not a standalone card - ${reason}, so the PNG is not what the site looks like. To verify a website or app, run its dev server (or open the file) and view it in a browser; render_html is for one self-contained document whose text and layout you control.`
}
