import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { browserCandidates, familyOf, resolveBrowser } from '../src/render/browser.js'
import { buildRenderDocument, normalizeRenderInput, pngSize, renderToPng, RenderError, RENDER_LIMITS } from '../src/render/render.js'
import { sanitizeMarkup, isAllowedUrl } from '../src/render/sanitize.js'
import { fillTemplate, findTemplate, RENDER_TEMPLATES } from '../src/render/templates.js'
import { parseRenderRequest } from '../src/render-route.js'
import { svgIntrinsicSize } from '../src/render-tools.js'

/** Minimal valid PNG of the requested size, for the browser stand-in. */
function makePng(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k += 1) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buffer: Buffer): number => {
    let value = 0xffffffff
    for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff]! ^ (value >>> 8)
    return (value ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([length, body, sum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  const raw = Buffer.alloc((width * 3 + 1) * height)
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

describe('render markup sanitizer', () => {
  it('removes executable and embedding elements', () => {
    const cleaned = sanitizeMarkup('<div>ok</div><script>alert(1)</script><iframe src="x"></iframe><object data="y"></object>')
    expect(cleaned).toBe('<div>ok</div>')
  })

  it('removes inline event handlers', () => {
    expect(sanitizeMarkup('<img src="data:image/png;base64,AA" onerror="steal()">')).toBe('<img src="data:image/png;base64,AA">')
  })

  it('blanks remote urls but keeps data urls', () => {
    const cleaned = sanitizeMarkup('<img src="https://evil.test/a.png"><img src="data:image/png;base64,AA"><a href="//cdn.test">x</a>')
    expect(cleaned).not.toContain('evil.test')
    expect(cleaned).not.toContain('cdn.test')
    expect(cleaned).toContain('data:image/png;base64,AA')
  })

  it('drops css imports and remote url()', () => {
    const cleaned = sanitizeMarkup('<style>@import "https://x.test/a.css"; body{background:url(https://x.test/b.png)}</style>')
    expect(cleaned).not.toContain('x.test')
  })

  it('only allows local schemes', () => {
    expect(isAllowedUrl('data:image/png;base64,AA')).toBe(true)
    expect(isAllowedUrl('file:///C:/a.png')).toBe(true)
    expect(isAllowedUrl('https://x.test')).toBe(false)
    expect(isAllowedUrl('//x.test')).toBe(false)
  })
})

describe('render geometry', () => {
  it('applies defaults and rejects out-of-range values', () => {
    const geometry = normalizeRenderInput({ kind: 'html', markup: '<p>x</p>', width: 800, height: 600 })
    expect(geometry).toMatchObject({ width: 800, height: 600, scale: 1, background: '#ffffff' })
    expect(() => normalizeRenderInput({ kind: 'html', markup: 'x', width: 1, height: 600 })).toThrow(RenderError)
    expect(() => normalizeRenderInput({ kind: 'html', markup: 'x', width: 800, height: 600, scale: 9 })).toThrow(/scale/i)
    expect(() => normalizeRenderInput({ kind: 'html', markup: '', width: 800, height: 600 })).toThrow(/no markup/i)
    expect(() => normalizeRenderInput({ kind: 'html', markup: 'x', width: RENDER_LIMITS.maxSide + 1, height: 600 })).toThrow(/at most/i)
  })

  it('injects a csp and keeps the requested size', () => {
    const document = buildRenderDocument({ kind: 'html', markup: '<p>hi</p>', width: 300, height: 200 }, '#123456')
    expect(document).toContain('Content-Security-Policy')
    expect(document).toContain('width:300px')
    expect(document).toContain('#123456')
    expect(document).toContain('@font-face')
  })

  it('wraps svg so it fills the canvas', () => {
    const document = buildRenderDocument({ kind: 'svg', markup: '<svg viewBox="0 0 10 10"></svg>', width: 100, height: 100 }, '#fff')
    expect(document).toContain('width:100%;height:100%')
  })
})

describe('render templates', () => {
  it('ships six templates with ids and slots', () => {
    expect(RENDER_TEMPLATES).toHaveLength(6)
    for (const template of RENDER_TEMPLATES) {
      expect(template.id.length).toBeGreaterThan(0)
      expect(template.slots.length).toBeGreaterThan(0)
      expect(template.width).toBeGreaterThan(0)
    }
  })

  it('fills slots and escapes values', () => {
    const { html } = fillTemplate('og-card', { title: '<b>Hi</b>', subtitle: 'sub' })
    expect(html).toContain('&lt;b&gt;Hi&lt;/b&gt;')
    expect(html).not.toContain('{{title}}')
  })

  it('rejects unknown slots and unknown templates', () => {
    expect(() => fillTemplate('og-card', { nope: 'x' })).toThrow(/no slot/)
    expect(() => fillTemplate('missing', {})).toThrow(/Unknown render template/)
    expect(findTemplate('og-card')?.width).toBe(1200)
  })

  it('builds comparison rows from pipe-separated text, escaping each cell', () => {
    const { html } = fillTemplate('comparison', {
      title: 'T',
      leftTitle: 'A',
      rightTitle: 'B',
      rows: 'Scenes|best|-<script>x</script>\nDeterministic|no|yes',
      footnote: 'f',
    })
    expect(html).toContain('<td class="k">best</td>')
    expect(html).toContain('<td class="k">yes</td>')
    expect(html).not.toContain('<script>')
    // One <tr> per data row; the header row has <th>, not <td>.
    expect(html.match(/<tr><td/g)?.length).toBe(2)
  })

  it('gives the banner a separate gradient accent slot', () => {
    const banner = findTemplate('banner')
    expect(banner?.slots).toContain('accent')
    const { html } = fillTemplate('banner', { title: 'Arya', accent: 'Render', subtitle: 's', tagline: 't' })
    expect(html).toContain('<span class="g">Render</span>')
  })

  it('reads the size out of svg markup', () => {
    expect(svgIntrinsicSize('<svg width="320" height="180"></svg>')).toEqual({ width: 320, height: 180 })
    expect(svgIntrinsicSize('<svg viewBox="0 0 24 24"></svg>')).toEqual({ width: 24, height: 24 })
    expect(svgIntrinsicSize('<div></div>')).toBeUndefined()
  })
})

describe('browser resolution', () => {
  it('lists platform candidates', () => {
    expect(browserCandidates('win32', { PROGRAMFILES: 'C:\\Program Files' })[0]).toContain('msedge.exe')
    expect(browserCandidates('linux', {})).toContain('/usr/bin/chromium')
    expect(browserCandidates('darwin', {})[0]).toContain('Google Chrome')
  })

  it('classifies families', () => {
    expect(familyOf('C:/x/msedge.exe')).toBe('edge')
    expect(familyOf('C:/x/Google Chrome.app/chrome')).toBe('chrome')
    expect(familyOf('/usr/bin/chromium')).toBe('chromium')
  })

  it('returns undefined when nothing exists', () => {
    expect(resolveBrowser({ explicitPath: 'C:/definitely/not/here.exe', platform: 'linux', env: {} })).toBeUndefined()
  })
})

describe('png header', () => {
  it('reads dimensions', () => {
    expect(pngSize(makePng(4, 3))).toEqual({ width: 4, height: 3 })
    expect(pngSize(new Uint8Array([1, 2, 3]))).toBeUndefined()
  })
})

describe('render pipeline', () => {
  const fakeBrowser = (): string => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dsh-render-test-'))
    const file = path.join(dir, process.platform === 'win32' ? 'browser.exe' : 'browser')
    writeFileSync(file, 'stub')
    return file
  }

  it('returns the screenshot and its measured size', async () => {
    const browserPath = fakeBrowser()
    const result = await renderToPng(
      { kind: 'html', markup: '<p>hi</p>', width: 120, height: 80 },
      {
        browserPath,
        run: async (_args, context) => { writeFileSync(context.screenshotPath, makePng(120, 80)) },
      },
    )
    expect(result.width).toBe(120)
    expect(result.height).toBe(80)
    expect(pngSize(result.png)).toEqual({ width: 120, height: 80 })
  })

  it('scales the expected size', async () => {
    const browserPath = fakeBrowser()
    const result = await renderToPng(
      { kind: 'svg', markup: '<svg viewBox="0 0 10 10"/>', width: 100, height: 50, scale: 2 },
      { browserPath, run: async (_args, context) => { writeFileSync(context.screenshotPath, makePng(200, 100)) } },
    )
    expect(result.width).toBe(200)
  })

  it('fails when the browser wrote the wrong size', async () => {
    const browserPath = fakeBrowser()
    await expect(renderToPng(
      { kind: 'html', markup: '<p>x</p>', width: 120, height: 80 },
      { browserPath, run: async (_args, context) => { writeFileSync(context.screenshotPath, makePng(10, 10)) } },
    )).rejects.toThrow(/instead of/)
  })

  it('fails when the browser produced nothing', async () => {
    const browserPath = fakeBrowser()
    await expect(renderToPng(
      { kind: 'html', markup: '<p>x</p>', width: 20, height: 20 },
      { browserPath, run: async () => {} },
    )).rejects.toThrow(/no screenshot/i)
  })

  it('refuses to render without a browser', async () => {
    await expect(renderToPng(
      { kind: 'html', markup: '<p>x</p>', width: 20, height: 20 },
      { browserPath: 'C:/definitely/not/here.exe' },
    )).rejects.toThrow(/No Chromium-family browser/)
  })
})

describe('render route contract', () => {
  it('accepts markup or template, never both', () => {
    expect(parseRenderRequest({ kind: 'html', markup: '<p>x</p>' })).toMatchObject({ kind: 'html' })
    expect(parseRenderRequest({ kind: 'html', template: 'og-card', data: { title: 'x' } }).data).toEqual({ title: 'x' })
    expect(() => parseRenderRequest({ kind: 'html', markup: 'x', template: 'og-card' })).toThrow(/not both/)
    expect(() => parseRenderRequest({ kind: 'gif', markup: 'x' })).toThrow(/HTML or SVG/)
    expect(() => parseRenderRequest({ kind: 'html' })).toThrow(/no markup/)
  })

  it('rejects non-numeric geometry', () => {
    expect(() => parseRenderRequest({ kind: 'html', markup: 'x', width: 'wide' })).toThrow(/number/)
  })
})

describe.runIf(process.env['DSH_RENDER_REAL'] === '1')('real browser render', () => {
  it('renders the og-card template to a 1200x630 png', async () => {
    const { html } = fillTemplate('og-card', { eyebrow: 'Arya Image Gen', title: 'Real render', subtitle: 'proves the browser path', badge: 'test', footer: 'local' })
    const result = await renderToPng({ kind: 'html', markup: html, width: 1200, height: 630 })
    expect(result.width).toBe(1200)
    expect(result.height).toBe(630)
    expect(result.png.byteLength).toBeGreaterThan(1000)
  }, 60_000)
})
