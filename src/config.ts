/** User-facing configuration for the local ComfyUI image provider. */
import z from '@deepseek-ai/schemastery'
import { SHIPPED_WORKFLOWS } from './generated/default-workflows.js'
import {
  parseComfyUIHeaders,
  DEFAULT_COMFYUI_BASE_URL,
  DEFAULT_COMFYUI_EXTRA_ARGS,
  DEFAULT_COMFYUI_PYTHON_EXE,
  DEFAULT_COMFYUI_SERVER_DIR,
  DEFAULT_COMFYUI_TASK_NAME,
  DEFAULT_COMFYUI_TIMEOUT_MS,
  DEFAULT_COMFYUI_WORKFLOW_LABEL,
  IMAGE_PROVIDERS,
  activeComfyUIWorkflow,
  activeWorkflowForRole,
  resolveComfyUIWorkflows,
  resolveWorkflowRole,
  type ComfyUIWorkflowEntry,
  type ComfyUIWorkflowRole,
  type ImageProvider,
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
  /** Active workflow for text-to-image generation. */
  comfyuiActiveTextWorkflow?: string
  /** Active workflow for image-to-image editing. */
  comfyuiActiveEditWorkflow?: string
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
  /** How Start/Stop reach this machine's ComfyUI. */
  comfyuiLaunchMode?: 'auto' | 'scheduled-task' | 'process'
  /** Task Scheduler task the plugin runs and ends when using the scheduled-task launch. */
  comfyuiScheduledTaskName?: string
  /**
   * Register the Arya Image agent preset: core DSH tools plus this plugin's
   * tools, with the other installed bundles' tools masked out to save context.
   */
  agentPreset?: boolean
  /** Also write every generated image as a file under the session workspace. */
  saveToWorkspace?: boolean
  /** Workspace subfolder for generated images; empty means the workspace root. */
  workspaceFolder?: string
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
/** Workflows a fresh configuration starts with: the shipped pack. */
export const DEFAULT_WORKFLOWS = SHIPPED_WORKFLOWS.map(entry => ({ name: entry.name, json: entry.json }))

export const Config = z.object({
  provider: volatile(z.union(IMAGE_PROVIDERS).default('comfyui')),
  comfyuiBaseURL: volatile(z.string().default(DEFAULT_COMFYUI_BASE_URL)),
  // Prefilled with the shipped pack: a fresh install can generate without
  // importing anything, and the settings card lists them like any other entry.
  comfyuiWorkflows: volatile(z.array(z.object({ name: z.string(), json: z.string(), presetPrompt: z.string().default(''), role: z.union([z.const('text-to-image'), z.const('image-to-image')]) })).default(DEFAULT_WORKFLOWS)),
  comfyuiActiveWorkflow: volatile(z.string().default('')),
  comfyuiActiveTextWorkflow: volatile(z.string().default('')),
  comfyuiActiveEditWorkflow: volatile(z.string().default('')),
  comfyuiWorkflowJson: volatile(z.string().default('')),
  comfyuiWorkflowName: volatile(z.string().default('')),
  comfyuiTimeoutMs: volatile(z.number().min(1_000).max(3_600_000).default(DEFAULT_COMFYUI_TIMEOUT_MS)),
  comfyuiHeadersJson: volatile(z.string().default('')),
  comfyuiPythonExe: volatile(z.string().default(DEFAULT_COMFYUI_PYTHON_EXE)),
  comfyuiServerDir: volatile(z.string().default(DEFAULT_COMFYUI_SERVER_DIR)),
  comfyuiExtraArgs: volatile(z.string().default(DEFAULT_COMFYUI_EXTRA_ARGS)),
  comfyuiAutoStart: volatile(z.boolean().default(false)),
  /** How Start/Stop reach this machine's ComfyUI: a scheduled task, a spawned python, or auto. */
  comfyuiLaunchMode: volatile(z.union([z.const('auto'), z.const('scheduled-task'), z.const('process')]).default('auto')),
  /** Task Scheduler name to run/end when the launch mode is the scheduled task. */
  comfyuiScheduledTaskName: volatile(z.string().default(DEFAULT_COMFYUI_TASK_NAME)),
  agentPreset: volatile(z.boolean().default(true)),
  saveToWorkspace: volatile(z.boolean().default(true)),
  workspaceFolder: volatile(z.string().default(DEFAULT_WORKSPACE_FOLDER)),
}) as unknown as z<Config>

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

/**
 * Pick the workflow a call runs, honouring the role it needs.
 *
 * Generation resolves the active text-to-image workflow and editing resolves
 * the active image-to-image one, so a caller never has to know which graph is
 * which. Naming a workflow explicitly still works, but naming one from the
 * other role fails with the name of the workflow that would have worked.
 *
 * @param config - current plugin configuration.
 * @param role - role the call needs.
 * @param requested - optional workflow name from the tool arguments.
 * @returns the workflow to run.
 */
export function selectWorkflowForRole(config: Config, role: ComfyUIWorkflowRole, requested?: string): ComfyUIWorkflowEntry {
  const entries = resolveComfyUIWorkflows(config)
  const want = role === 'image-to-image' ? 'image-to-image' : 'text-to-image'
  const name = typeof requested === 'string' ? requested.trim() : ''
  if (name.length > 0) {
    const bare = name.replace(/\.json$/i, '').toLowerCase()
    const match = entries.find(entry => entry.name === name)
      ?? entries.find(entry => entry.name.replace(/\.json$/i, '').toLowerCase() === bare)
    if (match === undefined) {
      throw new Error(`No ComfyUI workflow named "${name}" is configured. Available workflows: ${entries.map(entry => entry.name).join(', ')}.`)
    }
    const matchRole = resolveWorkflowRole(match)
    if (matchRole !== want) {
      const alternative = activeWorkflowForRole(config, want) ?? entries.find(entry => resolveWorkflowRole(entry) === want)
      throw new Error(
        `"${match.name}" is a ${matchRole} workflow; this call needs ${want}.${alternative === undefined ? ` Import a ${want} workflow in Settings > Plugins > Arya Image Gen.` : ` Use "${alternative.name}" instead, or omit workflow to let the plugin pick it.`}`,
      )
    }
    return match
  }
  const chosen = activeWorkflowForRole(config, want)
  if (chosen === undefined) {
    throw new Error(`No ${want} workflow is imported. Import one in Settings > Plugins > Arya Image Gen${want === 'image-to-image' ? ' (a workflow with an {{image}} input)' : ''}.`)
  }
  return chosen
}

/** Parse the space-separated extra main.py arguments; quotes keep grouped values together. */export function parseComfyUIExtraArgs(value: string | undefined): string[] {
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
