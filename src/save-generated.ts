/**
 * One path from finished bytes to a conversation attachment plus a workspace
 * file, shared by every image source (ComfyUI, HTML render, SVG render).
 *
 * Keeping this in one place is what makes a rendered PNG indistinguishable
 * from a generated one: same attachment store, same workspace folder, same
 * provenance line, same save-failure behaviour.
 *
 * @module dsh-arya-image-gen/save-generated
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ComfyUIJobTimings } from './comfyui.js'
import type { Config } from './config.js'
import type { ImageProvider } from './shared.js'
import { saveImageToWorkspace } from './workspace-save.js'

/** One finished image as the tools report it. */
export interface GeneratedValue {
  attachment: ImageAttachmentRef
  provider: ImageProvider
  model: string
  output: string
  savedTo?: string
  saveError?: string
  /** Concrete workflow seed, exposed by the ComfyUI provider for provenance. */
  seed?: number
  /** Pixel dimensions and encoded size of the attached image. */
  width?: number
  height?: number
  bytes?: number
  /** Timing split reported by the ComfyUI job, in milliseconds. */
  queueMs?: number
  execMs?: number
  totalMs?: number
  /** Jobs queued ahead of this one at submission. */
  queueAhead?: number
  comfyVersion?: string
}

/** Bytes a provider finished with, before they become an attachment. */
export interface GeneratedBytes {
  data: Uint8Array
  mediaType: ImageAttachmentRef['mediaType']
  seed?: number
  timings?: ComfyUIJobTimings
  comfyVersion?: string
}

/**
 * Attach one image and, when enabled, write it into the session workspace.
 *
 * @param ctx - host context providing the attachment store.
 * @param generated - finished bytes and their provenance.
 * @param provider - which source produced them.
 * @param model - workflow or renderer name.
 * @param outputPrefix - first word of the provenance line.
 * @param config - plugin configuration (workspace folder, save toggle).
 * @param exec - tool execution context (session cwd, abort signal).
 * @param knownRoots - workspace roots seen so far.
 * @returns the finished value the tool returns.
 */
export async function saveGenerated(
  ctx: Context,
  generated: GeneratedBytes,
  provider: ImageProvider,
  model: string,
  outputPrefix: string,
  config: Config,
  exec: { agent?: { session: { header: { cwd?: string } } }; signal: AbortSignal },
  knownRoots?: Set<string>,
): Promise<GeneratedValue> {
  if (!ctx.attachments.imageLimits.mediaTypes.includes(generated.mediaType)) {
    throw new Error(`This DSH deployment does not accept ${generated.mediaType} generated images`)
  }
  const attachment = await ctx.attachments.saveImage({ data: generated.data, mediaType: generated.mediaType, name: 'generated-image' })
  const value: GeneratedValue = {
    attachment, provider, model,
    output: provenanceLine(outputPrefix, attachment, generated.seed, generated.timings, generated.comfyVersion),
    width: attachment.width, height: attachment.height, bytes: attachment.bytes,
    ...(typeof generated.seed === 'number' ? { seed: generated.seed } : {}),
    ...(generated.timings === undefined ? {} : {
      queueMs: generated.timings.queueMs,
      execMs: generated.timings.execMs,
      totalMs: generated.timings.totalMs,
      queueAhead: generated.timings.queueAhead,
    }),
    ...(generated.comfyVersion === undefined ? {} : { comfyVersion: generated.comfyVersion }),
  }
  if (config.saveToWorkspace === false) return value
  const workspaceRoot = exec.agent?.session.header.cwd
  if (workspaceRoot === undefined) return value
  knownRoots?.add(workspaceRoot)
  try {
    value.savedTo = await saveImageToWorkspace({ workspaceRoot, folder: config.workspaceFolder, attachmentId: attachment.attachmentId, mediaType: generated.mediaType, data: generated.data, signal: exec.signal })
  } catch (error) {
    exec.signal.throwIfAborted()
    ctx.logger.warn(`dsh-image-gen: failed to save image to workspace: ${error instanceof Error ? error.message : String(error)}`)
    value.saveError = error instanceof Error ? error.message : String(error)
  }
  return value
}

/** Attachment fields the chat card stores in presentation metadata. */
export function attachmentMeta(ref: ImageAttachmentRef) {
  return {
    attachmentId: String(ref.attachmentId), mediaType: ref.mediaType, bytes: ref.bytes, width: ref.width, height: ref.height,
    ...(ref.name === undefined ? {} : { name: ref.name }),
    ...(ref.originalDimensions === undefined ? {} : { originalDimensions: { width: ref.originalDimensions.width, height: ref.originalDimensions.height } }),
  }
}

/** Model- and user-visible provenance for one finished image. */
export function provenanceLine(prefix: string, attachment: ImageAttachmentRef, seed?: number, timings?: ComfyUIJobTimings, comfyVersion?: string): string {
  const parts = [prefix, `${String(attachment.width)}x${String(attachment.height)}`]
  if (seed !== undefined) parts.push(`seed ${String(seed)}`)
  if (timings !== undefined) {
    parts.push(`queued ${seconds(timings.queueMs)}`, `ran ${seconds(timings.execMs)}`, `total ${seconds(timings.totalMs)}`)
  }
  if (comfyVersion !== undefined) parts.push(`ComfyUI ${comfyVersion}`)
  return parts.join(' · ')
}

/** Milliseconds rendered as seconds with one decimal. */
function seconds(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(1)}s`
}
