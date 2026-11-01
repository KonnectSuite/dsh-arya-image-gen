import { describe, expect, it } from 'vitest'
import { Config, parseComfyUIExtraArgs, resolveProvider, selectComfyUIWorkflow } from '../src/config.js'
import { activeComfyUIWorkflow, mergeComfyUIPrompt, pickStudioWorkflow, resolveComfyUIWorkflows, uniqueComfyUIWorkflowName } from '../src/shared.js'
import { hasComfyUIImagePlaceholder, validateComfyUIWorkflowJson } from '../src/comfyui-workflow.js'

const WORKFLOW = JSON.stringify({ 3: { class_type: 'KSampler', inputs: { text: '{{prompt}}', seed: '{{seed}}' } } })
const EDIT_WORKFLOW = JSON.stringify({ 3: { class_type: 'KSampler', inputs: { text: '{{prompt}}' } }, 4: { class_type: 'LoadImage', inputs: { image: '{{image}}' } } })

describe('Config schema', () => {
  it('defaults to the ComfyUI provider and the local endpoint', () => {
    const value = Config({})
    expect((value.provider as { get?: () => string }).get?.() ?? value.provider).toBe('comfyui')
    expect((value.comfyuiBaseURL as { get?: () => string }).get?.() ?? value.comfyuiBaseURL).toBe('http://127.0.0.1:8188')
    expect((value.comfyuiAutoStart as { get?: () => boolean }).get?.() ?? value.comfyuiAutoStart).toBe(false)
  })

  it('rejects providers this fork no longer ships', () => {
    expect(() => Config({ provider: 'google' })).toThrow()
  })
})

describe('resolveProvider', () => {
  it('resolves the active workflow', () => {
    const active = resolveProvider({
      comfyuiWorkflows: [{ name: 'paint', json: WORKFLOW }],
      comfyuiActiveWorkflow: 'paint',
      comfyuiTimeoutMs: 120_000,
    })
    expect(active.provider).toBe('comfyui')
    expect(active.workflow?.name).toBe('paint')
    expect(active.timeoutMs).toBe(120_000)
  })

  it('falls back to the first workflow when none is marked active', () => {
    const active = resolveProvider({ comfyuiWorkflows: [{ name: 'a', json: WORKFLOW }, { name: 'b', json: WORKFLOW }] })
    expect(active.workflows.map(entry => entry.name)).toEqual(['a', 'b'])
    expect(active.workflow?.name).toBe('a')
  })

  it('reads the legacy single-workflow fields', () => {
    const entries = resolveComfyUIWorkflows({ comfyuiWorkflowJson: WORKFLOW, comfyuiWorkflowName: 'legacy' })
    expect(entries).toEqual([{ name: 'legacy', json: WORKFLOW }])
    expect(activeComfyUIWorkflow({ comfyuiWorkflowJson: WORKFLOW })?.name).toBe('API workflow')
  })
})

describe('selectComfyUIWorkflow', () => {
  const active = resolveProvider({ comfyuiWorkflows: [{ name: 'paint', json: WORKFLOW }, { name: 'edit', json: WORKFLOW }], comfyuiActiveWorkflow: 'paint' })

  it('defaults to the active workflow', () => {
    expect(selectComfyUIWorkflow(active).name).toBe('paint')
  })

  it('selects a requested workflow by name', () => {
    expect(selectComfyUIWorkflow(active, 'edit').name).toBe('edit')
  })

  it('rejects an unknown workflow with the available names', () => {
    expect(() => selectComfyUIWorkflow(active, 'missing')).toThrow(/paint, edit/)
  })

  it('rejects generation when no workflow is imported', () => {
    expect(() => selectComfyUIWorkflow(resolveProvider({}))).toThrow(/import one/)
  })

  it('accepts a .json suffix and different casing', () => {
    const tolerant = resolveProvider({ comfyuiWorkflows: [{ name: 'Qwen Edit', json: WORKFLOW }] })
    expect(selectComfyUIWorkflow(tolerant, 'Qwen Edit.json').name).toBe('Qwen Edit')
    expect(selectComfyUIWorkflow(tolerant, 'qwen edit').name).toBe('Qwen Edit')
    const withSuffix = resolveProvider({ comfyuiWorkflows: [{ name: 'paint.json', json: WORKFLOW }] })
    expect(selectComfyUIWorkflow(withSuffix, 'paint').name).toBe('paint.json')
  })
})

describe('parseComfyUIExtraArgs', () => {
  it('splits plain arguments', () => {
    expect(parseComfyUIExtraArgs('--listen 127.0.0.1 --disable-auto-launch')).toEqual(['--listen', '127.0.0.1', '--disable-auto-launch'])
  })

  it('keeps quoted groups together', () => {
    expect(parseComfyUIExtraArgs('--flag "two words" --x')).toEqual(['--flag', 'two words', '--x'])
  })

  it('returns an empty list for blank input', () => {
    expect(parseComfyUIExtraArgs('   ')).toEqual([])
  })
})

describe('workflow helpers', () => {
  it('joins preset and user text once', () => {
    expect(mergeComfyUIPrompt('watercolor,', 'a cat')).toBe('watercolor, a cat')
    expect(mergeComfyUIPrompt(undefined, 'a cat')).toBe('a cat')
    expect(mergeComfyUIPrompt('watercolor', '')).toBe('watercolor')
  })

  it('derives unique workflow labels', () => {
    expect(uniqueComfyUIWorkflowName('paint', [])).toBe('paint')
    expect(uniqueComfyUIWorkflowName('paint', ['paint'])).toBe('paint (2)')
    expect(uniqueComfyUIWorkflowName('  ', [])).toBe('API workflow')
  })

  it('detects editing workflows by their image input', () => {
    expect(hasComfyUIImagePlaceholder(WORKFLOW)).toBe(false)
    expect(hasComfyUIImagePlaceholder(EDIT_WORKFLOW)).toBe(true)
  })

  it('validates API-format workflow JSON', () => {
    expect(() => validateComfyUIWorkflowJson(WORKFLOW)).not.toThrow()
    expect(() => validateComfyUIWorkflowJson('{}')).toThrow()
    expect(() => validateComfyUIWorkflowJson('not json')).toThrow()
    expect(() => validateComfyUIWorkflowJson(JSON.stringify({ 1: { inputs: { text: 'no placeholder' } } }))).toThrow(/must contain/)
  })
})

describe('pickStudioWorkflow', () => {
  const profile = (model, supportsEditing) => ({ provider: 'comfyui', label: 'ComfyUI', model, modelOptions: [], configured: true, supportsEditing, ratioOptions: [], qualityOptions: [], defaultRatio: 'auto', defaultQuality: 'auto' })
  const profiles = [profile('paint', false), profile('edit', true)]

  it('uses the remembered workflow when it fits the mode', () => {
    expect(pickStudioWorkflow(profiles, 'generate', 'paint')?.model).toBe('paint')
    expect(pickStudioWorkflow(profiles, 'edit', 'edit')?.model).toBe('edit')
  })

  it('falls back to a compatible workflow instead of the remembered one', () => {
    expect(pickStudioWorkflow(profiles, 'edit', 'paint')?.model).toBe('edit')
  })

  it('ignores the .json suffix and letter case', () => {
    expect(pickStudioWorkflow(profiles, 'generate', 'PAINT.json')?.model).toBe('paint')
  })

  it('returns undefined when the mode has no compatible workflow', () => {
    expect(pickStudioWorkflow([profile('paint', false)], 'edit', 'paint')).toBeUndefined()
  })
})