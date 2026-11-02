import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertPublicHttpUrl,
  importReferenceImage,
  isPrivateAddress,
  referenceImageSize,
  sniffImageMediaType,
} from '../src/reference-import.js'

/** Minimal PNG header: signature, IHDR length, 'IHDR', width, height. */
function pngHeader(width: number, height: number): Uint8Array {
  const data = new Uint8Array(24)
  data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  data.set([0x00, 0x00, 0x00, 0x0d], 8)
  data.set([0x49, 0x48, 0x44, 0x52], 12)
  const view = new DataView(data.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return data
}

/** One successful response, with a body the importer can stream. */
function imageResponse(bytes: Uint8Array, contentType = 'image/png'): Response {
  return new Response(bytes, { status: 200, headers: { 'content-type': contentType } })
}

const workspaces: string[] = []

async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'arya-ref-'))
  workspaces.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of workspaces.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('reference image sniffing', () => {
  it('recognises PNG, JPEG and WebP by magic bytes only', () => {
    expect(sniffImageMediaType(pngHeader(4, 3))).toBe('image/png')
    expect(sniffImageMediaType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    const webp = new Uint8Array(16)
    webp.set([0x52, 0x49, 0x46, 0x46], 0)
    webp.set([0x57, 0x45, 0x42, 0x50], 8)
    expect(sniffImageMediaType(webp)).toBe('image/webp')
    expect(sniffImageMediaType(new TextEncoder().encode('<html>nope</html>'))).toBeUndefined()
  })

  it('reads PNG pixel size from the header', () => {
    expect(referenceImageSize(pngHeader(1344, 768), 'image/png')).toEqual({ width: 1344, height: 768 })
  })
})

describe('reference URL validation', () => {
  it('refuses loopback, private and link-local addresses', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.5', '169.254.1.1', '::1', 'fe80::1', 'fd00::1']) {
      expect(isPrivateAddress(address), address).toBe(true)
    }
    expect(isPrivateAddress('93.184.216.34')).toBe(false)
    expect(isPrivateAddress('2606:2800:220:1:248:1893:25c8:1946')).toBe(false)
  })

  it('refuses non-http schemes and private hosts before any request', async () => {
    await expect(assertPublicHttpUrl('file:///C:/secret.png')).rejects.toThrow(/http and https/i)
    await expect(assertPublicHttpUrl('http://127.0.0.1/a.png')).rejects.toThrow(/private address/i)
    await expect(assertPublicHttpUrl('not a url')).rejects.toThrow(/not a URL/i)
  })
})

describe('importing a reference image', () => {
  it('writes the image under <folder>/references and reports its size', async () => {
    const root = await workspace()
    const fetchImpl = vi.fn(async () => imageResponse(pngHeader(800, 600)))
    const imported = await importReferenceImage({
      url: 'http://93.184.216.34/photos/eiffel-tower-hd.png',
      workspaceRoot: root,
      folder: 'shots',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(imported.mediaType).toBe('image/png')
    expect(imported.width).toBe(800)
    expect(imported.height).toBe(600)
    expect(imported.bytes).toBe(24)
    expect(imported.digest).toMatch(/^[0-9a-f]{12}$/u)
    expect(imported.path).toBe(join(root, 'shots', 'references', 'eiffel-tower-hd.png'))
    expect((await readdir(join(root, 'shots', 'references')))).toEqual(['eiffel-tower-hd.png'])
    expect((await readFile(imported.path)).length).toBe(24)
  })

  it('keeps a second reference with the same name instead of overwriting it', async () => {
    const root = await workspace()
    const fetchImpl = async (): Promise<Response> => imageResponse(pngHeader(10, 10))
    const first = await importReferenceImage({ url: 'http://93.184.216.34/a.png', name: 'ref', workspaceRoot: root, fetchImpl })
    const second = await importReferenceImage({ url: 'http://93.184.216.34/b.png', name: 'ref', workspaceRoot: root, fetchImpl })
    expect(first.path).not.toBe(second.path)
    expect((await readdir(join(root, 'references'))).sort()).toEqual(['ref-2.png', 'ref.png'])
  })

  it('refuses a page instead of a picture, naming what arrived', async () => {
    const root = await workspace()
    const fetchImpl = async (): Promise<Response> => imageResponse(new TextEncoder().encode('<html>blocked</html>'), 'text/html')
    await expect(importReferenceImage({ url: 'http://93.184.216.34/watch', workspaceRoot: root, fetchImpl }))
      .rejects.toThrow(/did not return a PNG, JPEG or WebP image \(text\/html\)/i)
    await expect(readdir(join(root, 'references')).catch(() => [] as string[])).resolves.toEqual([])
  })

  it('stops a download that exceeds the byte cap', async () => {
    const root = await workspace()
    const fetchImpl = async (): Promise<Response> => imageResponse(pngHeader(10, 10))
    await expect(importReferenceImage({ url: 'http://93.184.216.34/a.png', workspaceRoot: root, maxBytes: 8, fetchImpl }))
      .rejects.toThrow(/over the 8-byte limit|over the .*limit/i)
  })

  it('follows one redirect but re-validates the hop', async () => {
    const root = await workspace()
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('start')) {
        return new Response(null, { status: 302, headers: { location: 'http://93.184.216.34/real.png' } })
      }
      return imageResponse(pngHeader(640, 480))
    })
    const imported = await importReferenceImage({
      url: 'http://93.184.216.34/start',
      workspaceRoot: root,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(imported.width).toBe(640)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('refuses a redirect into a private address', async () => {
    const root = await workspace()
    const fetchImpl = async (): Promise<Response> => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret.png' } })
    await expect(importReferenceImage({ url: 'http://93.184.216.34/start', workspaceRoot: root, fetchImpl }))
      .rejects.toThrow(/private address/i)
  })
})
