/**
 * Guards the shipped workflow pack.
 *
 * Two layers, because they catch different failures:
 *   1. the plugin's own parser — placeholders, roles, numeric fields as whole
 *      values — which is what actually decides whether an import works;
 *   2. the live ComfyUI install, when it is reachable: every node class in the
 *      resolved workflow must exist in `object_info`.
 *
 * The second layer skips when ComfyUI is not running, so the suite stays green
 * on a machine without one.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { prepareComfyUIWorkflow, validateComfyUIWorkflowJson } from '../src/comfyui-workflow.js'
import { describeWorkflowJson, resolveWorkflowRole } from '../src/shared.js'

const dir = path.resolve('docs/workflows')
const files = readdirSync(dir).filter(name => name.endsWith('.json')).sort()
const COMFY_URL = process.env['COMFY_URL'] ?? 'http://127.0.0.1:8188'

/** Resolve one shipped workflow with representative values. */
function resolve(file: string): { json: string; prepared: Record<string, unknown>; role: string } {
  const json = readFileSync(path.join(dir, file), 'utf8')
  const role = resolveWorkflowRole({ name: file, json })
  const capabilities = describeWorkflowJson(json)
  const size = capabilities.placeholders.width || capabilities.placeholders.height
    ? { width: 1024, height: 1024 }
    : {}
  const dynamic = json.includes('{{images}}')
  const prepared = role === 'image-to-image'
    ? prepareComfyUIWorkflow(json, { prompt: 'pack probe', seed: 1, image: 'probe.png', ...(dynamic ? { images: ['probe.png', 'scene.png'] } : {}), ...size })
    : prepareComfyUIWorkflow(json, { prompt: 'pack probe', seed: 1, ...size })
  return { json, prepared, role }
}

/** Node classes for one resolved workflow. */
function classesOf(prepared: Record<string, unknown>): string[] {
  const classes = new Set<string>()
  for (const node of Object.values(prepared)) {
    const kind = (node as { class_type?: unknown }).class_type
    if (typeof kind === 'string') classes.add(kind)
  }
  return [...classes]
}

describe('shipped workflow pack', () => {
  it('ships the five documented workflows', () => {
    expect(files).toEqual([
      'qwen-image-compose.json',
      'qwen-image-create.json',
      'qwen-image-cutout.json',
      'qwen-image-edit.json',
      'qwen-image-remove-bg.json',
    ])
  })

  it('assigns the documented roles', () => {
    const roles = Object.fromEntries(files.map(file => [file, resolveWorkflowRole({ name: file, json: readFileSync(path.join(dir, file), 'utf8') })]))
    expect(roles).toEqual({
      'qwen-image-compose.json': 'image-to-image',
      'qwen-image-create.json': 'text-to-image',
      'qwen-image-cutout.json': 'text-to-image',
      'qwen-image-edit.json': 'image-to-image',
      'qwen-image-remove-bg.json': 'image-to-image',
    })
  })

  for (const file of files) {
    it(`${file} imports and resolves`, () => {
      const { json, prepared } = resolve(file)
      expect(() => validateComfyUIWorkflowJson(json)).not.toThrow()
      expect(Object.keys(prepared).length).toBeGreaterThan(0)
      // Nothing may survive as an unsubstituted placeholder.
      expect(JSON.stringify(prepared)).not.toMatch(/\{\{[a-z]+\}\}/i)
    })
  }

  it('sizes the create workflow from parameters', () => {
    const json = readFileSync(path.join(dir, 'qwen-image-create.json'), 'utf8')
    const prepared = prepareComfyUIWorkflow(json, { prompt: 'p', seed: 1, width: 1344, height: 768 }) as Record<string, { inputs?: Record<string, unknown> }>
    const latent = Object.values(prepared).find(node => node.inputs?.['batch_size'] !== undefined)
    expect(latent?.inputs).toMatchObject({ width: 1344, height: 768 })
  })

  it('matches the live ComfyUI install when one is reachable', async () => {
    let known: Set<string>
    try {
      const response = await fetch(`${COMFY_URL}/object_info`, { signal: AbortSignal.timeout(4_000) })
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
      known = new Set(Object.keys(await response.json() as Record<string, unknown>))
    } catch {
      console.log(`workflow pack: ComfyUI not reachable at ${COMFY_URL}; skipped the live node check`)
      return
    }
    const missing: string[] = []
    for (const file of files) {
      const { prepared } = resolve(file)
      for (const cls of classesOf(prepared)) if (!known.has(cls)) missing.push(`${file}: ${cls}`)
    }
    expect(missing).toEqual([])
  }, 20_000)
})
