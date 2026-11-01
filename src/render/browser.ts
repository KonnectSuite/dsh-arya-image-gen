/**
 * Find the Chromium-family browser that rasterizes rendered pages.
 *
 * The renderer has no native dependency on purpose: it drives a headless
 * Chromium that is already installed. Resolution order is explicit setting,
 * environment override, then the conventional install locations per platform.
 *
 * @module dsh-arya-image-gen/render/browser
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'

/** Which Chromium-family build was found, for provenance and logging. */
export type BrowserFamily = 'edge' | 'chrome' | 'chromium' | 'unknown'

/** One resolved browser executable. */
export interface BrowserCandidate {
  path: string
  family: BrowserFamily
}

/** A resolved browser plus the version string the binary reported. */
export interface BrowserInfo extends BrowserCandidate {
  version: string
}

/**
 * Conventional install locations for each supported platform.
 *
 * @param platform - `process.platform`.
 * @param env - environment, for `PROGRAMFILES` and friends.
 * @returns candidate paths, most preferred first.
 */
export function browserCandidates(platform: string, env: Record<string, string | undefined>): string[] {
  if (platform === 'win32') {
    const roots = [env['PROGRAMFILES(X86)'], env['PROGRAMFILES'], env['LOCALAPPDATA']].filter(
      (root): root is string => typeof root === 'string' && root.length > 0,
    )
    return roots.flatMap(root => [
      `${root}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${root}\\Google\\Chrome\\Application\\chrome.exe`,
      `${root}\\Chromium\\Application\\chrome.exe`,
    ])
  }
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ]
  }
  return [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/microsoft-edge',
    '/snap/bin/chromium',
  ]
}

/**
 * Classify a path by its executable name.
 *
 * @param executable - resolved path.
 * @returns the family it belongs to.
 */
export function familyOf(executable: string): BrowserFamily {
  const name = executable.toLowerCase()
  if (name.includes('edge')) return 'edge'
  if (name.includes('chromium')) return 'chromium'
  if (name.includes('chrome')) return 'chrome'
  return 'unknown'
}

/**
 * Resolve a browser without starting one.
 *
 * @param options - explicit path from settings, platform and environment.
 * @returns the first existing candidate, or undefined.
 */
export function resolveBrowser(options: {
  explicitPath?: string | undefined
  platform?: string
  env?: Record<string, string | undefined>
}): BrowserCandidate | undefined {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const explicit = options.explicitPath?.trim()
  if (explicit !== undefined && explicit.length > 0) {
    return existsSync(explicit) ? { path: explicit, family: familyOf(explicit) } : undefined
  }
  const fromEnv = env['DSH_RENDER_BROWSER']?.trim()
  if (fromEnv !== undefined && fromEnv.length > 0 && existsSync(fromEnv)) {
    return { path: fromEnv, family: familyOf(fromEnv) }
  }
  for (const candidate of browserCandidates(platform, env)) {
    if (existsSync(candidate)) return { path: candidate, family: familyOf(candidate) }
  }
  return undefined
}

/**
 * Ask a browser for its version. Never throws: a browser that cannot answer is
 * still usable for rendering, it just has no version to report.
 *
 * @param executable - browser path.
 * @returns the version string, or an empty string.
 */
export function browserVersion(executable: string): Promise<string> {
  return new Promise(resolve => {
    execFile(executable, ['--version'], { timeout: 5_000, windowsHide: true }, (error, stdout) => {
      if (error !== null) {
        resolve('')
        return
      }
      const match = /(\d+\.\d+\.\d+\.\d+|\d+\.\d+\.\d+|\d+)/.exec(String(stdout))
      resolve(match?.[1] ?? '')
    })
  })
}

/**
 * Resolve and identify the browser in one step.
 *
 * @param options - explicit path from settings.
 * @returns the browser with its version, or undefined when none exists.
 */
export async function probeBrowser(options: { explicitPath?: string | undefined } = {}): Promise<BrowserInfo | undefined> {
  const candidate = resolveBrowser(options)
  if (candidate === undefined) return undefined
  return { ...candidate, version: await browserVersion(candidate.path) }
}
