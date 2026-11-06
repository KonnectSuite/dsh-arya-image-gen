/**
 * billion-context's compaction gate, as this bundle can observe it.
 *
 * `billion-context` ("bili") is an HTTP proxy plus a DSH plugin bundle that
 * compresses the outgoing model request. It owns the context lane when it runs,
 * so an Arya preset that mounts its own summarizer would put two compressors on
 * one history. bili enforces that for the shipped presets by disabling the
 * `@deepseek-ai/dsh-compaction-basic` and `@deepseek-ai/dsh-command-compact`
 * rows by package name; the Arya Image preset mounts the same stock rows, and
 * this module is how the definition learns to stand down instead.
 *
 * Two facts must BOTH hold before the preset stands down:
 *
 *   1. `ctx.get('biliBasicCompactionPolicy')` resolves - the service bili's
 *      always-on `bili-compaction-gate` entry publishes;
 *   2. `globalThis.__BILI_DSH_COMPACTION_VERDICT__ === 'active'` - the verdict
 *      `bili-native`'s `apply()` declares once its plan keeps the lane owned.
 *
 * Neither is a published contract. `biliBasicCompactionPolicy` is an internal
 * service name and the verdict is a global convention between two bili entries,
 * so every reference here is wrapped in a constant, absence is fail-open (the
 * stock rows run), and the warning is one line, never a throw.
 *
 * This is a DEFINITION-TIME stand-down, not an `internal/config` overlay. The
 * overlay bili registers at load time walks resolved entry configs; a preset
 * registered through the Host's `agentPresets.register()` is not an entry, so
 * that overlay cannot reach it. The definition reads the gate once, just before
 * it is built, which is also the only place a row can be written `disabled`.
 *
 * Timing: when bili is expected but its gate has not published yet, wait 25 ms
 * per tick for up to 2000 ms. Once the service appears, allow 500 ms for the
 * `active` verdict. Timeout, a missing service or an inactive verdict all mean
 * "keep the stock rows", with one warning, because a double compressor is better
 * than silently disabling compaction when bili is not actually compressing.
 *
 * @module dsh-arya-image-gen/agent-preset/billion-context
 */

/** The service bili's always-on gate entry publishes. Internal; bili 0.1.212. */
export const BILI_GATE_SERVICE = 'biliBasicCompactionPolicy'

/** The process-global verdict bili-native sets when it owns the context lane. */
export const BILI_VERDICT_GLOBAL = '__BILI_DSH_COMPACTION_VERDICT__'

/** The only verdict value that means bili is compressing this process. */
export const BILI_VERDICT_ACTIVE = 'active'

/** The bundle package name that marks bili as installed in the profile. */
export const BILI_BUNDLE_NAME = 'billion-context'

/**
 * Environment variables that name an attach-mode proxy. A launcher (`bili dsh`)
 * or an explicit attach owns routing this way, which means bili is compressing
 * even when the bundle is not listed in the profile.
 */
export const BILI_ATTACH_ENV = Object.freeze(['BILLION_CONTEXT_PROXY', 'BILLION_CONTEXT_ATTACH'])

/**
 * Environment kill switches bili itself honors (`=== '0'`): with either set,
 * `bili-native` plans `mode: "off"`, never declares the verdict, and hands the
 * lane back to stock DSH compaction.
 */
export const BILI_KILL_ENV = Object.freeze(['BILLION_CONTEXT_PLUGIN', 'BILI_NATIVE_DSH'])

/**
 * Environment variable that stands the native plugin down whenever it is
 * defined at all (bili reads `!== undefined`, not a boolean value).
 */
export const BILI_REWRITES_ENV = 'BILI_PROVIDER_REWRITES'

/** Poll cadence and the two waits, in milliseconds. */
export const BILI_TIMING = Object.freeze({ pollMs: 25, gateMs: 2000, verdictMs: 500 })

/** The one warning logged when bili is expected but its gate never latched. */
export const BILI_STAND_DOWN_WARNING =
  'billion-context is installed but its compaction gate did not become active; keeping the Arya Image stock compaction rows mounted'

/** The logger slice this module uses. */
export interface BiliLogger {
  info?: (message: string) => void
  warn?: (message: string) => void
}

/** The host surface this module reads. */
export interface StandDownHost {
  /** Reads an optional host service; a missing service reads as undefined. */
  get(serviceName: string): unknown
  /** Logger for the stand-down decision. */
  logger?: BiliLogger
}

/** The two waits and the poll cadence, in milliseconds. */
export interface BiliTiming {
  pollMs?: number
  gateMs?: number
  verdictMs?: number
}

/** Facts and test seams for {@link resolveStandDown}; production passes none. */
export interface StandDownOptions {
  /** Host profile facts; defaults to the `profileContext` service. */
  profileContext?: unknown
  /** Environment to read; defaults to `process.env`. */
  env?: Readonly<Record<string, string | undefined>>
  /** Object carrying the verdict global; defaults to `globalThis`. */
  scope?: unknown
  /** Wait between polls; defaults to a real timer. */
  sleep?: (milliseconds: number) => Promise<unknown>
  /** Poll cadence and wait budgets. */
  timing?: BiliTiming
}

/**
 * Whether bili's own kill switches say the native plugin is off.
 *
 * Mirrors `planNativeDsh()` in bili's `dist/agent/dsh-native.js`: the two
 * switches are compared with `=== '0'`, and a DEFINED `BILI_PROVIDER_REWRITES`
 * is enough (console/value irrelevant).
 *
 * @param env - environment to read; defaults to `process.env`.
 * @returns true when bili cannot be compressing this process.
 */
export function isBiliKillSwitched(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  try {
    if (env === null || typeof env !== 'object') return false
    for (const name of BILI_KILL_ENV) {
      if (env[name] === '0') return true
    }
    return env[BILI_REWRITES_ENV] !== undefined
  } catch {
    return false
  }
}

/**
 * Whether the environment points at an attach-mode proxy.
 *
 * @param env - environment to read.
 * @returns true when `BILLION_CONTEXT_PROXY` or `BILLION_CONTEXT_ATTACH` is set.
 */
function hasAttachEnv(env: Readonly<Record<string, string | undefined>>): boolean {
  for (const name of BILI_ATTACH_ENV) {
    const value = env[name]
    if (typeof value === 'string' && value.trim() !== '') return true
  }
  return false
}

/**
 * Whether any parsed `--patch` overlay row names the bili package.
 *
 * A launcher passes its native-plugin overlay through `--patch`; the rows are
 * `PatchOptions`, so the name can sit on the row itself or inside `insert`
 * (nested groups included). This is a bounded, cycle-safe string scan, not a
 * structural interpretation: a row is "bili" when its text contains the package
 * name, which is exactly what the profile would mount.
 *
 * @param overlays - `profileContext.overlays`.
 * @returns true when a bili row is mentioned.
 */
function overlaysMentionBili(overlays: unknown): boolean {
  if (!Array.isArray(overlays)) return false
  const stack: unknown[] = [...overlays]
  const seen = new Set<unknown>()
  let visited = 0
  while (stack.length > 0) {
    const value = stack.pop()
    if (typeof value === 'string') {
      if (value.includes(BILI_BUNDLE_NAME)) return true
      continue
    }
    if (value === null || typeof value !== 'object') continue
    if (seen.has(value)) continue
    seen.add(value)
    visited += 1
    if (visited > 4096) return false
    if (Array.isArray(value)) {
      for (const item of value) stack.push(item)
      continue
    }
    for (const child of Object.values(value as Record<string, unknown>)) {
      if (typeof child === 'string') {
        if (child.includes(BILI_BUNDLE_NAME)) return true
      } else if (child !== null && typeof child === 'object') {
        stack.push(child)
      }
    }
  }
  return false
}

/**
 * Whether this process should expect bili to own compaction.
 *
 * Three signals, in bili's own precedence: kill switches first (they outrank
 * the attach variables in `planNativeDsh`), then an attach-mode proxy from the
 * environment, then the mounted profile's startup bundles, then the parsed
 * `--patch` overlays.
 *
 * A profile that simply lists `billion-context` in `dsh.profile.bundles` is the
 * common case: the bundle layer mounts the gate entry whether or not
 * `bili-native` is enabled, so the negative case still has to be detected
 * through the kill switches rather than the bundle.
 *
 * @param profileContext - the Host's `profileContext` service, or anything else.
 * @param env - environment to read; defaults to `process.env`.
 * @returns true when bili is expected to compress this process.
 */
export function isBiliExpected(
  profileContext: unknown,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  try {
    if (isBiliKillSwitched(env)) return false
    if (hasAttachEnv(env)) return true
    if (profileContext === null || typeof profileContext !== 'object') return false
    const bundles = (profileContext as { startedBundles?: unknown }).startedBundles
    if (Array.isArray(bundles) && bundles.some(name => typeof name === 'string' && name.includes(BILI_BUNDLE_NAME))) {
      return true
    }
    return overlaysMentionBili((profileContext as { overlays?: unknown }).overlays)
  } catch {
    return false
  }
}

/**
 * Whether bili-native declared this process's lane owned.
 *
 * @param scope - the global scope to read; `globalThis` by default.
 * @returns true for the exact `'active'` verdict.
 */
export function isBiliVerdictActive(scope: unknown = globalThis): boolean {
  try {
    if (scope === null || typeof scope !== 'object') return false
    return (scope as Record<string, unknown>)[BILI_VERDICT_GLOBAL] === BILI_VERDICT_ACTIVE
  } catch {
    return false
  }
}

/**
 * Resolve one optional service without letting an unready context throw.
 *
 * @param host - the host surface.
 * @param name - the service name.
 * @returns the service, or undefined.
 */
function readService(host: StandDownHost, name: string): unknown {
  try {
    if (host === null || typeof host !== 'object' || typeof host.get !== 'function') return undefined
    return host.get(name)
  } catch {
    return undefined
  }
}

/** The default wait: a real timer. Injected by tests so no spec sleeps. */
const defaultSleep = (milliseconds: number): Promise<unknown> =>
  new Promise(resolve => setTimeout(resolve, milliseconds))

/**
 * Log the one warning. Logging is best-effort: a composition with no logger, or
 * a logger that throws, must not turn a fail-open decision into a crash.
 *
 * @param logger - the logger to write to, when there is one.
 */
function warnOnce(logger: BiliLogger | undefined): void {
  try {
    logger?.warn?.(BILI_STAND_DOWN_WARNING)
  } catch {
    // A logger failure is not a reason to change the decision.
  }
}

/**
 * Whether the definition should disable its two stock compaction summary rows.
 *
 * Call this once, immediately before building a preset definition, and pass the
 * result as `standDownCompaction`. The function never rejects and never throws:
 * any unexpected failure resolves to `false` (keep the rows), because a
 * duplicate summarizer is recoverable and a silently missing one is not.
 *
 * @param host - the feature's context surface (only `get` and `logger` are read).
 * @param options - test seams; production passes none.
 * @returns true only when bili's gate service exists AND its verdict is `active`.
 */
export async function resolveStandDown(host: StandDownHost, options: StandDownOptions = {}): Promise<boolean> {
  const env = options.env ?? process.env
  const logger = host.logger
  const standDown = (): true => {
    try {
      logger?.info?.('arya-image-preset: billion-context owns compaction; standing the stock compaction rows down')
    } catch {
      // A logger failure is not a reason to change the decision.
    }
    return true
  }
  try {
    if (isBiliKillSwitched(env)) return false
    const scope = options.scope ?? globalThis
    const gatePresent = (): boolean => readService(host, BILI_GATE_SERVICE) !== undefined

    // A bili that already proves it owns the lane is the strongest signal, and
    // the only one a direct or custom bili row gives: answer before asking the
    // profile whether it can name the bundle.
    if (gatePresent() && isBiliVerdictActive(scope)) return standDown()

    const profileContext = options.profileContext ?? readService(host, 'profileContext')
    if (!isBiliExpected(profileContext, env)) return false

    const sleep = typeof options.sleep === 'function' ? options.sleep : defaultSleep
    const timing = options.timing ?? {}
    const pollMs = typeof timing.pollMs === 'number' && Number.isFinite(timing.pollMs) && timing.pollMs > 0
      ? timing.pollMs
      : BILI_TIMING.pollMs
    const gateMs = typeof timing.gateMs === 'number' && Number.isFinite(timing.gateMs) && timing.gateMs >= 0
      ? timing.gateMs
      : BILI_TIMING.gateMs
    const verdictMs = typeof timing.verdictMs === 'number' && Number.isFinite(timing.verdictMs) && timing.verdictMs >= 0
      ? timing.verdictMs
      : BILI_TIMING.verdictMs

    // The gate entry may publish after the profile starts; poll for the service.
    let appeared = gatePresent()
    if (!appeared) {
      const gatePolls = Math.max(1, Math.ceil(gateMs / pollMs))
      for (let tick = 0; tick < gatePolls; tick += 1) {
        await sleep(pollMs)
        if (gatePresent()) {
          appeared = true
          break
        }
      }
    }

    if (appeared) {
      // The service can exist before bili-native declares the verdict; give the
      // verdict a short grace instead of treating "not yet" as "inactive".
      const verdictPolls = Math.max(1, Math.ceil(verdictMs / pollMs))
      for (let tick = 0; tick <= verdictPolls; tick += 1) {
        if (isBiliVerdictActive(scope)) return standDown()
        if (tick === verdictPolls) break
        await sleep(pollMs)
      }
    }

    warnOnce(logger)
    return false
  } catch {
    warnOnce(logger)
    return false
  }
}
