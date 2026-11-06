/**
 * The Arya Image agent preset as data.
 *
 * Why this exists: a DSH agent inherits whatever its preset mounts, and every
 * tool schema is paid for on every request. An image session needs the image
 * tools and a small working set - filesystem, shell, jobs, web, ask, present -
 * and nothing else. Goals, skills, plan mode, delegation, scheduling, MCP
 * servers and computer use stay out of the prompt.
 *
 * Two mechanisms, because neither one is enough alone:
 *
 * - **Rows** mount the tools the session must have. A tool registered by one of
 *   the preset's own rows lives in the agent's scope and is always visible.
 * - **The mask row** (`dsh-arya-image-gen/agent-toolset`) calls
 *   `ctx.tools.restrict({ allow })`, which hides every *inherited global* tool
 *   the list does not name. Rows alone cannot do that: the host's composition
 *   registers tools globally - other bundles, MCP servers, computer use - and
 *   every one of them would otherwise reach this session.
 *
 * The image tools are not rows: they come from this bundle's host row and are
 * already global, so the allow list names them explicitly. A name that the
 * scope cannot restrict (because a row provides it) is dropped from the filter
 * by the mask itself, and the tool stays visible either way.
 *
 * Shell rows use `disabled` rather than a platform switch, matching the shipped
 * presets, so a definition is one shape on every platform.
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
export const ARYA_IMAGE_PRESET_DESCRIPTION = 'Image work with the image tools and a small core tool set; everything else stays out of the prompt.'

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
  /** Marks a nested `cordis:group` row whose `config` is its child rows. */
  group?: boolean
  /** Services the group provides in its own realm. */
  isolate?: Record<string, true | string>
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
 * The host tools an image session keeps beside the image tools.
 *
 * `working_directory` is absent from the preset's rows: the host mounts it
 * globally, so the mask is what keeps it.
 *
 * @param platform - `process.platform` value of the host.
 * @returns the global tool names the mask keeps.
 */
export function coreToolNames(platform: string): readonly string[] {
  return [
    'read',
    'write',
    'edit',
    'glob',
    'grep',
    'read_image',
    'working_directory',
    platform === 'win32' ? 'pwsh' : 'bash',
    'job_list',
    'job_output',
    'job_kill',
    'web_search',
    'web_fetch',
    'ask_user_question',
    'present',
  ]
}

/**
 * The allow list handed to the mask row: the image tools plus the core set.
 *
 * @param platform - `process.platform` value of the host.
 * @returns the global tool names the mask keeps.
 */
export function agentPresetAllowList(platform: string): string[] {
  return [...IMAGE_TOOL_NAME_LIST, ...coreToolNames(platform)]
}

/**
 * The rows that give the session its tools.
 *
 * The working set is deliberately small: an image session that also carries
 * goals, skills, plan mode, delegation, scheduling and a todo list spends
 * prompt budget and decision space on tools it will not use. The compaction
 * group stays - it mounts no tools, and it keeps the session's summarization
 * and the billion-context stand-down working.
 *
 * @param platform - `process.platform` value of the host.
 * @param standDownCompaction - whether billion-context owns compaction, so the
 *   stock summary rows must not run beside it.
 * @returns the rows, in mount order.
 */
export function presetToolRows(platform: string, standDownCompaction = false): PresetRow[] {
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
    {
      id: 'compaction',
      name: 'cordis:group',
      group: true,
      isolate: { compaction: true, toolResultPruner: true },
      config: [
        // billion-context owns summarization when it is active; the two summary
        // rows stand down and the pruner stays either way.
        {
          id: 'compaction-basic',
          name: '@deepseek-ai/dsh-compaction-basic',
          ...(standDownCompaction ? { disabled: true } : {}),
        },
        {
          id: 'command-compact',
          name: '@deepseek-ai/dsh-command-compact',
          ...(standDownCompaction ? { disabled: true } : {}),
        },
        {
          id: 'tool-result-pruner',
          name: '@deepseek-ai/dsh-compaction-tool-result-pruner',
          config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 },
        },
      ],
    },
    { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
    // Search + fetch: how a real subject's photograph is found before an edit.
    { id: 'tool-web', name: '@deepseek-ai/dsh-tool-web', config: { fetch: true, searchTimeoutMs: 60_000 } },
    { id: 'present', name: '@deepseek-ai/dsh-tool-present' },
    // Last: it can only name tools that are already registered when it runs.
    {
      id: ARYA_IMAGE_TOOLSET_ROW_ID,
      name: ARYA_IMAGE_TOOLSET_MODULE,
      config: { allow: agentPresetAllowList(platform) },
    },
  ]
}

/**
 * Build the preset definition.
 *
 * @param options - host facts the definition depends on.
 * @param options.platform - `process.platform` value of the host.
 * @param options.standDownCompaction - whether billion-context owns compaction.
 * @returns a definition `agentPresets.register()` accepts.
 */
export function buildAgentPresetDefinition(options: {
  platform: string
  standDownCompaction?: boolean
}): AgentPresetDefinition {
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
      ...presetToolRows(options.platform, options.standDownCompaction === true),
    ],
  }
}
