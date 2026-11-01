/** Second pass: translate strings that still contain CJK or kana with sl=auto. */
import { readFileSync, writeFileSync } from 'node:fs'

const FILES = ['handraw-style', 'awesome-gpt-image-2']
const NEEDS = /[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9f]/

async function translate(text) {
  const body = new URLSearchParams({ q: text, client: 'gtx', sl: 'auto', tl: 'en', dt: 't' })
  const response = await fetch('https://translate.googleapis.com/translate_a/single', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Mozilla/5.0' },
    body,
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const payload = await response.json()
  return payload[0].map(part => part[0]).join('').trim()
}

function collect(value, out) {
  if (typeof value === 'string') { if (NEEDS.test(value)) out.add(value) }
  else if (Array.isArray(value)) value.forEach(item => collect(item, out))
  else if (value !== null && typeof value === 'object') Object.values(value).forEach(item => collect(item, out))
}
function map(value, table) {
  if (typeof value === 'string') return table.get(value) ?? value
  if (Array.isArray(value)) return value.map(item => map(item, table))
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, map(v, table)]))
  return value
}

for (const name of FILES) {
  const path = `src/inspiration/data/${name}.json`
  const json = JSON.parse(readFileSync(path, 'utf8'))
  const strings = new Set()
  collect(json, strings)
  console.log(`${name}: ${strings.size} strings left`)
  const table = new Map()
  const queue = [...strings]
  let errors = 0
  async function worker() {
    while (queue.length > 0) {
      const text = queue.shift()
      if (text === undefined) return
      try {
        const translated = await translate(text)
        if (translated.length > 0) table.set(text, translated)
      } catch { errors += 1 }
      await new Promise(resolve => setTimeout(resolve, 80))
    }
  }
  await Promise.all([worker(), worker(), worker()])
  writeFileSync(path, JSON.stringify(map(json, table)))
  const left = (JSON.stringify(map(json, table)).match(/[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9f]/g) || []).length
  console.log(`${name}: done, errors ${errors}, CJK/kana left ${left}`)
}
