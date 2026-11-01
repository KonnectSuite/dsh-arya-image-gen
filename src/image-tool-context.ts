/** Live, endpoint-free instructions for the conversation model's image tools. */
import { resolveProvider, type Config } from './config.js'

export function imageToolContext(config: Config): string {
  let workflow = 'import a workflow in Settings > Plugins > Image Generation'
  try {
    const active = resolveProvider(config)
    workflow = active.workflow?.name ?? 'workflow selected in settings'
  } catch { /* Incomplete settings must not break the host system prompt. */ }
  return [
    `Image tools provider: local ComfyUI at the configured endpoint; active workflow: ${JSON.stringify(workflow)}.`,
    'The workflow defines the output size; the only per-call option is the workflow name. Omit it to use the active workflow.',
    'Generate images with generate_image({"prompt":"a sailboat"}); edit one with edit_image({"prompt":"make the sail blue"}).',
    'Edit workflows must declare the {{image}} input; if a generation workflow is active, pick an edit workflow via the workflow argument.',
    'If generation fails with a connection error, the ComfyUI server is likely down: use the server controls in Settings > Plugins > Image Generation to start it.',
  ].join('\n')
}
