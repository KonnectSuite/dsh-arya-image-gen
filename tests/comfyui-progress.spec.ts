import { describe, expect, it, vi, afterEach } from 'vitest'
import { ComfyUIProgressRegistry } from '../src/comfyui-progress.js'

class FakeSocket {
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onclose: (() => void) | null = null
  closed = false
  constructor(readonly url: string) {}
  open(): void { this.readyState = 1; this.onopen?.() }
  emit(data: unknown): void { this.onmessage?.({ data }) }
  close(): void { this.closed = true; this.readyState = 3; this.onclose?.() }
}

const workflowJson = JSON.stringify({
  '10': { class_type: 'KSampler', _meta: { title: 'Sample' } },
  '6': { class_type: 'CLIPTextEncode' },
})

function registryWith(options: { now?: () => number } = {}) {
  const sockets: FakeSocket[] = []
  const registry = new ComfyUIProgressRegistry({
    ...(options.now === undefined ? {} : { now: options.now }),
    socketFactory: url => { const socket = new FakeSocket(url); sockets.push(socket); return socket as never },
  })
  return { registry, sockets }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('ComfyUIProgressRegistry', () => {
  it('tracks queue, node progress, and completion', () => {
    const { registry, sockets } = registryWith()
    registry.ensure('job-aaaaaaaa', { baseURL: 'http://127.0.0.1:8188', workflowJson })
    expect(sockets).toHaveLength(1)
    expect(sockets[0]!.url).toContain('/ws?clientId=job-aaaaaaaa')
    expect(registry.snapshot('job-aaaaaaaa')?.phase).toBe('queued')
    sockets[0]!.open()
    expect(registry.snapshot('job-aaaaaaaa')?.live).toBe(true)
    sockets[0]!.emit(JSON.stringify({ type: 'status', data: { status: { exec_info: { queue_remaining: 2 } } } }))
    expect(registry.snapshot('job-aaaaaaaa')?.queueRemaining).toBe(2)
    sockets[0]!.emit(JSON.stringify({ type: 'execution_start', data: { prompt_id: 'p1' } }))
    sockets[0]!.emit(JSON.stringify({ type: 'progress_state', data: { nodes: {
      '10': { value: 3, max: 10, state: 'running' },
      '6': { value: 1, max: 1, state: 'finished' },
    } } }))
    const running = registry.snapshot('job-aaaaaaaa')
    expect(running).toMatchObject({ phase: 'running', promptId: 'p1', value: 3, max: 10, nodeId: '10', nodeLabel: 'KSampler — Sample' })
    sockets[0]!.emit(JSON.stringify({ type: 'executing', data: { node: null, prompt_id: 'p1' } }))
    expect(registry.snapshot('job-aaaaaaaa')?.phase).toBe('done')
    expect(sockets[0]!.closed).toBe(true)
  })

  it('keeps the latest binary preview frame', () => {
    const { registry, sockets } = registryWith()
    registry.ensure('job-bbbbbbbb', { baseURL: 'http://127.0.0.1:8188' })
    const jpeg = new Uint8Array(100)
    jpeg.set([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02])
    const frame = new Uint8Array(4 + jpeg.byteLength)
    new DataView(frame.buffer).setUint32(0, 4)
    frame.set(jpeg, 4)
    sockets[0]!.emit(frame.buffer)
    expect(registry.snapshot('job-bbbbbbbb')?.previewVersion).toBe(1)
    expect(Array.from(registry.preview('job-bbbbbbbb')!.data)).toEqual(Array.from(jpeg))
  })

  it('cancels a running prompt in ComfyUI', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      calls.push(String(input))
      return new Response('{}', { status: 200 })
    }))
    const { registry, sockets } = registryWith()
    registry.ensure('job-cccccccc', { baseURL: 'http://127.0.0.1:8188' })
    sockets[0]!.emit(JSON.stringify({ type: 'execution_start', data: { prompt_id: 'p2' } }))
    const snapshot = await registry.cancel('job-cccccccc')
    expect(snapshot?.phase).toBe('cancelled')
    expect(calls.some(url => url.endsWith('/queue'))).toBe(true)
    expect(calls.some(url => url.endsWith('/interrupt'))).toBe(true)
    expect(sockets[0]!.closed).toBe(true)
  })

  it('reports elapsed time from an injected clock', () => {
    let now = 1_000
    const { registry } = registryWith({ now: () => now })
    registry.ensure('job-dddddddd', { baseURL: 'http://127.0.0.1:8188' })
    now = 3_500
    expect(registry.snapshot('job-dddddddd')?.elapsedMs).toBe(2500)
  })

  it('ignores malformed job ids', () => {
    const { registry } = registryWith()
    expect(registry.ensure('../etc/passwd', { baseURL: 'http://127.0.0.1:8188' })).toBeUndefined()
  })
})
