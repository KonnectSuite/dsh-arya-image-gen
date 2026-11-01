/**
 * Built-in render templates.
 *
 * Each template is a complete HTML document with `{{slot}}` placeholders, sized
 * to its own canvas. They share the brand token sheet and bundled fonts from
 * `assets.ts`, so a rendered card looks like the rest of AryaCode without the
 * model inventing a theme each time.
 *
 * @module dsh-arya-image-gen/render/templates
 */

/** One template the tool and the Studio can render. */
export interface RenderTemplate {
  id: string
  label: string
  description: string
  width: number
  height: number
  slots: readonly string[]
  html: string
}

const PAGE = (width: number, height: number, css: string, body: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><style>html,body{width:${String(width)}px;height:${String(height)}px;overflow:hidden}${css}</style></head><body>${body}</body></html>`

const OG_CARD = PAGE(1200, 630, `
.card{position:relative;width:100%;height:100%;padding:72px;display:flex;flex-direction:column;justify-content:space-between;
  background:radial-gradient(120% 120% at 100% 0%,rgba(0,224,210,.18),transparent 55%),radial-gradient(90% 90% at 0% 100%,rgba(43,108,255,.14),transparent 60%),#fff}
.eyebrow{display:inline-flex;align-items:center;gap:12px;font-family:"JetBrains Mono",monospace;font-size:22px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--arya-blue)}
.dot{width:14px;height:14px;border-radius:50%;background:var(--arya-grad)}
h1{margin:26px 0 0;font-size:76px;line-height:1.04;letter-spacing:-2.4px;font-weight:800;color:var(--arya-ink);max-width:940px}
h1 .g{background:var(--arya-grad);-webkit-background-clip:text;background-clip:text;color:transparent}
p{margin:22px 0 0;font-size:30px;line-height:1.4;color:var(--arya-slate);max-width:860px}
.foot{display:flex;align-items:center;gap:16px;font-family:"JetBrains Mono",monospace;font-size:20px;color:var(--arya-muted)}
.pill{padding:10px 18px;border-radius:999px;background:rgba(43,108,255,.10);color:var(--arya-blue);font-weight:600}
`, `
<div class="card">
  <div>
    <div class="eyebrow"><span class="dot"></span>{{eyebrow}}</div>
    <h1>{{title}}</h1>
    <p>{{subtitle}}</p>
  </div>
  <div class="foot"><span class="pill">{{badge}}</span><span>{{footer}}</span></div>
</div>`)

const SOCIAL_SQUARE = PAGE(1080, 1080, `
.card{width:100%;height:100%;padding:96px 84px;display:flex;flex-direction:column;justify-content:space-between;background:var(--arya-grad);color:#fff}
.kicker{font-family:"JetBrains Mono",monospace;font-size:26px;letter-spacing:.16em;text-transform:uppercase;opacity:.9}
h1{margin:0;font-size:104px;line-height:1.02;letter-spacing:-3.6px;font-weight:800}
p{margin:28px 0 0;font-size:34px;line-height:1.42;opacity:.94;max-width:820px}
.foot{font-family:"JetBrains Mono",monospace;font-size:26px;opacity:.9;display:flex;justify-content:space-between}
`, `
<div class="card">
  <div>
    <div class="kicker">{{kicker}}</div>
    <h1>{{title}}</h1>
  </div>
  <div>
    <p>{{subtitle}}</p>
    <div class="foot"><span>{{badge}}</span><span>{{footer}}</span></div>
  </div>
</div>`)

const BANNER = PAGE(1600, 400, `
.card{width:100%;height:100%;display:flex;align-items:center;gap:56px;padding:0 72px;background:
  radial-gradient(60% 140% at 12% 50%,rgba(0,224,210,.22),transparent 62%),#fff;border-left:18px solid var(--arya-blue)}
h1{margin:0;font-size:78px;line-height:1.05;letter-spacing:-2.6px;font-weight:800}
h1 .g{background:var(--arya-grad);-webkit-background-clip:text;background-clip:text;color:transparent}
p{margin:16px 0 0;font-size:30px;color:var(--arya-slate)}
.tag{margin-left:auto;font-family:"JetBrains Mono",monospace;font-size:24px;color:var(--arya-blue);text-align:right;white-space:nowrap}
`, `
<div class="card">
  <div>
    <h1>{{title}} <span class="g">{{accent}}</span></h1>
    <p>{{subtitle}}</p>
  </div>
  <div class="tag">{{tagline}}</div>
</div>`)

const FEATURE_GRID = PAGE(1200, 1200, `
.wrap{width:100%;height:100%;padding:80px;background:#fff;display:flex;flex-direction:column;gap:44px}
h1{margin:0;font-size:68px;line-height:1.06;letter-spacing:-2px;font-weight:800}
p.sub{margin:14px 0 0;font-size:28px;color:var(--arya-slate)}
.grid{flex:1;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr 1fr;gap:24px}
.cell{border:2px solid var(--arya-line);border-radius:26px;padding:30px;display:flex;flex-direction:column;gap:14px;background:var(--arya-surface)}
.n{width:52px;height:52px;border-radius:14px;background:var(--arya-grad);color:#fff;display:flex;align-items:center;justify-content:center;font-family:"JetBrains Mono",monospace;font-size:22px;font-weight:700}
.t{font-size:30px;font-weight:700}
.d{font-size:21px;line-height:1.4;color:var(--arya-slate)}
`, `
<div class="wrap">
  <div><h1>{{title}}</h1><p class="sub">{{subtitle}}</p></div>
  <div class="grid">
    <div class="cell"><div class="n">1</div><div class="t">{{f1}}</div></div>
    <div class="cell"><div class="n">2</div><div class="t">{{f2}}</div></div>
    <div class="cell"><div class="n">3</div><div class="t">{{f3}}</div></div>
    <div class="cell"><div class="n">4</div><div class="t">{{f4}}</div></div>
    <div class="cell"><div class="n">5</div><div class="t">{{f5}}</div></div>
    <div class="cell"><div class="n">6</div><div class="t">{{f6}}</div></div>
  </div>
</div>`)

const STAT_CARD = PAGE(1200, 630, `
.card{width:100%;height:100%;padding:80px;display:flex;flex-direction:column;justify-content:center;
  background:radial-gradient(80% 120% at 100% 0%,rgba(138,92,255,.16),transparent 60%),#fff;border-top:14px solid var(--arya-teal)}
.label{font-family:"JetBrains Mono",monospace;font-size:24px;letter-spacing:.16em;text-transform:uppercase;color:var(--arya-muted)}
.value{margin:12px 0 0;font-size:180px;line-height:1;letter-spacing:-8px;font-weight:800;
  background:var(--arya-grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.caption{margin:16px 0 0;font-size:34px;color:var(--arya-ink);font-weight:600}
.foot{margin-top:34px;font-family:"JetBrains Mono",monospace;font-size:21px;color:var(--arya-muted)}
`, `
<div class="card">
  <div class="label">{{label}}</div>
  <div class="value">{{value}}</div>
  <div class="caption">{{caption}}</div>
  <div class="foot">{{footnote}}</div>
</div>`)

const COMPARISON = PAGE(1400, 900, `
.wrap{width:100%;height:100%;padding:64px;background:#fff;display:flex;flex-direction:column;gap:26px}
h1{margin:0;font-size:56px;line-height:1.06;letter-spacing:-1.8px;font-weight:800}
table{width:100%;border-collapse:separate;border-spacing:0 10px;font-size:24px}
th{font-family:"JetBrains Mono",monospace;font-size:20px;letter-spacing:.08em;text-transform:uppercase;color:var(--arya-muted);text-align:left;padding:0 20px 8px}
th.h{color:var(--arya-blue)}
td{padding:20px;background:var(--arya-surface);border-top:2px solid var(--arya-line);border-bottom:2px solid var(--arya-line)}
td:first-child{border-left:2px solid var(--arya-line);border-radius:16px 0 0 16px;font-weight:600}
td:last-child{border-right:2px solid var(--arya-line);border-radius:0 16px 16px 0}
td.k{color:var(--arya-teal);font-weight:700}
.foot{font-family:"JetBrains Mono",monospace;font-size:19px;color:var(--arya-muted)}
`, `
<div class="wrap">
  <h1>{{title}}</h1>
  <table>
    <thead><tr><th>Metric</th><th class="h">{{leftTitle}}</th><th class="h">{{rightTitle}}</th></tr></thead>
    <tbody>{{rows}}</tbody>
  </table>
  <div class="foot">{{footnote}}</div>
</div>`)

/** Every built-in template, in picker order. */
export const RENDER_TEMPLATES: readonly RenderTemplate[] = [
  {
    id: 'og-card',
    label: 'Open Graph card',
    description: 'Link-preview card with eyebrow, gradient headline and footer badges.',
    width: 1200,
    height: 630,
    slots: ['eyebrow', 'title', 'subtitle', 'badge', 'footer'],
    html: OG_CARD,
  },
  {
    id: 'social-square',
    label: 'Square social post',
    description: '1080x1080 gradient post for feeds.',
    width: 1080,
    height: 1080,
    slots: ['kicker', 'title', 'subtitle', 'badge', 'footer'],
    html: SOCIAL_SQUARE,
  },
  {
    id: 'banner',
    label: 'Wide banner',
    description: '1600x400 README banner with a gradient headline.',
    width: 1600,
    height: 400,
    slots: ['title', 'accent', 'subtitle', 'tagline'],
    html: BANNER,
  },
  {
    id: 'feature-grid',
    label: 'Feature grid',
    description: 'Square sheet with six numbered feature cells.',
    width: 1200,
    height: 1200,
    slots: ['title', 'subtitle', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6'],
    html: FEATURE_GRID,
  },
  {
    id: 'stat-card',
    label: 'Stat card',
    description: 'One large gradient number with label and footnote.',
    width: 1200,
    height: 630,
    slots: ['label', 'value', 'caption', 'footnote'],
    html: STAT_CARD,
  },
  {
    id: 'comparison',
    label: 'Comparison table',
    description: 'Two-option table; rows are one line per row, cells separated by |.',
    width: 1400,
    height: 900,
    slots: ['title', 'leftTitle', 'rightTitle', 'rows', 'footnote'],
    html: COMPARISON,
  },
]

/**
 * Look a template up by id.
 *
 * @param id - template id.
 * @returns the template, or undefined.
 */
export function findTemplate(id: string): RenderTemplate | undefined {
  return RENDER_TEMPLATES.find(template => template.id === id)
}

/**
 * Fill a template's slots.
 *
 * `{{name}}` is replaced literally; an unknown name is an error because a typo
 * would otherwise silently render an empty card. Missing values render empty.
 *
 * @param id - template id.
 * @param data - slot values.
 * @returns the finished document.
 */
export function fillTemplate(id: string, data: Record<string, unknown> = {}): { html: string; template: RenderTemplate } {
  const template = findTemplate(id)
  if (template === undefined) {
    throw new Error(`Unknown render template "${id}". Available templates: ${RENDER_TEMPLATES.map(entry => entry.id).join(', ')}.`)
  }
  const unknown = Object.keys(data).filter(key => !template.slots.includes(key))
  if (unknown.length > 0) {
    throw new Error(`Template "${id}" has no slot ${unknown.map(name => `"${name}"`).join(', ')}. Slots: ${template.slots.join(', ')}.`)
  }
  const html = template.html.replace(/\{\{([a-z0-9_]+)\}\}/gi, (_match, name: string) => {
    const value = data[name]
    if (value === undefined || value === null) return ''
    return renderSlot(template.id, name, String(value))
  })
  return { html, template }
}

/**
 * Render one slot value. Every slot is escaped text except the comparison
 * table's `rows`, which is a line-per-row, cell-per-`|` list so the template can
 * build valid table markup without ever trusting caller HTML.
 *
 * @param templateId - template the slot belongs to.
 * @param name - slot name.
 * @param value - raw value.
 * @returns HTML for the slot.
 */
export function renderSlot(templateId: string, name: string, value: string): string {
  if (templateId === 'comparison' && name === 'rows') {
    return value.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => {
        const cells = line.split('|').map(cell => cell.trim())
        return `<tr>${cells.map((cell, index) => {
          const highlight = index > 0 && /^(best|yes|faster|supported)$/i.test(cell) ? ' class="k"' : ''
          return `<td${highlight}>${escapeHtml(cell)}</td>`
        }).join('')}</tr>`
      })
      .join('')
  }
  return escapeHtml(value)
}

/**
 * Escape text for an HTML text node or attribute.
 *
 * @param value - raw text.
 * @returns escaped text.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
