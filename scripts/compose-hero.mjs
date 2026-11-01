/**
 * Compose the Arya Image Gen hero board from the generated ComfyUI background
 * plus the AryaCode brand kit (wordmark, mascot, Sora/JetBrains Mono fonts).
 */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const sharp = require('C:/Users/KNPhu/AryaCode/KonnectSuite/aryacode-brand-kit/node_modules/sharp')

const KIT = 'C:/Users/KNPhu/AryaCode/KonnectSuite/aryacode-brand-kit'
const SORA = `${KIT}/sources/fonts/Sora-Variable.ttf`
const MONO = `${KIT}/sources/fonts/JetBrainsMono-Variable.ttf`

const W = 2400
const H = 1350

/** Render one Pango-markup text block on transparency, trimmed to its glyphs. */
async function text(markup, fontfile) {
  const png = await sharp({
    text: {
      text: markup,
      fontfile,
      width: 1600,
      rgba: true,
    },
  }).png().toBuffer()
  return sharp(png).trim({ threshold: 1 }).png().toBuffer()
}

const bg = await sharp('docs/assets/readme/hero-arya-bg.png')
  .resize(W, H, { fit: 'cover', position: 'right' })
  .modulate({ brightness: 0.92, saturation: 1.05 })
  .toBuffer()

const shade = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#0F141B" stop-opacity="0.97"/>
      <stop offset="0.38" stop-color="#0F141B" stop-opacity="0.88"/>
      <stop offset="0.62" stop-color="#0F141B" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#0F141B" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="v" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#0F141B" stop-opacity="0.55"/>
      <stop offset="0.4" stop-color="#0F141B" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <rect width="${W}" height="${H}" fill="url(#v)"/>
</svg>`)

const wordmarkBuf = await sharp(`${KIT}/header/header-wordmark-2400.png`)
  .resize({ width: 760 })
  .png()
  .toBuffer()

const eyebrow = await text('<span foreground="#00E0D2" font_desc="JetBrains Mono 21">COMFYUI-NATIVE IMAGE GENERATION</span>', MONO)
const headline = await text('<span foreground="#E6E8EB" font_desc="Sora Bold 62">Your local ComfyUI studio,</span>', SORA)
const headline2 = await text('<span foreground="#E6E8EB" font_desc="Sora Bold 62">inside the chat.</span>', SORA)
const sub1 = await text('<span foreground="#B4BCC8" font_desc="Sora 27">Generate and edit images in conversation, compose on the infinite canvas,</span>', SORA)
const sub2 = await text('<span foreground="#B4BCC8" font_desc="Sora 27">and start, stop, or restart the server — all inside DeepSeek Harness.</span>', SORA)
const features = await text('<span foreground="#7F8A99" font_desc="JetBrains Mono 18">Chat  ·  Canvas  ·  Studio  ·  Compare  ·  Inspiration  ·  Server control</span>', MONO)

const mascot = await sharp(`${KIT}/companion/creating/static/512.png`)
  .resize(230, 230, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer()

const composed = await sharp(bg)
  .composite([
    { input: shade, top: 0, left: 0 },
    { input: wordmarkBuf, top: 150, left: 150 },
    { input: eyebrow, top: 335, left: 154 },
    { input: headline, top: 395, left: 150 },
    { input: headline2, top: 480, left: 150 },
    { input: sub1, top: 615, left: 152 },
    { input: sub2, top: 657, left: 152 },
    { input: features, top: 752, left: 152 },
    { input: mascot, top: 980, left: 120 },
  ])
  .webp({ quality: 92 })
  .toFile('docs/assets/readme/hero-arya.webp')

console.log('hero written', composed.width, composed.height, composed.size)
