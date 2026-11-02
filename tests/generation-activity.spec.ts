import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  activeGeneration,
  beginGeneration,
  endGeneration,
  subscribeGeneration,
  updateGeneration,
} from '../src/client/generation-activity.js'

const started = [{ callId: 'call-a' }, { callId: 'call-b' }]

afterEach(() => {
  for (const entry of started) endGeneration(entry.callId)
})

describe('generation activity store', () => {
  it('reports the newest running generation and forgets it when it ends', () => {
    beginGeneration({ callId: 'call-a', prompt: 'a fox', workflow: 'wf.json', startedAt: 1 })
    expect(activeGeneration()?.callId).toBe('call-a')

    beginGeneration({ callId: 'call-b', prompt: 'a wolf', workflow: 'wf.json', startedAt: 2 })
    expect(activeGeneration()?.callId).toBe('call-b')

    endGeneration('call-b')
    expect(activeGeneration()?.callId).toBe('call-a')

    endGeneration('call-a')
    expect(activeGeneration()).toBeUndefined()
  })

  it('merges telemetry without losing the prompt and workflow', () => {
    beginGeneration({ callId: 'call-a', prompt: 'a fox', workflow: 'wf.json', startedAt: 1 })
    updateGeneration('call-a', { snapshot: { jobId: 'job-1', phase: 'running', value: 4, max: 10, elapsedMs: 1200, startedAt: 1, previewVersion: 3, live: true } })
    const activity = activeGeneration()
    expect(activity?.prompt).toBe('a fox')
    expect(activity?.snapshot?.value).toBe(4)
    expect(activity?.snapshot?.previewVersion).toBe(3)
  })

  it('notifies subscribers on begin, update and end', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeGeneration(listener)
    beginGeneration({ callId: 'call-a', prompt: 'a fox', workflow: '', startedAt: 1 })
    updateGeneration('call-a', { prompt: 'a red fox' })
    endGeneration('call-a')
    expect(listener).toHaveBeenCalledTimes(3)
    unsubscribe()
    beginGeneration({ callId: 'call-b', prompt: 'a wolf', workflow: '', startedAt: 2 })
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('filters by session, keeping entries that do not record one', () => {
    beginGeneration({ callId: 'call-a', sessionId: 'session-1', prompt: 'a fox', workflow: '', startedAt: 1 })
    beginGeneration({ callId: 'call-b', prompt: 'a wolf', workflow: '', startedAt: 2 })
    expect(activeGeneration('session-1')?.callId).toBe('call-b')
    beginGeneration({ callId: 'call-b2', sessionId: 'session-2', prompt: 'a bear', workflow: '', startedAt: 3 })
    expect(activeGeneration('session-1')?.callId).toBe('call-b')
    expect(activeGeneration('session-2')?.callId).toBe('call-b2')
    endGeneration('call-b2')
  })
})
