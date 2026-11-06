/**
 * The Arya Image agent preset as data.
 *
 * Why this exists: a DSH agent inherits whatever its preset mounts, and each
 * tool schema is paid for on every request. An image session needs the image
 * tools and the full DSH standard tool set - filesystem, shell, jobs, web,
 * scheduling, skills, goals, plan mode, compaction, delegation and the rest -
 * while tools from other installed bundles stay out of the prompt.
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
import { ARYA_IMAGE_PLAN_SECTION } from './plan-section.js'

/** The preset id sessions record in their header. */
export const ARYA_IMAGE_PRESET_ID = 'arya-image'

/** The name the preset picker shows. */
export const ARYA_IMAGE_PRESET_NAME = 'Arya Image'

/** One line under the name in the picker. */
export const ARYA_IMAGE_PRESET_DESCRIPTION = 'Image work with the image tools and the full DSH tool set; other installed bundles\' tools stay out of the prompt.'

/** Sort position right after Arya Standard (2), where the image work belongs. */
export const ARYA_IMAGE_PRESET_ORDER = 2.5

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
 * The rows that give the session its tools.
 *
 * Exactly the shipped DSH standard preset's row list, minus the AryaCode
 * `arya-review-skills` row this preset has no use for. The baseline is
 * `AryaCode/packages/bundle/web-app/presets/standard.patch.yml` at the DSH
 * version this plugin targets; only the persona text differs. The planning
 * group passes the shipped plan-mode section, which the plugin requires at load.
 * With `standDownCompaction`, the compaction group's two summary children are
 * the only rows disabled; the pruner and every other row stay as they are.
 *
 * @param platform - `process.platform` value of the host.
 * @param profileContext - whether the Host exposes its profile service; enables
 *   the same conditional plugin-manager row the shipped standard preset mounts.
 * @param standDownCompaction - whether billion-context owns compaction, so the
 *   stock summary rows must not run beside it.
 * @returns the rows, in mount order.
 */
export function presetToolRows(platform: string, profileContext = false, standDownCompaction = false): PresetRow[] {
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
    { id: 'tool-schedule', name: '@deepseek-ai/dsh-tool-schedule' },
    { id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem' },
    { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
    { id: 'command-goal', name: '@deepseek-ai/dsh-command-goal' },
    { id: 'tool-goal', name: '@deepseek-ai/dsh-tool-goal' },
    {
      id: 'planning',
      name: 'cordis:group',
      group: true,
      isolate: { planMode: true },
      // plan-mode validates its config at load and rejects a missing section.
      config: [
        { id: 'plan-mode', name: '@deepseek-ai/dsh-plan-mode', config: { section: ARYA_IMAGE_PLAN_SECTION } },
      ],
    },
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
    {
      id: 'delegation',
      name: 'cordis:group',
      group: true,
      isolate: { workflowEngine: true },
      config: [
        { id: 'tool-subagent-control', name: '@deepseek-ai/dsh-tool-subagent-control' },
        {
          id: 'tool-subagent',
          name: '@deepseek-ai/dsh-tool-subagent',
          config: { provider: 'spawn', toolName: 'subagent', modelSelection: true, modelDiscovery: true },
        },
        {
          id: 'tool-subagent-fork',
          name: '@deepseek-ai/dsh-tool-subagent',
          config: { provider: 'fork', toolName: 'subagent_fork' },
        },
        { id: 'workflow-ptc', name: '@deepseek-ai/dsh-workflow-ptc', config: { provider: 'spawn' } },
        { id: 'tool-workflow', name: '@deepseek-ai/dsh-tool-workflow' },
      ],
    },
    { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
    { id: 'tool-todo', name: '@deepseek-ai/dsh-tool-todo', config: { allowParallelInProgress: true } },
    // Search + fetch: how a real subject's photograph is found before an edit.
    { id: 'tool-web', name: '@deepseek-ai/dsh-tool-web', config: { fetch: true, searchTimeoutMs: 60_000 } },
    { id: 'present', name: '@deepseek-ai/dsh-tool-present' },
    // Host plumbing, matching the shipped standard rows: the manager exists
    // only where the Host exposes profileContext; the market is opt-in.
    { id: 'tool-plugin-manager', name: '@deepseek-ai/dsh-plugin-manager/tools', disabled: !profileContext },
    { id: 'tool-plugin-market', name: '@deepseek-ai/dsh-plugin-market/tools', disabled: true },
  ]
}

/**
 * Build the preset definition.
 *
 * @param options - host facts the definition depends on.
 * @param options.platform - `process.platform` value of the host.
 * @param options.profileContext - whether the Host exposes its profile service.
 * @param options.standDownCompaction - whether billion-context owns compaction.
 * @returns a definition `agentPresets.register()` accepts.
 */
export function buildAgentPresetDefinition(options: {
  platform: string
  profileContext?: boolean
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
      ...presetToolRows(options.platform, options.profileContext === true, options.standDownCompaction === true),
    ],
  }
}
