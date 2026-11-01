/**
 * Register the Arya Image preset with the host's preset registry.
 *
 * Optional surface: a composition without `agentPresets` (headless, SDK) is a
 * valid composition, so the service is injected opportunistically the way the
 * plugin already treats `webServer` and `settings`. Registration is released
 * with this plugin's fiber; a duplicate id is logged and dropped, because the
 * preset already mounted is the one sessions are using.
 *
 * @module dsh-arya-image-gen/agent-preset/register
 */
import type { Context } from '@deepseek-ai/cordis'
import type { AgentPresetDefinition } from './definition.js'

/** The slice of the preset registry this plugin uses. */
interface AgentPresetRegistry {
  register(definition: AgentPresetDefinition): Promise<() => void> | (() => void)
}

/**
 * Register the preset, or stay silent when the host has no registry.
 *
 * @param ctx - the plugin's host context.
 * @param definition - the definition to mount.
 */
export function registerAgentPreset(ctx: Context, definition: AgentPresetDefinition): void {
  ctx.inject(['agentPresets'], (presetCtx: Context) => {
    const presets = (presetCtx as unknown as { agentPresets?: AgentPresetRegistry }).agentPresets
    if (presets === undefined || typeof presets.register !== 'function') {
      ctx.logger?.info?.('arya-image-preset: this composition has no agent preset registry')
      return
    }

    let release: (() => void) | undefined
    presetCtx.effect(() => () => {
      release?.()
    })

    // `register()` returns the exact disposer; a rejected registration (for
    // example a duplicate id) must not fail the plugin.
    void Promise.resolve(presets.register(definition)).then(
      (disposer) => {
        release = disposer
      },
      (error: unknown) => {
        ctx.logger?.warn?.(`arya-image-preset: preset not registered: ${describe(error)}`)
      },
    )
  })
}

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
