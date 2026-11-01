/** User-facing configuration for the local ComfyUI image provider. */
import z from '@deepseek-ai/schemastery'
import {
  parseComfyUIHeaders,
  DEFAULT_COMFYUI_BASE_URL,
  DEFAULT_COMFYUI_EXTRA_ARGS,
  DEFAULT_COMFYUI_PYTHON_EXE,
  DEFAULT_COMFYUI_SERVER_DIR,
  DEFAULT_COMFYUI_TIMEOUT_MS,
  DEFAULT_COMFYUI_WORKFLOW_LABEL,
  IMAGE_PROVIDERS,
  activeComfyUIWorkflow,
  resolveComfyUIWorkflows,
  type ComfyUIWorkflowEntry,
  type ImageProvider,
  type RenderDefaults,
} from './shared.js'

export {
  DEFAULT_COMFYUI_BASE_URL,
  DEFAULT_COMFYUI_EXTRA_ARGS,
  DEFAULT_COMFYUI_PYTHON_EXE,
  DEFAULT_COMFYUI_SERVER_DIR,
  DEFAULT_COMFYUI_TIMEOUT_MS,
  DEFAULT_COMFYUI_WORKFLOW_LABEL,
  IMAGE_PROVIDERS,
  activeComfyUIWorkflow,
  resolveComfyUIWorkflows,
  type ComfyUIWorkflowEntry,
  type ImageProvider,
}

/** Default workspace subfolder that receives generated image files. */
export const DEFAULT_WORKSPACE_FOLDER = 'dsh-arya-image-gen'

/** Bundle configuration from the profile patch and the Web settings page. */
export interface Config {
  /** Legacy persisted provider; this fork only understands "comfyui". */
  provider?: ImageProvider
  comfyuiBaseURL?: string
  /** Named ComfyUI workflows managed by the Web settings page. */
  comfyuiWorkflows?: ComfyUIWorkflowEntry[]
  /** Name of the workflow ComfyUI calls use by default. */
  comfyuiActiveWorkflow?: string
  /** Legacy single-workflow storage; synced to the active entry for downgrades. */
  comfyuiWorkflowJson?: string
  /** Original imported file name of the legacy single workflow. */
  comfyuiWorkflowName?: string
  comfyuiTimeoutMs?: number
  /** Optional request headers as a JSON object, e.g. a reverse-proxy Authorization token. */
  comfyuiHeadersJson?: string
  /** Python interpreter used by the built-in ComfyUI server launcher. */
  comfyuiPythonExe?: string
  /** ComfyUI checkout directory the server is launched from (main.py lives here). */
  comfyuiServerDir?: string
  /** Extra main.py arguments appended on launch, e.g. "--listen 127.0.0.1 --disable-auto-launch". */
  comfyuiExtraArgs?: string
  /** Launch the ComfyUI server automatically when the plugin boots and it is down. */
  comfyuiAutoStart?: boolean
  /** Explicit Chromium path for HTML/SVG rendering; empty means auto-detect. */
  renderBrowserPath?: string
  /** Default canvas for a render that does not state its own size. */
  renderDefaultWidth?: number
  renderDefaultHeight?: number
  /** Default device pixel ratio (1-4). */
  renderScale?: number
  /** Page background behind rendered markup. */
  renderBackground?: string
  renderTimeoutMs?: number
  /** Keep the .html/.svg source next to the PNG in the workspace. */
  renderSaveSource?: boolean
  /**
   * Register the Arya Image agent preset: core DSH tools plus this plugin's
   * tools, with the other installed bundles' tools masked out to save context.
   */
  agentPreset?: boolean
  /** Also write every generated image as a file under the session workspace. */
  saveToWorkspace?: boolean
  /** Workspace subfolder for generated images; empty means the workspace root. */
  workspaceFolder?: string
  /** Show the workflow switcher beside the chat input. */
  showProviderPill?: boolean
}

/**
 * Mark a schema field live for DSH 0.1.7+: the host serves a plugin's settings
 * form only for `.volatile()` fields and hands `apply` a `Volatile` box per
 * field (unwrapped in `src/index.ts`). Hosts ≤0.1.6 ship a schemastery without
 * the method, so marking is conditional — an unmarked schema stays plain there
 * and the old settings relay keeps working.
 */
function volatile<T extends z>(schema: T): T {
  const mark = (schema as unknown as { volatile?: () => T }).volatile
  return typeof mark === 'function' ? mark.call(schema) : schema
}

/**
 * Cordis configuration schema. Volatile marking happens per field (see
 * `volatile`); the `z<Config>` annotation keeps the plain output type for the
 * rest of the codebase because the wrapping is unwrapped at the entry.
 */
export const Config = z.object({
  provider: volatile(z.union(IMAGE_PROVIDERS).default('comfyui')),
  comfyuiBaseURL: volatile(z.string().default(DEFAULT_COMFYUI_BASE_URL)),
  comfyuiWorkflows: volatile(z.array(z.object({ name: z.string(), json: z.string(), presetPrompt: z.string().default('') })).default([])),
  comfyuiActiveWorkflow: volatile(z.string().default('')),
  comfyuiWorkflowJson: volatile(z.string().default('')),
  comfyuiWorkflowName: volatile(z.string().default('')),
  comfyuiTimeoutMs: volatile(z.number().min(1_000).max(3_600_000).default(DEFAULT_COMFYUI_TIMEOUT_MS)),
  comfyuiHeadersJson: volatile(z.string().default('')),
  comfyuiPythonExe: volatile(z.string().default(DEFAULT_COMFYUI_PYTHON_EXE)),
  comfyuiServerDir: volatile(z.string().default(DEFAULT_COMFYUI_SERVER_DIR)),
  comfyuiExtraArgs: volatile(z.string().default(DEFAULT_COMFYUI_EXTRA_ARGS)),
  comfyuiAutoStart: volatile(z.boolean().default(false)),
  renderBrowserPath: volatile(z.string().default('')),
  renderDefaultWidth: volatile(z.number().min(16).max(8192).default(1200)),
  renderDefaultHeight: volatile(z.number().min(16).max(8192).default(630)),
  renderScale: volatile(z.number().min(1).max(4).default(1)),
  renderBackground: volatile(z.string().default('#ffffff')),
  renderTimeoutMs: volatile(z.number().min(1000).max(120000).default(30000)),
  renderSaveSource: volatile(z.boolean().default(true)),
  agentPreset: volatile(z.boolean().default(true)),
  saveToWorkspace: volatile(z.boolean().default(true)),
  workspaceFolder: volatile(z.string().default(DEFAULT_WORKSPACE_FOLDER)),
  showProviderPill: volatile(z.boolean().default(false)),
}) as unknown as z<Config>

/** Default canvas for a render that does not state its own size. */
export const DEFAULT_RENDER_WIDTH = 1200
export const DEFAULT_RENDER_HEIGHT = 630
export const DEFAULT_RENDER_SCALE = 1
export const DEFAULT_RENDER_BACKGROUND = '#ffffff'
export const DEFAULT_RENDER_TIMEOUT_MS = 30_000

/**
 * Clamp a configured number into the range the renderer accepts.
 *
 * @param value - configured or undefined value.
 * @param fallback - value used when unset.
 * @param min - lowest accepted value.
 * @param max - highest accepted value.
 * @returns a finite, in-range number.
 */
function clampNumber(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(value, min), max)
}

/**
 * Read the render defaults out of the plugin configuration.
 *
 * @param config - current configuration.
 * @returns defaults the tools and the workbench both apply.
 */
export function resolveRenderDefaults(config: Config): RenderDefaults {
  return {
    width: Math.round(clampNumber(config.renderDefaultWidth, DEFAULT_RENDER_WIDTH, 16, 8192)),
    height: Math.round(clampNumber(config.renderDefaultHeight, DEFAULT_RENDER_HEIGHT, 16, 8192)),
    scale: clampNumber(config.renderScale, DEFAULT_RENDER_SCALE, 1, 4),
    background: typeof config.renderBackground === 'string' && config.renderBackground.trim().length > 0
      ? config.renderBackground.trim()
      : DEFAULT_RENDER_BACKGROUND,
    timeoutMs: clampNumber(config.renderTimeoutMs, DEFAULT_RENDER_TIMEOUT_MS, 1_000, 120_000),
  }
}

/** Resolve the single (ComfyUI) provider profile for a tool call. */export function resolveProvider(config: Config): {
  provider: 'comfyui'
  baseURL: string
  headers: Record<string, string>
  workflows: ComfyUIWorkflowEntry[]
  workflow?: ComfyUIWorkflowEntry
  timeoutMs: number
} {
  const workflows = resolveComfyUIWorkflows(config)
  const workflow = activeComfyUIWorkflow(config)
  return {
    provider: 'comfyui',
    baseURL: config.comfyuiBaseURL ?? DEFAULT_COMFYUI_BASE_URL,
    headers: parseComfyUIHeaders(config.comfyuiHeadersJson),
    workflows,
    ...(workflow === undefined ? {} : { workflow }),
    timeoutMs: config.comfyuiTimeoutMs ?? DEFAULT_COMFYUI_TIMEOUT_MS,
  }
}

/** The workflow a ComfyUI call runs: the requested name when given, else the active one. */
export function selectComfyUIWorkflow(
  active: { workflows: ComfyUIWorkflowEntry[]; workflow?: ComfyUIWorkflowEntry },
  requested?: string,
): ComfyUIWorkflowEntry {
  if (active.workflow === undefined) {
    throw new Error('ComfyUI image generation requires an imported workflow; import one in Settings > Plugins > Image Generation.')
  }
  if (typeof requested !== 'string' || requested.trim().length === 0) return active.workflow
  const name = requested.trim()
  // Imported labels drop the file extension, so callers routinely pass the file
  // name. Accept an optional .json suffix and casing differences either way.
  const bare = name.replace(/\.json$/i, '')
  const same = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase()
  const workflow = active.workflows.find(candidate => candidate.name === name)
    ?? active.workflows.find(candidate => same(candidate.name, bare) || same(candidate.name.replace(/\.json$/i, ''), bare))
  if (workflow === undefined) {
    throw new Error(`No ComfyUI workflow named "${name}" is configured. Available workflows: ${active.workflows.map(entry => entry.name).join(', ')}.`)
  }
  return workflow
}

/** Parse the space-separated extra main.py arguments; quotes keep grouped values together. */
export function parseComfyUIExtraArgs(value: string | undefined): string[] {
  const text = (value ?? DEFAULT_COMFYUI_EXTRA_ARGS).trim()
  if (text.length === 0) return []
  const tokens: string[] = []
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g
  for (const match of text.matchAll(pattern)) {
    const token = match[1] ?? match[2] ?? match[3]
    if (token !== undefined && token.length > 0) tokens.push(token)
  }
  return tokens
}
