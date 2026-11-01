import { describe, expect, it } from 'vitest'
import { CanvasMirror } from '../src/canvas-state.js'
import { imageToolContext } from '../src/image-tool-context.js'
import { safePromptText } from '../src/shared.js'

const workflows = [{ name: 'paint', json: JSON.stringify({ 1: { inputs: { text: '{{prompt}}' } } }) }]

describe('system-prompt context safety', () => {
  it('never emits double braces, which AryaCode reads as unknown variables', () => {
    const text = imageToolContext({ comfyuiWorkflows: workflows, comfyuiActiveWorkflow: 'paint' })
    expect(text).not.toContain('{{')
    expect(text).not.toContain('}}')
    expect(text).toContain('paint')
  })

  it('escapes braces in a workflow name the user controls', () => {
    const text = imageToolContext({ comfyuiWorkflows: [{ name: 'a{{image}}b', json: '{}' }] })
    expect(text).not.toContain('{{')
  })

  it('sanitizes canvas text and prompts in the digest', () => {
    const mirror = new CanvasMirror()
    mirror.apply({
      clientInstance: 'c1',
      connected: true,
      nodeCount: 2,
      nodes: [
        { kind: 'text', text: 'use {{image}} here', name: 'note {{x}}' },
        { kind: 'image', prompt: 'paint {{seed}}', name: 'img' },
      ],
      sequence: 1,
      updatedAt: Date.now(),
    })
    const digest = mirror.digest()
    expect(digest).not.toContain('{{')
    expect(digest).not.toContain('}}')
    expect(digest).toContain('{ {image} }')
  })

  it('leaves plain text untouched', () => {
    expect(safePromptText('plain text')).toBe('plain text')
  })
})
