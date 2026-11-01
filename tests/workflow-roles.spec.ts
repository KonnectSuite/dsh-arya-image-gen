import { describe, expect, it } from 'vitest'
import { prepareComfyUIWorkflow, validateComfyUIWorkflowJson } from '../src/comfyui-workflow.js'
import { selectWorkflowForRole } from '../src/config.js'
import {
  activeWorkflowForRole,
  describeWorkflowJson,
  resolveWorkflowRole,
  workflowsByRole,
  type ComfyUIWorkflowEntry,
} from '../src/shared.js'

const T2I = JSON.stringify({
  3: { inputs: { text: '{{prompt}}', clip: ['4', 0] }, class_type: 'CLIPTextEncode' },
  5: { inputs: { width: '{{width}}', height: '{{height}}', batch_size: 1 }, class_type: 'EmptyLatentImage' },
  7: { inputs: { seed: '{{seed}}', steps: '{{steps}}', cfg: '{{cfg}}' }, class_type: 'KSampler' },
})

const BAKED = JSON.stringify({
  3: { inputs: { text: '{{prompt}}' }, class_type: 'CLIPTextEncode' },
  5: { inputs: { width: 1024, height: 1344, batch_size: 1 }, class_type: 'EmptyLatentImage' },
})

const EDIT = JSON.stringify({
  3: { inputs: { text: '{{prompt}}' }, class_type: 'CLIPTextEncode' },
  10: { inputs: { image: '{{image}}' }, class_type: 'LoadImage' },
})

describe('workflow capabilities', () => {
  it('detects adjustable parameters', () => {
    const capabilities = describeWorkflowJson(T2I)
    expect(capabilities.role).toBe('text-to-image')
    expect(capabilities.placeholders).toEqual({ width: true, height: true, steps: true, cfg: true })
  })

  it('reports the baked size when nothing is adjustable', () => {
    const capabilities = describeWorkflowJson(BAKED)
    expect(capabilities.placeholders.width).toBe(false)
    expect(capabilities.bakedSize).toEqual({ width: 1024, height: 1344 })
  })

  it('classifies a workflow with an image input as image-to-image', () => {
    expect(describeWorkflowJson(EDIT).role).toBe('image-to-image')
  })

  it('survives malformed json', () => {
    expect(describeWorkflowJson('not json')).toMatchObject({ role: 'text-to-image' })
  })
})

describe('numeric placeholders', () => {
  it('injects numbers, not strings', () => {
    const prepared = prepareComfyUIWorkflow(T2I, { prompt: 'a cat', seed: 5, width: 768, height: 1344, steps: 20, cfg: 4.5 }) as Record<string, { inputs: Record<string, unknown> }>
    expect(prepared['5'].inputs).toMatchObject({ width: 768, height: 1344 })
    expect(prepared['7'].inputs).toMatchObject({ steps: 20, cfg: 4.5 })
  })

  it('refuses a parameter the workflow bakes', () => {
    expect(() => prepareComfyUIWorkflow(BAKED, { prompt: 'p', seed: 1, width: 512 }))
      .toThrow(/bakes width/)
  })

  const SIZE_ONLY = JSON.stringify({
    3: { inputs: { text: '{{prompt}}' } },
    5: { inputs: { width: '{{width}}', height: '{{height}}', batch_size: 1 } },
  })

  it('defaults size when a templated workflow runs from a plain prompt', () => {
    const prepared = prepareComfyUIWorkflow(SIZE_ONLY, { prompt: 'p', seed: 1 }) as Record<string, { inputs: Record<string, unknown> }>
    expect(prepared['5'].inputs).toMatchObject({ width: 1024, height: 1024 })
  })

  it('still refuses to leave sampling placeholders unfilled', () => {
    expect(() => prepareComfyUIWorkflow(T2I, { prompt: 'p', seed: 1, width: 512, height: 512 }))
      .toThrow(/declares \{\{steps\}\}/)
  })

  it('enforces the bounds', () => {
    expect(() => prepareComfyUIWorkflow(T2I, { prompt: 'p', seed: 1, width: 10, height: 1024, steps: 20, cfg: 4 }))
      .toThrow(/between 64 and 8192/)
    expect(() => prepareComfyUIWorkflow(T2I, { prompt: 'p', seed: 1, width: 1024, height: 1024, steps: 999, cfg: 4 }))
      .toThrow(/between 1 and 150/)
  })

  it('rejects a numeric placeholder embedded in a string', () => {
    const broken = JSON.stringify({
      3: { inputs: { text: '{{prompt}}' } },
      5: { inputs: { width: 'size {{width}}' } },
    })
    expect(() => validateComfyUIWorkflowJson(broken)).toThrow(/whole value/)
  })

  it('keeps the historical positional form working', () => {
    const prepared = prepareComfyUIWorkflow(EDIT, 'restyle', 7, 'source.png') as Record<string, { inputs: Record<string, unknown> }>
    expect(prepared['10'].inputs['image']).toBe('source.png')
  })
})

describe('roles and active selection', () => {
  const entries: ComfyUIWorkflowEntry[] = [
    { name: 'Turbo', json: T2I },
    { name: 'Edit', json: EDIT },
    { name: 'Portrait', json: BAKED, role: 'text-to-image' },
  ]

  it('resolves explicit roles over detection', () => {
    expect(resolveWorkflowRole(entries[0]!)).toBe('text-to-image')
    expect(resolveWorkflowRole(entries[1]!)).toBe('image-to-image')
    expect(workflowsByRole(entries, 'image-to-image').map(entry => entry.name)).toEqual(['Edit'])
  })

  it('falls back to the legacy active workflow for generation', () => {
    expect(activeWorkflowForRole({ comfyuiWorkflows: entries, comfyuiActiveWorkflow: 'Portrait' }, 'text-to-image')?.name).toBe('Portrait')
  })

  it('picks the first edit workflow when none is remembered', () => {
    expect(activeWorkflowForRole({ comfyuiWorkflows: entries }, 'image-to-image')?.name).toBe('Edit')
  })

  it('respects the per-role keys', () => {
    const source = { comfyuiWorkflows: entries, comfyuiActiveTextWorkflow: 'Turbo', comfyuiActiveEditWorkflow: 'Edit' }
    expect(activeWorkflowForRole(source, 'text-to-image')?.name).toBe('Turbo')
    expect(activeWorkflowForRole(source, 'image-to-image')?.name).toBe('Edit')
  })
})

describe('role-aware selection for tools', () => {
  const config = {
    comfyuiWorkflows: [
      { name: 'Turbo', json: T2I },
      { name: 'Edit', json: EDIT },
    ],
    comfyuiActiveTextWorkflow: 'Turbo',
    comfyuiActiveEditWorkflow: 'Edit',
  }

  it('picks the matching role', () => {
    expect(selectWorkflowForRole(config, 'text-to-image').name).toBe('Turbo')
    expect(selectWorkflowForRole(config, 'image-to-image').name).toBe('Edit')
  })

  it('explains a wrong-role choice', () => {
    expect(() => selectWorkflowForRole(config, 'image-to-image', 'Turbo')).toThrow(/needs image-to-image.*"Edit"/s)
  })

  it('explains a missing role', () => {
    expect(() => selectWorkflowForRole({ comfyuiWorkflows: [{ name: 'Turbo', json: T2I }] }, 'image-to-image'))
      .toThrow(/No image-to-image workflow is imported/)
  })
})
