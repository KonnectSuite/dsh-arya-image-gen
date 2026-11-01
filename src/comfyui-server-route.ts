/** Same-origin route that probes, starts, stops, and restarts the local ComfyUI server. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ComfyUIServerStatus } from './shared.js'

export interface ComfyUIServerRouteDeps {
  status(): Promise<ComfyUIServerStatus>
  start(): Promise<ComfyUIServerStatus>
  stop(): Promise<ComfyUIServerStatus>
  restart(): Promise<ComfyUIServerStatus>
}

const ACTIONS = ['status', 'start', 'stop', 'restart'] as const
type Action = typeof ACTIONS[number]

export async function serveComfyUIServer(req: IncomingMessage, res: ServerResponse, deps: ComfyUIServerRouteDeps): Promise<void> {
  if (!sameOrigin(req)) return json(res, 403, { error: 'origin-rejected' })
  // GET is a plain status probe so the settings card can poll cheaply.
  if (req.method === 'GET') {
    return respond(res, () => deps.status(), 'status')
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'method-not-allowed' })
  let action: Action = 'status'
  try {
    const body = JSON.parse(await readBody(req)) as Record<string, unknown>
    const requested = typeof body.action === 'string' ? body.action : 'status'
    if (!ACTIONS.includes(requested as Action)) return json(res, 400, { error: `Unknown action ${requested}; use status, start, stop, or restart.` })
    action = requested as Action
  } catch {
    return json(res, 400, { error: 'The request payload is invalid.' })
  }
  switch (action) {
    case 'start': return respond(res, () => deps.start(), action)
    case 'stop': return respond(res, () => deps.stop(), action)
    case 'restart': return respond(res, () => deps.restart(), action)
    default: return respond(res, () => deps.status(), action)
  }
}

async function respond(res: ServerResponse, run: () => Promise<ComfyUIServerStatus>, action: string): Promise<void> {
  try {
    const status = await run()
    json(res, 200, { action, status })
  } catch (error) {
    json(res, 502, { action, error: error instanceof Error ? error.message : String(error) })
  }
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  const host = req.headers.host
  return origin === undefined || host === undefined || origin === `http://${host}` || origin === `https://${host}`
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.byteLength
    if (bytes > 64 * 1024) throw new Error('request body too large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function json(res: ServerResponse, status: number, value: unknown): void {
  if (res.headersSent || res.writableEnded || res.destroyed) return
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}
