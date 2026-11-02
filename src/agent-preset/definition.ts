/**
 * The Arya Image agent preset as data.
 *
 * Why this exists: a DSH agent inherits every tool the mounted bundles
 * register, and each schema is paid for on every request. An image session
 * needs six image tools and a small core, not an engineering bundle, an MCP
 * fleet and a computer-use driver. This preset keeps the small set visible and
 * masks the rest.
 *
 * How the mask works (see `@deepseek-ai/dsh-tools`): `ctx.tools.restrict({
 * allow })` hides inherited *global* tools for one agent scope, while tools
 * registered by the preset's own rows stay visible. The image tools come from
 * this Bundle's host row, so they are global and are whitelisted explicitly.
 *
 * `tool-ask-user` and `tool-present` are mounted here because the base bundle
 * does not mount them; everything else the preset keeps already exists in the
 * host tree, so repeating those rows would only shadow them.
 *
 * @module dsh-arya-image-gen/agent-preset/definition
 */
import { IMAGE_TOOL_NAME_LIST } from '../shared.js'
import { ARYA_IMAGE_PERSONA } from './persona.js'

/** The preset id sessions record in their header. */
export const ARYA_IMAGE_PRESET_ID = 'arya-image'

/** The name the preset picker shows. */
export const ARYA_IMAGE_PRESET_NAME = 'Arya Image'

/** One line under the name in the picker. */
export const ARYA_IMAGE_PRESET_DESCRIPTION = 'Image work with only the core DSH tools and this plugin: the other installed bundles\' tools stay out of the prompt.'

/** Sort position right after Arya Standard (2), where the image work belongs. */
export const ARYA_IMAGE_PRESET_ORDER = 2.5

/** Row id of the tool-mask row inside the preset. */
export const ARYA_IMAGE_TOOLSET_ROW_ID = 'arya-image-toolset'

/** Package subpath the tool-mask row mounts. */
export const ARYA_IMAGE_TOOLSET_MODULE = 'dsh-arya-image-gen/agent-toolset'

/** One plugin row in a preset definition. */
export interface PresetRow {
  id: string
  name: string
  config?: unknown
  disabled?: boolean
}

/** The definition shape `agentPresets.register()` accepts. */
export interface AgentPresetDefinition {
  id: string
  name: string
  description: string
  order: number
  plugins: PresetRow[]
}

/**
 * Tool names the mask tries to keep besides the image tools.
 *
 * A preset registered at runtime mounts its rows on the agent plane; the host's
 * own tools are supplied by the composition, and `restrict()` reports them as
 * unknown for this scope, so the mask row drops every name listed here. Keeping
 * the list is therefore honest bookkeeping rather than a capability: it names
 * what this preset would keep on a host that exposes them (a composition-row
 * preset does - see docs/reference-images.md).
 *
 * @param platform - `process.platform` value of the host.
 * @returns the model-facing tool names a full preset row list would provide.
 */
export function presetToolNames(platform: string): string[] {
  return [
    'read', 'write', 'edit', 'glob', 'grep',
    platform === 'win32' ? 'pwsh' : 'bash',
    'job_list', 'job_output', 'job_kill',
    'todo_write',
    'web_search', 'web_fetch',
    'ask_user_question',
    'present',
  ]
}

/**
 * Names the tool mask keeps visible.
 *
 * Image tools first so a truncated log still names them, then the working
 * directory tool the host registers globally, then whatever of the preset's own
 * tool list this host actually restricts.
 *
 * @param platform - `process.platform` value of the host.
 * @returns the allow list handed to the tool-mask row.
 */
export function agentPresetAllowList(platform: string): string[] {
  return [...IMAGE_TOOL_NAME_LIST, 'working_directory', ...presetToolNames(platform)]
}

/**
 * Build the preset definition.
 *
 * @param options - host facts the definition depends on.
 * @param options.platform - `process.platform` value of the host.
 * @returns a definition `agentPresets.register()` accepts.
 */
export function buildAgentPresetDefinition(options: { platform: string }): AgentPresetDefinition {
  return {
    id: ARYA_IMAGE_PRESET_ID,
    name: ARYA_IMAGE_PRESET_NAME,
    description: ARYA_IMAGE_PRESET_DESCRIPTION,
    order: ARYA_IMAGE_PRESET_ORDER,
    plugins: [
      {
        id: 'persona',
        name: '@deepseek-ai/dsh-persona',
        config: {
          prefix: ARYA_IMAGE_PERSONA,
          complete: false,
          includeRuntimeContext: true,
        },
      },
      { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
      { id: 'present', name: '@deepseek-ai/dsh-tool-present' },
      {
        id: ARYA_IMAGE_TOOLSET_ROW_ID,
        name: ARYA_IMAGE_TOOLSET_MODULE,
        config: { allow: agentPresetAllowList(options.platform) },
      },
    ],
  }
}
