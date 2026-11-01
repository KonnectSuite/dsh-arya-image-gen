---
name: html-to-png
description: Render HTML to a PNG image with the Arya Image Gen plugin (render_html). Use when a user wants a banner, social card, infographic, table, poster, icon sheet or any pixel-exact layout with real typography, instead of a diffusion-generated image.
---

# HTML to PNG with render_html

## When to use it

Use `render_html` when the user wants **exact text and layout**: banners, Open Graph cards, slides, comparison tables, infographics, badges, README art. Use `generate_image` when the user wants a scene, character, illustration or photo.

## The loop

1. `list_render_templates` once per session to see ids and slot names.
2. `render_html` with either `template` + `data`, or your own `html`.
3. **Look at the returned image.** Fix spacing, overflow, line breaks, contrast.
4. Re-render with the correction. Keep iterating until it looks right.

## Templates

| id | size | slots |
|---|---|---|
| `og-card` | 1200x630 | eyebrow, title, subtitle, badge, footer |
| `social-square` | 1080x1080 | kicker, title, subtitle, badge, footer |
| `banner` | 1600x400 | title, subtitle, tagline |
| `feature-grid` | 1200x1200 | title, subtitle, f1..f6 |
| `stat-card` | 1200x630 | label, value, caption, footnote |
| `comparison` | 1400x900 | title, leftTitle, rightTitle, rows, footnote |

`rows` is text, one line per row, cells separated by `|`:
`"Latency|seconds to minutes|under a second"`. Cells reading `best`, `yes`,
`faster` or `supported` are highlighted. Every other slot is escaped text, so
`<b>` prints literally — write custom HTML when you need markup.

Prefer a template when the layout is generic; write custom HTML when the request has its own structure.

## Hard limits (do not fight them)

- **No JavaScript** and **no network**. Scripts are stripped, DNS resolves to nothing. Every asset must be inline CSS, a `data:` URL, or a local file.
- **Fixed canvas.** There is no auto-height: pass `width` and `height`. Content that overflows is clipped.
- Fonts: **Sora** (text) and **JetBrains Mono** (code/labels) ship with the plugin; system fonts are the fallback.
- `scale: 2` doubles the PNG for crisp text on retina; it does not change the CSS layout.

## Brand kit

```css
--arya-blue:#2B6CFF; --arya-teal:#00E0D2; --arya-purple:#8A5CFF;
--arya-ink:#0F141B; --arya-slate:#4A5A72; --arya-line:#E3E9F2;
--arya-grad:linear-gradient(96deg,#1B49D6 0%,#2B6CFF 46%,#00C9BE 100%);
```

These variables exist on the page already — do not redeclare them. Headlines: Sora 800, tight letter-spacing (-0.03em). Body: Sora 400, color `--arya-slate`. Eyebrows/labels: JetBrains Mono uppercase with `letter-spacing:.14em`.

## Layout that survives a screenshot

- Set `html,body{margin:0;height:100%}` and lay out with flexbox, not floats.
- One idea per card: eyebrow, headline, one supporting line, footer.
- Keep side padding >= 6% of the width; keep text off the last 40px.
- Long titles overflow: shorten the copy or reduce the font size rather than trusting wrapping.
- Gradients: radial glows behind light backgrounds read as brand; heavy full-bleed gradients fight the text.

## Example

```json
{ "template": "og-card",
  "data": { "eyebrow": "Arya Image Gen", "title": "Your local ComfyUI studio",
            "subtitle": "Generate, edit and compose inside the chat.", "badge": "ComfyUI", "footer": "AryaCode" } }
```

Then, if the user wants changes, send the whole HTML again through `render_html` — do not try to edit the PNG with `edit_image` when the source is HTML.
