/**
 * The Arya Image agent preset as data.
 *
 * Why this exists: a DSH agent inherits whatever its preset mounts, and each
 * tool schema is paid for on every request. An image session needs the image
 * tools, a filesystem, a shell, jobs, the web for reference photos, a question
 * and a deliverable - and nothing from an engineering bundle, an MCP fleet or a
 * computer-use driver.
 *
 * The row list is the mechanism, the same way the AryaCode presets work: a
 * preset declares the plugins it runs, and those rows are the session's tools.
 * Masking inherited tools is NOT a substitute - a mask can only name what the
 * host registers globally, so a session built on inherited tools ends up with
 * whatever happened to be global and none of the base tools.
 *
 * The image tools are not rows: they come from this bundle's host row and are
 * already global, so a preset that mounts rows and masks nothing keeps them.
 *
 * Shell rows use `disabled` rather than a platform switch, matching the shipped
 * presets, so a definition is one shape on every platform.
 *
 * @module dsh-arya-image-gen/agent-preset/definition
 */
import { ARYA_IMAGE_PERSONA } from './persona.js'

/** The preset id sessions record in their header. */
export const ARYA_IMAGE_PRESET_ID = 'arya-image'

/** The name the preset picker shows. */
export const ARYA_IMAGE_PRESET_NAME = 'Arya Image'

/** One line under the name in the picker. */
export const ARYA_IMAGE_PRESET_DESCRIPTION = 'Image work with the image tools, a small working set and this plugin: the other installed bundles\' tools stay out of the prompt.'

/** Sort position right after Arya Standard (2), where the image work belongs. */
export const ARYA_IMAGE_PRESET_ORDER = 2.5

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
 * The rows that give the session its working tools.
 *
 * Mirrors the Arya Standard preset's row list, minus skills, goals, plan mode
 * and delegation, plus the web rows that reference hunting needs.
 *
 * @param platform - `process.platform` value of the host.
 * @returns the rows, in mount order.
 */
export function presetToolRows(platform: string): PresetRow[] {
  const windows = platform === 'win32'
  return [
    { id: 'agent-instructions', name: '@deepseek-ai/dsh-agent-instructions', config: { maxBytes: 65536 } },
    { id: 'time-context', name: '@deepseek-ai/dsh-time-context' },
    // Both shells are declared and one is disabled: the shipped presets do it
    // this way, and it keeps the row ids stable across platforms.
    { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash', disabled: windows },
    { id: 'tool-pwsh', name: '@deepseek-ai/dsh-tool-pwsh', disabled: !windows },
    { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
    { id: 'tool-fs-search', name: '@deepseek-ai/dsh-tool-fs-search', config: { sampleOverCapGlobResults: false } },
    { id: 'tool-jobs', name: '@deepseek-ai/dsh-tool-jobs' },
    // Search + fetch: how a real subject's photograph is found before an edit.
    { id: 'tool-web', name: '@deepseek-ai/dsh-tool-web', config: { fetch: true, searchTimeoutMs: 60_000 } },
    { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
    { id: 'present', name: '@deepseek-ai/dsh-tool-present' },
  ]
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
      ...presetToolRows(options.platform),
    ],
  }
}
