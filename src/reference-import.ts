/**
 * Import a reference image from a URL into the session workspace.
 *
 * The agent finds candidate images with the host's own `web_search`/`web_fetch`,
 * then hands the URL here. Search output is untrusted and so is the byte stream:
 * this module never trusts the declared content type, never follows a redirect
 * into a private address, and never writes a file it could not identify as a
 * PNG, JPEG or WebP by its magic bytes.
 *
 * The returned path is what `edit_image` accepts as `source_path`, which is the
 * whole point: a reference photo of the real subject produces a far more
 * accurate image than a paragraph describing it.
 *
 * @module dsh-arya-image-gen/reference-import
 */
import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { saveReferenceImageToWorkspace } from './workspace-save.js'

/** Media types a reference may be; ComfyUI's LoadImage reads exactly these. */
export type ReferenceMediaType = 'image/png' | 'image/jpeg' | 'image/webp'

/** Largest accepted download. References are inputs, not outputs. */
export const MAX_REFERENCE_BYTES = 16 * 1024 * 1024

/** Redirect hops followed, each one re-validated before it is fetched. */
const MAX_REDIRECTS = 4

/** Per-request deadline, redirects included. */
const DEFAULT_TIMEOUT_MS = 20_000

/** What the tool reports back. */
export interface ImportedReference {
  /** Absolute path inside the session workspace. */
  path: string
  mediaType: ReferenceMediaType
  bytes: number
  width?: number
  height?: number
  sourceUrl: string
  /** Short content digest, useful when comparing two downloads of one photo. */
  digest: string
}

/** Options for one import. */
export interface ImportReferenceOptions {
  url: string
  /** Desired file stem; the extension always comes from the sniffed type. */
  name?: string | undefined
  workspaceRoot: string
  /** Configured image folder; references land in `<folder>/references`. */
  folder?: string | undefined
  signal?: AbortSignal | undefined
  maxBytes?: number | undefined
  timeoutMs?: number | undefined
  /** Injected in tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch | undefined
}

/**
 * Identify an image by its first bytes.
 *
 * @param data - the downloaded bytes.
 * @returns the media type, or undefined when this is not a supported image.
 */
export function sniffImageMediaType(data: Uint8Array): ReferenceMediaType | undefined {
  if (data.length >= 8
    && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
    && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a) return 'image/png'
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.length >= 12
    && data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46
    && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) return 'image/webp'
  return undefined
}

/** Read a big-endian uint32. */
function uint32(data: Uint8Array, offset: number): number {
  return ((data[offset] ?? 0) << 24 | (data[offset + 1] ?? 0) << 16 | (data[offset + 2] ?? 0) << 8 | (data[offset + 3] ?? 0)) >>> 0
}

/** Read a big-endian uint16. */
function uint16(data: Uint8Array, offset: number): number {
  return ((data[offset] ?? 0) << 8 | (data[offset + 1] ?? 0)) >>> 0
}

/**
 * Pixel size from the file header, without decoding pixels.
 *
 * @param data - the downloaded bytes.
 * @param mediaType - what `sniffImageMediaType` decided.
 * @returns width and height, or undefined when the header is unfamiliar.
 */
export function referenceImageSize(data: Uint8Array, mediaType: ReferenceMediaType): { width: number; height: number } | undefined {
  try {
    if (mediaType === 'image/png' && data.length >= 24) {
      const width = uint32(data, 16)
      const height = uint32(data, 20)
      return width > 0 && height > 0 ? { width, height } : undefined
    }
    if (mediaType === 'image/webp' && data.length >= 30) {
      const chunk = String.fromCharCode(data[12] ?? 0, data[13] ?? 0, data[14] ?? 0, data[15] ?? 0)
      if (chunk === 'VP8X') {
        const width = 1 + ((data[24] ?? 0) | (data[25] ?? 0) << 8 | (data[26] ?? 0) << 16)
        const height = 1 + ((data[27] ?? 0) | (data[28] ?? 0) << 8 | (data[29] ?? 0) << 16)
        return { width, height }
      }
      if (chunk === 'VP8 ') {
        const width = uint16(data, 26) & 0x3fff
        const height = uint16(data, 28) & 0x3fff
        return width > 0 && height > 0 ? { width, height } : undefined
      }
      if (chunk === 'VP8L') {
        const bits = (data[21] ?? 0) << 24 | (data[22] ?? 0) << 16 | (data[23] ?? 0) << 8 | (data[24] ?? 0)
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
      }
      return undefined
    }
    if (mediaType === 'image/jpeg') {
      // Walk the segment chain to the first start-of-frame.
      let offset = 2
      while (offset + 9 < data.length) {
        if (data[offset] !== 0xff) { offset += 1; continue }
        const marker = data[offset + 1] ?? 0
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue }
        const length = uint16(data, offset + 2)
        const isFrame = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)
          || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)
        if (isFrame) {
          const height = uint16(data, offset + 5)
          const width = uint16(data, offset + 7)
          return width > 0 && height > 0 ? { width, height } : undefined
        }
        if (length < 2) return undefined
        offset += 2 + length
      }
    }
  } catch {
    return undefined
  }
  return undefined
}

/** True for IPv4/IPv6 addresses that must never be fetched from the host. */
export function isPrivateAddress(address: string): boolean {
  const value = address.toLowerCase()
  if (value === '::1' || value === '::' || value === '0.0.0.0') return true
  if (value.startsWith('fe80:') || value.startsWith('fc') || value.startsWith('fd')) return true
  if (value.startsWith('::ffff:')) return isPrivateAddress(value.slice('::ffff:'.length))
  const parts = value.split('.')
  if (parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part))) {
    const [a, b] = parts.map(Number) as [number, number, number, number]
    if (a === 10 || a === 127 || a === 0) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a >= 224) return true
  }
  return false
}

/**
 * Validate one hop: http(s) only, and every resolved address public.
 *
 * @param raw - the URL to check.
 * @returns the parsed URL, ready to fetch.
 */
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`not a URL: ${raw}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`only http and https reference URLs are accepted, got ${url.protocol}`)
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('reference URLs must not carry credentials')
  }
  const host = url.hostname.replace(/^\[|\]$/gu, '')
  let addresses: string[]
  try {
    addresses = (await lookup(host, { all: true })).map(entry => entry.address)
  } catch {
    throw new Error(`cannot resolve the reference host: ${host}`)
  }
  if (addresses.length === 0) throw new Error(`cannot resolve the reference host: ${host}`)
  if (addresses.some(isPrivateAddress)) {
    throw new Error(`the reference host resolves to a private address (${addresses.join(', ')}); only public images can be imported`)
  }
  return url
}

/** Read the whole body, refusing to buffer more than the cap. */
async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`the reference image is ${String(declared)} bytes, over the ${String(maxBytes)}-byte limit`)
  }
  const body = response.body
  if (body === null) return new Uint8Array(await response.arrayBuffer())
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value === undefined) continue
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new Error(`the reference image is over the ${String(maxBytes)}-byte limit`)
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/** File stem from a caller name or the URL's last path segment. */
function referenceStem(name: string | undefined, url: URL): string {
  const candidate = (name ?? '').trim() !== ''
    ? (name as string).trim()
    : decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? 'reference')
  const withoutExtension = candidate.replace(/\.[a-z0-9]{1,5}$/iu, '')
  const cleaned = withoutExtension.replace(/[^\w.-]+/gu, '-').replace(/^[-.]+|[-.]+$/gu, '')
  return cleaned.slice(0, 48) === '' ? 'reference' : cleaned.slice(0, 48)
}

/**
 * Download one reference image and write it under the workspace.
 *
 * @param options - URL, workspace facts and limits.
 * @returns the imported reference, with the path `edit_image` accepts.
 * @throws when the URL is not public, the payload is not a supported image, or
 *   it is larger than the cap.
 */
export async function importReferenceImage(options: ImportReferenceOptions): Promise<ImportedReference> {
  const doFetch = options.fetchImpl ?? fetch
  const maxBytes = options.maxBytes ?? MAX_REFERENCE_BYTES
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const signal = options.signal ?? AbortSignal.timeout(timeoutMs)

  let current = await assertPublicHttpUrl(options.url)
  let response: Response | undefined
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    signal.throwIfAborted()
    const answer = await doFetch(current, { redirect: 'manual', signal, headers: { accept: 'image/png,image/jpeg,image/webp,image/*;q=0.8' } })
    if (answer.status >= 300 && answer.status < 400) {
      const location = answer.headers.get('location')
      if (location === null || location === '') throw new Error(`the reference URL redirected without a location (${String(answer.status)})`)
      current = await assertPublicHttpUrl(new URL(location, current).toString())
      continue
    }
    response = answer
    break
  }
  if (response === undefined) throw new Error(`the reference URL redirected more than ${String(MAX_REDIRECTS)} times`)
  if (!response.ok) throw new Error(`the reference URL answered ${String(response.status)}`)

  const data = await readCapped(response, maxBytes)
  const mediaType = sniffImageMediaType(data)
  if (mediaType === undefined) {
    const declared = response.headers.get('content-type') ?? 'unknown content type'
    throw new Error(`the URL did not return a PNG, JPEG or WebP image (${declared}${data.length === 0 ? ', empty body' : ''}). Reference search pages often need their image URL followed instead of the page URL.`)
  }

  const size = referenceImageSize(data, mediaType)
  const path = await saveReferenceImageToWorkspace({
    workspaceRoot: options.workspaceRoot,
    folder: options.folder,
    data,
    mediaType,
    name: referenceStem(options.name, current),
    signal: options.signal,
  })
  const digest = createHash('sha256').update(data).digest('hex').slice(0, 12)
  return {
    path,
    mediaType,
    bytes: data.byteLength,
    ...(size === undefined ? {} : { width: size.width, height: size.height }),
    sourceUrl: current.toString(),
    digest,
  }
}
