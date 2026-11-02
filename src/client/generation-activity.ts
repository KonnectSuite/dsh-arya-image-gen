/**
 * Which generations are running right now.
 *
 * The progress that matters has to be visible while the agent is still
 * reasoning: the tool card that owns the job can be folded into the host's
 * "calling tools" summary, and a status line rendered inside it then disappears
 * under the thinking row. The composer dock reads this store instead, so the
 * "Generating image" panel survives whatever the conversation stream does with
 * the card.
 *
 * Kept framework-free: the card publishes, the dock subscribes, and the hook
 * lives with the components.
 *
 * @module dsh-arya-image-gen/client/generation-activity
 */
import type { ComfyUIJobSnapshot } from '../comfyui-progress.js'

/** One generation the client knows about. */
export interface GenerationActivity {
  /** Host tool-call id the progress route is keyed by. */
  callId: string
  /** Session the card belongs to, when the host reports one. */
  sessionId?: string | undefined
  prompt: string
  workflow: string
  /** Latest telemetry; undefined until the first poll answers. */
  snapshot?: ComfyUIJobSnapshot | undefined
  /** Client clock, so the panel can count even before telemetry arrives. */
  startedAt: number
}

const active = new Map<string, GenerationActivity>()
const listeners = new Set<() => void>()
let ordered: readonly GenerationActivity[] = []

function publish(): void {
  ordered = [...active.values()].sort((left, right) => left.startedAt - right.startedAt)
  for (const listener of listeners) listener()
}

/**
 * Announce a running generation.
 *
 * @param entry - the activity record; a repeat for the same call replaces it.
 */
export function beginGeneration(entry: GenerationActivity): void {
  active.set(entry.callId, entry)
  publish()
}

/**
 * Update a running generation's prompt, workflow or telemetry.
 *
 * @param callId - the tool-call id.
 * @param patch - fields to merge; omitted fields keep their current value.
 */
export function updateGeneration(callId: string, patch: Partial<Omit<GenerationActivity, 'callId'>>): void {
  const current = active.get(callId)
  if (current === undefined) return
  active.set(callId, { ...current, ...patch })
  publish()
}

/**
 * Drop a generation that finished, failed or unmounted.
 *
 * @param callId - the tool-call id.
 */
export function endGeneration(callId: string): void {
  if (active.delete(callId)) publish()
}

/**
 * The newest running generation, which is the one a dock should show.
 *
 * @param sessionId - restrict the answer to one session.
 * @returns the activity, or undefined when nothing is running.
 */
export function activeGeneration(sessionId?: string): GenerationActivity | undefined {
  const candidates = sessionId === undefined
    ? ordered
    : ordered.filter(entry => entry.sessionId === undefined || entry.sessionId === sessionId)
  return candidates.at(-1)
}

/**
 * Subscribe to changes in the running set.
 *
 * @param listener - called on every begin, update and end.
 * @returns the unsubscribe function.
 */
export function subscribeGeneration(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
