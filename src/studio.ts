/** ComfyUI-workflow orchestration for the browser image workbench. */
import type { ImageAttachmentRef, ImageMediaType, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { Context } from '@deepseek-ai/cordis'
import { resolveProvider, selectComfyUIWorkflow, type Config } from './config.js'
import { editComfyUIImage, generateComfyUIImage } from './comfyui.js'
import { comfyProgress } from './comfyui-progress.js'
import { COMFYUI_IMAGE_PLACEHOLDER, detectWorkflowCapabilities, hasComfyUIImagePlaceholder } from './comfyui-workflow.js'
import {
  COMFYUI_SIZE_PRESETS,
  DEFAULT_COMFYUI_TIMEOUT_MS,
  PROVIDER_DISPLAY_NAMES,
  resolveComfyUIWorkflows,
  type StudioConfigResponse,
  type StudioGenerateRequest,
  type StudioGenerateResponse,
  type StudioGeneratedItem,
  type StudioOption,
  type StudioProviderProfile,
  type StudioReference,
} from './shared.js'

const WORKFLOW_LABEL = 'ComfyUI'

/**
 * ComfyUI has no ratio/quality matrix: each imported workflow defines its own
 * canvas size, so one profile per workflow populates the model picker and the
 * ratio/quality pickers stay empty (the client hides those selects).
 */
export function describeStudio(config: Config): StudioConfigResponse {
  const workflows = resolveComfyUIWorkflows(config)
  const modelOptions: StudioOption[] = workflows.map(workflow => ({ value: workflow.name, label: workflow.name }))
  const profiles: StudioProviderProfile[] = workflows.map(workflow => {
    const capabilities = detectWorkflowCapabilities(workflow.json)
    const adjustableSize = capabilities.placeholders.width || capabilities.placeholders.height
    return {
      provider: 'comfyui' as const,
      label: WORKFLOW_LABEL,
      model: workflow.name,
      modelOptions,
      configured: true,
      // A workflow edits only when its JSON declares the {{image}} input.
      supportsEditing: hasComfyUIImagePlaceholder(workflow.json),
      ratioOptions: [],
      qualityOptions: [],
      defaultRatio: 'auto',
      defaultQuality: 'auto',
      role: capabilities.role,
      params: capabilities.placeholders,
      ...(adjustableSize ? { sizePresets: [...COMFYUI_SIZE_PRESETS] } : {}),
      ...(capabilities.bakedSize === undefined ? {} : { bakedSize: capabilities.bakedSize }),
    }
  })
  const activeWorkflow = modelOptions.some(option => option.value === config.comfyuiActiveWorkflow)
    ? config.comfyuiActiveWorkflow
    : workflows[0]?.name
  return {
    providers: profiles,
    activeProvider: 'comfyui',
    ...(activeWorkflow === undefined ? {} : { activeWorkflow }),
  }
}

/** Execute one validated browser workbench request against a ComfyUI workflow. */
export async function generateFromStudio(
  ctx: Context,
  config: Config,
  input: StudioGenerateRequest,
  signal: AbortSignal,
  fallbackWorkspaceRoot?: string | undefined,
): Promise<StudioGenerateResponse> {
  try {
    return await runStudioGeneration(ctx, config, input, signal, fallbackWorkspaceRoot)
  } catch (error) {
    if (input.jobId !== undefined) comfyProgress.finish(input.jobId, 'error', messageOf(error))
    throw error
  }
}

function studioParams(input: StudioGenerateRequest): { width?: number; height?: number; steps?: number; cfg?: number } {
  return {
    ...(typeof input.width === 'number' ? { width: input.width } : {}),
    ...(typeof input.height === 'number' ? { height: input.height } : {}),
    ...(typeof input.steps === 'number' ? { steps: input.steps } : {}),
    ...(typeof input.cfg === 'number' ? { cfg: input.cfg } : {}),
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function runStudioGeneration(
  ctx: Context,
  config: Config,
  input: StudioGenerateRequest,
  signal: AbortSignal,
  fallbackWorkspaceRoot?: string | undefined,
): Promise<StudioGenerateResponse> {
  const active = resolveProvider(config)
  if (active.workflows.length === 0) {
    throw new Error('No ComfyUI workflows are imported. Import an API-format workflow JSON in Settings > Plugins > Arya Image Gen.')
  }
  const profile = describeStudio(config).providers.find(entry => entry.model === input.model)
  if (profile === undefined) throw new Error('The workflow list changed; refresh the workbench and pick a workflow again.')
  assertAllowed(profile, input)
  const workflow = selectComfyUIWorkflow(active, input.model)

  const rawRefs = input.references ?? (input.reference ? [input.reference] : [])
  if (input.mode === 'edit' && rawRefs.length === 0) {
    throw new Error('Image-to-image editing needs at least one reference image.')
  }
  const sourceImages = input.mode === 'edit'
    ? await Promise.all(rawRefs.map(ref => readStudioReference(ctx, ref, signal)))
    : []
  const startedAt = Date.now()
  const count = input.count ?? 1
  const jobId = input.jobId
  if (jobId !== undefined) {
    comfyProgress.ensure(jobId, { baseURL: active.baseURL, headers: active.headers, workflowJson: workflow.json })
  }
  const finishJob = (phase: 'done' | 'error' | 'cancelled', error?: string): void => {
    if (jobId !== undefined) comfyProgress.finish(jobId, phase, error)
  }

  const generateSingle = async (index: number): Promise<StudioGeneratedItem> => {
    const generated = input.mode === 'edit'
      ? await editComfyUIImage({
        baseURL: active.baseURL,
        headers: active.headers,
        workflowJson: workflow.json,
        prompt: promptWithPreset(workflow, input.prompt),
        sourceImage: { data: sourceImages[0]!.data, mediaType: sourceImages[0]!.mediaType },
        ...(jobId === undefined ? {} : { clientId: jobId }),
        timeoutMs: active.timeoutMs,
        maxBytes: ctx.attachments.imageLimits.maxImageBytes,
        signal,
        ...studioParams(input),
      })
      : await generateComfyUIImage({
        baseURL: active.baseURL,
        headers: active.headers,
        workflowJson: workflow.json,
        prompt: promptWithPreset(workflow, input.prompt),
        ...(jobId === undefined ? {} : { clientId: jobId }),
        timeoutMs: active.timeoutMs,
        maxBytes: ctx.attachments.imageLimits.maxImageBytes,
        signal,
        ...studioParams(input),
      })
    if (!ctx.attachments.imageLimits.mediaTypes.includes(generated.mediaType)) {
      throw new Error(`This DSH deployment does not accept ${generated.mediaType} generated images`)
    }
    const attachment = await ctx.attachments.saveImage({
      data: generated.data,
      mediaType: generated.mediaType,
      name: count > 1 ? `studio-image-${index + 1}` : 'studio-image',
    })
    // Studio generation is temporary on canvas; workspace persistence happens
    // when the user collects the result into the gallery.
    const timings = generated.timings ?? { queueAhead: 0, queueMs: 0, execMs: 0, totalMs: 0 }
    return {
      attachment,
      output: [workflow.name, `${String(attachment.width)}x${String(attachment.height)}`, `seed ${String(generated.seed)}`,
        `queued ${seconds(timings.queueMs)}`, `ran ${seconds(timings.execMs)}`,
        ...(generated.comfyVersion === undefined ? [] : [`ComfyUI ${generated.comfyVersion}`])].join(' · '),
      seed: generated.seed,
      workflow: workflow.name,
      queueMs: timings.queueMs,
      execMs: timings.execMs,
      totalMs: timings.totalMs,
      queueAhead: timings.queueAhead,
      ...(generated.comfyVersion === undefined ? {} : { comfyVersion: generated.comfyVersion }),
    }
  }

  if (count === 1) {
    const single = await generateSingle(0)
    finishJob('done')
    return {
      attachment: single.attachment,
      output: single.output,
      provider: 'comfyui',
      model: workflow.name,
      prompt: input.prompt,
      createdAt: Date.now(),
      elapsedMs: Date.now() - startedAt,
      requestedCount: 1,
      failedCount: 0,
      items: [single],
      ...(single.seed === undefined ? {} : { seed: single.seed }),
      ...(single.savedTo === undefined ? {} : { savedTo: single.savedTo }),
    }
  }

  const tasks = Array.from({ length: count }, (_, i) => () => generateSingle(i))
  const poolResults = await runPool(tasks, 2)
  const successes: StudioGeneratedItem[] = []
  const errors: Array<{ index: number; message: string }> = []

  for (let i = 0; i < poolResults.length; i++) {
    const r = poolResults[i]!
    if (r.status === 'fulfilled') {
      successes.push(r.value)
    } else {
      errors.push({
        index: i,
        message: r.reason instanceof Error ? r.reason.message : String(r.reason),
      })
    }
  }

  if (successes.length === 0) {
    const firstReason = poolResults[0] && poolResults[0].status === 'rejected' ? poolResults[0].reason : new Error('Every image in the batch failed.')
    throw firstReason instanceof Error ? firstReason : new Error(String(firstReason))
  }

  const first = successes[0]!
  finishJob('done')
  return {
    attachment: first.attachment,
    output: first.output,
    provider: 'comfyui',
    model: workflow.name,
    prompt: input.prompt,
    createdAt: Date.now(),
    elapsedMs: Date.now() - startedAt,
    requestedCount: count,
    failedCount: errors.length,
    items: successes,
    ...(first.seed === undefined ? {} : { seed: first.seed }),
    ...(errors.length > 0 ? { errors } : {}),
    ...(first.savedTo === undefined ? {} : { savedTo: first.savedTo }),
  }
}

export async function runPool<T>(
  tasks: Array<() => Promise<T>>,
  concurrency = 2,
): Promise<PromiseSettledResult<T>[]> {
  const results = new Array<PromiseSettledResult<T>>(tasks.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const currentIndex = nextIndex++
      const task = tasks[currentIndex]!
      try {
        const val = await task()
        results[currentIndex] = { status: 'fulfilled', value: val }
      } catch (err) {
        results[currentIndex] = { status: 'rejected', reason: err }
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker(),
  )
  await Promise.all(workers)
  return results
}

function seconds(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(1)}s`
}

function promptWithPreset(workflow: { presetPrompt?: string }, prompt: string): string {
  const preset = workflow.presetPrompt
  if (preset === undefined || preset.trim().length === 0) return prompt
  return `${preset.trim().replace(/[,;\s]+$/, '')}, ${prompt.trim()}`
}

export const STUDIO_TIMEOUT_MS = DEFAULT_COMFYUI_TIMEOUT_MS

/** Validate one workbench request against the current profile set. */
function assertAllowed(profile: StudioProviderProfile, input: StudioGenerateRequest): void {
  if (!profile.modelOptions.some(option => option.value === input.model)) throw new Error('The workflow list changed; refresh the workbench and pick a workflow again.')
  if (input.mode === 'edit' && !profile.supportsEditing) {
    throw new Error(`The workflow "${profile.model}" has no ${COMFYUI_IMAGE_PLACEHOLDER} image input, so it cannot run image-to-image. Import an edit workflow for that.`)
  }
}

async function readStudioReference(
  ctx: Context,
  reference: StudioReference | undefined,
  signal: AbortSignal,
): Promise<{ data: Uint8Array; mediaType: ImageMediaType }> {
  if (reference === undefined) throw new Error('Image-to-image editing needs at least one reference image.')
  if ('attachment' in reference) {
    const stored: StoredImageAttachment = await ctx.attachments.readImage(reference.attachment, signal)
    return { data: stored.data, mediaType: stored.ref.mediaType }
  }
  const data = decodeCanonicalBase64(reference.data)
  if (data.byteLength > ctx.attachments.imageLimits.maxImageBytes) throw new Error('The reference image exceeds this DSH deployment\'s size limit.')
  await ctx.attachments.validateImage({ data, mediaType: reference.mediaType, ...(reference.name === undefined ? {} : { name: reference.name }) })
  return { data, mediaType: reference.mediaType }
}

function decodeCanonicalBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) throw new Error('The reference image encoding is invalid.')
  const data = Buffer.from(value, 'base64')
  if (data.byteLength === 0 || data.toString('base64') !== value) throw new Error('The reference image encoding is invalid.')
  return new Uint8Array(data)
}

export const STUDIO_PROVIDER_LABEL = PROVIDER_DISPLAY_NAMES.comfyui
