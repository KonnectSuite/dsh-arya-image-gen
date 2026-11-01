import { type StudioGenerateRequest } from '../shared.js'

export interface RegeneratableImage {
  provider: string
  model: string
  output?: string | undefined
}

/** Build the workbench request that reproduces a conversation image with an edited prompt. */
export function conversationRegenerateRequest(
  image: RegeneratableImage,
  prompt: string,
): StudioGenerateRequest {
  if (image.provider !== 'comfyui') {
    throw new Error('Only ComfyUI images can be regenerated in the workbench')
  }
  return {
    mode: 'generate',
    provider: 'comfyui',
    model: image.model,
    prompt: prompt.trim(),
  }
}
