/**
 * Build the handraw-style inspiration snapshot from a local clone of
 * https://github.com/yang0/handraw-style. Usage:
 *   node scripts/build-handraw-snapshot.mjs <clone-dir> <out-json>
 *
 * Reads skills/handdraw-style-prompter/references/{styles,layouts,colors}.json
 * plus the per-layout prompt markdown, and emits the plugin's snapshot schema
 * (repository / totalCases / categories / styles / scenes / cases). Image paths
 * stay repo-relative; the server-side image proxy resolves them against the
 * pinned upstream commit.
 *
 * This fork ships an English-only catalog: the script requires English inputs
 * (`traits`/`group` in styles.json, `name_en`/`quote_en`/`prompt_en` in
 * colors.json, and the `<!-- en -->` section of each layout markdown). Translate
 * or extend the upstream reference data before regenerating.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const [cloneDir, outPath] = process.argv.slice(2)
if (cloneDir === undefined || outPath === undefined) {
  console.error('usage: node scripts/build-handraw-snapshot.mjs <clone-dir> <out-json>')
  process.exit(1)
}
const refs = join(cloneDir, 'skills/handdraw-style-prompter/references')
const styles = JSON.parse(readFileSync(join(refs, 'styles.json'), 'utf8'))
const layouts = JSON.parse(readFileSync(join(refs, 'layouts.json'), 'utf8'))
const colors = JSON.parse(readFileSync(join(refs, 'colors.json'), 'utf8'))
const layoutPrompt = new Map()
for (const file of readdirSync(join(refs, 'layouts'))) {
  layoutPrompt.set(file.replace(/\.md$/, ''), readFileSync(join(refs, 'layouts', file), 'utf8'))
}

const LAYOUT_CATEGORY = { 'social-card': 'Social card', infographic: 'Infographic', 'comic-storyboard': 'Comic storyboard' }

function requireEnglish(label, text) {
  if (/[\u4e00-\u9fff\u3040-\u30ff]/.test(String(text))) throw new Error(`${label} is not English yet; translate the upstream reference data first`)
}

// Upstream ships per-style webps under images/individual, split into two
// numbered bands; layouts/colors keep their own directories.
function styleImage(number) {
  const n = Number.parseInt(number, 10)
  const band = n <= 200 ? '001-200' : '201-400'
  return `/images/individual/${band}/${String(n).padStart(3, '0')}.webp`
}

const cases = []
const categories = new Set()
const styleTags = new Set()

for (const s of styles) {
  requireEnglish(`style #${s.number} traits`, s.traits)
  requireEnglish(`style #${s.number} group`, s.group)
  const category = s.group.split('·').slice(1).join('·').trim() || s.group
  categories.add(`Style · ${category}`)
  styleTags.add(category)
  const prompt = [
    `Hand Drawn Style #${s.number} · ${s.generation_name} (original reference: ${s.reference}).`,
    `Core style features: ${s.traits}`,
    'Usage: replace "Topic: ..." with your subject; text-free mode generates directly, while image+text mode lets the wording join the composition; layer optional layout and theme-color style numbers on top.',
  ].join('\n')
  cases.push({
    id: `s-${s.number}`,
    title: `#${s.number} ${s.generation_name}`,
    image: styleImage(s.number),
    imageAlt: `Hand drawn style ${s.number} ${s.generation_name}`,
    sourceLabel: s.reference,
    prompt,
    promptPreview: `${s.generation_name} · ${s.traits.slice(0, 120)}`,
    category: `Style · ${category}`,
    styles: [category],
    scenes: [],
    featured: false,
  })
}

for (const l of layouts) {
  const category = `Layout · ${LAYOUT_CATEGORY[l.category] ?? l.category}`
  categories.add(category)
  styleTags.add(l.name)
  const md = layoutPrompt.get(l.id) ?? ''
  const en = (md.match(/<!-- en -->\s*([\s\S]*)$/) ?? [])[1]?.trim() ?? ''
  requireEnglish(`layout ${l.id}`, en || l.name)
  const prompt = en || `Layout ${l.id} ${l.name}`
  cases.push({
    id: `l-${l.id.toLowerCase()}`,
    title: `${l.id} ${l.name}`,
    image: `/images/layouts/${l.category}s/${l.id}.webp`,
    imageAlt: `Layout ${l.id} ${l.name}`,
    prompt,
    promptPreview: `${l.name}（${l.name_en}）`,
    category,
    styles: [l.name],
    scenes: l.keywords.slice(0, 5),
    featured: false,
  })
}

for (const c of colors) {
  requireEnglish(`color ${c.id}`, c.name_en)
  const category = `Mono · ${c.category_en ?? c.category_zh}`
  categories.add(category)
  const prompt = `Theme color ${c.id} · ${c.name_en} — ${c.quote_en ?? c.quote_zh}.\n${c.prompt_en}\nConstraints: the theme color only affects the palette; never render color names, codes, or values as text in the image.`
  cases.push({
    id: `c-${c.id.toLowerCase()}`,
    title: `${c.id} ${c.name_en}`,
    image: `/images/colors/${c.id}.webp`,
    imageAlt: `Theme color ${c.id} ${c.name_en}`,
    prompt,
    promptPreview: `${c.name_en} · ${c.quote_en ?? c.quote_zh}`,
    category,
    styles: [c.name_en],
    scenes: [],
    featured: false,
  })
}

const snapshot = {
  repository: 'https://github.com/yang0/handraw-style',
  totalCases: cases.length,
  categories: [...categories],
  styles: [...styleTags].slice(0, 120),
  scenes: [],
  cases,
}
writeFileSync(outPath, JSON.stringify(snapshot))
console.log(`wrote ${cases.length} cases to ${outPath}`)
