/**
 * Same-origin HTTP bridge for HTML/SVG rendering from the workbench.
 *
 * Same contract style as the studio route: GET describes the renderer, POST
 * renders one document and returns an attachment the rail can show.
 *
 * @module dsh-arya-image-gen/render-route
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { RenderConfigResponse, StudioRenderRequest, StudioRenderResponse } from './shared.js'

/** Everything the route needs from the host. */
export interface RenderRouteDeps {
  describe(): Promise<RenderConfigResponse>
  render(input: StudioRenderRequest, signal: AbortSignal): Promise<StudioRenderResponse>
  maxBodyBytes: number
  timeoutMs?: number
}

/** Serve renderer capabilities and render requests. */
export async function serveRender(req: IncomingMessage, res: ServerResponse, deps: RenderRouteDeps): Promise<void> {
  if (!sameOrigin(req)) return jsonError(res, 403, 'origin-rejected')
  if (req.method === 'GET') {
    try {
      return json(res, 200, await deps.describe())
    } catch (error) {
      return jsonError(res, 500, message(error, 'render-unavailable'))
    }
  }
  if (req.method !== 'POST') return jsonError(res, 405, 'method-not-allowed')
  if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    return jsonError(res, 415, 'json-required')
  }

  const controller = new AbortController()
  const watchdog = new AbortController()
  const signal = AbortSignal.any([controller.signal, watchdog.signal])
  const onClose = (): void => {
    if (!res.writableEnded) controller.abort(new Error('The browser closed the render request.'))
  }
  res.once('close', onClose)
  req.once('aborted', onClose)

  try {
    let input: StudioRenderRequest
    try {
      input = parseRenderRequest(JSON.parse(await readBody(req, deps.maxBodyBytes)))
    } catch (error) {
      return jsonError(res, 400, message(error, 'invalid-request'))
    }
    const timeoutMs = deps.timeoutMs ?? 60_000
    const timeout = setTimeout(() => { watchdog.abort() }, timeoutMs)
    timeout.unref?.()
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' })
    try {
      try {
        res.end(JSON.stringify(await deps.render(input, signal)))
      } catch (error) {
        if (res.destroyed || res.writableEnded) return
        res.end(JSON.stringify({ error: watchdog.signal.aborted ? `The render timed out after ${String(Math.round(timeoutMs / 1000))} s.` : message(error, 'render-failed') }))
      }
    } finally {
      clearTimeout(timeout)
    }
  } catch (error) {
    if (res.headersSent || res.writableEnded || res.destroyed) return
    jsonError(res, controller.signal.aborted ? 499 : 502, message(error, 'render-failed'))
  } finally {
    res.off('close', onClose)
    req.off('aborted', onClose)
  }
}

/** Strictly validate the untrusted workbench render contract. */
export function parseRenderRequest(value: unknown): StudioRenderRequest {
  const input = record(value)
  if (input === undefined) throw new Error('The render request is invalid.')
  if (input.kind !== 'html' && input.kind !== 'svg') throw new Error('Choose HTML or SVG.')
  const markup = typeof input.markup === 'string' && input.markup.trim().length > 0 ? input.markup : undefined
  const template = typeof input.template === 'string' && input.template.trim().length > 0 ? input.template.trim() : undefined
  if (markup === undefined && template === undefined) throw new Error('The render has no markup.')
  if (markup !== undefined && template !== undefined) throw new Error('Send markup or a template, not both.')
  const data = record(input.data)
  const number = (key: 'width' | 'height' | 'scale'): number | undefined => {
    const raw = input[key]
    if (raw === undefined) return undefined
    if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new Error(`${key} must be a number.`)
    return raw
  }
  const width = number('width')
  const height = number('height')
  const scale = number('scale')
  if (input.background !== undefined && typeof input.background !== 'string') throw new Error('background must be a string.')
  const workspaceRoot = typeof input.workspaceRoot === 'string' && input.workspaceRoot.trim().length > 0 ? input.workspaceRoot.trim() : undefined
  return {
    kind: input.kind,
    ...(markup === undefined ? {} : { markup }),
    ...(template === undefined ? {} : { template }),
    ...(data === undefined ? {} : { data: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value)])) }),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    ...(scale === undefined ? {} : { scale }),
    ...(typeof input.background === 'string' ? { background: input.background } : {}),
    ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  const host = req.headers.host
  return origin === undefined || host === undefined || origin === `http://${host}` || origin === `https://${host}`
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.byteLength
    if (bytes > maxBytes) throw new Error('That markup is too large to render.')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback
}

function json(res: ServerResponse, status: number, value: unknown): void {
  if (res.headersSent || res.writableEnded || res.destroyed) return
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

function jsonError(res: ServerResponse, status: number, text: string): void {
  json(res, status, { error: text })
}
