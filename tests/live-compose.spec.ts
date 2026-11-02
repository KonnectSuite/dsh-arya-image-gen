/**
 * Live multi-reference check against a running ComfyUI.
 *
 * Opt-in: set `COMFY_LIVE=1` (and optionally `COMFY_URL`, `COMFY_REF_A`,
 * `COMFY_REF_B`). Skipped by default so the suite stays hermetic - this talks
 * to a real server and spends minutes of GPU time.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { editComfyUIImage } from '../src/comfyui.js'

const LIVE = process.env['COMFY_LIVE'] === '1'
const BASE_URL = process.env['COMFY_URL'] ?? 'http://127.0.0.1:8188'
const REF_A = process.env['COMFY_REF_A'] ?? 'C:/Users/KNPhu/OneDrive/Documents/AryaAI/Fixes/dsh-arya-image-gen/image-a15cc06a.png'
const REF_B = process.env['COMFY_REF_B'] ?? 'C:/Users/KNPhu/OneDrive/Documents/AryaAI/Fixes/dsh-arya-image-gen/image-c84f8cd8.png'
const WORKFLOW = readFileSync('docs/workflows/qwen-image-compose.json', 'utf8')

describe('compose workflow (live)', () => {
  it.skipIf(!LIVE)('runs two references through the dynamic marker', async () => {
    const first = new Uint8Array(readFileSync(REF_A))
    const second = new Uint8Array(readFileSync(REF_B))
    const controller = new AbortController()
    const result = await editComfyUIImage({
      baseURL: BASE_URL,
      workflowJson: WORKFLOW,
      prompt: 'Take the subject of image 1 and place it in the setting of image 2. Keep the subject\'s shape and colours exactly; match the light of the second image.',
      sourceImages: [
        { data: first, mediaType: 'image/png' },
        { data: second, mediaType: 'image/png' },
      ],
      timeoutMs: 600_000,
      maxBytes: 20 * 1024 * 1024,
      signal: controller.signal,
    })
    expect(result.data.byteLength).toBeGreaterThan(1000)
    expect(result.mediaType).toMatch(/^image\//u)
  }, 700_000)
})
