/**
 * Pre-flight the configured workflows against a running ComfyUI.
 *
 * This mirrors what ComfyUI's own `validate_workflow` does for a concrete graph,
 * but for *templated* workflows: it checks the classes and the loader file names,
 * which are the two things that survive placeholder substitution unchanged. Type
 * checking a `{{width}}` string would only ever report the placeholder.
 *
 * @module dsh-arya-image-gen/validate-workflows
 */
import type { ComfyUIWorkflowEntry } from './shared.js'
import { comfyUIEndpointURL } from './shared.js'
import { resolveWorkflowRole } from './shared.js'

/** Result for one configured workflow. */
export interface WorkflowCheck {
  name: string
  role: 'text-to-image' | 'image-to-image'
  ok: boolean
  /** Node classes the running ComfyUI does not know. */
  missingClasses: string[]
  /** Loader file names the running ComfyUI cannot offer. */
  missingModels: string[]
  /** Set when the workflow JSON itself could not be read. */
  error?: string
}

/** The object_info shape this module relies on. */
type ObjectInfo = Record<string, { input?: { required?: Record<string, unknown> } }>

/**
 * Check every workflow against one ComfyUI `/object_info` payload.
 *
 * @param entries - configured workflows.
 * @param info - the server's object_info map.
 * @returns one result per workflow, in input order.
 */
export function checkWorkflows(entries: readonly ComfyUIWorkflowEntry[], info: ObjectInfo): WorkflowCheck[] {
  const known = new Set(Object.keys(info))
  return entries.map(entry => {
    const role = resolveWorkflowRole(entry)
    let workflow: Record<string, unknown>
    try {
      workflow = JSON.parse(entry.json) as Record<string, unknown>
    } catch (cause) {
      return { name: entry.name, role, ok: false, missingClasses: [], missingModels: [], error: cause instanceof Error ? cause.message : 'invalid JSON' }
    }
    const missingClasses = new Set<string>()
    const missingModels = new Set<string>()
    for (const node of Object.values(workflow)) {
      if (typeof node !== 'object' || node === null) continue
      const { class_type: kind, inputs } = node as { class_type?: unknown; inputs?: unknown }
      if (typeof kind !== 'string') continue
      if (!known.has(kind)) { missingClasses.add(kind); continue }
      if (typeof inputs !== 'object' || inputs === null) continue
      for (const [key, value] of Object.entries(inputs as Record<string, unknown>)) {
        // Loader fields are enums of installed files; the name is the risk.
        if (!key.endsWith('_name') || typeof value !== 'string' || value.startsWith('{{')) continue
        const options = enumOptions(info[kind], key)
        if (options !== undefined && !options.has(value)) missingModels.add(value)
      }
    }
    return {
      name: entry.name,
      role,
      ok: missingClasses.size === 0 && missingModels.size === 0,
      missingClasses: [...missingClasses],
      missingModels: [...missingModels],
    }
  })
}

/** Read one field's enum values out of object_info, when it has any. */
function enumOptions(spec: { input?: { required?: Record<string, unknown> } } | undefined, key: string): Set<string> | undefined {
  const raw = spec?.input?.required?.[key]
  // object_info stores [choices, options] per input; only choices matter here.
  const choices = Array.isArray(raw) ? raw[0] : undefined
  if (!Array.isArray(choices)) return undefined
  return new Set(choices.filter((value): value is string => typeof value === 'string'))
}

/**
 * Fetch the live object_info and check the configured workflows.
 *
 * @param entries - configured workflows.
 * @param baseURL - ComfyUI endpoint.
 * @param headers - extra request headers.
 * @param signal - cancellation.
 * @returns one result per workflow.
 */
export async function checkWorkflowsAgainstInstall(
  entries: readonly ComfyUIWorkflowEntry[],
  baseURL: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<WorkflowCheck[]> {
  const response = await fetch(comfyUIEndpointURL(baseURL, 'object_info').toString(), {
    headers,
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok) throw new Error(`ComfyUI answered ${String(response.status)} for /object_info`)
  return checkWorkflows(entries, await response.json() as ObjectInfo)
}
