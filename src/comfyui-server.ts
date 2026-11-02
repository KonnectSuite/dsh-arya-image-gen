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
import { COMFYUI_LAUNCH_MODES, DEFAULT_COMFYUI_BASE_URL, DEFAULT_COMFYUI_EXTRA_ARGS, DEFAULT_COMFYUI_PYTHON_EXE, DEFAULT_COMFYUI_SERVER_DIR, DEFAULT_COMFYUI_TASK_NAME, comfyUIEndpointURL, isLocalComfyUIEndpoint, type ComfyUILaunchMode, type ComfyUIServerStatus } from './shared.js'
import { parseComfyUIExtraArgs } from './config.js'
import { parseComfyUIHeaders } from './shared.js'

export interface ComfyUIServerConfig {
  baseURL: string
  pythonExe: string
  serverDir: string
  extraArgs: string
  headers: Record<string, string>
  launchMode: ComfyUILaunchMode
  taskName: string
}

export function comfyUIServerConfigOf(config: {
  comfyuiBaseURL?: string
  comfyuiPythonExe?: string
  comfyuiServerDir?: string
  comfyuiExtraArgs?: string
  comfyuiHeadersJson?: string
  comfyuiLaunchMode?: string
  comfyuiScheduledTaskName?: string
}): ComfyUIServerConfig {
  const mode = COMFYUI_LAUNCH_MODES.includes(config.comfyuiLaunchMode as ComfyUILaunchMode)
    ? config.comfyuiLaunchMode as ComfyUILaunchMode
    : 'auto'
  return {
    baseURL: config.comfyuiBaseURL?.trim() || DEFAULT_COMFYUI_BASE_URL,
    pythonExe: config.comfyuiPythonExe?.trim() || DEFAULT_COMFYUI_PYTHON_EXE,
    serverDir: config.comfyuiServerDir?.trim() || DEFAULT_COMFYUI_SERVER_DIR,
    extraArgs: config.comfyuiExtraArgs ?? DEFAULT_COMFYUI_EXTRA_ARGS,
    headers: parseComfyUIHeaders(config.comfyuiHeadersJson),
    launchMode: mode,
    taskName: config.comfyuiScheduledTaskName?.trim() || DEFAULT_COMFYUI_TASK_NAME,
  }
}

const STATS_TIMEOUT_MS = 5_000
const START_TIMEOUT_MS = 180_000
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
    if (!isLocalComfyUIEndpoint(this.deps().baseURL)) throw new Error('Start is available only for a ComfyUI server on this machine. The configured endpoint is remote — start it there instead.')
    this.busy = true
    try {
      if (await this.probe().then(probe => probe.up)) {
        return await this.status()
      }
      // A stale instance that holds the port but never answers would make the
      // new launch fail to bind, and the failure looks like "did not start".
      await this.clearStaleProcesses()
      const plan = this.launchPlan()
      if (plan.launch === 'scheduled-task') {
        // The task carries the whole launch line (venv, args, working dir), so
        // the plugin does not need its own copy of any of it.
        const name = this.deps().taskName
        let failure = runScheduledTask('run', name)
        // Task Scheduler refuses /run while the task still reads Running, which
        // happens after a stop that killed the child before the launcher exited.
        if (failure !== undefined && /already running/i.test(failure)) {
          runScheduledTask('end', name)
          await this.waitForTaskIdle(name)
          failure = runScheduledTask('run', name)
        }
        if (failure !== undefined) throw new Error(`Could not start scheduled task "${name}": ${failure}. Create it in Task Scheduler, or switch Launch method to "Python process (main.py)" and set the interpreter and ComfyUI directory.`)
        return await this.waitUntilUp()
      }
      if (plan.launch === 'external') {
        throw new Error(`${plan.hint} Nothing to start automatically.`)
      }
      const { pythonExe, serverDir, extraArgs, baseURL } = this.deps()
      if (pythonExe.trim().length === 0) throw new Error('Set the Python executable for your ComfyUI installation in Settings > Plugins > Image Generation, or start ComfyUI yourself.')
      if (!fs.existsSync(pythonExe)) throw new Error(`Python interpreter not found: ${pythonExe} — set the path in Settings > Plugins > Image Generation.`)
      if (serverDir.trim().length === 0) throw new Error('Set the ComfyUI directory (the folder containing main.py) in Settings > Plugins > Image Generation, or start ComfyUI yourself.')
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
      return await this.waitUntilUp(baseURL)
    } finally {
      this.busy = false
    }
  }

  async stop(): Promise<ComfyUIServerStatus> {
    this.assertNotBusy()
    if (!isLocalComfyUIEndpoint(this.deps().baseURL)) throw new Error('Stop is available only for a ComfyUI server on this machine. The configured endpoint is remote — stop it there instead.')
    this.busy = true
    try {
      // A scheduled-task launch has to be ended at the task too: killing only
      // the python process leaves the task marked Running, and a restart-on-
      // failure task would resurrect it.
      const plan = this.launchPlan()
      if (plan.launch === 'scheduled-task') {
        const name = this.deps().taskName
        const failure = runScheduledTask('end', name)
        if (failure !== undefined) this.warn(`Could not end scheduled task "${name}": ${failure}`)
        // Wait for the task to actually leave Running: a python child can
        // outlive the launcher, and the next /run is refused while it is still
        // marked Running.
        await this.waitForTaskIdle(name)
      }
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
    const { baseURL, launchMode, taskName } = this.deps()
    const probe = await this.probe()
    const pids = isLocalComfyUIEndpoint(baseURL) ? await this.findComfyPids(this.portOf()) : []
    const plan = this.launchPlan()
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
      launchMode,
      effectiveLaunch: plan.launch,
      taskName,
      ...(plan.taskState === undefined ? {} : { taskState: plan.taskState }),
      launchHint: plan.hint,
    }
  }

  /** Poll /system_stats until the server answers, or fail with the log tail. */
  private async waitUntilUp(baseURL = this.deps().baseURL): Promise<ComfyUIServerStatus> {
    const deadline = Date.now() + START_TIMEOUT_MS
    while (Date.now() < deadline) {
      await delay(POLL_MS)
      if ((await this.probe()).up) return await this.status()
    }
    const tail = this.readLogTail()
    const task = readScheduledTask(this.deps().taskName)
    const taskNote = this.launchPlan().launch === 'scheduled-task' && task?.state !== undefined
      ? ` Task "${this.deps().taskName}" reads ${task.state}.`
      : ''
    throw new Error(`ComfyUI did not answer on ${baseURL} within ${String(Math.round(START_TIMEOUT_MS / 1000))} s.${taskNote}${tail.length > 0 ? ` Last output:\n${tail}` : ''}`)
  }

  /** Wait (bounded) for the scheduled task to stop reporting Running. */
  private async waitForTaskIdle(name: string, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const task = readScheduledTask(name)
      if (task === undefined || !/running/i.test(task.state ?? '')) return
      await delay(1_000)
    }
  }

  /**
   * Kill ComfyUI processes that hold the port without answering.
   *
   * Called only after the probe said the server is down, so anything matching
   * is a leftover of a killed launcher: it would block the next instance's bind
   * and turn a clean start into a timeout.
   */
  private async clearStaleProcesses(): Promise<void> {
    const stale = await this.findComfyPids(this.portOf())
    if (stale.length === 0) return
    this.warn(`ComfyUI is not answering but ${String(stale.length)} process(es) still hold port ${this.portOf()}; clearing them before starting.`)
    for (const pid of stale) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
    await delay(2_000)
  }

  /**
   * Decide how Start and Stop should reach this machine's ComfyUI.
   *
   * With `auto`, a scheduled task by the configured name wins (that is how a
   * tray/service install starts it), then the process path. `scheduled-task`
   * and `process` force one. State is read on every call so the card can show
   * "via scheduled task ComfyUI (Ready)" without the user configuring a script.
   */
  private launchPlan(): { launch: 'scheduled-task' | 'process' | 'external', hint: string, taskState?: string } {
    const { launchMode, taskName, pythonExe, serverDir } = this.deps()
    const task = readScheduledTask(taskName)
    const taskHint = task === undefined
      ? `no scheduled task named "${taskName}"`
      : `scheduled task "${taskName}" (${task.state ?? 'state unknown'})`
    const processReady = pythonExe.trim().length > 0 && serverDir.trim().length > 0 && fs.existsSync(path.join(serverDir, 'main.py'))
    const processHint = processReady ? `main.py under ${serverDir}` : 'no ComfyUI directory with main.py configured'
    if (launchMode === 'scheduled-task') {
      return {
        launch: 'scheduled-task',
        hint: `Using ${taskHint}.`,
        ...(task?.state === undefined ? {} : { taskState: task.state }),
      }
    }
    if (launchMode === 'process') return { launch: 'process', hint: `Using ${processHint}.` }
    if (task !== undefined) return { launch: 'scheduled-task', hint: `Auto: using ${taskHint}.`, ...(task.state === undefined ? {} : { taskState: task.state }) }
    if (processReady) return { launch: 'process', hint: `Auto: using ${processHint}.` }
    return { launch: 'external', hint: `Auto: ${taskHint} and ${processHint}; start ComfyUI yourself or create that scheduled task.` }
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
      const config = this.deps()
      const response = await fetch(comfyUIEndpointURL(config.baseURL, 'system_stats'), {
        redirect: 'error',
        signal: AbortSignal.timeout(STATS_TIMEOUT_MS),
        headers: { accept: 'application/json', ...config.headers },
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

/** State Task Scheduler reports for one task, or undefined when it does not exist. */
function readScheduledTask(name: string): { state?: string } | undefined {
  const run = spawnSync('schtasks', ['/query', '/tn', name, '/fo', 'LIST'], { windowsHide: true, encoding: 'utf8', timeout: 15_000 })
  if (run.status !== 0) return undefined
  const match = /^Status:\s*(.+)$/imu.exec(run.stdout ?? '')
  const state = match?.[1]?.trim()
  return { ...(state === undefined || state === '' ? {} : { state }) }
}

/** Run one schtasks verb; returns stderr text when it fails. */
function runScheduledTask(verb: 'run' | 'end', name: string): string | undefined {
  const run = spawnSync('schtasks', [`/${verb}`, '/tn', name], { windowsHide: true, encoding: 'utf8', timeout: 20_000 })
  if (run.status === 0) return undefined
  return (run.stderr || run.stdout || '').trim().slice(0, 400) || `schtasks /${verb} exited ${String(run.status)}`
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
