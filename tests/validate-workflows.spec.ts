import { describe, expect, it } from 'vitest'
import { checkWorkflows } from '../src/validate-workflows.js'

const INFO = {
  UNETLoader: { input: { required: { unet_name: [['a.safetensors'], {}] } } },
  VAELoader: { input: { required: { vae_name: [['v.safetensors'], {}] } } },
  CLIPLoader: { input: { required: { clip_name: [['c.safetensors'], {}] } } },
  EmptyLatentImage: { input: { required: { width: ['INT', {}] } } },
  TextEncodeQwenImage21: { input: { required: { prompt: ['STRING', {}] } } },
  SamplerCustomAdvanced: {},
  VAEDecode: {},
  SaveImage: {},
}

const workflow = (nodes: Record<string, { class_type: string; inputs?: Record<string, unknown> }>): string => JSON.stringify(nodes)

describe('workflow pre-flight', () => {
  it('passes a workflow whose classes and models exist', () => {
    const entries = [{
      name: 'ok',
      json: workflow({
        1: { class_type: 'UNETLoader', inputs: { unet_name: 'a.safetensors' } },
        3: { class_type: 'VAELoader', inputs: { vae_name: 'v.safetensors' } },
        14: { class_type: 'TextEncodeQwenImage21', inputs: { prompt: '{{prompt}}', resolution: '{{resolution}}' } },
      }),
    }]
    const [check] = checkWorkflows(entries, INFO)
    expect(check?.ok).toBe(true)
    expect(check?.role).toBe('text-to-image')
  })

  it('reports a class the install does not have', () => {
    const entries = [{ name: 'missing', json: workflow({ 1: { class_type: 'FancyCustomNode' } }) }]
    const [check] = checkWorkflows(entries, INFO)
    expect(check?.ok).toBe(false)
    expect(check?.missingClasses).toEqual(['FancyCustomNode'])
  })

  it('reports a model the install cannot offer', () => {
    const entries = [{ name: 'model', json: workflow({ 1: { class_type: 'UNETLoader', inputs: { unet_name: 'ghost.safetensors' } } }) }]
    const [check] = checkWorkflows(entries, INFO)
    expect(check?.ok).toBe(false)
    expect(check?.missingModels).toEqual(['ghost.safetensors'])
  })

  it('ignores placeholder values and non-loader fields', () => {
    const entries = [{
      name: 'templated',
      json: workflow({
        1: { class_type: 'UNETLoader', inputs: { unet_name: 'a.safetensors' } },
        10: { class_type: 'EmptyLatentImage', inputs: { width: '{{width}}', height: '{{height}}' } },
        20: { class_type: 'SaveImage', inputs: { filename_prefix: 'anything' } },
      }),
    }]
    const [check] = checkWorkflows(entries, INFO)
    expect(check?.ok).toBe(true)
  })

  it('surfaces invalid json instead of throwing', () => {
    const [check] = checkWorkflows([{ name: 'broken', json: 'not json' }], INFO)
    expect(check?.ok).toBe(false)
    expect(check?.error).toBeTruthy()
  })
})
