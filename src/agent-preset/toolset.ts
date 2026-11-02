/**
 * The Arya Image preset's tool mask.
 *
 * Mounted as a row inside the preset, so this context is the agent's scope:
 * `ctx.tools.restrict({ allow })` then hides every inherited tool not named in
 * the list, while the preset's own rows stay visible.
 *
 * Which names are legal is decided by `restrict()` itself, against the tools
 * this scope can actually restrict - the inherited global layer plus every
 * ancestor on the chain. It is NOT `ctx.tools.get(name)`: that answers from the
 * global view only, and once presets moved their rows onto the agent plane the
 * host's own tools became an ancestor contribution, invisible to `get()`. A
 * presence filter built on `get()` therefore strips `read`, `write`, `pwsh`,
 * `web_search` and the rest, leaving a mask that hides everything the preset
 * was supposed to keep.
 *
 * Fail-open on purpose. A mask that cannot be applied (no agent scope, a names
 * list the registry refuses) must leave the session exactly as it was - a
 * session that loses its tools is worse than a session that pays for a few
 * extra schemas.
 *
 * @module dsh-arya-image-gen/agent-toolset
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'

/** Row configuration: the global tool names that stay visible. */
export interface ToolsetConfig {
  allow?: readonly string[]
}

/** Unknown names `restrict()` reports, so the retry can drop exactly those. */
function unknownNamesFrom(error: unknown): string[] {
  const message = error instanceof Error ? error.message : String(error)
  return [...message.matchAll(/"([^"]+)"/gu)]
    .map(match => match[1] ?? '')
    .filter(name => name.length > 0)
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

  // A host without, say, tool-web refuses the whole filter, so drop exactly the
  // names it called unknown and retry. Three passes is enough for any profile:
  // the first names everything missing, the retry either succeeds or reveals a
  // second, smaller set.
  let allow = requested
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      ctx.effect(() => ctx.tools.restrict({ allow }))
      const dropped = requested.filter(name => !allow.includes(name))
      if (dropped.length > 0) {
        ctx.logger?.info?.(`arya-image-toolset: not registered on this host, skipped: ${dropped.join(', ')}`)
      }
      return
    } catch (error) {
      const unknown = unknownNamesFrom(error).filter(name => allow.includes(name))
      const kept = allow.filter(name => !unknown.includes(name))
      if (unknown.length === 0 || kept.length === 0 || kept.length === allow.length) {
        ctx.logger?.warn?.(`arya-image-toolset: tool mask not applied: ${describe(error)}`)
        return
      }
      allow = kept
    }
  }
  ctx.logger?.warn?.('arya-image-toolset: tool mask not applied: the registry kept refusing names')
}

// A preset row runs in a scoped context where only declared services are
// visible; `ctx.tools` throws "cannot get property tools without inject"
// otherwise, and the host then reports the whole preset broken because of it.
// The Loader reads `inject` from the module, so it has to be a named export:
// a property on `apply` alone never reached it.
export const inject = ['tools']
;(apply as unknown as { inject: string[] }).inject = inject

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
