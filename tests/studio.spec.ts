import { beforeEach, describe, expect, it, vi } from 'vitest'

const generate = vi.fn()
const edit = vi.fn()

vi.mock('../src/comfyui.js', () => ({
  generateComfyUIImage: (...args: unknown[]) => generate(...args),
  editComfyUIImage: (...args: unknown[]) => edit(...args),
}))

const { describeStudio, generateFromStudio } = await import('../src/studio.js')

const WORKFLOW = JSON.stringify({ 3: { class_type: 'KSampler', inputs: { text: '{{prompt}}', seed: '{{seed}}' } } })
const EDIT_WORKFLOW = JSON.stringify({ 3: { class_type: 'KSampler', inputs: { text: '{{prompt}}' } }, 4: { class_type: 'LoadImage', inputs: { image: '{{image}}' } } })

const config = {
  comfyuiWorkflows: [
    { name: 'paint', json: WORKFLOW },
    { name: 'retouch', json: EDIT_WORKFLOW },
  ],
  comfyuiActiveWorkflow: 'paint',
}

const attachment = { attachmentId: 'att_1', mediaType: 'image/png' as const, bytes: 3, width: 4, height: 5 }
const ctx = {
  attachments: {
    imageLimits: { maxImageBytes: 1_000_000, mediaTypes: ['image/png'] as const },
    saveImage: vi.fn(async () => attachment),
    readImage: vi.fn(),
    validateImage: vi.fn(),
  },
} as never

describe('describeStudio', () => {
  it('emits one profile per workflow', () => {
    const described = describeStudio(config)
    expect(described.providers.map(profile => profile.model)).toEqual(['paint', 'retouch'])
    expect(described.activeProvider).toBe('comfyui')
    expect(described.activeWorkflow).toBe('paint')
  })

  it('marks editing capability from the {{image}} input', () => {
    const [paint, retouch] = describeStudio(config).providers
    expect(paint?.supportsEditing).toBe(false)
    expect(retouch?.supportsEditing).toBe(true)
  })

  it('reports no configured workflows as an empty list', () => {
    expect(describeStudio({}).providers).toEqual([])
  })
})

describe('generateFromStudio', () => {
  beforeEach(() => {
    generate.mockReset()
    edit.mockReset()
    generate.mockResolvedValue({ data: new Uint8Array([1, 2, 3]), mediaType: 'image/png', seed: 42 })
    edit.mockResolvedValue({ data: new Uint8Array([1, 2, 3]), mediaType: 'image/png', seed: 7 })
  })

  it('runs the selected workflow with the preset merged in', async () => {
    const result = await generateFromStudio(ctx, { ...config, comfyuiWorkflows: [{ ...config.comfyuiWorkflows[0]!, presetPrompt: 'oil' }] }, {
      mode: 'generate', provider: 'comfyui', model: 'paint', prompt: 'a cat',
    }, new AbortController().signal)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(generate.mock.calls[0]?.[0]).toMatchObject({ prompt: 'oil, a cat' })
    expect(result.output).toContain('seed 42')
    expect(result.model).toBe('paint')
  })

  it('rejects an unknown workflow', async () => {
    await expect(generateFromStudio(ctx, config, { mode: 'generate', provider: 'comfyui', model: 'nope', prompt: 'x' }, new AbortController().signal))
      .rejects.toThrow(/workflow list changed/i)
  })

  it('rejects editing with a workflow that has no image input', async () => {
    await expect(generateFromStudio(ctx, config, { mode: 'edit', provider: 'comfyui', model: 'paint', prompt: 'x' }, new AbortController().signal))
      .rejects.toThrow(/no \{\{image\}\} image input/i)
  })

  it('edits through an image-capable workflow', async () => {
    const result = await generateFromStudio(ctx, config, {
      mode: 'edit',
      provider: 'comfyui',
      model: 'retouch',
      prompt: 'make it blue',
      references: [{ mediaType: 'image/png', data: 'AAECAw==' }],
    }, new AbortController().signal)
    expect(edit).toHaveBeenCalledTimes(1)
    expect(result.seed).toBe(7)
  })
})
