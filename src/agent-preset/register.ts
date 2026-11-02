/**
 * Register the Arya Image preset with the host's preset registry.
 *
 * Mirrors the pattern the AryaCode presets use (see
 * `dsh-aryacode-polish/presets/arya-standard/plugin.js`): the mount point is a
 * plugin whose `inject` names the registry, so the Loader holds it until
 * `agentPresets` exists and the registration lands while the composition is
 * still settling. Registering from inside `apply()` with `ctx.inject()` is not
 * equivalent: that callback can run after the Loader has settled, which is late
 * enough for a preset list already read by the client to miss the new entry.
 *
 * Optional surface: a composition without `agentPresets` (headless, SDK) is a
 * valid composition, so the service is looked up and skipped when absent.
 * Registration is released with this plugin's fiber; a duplicate id is logged
 * and dropped, because the preset already mounted is the one sessions are using.
 *
 * @module dsh-arya-image-gen/agent-preset/register
 */
import type { Context } from '@deepseek-ai/cordis'
import { buildAgentPresetDefinition, type AgentPresetDefinition } from './definition.js'

/** The slice of the preset registry this plugin uses. */
interface AgentPresetRegistry {
  register(definition: AgentPresetDefinition): Promise<() => void> | (() => void)
}

/** Row configuration for the mount point. */
export interface AgentPresetMountConfig {
  /** `process.platform` of the host; decides which shell tool the mask keeps. */
  platform?: string
}

/**
 * Resolve an optional service. A composition that does not provide it is a valid
 * composition, not a failure: the surface it would have enabled is simply absent.
 *
 * @param ctx - the plugin context.
 * @param name - the service name.
 * @returns the service, or undefined.
 */
function service(ctx: Context, name: string): unknown {
  try {
    return (ctx as unknown as { get(serviceName: string): unknown }).get(name)
  } catch {
    return undefined
  }
}

/**
 * Mount the preset: register the definition and release it with this fiber.
 *
 * @param ctx - the mount point's context, with `agentPresets` injected.
 * @param config - host facts the definition depends on.
 */
export function mountAgentPreset(ctx: Context, config: AgentPresetMountConfig = {}): void {
  const definition = buildAgentPresetDefinition({ platform: config.platform ?? process.platform })
  // Proves the Loader reached this mount at all: a boot log with no line from
  // this module means the registry service never appeared, not a bad definition.
  ctx.logger?.info?.('arya-image-preset: mount point active')
  const presets = service(ctx, 'agentPresets') as AgentPresetRegistry | undefined
  if (presets === undefined || typeof presets.register !== 'function') {
    ctx.logger?.info?.('arya-image-preset: this composition has no agent preset registry')
    return
  }

  let release: (() => void) | undefined
  ctx.effect(() => () => {
    if (typeof release === 'function') release()
  })

  // A rejected registration (for example a duplicate id) must not fail the plugin.
  void Promise.resolve(presets.register(definition)).then(
    (disposer) => {
      release = disposer
      ctx.logger?.info?.(`arya-image-preset: registered ${definition.id} (${definition.name})`)
      reportBrokenRows(ctx, presets, definition)
    },
    (error: unknown) => {
      ctx.logger?.warn?.(`arya-image-preset: preset not registered: ${describe(error)}`)
    },
  )
}

/**
 * Log the registry's own activation verdict for this preset.
 *
 * A registered definition can still be unusable: one row that fails to activate
 * makes the host report the preset `broken`, and a client that hides broken
 * presets then shows nothing at all. Reading the published list is the only way
 * to see that verdict from inside the plugin.
 *
 * @param ctx - the plugin context, for the logger.
 * @param presets - the registry that holds the definition.
 * @param definition - the definition that was just registered.
 */
function reportBrokenRows(ctx: Context, presets: AgentPresetRegistry, definition: AgentPresetDefinition): void {
  const list = (presets as { list?: () => Promise<readonly PresetRowVerdict[]> }).list
  if (typeof list !== 'function') return
  void Promise.resolve(list.call(presets)).then(
    (rows) => {
      const row = rows.find(entry => entry.id === definition.id)
      if (row?.broken !== undefined && row.broken.length > 0) {
        ctx.logger?.warn?.(`arya-image-preset: the host reports ${definition.id} broken: ${row.broken}`)
      }
    },
    () => {
      // The list is a diagnostic surface; a failure to read it changes nothing.
    },
  )
}

/** The part of one registry listing this module reads. */
interface PresetRowVerdict {
  id: string
  broken?: string
}

// The Loader reads this to hold the mount until the registry is available.
;(mountAgentPreset as unknown as { inject: string[] }).inject = ['agentPresets']

/**
 * Describe a thrown value for a log line.
 *
 * @param error - whatever was thrown.
 * @returns a short message.
 */
function describe(error: unknown): string {
  if (error !== null && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return String(error)
}
