/** Local-ComfyUI image-generation Bundle for DeepSeek Harness. */
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { SettingsForms } from '@deepseek-ai/dsh-settings'
import { defineTool, type ToolResult } from '@deepseek-ai/dsh-tools'
import { Config, resolveProvider, selectWorkflowForRole, type ImageProvider } from './config.js'
import { CanvasMirror } from './canvas-state.js'
import { serveCanvasState } from './canvas-state-route.js'
import { serveCanvasAsset } from './canvas-asset-route.js'
import { CANVAS_ASSET_ROUTE, COMFYUI_PROGRESS_ROUTE, COMFYUI_SERVER_ROUTE } from './shared.js'
import { registerCanvasTools, resolveCanvasSelectionReferences } from './canvas-tools.js'
import { comfyUIServerConfigOf, ComfyUIServerManager } from './comfyui-server.js'
import { editComfyUIImage, generateComfyUIImage, type ComfyUIJobTimings } from './comfyui.js'
import { IMAGE_ROUTE, DELETE_ROUTE, SAVE_WORKSPACE_ROUTE, imageAttachmentFromMeta, serveImage, serveDelete, serveSaveWorkspace } from './image-route.js'
import { serveImport } from './import-route.js'
import { type ResolvedReferenceImage, resolveReferenceImages } from './reference-image.js'
import { CANVAS_STATE_ROUTE, CHECK_WORKFLOWS_ROUTE, IMAGE_GENERATION_NAMESPACE, IMAGE_TOOL_NAMES, IMPORT_ROUTE, INSPIRATION_ROUTE, RENDER_HEALTH_ROUTE, RENDER_ROUTE, STUDIO_ROUTE, describeWorkflowCatalog, isLocalComfyUIEndpoint, mergeComfyUIPrompt, progressJobIdForCall, resolveComfyUIWorkflows, type ComfyUIGenerationParams, type ComfyUIServerStatus } from './shared.js'
import { createInspirationRoute } from './inspiration-route.js'
import { BUNDLED_INSPIRATION_CATALOG, searchInspirationCases } from './inspiration.js'
import { describeStudio, generateFromStudio } from './studio.js'
import { serveStudio } from './studio-route.js'
import { serveComfyUIServer } from './comfyui-server-route.js'
import { serveComfyUIProgress } from './progress-route.js'
import { comfyProgress } from './comfyui-progress.js'
import { describeSettingsHealth, serveSettingsHealth } from './settings-health.js'
import { SETTINGS_HEALTH_ROUTE, type SettingsHealth } from './shared.js'
import { deleteImageFromWorkspace, getDshWorkspaceRoots, getDshWorkspacesFull, saveImageToWorkspace } from './workspace-save.js'
import { imageToolContext } from './image-tool-context.js'
import { attachmentMeta, saveGenerated, type GeneratedValue } from './save-generated.js'
import { registerRenderTools } from './render-tools.js'
import { RENDER_LIMITS } from './render/render.js'
import { describeRenderer, renderFromStudio, rendererHealth } from './render-service.js'
import { serveRender } from './render-route.js'
import { checkWorkflowsAgainstInstall } from './validate-workflows.js'
import { buildAgentPresetDefinition } from './agent-preset/definition.js'
import { registerAgentPreset } from './agent-preset/register.js'

export { Config } from './config.js'
export { IMAGE_ROUTE, DELETE_ROUTE, SAVE_WORKSPACE_ROUTE, imageAttachmentFromMeta } from './image-route.js'
export { IMPORT_ROUTE } from './shared.js'
export { STUDIO_ROUTE } from './shared.js'
export { INSPIRATION_ROUTE } from './shared.js'
export { COMFYUI_SERVER_ROUTE, COMFYUI_PROGRESS_ROUTE } from './shared.js'
export { CANVAS_STATE_ROUTE } from './shared.js'

export const name = 'dsh-image-gen'
export const inject = ['tools', 'attachments']

/** Capped prompt hits for the find_inspiration tool; `total` counts all matches. */
interface InspirationSearchValue {
  total: number
  hits: { sourceId: string; id: string; title: string; category: string; prompt: string }[]
}

/**
 * Keep only the adjustable generation parameters a tool call actually supplied.
 *
 * The workflow decides which of them it accepts, so passing them all through is
 * safe: `prepareComfyUIWorkflow` rejects an undeclared parameter with a message
 * that names the workflow's fix.
 */
function generationParams(args: ComfyUIGenerationParams): ComfyUIGenerationParams {
  return {
    ...(typeof args.width === 'number' ? { width: args.width } : {}),
    ...(typeof args.height === 'number' ? { height: args.height } : {}),
    ...(typeof args.steps === 'number' ? { steps: args.steps } : {}),
    ...(typeof args.cfg === 'number' ? { cfg: args.cfg } : {}),
  }
}

/** Optional strings from tool callers may contain empty placeholders (#86). */function cleanImageToolArgs<T extends { prompt: string; workflow?: string }>(args: T): T {
  const clean = { ...args }
  const fields = clean as Record<string, unknown>
  for (const key of ['workflow']) {
    const value = fields[key]
    if (typeof value !== 'string') continue
    if (value.trim().length === 0) delete fields[key]
    else fields[key] = value.trim()
  }
  return clean
}

/** Ordered per-item outcomes for the generate_images batch tool. */
interface BatchGeneratedValue {
  images: (GeneratedValue & { prompt: string })[]
  failures: { index: number; prompt: string; error: string }[]
}

export function apply(ctx: Context, config: Config = {}): void {
  // DSH 0.1.7 resolves every `.volatile()` schema field into a stable box
  // whose `.get()` returns the current snapshot, so a settings edit lands
  // without restarting this fiber. Unbox on every read; older hosts hand
  // over plain values, which the same walk returns untouched.
  const plainConfig = (source: Config): Config => {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(source)) {
      out[key] = value !== null && typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function'
        ? (value as { get(): unknown }).get()
        : value
    }
    return out as Config
  }
  let current: () => Config = () => plainConfig(config)
  const knownWorkspaceRoots = new Set<string>()
  // Host-side mirror of the workbench infinite canvas: fed by the canvas-state
  // route, read by the canvas tools, the edit_image canvas_selection source,
  // and the system-prompt context. Session-scratch, never persisted.
  const canvasMirror = new CanvasMirror()
  // Local ComfyUI server lifecycle: spawn / stop / restart / probe.
  const serverManager = new ComfyUIServerManager(
    () => comfyUIServerConfigOf(current()),
    message => ctx.logger.warn(`dsh-image-gen: ${message}`),
  )

  const settingsHealth = installImageSettings(ctx, current(), {
    setSource: source => { current = () => plainConfig(source()) },
    onChange: () => {},
  })
  // A host surface, not a session one: the preset is registered once at boot
  // and withdrawn with this plugin's fiber. A composition without a preset
  // registry (headless, SDK) simply never sees it.
  if (current().agentPreset !== false) {
    registerAgentPreset(ctx, buildAgentPresetDefinition({ platform: process.platform }))
  }
  // Every HTTP surface needs webServer, which only the web-app bundle (web,
  // desktop) provides; the headless, acp and sdk profiles have none. Mount the
  // routes when it is present so the tools below still activate without it.
  ctx.inject(['webServer'], (webCtx: Context) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact', path: SETTINGS_HEALTH_ROUTE,
      handler: (req, res) => serveSettingsHealth(req, res, settingsHealth()),
    }), 'dsh-image-gen: settings health')
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact', path: IMAGE_ROUTE,
      handler: (req, res) => serveImage(req, res, { readImage: ref => ctx.attachments.readImage(ref) }),
    }), 'dsh-image-gen: image route')
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact', path: IMPORT_ROUTE,
      handler: (req, res) => serveImport(req, res, {
        saveImage: image => ctx.attachments.saveImage(image),
        maxImageBytes: ctx.attachments.imageLimits.maxImageBytes,
        mediaTypes: ctx.attachments.imageLimits.mediaTypes,
      }),
    }), 'dsh-image-gen: import route')
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact', path: DELETE_ROUTE,
      handler: (req, res) => serveDelete(req, res, {
        deleteWorkspaceImage: async filePath => {
          const discovered = await getDshWorkspaceRoots().catch(() => [])
          return deleteImageFromWorkspace(filePath, new Set([...knownWorkspaceRoots, ...discovered, process.cwd()]))
        },
      }),
    }), 'dsh-image-gen: delete route')
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact', path: SAVE_WORKSPACE_ROUTE,
      handler: (req, res) => serveSaveWorkspace(req, res, {
        readImage: ref => ctx.attachments.readImage(ref),
        saveToWorkspace: options => {
          if (options.workspaceRoot) {
            knownWorkspaceRoots.add(options.workspaceRoot)
          }
          return saveImageToWorkspace({
            workspaceRoot: options.workspaceRoot,
            folder: current().workspaceFolder,
            attachmentId: options.attachmentId,
            mediaType: options.mediaType,
            data: options.data,
          })
        },
        getActiveWorkspaceRoot: () => Array.from(knownWorkspaceRoots)[0] || process.cwd(),
        getAllowedWorkspaceRoots: async () => {
          const discovered = await getDshWorkspaceRoots().catch(() => [])
          return new Set([...knownWorkspaceRoots, ...discovered, process.cwd()])
        },
        isSaveEnabled: () => current().saveToWorkspace !== false,
      }),
    }), 'dsh-image-gen: save workspace route')
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact', path: COMFYUI_SERVER_ROUTE,
      handler: (req, res) => serveComfyUIServer(req, res, {
        status: () => serverManager.status(),
        start: () => serverManager.start(),
        stop: () => serverManager.stop(),
        restart: () => serverManager.restart(),
      }),
    }), 'dsh-image-gen: comfyui server route')
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix', path: COMFYUI_PROGRESS_ROUTE,
      handler: (req, res) => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
        return serveComfyUIProgress(req, res, {
          snapshot: jobId => comfyProgress.snapshot(jobId),
          subscribe: (jobId, listener) => comfyProgress.subscribe(jobId, listener),
          preview: jobId => comfyProgress.preview(jobId),
          cancel: jobId => comfyProgress.cancel(jobId),
        }, pathname.slice(COMFYUI_PROGRESS_ROUTE.length))
      },
    }), 'dsh-image-gen: comfyui progress route')
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact', path: CHECK_WORKFLOWS_ROUTE,
      handler: async (req, res) => {
        try {
          const active = resolveProvider(current())
          const checks = await checkWorkflowsAgainstInstall(resolveComfyUIWorkflows(current()), active.baseURL, active.headers)
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify({ checks }))
        } catch (error) {
          res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'workflow check failed' }))
        }
      },
    }), 'dsh-image-gen: workflow check route')
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact', path: RENDER_HEALTH_ROUTE,
      handler: async (req, res) => {
        try {
          const health = await rendererHealth(current())
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify(health))
        } catch (error) {
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'render-health-failed' }))
        }
      },
    }), 'dsh-image-gen: render health route')
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact', path: RENDER_ROUTE,
      handler: (req, res) => serveRender(req, res, {
        describe: () => describeRenderer(current()),
        render: (input, signal) => renderFromStudio(ctx, current(), input, signal, knownWorkspaceRoots),
        maxBodyBytes: Math.ceil(RENDER_LIMITS.maxMarkupBytes * 1.2),
      }),
    }), 'dsh-image-gen: render route')
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact', path: CANVAS_STATE_ROUTE,
      handler: (req, res) => serveCanvasState(req, res, {
        mirror: canvasMirror,
        // Base64 inflates the PNG by ~4/3; the slack covers the JSON envelope.
        maxBodyBytes: Math.ceil(ctx.attachments.imageLimits.maxImageBytes * 1.4) + 256 * 1024,
        maxImageBytes: ctx.attachments.imageLimits.maxImageBytes,
      }),
    }), 'dsh-image-gen: canvas state route')
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact', path: CANVAS_ASSET_ROUTE,
      handler: (req, res) => serveCanvasAsset(req, res, {
        maxImageBytes: ctx.attachments.imageLimits.maxImageBytes,
        saveImage: image => ctx.attachments.saveImage(image),
      }),
    }), 'dsh-image-gen: canvas asset route')
  })
  // A few lines of live canvas context per model request. The service is an
  // optional dependency: hosts without dsh-system-prompt boot unchanged and
  // the canvas tools remain the model's way to discover the canvas.
  ctx.inject(['systemPrompt'], (promptCtx: Context) => {
    promptCtx.effect(() => promptCtx.systemPrompt.context({
      name: 'dsh-image-gen:image-defaults',
      order: 59,
      text: () => imageToolContext(current()),
    }), 'dsh-image-gen: image tool context')
    promptCtx.effect(() => promptCtx.systemPrompt.context({
      name: 'dsh-image-gen:canvas',
      order: 60,
      text: () => canvasMirror.digest(),
    }), 'dsh-image-gen: canvas context')
  })
  // HTML and SVG rendering: same attachment path as a generated image, with a
  // browser instead of a diffusion workflow behind it.
  registerRenderTools(ctx, { config: current, knownRoots: knownWorkspaceRoots })
  registerCanvasTools(ctx, canvasMirror, {
    // Materialization hook: view_canvas persists a screenshot only when the
    // model actually views it. The content-addressed store dedupes repeat
    // views, and dead screenshots never reach the disk.
    persistSelectionImage: image => ctx.attachments.saveImage({ data: image.data, mediaType: image.mediaType, name: 'canvas-selection' }),
  })
  ctx.inject(['webServer'], (webCtx: Context) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact', path: STUDIO_ROUTE,
      handler: (req, res) => serveStudio(req, res, {
        describe: async () => {
          const base = describeStudio(current())
          const workspaces = await getDshWorkspacesFull().catch(() => [])
          const activeRoot = Array.from(knownWorkspaceRoots)[0] || workspaces[0]?.path || process.cwd()
          return {
            ...base,
            workspaceRoot: activeRoot,
            workspaces,
          }
        },
        generate: (input, signal) => {
          return generateFromStudio(ctx, current(), input, signal)
        },
        maxBodyBytes: Math.ceil(ctx.attachments.imageLimits.maxImageBytes * 1.4 * 5) + 256 * 1024,
        ...(current().comfyuiTimeoutMs === undefined ? {} : { timeoutMs: current().comfyuiTimeoutMs }),
      }),
    }), 'dsh-image-gen: studio route')
    const serveInspiration = createInspirationRoute()
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix', path: INSPIRATION_ROUTE,
      handler: (req, res) => {
        const originalUrl = req.url ?? '/'
        req.url = originalUrl.startsWith(INSPIRATION_ROUTE) ? originalUrl.slice(INSPIRATION_ROUTE.length) || '/' : originalUrl
        return serveInspiration(req, res)
      },
    }), 'dsh-image-gen: inspiration route')
  })

  // Auto-start opt-in: launch the configured server once at boot when it is
  // down. Fire-and-forget; a failing start is logged, never fatal. Deferred so
  // the fiber finishes wiring routes before the (slow) start poll begins.
  if (current().comfyuiAutoStart === true) {
    const bootTimer = setTimeout(() => {
      void (async () => {
        try {
          if (!isLocalComfyUIEndpoint(current().comfyuiBaseURL ?? '')) return
          const status = await serverManager.status()
          if (status.up) return
          await serverManager.start()
        } catch (error) {
          ctx.logger.warn(`dsh-image-gen: ComfyUI auto-start failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      })()
    }, 250)
    bootTimer.unref?.()
  }

  /** One ComfyUI generation, shared by generate_image and generate_images. */
  const generateSingle = async (rawArgs: ComfyUIGenerationParams & { prompt: string; workflow?: string }, exec: { callId?: string; agent?: { session: { header: { cwd?: string } } }; signal: AbortSignal }): Promise<GeneratedValue> => {
    const args = cleanImageToolArgs(rawArgs)
    const active = resolveProvider(current())
    const workflow = selectWorkflowForRole(current(), 'text-to-image', args.workflow)
    const jobId = typeof exec.callId === 'string' && exec.callId.length > 0 ? progressJobIdForCall(exec.callId) : undefined
    if (jobId !== undefined) comfyProgress.ensure(jobId, { baseURL: active.baseURL, headers: active.headers, workflowJson: workflow.json })
    let generated: Awaited<ReturnType<typeof generateComfyUIImage>>
    try {
      generated = await generateComfyUIImage({
        baseURL: active.baseURL,
        headers: active.headers,
        workflowJson: workflow.json,
        prompt: mergeComfyUIPrompt(workflow.presetPrompt, args.prompt),
        timeoutMs: active.timeoutMs,
        maxBytes: ctx.attachments.imageLimits.maxImageBytes,
        signal: exec.signal,
        ...generationParams(args),
        ...(jobId === undefined ? {} : { clientId: jobId }),
      })
    } catch (error) {
      if (jobId !== undefined) comfyProgress.finish(jobId, 'error', error instanceof Error ? error.message : String(error))
      throw error
    }
    if (jobId !== undefined) comfyProgress.finish(jobId, 'done')
    return saveGenerated(ctx, generated, 'comfyui', workflow.name, workflow.name, current(), exec, knownWorkspaceRoots)
  }

  ctx.tools.register(defineTool({
    name: IMAGE_TOOL_NAMES.generateImage,
    description: 'Generate a new image with the configured local ComfyUI workflow. Use when the user asks to create or draw a new image; use edit_image instead when they want to change an existing image. Give a complete visual prompt including subject, composition, style, lighting, and any exact text that should appear. The workflow defines the output size; the optional workflow argument picks a configured workflow for this call only when the user asks for a specific one. A successful image is attached directly to the conversation and may also be saved under the session workspace. Do not call read, glob, or other tools to locate or verify the image.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Complete description of the image to generate.' },
      workflow: { type: 'string', description: 'Optional name of the ComfyUI workflow to run; omit to use the active text-to-image workflow from settings.' },
      width: { type: 'integer', description: 'Optional output width in pixels, when the workflow declares {{width}}.' },
      height: { type: 'integer', description: 'Optional output height in pixels, when the workflow declares {{height}}.' },
      steps: { type: 'integer', description: 'Optional sampling steps, when the workflow declares {{steps}}.' },
      cfg: { type: 'number', description: 'Optional cfg scale, when the workflow declares {{cfg}}.' },
    },
    output: imageOutput('Generated'),
    async execute(args, exec): Promise<GeneratedValue> {
      return generateSingle(args, exec)
    },
    presentResult: (_args, result) => imagePresentation(result),
  }))

  ctx.tools.register(defineTool({
    name: IMAGE_TOOL_NAMES.generateImages,
    description: 'Generate several images in one call, one per prompt, in order. Use for batches, variations, or illustration sets; prefer generate_image for a single image. Every successful image is attached to the conversation and may be saved under the session workspace. Items generate sequentially; a failed item is reported in the failures list and does not abort the rest. The optional workflow argument applies to every item.',
    parameters: {
      prompts: { type: 'array', items: { type: 'string' }, required: true, description: 'Ordered complete prompts; one image is generated per entry (1-10).' },
      workflow: { type: 'string', description: 'Optional name of the ComfyUI workflow to run; omit to use the active text-to-image workflow from settings.' },
      width: { type: 'integer', description: 'Optional output width applied to every item, when the workflow declares {{width}}.' },
      height: { type: 'integer', description: 'Optional output height applied to every item, when the workflow declares {{height}}.' },
      steps: { type: 'integer', description: 'Optional sampling steps, when the workflow declares {{steps}}.' },
      cfg: { type: 'number', description: 'Optional cfg scale, when the workflow declares {{cfg}}.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false, properties: {
          images: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
            attachment: { type: 'object', required: true, additionalProperties: false, properties: {
              attachmentId: { type: 'string', required: true }, mediaType: { type: 'string', required: true }, bytes: { type: 'integer', required: true }, width: { type: 'integer', required: true }, height: { type: 'integer', required: true }, name: { type: 'string' }, originalDimensions: { type: 'object', additionalProperties: false, properties: { width: { type: 'integer', required: true }, height: { type: 'integer', required: true } } },
            } },
            provider: { type: 'string', required: true }, model: { type: 'string', required: true }, output: { type: 'string', required: true }, savedTo: { type: 'string' }, saveError: { type: 'string' }, seed: { type: 'integer' }, width: { type: 'integer' }, height: { type: 'integer' }, bytes: { type: 'integer' }, queueMs: { type: 'integer' }, execMs: { type: 'integer' }, totalMs: { type: 'integer' }, queueAhead: { type: 'integer' }, comfyVersion: { type: 'string' }, prompt: { type: 'string', required: true },
          } } },
          failures: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
            index: { type: 'integer', required: true }, prompt: { type: 'string', required: true }, error: { type: 'string', required: true },
          } } },
        },
      },
      render: (_args: unknown, value: BatchGeneratedValue) => [
        {
          type: 'text' as const,
          text: `Generated ${String(value.images.length)} of ${String(value.images.length + value.failures.length)} images.\n${value.failures.map(failure => `${failure.prompt.slice(0, 80)} — failed: ${failure.error}`).join('\n')}`,
        },
        ...value.images.flatMap(image => imageOutput('Generated').render({}, image).map(block =>
          block.type === 'text' ? { ...block, text: `${block.text}\nImage prompt: ${image.prompt}` } : block)),
      ],
      presentationMeta: (_args: unknown, value: BatchGeneratedValue) => ({
        kind: 'dsh-image-gen-batch',
        images: value.images.map(image => imageOutput('Generated').presentationMeta({ prompt: image.prompt }, image)),
      }),
    },
    async execute(args, exec): Promise<BatchGeneratedValue> {
      if (args.prompts.length === 0) throw new Error('generate_images requires at least one prompt')
      if (args.prompts.length > 10) throw new Error(`generate_images accepts at most 10 prompts per call (got ${String(args.prompts.length)}); split larger batches into several calls`)
      const images: BatchGeneratedValue['images'] = []
      const failures: BatchGeneratedValue['failures'] = []
      for (const [index, prompt] of args.prompts.entries()) {
        if (exec.signal.aborted) {
          failures.push({ index, prompt, error: 'aborted before this image started' })
          continue
        }
        try {
          const value = await generateSingle({
            prompt,
            ...(args.workflow !== undefined ? { workflow: args.workflow } : {}),
            ...generationParams(args),
          }, exec)
          images.push({ ...value, prompt })
        } catch (error) {
          failures.push({ index, prompt, error: error instanceof Error ? error.message : String(error) })
        }
      }
      return { images, failures }
    },
    presentResult: (_args, result) => imagePresentation(result),
  }))

  ctx.tools.register(defineTool({
    name: IMAGE_TOOL_NAMES.editImage,
    description: 'Edit, combine, or restyle an existing image with the configured local ComfyUI workflow. Images attached inline to the latest human message are already readable DSH attachments even when no workspace file exists. In that case, call edit_image immediately with prompt only; NEVER call read_image, glob, or shell to locate them, and NEVER invent @ paths. All inline images will be used in upload order. For specific older conversation images use source_attachment_id or source_attachment_ids; both canonical sha256: IDs and full bare SHA-256 digests are accepted. For files the user explicitly names in the workspace use source_path or source_paths. For what the user selected or drew on the image-gen workbench canvas (for example a hand-drawn sketch) use source=canvas_selection; canvas_state can verify a selection exists first. Provide exactly one selector field. Without a selector, images from the latest human message take priority; only when that message has no images does editing fall back to the newest conversation image. ComfyUI edits run one source image per call against a workflow with an image input. When the user wants a person, character, or object from the reference images kept as the same identity, write short hard identity-preservation instructions (use the same subject from the references; do not redesign it or synthesize a similar-looking replacement; change only scene, clothing, pose, lighting, style, or composition) instead of long generic appearance descriptions, which make the model replace the subject with a synthesized lookalike.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Describe the changes to make while preserving everything else that should remain.' },
      source: { type: 'string', enum: ['canvas_selection'], description: 'Use the current selection on the image-gen workbench infinite canvas as the reference image(s): full-resolution originals when the selection is conversation-generated images, plus a screenshot of the whole selection when it also contains other content (hand-drawn strokes, pasted images). Choose this when the user refers to what they selected or drew on the canvas; combine with no other selector field.' },
      source_attachment_id: { type: 'string', description: 'Optional attachment id of a specific image already present in the current conversation.' },
      source_attachment_ids: { type: 'array', items: { type: 'string' }, description: 'Optional ordered attachment ids of multiple images already present in the current conversation. Prompt references such as image 1 and image 2 follow this order. ComfyUI edits the first image.' },
      source_path: { type: 'string', description: 'Optional absolute or workspace-relative path of a specific image file inside the active session workspace. Prefer this when the user names a saved file.' },
      source_paths: { type: 'array', items: { type: 'string' }, description: 'Optional ordered absolute paths of multiple image files inside the active session workspace. ComfyUI edits the first image.' },
      workflow: { type: 'string', description: 'Optional name of the ComfyUI edit workflow to run (one with an image input); omit to use the active image-to-image workflow.' },
      width: { type: 'integer', description: 'Optional output width in pixels, when the edit workflow declares {{width}}.' },
      height: { type: 'integer', description: 'Optional output height in pixels, when the edit workflow declares {{height}}.' },
      steps: { type: 'integer', description: 'Optional sampling steps, when the edit workflow declares {{steps}}.' },
      cfg: { type: 'number', description: 'Optional cfg scale, when the edit workflow declares {{cfg}}.' },
    },
    output: imageOutput('Edited'),
    async execute(rawArgs, exec): Promise<GeneratedValue> {
      const args = cleanImageToolArgs(rawArgs)
      const active = resolveProvider(current())
      const canvasSelection = args.source === 'canvas_selection'
      if (canvasSelection && (
        args.source_attachment_id !== undefined
        || Array.isArray(args.source_attachment_ids)
        || args.source_path !== undefined
        || Array.isArray(args.source_paths)
      )) {
        throw new Error('edit_image source=canvas_selection cannot be combined with source_attachment_id, source_attachment_ids, source_path, or source_paths; provide exactly one selector')
      }
      const sourceImages: ResolvedReferenceImage[] = canvasSelection
        ? await resolveCanvasSelectionReferences({
          mirror: canvasMirror,
          attachments: ctx.attachments,
          ...(exec.agent === undefined ? {} : { agent: exec.agent }),
          maxBytes: ctx.attachments.imageLimits.maxImageBytes,
          signal: exec.signal,
        })
        : await resolveReferenceImages({
          ...(exec.agent === undefined ? {} : { agent: exec.agent }),
          attachments: ctx.attachments,
          ...(typeof args.source_attachment_id === 'string' ? { sourceAttachmentId: args.source_attachment_id } : {}),
          ...(Array.isArray(args.source_attachment_ids) ? { sourceAttachmentIds: args.source_attachment_ids } : {}),
          ...(typeof args.source_path === 'string' ? { sourcePath: args.source_path } : {}),
          ...(Array.isArray(args.source_paths) ? { sourcePaths: args.source_paths } : {}),
          maxBytes: ctx.attachments.imageLimits.maxImageBytes,
          signal: exec.signal,
        })

      if (sourceImages.length > 1) {
        throw new Error(`ComfyUI edit_image supports exactly one source image per call; this call resolved ${String(sourceImages.length)} images. Call edit_image again with source_attachment_id set to the single attachment ID of the image to edit.`)
      }
      const sourceImage = sourceImages[0]
      if (sourceImage === undefined) throw new Error('edit_image requires a reference image')
      const workflow = selectWorkflowForRole(current(), 'image-to-image', args.workflow)
      const jobId = typeof exec.callId === 'string' && exec.callId.length > 0 ? progressJobIdForCall(exec.callId) : undefined
      if (jobId !== undefined) comfyProgress.ensure(jobId, { baseURL: active.baseURL, headers: active.headers, workflowJson: workflow.json })
      let generated: Awaited<ReturnType<typeof editComfyUIImage>>
      try {
        generated = await editComfyUIImage({
          baseURL: active.baseURL,
          headers: active.headers,
          workflowJson: workflow.json,
          prompt: mergeComfyUIPrompt(workflow.presetPrompt, args.prompt),
          sourceImage: { data: sourceImage.data, mediaType: sourceImage.mediaType },
          timeoutMs: active.timeoutMs,
          maxBytes: ctx.attachments.imageLimits.maxImageBytes,
          signal: exec.signal,
          ...generationParams(args as ComfyUIGenerationParams & { prompt: string }),
          ...(jobId === undefined ? {} : { clientId: jobId }),
        })
      } catch (error) {
        if (jobId !== undefined) comfyProgress.finish(jobId, 'error', error instanceof Error ? error.message : String(error))
        throw error
      }
      if (jobId !== undefined) comfyProgress.finish(jobId, 'done')
      return saveGenerated(ctx, generated, 'comfyui', workflow.name, workflow.name, current(), exec, knownWorkspaceRoots)
    },
    presentResult: (_args, result) => imagePresentation(result),
  }))

  ctx.tools.register(defineTool({
    name: IMAGE_TOOL_NAMES.listWorkflows,
    description: 'List the configured ComfyUI workflows: each one\'s role (text-to-image or image-to-image), which parameters a call may set (width, height, steps, cfg), the size it bakes when fixed, and which one each role picks by default. Call it when the user asks for a particular look, speed or task (a cutout, a background removal, a specific size) so the workflow argument names one deliberately instead of inheriting whatever was active.',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false, properties: {
          workflows: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
            name: { type: 'string', required: true },
            role: { type: 'string', required: true },
            adjustable: { type: 'object', required: true, additionalProperties: false, properties: {
              width: { type: 'boolean', required: true }, height: { type: 'boolean', required: true },
              steps: { type: 'boolean', required: true }, cfg: { type: 'boolean', required: true },
            } },
            bakedSize: { type: 'object', additionalProperties: false, properties: {
              width: { type: 'integer', required: true }, height: { type: 'integer', required: true },
            } },
            active: { type: 'boolean', required: true },
          } } },
        },
      },
      render: (_args: unknown, value: { workflows: { name: string; role: string; adjustable: Record<string, boolean>; bakedSize?: { width: number; height: number }; active: boolean }[] }) => [{
        type: 'text' as const,
        text: value.workflows.map(entry => {
          const params = Object.entries(entry.adjustable).filter(([, on]) => on).map(([key]) => key)
          const size = params.includes('width') ? 'adjustable size' : entry.bakedSize === undefined ? 'size baked' : `${String(entry.bakedSize.width)}x${String(entry.bakedSize.height)}`
          return `${entry.name} [${entry.role}] ${size}${params.length > 0 ? ` (${params.join(', ')})` : ''}${entry.active ? ' — default' : ''}`
        }).join('\n'),
      }],
    },
    async execute(): Promise<{ workflows: ReturnType<typeof describeWorkflowCatalog> }> {
      return { workflows: describeWorkflowCatalog(current()) }
    },
  }))

  ctx.tools.register(defineTool({
    name: IMAGE_TOOL_NAMES.findInspiration,
    description: 'Search the bundled inspiration libraries for ready-made image prompts: the handdraw-style cookbook (style, layout, and theme-color sections) plus the awesome-gpt-image-2 example set. Use before generate_image whenever the user wants a specific art style, layout template, or theme color, mentions a numbered style like "style #123", or asks for reference/example prompts. Each hit carries a full prompt reusable with generate_image; handdraw style prompts contain a TOPIC placeholder to replace with the user\'s subject, and may be combined with a layout and a theme-color prompt.',
    parameters: {
      query: { type: 'string', description: 'Keyword matched against titles, prompts, categories, and style/scene tags. Omit to sample what a library offers.' },
      category: { type: 'string', description: 'Optional exact category filter, for example "Style · Japanese authors / contemporary illustration", "Layout · infographic", or "Mono · neutral palette".' },
      source: { type: 'string', enum: ['handraw-style', 'awesome-gpt-image-2'], description: 'Optional single library to search; omit to search both.' },
      limit: { type: 'integer', description: 'Optional maximum number of hits to return, 1-20 (default 8).' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false, properties: {
          total: { type: 'integer', required: true },
          hits: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
            sourceId: { type: 'string', required: true },
            id: { type: 'string', required: true },
            title: { type: 'string', required: true },
            category: { type: 'string', required: true },
            prompt: { type: 'string', required: true },
          } } },
        },
      },
      render: (_args: unknown, value: InspirationSearchValue) => [{
        type: 'text' as const,
        text: `${String(value.hits.length)} of ${String(value.total)} matching inspiration cases.\n\n${value.hits.map(hit => `[${hit.sourceId} · ${hit.category}] ${hit.title}\n${hit.prompt}`).join('\n\n')}`,
      }],
    },
    async execute(args): Promise<InspirationSearchValue> {
      const { total, hits } = searchInspirationCases(BUNDLED_INSPIRATION_CATALOG, {
        query: args.query ?? '',
        sourceId: args.source,
        category: args.category,
        limit: args.limit,
      })
      return { total, hits: hits.map(({ sourceId, id, title, category, prompt }) => ({ sourceId, id, title, category, prompt })) }
    },
  }))
}

function imageOutput(verb: 'Generated' | 'Edited') {
  return {
    schema: {
      type: 'object', additionalProperties: false, properties: {
        attachment: { type: 'object', required: true, additionalProperties: false, properties: {
          attachmentId: { type: 'string', required: true }, mediaType: { type: 'string', required: true }, bytes: { type: 'integer', required: true }, width: { type: 'integer', required: true }, height: { type: 'integer', required: true }, name: { type: 'string' }, originalDimensions: { type: 'object', additionalProperties: false, properties: { width: { type: 'integer', required: true }, height: { type: 'integer', required: true } } },
        } },
        provider: { type: 'string', required: true }, model: { type: 'string', required: true }, output: { type: 'string', required: true }, savedTo: { type: 'string' }, saveError: { type: 'string' }, seed: { type: 'integer' }, width: { type: 'integer' }, height: { type: 'integer' }, bytes: { type: 'integer' }, queueMs: { type: 'integer' }, execMs: { type: 'integer' }, totalMs: { type: 'integer' }, queueAhead: { type: 'integer' }, comfyVersion: { type: 'string' },
      },
    },
    render: (_args: unknown, value: GeneratedValue) => {
      const saved = typeof value.savedTo === 'string' ? ` It was also saved to the workspace as ${value.savedTo}.` : typeof value.saveError === 'string' ? ` Saving it to the workspace failed: ${value.saveError}.` : ' It has no local file path.'
      const action = verb === 'Generated' ? 'It is already attached to the conversation.' : 'The edited image is attached to the conversation.'
      return [
        { type: 'text' as const, text: `${verb} one image with ${value.provider}/${value.model} (${value.output}). Attachment ID: ${String(value.attachment.attachmentId)}. ${action}${saved} Respond to the user without reading or searching for the image.` },
        { type: 'image' as const, attachment: value.attachment },
      ]
    },
    presentationMeta: (args: unknown, value: GeneratedValue) => ({
      kind: 'dsh-image-gen', attachment: attachmentMeta(value.attachment), provider: value.provider, model: value.model, output: value.output,
      ...(verb === 'Edited' ? { operation: 'edit' } : {}),
      ...(typeof value.savedTo === 'string' ? { savedTo: value.savedTo } : {}),
      ...(typeof value.seed === 'number' ? { seed: value.seed } : {}),
      ...(typeof value.queueMs === 'number' ? { queueMs: value.queueMs, execMs: value.execMs, totalMs: value.totalMs } : {}),
      ...(typeof value.queueAhead === 'number' ? { queueAhead: value.queueAhead } : {}),
      ...(value.comfyVersion === undefined ? {} : { comfyVersion: value.comfyVersion }),
      prompt: (args as { prompt: string }).prompt,
    }),
  } as const
}

function imagePresentation(result: ToolResult) {
  const meta = result.meta
  if (typeof meta === 'object' && meta !== null && !Array.isArray(meta)
    && meta.kind === 'dsh-image-gen-batch' && Array.isArray(meta.images)) {
    const content = meta.images.flatMap(image => {
      const attachment = imageAttachmentFromMeta(image)
      return attachment === undefined ? [] : [{ type: 'image' as const, attachment }]
    })
    return content.length === 0 ? undefined : { card: 'generic' as const, title: 'Generated images', content }
  }
  const attachment = imageAttachmentFromMeta(result.meta)
  return attachment === undefined ? undefined : { card: 'generic' as const, title: 'Generated image', content: [{ type: 'image' as const, attachment }] }
}

/** Settings hooks shape shared by both dsh-settings API generations. */
interface SettingsHooks {
  setSource: (source: () => Config) => void
  onChange: () => void
}

/** The `settings` Context service as typed by dsh-settings 0.1.2–0.1.6. */
interface SettingsSectionInstaller {
  installSection(ctx: Context, namespace: unknown, schema: unknown, entry: unknown, hooks: SettingsHooks): void
}

/**
 * Wire the settings namespace across both dsh-settings API generations.
 * The probe reads the HOST's `settings` service, never the bundled
 * dsh-settings module: the build inlines that module, so its exports always
 * look like the compile-time generation while only the service handed to this
 * fiber reflects the running host. dsh-settings 0.1.2–0.1.6 put `installSection`
 * on the service, so the namespace registers through it; DSH 0.1.7 replaced it
 * with schema-derived forms served by the loader itself (keyed by entry id),
 * so its service carries no installer and a host without any settings service
 * simply never runs the callback. A modern host with an unmarked schema is
 * incompatible and must be diagnosed, while old hosts keep their installer.
 */
function installImageSettings(ctx: Context, config: Config, hooks: SettingsHooks): () => SettingsHealth {
  let service: unknown
  ctx.inject(['settings'], settingsCtx => {
    const settings = settingsCtx.settings as SettingsForms & Partial<SettingsSectionInstaller>
    service = settings
    const health = describeSettingsHealth(settings, Config)
    if (health.settings === 'live' && !health.liveSchema) {
      ctx.logger.warn('dsh-image-gen: the loaded schema lacks volatile fields required by this DSH settings service. Install @deepseek-ai/schemastery >=3.18.4 <4 in the plugin profile and check which copy the plugin resolves; settings cannot be saved with this schema.')
    }
    if (typeof settings.installSection === 'function') {
      settings.installSection(ctx, IMAGE_GENERATION_NAMESPACE, Config, config, hooks)
    }
    return () => { service = undefined }
  })
  return () => describeSettingsHealth(service, Config)
}

/** Re-exported for the server-control route's typed status payload. */
export type { ComfyUIServerStatus }
