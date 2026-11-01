/** Local ComfyUI server lifecycle: spawn, stop, restart, and probe — mirrors
 * the semantics of the C:\ComfyStaging\comfyui.ps1 controller script.
 *
 * Stop targets only python processes whose command line runs ComfyUI's
 * main.py on the configured port. It never touches whatever else holds that
 * port: on this machine the Tailscale daemon forwards it onto the tailnet,
 * and killing that would break remote access rather than stop ComfyUI.
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_COMFYUI_BASE_URL, DEFAULT_COMFYUI_EXTRA_ARGS, DEFAULT_COMFYUI_PYTHON_EXE, DEFAULT_COMFYUI_SERVER_DIR, type ComfyUIServerStatus } from './shared.js'
import { parseComfyUIExtraArgs } from './config.js'

export interface ComfyUIServerConfig {
  baseURL: string
  pythonExe: string
  serverDir: string
  extraArgs: string
}

export function comfyUIServerConfigOf(config: {
  comfyuiBaseURL?: string
  comfyuiPythonExe?: string
  comfyuiServerDir?: string
  comfyuiExtraArgs?: string
}): ComfyUIServerConfig {
  return {
    baseURL: config.comfyuiBaseURL?.trim() || DEFAULT_COMFYUI_BASE_URL,
    pythonExe: config.comfyuiPythonExe?.trim() || DEFAULT_COMFYUI_PYTHON_EXE,
    serverDir: config.comfyuiServerDir?.trim() || DEFAULT_COMFYUI_SERVER_DIR,
    extraArgs: config.comfyuiExtraArgs ?? DEFAULT_COMFYUI_EXTRA_ARGS,
  }
}

const STATS_TIMEOUT_MS = 5_000
const START_TIMEOUT_MS = 120_000
const STOP_TIMEOUT_MS = 30_000
const POLL_MS = 2_000

interface SystemStats {
  system?: { comfyui_version?: unknown; python_version?: unknown }
  devices?: unknown
}

/** Probed /system_stats payload, reduced to the fields the UI shows. */
interface ServerProbe {
  up: boolean
  version?: string
  pythonVersion?: string
  device?: string
  vramFreeBytes?: number
  vramTotalBytes?: number
}

export class ComfyUIServerManager {
  private childPid: number | undefined
  private busy = false
  private readonly logDir = path.join(os.tmpdir(), 'dsh-image-gen-comfyui')

  constructor(private deps: () => ComfyUIServerConfig, private warn: (message: string) => void) {}

  private portOf(): string {
    try {
      const url = new URL(this.deps().baseURL)
      return url.port.length > 0 ? url.port : url.protocol === 'https:' ? '443' : '80'
    } catch {
      return '8188'
    }
  }

  async start(): Promise<ComfyUIServerStatus> {
    this.assertNotBusy()
    this.busy = true
    try {
      if (await this.probe().then(probe => probe.up)) {
        return await this.status()
      }
      const { pythonExe, serverDir, extraArgs, baseURL } = this.deps()
      if (!fs.existsSync(pythonExe)) throw new Error(`Python interpreter not found: ${pythonExe} — set the path in Settings > Plugins > Image Generation.`)
      if (!fs.existsSync(path.join(serverDir, 'main.py'))) throw new Error(`ComfyUI main.py not found under ${serverDir} — set the ComfyUI directory in Settings > Plugins > Image Generation.`)
      fs.mkdirSync(this.logDir, { recursive: true })
      const args = ['main.py', '--port', this.portOf(), ...parseComfyUIExtraArgs(extraArgs)]
      const outFd = fs.openSync(path.join(this.logDir, 'comfyui-out.log'), 'a')
      const errFd = fs.openSync(path.join(this.logDir, 'comfyui-err.log'), 'a')
      try {
        const child = spawn(pythonExe, args, { cwd: serverDir, detached: true, stdio: ['ignore', outFd, errFd], windowsHide: true })
        if (child.pid === undefined) throw new Error('Failed to launch the ComfyUI process (no pid returned).')
        this.childPid = child.pid
        child.unref()
      } finally {
        fs.closeSync(outFd)
        fs.closeSync(errFd)
      }
      const deadline = Date.now() + START_TIMEOUT_MS
      while (Date.now() < deadline) {
        await delay(POLL_MS)
        if ((await this.probe()).up) return await this.status()
      }
      const tail = this.readLogTail()
      throw new Error(`ComfyUI did not answer on ${baseURL} within ${String(Math.round(START_TIMEOUT_MS / 1000))} s.${tail.length > 0 ? ` Last output:\n${tail}` : ''}`)
    } finally {
      this.busy = false
    }
  }

  async stop(): Promise<ComfyUIServerStatus> {
    this.assertNotBusy()
    this.busy = true
    try {
      const port = this.portOf()
      const pids = await this.findComfyPids(port)
      if (this.childPid !== undefined && !pids.includes(this.childPid)) pids.push(this.childPid)
      if (pids.length === 0) {
        // Nothing process-side to kill: report the live wire state as-is.
        return await this.status()
      }
      for (const pid of pids) {
        // /T /F kills the whole tree: python spawns child workers on Windows.
        spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
      }
      const deadline = Date.now() + STOP_TIMEOUT_MS
      while (Date.now() < deadline) {
        if ((await this.findComfyPids(port)).length === 0 && !(await this.probe()).up) break
        await delay(1_000)
      }
      this.childPid = undefined
      const remaining = await this.findComfyPids(port)
      if (remaining.length > 0) this.warn(`ComfyUI processes still present after ${String(Math.round(STOP_TIMEOUT_MS / 1000))} s: ${remaining.join(', ')}`)
      return await this.status()
    } finally {
      this.busy = false
    }
  }

  async restart(): Promise<ComfyUIServerStatus> {
    await this.stop()
    return await this.start()
  }

  async status(): Promise<ComfyUIServerStatus> {
    const { baseURL } = this.deps()
    const probe = await this.probe()
    const pids = await this.findComfyPids(this.portOf())
    return {
      up: probe.up,
      managed: this.childPid !== undefined && pids.includes(this.childPid),
      pids,
      ...(probe.version === undefined ? {} : { version: probe.version }),
      ...(probe.pythonVersion === undefined ? {} : { pythonVersion: probe.pythonVersion }),
      ...(probe.device === undefined ? {} : { device: probe.device }),
      ...(probe.vramFreeBytes === undefined ? {} : { vramFreeBytes: probe.vramFreeBytes }),
      ...(probe.vramTotalBytes === undefined ? {} : { vramTotalBytes: probe.vramTotalBytes }),
      baseUrl: baseURL,
      busy: this.busy,
    }
  }

  private assertNotBusy(): void {
    if (this.busy) throw new Error('A ComfyUI server action is already running; try again when it finishes.')
  }

  private readLogTail(): string {
    try {
      const text = fs.readFileSync(path.join(this.logDir, 'comfyui-err.log'), 'utf8')
      const lines = text.split('\n')
      return lines.slice(-12).join('\n').trim().slice(0, 2_000)
    } catch {
      return ''
    }
  }

  /** GET /system_stats: the ground truth for "is ComfyUI answering". */
  private async probe(): Promise<ServerProbe> {
    try {
      const response = await fetch(new URL('/system_stats', this.deps().baseURL), {
        redirect: 'error',
        signal: AbortSignal.timeout(STATS_TIMEOUT_MS),
        headers: { accept: 'application/json' },
      })
      if (!response.ok) return { up: false }
      const stats = await response.json() as SystemStats
      const device = Array.isArray(stats.devices) ? firstDevice(stats.devices[0]) : undefined
      const version = typeof stats.system?.comfyui_version === 'string' ? stats.system.comfyui_version : undefined
      const pythonVersion = typeof stats.system?.python_version === 'string' ? stats.system.python_version.split(' ')[0] : undefined
      return {
        up: true,
        ...(version === undefined ? {} : { version }),
        ...(pythonVersion === undefined ? {} : { pythonVersion }),
        ...(device === undefined ? {} : device),
      }
    } catch {
      return { up: false }
    }
  }

  /** Python processes whose command line runs ComfyUI main.py on this port.
   * The command-line match is deliberate: it never returns the Tailscale
   * daemon that also holds the port, matching comfyui.ps1's Get-ComfyProcess. */
  private async findComfyPids(port: string): Promise<number[]> {
    const pattern = 'main\\.py'
    // Newline-joined: PowerShell needs a statement terminator between the
    // assignment and the pipeline (a space produces a parse error). A single
    // Name filter is required: CIM rejects "Name = 'a' -or Name = 'b'".
    const script = [
      `$ErrorActionPreference='SilentlyContinue'`,
      `Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" |`,
      `Where-Object { $_.CommandLine -and $_.CommandLine -match '${pattern}' -and $_.CommandLine -match '${port}' } |`,
      `ForEach-Object { $_.ProcessId }`,
    ].join('\n')
    const run = spawnSync('powershell', ['-NoProfile', '-Command', script], { windowsHide: true, encoding: 'utf8', timeout: 15_000 })
    if (run.status !== 0) return []
    return run.stdout.split(/\r?\n/).map(line => Number(line.trim())).filter(pid => Number.isSafeInteger(pid) && pid > 0)
  }
}

function firstDevice(value: unknown): { device: string; vramFreeBytes?: number; vramTotalBytes?: number } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const entry = value as Record<string, unknown>
  const name = typeof entry.name === 'string' ? entry.name : undefined
  if (name === undefined) return undefined
  const free = typeof entry.vram_free === 'number' ? entry.vram_free : undefined
  const total = typeof entry.vram_total === 'number' ? entry.vram_total : undefined
  return { device: name, ...(free === undefined ? {} : { vramFreeBytes: free }), ...(total === undefined ? {} : { vramTotalBytes: total }) }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, milliseconds))
}
