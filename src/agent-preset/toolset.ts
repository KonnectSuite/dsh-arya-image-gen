/**
 * The Arya Image preset's tool mask.
 *
 * Mounted as a row inside the preset, so this context is the agent's scope:
 * `ctx.tools.restrict({ allow })` then hides every inherited global tool not
 * named in the list, while the preset's own rows stay visible.
 *
 * Fail-open on purpose. A mask that cannot be applied (no agent scope, a name
 * the host does not have, a registry refusal) must leave the session exactly as
 * it was - a session that loses its tools is worse than a session that pays for
 * a few extra schemas.
 *
 * @module dsh-arya-image-gen/agent-toolset
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'

/** Row configuration: the global tool names that stay visible. */
export interface ToolsetConfig {
  allow?: readonly string[]
}

/**
 * Apply the allow mask.
 *
 * @param ctx - the row's context, which must resolve to the agent scope.
 * @param config - the row configuration from the preset definition.
 */
export function apply(ctx: Context, config: ToolsetConfig = {}): void {
  const requested = Array.isArray(config.allow)
    ? [...new Set(config.allow.filter((name): name is string => typeof name === 'string' && name.length > 0))]
    : []
  if (requested.length === 0) {
    ctx.logger?.info?.('arya-image-toolset: no allow list configured; leaving the tool set untouched')
    return
  }

  // `restrict()` refuses names the host does not register, so keep only the
  // names that exist right now. A profile without, say, `tool-jobs` simply
  // contributes fewer names instead of failing the whole preset.
  const present = requested.filter(name => ctx.tools.get(name) !== undefined)
  const missing = requested.filter(name => !present.includes(name))
  if (missing.length > 0) {
    ctx.logger?.info?.(`arya-image-toolset: not registered on this host, skipped: ${missing.join(', ')}`)
  }
  if (present.length === 0) {
    ctx.logger?.warn?.('arya-image-toolset: none of the named tools exist on this host; leaving the tool set untouched')
    return
  }

  try {
    ctx.effect(() => ctx.tools.restrict({ allow: present }))
  } catch (error) {
    ctx.logger?.warn?.(`arya-image-toolset: tool mask not applied: ${describe(error)}`)
  }
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
