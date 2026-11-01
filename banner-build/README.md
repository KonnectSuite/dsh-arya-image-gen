# Hero banner

The README hero is a normal HTML page rendered by this plugin's own
`render_html` pipeline — the same code path the tools use.

- `hero.html` — the source. `{{AVATAR}}` is replaced with a data URL of the
  AryaCode companion art before rendering.
- `banner.png` — the 2400x1250 render.
- `../docs/assets/readme/hero-arya-wide.webp` — the copy the README loads
  (153 KB, quality 92).

## Rebuild

```bash
pnpm build
node --experimental-strip-types -e "…"   # or run the vitest one-off below
```

The practical path is a throwaway vitest spec, because the renderer lives in
TypeScript:

```ts
import { readFileSync, writeFileSync } from 'node:fs'
import { renderToPng } from '../src/render/render.js'

const avatar = `data:image/png;base64,${readFileSync(
  'C:/Users/KNPhu/AryaCode/KonnectSuite/aryacode-brand-kit/companion/greeting/static/512.png',
).toString('base64')}`
const html = readFileSync('banner-build/hero.html', 'utf8').replace('{{AVATAR}}', avatar)
const out = await renderToPng({ kind: 'html', markup: html, width: 2400, height: 1250 })
writeFileSync('banner-build/banner.png', out.png)
```

Run it with `pnpm test -- tests/hero.spec.ts`, then refresh the WebP:

```bash
python -c "from PIL import Image; Image.open('banner-build/banner.png').convert('RGB').save('docs/assets/readme/hero-arya-wide.webp','WEBP',quality=92,method=6)"
```

Sora and JetBrains Mono are injected by the renderer's base stylesheet, so the
banner uses the same fonts as the plugin UI without referencing the brand kit.
