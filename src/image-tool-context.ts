/** Live endpoint-free instructions for the conversation model's image tools. */
import { resolveProvider, type Config } from './config.js'
import { safePromptText } from './shared.js'

export function imageToolContext(config: Config): string {
  let workflow = 'import a workflow in Settings > Plugins > Image Generation'
  try {
    const active = resolveProvider(config)
    workflow = active.workflow?.name ?? 'workflow selected in settings'
  } catch { /* Incomplete settings must not break the host system prompt. */ }
  return [
    `Image tools provider: local or remote ComfyUI at the configured endpoint; active workflow: ${JSON.stringify(safePromptText(workflow))}.`,
    'The workflow defines the output size; the only per-call option is the workflow name. Omit it to use the active workflow.',
    'Generate images with the generate_image tool (prompt only); edit one with edit_image (prompt only).',
    'Edit workflows declare an image input placeholder — two opening braces, the word image, two closing braces — in a LoadImage field. If a text-to-image workflow is active, pass the workflow argument to pick an edit workflow.',
    'If generation fails with a connection error, the ComfyUI server is likely down or unreachable: use the server controls in Settings > Plugins > Image Generation, or start it on its own machine.',
  ].join('\n')
}
