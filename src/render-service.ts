/**
 * Renderer state and the workbench render path.
 *
 * `describeRenderer` answers "can this machine render, and what templates
 * exist" without starting a browser; `renderFromStudio` renders one request and
 * lands it in the same attachment/workspace pipeline as every other image.
 *
 * @module dsh-arya-image-gen/render-service
 */
import type { Context } from '@deepseek-ai/cordis'
import { resolveRenderDefaults, type Config } from './config.js'
import { probeBrowser } from './render/browser.js'
import { renderToPng, RenderError } from './render/render.js'
import { fillTemplate, RENDER_TEMPLATES } from './render/templates.js'
import { saveGenerated } from './save-generated.js'
import type { RenderConfigResponse, RenderHealth, StudioRenderRequest, StudioRenderResponse } from './shared.js'

/** Capability probe shared by the health route and the workbench config. */
export async function describeRenderer(config: Config): Promise<RenderConfigResponse> {
  return {
    health: await rendererHealth(config),
    defaults: resolveRenderDefaults(config),
    templates: RENDER_TEMPLATES.map(template => ({
      id: template.id,
      label: template.label,
      description: template.description,
      width: template.width,
      height: template.height,
      slots: template.slots,
    })),
  }
}

/** Whether a usable browser exists, and which one. */
export async function rendererHealth(config: Config): Promise<RenderHealth> {
  const browser = await probeBrowser({ explicitPath: config.renderBrowserPath })
  if (browser === undefined) return { available: false }
  return {
    available: true,
    path: browser.path,
    family: browser.family,
    ...(browser.version.length === 0 ? {} : { version: browser.version }),
  }
}

/**
 * Render one workbench request.
 *
 * @param ctx - host context with the attachment store.
 * @param config - current plugin configuration.
 * @param input - validated render request.
 * @param signal - cancellation from the HTTP connection.
 * @param knownRoots - workspace roots the bundle has seen.
 * @returns the finished render in the shape the rail and gallery expect.
 */
export async function renderFromStudio(
  ctx: Context,
  config: Config,
  input: StudioRenderRequest,
  signal: AbortSignal,
  knownRoots?: Set<string>,
): Promise<StudioRenderResponse> {
  const defaults = resolveRenderDefaults(config)
  const markup = input.template === undefined
    ? input.markup ?? ''
    : fillTemplate(input.template, input.data ?? {}).html
  const template = input.template === undefined ? undefined : RENDER_TEMPLATES.find(entry => entry.id === input.template)

  const started = Date.now()
  const rendered = await renderToPng({
    kind: input.kind,
    markup,
    width: input.width ?? template?.width ?? defaults.width,
    height: input.height ?? template?.height ?? defaults.height,
    scale: input.scale ?? defaults.scale,
    background: input.background ?? defaults.background,
    timeoutMs: defaults.timeoutMs,
  }, { browserPath: config.renderBrowserPath, signal })

  const exec = {
    signal,
    ...(input.workspaceRoot === undefined ? {} : { agent: { session: { header: { cwd: input.workspaceRoot } } } }),
  }
  const saved = await saveGenerated(
    ctx,
    { data: rendered.png, mediaType: 'image/png' },
    input.kind,
    input.kind === 'html' ? 'HTML' : 'SVG',
    `Rendered ${String(rendered.width)}x${String(rendered.height)}`,
    config,
    exec,
    knownRoots,
  )

  return {
    attachment: saved.attachment,
    provider: input.kind,
    model: input.kind === 'html' ? 'HTML' : 'SVG',
    output: `${saved.output} · ${String(Math.round(rendered.durationMs))}ms`,
    ...(saved.savedTo === undefined ? {} : { savedTo: saved.savedTo }),
    ...(saved.saveError === undefined ? {} : { saveError: saved.saveError }),
    width: rendered.width,
    height: rendered.height,
    elapsedMs: Date.now() - started,
    createdAt: Date.now(),
    prompt: template?.id ?? (input.kind === 'html' ? 'Custom HTML' : 'Custom SVG'),
  }
}

/** Re-export so the bundle and the route share one error type. */
export { RenderError }
