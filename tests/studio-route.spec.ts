import { describe, expect, it } from 'vitest'
import { parseStudioGenerateRequest } from '../src/studio-route.js'

describe('parseStudioGenerateRequest', () => {
  it('keeps a valid progress job id', () => {
    const request = parseStudioGenerateRequest({ mode: 'generate', provider: 'comfyui', model: 'paint', prompt: 'a tree', jobId: 'job-12345678' })
    expect(request.jobId).toBe('job-12345678')
  })

  it('drops an invalid job id instead of failing the request', () => {
    const request = parseStudioGenerateRequest({ mode: 'generate', provider: 'comfyui', model: 'paint', prompt: 'a tree', jobId: '../etc/passwd' })
    expect(request.jobId).toBeUndefined()
  })
})
