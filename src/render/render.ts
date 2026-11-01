/**
 * Rasterize an HTML or SVG document to PNG with the installed browser.
 *
 * One-shot by design: Chromium's `--screenshot` writes a file at an exact
 * viewport, so the renderer never needs a CDP session, a port, or cleanup
 * beyond its own temp directory. That keeps a render cheap and the failure
 * modes obvious.
 *
 * @module dsh-arya-image-gen/render/render
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { BASE_CSS, MONO_CLASS } from './assets.js'
import { probeBrowser, resolveBrowser, type BrowserInfo } from './browser.js'
import { RENDER_CSP, sanitizeMarkup } from './sanitize.js'

/** Which markup dialect a render takes. */
export type RenderKind = 'html' | 'svg'

/** One render request after the caller applied no defaults. */
export interface RenderInput {
  kind: RenderKind
  markup: string
  width: number
  height: number
  scale?: number | undefined
  background?: string | undefined
  timeoutMs?: number | undefined
}

/** A rasterized page. */
export interface RenderOutput {
  png: Uint8Array
  width: number
  height: number
  durationMs: number
  browser: BrowserInfo
}

/** Bounds the renderer enforces before any process starts. */
export const RENDER_LIMITS = {
  minSide: 16,
  maxSide: 8192,
  maxScale: 4,
  maxPixels: 40_000_000,
  maxMarkupBytes: 2_000_000,
  defaultTimeoutMs: 30_000,
} as const

/** A render failure with a stable machine-readable code. */
export class RenderError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'RenderError'
  }
}

/** Render geometry after defaults and clamping. */
export interface RenderGeometry {
  width: number
  height: number
  scale: number
  background: string
  timeoutMs: number
}

/**
 * Apply defaults and reject values the renderer will not attempt.
 *
 * @param input - caller markup and geometry.
 * @returns validated geometry and timeout.
 */
export function normalizeRenderInput(input: RenderInput): RenderGeometry {
  const width = Math.round(input.width)
  const height = Math.round(input.height)
  const scale = input.scale ?? 1
  if (!Number.isFinite(width) || !Number.isFinite(height)) throw new RenderError('Render width and height must be numbers.', 'RENDER_BAD_SIZE')
  if (width < RENDER_LIMITS.minSide || height < RENDER_LIMITS.minSide) {
    throw new RenderError(`Render size must be at least ${String(RENDER_LIMITS.minSide)}x${String(RENDER_LIMITS.minSide)}.`, 'RENDER_BAD_SIZE')
  }
  if (width > RENDER_LIMITS.maxSide || height > RENDER_LIMITS.maxSide) {
    throw new RenderError(`Render size must be at most ${String(RENDER_LIMITS.maxSide)}x${String(RENDER_LIMITS.maxSide)}.`, 'RENDER_BAD_SIZE')
  }
  if (!Number.isFinite(scale) || scale < 1 || scale > RENDER_LIMITS.maxScale) {
    throw new RenderError(`Render scale must be between 1 and ${String(RENDER_LIMITS.maxScale)}.`, 'RENDER_BAD_SCALE')
  }
  if (width * height * scale * scale > RENDER_LIMITS.maxPixels) {
    throw new RenderError('That canvas is too large to render. Lower the size or the scale.', 'RENDER_BAD_SIZE')
  }
  if (typeof input.markup !== 'string' || input.markup.trim().length === 0) {
    throw new RenderError('The render has no markup.', 'RENDER_EMPTY')
  }
  if (Buffer.byteLength(input.markup, 'utf8') > RENDER_LIMITS.maxMarkupBytes) {
    throw new RenderError(`The markup is larger than ${String(Math.round(RENDER_LIMITS.maxMarkupBytes / 1000))} kB.`, 'RENDER_TOO_LARGE')
  }
  const background = typeof input.background === 'string' && input.background.trim().length > 0 ? input.background.trim() : '#ffffff'
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? RENDER_LIMITS.defaultTimeoutMs, 1_000), 120_000)
  return { width, height, scale, background, timeoutMs }
}

/**
 * Build the complete document Chromium will screenshot.
 *
 * @param input - validated render input.
 * @param background - page background.
 * @returns a full HTML document.
 */
export function buildRenderDocument(input: RenderInput, background: string): string {
  const { width, height } = input
  const clean = sanitizeMarkup(input.markup)
  const head = `<style>${BASE_CSS}${MONO_CLASS}html,body{width:${String(width)}px;height:${String(height)}px;overflow:hidden;background:${background}}</style>`
  const csp = `<meta http-equiv="Content-Security-Policy" content="${RENDER_CSP}">`

  if (input.kind === 'svg') {
    // Inline (not <img>) so bundled fonts and CSS inside the SVG still apply.
    return `<!doctype html><html><head><meta charset="utf-8">${csp}${head}</head><body>
<div style="width:${String(width)}px;height:${String(height)}px">${clean.replace('<svg', '<svg style="width:100%;height:100%;display:block"')}</div>
</body></html>`
  }
  if (/<html[\s>]/i.test(clean)) {
    return clean.includes('</head>')
      ? clean.replace(/<\/head>/i, `${csp}${head}</head>`)
      : clean.replace(/<html([^>]*)>/i, `<html$1><head>${csp}${head}</head>`)
  }
  return `<!doctype html><html><head><meta charset="utf-8">${csp}${head}</head><body>${clean}</body></html>`
}

/** Chromium switches shared by every render. */
function browserArgs(profileDir: string, width: number, height: number, scale: number, screenshotPath: string, pageUrl: string): string[] {
  return [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-background-mode',
    '--disable-sync',
    `--user-data-dir=${profileDir}`,
    `--window-size=${String(width)},${String(height)}`,
    // A headless launch must never surface a window. The position is a belt
    // and braces guard for the case where a browser relays the launch into an
    // already-running instance and ignores the headless flag.
    '--window-position=-32000,-32000',
    `--force-device-scale-factor=${String(scale)}`,
    `--screenshot=${screenshotPath}`,
    '--virtual-time-budget=4000',
    // Nothing may leave the machine: every host resolves to NOTFOUND.
    '--host-resolver-rules=MAP * ~NOTFOUND',
    // Scripts are blocked by the injected CSP and stripped by the sanitizer.
    // Do NOT add --blink-settings=scriptEnabled=false: Edge exits 0 and writes
    // no screenshot with it, which surfaces as a confusing empty render.
    pageUrl,
  ]
}

/** Where a render's artifacts live while the browser runs. */
export interface RenderRunContext {
  screenshotPath: string
  pagePath: string
  width: number
  height: number
  scale: number
}

/** Prefix of every render work directory under the temp root. */
const WORK_DIR_PREFIX = 'dsh-image-gen-render-'

/** Work directories older than this are treated as abandoned by a killed host. */
const STALE_WORK_DIR_MS = 60 * 60 * 1000

/**
 * Remove render work directories left behind by a killed process.
 *
 * A render cleans up after itself, but a host that dies mid-render cannot, and
 * those directories hold a Chromium profile each. Best effort only.
 */
async function sweepStaleWorkDirs(): Promise<void> {
  const root = os.tmpdir()
  try {
    const entries = await readdir(root, { withFileTypes: true })
    const now = Date.now()
    await Promise.all(entries
      .filter(entry => entry.isDirectory() && entry.name.startsWith(WORK_DIR_PREFIX))
      .map(async entry => {
        const full = path.join(root, entry.name)
        try {
          const info = await stat(full)
          if (now - info.mtimeMs > STALE_WORK_DIR_MS) await rm(full, { recursive: true, force: true })
        } catch {
          // Another process may be using it; leave it alone.
        }
      }))
  } catch {
    // A missing or unreadable temp root is not a render failure.
  }
}

/**
 * Render markup to PNG.
 *
 * @param input - markup plus geometry.
 * @param options - browser override, cancellation, and a test seam for the
 *   browser process.
 * @returns the PNG and its measured size.
 */
export async function renderToPng(
  input: RenderInput,
  options: {
    browserPath?: string | undefined
    signal?: AbortSignal | undefined
    /** Test seam: replaces spawning the real browser. */
    run?: ((args: string[], context: RenderRunContext, timeoutMs: number, signal?: AbortSignal) => Promise<void>) | undefined
  } = {},
): Promise<RenderOutput> {
  const geometry = normalizeRenderInput(input)
  // A test seam replaces the browser process entirely, so it must not spawn
  // `--version` either: resolve the path and report an empty version.
  const browser = options.run === undefined
    ? await probeBrowser({ explicitPath: options.browserPath })
    : (() => {
        const candidate = resolveBrowser({ explicitPath: options.browserPath })
        return candidate === undefined ? undefined : { ...candidate, version: '' }
      })()
  if (browser === undefined) {
    throw new RenderError(
      'No Chromium-family browser was found to render with. Install Chrome, Edge or Chromium, or set the browser path in Settings > Plugins > Arya Image Gen.',
      'RENDER_NO_BROWSER',
    )
  }

  const started = Date.now()
  await sweepStaleWorkDirs()
  const workDir = await mkdtemp(path.join(os.tmpdir(), `dsh-image-gen-render-${randomUUID().slice(0, 8)}-`))
  const profileDir = path.join(workDir, 'profile')
  const pagePath = path.join(workDir, 'page.html')
  const shotPath = path.join(workDir, 'out.png')
  try {
    await mkdir(profileDir, { recursive: true })
    await writeFile(pagePath, buildRenderDocument(input, geometry.background), 'utf8')
    const context: RenderRunContext = {
      screenshotPath: shotPath,
      pagePath,
      width: geometry.width,
      height: geometry.height,
      scale: geometry.scale,
    }
    const args = browserArgs(profileDir, geometry.width, geometry.height, geometry.scale, shotPath, pathToFileUrl(pagePath))
    if (options.run !== undefined) await options.run(args, context, geometry.timeoutMs, options.signal)
    else await runBrowser(browser.path, args, geometry.timeoutMs, options.signal)

    let png: Buffer
    try {
      png = await readFile(shotPath)
    } catch {
      throw new RenderError('The browser produced no screenshot. Check the render size and try again.', 'RENDER_EMPTY')
    }
    if (png.byteLength === 0) throw new RenderError('The browser produced an empty screenshot.', 'RENDER_EMPTY')
    const produced = pngSize(png)
    const expectedWidth = geometry.width * geometry.scale
    const expectedHeight = geometry.height * geometry.scale
    if (produced === undefined) throw new RenderError('The browser output is not a readable PNG.', 'RENDER_BAD_OUTPUT')
    if (produced.width !== expectedWidth || produced.height !== expectedHeight) {
      throw new RenderError(
        `The browser produced ${String(produced.width)}x${String(produced.height)} instead of ${String(expectedWidth)}x${String(expectedHeight)}.`,
        'RENDER_BAD_SIZE',
      )
    }
    return { png: new Uint8Array(png), width: produced.width, height: produced.height, durationMs: Date.now() - started, browser }
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Read width and height from a PNG header.
 *
 * @param png - PNG bytes.
 * @returns dimensions, or undefined when the signature does not match.
 */
export function pngSize(png: Uint8Array): { width: number; height: number } | undefined {
  if (png.byteLength < 24) return undefined
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  for (const [index, byte] of signature.entries()) if (png[index] !== byte) return undefined
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

/**
 * Start the browser and wait for it to finish the screenshot.
 *
 * @param executable - browser path.
 * @param args - Chromium switches.
 * @param timeoutMs - hard limit for one render.
 * @param signal - caller cancellation.
 * @returns once the process exited successfully.
 */
function runBrowser(executable: string, args: string[], timeoutMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: 'ignore' })
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (error !== undefined) reject(error)
      else resolve()
    }
    const kill = (): void => {
      // Chromium forks a renderer/GPU/utility tree; killing only the launcher
      // leaves orphans behind, so take the tree down on Windows.
      if (process.platform === 'win32' && child.pid !== undefined) {
        try {
          spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
          return
        } catch {
          // Fall through to the direct kill.
        }
      }
      try {
        child.kill('SIGKILL')
      } catch {
        // The process is already gone; the close handler reports it.
      }
    }
    const timer = setTimeout(() => {
      kill()
      finish(new RenderError(`The render did not finish within ${String(Math.round(timeoutMs / 1000))} s.`, 'RENDER_TIMEOUT'))
    }, timeoutMs)
    const onAbort = (): void => {
      kill()
      finish(new RenderError('The render was cancelled.', 'RENDER_CANCELLED'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted === true) onAbort()
    child.once('error', error => { finish(new RenderError(`The browser could not start: ${error.message}`, 'RENDER_NO_BROWSER')) })
    child.once('close', code => {
      if (code === 0) finish()
      else finish(new RenderError(`The browser exited with code ${String(code)} while rendering.`, 'RENDER_FAILED'))
    })
  })
}

/**
 * Convert a filesystem path to a file URL Chromium accepts.
 *
 * @param filePath - absolute path.
 * @returns the URL.
 */
function pathToFileUrl(filePath: string): string {
  const normalized = filePath.replaceAll('\\', '/')
  return `file:///${encodeURI(normalized).replace(/^\/+/, '')}`
}
