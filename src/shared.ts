/** Values shared by the Host and browser Bundle faces. ComfyUI-only build. */
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'

/** Browser route used by the generated-image card. */
export const IMAGE_ROUTE = '/plugins/dsh-image-gen/image'
/** Browser route that uploads user-picked images as DSH attachments. */
export const IMPORT_ROUTE = '/plugins/dsh-image-gen/import'
/** Browser route used for deleting generated images and workspace files. */
export const DELETE_ROUTE = '/plugins/dsh-image-gen/delete'
/** Same-origin route used by the browser image workbench. */
export const STUDIO_ROUTE = '/plugins/dsh-image-gen/studio'
/** Same-origin route for built-in prompt inspiration metadata and images. */
export const INSPIRATION_ROUTE = '/plugins/dsh-image-gen/inspiration'
/** Browser route used for saving generated images to workspace on demand. */
export const SAVE_WORKSPACE_ROUTE = '/plugins/dsh-image-gen/save-workspace'
/** Same-origin route that starts, stops, restarts, and probes the local ComfyUI server. */
export const COMFYUI_SERVER_ROUTE = '/plugins/dsh-image-gen/comfyui-server'
/** Deterministic progress job id for one chat tool call. */
export function progressJobIdForCall(callId: string): string {
  const safe = callId.replace(/[^A-Za-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return (safe.length >= 8 ? safe.slice(0, 72) : `job-${safe}`).slice(0, 72)
}

/** Prefix for live job snapshots, previews, and cancellation. */
export const COMFYUI_PROGRESS_ROUTE = '/plugins/dsh-image-gen/progress'
/** Non-secret settings capability probe, available even when the host cannot serve a form. */
export const SETTINGS_HEALTH_ROUTE = '/plugins/dsh-image-gen/settings-health'

export interface SettingsHealth {
  settings: 'unavailable' | 'legacy' | 'live'
  liveSchema: boolean
}
/** Browser route the workbench infinite canvas pushes live state through. */
export const CANVAS_STATE_ROUTE = '/plugins/dsh-image-gen/canvas-state'
/** Upload a selected canvas original to the host attachment store. */
export const CANVAS_ASSET_ROUTE = '/plugins/dsh-image-gen/canvas-asset'

/** Coarse model-facing kind of one shape on the workbench infinite canvas. */
export type CanvasNodeKind = 'image' | 'draw' | 'text' | 'note' | 'geo' | 'arrow' | 'frame' | 'other'

/** Every accepted canvas node kind, for validating untrusted pushes. */
export const CANVAS_NODE_KINDS: readonly CanvasNodeKind[] = ['image', 'draw', 'text', 'note', 'geo', 'arrow', 'frame', 'other']

/**
 * Cap on the selection identity list: the client trims `selection.items` to
 * this size and the canvas-state route rejects pushes carrying more, so the
 * two ends can never drift apart.
 */
export const CANVAS_MAX_SELECTION_ITEMS = 16

/**
 * Cap on the node inventory: the client trims `nodes` to this size and the
 * canvas-state route rejects pushes carrying more, so the two ends can never
 * drift apart. Sized to keep the model-facing digest compact.
 */
export const CANVAS_MAX_NODES = 48

/** Same shared-cap contract as CANVAS_MAX_NODES, for the selection kind list. */
export const CANVAS_MAX_SELECTION_KINDS = 8

/**
 * Cap on the generation prompt copied onto canvas image shapes and into the
 * model-facing summaries. The landing path truncates to this and the
 * canvas-state route rejects longer values, so the two ends can never drift.
 * The gallery keeps the full prompt; this is only the canvas-side digest view.
 */
export const CANVAS_MAX_PROMPT_CHARS = 120

/** One shape on the workbench infinite canvas, summarized for the model. */
export interface CanvasNodeSummary {
  kind: CanvasNodeKind
  /** Gallery id when the shape is a generated image landed from the bus. */
  galleryId?: string
  /** Conversation attachment id for generated images; edit_image can target it directly. */
  attachmentId?: string
  /** Complete host reference; remains usable after switching conversations. */
  attachment?: ImageAttachmentRef
  /** Human-facing label: image name, geo variant, or similar. */
  name?: string
  width?: number
  height?: number
  /** Short text preview for text-bearing shapes. */
  text?: string
  /**
   * Truncated generation prompt for landed generated images: the model can
   * reproduce or precisely vary a canvas image instead of guessing from pixels.
   */
  prompt?: string
  /** Provider id (always "comfyui" in this build) the landed image was generated with. */
  provider?: string
  /** ComfyUI workflow label the landed image was generated with. */
  model?: string
}

/** What is currently selected on the canvas. */
export interface CanvasSelectionSummary {
  count: number
  kinds: readonly CanvasNodeKind[]
  /**
   * Capped identity list of the selected shapes, using the same summary shape
   * as canvas nodes: the model learns WHICH images or strokes are selected
   * (name, attachment id, dimensions), not just how many. Without this, two
   * selections of the same size and kind are indistinguishable.
   */
  items?: readonly CanvasNodeSummary[]
}

/**
 * One live state push from a browser tldraw instance of the workbench canvas.
 * The browser owns the canvas; the host keeps only this compact mirror, so
 * the conversation agent can reason about (and look at) what the user sees.
 */
export interface CanvasStatePush {
  /** Tldraw editor id; distinguishes simultaneously mounted canvases. */
  clientInstance: string
  /** False on the final push right before a canvas unmounts. */
  connected: boolean
  /** Total shape count on the current page (the node list may be capped). */
  nodeCount: number
  /** Capped shape inventory, capped client-side before transport. */
  nodes?: readonly CanvasNodeSummary[]
  selection?: CanvasSelectionSummary
  /**
   * PNG data-URL screenshot of the current selection, pushed whenever a
   * selection settles. It shows the selection as it looks on the canvas —
   * including annotations drawn over generated images — so the model sees the
   * live canvas state, not just the original conversation attachment.
   */
  selectionImage?: string
  /** Changes whenever the selection or its contents change. */
  selectionRevision?: string
  selectionStatus?: 'preparing' | 'ready' | 'error'
  selectionError?: string
  /** Monotonic per mounted editor, including its final disconnect. */
  sequence?: number
  updatedAt: number
}

/** Namespace persisted through DSH Settings. */
export const IMAGE_GENERATION_NAMESPACE = 'image-generation'

/**
 * Loader entry id of this plugin's composition entry (see cordis.patch.yml).
 * DSH 0.1.7 serves a plugin's settings under its entry id as the namespace,
 * so browser-side reads/writes bind `configForms` to this id.
 */
export const IMAGE_GENERATION_ENTRY_ID = 'image-gen'

/** Supported providers. This fork is ComfyUI-only. */
export const IMAGE_PROVIDERS = ['comfyui'] as const
export type ImageProvider = typeof IMAGE_PROVIDERS[number]

/** Providers the browser workbench can drive: ComfyUI workflows. */
export const STUDIO_PROVIDERS = IMAGE_PROVIDERS
export type StudioProvider = ImageProvider

/** True when the provider is selectable in the browser workbench. */
export function isStudioProvider(provider: ImageProvider): provider is StudioProvider {
  return (STUDIO_PROVIDERS as readonly string[]).includes(provider)
}

/** Display name of the one provider, for status lines and provenance. */
export const PROVIDER_DISPLAY_NAMES: Record<ImageProvider, string> = {
  comfyui: 'ComfyUI',
}

/** One selectable option exposed by a provider profile. */
export interface StudioOption {
  value: string
  label: string
}

/**
 * Browser-safe workbench profile. One profile is emitted per imported ComfyUI
 * workflow: `model` carries the workflow name, so the model picker doubles as
 * the workflow picker. Ratio/quality pickers stay empty — the workflow itself
 * defines the canvas size — and the client hides those selects when the option
 * lists are empty.
 */
export interface StudioProviderProfile {
  provider: StudioProvider
  label: string
  /** Workflow name this profile runs. */
  model: string
  /** All imported workflows; the model picker lists them. */
  modelOptions: StudioOption[]
  configured: boolean
  supportsEditing: boolean
  ratioOptions: StudioOption[]
  qualityOptions: StudioOption[]
  defaultRatio: string
  defaultQuality: string
  /** Compatibility fields: ComfyUI profiles never carry these values. */
  channel?: string
  editModel?: string
  defaultResolution?: string
  defaultGenerationQuality?: string
  resolutionOptions?: Record<string, StudioOption[]>
  generationQualityOptions?: StudioOption[]
}

export function studioModelOptionsForMode(profile: StudioProviderProfile, _mode?: 'generate' | 'edit'): StudioOption[] {
  return profile.modelOptions.length > 0 ? profile.modelOptions : [{ value: profile.model, label: profile.model }]
}

/** The workflow a profile runs in either mode; ComfyUI has one model per workflow. */
export function studioModelForMode(profile: StudioProviderProfile, _mode?: 'generate' | 'edit'): string {
  return profile.model
}

/** Identifier for one workbench target; ComfyUI registers one row per workflow. */
export function studioTargetKey(provider: string, channel?: string): string {
  return channel === undefined || channel.length === 0 ? provider : `${provider}:${channel}`
}

/** ComfyUI has no subscription channels. */
export function isSubscriptionProvider(_provider: string): boolean {
  return false
}

/** How a mode's watermark control should render; ComfyUI never offers one. */
export type StudioWatermark = 'default' | 'on' | 'off' | 'auto'

export const STUDIO_WATERMARK_VALUES: readonly StudioWatermark[] = ['default', 'on', 'off', 'auto']

export interface WatermarkCapability {
  status: 'supported' | 'unsupported' | 'unknown'
  values?: readonly StudioWatermark[]
}

/** ComfyUI workflows embed no watermark parameter, so the control stays hidden. */
export function studioWatermarkCapability(_profile?: StudioProviderProfile, _mode?: 'generate' | 'edit'): WatermarkCapability {
  return { status: 'unsupported' }
}

/** Upstream default quality value used by compatibility pickers. */
export const PROVIDER_DEFAULT_QUALITY = 'auto'

/**
 * Choose the workflow a mode should use without asking the user. Image-to-image
 * only considers edit-capable workflows; a remembered choice wins when it is
 * compatible, otherwise the first compatible workflow applies.
 */
export function pickStudioWorkflow(
  profiles: readonly StudioProviderProfile[],
  mode: 'generate' | 'edit',
  preferred?: string,
): StudioProviderProfile | undefined {
  const compatible = profiles.filter(profile => profile.configured && (mode === 'generate' || profile.supportsEditing))
  if (compatible.length === 0) return undefined
  const bare = (name: string | undefined): string => (name ?? '').replace(/\.json$/i, '').toLowerCase()
  const wanted = bare(preferred)
  return (wanted.length > 0 ? compatible.find(profile => bare(profile.model) === wanted) : undefined) ?? compatible[0]
}

/** Lightweight workspace description exposed to the client for scoping. */
export interface StudioWorkspaceInfo {
  workspaceId: string
  path: string
  title: string
  sessionIds: string[]
}

/** Read capability state for the workbench without exposing secrets. */
export interface StudioConfigResponse {
  providers: StudioProviderProfile[]
  activeProvider: StudioProvider
  /** Workflow the workbench preselects. */
  activeWorkflow?: string
  workspaceRoot?: string | undefined
  workspaces?: StudioWorkspaceInfo[] | undefined
}

/** A browser-uploaded reference image used for one editing request. */
export interface StudioEncodedReference {
  mediaType: ImageMediaType
  data: string
  name?: string
}

/** A durable image reference selected from the existing gallery. */
export interface StudioAttachmentReference {
  attachment: ImageAttachmentRef
}

export type StudioReference = StudioEncodedReference | StudioAttachmentReference

/** One browser workbench generation or editing request. */
export interface StudioGenerateRequest {
  mode: 'generate' | 'edit'
  provider: StudioProvider
  /** Workflow name to run; must be one of the profile's modelOptions. */
  model: string
  prompt: string
  /** Client-generated job id used to follow live progress for this request. */
  jobId?: string | undefined
  reference?: StudioReference
  references?: StudioReference[]
  count?: number | undefined
  workspaceRoot?: string | undefined
  /** Compatibility fields accepted from older clients and ignored by ComfyUI. */
  channel?: string
  ratio?: string
  quality?: string
  resolution?: string
  generationQuality?: string
  watermark?: StudioWatermark
}

/** One individual generated image item in a workbench batch. */
export interface StudioGeneratedItem {
  attachment: ImageAttachmentRef
  output: string
  savedTo?: string | undefined
  seed?: number
  /** ComfyUI workflow that produced this image. */
  workflow?: string
  /** Timing split and provenance from the ComfyUI job. */
  queueMs?: number
  execMs?: number
  totalMs?: number
  queueAhead?: number
  comfyVersion?: string
}

/** One completed workbench request. */
export interface StudioGenerateResponse extends StudioGeneratedItem {
  provider: StudioProvider
  model: string
  prompt: string
  createdAt: number
  elapsedMs: number
  items?: StudioGeneratedItem[] | undefined
  requestedCount?: number | undefined
  failedCount?: number | undefined
  errors?: Array<{ index: number; message: string }> | undefined
  /** Compatibility field; ComfyUI runs no named channel. */
  channel?: string
}

/** Default endpoints and base URLs. */
export const DEFAULT_COMFYUI_BASE_URL = 'http://127.0.0.1:8188'
export const DEFAULT_COMFYUI_TIMEOUT_MS = 300_000
export const DEFAULT_COMFYUI_WORKFLOW_LABEL = 'API workflow'
export const MAX_COMFYUI_WORKFLOW_BYTES = 5 * 1024 * 1024

/**
 * Local launch values are intentionally empty: the server layout differs per
 * machine, and a prefilled path from another computer is worse than none.
 */
export const DEFAULT_COMFYUI_PYTHON_EXE = ''
export const DEFAULT_COMFYUI_SERVER_DIR = ''
export const DEFAULT_COMFYUI_EXTRA_ARGS = '--listen 127.0.0.1 --disable-auto-launch'

/** True when the endpoint points at this machine, so process controls apply. */
export function isLocalComfyUIEndpoint(baseURL: string): boolean {
  try {
    const host = new URL(baseURL.trim()).hostname.toLowerCase().replace(/^\[|\]$/g, '')
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost')
  } catch {
    return true
  }
}

/** Parse the optional custom request headers (JSON object of strings). */
export function parseComfyUIHeaders(value: string | undefined): Record<string, string> {
  const text = (value ?? '').trim()
  if (text.length === 0) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Custom headers must be a JSON object, for example {"Authorization": "Bearer token"}.')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Custom headers must be a JSON object of string values.')
  }
  const headers: Record<string, string> = {}
  for (const [name, headerValue] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof headerValue !== 'string') throw new Error(`Custom header "${name}" must be a string.`)
    headers[name] = headerValue
  }
  return headers
}

/**
 * Escape double braces before text reaches a system-prompt context: AryaCode
 * 0.2 fails a turn when it sees an unknown {{variable}}.
 */
export function safePromptText(value: string): string {
  return value.replaceAll('{{', '{ {').replaceAll('}}', '} }')
}

/** Resolve a ComfyUI API path against the configured base URL, keeping any subpath. */
export function comfyUIEndpointURL(baseURL: string, path: string): URL {
  const normalized = baseURL.trim().endsWith('/') ? baseURL.trim() : `${baseURL.trim()}/`
  return new URL(path.replace(/^\//, ''), normalized)
}


/** One named ComfyUI API-format workflow imported through settings. */
export interface ComfyUIWorkflowEntry {
  /** Unique human-readable label; used as the result model and by tool calls. */
  name: string
  /** API-format workflow JSON with {{prompt}} / {{seed}} and optional {{image}} placeholders. */
  json: string
  /** Optional preset prepended to the user prompt on every call of this workflow. */
  presetPrompt?: string
}

/** Raw ComfyUI workflow fields as persisted through DSH Settings. */
export interface ComfyUIWorkflowSource {
  /** Named workflows managed by the Web settings page. */
  comfyuiWorkflows?: readonly ComfyUIWorkflowEntry[]
  /** Name of the entry ComfyUI calls use by default. */
  comfyuiActiveWorkflow?: string
  /** Legacy single-workflow storage; synced to the active entry for downgrades. */
  comfyuiWorkflowJson?: string
  comfyuiWorkflowName?: string
}

/** Named workflows, falling back to the legacy single-workflow fields when the list is empty. */
export function resolveComfyUIWorkflows(source: ComfyUIWorkflowSource): ComfyUIWorkflowEntry[] {
  const named: ComfyUIWorkflowEntry[] = []
  for (const entry of source.comfyuiWorkflows ?? []) {
    const name = typeof entry?.name === 'string' ? entry.name.trim() : ''
    const json = typeof entry?.json === 'string' ? entry.json : ''
    if (name.length > 0 && json.trim().length > 0) {
      const presetPrompt = typeof entry.presetPrompt === 'string' ? entry.presetPrompt.trim() : ''
      named.push(presetPrompt.length > 0 ? { name, json, presetPrompt } : { name, json })
    }
  }
  if (named.length > 0) return named
  const legacyJson = typeof source.comfyuiWorkflowJson === 'string' ? source.comfyuiWorkflowJson : ''
  if (legacyJson.trim().length === 0) return []
  const legacyName = typeof source.comfyuiWorkflowName === 'string' ? source.comfyuiWorkflowName.trim() : ''
  return [{ name: legacyName.length > 0 ? legacyName : DEFAULT_COMFYUI_WORKFLOW_LABEL, json: legacyJson }]
}

/** The workflow ComfyUI calls use by default: the configured active name, else the first entry. */
export function activeComfyUIWorkflow(source: ComfyUIWorkflowSource): ComfyUIWorkflowEntry | undefined {
  const workflows = resolveComfyUIWorkflows(source)
  if (workflows.length === 0) return undefined
  const activeName = typeof source.comfyuiActiveWorkflow === 'string' ? source.comfyuiActiveWorkflow.trim() : ''
  return workflows.find(workflow => workflow.name === activeName) ?? workflows[0]
}

/** Derive a workflow label that does not collide with the given existing names. */
export function uniqueComfyUIWorkflowName(name: string, existing: readonly string[]): string {
  const base = name.trim().length > 0 ? name.trim() : DEFAULT_COMFYUI_WORKFLOW_LABEL
  if (!existing.includes(base)) return base
  for (let index = 2; ; index += 1) {
    const candidate = `${base} (${index})`
    if (!existing.includes(candidate)) return candidate
  }
}

/**
 * Combine a workflow's preset with the user prompt: preset first, user second,
 * joined by one comma — never doubled when the preset already ends in a
 * separator, and reduced to the non-empty side when the other is blank.
 */
export function mergeComfyUIPrompt(preset: string | undefined, user: string): string {
  const presetText = typeof preset === 'string' ? preset.trim().replace(/[,;\s]+$/, '') : ''
  const userText = user.trim()
  if (presetText.length === 0) return userText
  if (userText.length === 0) return presetText
  return `${presetText}, ${userText}`
}

/** Local ComfyUI server lifecycle state, surfaced through the server route. */
export interface ComfyUIServerStatus {
  /** Up when /system_stats answered; independent of who launched the process. */
  up: boolean
  /** True when this plugin process launched (and can stop) the server. */
  managed: boolean
  /** Python PIDs whose command line runs ComfyUI main.py on the configured port. */
  pids: number[]
  /** ComfyUI version reported by /system_stats, when up. */
  version?: string
  pythonVersion?: string
  /** First device line, e.g. "cuda:0 (NVIDIA GeForce RTX 4090)". */
  device?: string
  vramFreeBytes?: number
  vramTotalBytes?: number
  baseUrl: string
  /** True while a start/stop transition is in flight. */
  busy: boolean
}

export const DEFAULT_MODELS: Record<ImageProvider, string> = {
  comfyui: DEFAULT_COMFYUI_WORKFLOW_LABEL,
}

export const DEFAULT_BASE_URLS: Record<ImageProvider, string> = {
  comfyui: DEFAULT_COMFYUI_BASE_URL,
}
