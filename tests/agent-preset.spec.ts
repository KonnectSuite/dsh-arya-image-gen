import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ARYA_IMAGE_PRESET_ID,
  ARYA_IMAGE_PRESET_NAME,
  ARYA_IMAGE_PRESET_ORDER,
  buildAgentPresetDefinition,
  presetToolRows,
} from '../src/agent-preset/definition.js'
import type { PresetRow } from '../src/agent-preset/definition.js'
import {
  BILI_GATE_SERVICE,
  BILI_STAND_DOWN_WARNING,
  BILI_TIMING,
  BILI_VERDICT_ACTIVE,
  BILI_VERDICT_GLOBAL,
  isBiliExpected,
  isBiliKillSwitched,
  isBiliVerdictActive,
  resolveStandDown,
} from '../src/agent-preset/billion-context.js'
import { ARYA_IMAGE_PLAN_SECTION } from '../src/agent-preset/plan-section.js'
import { apply as applyToolset } from '../src/agent-preset/toolset.js'
import { mountAgentPreset } from '../src/agent-preset/register.js'
import { IMAGE_TOOL_NAME_LIST } from '../src/shared.js'

/**
 * The ordered top-level rows the shipped DSH standard preset mounts, from
 * `AryaCode/packages/bundle/web-app/presets/standard.patch.yml` at the DSH
 * version this plugin targets. Arya Image is that list minus the AryaCode
 * `arya-review-skills` lens row. The baseline is a different repository, so the
 * expectation is copied here rather than read at test time.
 */
const BASELINE_ROW_IDS = [
  'persona',
  'agent-instructions',
  'time-context',
  'tool-bash',
  'tool-pwsh',
  'tool-fs',
  'tool-fs-search',
  'tool-jobs',
  'tool-schedule',
  'skill-filesystem',
  'tool-skill',
  'command-goal',
  'tool-goal',
  'planning',
  'compaction',
  'delegation',
  'tool-ask-user',
  'tool-todo',
  'tool-web',
  'present',
  'tool-plugin-manager',
  'tool-plugin-market',
]

/** The module each shipped row mounts, keyed by row id. */
const BASELINE_MODULES: Record<string, string> = {
  'persona': '@deepseek-ai/dsh-persona',
  'agent-instructions': '@deepseek-ai/dsh-agent-instructions',
  'time-context': '@deepseek-ai/dsh-time-context',
  'tool-bash': '@deepseek-ai/dsh-tool-bash',
  'tool-pwsh': '@deepseek-ai/dsh-tool-pwsh',
  'tool-fs': '@deepseek-ai/dsh-tool-fs',
  'tool-fs-search': '@deepseek-ai/dsh-tool-fs-search',
  'tool-jobs': '@deepseek-ai/dsh-tool-jobs',
  'tool-schedule': '@deepseek-ai/dsh-tool-schedule',
  'skill-filesystem': '@deepseek-ai/dsh-skill-filesystem',
  'tool-skill': '@deepseek-ai/dsh-tool-skill',
  'command-goal': '@deepseek-ai/dsh-command-goal',
  'tool-goal': '@deepseek-ai/dsh-tool-goal',
  'planning': 'cordis:group',
  'compaction': 'cordis:group',
  'delegation': 'cordis:group',
  'tool-ask-user': '@deepseek-ai/dsh-tool-ask-user',
  'tool-todo': '@deepseek-ai/dsh-tool-todo',
  'tool-web': '@deepseek-ai/dsh-tool-web',
  'present': '@deepseek-ai/dsh-tool-present',
  'tool-plugin-manager': '@deepseek-ai/dsh-plugin-manager/tools',
  'tool-plugin-market': '@deepseek-ai/dsh-plugin-market/tools',
}

/** Child rows of a `cordis:group` row, read through the row's untyped config. */
function childrenOf(row: PresetRow | undefined): PresetRow[] {
  expect(row?.group).toBe(true)
  return row?.config as PresetRow[]
}

describe('arya-image preset definition', () => {
  it('registers under a stable id, name and picker order', () => {
    const definition = buildAgentPresetDefinition({ platform: 'win32' })
    expect(definition.id).toBe(ARYA_IMAGE_PRESET_ID)
    expect(definition.id).toBe('arya-image')
    expect(definition.name).toBe(ARYA_IMAGE_PRESET_NAME)
    expect(definition.order).toBe(ARYA_IMAGE_PRESET_ORDER)
    expect(definition.description.length).toBeGreaterThan(0)
  })

  it('mounts the shipped standard rows in the shipped order', () => {
    const definition = buildAgentPresetDefinition({ platform: 'win32' })
    expect(definition.plugins.map(row => row.id)).toEqual(BASELINE_ROW_IDS)
    expect(definition.plugins).toHaveLength(BASELINE_ROW_IDS.length)
  })

  it('mounts every shipped module under its shipped row id', () => {
    const definition = buildAgentPresetDefinition({ platform: 'win32' })
    expect(Object.fromEntries(definition.plugins.map(row => [row.id, row.name]))).toEqual(BASELINE_MODULES)
  })

  it('gives every top-level row a unique id', () => {
    const ids = presetToolRows('win32').map(row => row.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('mounts the planning group with a non-empty shipped plan-mode section', () => {
    // A missing or empty section is a load failure for the whole preset:
    // `PlanModeConfig needs a string `section``.
    const planning = presetToolRows('win32').find(row => row.id === 'planning')
    expect(planning?.name).toBe('cordis:group')
    expect(planning?.isolate).toEqual({ planMode: true })
    const children = childrenOf(planning)
    expect(children.map(child => child.id)).toEqual(['plan-mode'])
    expect(children[0]?.name).toBe('@deepseek-ai/dsh-plan-mode')
    const section = (children[0]?.config as { section?: unknown } | undefined)?.section
    expect(typeof section).toBe('string')
    expect((section as string).trim().length).toBeGreaterThan(0)
    expect(section).toBe(ARYA_IMAGE_PLAN_SECTION)
  })

  it('keeps the harness default compaction group', () => {
    const compaction = presetToolRows('win32').find(row => row.id === 'compaction')
    expect(compaction?.isolate).toEqual({ compaction: true, toolResultPruner: true })
    expect(childrenOf(compaction)).toEqual([
      { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' },
      { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' },
      {
        id: 'tool-result-pruner',
        name: '@deepseek-ai/dsh-compaction-tool-result-pruner',
        config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 },
      },
    ])
  })

  it('stands the two summary rows down when billion-context owns compaction', () => {
    const compaction = presetToolRows('win32', false, true).find(row => row.id === 'compaction')
    expect(childrenOf(compaction)).toEqual([
      { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic', disabled: true },
      { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact', disabled: true },
      {
        id: 'tool-result-pruner',
        name: '@deepseek-ai/dsh-compaction-tool-result-pruner',
        config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 },
      },
    ])
  })

  it('changes nothing outside the two summary rows when standing down', () => {
    const standing = presetToolRows('win32', false, true)
    const defaultRows = presetToolRows('win32', false, false)
    expect(standing.map(row => row.id)).toEqual(defaultRows.map(row => row.id))
    expect(standing.filter(row => row.id !== 'compaction')).toEqual(defaultRows.filter(row => row.id !== 'compaction'))
    // The pruner keeps pruning either way.
    const pruner = childrenOf(standing.find(row => row.id === 'compaction')).find(child => child.id === 'tool-result-pruner')
    expect(pruner?.disabled).toBeUndefined()
  })

  it('carries the stand-down decision through the definition builder', () => {
    const definition = buildAgentPresetDefinition({ platform: 'win32', standDownCompaction: true })
    const compaction = definition.plugins.find(row => row.id === 'compaction')
    expect(childrenOf(compaction).filter(child => child.disabled === true).map(child => child.id)).toEqual([
      'compaction-basic',
      'command-compact',
    ])
    const defaultDefinition = buildAgentPresetDefinition({ platform: 'win32' })
    const defaultCompaction = defaultDefinition.plugins.find(row => row.id === 'compaction')
    expect(childrenOf(defaultCompaction).every(child => child.disabled === undefined)).toBe(true)
  })

  it('mounts the delegation group with the shipped children and providers', () => {
    const delegation = presetToolRows('win32').find(row => row.id === 'delegation')
    expect(delegation?.name).toBe('cordis:group')
    expect(delegation?.isolate).toEqual({ workflowEngine: true })
    const children = childrenOf(delegation)
    expect(children.map(child => child.id)).toEqual([
      'tool-subagent-control',
      'tool-subagent',
      'tool-subagent-fork',
      'workflow-ptc',
      'tool-workflow',
    ])
    expect(children.map(child => child.name)).toEqual([
      '@deepseek-ai/dsh-tool-subagent-control',
      '@deepseek-ai/dsh-tool-subagent',
      '@deepseek-ai/dsh-tool-subagent',
      '@deepseek-ai/dsh-workflow-ptc',
      '@deepseek-ai/dsh-tool-workflow',
    ])
    const configs = children.map(child => (child.config ?? {}) as { provider?: string; toolName?: string })
    expect(configs.map(config => config.provider)).toEqual([undefined, 'spawn', 'fork', 'spawn', undefined])
    expect(configs.map(config => config.toolName)).toEqual([undefined, 'subagent', 'subagent_fork', undefined, undefined])
  })

  it('mounts the plugin-manager row only when the host exposes profileContext', () => {
    // Absent profileContext service -> disabled, exactly like the shipped row.
    expect(presetToolRows('win32').find(row => row.id === 'tool-plugin-manager')?.disabled).toBe(true)
    const enabled = presetToolRows('win32', true).find(row => row.id === 'tool-plugin-manager')
    expect(enabled?.name).toBe('@deepseek-ai/dsh-plugin-manager/tools')
    expect(enabled?.disabled).toBe(false)
  })

  it('keeps the plugin-market row disabled', () => {
    for (const rows of [presetToolRows('win32'), presetToolRows('win32', true)]) {
      const market = rows.find(row => row.id === 'tool-plugin-market')
      expect(market?.name).toBe('@deepseek-ai/dsh-plugin-market/tools')
      expect(market?.disabled).toBe(true)
    }
  })

  it('carries an image-focused persona without replacing the runtime context', () => {
    const persona = buildAgentPresetDefinition({ platform: 'win32' }).plugins[0]
    const config = persona?.config as { prefix: string; complete: boolean; includeRuntimeContext: boolean }
    expect(config.prefix).toContain('Arya')
    expect(config.prefix.length).toBeGreaterThan(100)
    expect(config.complete).toBe(false)
    expect(config.includeRuntimeContext).toBe(true)
  })

  it('mounts the web rows reference hunting needs', () => {
    const web = presetToolRows('win32').find(row => row.id === 'tool-web')
    expect(web?.name).toBe('@deepseek-ai/dsh-tool-web')
    expect(web?.config).toEqual({ fetch: true, searchTimeoutMs: 60_000 })
    expect(web?.disabled).toBeUndefined()
  })

  it('switches the shell with disabled rows instead of picking one', () => {
    const windows = presetToolRows('win32')
    expect(windows.find(row => row.id === 'tool-bash')?.disabled).toBe(true)
    expect(windows.find(row => row.id === 'tool-pwsh')?.disabled).toBe(false)

    const linux = presetToolRows('linux')
    expect(linux.find(row => row.id === 'tool-bash')?.disabled).toBe(false)
    expect(linux.find(row => row.id === 'tool-pwsh')?.disabled).toBe(true)
  })
})

/**
 * Fake host for the billion-context resolver.
 *
 * `gateAfterWaits` and `verdictAfterWaits` place the gate service and the active
 * verdict a fixed number of polls into the wait, so the poll path is exercised
 * without a real timer.
 */
function biliHarness(options: {
  env?: Readonly<Record<string, string | undefined>>
  profileContext?: unknown
  gate?: boolean
  gateAfterWaits?: number
  verdict?: string
  verdictAfterWaits?: number
  sleepThrows?: boolean
} = {}) {
  const sleeps: number[] = []
  const info = vi.fn()
  const warn = vi.fn()
  const scope: Record<string, unknown> = {}
  if (options.verdict !== undefined) scope[BILI_VERDICT_GLOBAL] = options.verdict
  let gateVisible = options.gate === true
  if (options.verdictAfterWaits === 0) scope[BILI_VERDICT_GLOBAL] = BILI_VERDICT_ACTIVE
  const host = {
    get: (name: string) => {
      if (name === BILI_GATE_SERVICE) return gateVisible ? {} : undefined
      if (name === 'profileContext') return options.profileContext
      return undefined
    },
    logger: { info, warn },
  }
  const sleep = vi.fn(async (milliseconds: number) => {
    if (options.sleepThrows === true) throw new Error('poll timer broke')
    sleeps.push(milliseconds)
    if (options.gateAfterWaits !== undefined && sleeps.length >= options.gateAfterWaits) gateVisible = true
    if (options.verdictAfterWaits !== undefined && sleeps.length >= options.verdictAfterWaits) {
      scope[BILI_VERDICT_GLOBAL] = BILI_VERDICT_ACTIVE
    }
  })
  const promise = resolveStandDown(host, {
    env: options.env ?? {},
    profileContext: options.profileContext,
    scope,
    sleep,
  })
  return { promise, sleeps, info, warn }
}

describe('billion-context compaction stand-down', () => {
  it('stands down immediately when the gate and verdict are already active, without profileContext', async () => {
    // A direct or custom bili row may never appear in the profile's started
    // bundles or overlays; the proven gate and verdict are enough on their own.
    const run = biliHarness({ env: {}, gate: true, verdictAfterWaits: 0 })
    await expect(run.promise).resolves.toBe(true)
    expect(run.sleeps).toEqual([])
    expect(run.info).toHaveBeenCalledTimes(1)
    expect(run.warn).not.toHaveBeenCalled()
  })

  it('answers no without waiting when billion-context is not expected and no gate is live', async () => {
    const run = biliHarness({ env: {} })
    await expect(run.promise).resolves.toBe(false)
    expect(run.sleeps).toEqual([])
    expect(run.warn).not.toHaveBeenCalled()
  })

  it('uses a settled gate and active verdict with no waiting', async () => {
    const run = biliHarness({ env: { BILLION_CONTEXT_ATTACH: '1' }, gate: true, verdictAfterWaits: 0 })
    await expect(run.promise).resolves.toBe(true)
    expect(run.sleeps).toEqual([])
    expect(run.warn).not.toHaveBeenCalled()
  })

  it.each(['BILLION_CONTEXT_PLUGIN', 'BILI_NATIVE_DSH'])(
    'honours the %s=0 kill switch even with an active gate and verdict',
    async (name) => {
      const run = biliHarness({ env: { [name]: '0', BILLION_CONTEXT_ATTACH: '1' }, gate: true, verdictAfterWaits: 0 })
      await expect(run.promise).resolves.toBe(false)
      expect(run.sleeps).toEqual([])
      expect(run.warn).not.toHaveBeenCalled()
    },
  )

  it('honours a defined BILI_PROVIDER_REWRITES as a kill switch', async () => {
    const run = biliHarness({ env: { BILI_PROVIDER_REWRITES: '1' }, gate: true, verdictAfterWaits: 0 })
    await expect(run.promise).resolves.toBe(false)
  })

  it('waits for a late gate and verdict when the started bundles name billion-context', async () => {
    const run = biliHarness({
      profileContext: { startedBundles: ['billion-context'] },
      gateAfterWaits: 2,
      verdictAfterWaits: 4,
    })
    await expect(run.promise).resolves.toBe(true)
    expect(run.sleeps).toEqual([BILI_TIMING.pollMs, BILI_TIMING.pollMs, BILI_TIMING.pollMs, BILI_TIMING.pollMs])
    expect(run.info).toHaveBeenCalledTimes(1)
  })

  it('recognises billion-context from a profile overlay', async () => {
    const run = biliHarness({
      profileContext: { overlays: [{ insert: [{ id: 'billion-context', name: 'billion-context' }] }] },
      gateAfterWaits: 1,
      verdictAfterWaits: 1,
    })
    await expect(run.promise).resolves.toBe(true)
    expect(run.sleeps).toEqual([BILI_TIMING.pollMs])
  })

  it.each(['BILLION_CONTEXT_PROXY', 'BILLION_CONTEXT_ATTACH'])(
    'recognises an attaching billion-context through %s',
    async (name) => {
      const run = biliHarness({ env: { [name]: '1' }, gateAfterWaits: 1, verdictAfterWaits: 1 })
      await expect(run.promise).resolves.toBe(true)
    },
  )

  it('keeps the rows and warns exactly once when the gate never appears', async () => {
    const run = biliHarness({ env: { BILLION_CONTEXT_ATTACH: '1' } })
    await expect(run.promise).resolves.toBe(false)
    expect(run.sleeps).toHaveLength(BILI_TIMING.gateMs / BILI_TIMING.pollMs)
    expect(run.warn).toHaveBeenCalledTimes(1)
    expect(run.warn).toHaveBeenCalledWith(BILI_STAND_DOWN_WARNING)
    expect(run.info).not.toHaveBeenCalled()
  })

  it('keeps the rows and warns exactly once when the verdict never turns active', async () => {
    const run = biliHarness({ env: { BILLION_CONTEXT_ATTACH: '1' }, gate: true })
    await expect(run.promise).resolves.toBe(false)
    expect(run.sleeps).toHaveLength(BILI_TIMING.verdictMs / BILI_TIMING.pollMs)
    expect(run.warn).toHaveBeenCalledTimes(1)
    expect(run.warn).toHaveBeenCalledWith(BILI_STAND_DOWN_WARNING)
  })

  it('keeps the rows when the verdict is a non-active string', async () => {
    const run = biliHarness({ env: { BILLION_CONTEXT_ATTACH: '1' }, gate: true, verdict: 'inactive' })
    await expect(run.promise).resolves.toBe(false)
    expect(run.warn).toHaveBeenCalledTimes(1)
  })

  it('never throws and keeps the rows when polling fails', async () => {
    const run = biliHarness({ env: { BILLION_CONTEXT_ATTACH: '1' }, sleepThrows: true })
    await expect(run.promise).resolves.toBe(false)
    expect(run.warn).toHaveBeenCalledTimes(1)
  })
})

describe('billion-context signals', () => {
  it.each([
    [{ BILLION_CONTEXT_PLUGIN: '0' }, true],
    [{ BILI_NATIVE_DSH: '0' }, true],
    [{ BILLION_CONTEXT_PLUGIN: '1' }, false],
    [{ BILI_NATIVE_DSH: '1' }, false],
    [{ BILI_PROVIDER_REWRITES: '1' }, true],
    [{ BILI_PROVIDER_REWRITES: '0' }, true],
    [{}, false],
  ])('reads kill switches from %j as %s', (env: Record<string, string>, killed: boolean) => {
    expect(isBiliKillSwitched(env)).toBe(killed)
  })

  it('expects billion-context from the environment, profile bundles or an overlay', () => {
    expect(isBiliExpected(undefined, { BILLION_CONTEXT_PROXY: 'http://127.0.0.1:9876' })).toBe(true)
    expect(isBiliExpected(undefined, { BILLION_CONTEXT_ATTACH: '1' })).toBe(true)
    expect(isBiliExpected({ startedBundles: ['billion-context'] }, {})).toBe(true)
    expect(isBiliExpected({ startedBundles: ['arya-standard'] }, {})).toBe(false)
    expect(isBiliExpected({ overlays: [{ insert: [{ name: 'billion-context' }] }] }, {})).toBe(true)
    expect(isBiliExpected(undefined, {})).toBe(false)
  })

  it('lets the kill switches outrank the attach variables', () => {
    expect(isBiliExpected({ startedBundles: ['billion-context'] }, { BILLION_CONTEXT_PLUGIN: '0' })).toBe(false)
    expect(isBiliExpected(undefined, { BILLION_CONTEXT_ATTACH: '1', BILI_PROVIDER_REWRITES: '1' })).toBe(false)
  })

  it('only accepts the exact active verdict', () => {
    expect(isBiliVerdictActive({ [BILI_VERDICT_GLOBAL]: BILI_VERDICT_ACTIVE })).toBe(true)
    expect(isBiliVerdictActive({ [BILI_VERDICT_GLOBAL]: 'idle' })).toBe(false)
    expect(isBiliVerdictActive({})).toBe(false)
    expect(isBiliVerdictActive(null)).toBe(false)
  })
})

describe('plan-mode section', () => {
  it('carries the shipped standard text, paragraph for paragraph', () => {
    expect(ARYA_IMAGE_PLAN_SECTION.startsWith('You are in plan mode.')).toBe(true)
    expect(ARYA_IMAGE_PLAN_SECTION.endsWith('do not proceed with implementation.\n')).toBe(true)
    expect(ARYA_IMAGE_PLAN_SECTION.trim().split('\n\n')).toHaveLength(6)
  })
})

describe('image tool names', () => {
  it('match the tools the Bundle registers', () => {
    expect([...IMAGE_TOOL_NAME_LIST]).toEqual([
      'generate_image',
      'generate_images',
      'edit_image',
      'find_inspiration',
      'import_reference_image',
      'list_workflows',
      'canvas_state',
      'view_canvas',
    ])
  })
})

/**
 * Minimal Context stand-in for the tool-mask row.
 *
 * `known` is what the registry will accept; any other name in the filter makes
 * `restrict()` throw the way the real one does, listing the offenders.
 */
function toolsetHarness(options: { known?: string[]; throwWithoutNames?: string } = {}) {
  const known = new Set(options.known ?? [])
  const restrict = vi.fn((filter: { allow: readonly string[] }) => {
    if (options.throwWithoutNames !== undefined) throw new Error(options.throwWithoutNames)
    const unknown = filter.allow.filter(name => !known.has(name))
    if (unknown.length > 0) {
      throw new Error(`tools.restrict() names unknown global tool${unknown.length > 1 ? 's' : ''} ${unknown.map(name => `"${name}"`).join(', ')}; known global tools: ${[...known].sort().join(', ') || '(none)'}`)
    }
    return () => {}
  })
  const effect = vi.fn((callback: () => () => void) => { callback() })
  const info = vi.fn()
  const warn = vi.fn()
  const ctx = { logger: { info, warn }, tools: { restrict }, effect }
  return { ctx, restrict, effect, info, warn }
}

describe('arya-image tool mask row', () => {
  it('declares the tools service, which a preset row cannot otherwise reach', () => {
    // Without this the host reports the whole preset broken:
    // `arya-image-toolset (…): cannot get property "tools" without inject`.
    expect((applyToolset as unknown as { inject: string[] }).inject).toEqual(['tools'])
  })

  it('applies the whole allow list when the registry knows every name', () => {
    const h = toolsetHarness({ known: ['generate_image', 'read', 'pwsh', 'web_search'] })
    applyToolset(h.ctx as never, { allow: ['generate_image', 'read', 'pwsh', 'web_search'] })
    expect(h.restrict).toHaveBeenCalledTimes(1)
    expect(h.restrict.mock.calls[0][0]).toEqual({ allow: ['generate_image', 'read', 'pwsh', 'web_search'] })
    expect(h.info).not.toHaveBeenCalled()
  })

  it('drops exactly the names the registry calls unknown and retries', () => {
    // The real case: a host without tool-web refuses the filter rather than
    // quietly ignoring `web_search`.
    const h = toolsetHarness({ known: ['generate_image', 'read', 'pwsh'] })
    applyToolset(h.ctx as never, { allow: ['generate_image', 'read', 'pwsh', 'web_search', 'web_fetch'] })
    expect(h.restrict).toHaveBeenCalledTimes(2)
    expect(h.restrict.mock.calls[1][0]).toEqual({ allow: ['generate_image', 'read', 'pwsh'] })
    expect(h.info).toHaveBeenCalledWith(expect.stringContaining('web_search'))
    expect(h.info).toHaveBeenCalledWith(expect.stringContaining('web_fetch'))
  })

  it('does nothing when no allow list is configured', () => {
    const h = toolsetHarness({ known: ['read'] })
    applyToolset(h.ctx as never, {})
    expect(h.restrict).not.toHaveBeenCalled()
  })

  it('leaves the tool set untouched when the registry knows none of the names', () => {
    const h = toolsetHarness({ known: [] })
    applyToolset(h.ctx as never, { allow: ['generate_image'] })
    expect(h.restrict).toHaveBeenCalledTimes(1)
    expect(h.warn).toHaveBeenCalledTimes(1)
  })

  it('fails open when the registry refuses the restriction without naming tools', () => {
    const h = toolsetHarness({ throwWithoutNames: 'tools.restrict() requires a scoped context' })
    expect(() => applyToolset(h.ctx as never, { allow: ['read'] })).not.toThrow()
    expect(h.warn).toHaveBeenCalledWith(expect.stringContaining('scoped context'))
  })

  it('deduplicates repeated names', () => {
    const h = toolsetHarness({ known: ['read'] })
    applyToolset(h.ctx as never, { allow: ['read', 'read', 'read'] })
    expect(h.restrict.mock.calls[0][0]).toEqual({ allow: ['read'] })
  })
})

/** Minimal Context stand-in for preset registration. */
function registerHarness(options: {
  registry?: unknown
  profileContext?: unknown
  services?: Record<string, unknown>
} = {}) {
  const effect = vi.fn((callback: () => () => void) => { callback() })
  const info = vi.fn()
  const warn = vi.fn()
  const ctx = {
    logger: { info, warn },
    effect,
    // The mount point reads the services through `ctx.get`, exactly as the
    // AryaCode presets do; a missing service is reported, not thrown.
    get: (name: string) => {
      if (name === 'agentPresets') return options.registry
      if (name === 'profileContext') return options.profileContext
      return options.services?.[name]
    },
  }
  return { ctx, effect, info, warn }
}

/** The definition a registration harness captured, or undefined. */
function registeredDefinition(register: ReturnType<typeof vi.fn>): { plugins: PresetRow[] } | undefined {
  return register.mock.calls[0]?.[0] as { plugins: PresetRow[] } | undefined
}

/** The compaction group a registration harness captured, or undefined. */
function registeredCompaction(register: ReturnType<typeof vi.fn>): PresetRow | undefined {
  return registeredDefinition(register)?.plugins.find(row => row.id === 'compaction')
}

describe('arya-image preset registration', () => {
  // Deterministic no-bili environment: the plugin switches are on, there is no
  // attach proxy and no provider-rewrites switch. These tests never depend on
  // the machine's environment or on a real timer.
  beforeEach(() => {
    vi.stubEnv('BILLION_CONTEXT_PLUGIN', '1')
    vi.stubEnv('BILI_NATIVE_DSH', '1')
    vi.stubEnv('BILLION_CONTEXT_PROXY', '')
    vi.stubEnv('BILLION_CONTEXT_ATTACH', '')
    vi.stubEnv('BILI_PROVIDER_REWRITES', undefined)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('declares the registry as an inject dependency so the Loader waits for it', () => {
    expect((mountAgentPreset as unknown as { inject: string[] }).inject).toEqual(['agentPresets'])
  })

  it('registers once against the host registry and releases with the fiber', async () => {
    const release = vi.fn()
    const register = vi.fn(async () => release)
    const h = registerHarness({ registry: { register } })
    await mountAgentPreset(h.ctx as never, { platform: 'win32' })
    expect(register).toHaveBeenCalledTimes(1)
    expect(register.mock.calls[0][0]).toMatchObject({ id: 'arya-image' })
    // The fiber's disposer releases the registered definition.
    const dispose = h.effect.mock.calls[0][0]()
    dispose()
    expect(release).toHaveBeenCalledTimes(1)
    expect(h.info).toHaveBeenCalledWith(expect.stringContaining('registered arya-image'))
  })

  it('registers the harness default compaction rows when billion-context is absent', async () => {
    const register = vi.fn(async () => vi.fn())
    await mountAgentPreset(registerHarness({ registry: { register } }).ctx as never, { platform: 'win32' })
    expect(childrenOf(registeredCompaction(register)).every(child => child.disabled === undefined)).toBe(true)
  })

  it('registers the compaction summary rows disabled when billion-context owns compaction', async () => {
    vi.stubGlobal(BILI_VERDICT_GLOBAL, BILI_VERDICT_ACTIVE)
    const register = vi.fn(async () => vi.fn())
    const h = registerHarness({
      registry: { register },
      profileContext: { startedBundles: ['billion-context'] },
      services: { [BILI_GATE_SERVICE]: {} },
    })
    await mountAgentPreset(h.ctx as never, { platform: 'win32' })
    const children = childrenOf(registeredCompaction(register))
    expect(children.filter(child => child.disabled === true).map(child => child.id)).toEqual([
      'compaction-basic',
      'command-compact',
    ])
    expect(children.find(child => child.id === 'tool-result-pruner')?.disabled).toBeUndefined()
    // The stand-down removes no row: the full baseline is still registered.
    expect(registeredDefinition(register)?.plugins.map(row => row.id)).toEqual(BASELINE_ROW_IDS)
  })

  it('skips registration when the fiber is disposed while the compaction decision settles', async () => {
    const register = vi.fn(async () => vi.fn())
    const h = registerHarness({ registry: { register } })
    const mounting = mountAgentPreset(h.ctx as never, { platform: 'win32' })
    // The disposer exists synchronously, before the awaited decision resolves.
    const dispose = h.effect.mock.calls[0][0]()
    dispose()
    await mounting
    expect(register).not.toHaveBeenCalled()
    expect(h.info).toHaveBeenCalledWith(expect.stringContaining('nothing to register'))
  })

  it('passes the host profileContext service into the definition', async () => {
    // A composition that provides profileContext gets the manager row enabled;
    // one that does not keeps it disabled, exactly like the shipped preset.
    const without = vi.fn(async () => vi.fn())
    await mountAgentPreset(registerHarness({ registry: { register: without } }).ctx as never, { platform: 'win32' })
    expect(registeredDefinition(without)?.plugins.find(row => row.id === 'tool-plugin-manager')?.disabled).toBe(true)

    const withService = vi.fn(async () => vi.fn())
    await mountAgentPreset(
      registerHarness({ registry: { register: withService }, profileContext: {} }).ctx as never,
      { platform: 'win32' },
    )
    expect(registeredDefinition(withService)?.plugins.find(row => row.id === 'tool-plugin-manager')?.disabled).toBe(false)
  })

  it('stays silent on a composition with no preset registry', async () => {
    const h = registerHarness()
    await expect(mountAgentPreset(h.ctx as never, { platform: 'win32' })).resolves.toBeUndefined()
    expect(h.info).toHaveBeenCalled()
  })

  it('logs a rejected registration instead of failing the plugin', async () => {
    const register = vi.fn(async () => { throw new Error('duplicate preset id') })
    const h = registerHarness({ registry: { register } })
    await mountAgentPreset(h.ctx as never, { platform: 'win32' })
    expect(h.warn).toHaveBeenCalledWith(expect.stringContaining('duplicate preset id'))
  })
})
