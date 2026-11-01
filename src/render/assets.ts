/**
 * Brand assets for rendered pages: font files and the token sheet every
 * template starts from.
 *
 * The fonts ship with the package (SIL OFL, see assets/fonts/*-OFL.txt) so a
 * rendered banner looks identical on a machine that never installed Sora.
 *
 * @module dsh-arya-image-gen/render/assets
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Directory holding this module at runtime (lib/ in a build, src/render in tests). */
const moduleDir = path.dirname(fileURLToPath(import.meta.url))

/**
 * Locate the packaged assets directory from either layout.
 *
 * @returns absolute path to `assets`.
 */
export function assetsDir(): string {
  const fromLib = path.resolve(moduleDir, '..', 'assets')
  if (existsSync(fromLib)) return fromLib
  return path.resolve(moduleDir, '..', '..', 'assets')
}

/**
 * File URL for one bundled font, for `@font-face src`.
 *
 * @param file - font file name.
 * @returns a `file://` URL.
 */
export function fontUrl(file: string): string {
  return pathToFileURL(path.join(assetsDir(), 'fonts', file)).href
}

/** Arya brand tokens as CSS custom properties. */
export const BRAND_TOKENS = `:root{
  --arya-blue:#2B6CFF;
  --arya-teal:#00E0D2;
  --arya-purple:#8A5CFF;
  --arya-ink:#0F141B;
  --arya-slate:#4A5A72;
  --arya-muted:#6E7F96;
  --arya-line:#E3E9F2;
  --arya-surface:#F7FAFF;
  --arya-white:#FFFFFF;
  --arya-grad:linear-gradient(96deg,#1B49D6 0%,#2B6CFF 46%,#00C9BE 100%);
}`

/** Reset plus the two bundled families. */
export const BASE_CSS = `${BRAND_TOKENS}
@font-face{font-family:"Sora";src:url("${fontUrl('Sora-Variable.ttf')}") format("truetype");font-weight:100 800;font-display:block}
@font-face{font-family:"JetBrains Mono";src:url("${fontUrl('JetBrainsMono-Variable.ttf')}") format("truetype");font-weight:100 800;font-display:block}
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:"Sora","Segoe UI",system-ui,sans-serif;color:var(--arya-ink);background:var(--arya-white);-webkit-font-smoothing:antialiased}
img,svg{display:block}
`

/** Mono text helper class shared by templates. */
export const MONO_CLASS = '.mono{font-family:"JetBrains Mono",ui-monospace,monospace}'
