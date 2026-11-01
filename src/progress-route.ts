/** Same-origin route for live ComfyUI job snapshots, previews, and cancellation. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ComfyUIJobSnapshot, ComfyUIPreview } from './comfyui-progress.js'

export interface ComfyUIProgressRouteDeps {
  snapshot(jobId: string): ComfyUIJobSnapshot | undefined
  subscribe(jobId: string, listener: () => void): () => void
  preview(jobId: string): ComfyUIPreview | undefined
  cancel(jobId: string): Promise<ComfyUIJobSnapshot | undefined>
}

const JOB_PATH = /^\/([A-Za-z0-9-]{8,72})(?:\/(preview|stream|cancel))?$/

export async function serveComfyUIProgress(req: IncomingMessage, res: ServerResponse, deps: ComfyUIProgressRouteDeps, pathname: string): Promise<void> {
  if (!sameOrigin(req)) return json(res, 403, { error: 'origin-rejected' })
  const match = JOB_PATH.exec(pathname)
  if (match === null) return json(res, 404, { error: 'unknown-job' })
  const [, jobId, action] = match as unknown as [string, string, string | undefined]
  const snapshot = deps.snapshot(jobId)
  if (snapshot === undefined) return json(res, 404, { error: 'unknown-job' })

  if (action === 'cancel') {
    if (req.method !== 'POST') return json(res, 405, { error: 'method-not-allowed' })
    const cancelled = await deps.cancel(jobId)
    return json(res, 200, { job: cancelled ?? snapshot })
  }
  if (req.method !== 'GET') return json(res, 405, { error: 'method-not-allowed' })
  if (action === undefined && new URL(req.url ?? '/', 'http://localhost').searchParams.get('format') === 'json') {
    return json(res, 200, { job: snapshot })
  }

  if (action === 'preview') {
    const preview = deps.preview(jobId)
    if (preview === undefined) return json(res, 404, { error: 'no-preview' })
    res.writeHead(200, {
      'content-type': previewMediaType(preview.data),
      'content-length': String(preview.data.byteLength),
      'cache-control': 'no-store',
      'x-preview-version': String(preview.version),
    })
    res.end(Buffer.from(preview.data))
    return
  }

  // Server-sent events: one JSON snapshot per change, plus elapsed updates.
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  const send = (value: ComfyUIJobSnapshot): void => {
    res.write(`data: ${JSON.stringify(value)}\n\n`)
  }
  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    unsubscribe()
    res.end()
  }
  const unsubscribe = deps.subscribe(jobId, () => {
    const next = deps.snapshot(jobId)
    if (next === undefined) return close()
    send(next)
    if (next.phase === 'done' || next.phase === 'error' || next.phase === 'cancelled') close()
  })
  const heartbeat = setInterval(() => {
    const next = deps.snapshot(jobId)
    if (next === undefined) return close()
    send(next)
    if (next.phase === 'done' || next.phase === 'error' || next.phase === 'cancelled') close()
  }, 1_000)
  heartbeat.unref?.()
  req.on('close', close)
  send(snapshot)
  if (snapshot.phase === 'done' || snapshot.phase === 'error' || snapshot.phase === 'cancelled') close()
}

function previewMediaType(data: Uint8Array): string {
  if (data[0] === 0x89 && data[1] === 0x50) return 'image/png'
  if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg'
  return 'application/octet-stream'
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  const host = req.headers.host
  return origin === undefined || host === undefined || origin === `http://${host}` || origin === `https://${host}`
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) })
  res.end(text)
}
