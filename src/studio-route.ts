/** Same-origin HTTP bridge used by the browser image workbench. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { parseImageAttachmentRef } from './reference-image.js'
import {
  DEFAULT_COMFYUI_TIMEOUT_MS,
  type StudioConfigResponse,
  type StudioGenerateRequest,
  type StudioGenerateResponse,
  type StudioReference,
} from './shared.js'

export interface StudioRouteDeps {
  describe(): Promise<StudioConfigResponse>
  generate(input: StudioGenerateRequest, signal: AbortSignal): Promise<StudioGenerateResponse>
  maxBodyBytes: number
  timeoutMs?: number
  /** Heartbeat cadence for the streaming generation response; tests shrink it. */
  heartbeatMs?: number
}

/** Serve workbench capabilities and generation requests without exposing endpoints. */
export async function serveStudio(req: IncomingMessage, res: ServerResponse, deps: StudioRouteDeps): Promise<void> {
  if (!sameOrigin(req)) return jsonError(res, 403, 'origin-rejected')
  if (req.method === 'GET') {
    try {
      return json(res, 200, await deps.describe())
    } catch (error) {
      return jsonError(res, 500, errorMessage(error, 'studio-unavailable'))
    }
  }
  if (req.method !== 'POST') return jsonError(res, 405, 'method-not-allowed')
  if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    return jsonError(res, 415, 'json-required')
  }

  const controller = new AbortController()
  // Upstream watchdog: a stalled ComfyUI run must fail loudly instead of
  // pinning the browser spinner until undici's default 300s headers timeout fires.
  const watchdog = new AbortController()
  const signal = AbortSignal.any([controller.signal, watchdog.signal])
  const onConnectionClose = () => {
    if (!res.writableEnded) {
      controller.abort(new Error('The browser closed the image generation request.'))
    }
  }
  const onReqAborted = () => {
    controller.abort(new Error('The browser closed the image generation request.'))
  }

  res.once('close', onConnectionClose)
  req.once('aborted', onReqAborted)

  try {
    let input: StudioGenerateRequest
    try {
      input = parseStudioGenerateRequest(JSON.parse(await readBody(req, deps.maxBodyBytes)))
    } catch (error) {
      return jsonError(res, 400, errorMessage(error, 'invalid-request'))
    }
    const timeoutMs = deps.timeoutMs ?? DEFAULT_COMFYUI_TIMEOUT_MS
    const timeout = setTimeout(() => { watchdog.abort() }, timeoutMs)
    timeout.unref?.()
    // Respond with headers immediately and heartbeat newlines while the
    // workflow runs: reverse proxies (openresty defaults to 60s) reset
    // proxy_read_timeout on every upstream byte, so long generations survive
    // the gateway. JSON parsers skip leading whitespace, and failures after
    // this point surface as { error } bodies that clients already handle.
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    })
    const heartbeat = setInterval(() => {
      if (!res.destroyed && !res.writableEnded) res.write('\n')
    }, deps.heartbeatMs ?? 15_000)
    try {
      try {
        const output = await deps.generate(input, signal)
        res.end(JSON.stringify(output))
      } catch (error) {
        if (res.destroyed || res.writableEnded) return
        const message = watchdog.signal.aborted
          ? `ComfyUI generation timed out after ${String(Math.round(timeoutMs / 1000))} s. Check the server in Settings, then try again.`
          : errorMessage(error, 'generation-failed')
        res.end(JSON.stringify({ error: message }))
      }
    } finally {
      clearInterval(heartbeat)
      clearTimeout(timeout)
    }
  } catch (error) {
    if (res.headersSent || res.writableEnded || res.destroyed) {
      // Client disconnected prematurely; do not write to closed/destroyed socket
      return
    }
    jsonError(res, controller.signal.aborted ? 499 : 502, errorMessage(error, 'generation-failed'))
  } finally {
    res.off('close', onConnectionClose)
    req.off('aborted', onReqAborted)
  }
}

/** Strictly validate the small untrusted workbench wire contract. */
export function parseStudioGenerateRequest(value: unknown): StudioGenerateRequest {
  const input = record(value)
  if (input === undefined) throw new Error('The request payload is invalid.')
  if (input.mode !== 'generate' && input.mode !== 'edit') throw new Error('Choose a generation mode.')
  if (input.provider !== 'comfyui') throw new Error('Only the ComfyUI provider is supported.')
  const prompt = requiredText(input.prompt, 'Enter a prompt.')
  const model = requiredText(input.model, 'Pick a workflow.', 200)
  const rawReferences = Array.isArray(input.references)
    ? input.references
    : input.reference !== undefined
      ? [input.reference]
      : []
  const references = rawReferences.map(parseReference)
  if (input.mode === 'edit' && references.length === 0) throw new Error('Image-to-image editing needs at least one reference image.')
  if (references.length > 5) throw new Error('At most 5 reference images are supported.')
  const jobId = typeof input.jobId === 'string' && /^[A-Za-z0-9-]{8,72}$/.test(input.jobId) ? input.jobId : undefined
  const workspaceRoot = typeof input.workspaceRoot === 'string' && input.workspaceRoot.trim().length > 0
    ? input.workspaceRoot.trim()
    : undefined
  let count: number | undefined
  if (input.count !== undefined) {
    if (typeof input.count !== 'number' || !Number.isInteger(input.count) || input.count < 1 || input.count > 4) {
      throw new Error('Generation count must be between 1 and 4.')
    }
    count = input.count
  }
  return {
    mode: input.mode,
    provider: 'comfyui',
    model,
    prompt,
    ...(count !== undefined ? { count } : {}),
    ...(jobId === undefined ? {} : { jobId }),
    ...(references.length > 0 ? { references, reference: references[0] } : {}),
    ...(workspaceRoot !== undefined ? { workspaceRoot } : {}),
  }
}

function parseReference(value: unknown): StudioReference {
  const reference = record(value)
  if (reference === undefined) throw new Error('The reference image format is invalid.')
  if ('attachment' in reference) {
    const attachment = parseImageAttachmentRef(reference.attachment)
    if (attachment === undefined) throw new Error('The reference image attachment is invalid.')
    return { attachment }
  }
  if (!imageMediaType(reference.mediaType) || typeof reference.data !== 'string') {
    throw new Error('The reference image format is invalid.')
  }
  if (reference.data.length === 0) throw new Error('The reference image is empty.')
  if (reference.name !== undefined && typeof reference.name !== 'string') throw new Error('The reference image name is invalid.')
  return {
    mediaType: reference.mediaType,
    data: reference.data,
    ...(typeof reference.name === 'string' ? { name: reference.name.slice(0, 240) } : {}),
  }
}

function requiredText(value: unknown, message: string, maxLength?: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(message)
  const text = value.trim()
  if (maxLength !== undefined && text.length > maxLength) throw new Error(`${message} (at most ${String(maxLength)} characters)`)
  return text
}

function imageMediaType(value: unknown): value is ImageMediaType {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp' || value === 'image/gif'
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  const host = req.headers.host
  return origin === undefined || host === undefined || origin === `http://${host}` || origin === `https://${host}`
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.byteLength
    if (bytes > maxBytes) throw new Error('The reference image is too large; compress it and retry.')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback
}

function json(res: ServerResponse, status: number, value: unknown): void {
  if (res.headersSent || res.writableEnded || res.destroyed) return
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

function jsonError(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent || res.writableEnded || res.destroyed) return
  json(res, status, { error: message })
}
