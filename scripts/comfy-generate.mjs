/**
 * Run one ComfyUI API workflow directly (bypassing the plugin) and save the
 * first output image. Usage:
 *   node scripts/comfy-generate.mjs <workflow.json> <out.png> "<prompt>" [seed] [w] [h] [source.png]
 *
 * A source image uploads to ComfyUI and fills every `inputs.image === "{{image}}"`
 * field, which is how the edit workflows (Qwen Image Edit, remove background)
 * receive their reference.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

const [workflowPath, outPath, prompt, seedArg, widthArg, heightArg, sourceArg] = process.argv.slice(2)
if (!workflowPath || !outPath || !prompt) {
  console.error('usage: node scripts/comfy-generate.mjs <workflow.json> <out.png> "<prompt>" [seed] [w] [h] [source.png]')
  process.exit(1)
}
const base = process.env.COMFY_URL ?? 'http://127.0.0.1:8188'
const workflow = JSON.parse(readFileSync(workflowPath, 'utf8').replace(/^\uFEFF/, ''))
const seed = Number(seedArg ?? Math.floor(Math.random() * 1_000_000_000))
const promptJson = JSON.stringify(prompt)

let uploadedName
if (sourceArg) {
  const bytes = readFileSync(sourceArg)
  const form = new FormData()
  form.append('image', new Blob([bytes]), basename(sourceArg))
  form.append('overwrite', 'true')
  const response = await fetch(`${base}/upload/image`, { method: 'POST', body: form })
  if (!response.ok) throw new Error(`upload failed ${response.status}: ${await response.text()}`)
  const payload = await response.json()
  uploadedName = payload.name
  console.log('uploaded', uploadedName)
}

for (const node of Object.values(workflow)) {
  const inputs = node.inputs ?? {}
  for (const [key, value] of Object.entries(inputs)) {
    if (typeof value !== 'string') continue
    if (value.includes('{{prompt}}')) inputs[key] = value.replaceAll('{{prompt}}', promptJson.slice(1, -1))
    if (value === '{{seed}}') inputs[key] = seed
    if (value === '{{image}}') {
      if (uploadedName === undefined) throw new Error('this workflow needs a source image; pass one as the 7th argument')
      inputs[key] = uploadedName
    }
  }
  if (node.class_type === 'EmptyLatentImage') {
    if (widthArg) inputs.width = Number(widthArg)
    if (heightArg) inputs.height = Number(heightArg)
  }
}

const submit = await fetch(`${base}/prompt`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ prompt: workflow, client_id: 'arya-brand' }),
})
if (!submit.ok) throw new Error(`submit failed ${submit.status}: ${await submit.text()}`)
const { prompt_id: promptId } = await submit.json()
console.log('queued', promptId, 'seed', seed)

let image
for (let i = 0; i < 300; i += 1) {
  await new Promise(resolve => setTimeout(resolve, 1000))
  const history = await fetch(`${base}/history/${promptId}`).then(r => r.json())
  const entry = history[promptId]
  if (!entry) continue
  if (entry.status?.status_str === 'error') throw new Error(`workflow error: ${JSON.stringify(entry.status).slice(0, 400)}`)
  for (const output of Object.values(entry.outputs ?? {})) {
    const first = output.images?.[0]
    if (first) { image = first; break }
  }
  if (image) break
}
if (!image) throw new Error('no output image within 300s')
const url = `${base}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder ?? '')}&type=${encodeURIComponent(image.type ?? 'output')}`
const bytes = Buffer.from(await (await fetch(url)).arrayBuffer())
writeFileSync(outPath, bytes)
console.log('saved', outPath, bytes.length, 'bytes')
