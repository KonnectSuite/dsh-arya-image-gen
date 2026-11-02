/** Pure ComfyUI API-workflow validation and placeholder injection. */
import { describeWorkflowJson, MAX_COMFYUI_WORKFLOW_BYTES, type ComfyUIWorkflowCapabilities, type ComfyUIGenerationParams } from './shared.js'

export const COMFYUI_PROMPT_PLACEHOLDER = '{{prompt}}'
export const COMFYUI_SEED_PLACEHOLDER = '{{seed}}'
export const COMFYUI_IMAGE_PLACEHOLDER = '{{image}}'
/**
 * Dynamic reference list: a link whose node id is this token expands into one
 * LoadImage node per supplied reference, in order.
 *
 * Declared as `"images.image_1": ["{{images}}", 0]`, it lets one workflow take
 * as many references as a call supplies (up to the encoder's slot count)
 * instead of hard-coding a slot per photo.
 */
export const COMFYUI_IMAGES_PLACEHOLDER = '{{images}}'
/** Slots this plugin will fill for one call; ComfyUI's Qwen encoder tops out here. */
export const MAX_COMFYUI_REFERENCE_IMAGES = 16
export const COMFYUI_WIDTH_PLACEHOLDER = '{{width}}'
export const COMFYUI_HEIGHT_PLACEHOLDER = '{{height}}'
export const COMFYUI_STEPS_PLACEHOLDER = '{{steps}}'
export const COMFYUI_CFG_PLACEHOLDER = '{{cfg}}'

/** Legacy single-percent placeholders from early releases, still accepted. */
const LEGACY_PROMPT_PLACEHOLDER = '%prompt%'
const LEGACY_SEED_PLACEHOLDER = '%seed%'
const LEGACY_IMAGE_PLACEHOLDER = '%image%'

/** LoadImage-style input key that receives the uploaded source image name. */
const IMAGE_INPUT_KEY = 'image'

/** Canvas edge used when a workflow declares width/height but a call omits them. */
export const DEFAULT_CANVAS_SIDE = 1024

/** The numeric placeholders one workflow may declare, with their accepted range. */
const NUMERIC_PLACEHOLDERS = {
  width: { token: COMFYUI_WIDTH_PLACEHOLDER, min: 64, max: 8192, integer: true, label: 'width' },
  height: { token: COMFYUI_HEIGHT_PLACEHOLDER, min: 64, max: 8192, integer: true, label: 'height' },
  steps: { token: COMFYUI_STEPS_PLACEHOLDER, min: 1, max: 150, integer: true, label: 'steps' },
  cfg: { token: COMFYUI_CFG_PLACEHOLDER, min: 0, max: 30, integer: false, label: 'cfg' },
} as const

/**
 * Derived placeholder: the canvas' long side, rounded to the 32-pixel step
 * Qwen-Image conditioning expects.
 *
 * Qwen Image 2.1 conditions the text encoder on a `resolution` value; leaving it
 * at its 1024 default while rendering 1344x768 tells the model the wrong canvas,
 * which shows up as weaker composition at non-square sizes. It is derived from
 * width/height rather than passed by the caller, so a call cannot set it wrong.
 */
export const COMFYUI_RESOLUTION_PLACEHOLDER = '{{resolution}}'

type NumericKey = keyof typeof NUMERIC_PLACEHOLDERS
type JsonRecord = Record<string, unknown>

/** Options accepted by the placeholder injector. */
export interface PrepareWorkflowOptions extends ComfyUIGenerationParams {
  prompt: string
  seed?: number
  image?: string
  /** Ordered reference image names for a workflow that declares `{{images}}`. */
  images?: readonly string[]
}

/** Validate imported JSON without exposing workflow graph details to callers. */
export function validateComfyUIWorkflowJson(workflowJson: string): void {
  const workflow = parseWorkflow(workflowJson)
  if (!hasDynamicImagePlaceholder(workflowJson)) {
    const imageInputs = countImagePlaceholders(workflow)
    if (imageInputs > 1) {
      throw new Error(`ComfyUI workflow must contain at most one ${COMFYUI_IMAGE_PLACEHOLDER} image input; found ${String(imageInputs)}. Use ${COMFYUI_IMAGES_PLACEHOLDER} to accept any number of references.`)
    }
  }
  assertNumericPlaceholdersWhole(workflow)
}

/**
 * Read what a workflow can do: its role, which parameters it exposes, and the
 * size it bakes when it has no size placeholders.
 *
 * @param workflowJson - API-format workflow JSON.
 * @returns detected capabilities.
 */
export function detectWorkflowCapabilities(workflowJson: string): ComfyUIWorkflowCapabilities {
  return describeWorkflowJson(workflowJson)
}

/**
 * Parse, clone, and inject the prompt plus whatever generation parameters the
 * caller supplied.
 *
 * Two call shapes are accepted: the object form used by new code, and the
 * historical positional form `(json, prompt, seed?, image?)` still used by
 * older call sites and tests.
 *
 * Prompt and seed placeholders are replaced inside any string so existing
 * workflows that embed them in longer text keep working. Numeric placeholders
 * are stricter: they must be the whole value of a field, so the result stays
 * valid JSON with real numbers. The image placeholder is stricter still: it
 * only matches a dedicated `inputs.image` field whose value is exactly the
 * placeholder, and at most one may exist.
 *
 * @param workflowJson - API-format workflow JSON.
 * @param optionsOrPrompt - parameter object, or the prompt string in the legacy form.
 * @param legacySeed - seed for the legacy form.
 * @param legacyImage - image name for the legacy form.
 * @returns a prepared workflow ready to POST to ComfyUI.
 */
export function prepareComfyUIWorkflow(workflowJson: string, optionsOrPrompt: PrepareWorkflowOptions | string, legacySeed = randomSeed(), legacyImage?: string): JsonRecord {
  const options: PrepareWorkflowOptions = typeof optionsOrPrompt === 'string'
    ? { prompt: optionsOrPrompt, seed: legacySeed, ...(legacyImage === undefined ? {} : { image: legacyImage }) }
    : optionsOrPrompt
  const prompt = options.prompt
  const seed = options.seed ?? randomSeed()
  const image = options.image
  const references = options.images ?? []
  const workflow = parseWorkflow(workflowJson)
  const numeric = numericParameters(workflow, options)
  let promptReplacements = 0

  const inject = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const numericValue = numeric.get(value)
      if (numericValue !== undefined) return numericValue
      let replaced = value
      if (replaced.includes(COMFYUI_PROMPT_PLACEHOLDER) || replaced.includes(LEGACY_PROMPT_PLACEHOLDER)) {
        promptReplacements += 1
        replaced = replaced
          .replaceAll(COMFYUI_PROMPT_PLACEHOLDER, prompt)
          .replaceAll(LEGACY_PROMPT_PLACEHOLDER, prompt)
      }
      if (replaced === COMFYUI_SEED_PLACEHOLDER || replaced === LEGACY_SEED_PLACEHOLDER) return seed
      if (replaced.includes(COMFYUI_SEED_PLACEHOLDER) || replaced.includes(LEGACY_SEED_PLACEHOLDER)) {
        replaced = replaced
          .replaceAll(COMFYUI_SEED_PLACEHOLDER, String(seed))
          .replaceAll(LEGACY_SEED_PLACEHOLDER, String(seed))
      }
      return replaced
    }
    if (Array.isArray(value)) return value.map(inject)
    if (!isRecord(value)) return value
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, inject(child)]))
  }

  let imageInputs = 0
  const prepared = Object.fromEntries(Object.entries(workflow).map(([nodeId, value]) => {
    const node = record(value)
    const inputs = node === undefined ? undefined : record(node.inputs)
    if (inputs === undefined) return [nodeId, value]
    const nextInputs = inject(inputs) as JsonRecord
    if (isImagePlaceholder(nextInputs[IMAGE_INPUT_KEY])) {
      imageInputs += 1
      if (image !== undefined) nextInputs[IMAGE_INPUT_KEY] = image
    }
    return [nodeId, { ...node, inputs: nextInputs }]
  }))
  if (promptReplacements === 0) {
    throw new Error(`ComfyUI workflow must contain ${COMFYUI_PROMPT_PLACEHOLDER} in a text input`)
  }

  // A workflow that declares {{images}} takes as many references as the call
  // supplies; the slices become one LoadImage node per image, in order.
  if (hasDynamicImagePlaceholder(workflowJson)) {
    const names = [...(references.length > 0 ? references : image === undefined ? [] : [image])]
    if (names.length === 0) {
      throw new Error(`This workflow takes reference images through ${COMFYUI_IMAGES_PLACEHOLDER}; call edit_image with at least one source image`)
    }
    if (names.length > MAX_COMFYUI_REFERENCE_IMAGES) {
      throw new Error(`This workflow accepts at most ${String(MAX_COMFYUI_REFERENCE_IMAGES)} reference images; ${String(names.length)} were supplied`)
    }
    return expandReferenceSlices(prepared, names)
  }
  if (image === undefined && references.length === 0) {
    if (imageInputs > 0) {
      throw new Error(`ComfyUI workflow contains an ${COMFYUI_IMAGE_PLACEHOLDER} image input, which requires edit_image with a source image`)
    }
    return prepared
  }
  if (imageInputs > 0 && references.length > 1) {
    throw new Error(`This workflow takes exactly one reference image (${COMFYUI_IMAGE_PLACEHOLDER}); ${String(references.length)} were supplied - use a workflow that declares ${COMFYUI_IMAGES_PLACEHOLDER} for multi-reference composition`)
  }
  if (image === undefined) {
    if (imageInputs > 0) {
      throw new Error(`ComfyUI workflow contains an ${COMFYUI_IMAGE_PLACEHOLDER} image input, which requires edit_image with a source image`)
    }
    return prepared
  }
  if (imageInputs === 0) {
    throw new Error(`ComfyUI workflow must contain exactly one ${COMFYUI_IMAGE_PLACEHOLDER} image input to edit images`)
  }
  if (imageInputs > 1) {
    throw new Error(`ComfyUI workflow must contain exactly one ${COMFYUI_IMAGE_PLACEHOLDER} image input; found ${String(imageInputs)}`)
  }
  return prepared
}

/** One node input that declares the dynamic reference list. */
interface ReferenceSlice {
  nodeId: string
  key: string
  /** Key prefix without its trailing index, e.g. `images.image_`. */
  prefix: string
}

/** Find every `inputs` entry whose link node id is the dynamic token. */
function findReferenceSlices(workflow: JsonRecord): ReferenceSlice[] {
  const slices: ReferenceSlice[] = []
  for (const [nodeId, value] of Object.entries(workflow)) {
    const inputs = record(record(value)?.inputs)
    if (inputs === undefined) continue
    for (const [key, child] of Object.entries(inputs)) {
      if (!Array.isArray(child) || child[0] !== COMFYUI_IMAGES_PLACEHOLDER) continue
      const match = /^(.*?)(\d+)$/u.exec(key)
      if (match === null) {
        throw new Error(`${COMFYUI_IMAGES_PLACEHOLDER} must sit on a numbered input such as "images.image_1" (node ${nodeId}, input "${key}")`)
      }
      slices.push({ nodeId, key, prefix: match[1] ?? '' })
    }
  }
  return slices
}

/** Highest numeric node id, so generated LoadImage ids cannot collide. */
function highestNodeId(workflow: JsonRecord): number {
  let highest = 0
  for (const key of Object.keys(workflow)) {
    if (!/^\d+$/u.test(key)) continue
    highest = Math.max(highest, Number(key))
  }
  return highest
}

/**
 * Replace each dynamic slice with one LoadImage node per reference.
 *
 * The encoder's slot order is the order the caller supplied the images in, so
 * "image 1 is the chair, image 2 is the room" stays true.
 *
 * @param workflow - prepared workflow still carrying the dynamic link.
 * @param names - uploaded ComfyUI image names, in caller order.
 * @returns the expanded workflow.
 */
function expandReferenceSlices(workflow: JsonRecord, names: readonly string[]): JsonRecord {
  const slices = findReferenceSlices(workflow)
  if (slices.length === 0) {
    throw new Error(`This workflow declares ${COMFYUI_IMAGES_PLACEHOLDER} but no input links it; put it on a numbered image input such as "images.image_1"`)
  }
  const expanded: JsonRecord = { ...workflow }
  let nextId = highestNodeId(expanded) + 1
  for (const slice of slices) {
    const node = record(expanded[slice.nodeId]) ?? {}
    const inputs: JsonRecord = { ...(record(node.inputs) ?? {}) }
    delete inputs[slice.key]
    names.forEach((name, index) => {
      const id = String(nextId)
      nextId += 1
      expanded[id] = { class_type: 'LoadImage', inputs: { image: name } }
      inputs[`${slice.prefix}${String(index + 1)}`] = [id, 0]
    })
    expanded[slice.nodeId] = { ...node, inputs }
  }
  return expanded
}

/**
 * Resolve the numeric parameters a workflow needs, rejecting both directions of
 * mismatch: a requested parameter the workflow never declared, and a declared
 * placeholder left without a value.
 */
function numericParameters(workflow: JsonRecord, options: PrepareWorkflowOptions): Map<string, number> {
  const declared = new Set<NumericKey>()
  let wantsResolution = false
  let bakedWidth: number | undefined
  let bakedHeight: number | undefined
  for (const node of Object.values(workflow)) {
    const inputs = record(record(node)?.inputs)
    if (inputs === undefined) continue
    for (const key of Object.keys(NUMERIC_PLACEHOLDERS) as NumericKey[]) {
      if (inputs[key] === NUMERIC_PLACEHOLDERS[key].token) declared.add(key)
    }
    if (inputs['resolution'] === COMFYUI_RESOLUTION_PLACEHOLDER) wantsResolution = true
    if (bakedWidth === undefined && typeof inputs['width'] === 'number') bakedWidth = inputs['width']
    if (bakedHeight === undefined && typeof inputs['height'] === 'number') bakedHeight = inputs['height']
  }
  const out = new Map<string, number>()
  for (const key of Object.keys(NUMERIC_PLACEHOLDERS) as NumericKey[]) {
    const spec = NUMERIC_PLACEHOLDERS[key]
    const supplied = options[key]
    if (!declared.has(key)) {
      if (supplied !== undefined) {
        throw new Error(`This workflow bakes ${spec.label}; add ${spec.token} to a numeric input to make it adjustable, or pick a workflow that supports it.`)
      }
      continue
    }
    if (supplied === undefined) {
      // Size is the one parameter a call may leave out: a templated workflow
      // still has to run from a plain prompt, so it falls back to the canvas
      // the Qwen Turbo graphs ship with. Sampling values stay mandatory,
      // because guessing steps or cfg silently changes the picture.
      if (key === 'width' || key === 'height') {
        out.set(spec.token, DEFAULT_CANVAS_SIDE)
        continue
      }
      throw new Error(`This workflow declares ${spec.token}; pass ${spec.label} so it can be filled in.`)
    }
    if (!Number.isFinite(supplied)) throw new Error(`${spec.label} must be a number`)
    const value = spec.integer ? Math.round(supplied) : supplied
    if (value < spec.min || value > spec.max) {
      throw new Error(`${spec.label} must be between ${String(spec.min)} and ${String(spec.max)} (got ${String(supplied)})`)
    }
    out.set(spec.token, value)
  }
  if (wantsResolution) {
    // Long side, snapped to the 32-pixel step the conditioning expects.
    const width = out.get(COMFYUI_WIDTH_PLACEHOLDER) ?? bakedWidth ?? DEFAULT_CANVAS_SIDE
    const height = out.get(COMFYUI_HEIGHT_PLACEHOLDER) ?? bakedHeight ?? DEFAULT_CANVAS_SIDE
    const longSide = Math.max(width, height)
    const snapped = Math.max(64, Math.min(4096, Math.round(longSide / 32) * 32))
    out.set(COMFYUI_RESOLUTION_PLACEHOLDER, snapped)
  }
  return out
}

/**
 * Reject numeric placeholders embedded in a longer string: the injected value
 * would land inside text and ComfyUI would receive a string where it needs a
 * number, which fails deep inside a run instead of at import.
 */
function assertNumericPlaceholdersWhole(workflow: JsonRecord): void {
  const visit = (value: unknown, nodeId: string, key: string): void => {
    if (typeof value === 'string') {
      for (const spec of [...Object.values(NUMERIC_PLACEHOLDERS), { token: COMFYUI_RESOLUTION_PLACEHOLDER }]) {
        if (!value.includes(spec.token)) continue
        if (value !== spec.token) {
          throw new Error(`${spec.token} must be the whole value of a numeric input (node ${nodeId}, input "${key}"), not part of a longer string`)
        }
      }
      return
    }
    if (Array.isArray(value)) {
      value.forEach(child => { visit(child, nodeId, key) })
      return
    }
    if (!isRecord(value)) return
    for (const [childKey, child] of Object.entries(value)) visit(child, nodeId, childKey)
  }
  for (const [nodeId, node] of Object.entries(workflow)) {
    const inputs = record(record(node)?.inputs)
    if (inputs === undefined) continue
    visit(inputs, nodeId, 'inputs')
  }
}

/** Random seed in the 32-bit range ComfyUI samplers accept. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0x1_0000_0000)
}

function parseWorkflow(workflowJson: string): JsonRecord {
  if (workflowJson.trim().length === 0) throw new Error('Import a ComfyUI API workflow JSON file in Settings before generating')
  if (new TextEncoder().encode(workflowJson).byteLength > MAX_COMFYUI_WORKFLOW_BYTES) {
    throw new Error('ComfyUI workflow file must be no larger than 5 MB')
  }
  let value: unknown
  try {
    value = JSON.parse(workflowJson)
  } catch {
    throw new Error('ComfyUI workflow file is not valid JSON')
  }
  if (!isRecord(value) || Object.keys(value).length === 0) {
    throw new Error('ComfyUI workflow must be a non-empty API-format JSON object')
  }
  if (!Object.values(value).some(node => {
    const inputs = record(node)?.inputs
    return inputs !== undefined && containsPromptPlaceholder(inputs)
  })) {
    throw new Error(`ComfyUI workflow must contain ${COMFYUI_PROMPT_PLACEHOLDER} (or ${LEGACY_PROMPT_PLACEHOLDER}) in a text input`)
  }
  return value
}

/** Count `inputs.image` fields that are exactly an image placeholder. */
function countImagePlaceholders(workflow: JsonRecord): number {
  let count = 0
  for (const node of Object.values(workflow)) {
    const inputs = record(record(node)?.inputs)
    if (inputs !== undefined && isImagePlaceholder(inputs[IMAGE_INPUT_KEY])) count += 1
  }
  return count
}

/** True when the workflow JSON declares an image input, so it can run edits. */
export function hasComfyUIImagePlaceholder(workflowJson: string): boolean {
  return workflowJson.includes(COMFYUI_IMAGE_PLACEHOLDER)
    || workflowJson.includes(LEGACY_IMAGE_PLACEHOLDER)
    || hasDynamicImagePlaceholder(workflowJson)
}

/** True when the workflow takes a variable number of references. */
export function hasDynamicImagePlaceholder(workflowJson: string): boolean {
  return workflowJson.includes(COMFYUI_IMAGES_PLACEHOLDER)
}

function isImagePlaceholder(value: unknown): boolean {
  return value === COMFYUI_IMAGE_PLACEHOLDER || value === LEGACY_IMAGE_PLACEHOLDER
}

function containsPromptPlaceholder(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.includes(COMFYUI_PROMPT_PLACEHOLDER) || value.includes(LEGACY_PROMPT_PLACEHOLDER)
  }
  if (Array.isArray(value)) return value.some(containsPromptPlaceholder)
  return isRecord(value) && Object.values(value).some(containsPromptPlaceholder)
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function record(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined
}
