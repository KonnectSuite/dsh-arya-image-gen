---
name: svg-to-png
description: Author and rasterize SVG with the Arya Image Gen plugin (render_svg). Use for icons, logos, diagrams, charts, badges, pattern art and anything that must stay crisp when scaled.
---

# SVG with render_svg

## When to use it

Use `render_svg` for **vector-native work**: icons, logo marks, simple diagrams, flow charts, geometric patterns, badges. Use `render_html` when the layout is text-heavy; use `generate_image` for photographic or illustrative scenes.

Not for checking a website or an app: `render_svg` draws one isolated document, so it cannot tell you how a page renders. That needs the project running in a browser.

The SVG is rendered by the browser, so text stays real text — no font-to-path conversion needed.

## Authoring rules

1. Always declare a `viewBox`. Size defaults to it, so `viewBox="0 0 24 24"` renders 24x24 unless you pass `width`/`height`.
2. Keep the artwork inside the viewBox; anything outside is clipped.
3. Prefer `currentColor`-free explicit fills for a standalone image — there is no page theme to inherit.
4. Use `<defs>` for gradients, masks and clip paths, and give every `id` a unique name.
5. Text: set `font-family="Sora, sans-serif"` for UI labels and `"JetBrains Mono"` for code-like text, `font-weight` between 400 and 800. Add `dominant-baseline="middle"` for vertical centering.
6. Strokes scale with the viewBox: a 2px stroke in a 24-unit viewBox is thin at 512px — prefer fills for logos, strokes for diagrams.

## Rasterizing

| want | call |
|---|---|
| icon at UI size | `{ "svg": "...", "width": 64, "height": 64 }` |
| hero icon | `{ "svg": "...", "width": 512, "height": 512, "scale": 2 }` |
| transparent background | `background: "transparent"` |
| page-proof sheet | raise `width`/`height`, keep the viewBox |

Ask for `scale: 2` when the user will zoom or print.

## What is stripped

`<script>`, `<foreignObject>`, event handlers such as `onload`, and any `http(s)` or protocol-relative reference. External images and fonts never load: inline them as `data:` URLs, or draw with shapes.

## Useful patterns

- **Rounded mark**: `<rect width="..." height="..." rx="..."/>` on a gradient, one letterform or glyph on top.
- **Gradient**: `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` with `<stop offset="0" stop-color="#2B6CFF"/>` to `#00E0D2`.
- **Diagram**: rects with `rx="12"` and connector paths with `stroke-width="2"`, arrows via `<marker>`.
- **Chart**: bars are `<rect>` with computed heights; put the axis labels in the template, not in the SVG text, when they need wrapping.

## After rendering

Look at the PNG. Common fixes: text touching an edge (grow the viewBox), a gradient reading muddy at small size (raise contrast), or a hairline looking wrong at 2x (widen the stroke before scaling).
