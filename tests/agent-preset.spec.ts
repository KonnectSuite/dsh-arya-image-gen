import { describe, expect, it, vi } from 'vitest'
import {
  ARYA_IMAGE_PRESET_ID,
  ARYA_IMAGE_PRESET_NAME,
  ARYA_IMAGE_PRESET_ORDER,
  ARYA_IMAGE_TOOLSET_MODULE,
  ARYA_IMAGE_TOOLSET_ROW_ID,
  agentPresetAllowList,
  buildAgentPresetDefinition,
} from '../src/agent-preset/definition.js'
import { apply as applyToolset } from '../src/agent-preset/toolset.js'
import { registerAgentPreset } from '../src/agent-preset/register.js'
import { coreToolNames, IMAGE_TOOL_NAME_LIST } from '../src/shared.js'

describe('arya-image preset definition', () => {
  it('registers under a stable id, name and picker order', () => {
    const definition = buildAgentPresetDefinition({ platform: 'win32' })
    expect(definition.id).toBe(ARYA_IMAGE_PRESET_ID)
    expect(definition.id).toBe('arya-image')
    expect(definition.name).toBe(ARYA_IMAGE_PRESET_NAME)
    expect(definition.order).toBe(ARYA_IMAGE_PRESET_ORDER)
    expect(definition.description.length).toBeGreaterThan(0)
  })

  it('mounts exactly the persona, the two preset-only core tools and the mask row', () => {
    const definition = buildAgentPresetDefinition({ platform: 'win32' })
    expect(definition.plugins.map(row => row.id)).toEqual([
      'persona',
      'tool-ask-user',
      'present',
      ARYA_IMAGE_TOOLSET_ROW_ID,
    ])
    const toolset = definition.plugins.at(-1)
    expect(toolset?.name).toBe(ARYA_IMAGE_TOOLSET_MODULE)
  })

  it('carries an image-focused persona without replacing the runtime context', () => {
    const persona = buildAgentPresetDefinition({ platform: 'win32' }).plugins[0]
    const config = persona?.config as { prefix: string; complete: boolean; includeRuntimeContext: boolean }
    expect(config.prefix).toContain('Arya')
    expect(config.prefix.length).toBeGreaterThan(100)
    expect(config.complete).toBe(false)
    expect(config.includeRuntimeContext).toBe(true)
  })

  it('hands the mask the image tools plus the platform core set', () => {
    const toolset = buildAgentPresetDefinition({ platform: 'win32' }).plugins.at(-1)
    const allow = (toolset?.config as { allow: string[] }).allow
    expect(allow.slice(0, IMAGE_TOOL_NAME_LIST.length)).toEqual([...IMAGE_TOOL_NAME_LIST])
    expect(allow).toContain('pwsh')
    expect(allow).not.toContain('bash')
    expect(allow).not.toContain('web_search')
    expect(allow).not.toContain('subagent')
  })

  it('switches the shell name with the platform', () => {
    expect(agentPresetAllowList('linux')).toContain('bash')
    expect(agentPresetAllowList('linux')).not.toContain('pwsh')
  })
})

describe('image tool names', () => {
  it('match the tools the Bundle registers', () => {
    expect([...IMAGE_TOOL_NAME_LIST]).toEqual([
      'generate_image',
      'generate_images',
      'edit_image',
      'find_inspiration',
      'render_html',
      'render_svg',
      'list_render_templates',
      'canvas_state',
      'view_canvas',
    ])
  })

  it('keep every core name spellable', () => {
    expect(coreToolNames('win32')).toEqual([
      'read', 'write', 'edit', 'glob', 'grep', 'pwsh',
      'job_list', 'job_output', 'job_kill', 'todo_write',
    ])
  })
})

/** Minimal Context stand-in for the tool-mask row. */
function toolsetHarness(options: { present?: string[]; restrictThrows?: boolean } = {}) {
  const present = new Set(options.present ?? [])
  const restrict = vi.fn((_filter: { allow: readonly string[] }) => {
    if (options.restrictThrows === true) throw new Error('no agent scope')
    return () => {}
  })
  const effect = vi.fn((callback: () => () => void) => { callback() })
  const info = vi.fn()
  const warn = vi.fn()
  const ctx = {
    logger: { info, warn },
    tools: { get: (name: string) => (present.has(name) ? { name } : undefined), restrict },
    effect,
  }
  return { ctx, restrict, effect, info, warn }
}

describe('arya-image tool mask row', () => {
  it('restricts to the allow list, keeping only tools the host actually has', () => {
    const h = toolsetHarness({ present: ['generate_image', 'read', 'pwsh'] })
    applyToolset(h.ctx as never, { allow: ['generate_image', 'read', 'pwsh', 'web_search'] })
    expect(h.restrict).toHaveBeenCalledTimes(1)
    expect(h.restrict.mock.calls[0][0]).toEqual({ allow: ['generate_image', 'read', 'pwsh'] })
    expect(h.info).toHaveBeenCalledWith(expect.stringContaining('web_search'))
  })

  it('does nothing when no allow list is configured', () => {
    const h = toolsetHarness({ present: ['read'] })
    applyToolset(h.ctx as never, {})
    expect(h.restrict).not.toHaveBeenCalled()
  })

  it('leaves the tool set untouched when none of the names exist', () => {
    const h = toolsetHarness({ present: [] })
    applyToolset(h.ctx as never, { allow: ['generate_image'] })
    expect(h.restrict).not.toHaveBeenCalled()
    expect(h.warn).toHaveBeenCalledTimes(1)
  })

  it('fails open when the registry refuses the restriction', () => {
    const h = toolsetHarness({ present: ['read'], restrictThrows: true })
    expect(() => applyToolset(h.ctx as never, { allow: ['read'] })).not.toThrow()
    expect(h.warn).toHaveBeenCalledWith(expect.stringContaining('no agent scope'))
  })

  it('deduplicates repeated names', () => {
    const h = toolsetHarness({ present: ['read'] })
    applyToolset(h.ctx as never, { allow: ['read', 'read', 'read'] })
    expect(h.restrict.mock.calls[0][0]).toEqual({ allow: ['read'] })
  })
})

/** Minimal Context stand-in for preset registration. */
function registerHarness(options: { registry?: unknown } = {}) {
  const effect = vi.fn((callback: () => () => void) => { callback() })
  const info = vi.fn()
  const warn = vi.fn()
  const injected: string[][] = []
  const presetCtx = {
    agentPresets: options.registry,
    effect,
    logger: { info, warn },
  }
  const ctx = {
    logger: { info, warn },
    inject: (names: string[], callback: (inner: unknown) => void) => { injected.push(names); callback(presetCtx) },
  }
  return { ctx, presetCtx, injected, info, warn }
}

describe('arya-image preset registration', () => {
  it('registers once against the host registry and releases with the fiber', async () => {
    const release = vi.fn()
    const register = vi.fn(async () => release)
    const h = registerHarness({ registry: { register } })
    registerAgentPreset(h.ctx as never, buildAgentPresetDefinition({ platform: 'win32' }))
    expect(h.injected[0]).toEqual(['agentPresets'])
    expect(register).toHaveBeenCalledTimes(1)
    expect(register.mock.calls[0][0]).toMatchObject({ id: 'arya-image' })
    // The fiber's disposer releases the registered definition.
    const dispose = h.presetCtx.effect.mock.calls[0][0]()
    await Promise.resolve()
    await Promise.resolve()
    dispose()
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('stays silent on a composition with no preset registry', () => {
    const h = registerHarness()
    expect(() => registerAgentPreset(h.ctx as never, buildAgentPresetDefinition({ platform: 'win32' }))).not.toThrow()
    expect(h.info).toHaveBeenCalled()
  })

  it('logs a rejected registration instead of failing the plugin', async () => {
    const register = vi.fn(async () => { throw new Error('duplicate preset id') })
    const h = registerHarness({ registry: { register } })
    registerAgentPreset(h.ctx as never, buildAgentPresetDefinition({ platform: 'win32' }))
    await Promise.resolve()
    await Promise.resolve()
    expect(h.warn).toHaveBeenCalledWith(expect.stringContaining('duplicate preset id'))
  })
})
