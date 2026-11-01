/**
 * Live ComfyUI job telemetry: a per-job WebSocket subscription to ComfyUI's
 * /ws endpoint, reduced to a small snapshot the workbench can poll, plus the
 * latest latent preview frame and cancellation.
 *
 * Progress is strictly best-effort: an unreachable socket, an old server, or a
 * proxy that rejects the upgrade must never fail the generation itself.
 */

export type ComfyUIJobPhase = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export interface ComfyUIJobSnapshot {
  jobId: string
  promptId?: string | undefined
  phase: ComfyUIJobPhase
  queueRemaining?: number | undefined
  nodeId?: string | undefined
  nodeLabel?: string | undefined
  /** Step progress of the executing node (0 when unknown). */
  value: number
  max: number
  elapsedMs: number
  queueAhead?: number
  startedAt: number
  finishedAt?: number | undefined
  error?: string | undefined
  previewVersion: number
  /** Whether the live WebSocket is connected; false means timing-only. */
  live: boolean
}

export interface ComfyUIPreview {
  data: Uint8Array
  version: number
}

interface Job {
  id: string
  baseURL: string
  headers: Record<string, string>
  startedAt: number
  queueAhead: number
  promptId?: string | undefined
  phase: ComfyUIJobPhase
  nodeId?: string | undefined
  value: number
  max: number
  queueRemaining?: number | undefined
  labels: Map<string, string>
  socket?: SocketLike | undefined
  live: boolean
  preview?: Uint8Array | undefined
  previewVersion: number
  listeners: Set<() => void>
  finishedAt?: number | undefined
  error?: string | undefined
  sweep?: ReturnType<typeof setTimeout> | undefined
}

/** Structural WebSocket face; Node's global WebSocket satisfies it. */
interface SocketLike {
  readyState: number
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onerror: ((event: unknown) => void) | null
  onclose: (() => void) | null
  close(): void
}

type SocketFactory = (url: string) => SocketLike

const JOB_ID = /^[A-Za-z0-9-]{8,72}$/
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024
const JOB_TTL_MS = 10 * 60_000
const CONNECT_TIMEOUT_MS = 3_000

export class ComfyUIProgressRegistry {
  private readonly jobs = new Map<string, Job>()
  private readonly now: () => number
  private readonly socketFactory: SocketFactory

  constructor(options: { now?: () => number; socketFactory?: SocketFactory } = {}) {
    this.now = options.now ?? (() => Date.now())
    this.socketFactory = options.socketFactory ?? ((url: string) => new (globalThis as unknown as { WebSocket: new (url: string) => SocketLike }).WebSocket(url))
  }

  /** Start or refresh one job. Returns undefined for an unusable job id. */
  ensure(jobId: string, options: { baseURL: string; headers?: Record<string, string>; workflowJson?: string; queueAhead?: number }): ComfyUIJobSnapshot | undefined {
    if (!JOB_ID.test(jobId)) return undefined
    let job = this.jobs.get(jobId)
    if (job === undefined) {
      job = {
        id: jobId,
        baseURL: options.baseURL,
        headers: options.headers ?? {},
        startedAt: this.now(),
        queueAhead: options.queueAhead ?? 0,
        phase: 'queued',
        value: 0,
        max: 0,
        labels: labelsOf(options.workflowJson),
        live: false,
        previewVersion: 0,
        listeners: new Set(),
      }
      this.jobs.set(jobId, job)
      this.connect(job)
    }
    return this.snapshot(jobId)
  }

  /** Mark the job terminal; the snapshot stays readable briefly for late polls. */
  finish(jobId: string, phase: 'done' | 'error' | 'cancelled' = 'done', error?: string): void {
    const job = this.jobs.get(jobId)
    if (job === undefined) return
    if (job.phase === 'done' || job.phase === 'error' || job.phase === 'cancelled') return
    job.phase = phase
    job.finishedAt = this.now()
    if (error !== undefined) job.error = error
    this.closeSocket(job)
    this.notify(job)
    job.sweep = setTimeout(() => { this.jobs.delete(jobId) }, JOB_TTL_MS)
    job.sweep.unref?.()
  }

  setQueueAhead(jobId: string, queueAhead: number): void {
    const job = this.jobs.get(jobId)
    if (job === undefined) return
    job.queueAhead = Math.max(0, queueAhead)
    this.notify(job)
  }

  snapshot(jobId: string): ComfyUIJobSnapshot | undefined {
    const job = this.jobs.get(jobId)
    if (job === undefined) return undefined
    return {
      jobId: job.id,
      ...(job.promptId === undefined ? {} : { promptId: job.promptId }),
      phase: job.phase,
      ...(job.queueRemaining === undefined ? {} : { queueRemaining: job.queueRemaining }),
      ...(job.nodeId === undefined ? {} : { nodeId: job.nodeId }),
      ...(() => { const label = job.nodeId === undefined ? undefined : job.labels.get(job.nodeId); return label === undefined ? {} : { nodeLabel: label } })(),
      value: job.value,
      max: job.max,
      elapsedMs: Math.max(0, (job.finishedAt ?? this.now()) - job.startedAt),
      queueAhead: job.queueAhead,
      startedAt: job.startedAt,
      ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
      ...(job.error === undefined ? {} : { error: job.error }),
      previewVersion: job.previewVersion,
      live: job.live,
    }
  }

  subscribe(jobId: string, listener: () => void): () => void {
    const job = this.jobs.get(jobId)
    if (job === undefined) return () => {}
    job.listeners.add(listener)
    return () => { job.listeners.delete(listener) }
  }

  preview(jobId: string): ComfyUIPreview | undefined {
    const job = this.jobs.get(jobId)
    if (job?.preview === undefined) return undefined
    return { data: job.preview, version: job.previewVersion }
  }

  /** Remove a queued/running prompt, then mark the job cancelled. */
  async cancel(jobId: string): Promise<ComfyUIJobSnapshot | undefined> {
    const job = this.jobs.get(jobId)
    if (job === undefined) return undefined
    const running = job.phase === 'running'
    const promptId = job.promptId
    this.closeSocket(job)
    if (promptId !== undefined) {
      await this.post(job, 'queue', { delete: [promptId] }).catch(() => undefined)
      if (running) await this.post(job, 'interrupt', {}).catch(() => undefined)
    }
    this.finish(jobId, 'cancelled')
    return this.snapshot(jobId)
  }

  private connect(job: Job): void {
    let socket: SocketLike
    try {
      socket = this.socketFactory(this.webSocketURL(job))
    } catch {
      job.live = false
      return
    }
    job.socket = socket
    let opened = false
    const timeout = setTimeout(() => {
      if (!opened) { try { socket.close() } catch { /* already closed */ } }
    }, CONNECT_TIMEOUT_MS)
    timeout.unref?.()
    socket.onopen = () => {
      opened = true
      clearTimeout(timeout)
      job.live = true
      this.notify(job)
    }
    socket.onmessage = event => { this.onMessage(job, event.data) }
    socket.onerror = () => { job.live = false }
    socket.onclose = () => { job.live = false; this.notify(job) }
  }

  private onMessage(job: Job, raw: unknown): void {
    if (typeof raw === 'string') {
      this.onEvent(job, raw)
      return
    }
    // ComfyUI binary frames: 4-byte big-endian event type, then payload.
    const bytes = toBytes(raw)
    if (bytes === undefined || bytes.byteLength < 4) return
    const type = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0)
    if (type !== 1 && type !== 4) return
    if (bytes.byteLength < 64 || bytes.byteLength > MAX_PREVIEW_BYTES) return
    job.preview = bytes.subarray(4)
    job.previewVersion += 1
    this.notify(job)
  }

  private onEvent(job: Job, text: string): void {
    let message: { type?: unknown; data?: unknown }
    try { message = JSON.parse(text) as { type?: unknown; data?: unknown } } catch { return }
    if (typeof message.type !== 'string') return
    const data = record(message.data)
    const promptId = typeof data?.prompt_id === 'string' ? data.prompt_id : undefined
    if (promptId !== undefined) job.promptId = promptId
    switch (message.type) {
      case 'status': {
        const remaining = record(record(data?.status)?.exec_info)?.queue_remaining
        if (typeof remaining === 'number') job.queueRemaining = remaining
        break
      }
      case 'execution_start':
        job.phase = 'running'
        break
      case 'executing': {
        const node = data?.node
        if (node === null) { this.finish(job.id, 'done'); return }
        if (typeof node === 'string' || typeof node === 'number') job.nodeId = String(node)
        job.phase = 'running'
        break
      }
      case 'progress': {
        if (typeof data?.value === 'number') job.value = data.value
        if (typeof data?.max === 'number') job.max = data.max
        if (typeof data?.node === 'string' || typeof data?.node === 'number') job.nodeId = String(data.node)
        job.phase = 'running'
        break
      }
      case 'progress_state': {
        const nodes = record(data?.nodes)
        if (nodes !== undefined) {
          const active = Object.entries(nodes).map(([id, state]) => ({ id, state: record(state) }))
            .filter(entry => entry.state?.state === 'running')
          const chosen = active.find(entry => typeof entry.state?.max === 'number' && entry.state.max > 0) ?? active[0]
          if (chosen !== undefined) {
            job.nodeId = chosen.id
            if (typeof chosen.state?.value === 'number') job.value = chosen.state.value
            if (typeof chosen.state?.max === 'number') job.max = chosen.state.max
            job.phase = 'running'
          }
        }
        break
      }
      case 'execution_success':
        this.finish(job.id, 'done')
        return
      case 'execution_error': {
        const messageText = typeof data?.exception_message === 'string' ? data.exception_message : 'ComfyUI execution failed'
        this.finish(job.id, 'error', messageText)
        return
      }
      default:
        break
    }
    this.notify(job)
  }

  private notify(job: Job): void {
    for (const listener of job.listeners) {
      try { listener() } catch { /* a broken subscriber cannot stop telemetry */ }
    }
  }

  private closeSocket(job: Job): void {
    const socket = job.socket
    job.socket = undefined
    job.live = false
    if (socket === undefined) return
    try { socket.close() } catch { /* already closed */ }
  }

  private webSocketURL(job: Job): string {
    const url = new URL(job.baseURL)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const basePath = url.pathname.replace(/\/$/, '')
    url.pathname = `${basePath}/ws`
    url.search = new URLSearchParams({ clientId: job.id }).toString()
    return url.toString()
  }

  private async post(job: Job, path: string, body: Record<string, unknown>): Promise<void> {
    const url = new URL(job.baseURL.endsWith('/') ? job.baseURL : `${job.baseURL}/`)
    const response = await fetch(new URL(path, url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...job.headers },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) throw new Error(`ComfyUI ${path} failed (${response.status})`)
  }
}

/** Human-readable label per workflow node: the class name plus its title if it has one. */
function labelsOf(workflowJson: string | undefined): Map<string, string> {
  const labels = new Map<string, string>()
  if (workflowJson === undefined) return labels
  try {
    const graph = JSON.parse(workflowJson) as unknown
    const nodes = record(graph)
    if (nodes === undefined) return labels
    for (const [id, value] of Object.entries(nodes)) {
      const node = record(value)
      const className = typeof node?.class_type === 'string' ? node.class_type : undefined
      const title = record(node?._meta)?.title
      if (className === undefined) continue
      labels.set(id, typeof title === 'string' && title.length > 0 ? `${className} — ${title}` : className)
    }
  } catch { /* labels are cosmetic; invalid JSON is validated elsewhere */ }
  return labels
}

function toBytes(value: unknown): Uint8Array | undefined {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  return undefined
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** Process-wide registry shared by the Studio route and the progress route. */
export const comfyProgress = new ComfyUIProgressRegistry()
