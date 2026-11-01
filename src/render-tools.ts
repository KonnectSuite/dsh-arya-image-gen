/**
 * Model-facing HTML and SVG rendering tools.
 *
 * Both tools end in the same attachment path as a ComfyUI image, so the chat
 * card, gallery, canvas and workspace saving all work unchanged; the only
 * difference is the provider recorded on the result.
 *
 * @module dsh-arya-image-gen/render-tools
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolResult } from '@deepseek-ai/dsh-tools'
import { resolveRenderDefaults, type Config } from './config.js'
import { attachmentMeta, saveGenerated, type GeneratedValue } from './save-generated.js'
import { IMAGE_TOOL_NAMES, type ImageProvider } from './shared.js'
import { renderToPng, RenderError, RENDER_LIMITS, type RenderKind } from './render/render.js'
import { fillTemplate, RENDER_TEMPLATES } from './render/templates.js'

/** Host services and state the render tools borrow from the bundle. */
export interface RenderToolDeps {
  /** Current configuration snapshot. */
  config(): Config
  /** Workspace roots seen so far, shared with the ComfyUI tools. */
  knownRoots: Set<string>
}

/** Output envelope shared with the image tools. */
const IMAGE_OUTPUT_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    attachment: { type: 'object', required: true, additionalProperties: false, properties: {
      attachmentId: { type: 'string', required: true }, mediaType: { type: 'string', required: true }, bytes: { type: 'integer', required: true }, width: { type: 'integer', required: true }, height: { type: 'integer', required: true }, name: { type: 'string' }, originalDimensions: { type: 'object', additionalProperties: false, properties: { width: { type: 'integer', required: true }, height: { type: 'integer', required: true } } },
    } },
    provider: { type: 'string', required: true }, model: { type: 'string', required: true }, output: { type: 'string', required: true },
    savedTo: { type: 'string' }, saveError: { type: 'string' }, sourceSavedTo: { type: 'string' },
    width: { type: 'integer' }, height: { type: 'integer' }, bytes: { type: 'integer' },
  },
} as const

/** Extra field the render tools report: where the source file landed. */
interface RenderValue extends GeneratedValue {
  sourceSavedTo?: string
}

const TEMPLATE_HINT = RENDER_TEMPLATES.map(template => `${template.id} (${template.slots.join(', ')})`).join('; ')

/**
 * Register the three render tools on the bundle context.
 *
 * @param ctx - host context providing tools and attachments.
 * @param deps - configuration accessor and shared workspace bookkeeping.
 */
export function registerRenderTools(ctx: Context, deps: RenderToolDeps): void {
  ctx.tools.register(defineTool({
    name: IMAGE_TOOL_NAMES.renderHtml,
    description: `Render HTML to a PNG image with the installed browser. Use it for banners, cards, infographics, tables and any layout that must be pixel-exact - text stays real text, so it is sharper and more controllable than a generated image. No JavaScript runs and no network is reachable: the page must be complete static HTML with inline CSS, and any image must be a data: URL or a local file. Provide one of html, source_path, or template+data. Templates: ${TEMPLATE_HINT}. After rendering, look at the result, then edit and re-render if needed.`,
    parameters: {
      html: { type: 'string', description: 'Complete HTML document or fragment. Inline CSS; scripts and remote URLs are stripped.' },
      source_path: { type: 'string', description: 'Render an HTML file from the session workspace instead of inline markup.' },
      template: { type: 'string', description: 'Built-in template id; pair with data. list_render_templates shows the catalog.' },
      data: { type: 'json', description: 'Template slot values, e.g. {"title":"Hello","subtitle":"..."}.' },
      width: { type: 'integer', description: `Canvas width in CSS pixels (default from settings; max ${String(RENDER_LIMITS.maxSide)}).` },
      height: { type: 'integer', description: `Canvas height in CSS pixels (default from settings; max ${String(RENDER_LIMITS.maxSide)}).` },
      scale: { type: 'number', description: `Device pixel ratio 1-${String(RENDER_LIMITS.maxScale)}; 2 doubles the PNG for crisp text.` },
      background: { type: 'string', description: 'CSS background behind the page, e.g. #ffffff or transparent.' },
      timeout_ms: { type: 'integer', description: 'Render timeout in milliseconds.' },
    },
    output: {
      schema: IMAGE_OUTPUT_SCHEMA,
      render: (_args: unknown, value: RenderValue) => renderToolText('Rendered', value),
      presentationMeta: (args: unknown, value: RenderValue) => renderMeta(args, value, 'html'),
    },
    async execute(args, exec): Promise<RenderValue> {
      return renderWith(ctx, deps, exec, {
        kind: 'html',
        markup: await resolveMarkup(args as Record<string, unknown>, 'html', exec),
        ...renderGeometry(args as Record<string, unknown>, deps.config()),
        timeoutMs: timeoutOf(args as Record<string, unknown>, deps.config()),
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: IMAGE_TOOL_NAMES.renderSvg,
    description: 'Render SVG markup to a PNG image with the installed browser. Use it for icons, logos, diagrams, charts and crisp vector art. Size defaults to the SVG viewBox or width/height attributes; pass width/height to override. Scripts, event handlers and remote references are stripped, and external fonts will not load - text uses the bundled Sora and JetBrains Mono families or a system fallback.',
    parameters: {
      svg: { type: 'string', description: 'SVG markup, e.g. <svg viewBox="0 0 24 24">...</svg>.' },
      source_path: { type: 'string', description: 'Render an SVG file from the session workspace instead of inline markup.' },
      width: { type: 'integer', description: 'Output width in CSS pixels; defaults to the SVG size.' },
      height: { type: 'integer', description: 'Output height in CSS pixels; defaults to the SVG size.' },
      scale: { type: 'number', description: `Device pixel ratio 1-${String(RENDER_LIMITS.maxScale)}.` },
      background: { type: 'string', description: 'CSS background behind the SVG; use transparent to keep it see-through.' },
      timeout_ms: { type: 'integer', description: 'Render timeout in milliseconds.' },
    },
    output: {
      schema: IMAGE_OUTPUT_SCHEMA,
      render: (_args: unknown, value: RenderValue) => renderToolText('Rendered', value),
      presentationMeta: (args: unknown, value: RenderValue) => renderMeta(args, value, 'svg'),
    },
    async execute(args, exec): Promise<RenderValue> {
      const raw = args as Record<string, unknown>
      const markup = await resolveMarkup(raw, 'svg', exec)
      const intrinsic = svgIntrinsicSize(markup)
      const config = deps.config()
      const geometry = renderGeometry(raw, config, intrinsic)
      return renderWith(ctx, deps, exec, { kind: 'svg', markup, ...geometry, timeoutMs: timeoutOf(raw, config) })
    },
  }))

  ctx.tools.register(defineTool({
    name: IMAGE_TOOL_NAMES.listRenderTemplates,
    description: 'List the built-in HTML render templates with their id, canvas size and slot names. Use it before render_html with a template so the slot names are exact.',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false, properties: {
          templates: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
            id: { type: 'string', required: true }, label: { type: 'string', required: true }, description: { type: 'string', required: true },
            width: { type: 'integer', required: true }, height: { type: 'integer', required: true },
            slots: { type: 'array', required: true, items: { type: 'string' } },
          } } },
        },
      },
      render: (_args: unknown, value: { templates: { id: string; label: string; width: number; height: number; slots: readonly string[] }[] }) => [{
        type: 'text' as const,
        text: value.templates.map(template => `${template.id} - ${template.label} (${String(template.width)}x${String(template.height)}): slots ${template.slots.join(', ')}`).join('\n'),
      }],
    },
    async execute(): Promise<{ templates: { id: string; label: string; description: string; width: number; height: number; slots: string[] }[] }> {
      return {
        templates: RENDER_TEMPLATES.map(template => ({
          id: template.id,
          label: template.label,
          description: template.description,
          width: template.width,
          height: template.height,
          slots: [...template.slots],
        })),
      }
    },
  }))
}

/** Run one render, attach it, and save the source beside it. */
async function renderWith(
  ctx: Context,
  deps: RenderToolDeps,
  exec: { agent?: { session: { header: { cwd?: string } } }; signal: AbortSignal },
  input: { kind: RenderKind; markup: string; width: number; height: number; scale: number; background: string; timeoutMs: number },
): Promise<RenderValue> {
  const config = deps.config()
  const rendered = await renderToPng(
    { kind: input.kind, markup: input.markup, width: input.width, height: input.height, scale: input.scale, background: input.background, timeoutMs: input.timeoutMs },
    { browserPath: config.renderBrowserPath, signal: exec.signal },
  )
  const model = input.kind === 'html' ? 'HTML' : 'SVG'
  const outputPrefix = `Rendered ${String(rendered.width)}x${String(rendered.height)} with ${browserLabel(rendered.browser.family)}`
  const value = await saveGenerated(ctx, { data: rendered.png, mediaType: 'image/png' }, input.kind, model, outputPrefix, config, exec, deps.knownRoots) as RenderValue
  value.output = `${value.output} · ${String(Math.round(rendered.durationMs))}ms`

  if (config.renderSaveSource !== false && typeof value.savedTo === 'string') {
    try {
      const extension = input.kind === 'html' ? '.html' : '.svg'
      const target = value.savedTo.replace(/\.png$/i, extension)
      await writeFile(target, input.markup, 'utf8')
      value.sourceSavedTo = target
    } catch (error) {
      ctx.logger.warn(`dsh-image-gen: could not save render source: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return value
}

/** One text-plus-image render result for the model. */
function renderToolText(verb: string, value: RenderValue) {
  const saved = typeof value.savedTo === 'string' ? ` It was also saved to the workspace as ${value.savedTo}.` : ''
  const source = typeof value.sourceSavedTo === 'string' ? ` The source is next to it at ${value.sourceSavedTo}.` : ''
  return [
    { type: 'text' as const, text: `${verb} one image with ${value.provider}/${value.model} (${value.output}). Attachment ID: ${String(value.attachment.attachmentId)}. It is already attached to the conversation.${saved}${source} Look at the image and fix anything that is wrong.` },
    { type: 'image' as const, attachment: value.attachment },
  ]
}

/** Chat card metadata for a render. */
function renderMeta(args: unknown, value: RenderValue, kind: 'html' | 'svg') {
  const record = typeof args === 'object' && args !== null ? args as Record<string, unknown> : {}
  return {
    kind: 'dsh-image-gen', attachment: attachmentMeta(value.attachment), provider: value.provider as ImageProvider,
    model: value.model, output: value.output,
    ...(typeof value.savedTo === 'string' ? { savedTo: value.savedTo } : {}),
    ...(typeof value.sourceSavedTo === 'string' ? { sourceSavedTo: value.sourceSavedTo } : {}),
    prompt: typeof record['template'] === 'string' ? String(record['template']) : kind.toUpperCase(),
  }
}

/** Model-visible name of the browser family. */
function browserLabel(family: string): string {
  if (family === 'edge') return 'Edge'
  if (family === 'chrome') return 'Chrome'
  if (family === 'chromium') return 'Chromium'
  return 'Chromium'
}

/** Geometry from the call, falling back to settings then template defaults. */
function renderGeometry(args: Record<string, unknown>, config: Config, intrinsic?: { width: number; height: number }): { width: number; height: number; scale: number; background: string } {
  const defaults = resolveRenderDefaults(config)
  const width = typeof args['width'] === 'number' ? args['width'] : intrinsic?.width ?? defaults.width
  const height = typeof args['height'] === 'number' ? args['height'] : intrinsic?.height ?? defaults.height
  const scale = typeof args['scale'] === 'number' ? args['scale'] : defaults.scale
  const background = typeof args['background'] === 'string' && args['background'].trim().length > 0 ? args['background'].trim() : defaults.background
  return { width, height, scale, background }
}

/** Timeout from the call or settings. */
function timeoutOf(args: Record<string, unknown>, config: Config): number {
  const value = args['timeout_ms']
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return resolveRenderDefaults(config).timeoutMs
}

/**
 * Turn tool arguments into markup: inline text, a workspace file, or a filled
 * template.
 */
async function resolveMarkup(
  args: Record<string, unknown>,
  inlineKey: 'html' | 'svg',
  exec: { agent?: { session: { header: { cwd?: string } } } },
): Promise<string> {
  const inline = args[inlineKey]
  const sourcePath = args['source_path']
  const template = args['template']
  const provided = [typeof inline === 'string' && inline.trim().length > 0, typeof sourcePath === 'string', typeof template === 'string'].filter(Boolean).length
  if (provided !== 1) throw new RenderError(`Pass exactly one of ${inlineKey}, source_path, or template.`, 'RENDER_BAD_ARGS')

  if (typeof template === 'string') {
    const data = typeof args['data'] === 'object' && args['data'] !== null ? args['data'] as Record<string, unknown> : {}
    return fillTemplate(template, data).html
  }
  if (typeof sourcePath === 'string') {
    const root = exec.agent?.session.header.cwd
    if (root === undefined) throw new RenderError('source_path needs a session workspace.', 'RENDER_BAD_ARGS')
    const resolved = path.resolve(root, sourcePath)
    if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new RenderError('source_path must stay inside the session workspace.', 'RENDER_BAD_ARGS')
    return readFile(resolved, 'utf8')
  }
  return String(inline)
}

/**
 * Read a canvas size out of SVG markup.
 *
 * @param markup - SVG source.
 * @returns integer size when the markup declares one.
 */
export function svgIntrinsicSize(markup: string): { width: number; height: number } | undefined {
  const svg = /<svg\b[^>]*>/i.exec(markup)?.[0]
  if (svg === undefined) return undefined
  const read = (name: string): number | undefined => {
    const match = new RegExp(`${name}\\s*=\\s*["']\\s*([0-9.]+)(?:px)?\\s*["']`, 'i').exec(svg)
    if (match === null) return undefined
    const value = Number(match[1])
    return Number.isFinite(value) && value >= 1 ? Math.round(value) : undefined
  }
  const width = read('width')
  const height = read('height')
  if (width !== undefined && height !== undefined) return { width, height }
  const viewBox = /viewBox\s*=\s*["']\s*[-0-9.]+[\s,]+[-0-9.]+[\s,]+([0-9.]+)[\s,]+([0-9.]+)\s*["']/i.exec(svg)
  if (viewBox !== null) {
    const w = Math.round(Number(viewBox[1]))
    const h = Math.round(Number(viewBox[2]))
    if (Number.isFinite(w) && Number.isFinite(h) && w >= 1 && h >= 1) return { width: w, height: h }
  }
  return undefined
}

/** Re-exported so the route can share the same error type. */
export { RenderError }
