/**
 * Translate the bundled inspiration libraries to English in place.
 *
 * Joins unique Chinese strings into batches with an "###" separator, calls the
 * public Google Translate gtx endpoint, and maps results back. Placeholders
 * such as {{prompt}} and [UPPER CASE] tokens are shielded before translation.
 * Batches whose separator count changes fall back to per-string translation.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const FILES = ['handraw-style', 'awesome-gpt-image-2']
const SEP = '\n###\n'
const CONCURRENCY = 3
const MAX_BATCH_CHARS = 3500

const CJK = /[\u4e00-\u9fff]/

function shield(text) {
  const slots = []
  const shielded = text
    .replace(/\{\{[a-z]+\}\}/g, match => { slots.push(match); return `__SLOT${slots.length - 1}__` })
    .replace(/\[[A-Z][A-Z0-9 /_-]*\]/g, match => { slots.push(match); return `__SLOT${slots.length - 1}__` })
  return { shielded, restore: value => value.replace(/__SLOT(\d+)__/g, (_, index) => slots[Number(index)]) }
}

async function translateText(text) {
  const body = new URLSearchParams({ q: text, client: 'gtx', sl: 'zh-CN', tl: 'en', dt: 't' })
  const response = await fetch('https://translate.googleapis.com/translate_a/single', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Mozilla/5.0' },
    body,
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const payload = await response.json()
  return payload[0].map(part => part[0]).join('')
}

async function translateOne(text) {
  const { shielded, restore } = shield(text)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return restore(await translateText(shielded)).trim()
    } catch (error) {
      if (attempt === 1) throw error
      await new Promise(resolve => setTimeout(resolve, 2500))
      continue
      await new Promise(resolve => setTimeout(resolve, 1500))
    }
  }
}

function collectStrings(value, out) {
  if (typeof value === 'string') {
    if (CJK.test(value)) out.add(value)
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out)
  } else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, out)
  }
}

function mapStrings(value, map) {
  if (typeof value === 'string') return map.get(value) ?? value
  if (Array.isArray(value)) return value.map(item => mapStrings(item, map))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, map)]))
  }
  return value
}

async function translateBatch(strings) {
  const results = new Map()
  const chunks = []
  let current = []
  let length = 0
  for (const text of strings) {
    const extra = text.length + SEP.length
    if (current.length > 0 && length + extra > MAX_BATCH_CHARS) {
      chunks.push(current)
      current = []
      length = 0
    }
    current.push(text)
    length += extra
  }
  if (current.length > 0) chunks.push(current)

  let done = 0
  const queue = [...chunks]
  async function worker() {
    while (queue.length > 0) {
      const chunk = queue.shift()
      if (chunk === undefined) return
      const { shielded, restore } = shield(chunk.join(SEP))
      try {
        const translated = restore(await translateText(shielded))
        const parts = translated.split(/\n?#{3}\n?/).map(part => part.trim())
        if (parts.length === chunk.length) {
          chunk.forEach((text, index) => results.set(text, parts[index]))
        } else {
          for (const text of chunk) results.set(text, await translateOne(text))
        }
      } catch {
        for (const text of chunk) results.set(text, await translateOne(text))
      }
      done += chunk.length
      process.stdout.write(`\r${done}/${strings.length} strings translated`)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  process.stdout.write('\n')
  return results
}

for (const name of FILES) {
  const path = `src/inspiration/data/${name}.json`
  const json = JSON.parse(readFileSync(path, 'utf8'))
  const strings = new Set()
  collectStrings(json, strings)
  console.log(`${name}: ${strings.size} unique Chinese strings`)
  const map = await translateBatch([...strings])
  writeFileSync(path, JSON.stringify(mapStrings(json, map)))
  console.log(`${name}: written`)
}
console.log('done')
