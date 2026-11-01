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
import { coreToolNames, IMAGE_TOOL_NAME_LIST } from '../shared.js'
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
 * Global tool names the preset keeps visible.
 *
 * Image tools first so a truncated log still names them, then the core set.
 * The tool-mask row filters this against the live registry before restricting,
 * because `restrict()` refuses names the host does not have.
 *
 * @param platform - `process.platform` value of the host.
 * @returns the allow list handed to the tool-mask row.
 */
export function agentPresetAllowList(platform: string): string[] {
  return [...IMAGE_TOOL_NAME_LIST, ...coreToolNames(platform)]
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
