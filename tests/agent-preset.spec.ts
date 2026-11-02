import { describe, expect, it, vi } from 'vitest'
import {
  ARYA_IMAGE_PRESET_ID,
  ARYA_IMAGE_PRESET_NAME,
  ARYA_IMAGE_PRESET_ORDER,
  ARYA_IMAGE_TOOLSET_MODULE,
  ARYA_IMAGE_TOOLSET_ROW_ID,
  agentPresetAllowList,
  buildAgentPresetDefinition,
  presetToolNames,
} from '../src/agent-preset/definition.js'
import { apply as applyToolset } from '../src/agent-preset/toolset.js'
import { mountAgentPreset } from '../src/agent-preset/register.js'
import { IMAGE_TOOL_NAME_LIST } from '../src/shared.js'

describe('arya-image preset definition', () => {
  it('registers under a stable id, name and picker order', () => {
    const definition = buildAgentPresetDefinition({ platform: 'win32' })
    expect(definition.id).toBe(ARYA_IMAGE_PRESET_ID)
    expect(definition.id).toBe('arya-image')
    expect(definition.name).toBe(ARYA_IMAGE_PRESET_NAME)
    expect(definition.order).toBe(ARYA_IMAGE_PRESET_ORDER)
    expect(definition.description.length).toBeGreaterThan(0)
  })

  it('mounts the persona, the two preset-only tools and the mask row', () => {
    const definition = buildAgentPresetDefinition({ platform: 'win32' })
    expect(definition.plugins.map(row => row.id)).toEqual([
      'persona',
      'tool-ask-user',
      'present',
      ARYA_IMAGE_TOOLSET_ROW_ID,
    ])
    expect(definition.plugins.at(-1)?.name).toBe(ARYA_IMAGE_TOOLSET_MODULE)
  })

  it('carries an image-focused persona without replacing the runtime context', () => {
    const persona = buildAgentPresetDefinition({ platform: 'win32' }).plugins[0]
    const config = persona?.config as { prefix: string; complete: boolean; includeRuntimeContext: boolean }
    expect(config.prefix).toContain('Arya')
    expect(config.prefix.length).toBeGreaterThan(100)
    expect(config.complete).toBe(false)
    expect(config.includeRuntimeContext).toBe(true)
  })

  it('tries to keep the image tools, the working-directory tool and the tools a full preset would provide', () => {
    const allow = agentPresetAllowList('win32')
    expect(allow.slice(0, IMAGE_TOOL_NAME_LIST.length)).toEqual([...IMAGE_TOOL_NAME_LIST])
    expect(allow).toContain('working_directory')
    expect(allow).toContain('read')
    expect(allow).toContain('pwsh')
    expect(allow).toContain('web_search')
    expect(allow).toContain('web_fetch')
    expect(allow).toContain('ask_user_question')
    expect(allow).not.toContain('bash')
    expect(allow).not.toContain('subagent')
    // Whatever the scope cannot restrict is dropped by the mask row itself.
    expect(presetToolNames('win32')).toContain('web_search')
    expect(presetToolNames('linux')).toContain('bash')
    expect(presetToolNames('linux')).not.toContain('pwsh')
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
      'render_html',
      'render_svg',
      'list_render_templates',
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
function registerHarness(options: { registry?: unknown } = {}) {
  const effect = vi.fn((callback: () => () => void) => { callback() })
  const info = vi.fn()
  const warn = vi.fn()
  const ctx = {
    logger: { info, warn },
    effect,
    // The mount point reads the service through `ctx.get`, exactly as the
    // AryaCode presets do; a missing service is reported, not thrown.
    get: (name: string) => (name === 'agentPresets' ? options.registry : undefined),
  }
  return { ctx, effect, info, warn }
}

describe('arya-image preset registration', () => {
  it('declares the registry as an inject dependency so the Loader waits for it', () => {
    expect((mountAgentPreset as unknown as { inject: string[] }).inject).toEqual(['agentPresets'])
  })

  it('registers once against the host registry and releases with the fiber', async () => {
    const release = vi.fn()
    const register = vi.fn(async () => release)
    const h = registerHarness({ registry: { register } })
    mountAgentPreset(h.ctx as never, { platform: 'win32' })
    expect(register).toHaveBeenCalledTimes(1)
    expect(register.mock.calls[0][0]).toMatchObject({ id: 'arya-image' })
    // The fiber's disposer releases the registered definition.
    const dispose = h.effect.mock.calls[0][0]()
    await Promise.resolve()
    await Promise.resolve()
    dispose()
    expect(release).toHaveBeenCalledTimes(1)
    expect(h.info).toHaveBeenCalledWith(expect.stringContaining('registered arya-image'))
  })

  it('stays silent on a composition with no preset registry', () => {
    const h = registerHarness()
    expect(() => mountAgentPreset(h.ctx as never, { platform: 'win32' })).not.toThrow()
    expect(h.info).toHaveBeenCalled()
  })

  it('logs a rejected registration instead of failing the plugin', async () => {
    const register = vi.fn(async () => { throw new Error('duplicate preset id') })
    const h = registerHarness({ registry: { register } })
    mountAgentPreset(h.ctx as never, { platform: 'win32' })
    await Promise.resolve()
    await Promise.resolve()
    expect(h.warn).toHaveBeenCalledWith(expect.stringContaining('duplicate preset id'))
  })
})
