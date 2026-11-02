# Rendering: HTML and SVG to PNG

Arya Image Gen creates images three ways. ComfyUI diffusion makes pictures of
things; the renderer makes **pages** — banners, cards, tables, icons, diagrams —
with real text and exact layout.

![Open Graph card](../assets/render/og-card.png)

## Why a second source

A generated image cannot spell a title correctly. A rendered page cannot invent
a photograph. They solve different halves of "make me an image", and both end up
in the same gallery, canvas and workspace folder.

| | `generate_image` | `render_html` | `render_svg` |
|---|---|---|---|
| Best at | scenes, people, texture | text, layout, brand | icons, diagrams, logos |
| Text fidelity | approximate | exact | exact |
| Deterministic | no | yes | yes |
| Typical time | seconds to minutes | under a second | under a second |
| Needs | a ComfyUI workflow | a browser | a browser |

**Neither render tool can look at a website.** They draw one isolated document
with no scripts, no network, no project stylesheets and no dev server, so a PNG
of a page's markup is not what that page looks like — verifying a site or an app
means running it and viewing it in a browser. The `render_html` description says
so, and when the markup reads like a page (script tags, a linked stylesheet,
nav/header/main/footer, or relative asset paths) the result carries a warning
that names the browser route.

<p align="center"><img src="../assets/render/comparison.png" alt="Comparison table" width="70%" /></p>

## Tools

### `render_html`

Renders an HTML document to a PNG. Accepts inline markup, a file from the
session workspace, or a built-in template plus slot values.

```json
{
  "template": "og-card",
  "data": {
    "eyebrow": "Arya Image Gen",
    "title": "Render HTML straight to a pixel-exact PNG",
    "subtitle": "Banners, cards and infographics with real typography.",
    "badge": "ComfyUI / HTML / SVG",
    "footer": "AryaCode"
  }
}
```

| parameter | meaning |
|---|---|
| `html` | complete document or fragment; inline CSS only |
| `source_path` | render a file inside the session workspace instead |
| `template` + `data` | a built-in template and its slot values |
| `width`, `height` | canvas in CSS pixels; defaults from settings |
| `scale` | device pixel ratio 1–4; `2` doubles the PNG |
| `background` | CSS colour behind the page |
| `timeout_ms` | per-render limit |

Exactly one of `html`, `source_path`, `template` must be given.

### `render_svg`

Rasterizes SVG at any size. Size defaults to the SVG's own `width`/`height`, then
its `viewBox`, then settings.

```json
{ "svg": "<svg viewBox=\"0 0 512 512\">…</svg>", "width": 512, "height": 512, "scale": 2 }
```

<p align="center"><img src="../assets/render/svg-icon.png" alt="SVG icon rendered to PNG" width="24%" /></p>

### `list_render_templates`

Returns every template's id, canvas size and slot names, so the model can pass
exact slot keys instead of guessing.

## Templates

Six layouts ship in the box, all on AryaCode brand tokens (Sora, `#2B6CFF`,
`#00E0D2`, `#8A5CFF`).

| id | size | slots |
|---|---|---|
| `og-card` | 1200×630 | `eyebrow` `title` `subtitle` `badge` `footer` |
| `social-square` | 1080×1080 | `kicker` `title` `subtitle` `badge` `footer` |
| `banner` | 1600×400 | `title` `accent` `subtitle` `tagline` |
| `feature-grid` | 1200×1200 | `title` `subtitle` `f1`…`f6` |
| `stat-card` | 1200×630 | `label` `value` `caption` `footnote` |
| `comparison` | 1400×900 | `title` `leftTitle` `rightTitle` `rows` `footnote` |

`banner` splits its headline so `accent` carries the gradient:

```json
{ "template": "banner", "data": { "title": "Arya Image Gen", "accent": "Render",
  "subtitle": "HTML and SVG to PNG", "tagline": "local / no cloud" } }
```

![Wide banner](../assets/render/banner.png)

`comparison` takes rows as text — one line per row, cells separated by `|`. Cells
reading `best`, `yes`, `faster` or `supported` are highlighted automatically.

```json
{ "template": "comparison",
  "data": { "title": "Diffusion or markup?", "leftTitle": "generate_image",
            "rightTitle": "render_html",
            "rows": "Scenes, people, photos|best|-\nExact text and numbers|-|best\nDeterministic|no|yes",
            "footnote": "Both land in the same gallery." } }
```

![Comparison table](../assets/render/comparison.png)

<p align="center">
  <img src="../assets/render/social-square.png" alt="Square social post" width="34%" />
  <img src="../assets/render/feature-grid.png" alt="Feature grid" width="34%" />
  <img src="../assets/render/stat-card.png" alt="Stat card" width="34%" />
</p>

Any slot value is escaped, so passing `<b>` prints it rather than bolding it;
write your own HTML when you need markup.

## Skills

Two skills ship with the plugin and load themselves when the task matches:

- **`html-to-png`** — when to render instead of generate, the template table, the
  brand token sheet, layout rules that survive a screenshot, and the render →
  look → fix loop.
- **`svg-to-png`** — viewBox discipline, gradients, text, icon and diagram
  patterns, raster scale, and which constructs are stripped.

They are in `skills/html-to-png/SKILL.md` and `skills/svg-to-png/SKILL.md`.

## Workflow

### In chat

Ask for a banner and the model reaches for `render_html`; ask for an icon and it
uses `render_svg`. The result arrives like any other image — attached, saved to
the workspace as PNG (with the `.html`/`.svg` source beside it), and available to
`edit_image` as a reference for later work.

### In the Studio

**Studio → Render** is a workbench for the same thing: template picker, code
editor, slot fields, size/scale/background, a preview of the last render and a
rail of this session's results. Rendered PNGs are ordinary attachments, so they
flow into the gallery, the infinite canvas and download unchanged.

### Settings

**Settings → Plugins → Arya Image Gen → HTML and SVG rendering**:

| field | meaning |
|---|---|
| Chromium path | explicit browser; empty auto-detects Chrome, Edge, Chromium |
| Default canvas | width and height used when a render omits them |
| Background | page colour behind the markup |
| Save source | keep the `.html`/`.svg` beside each PNG |

The section also reports whether a browser was found, so a missing renderer is
visible before the first render fails.

## Safety and limits

Rendering takes untrusted markup, so four layers apply:

1. `script`, `iframe`, `object`, `embed`, inline `on*` handlers, `@import` and
   remote URLs are stripped before the page is written.
2. The page carries `default-src 'none'` — only `data:` and `file:` resources load.
3. The browser runs with DNS mapped to nothing, so a missed reference cannot resolve.
4. Each render uses a throwaway profile and temp directory, removed afterwards.

Deliberate limits: **no JavaScript**, **no network**, and a **fixed canvas** —
there is no auto-height, so pass the size you want. Sizes are capped at
8192×8192 and scale at 4.

> Note for maintainers: do not add `--blink-settings=scriptEnabled=false`. Edge
> exits 0 and writes no screenshot with it; CSP plus the sanitizer cover scripts.

## Troubleshooting

| symptom | cause | fix |
|---|---|---|
| "No Chromium-family browser was found" | no Chrome/Edge/Chromium | install one, or set the path in settings |
| "The browser produced no screenshot" | page never loaded, or size collapsed | check the markup and the canvas size |
| "produced WxH instead of …" | device scale applied twice by a wrapper page | keep `html/body` at the requested size |
| Text overflows the card | fixed canvas | shorten the copy or lower the font size |
| A card renders blank white | content outside the viewport | check `margin`/`position` and the canvas size |

## How it works

```
render_html / render_svg ──► sanitize ──► temp page ──► headless browser
                                                            │
      attachment + workspace file ◄── saveGenerated ◄── PNG (size-checked)
```

`src/render/render.ts` writes the page, spawns the browser with
`--headless=new --screenshot` at an exact viewport and device scale factor,
verifies the PNG's real dimensions, and cleans up. Design notes and deferred work
are in [render-plan.md](render-plan.md).
