// Must stay the first import: it shims CSS.supports before tldraw's
// module-scope environment probe runs (#40); see css-supports-shim.ts.
import './tl/css-supports-shim.js'
import { useCallback, useEffect, useMemo, useState, useRef, type ChangeEvent, type FormEvent } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { fetchSettingsHealth, settingsState, type SettingsScopeSnapshot, type SettingsState } from './settings-state.js'
import type { SettingsHealth } from '../shared.js'
export type { SettingsScopeSnapshot } from './settings-state.js'
export interface SettingsScope<T> {
  getSnapshot(): SettingsScopeSnapshot<T>
  subscribe(listener: () => void): () => void
  /** New hosts return true/false; legacy settings scopes resolve to void. */
  set(field: string, value: unknown): Promise<boolean | void>
}
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type { ComfyUIJobSnapshot } from '../comfyui-progress.js'
import {
  COMFYUI_PROGRESS_ROUTE,
  COMFYUI_SERVER_ROUTE,
  DEFAULT_COMFYUI_BASE_URL,
  DEFAULT_COMFYUI_EXTRA_ARGS,
  DEFAULT_COMFYUI_PYTHON_EXE,
  DEFAULT_COMFYUI_SERVER_DIR,
  DEFAULT_COMFYUI_TIMEOUT_MS,
  IMAGE_GENERATION_ENTRY_ID,
  IMAGE_GENERATION_NAMESPACE,
  IMAGE_ROUTE,
  RENDER_HEALTH_ROUTE,
  CHECK_WORKFLOWS_ROUTE,
  MAX_COMFYUI_WORKFLOW_BYTES,
  STUDIO_ROUTE,
  activeComfyUIWorkflow,
  describeWorkflowJson,
  isLocalComfyUIEndpoint,
  parseComfyUIHeaders,
  progressJobIdForCall,
  resolveComfyUIWorkflows,
  resolveWorkflowRole,
  uniqueComfyUIWorkflowName,
  type ComfyUIServerStatus,
  type ComfyUIWorkflowEntry,
  type ComfyUIWorkflowRole,
  type ImageProvider,
  type StudioGenerateResponse,
} from '../shared.js'
import { validateComfyUIWorkflowJson } from '../comfyui-workflow.js'
import { saveGalleryItem } from './gallery-store.js'
import { GalleryViewTab, copyImageBlob, type GalleryViewTabProps, type LocaleService } from './gallery-view.js'
import { fetchAttachmentBlob } from './image-cache.js'
import { imageRef, type ToolCallBlock } from './image-ref.js'
import { createCanvasSessionSelection, startConversationLandings, type CanvasSessions, type CanvasSessionSelection } from './tl/conversation-landings.js'
import { STUDIO_STYLE } from './studio-style.js'
import { TL_CSS } from './tl/tl-css.js'
import { TL_THEME_CSS } from './tl/tl-theme-css.js'
import { INSPIRATION_STYLE } from './inspiration-style.js'
import {
  IMAGE_RESULT_NODE_KIND,
  createImageResultDefinition,
  imageResultsFromMeta,
  type ImageResultPresentation,
} from './image-result-node.js'
import {
  appendConversationImageRevision,
  loadConversationImageRevisionChain,
  selectConversationImageRevision,
  type ConversationImageRevision,
  type ConversationImageRevisionChain,
} from './conversation-image-revisions.js'
import { conversationRegenerateRequest } from './conversation-regenerate.js'
import { writeSetting } from './settings-write.js'

/** Build timestamp injected by tsdown at bundle time. */
declare const __CANVAS_BUILD_TS__: string

// Convention: the canvas bundle announces its build timestamp on load, so a
// stale host webview cache is provable from the browser console. The typeof
// guard keeps the module importable where the define is absent (vitest).
if (typeof __CANVAS_BUILD_TS__ !== 'undefined') {
  console.info(`[dsh-image-gen] canvas bundle ${__CANVAS_BUILD_TS__}`)
}

type ProviderRows = never
interface CredentialInfo { configured?: boolean; source?: string; writable?: boolean }
interface CredentialResult { ok: boolean; value?: Readonly<Record<string, CredentialInfo>> }
interface CredentialMutationResult { ok: boolean; error?: { message?: string } }
interface CredentialsRemote {
  describe(refs: string[]): Promise<CredentialResult>
  set(ref: string, value: string): Promise<CredentialMutationResult>
  /** Present only on modern hosts; feature-detected before use; undefined while degraded. */
  unset?: ((ref: string) => Promise<CredentialMutationResult>) | undefined
}
type LegacyCredentialRpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { message?: string } }
interface LegacyCredentialsApi {
  describe(request: { refs: string[] }): Promise<{
    result: LegacyCredentialRpcResult<{ credentials: Readonly<Record<string, CredentialInfo>> }>
  }>
  set(request: { ref: string; value: string }): Promise<{
    result: LegacyCredentialRpcResult<unknown>
  }>
}
/** Notifies the settings card whenever any credential reference changes on the host. */
interface CredentialEvents { listen(callback: () => void): () => void }
interface SettingsFace {
  scope: SettingsScope<ImageSettings>
  credentials: CredentialsRemote
  /** False while the host core exposes no credentials service; the key UI degrades but the card stays mounted. */
  credentialsAvailable: () => boolean
  locale?: LocaleService | undefined
  credentialEvents?: CredentialEvents | undefined
}
interface ImageCardFace { locale?: LocaleService | undefined; promoted: boolean }
type SettingsCardProps = PropsRuntime<'settings.plugins.tab'> & InjectFace<SettingsFace>
type ImageCardProps = PropsRuntime<'tool.call.toolview'> & InjectFace<ImageCardFace>
interface ImageResultNodeProps {
  node: { data: { results: readonly ImageResultPresentation[] } }
  locale?: LocaleService | undefined
}
interface ModernUiConversation {
  events: { register(definition: ReturnType<typeof createImageResultDefinition>): () => void }
}

/** Right-sidebar tab-type registration id (DSH 0.1.5 `sidebarRightTabs`). */
const SIDEBAR_STUDIO_TAB_ID = 'dsh-image-gen/studio'
/** The tab kind: a page type opened by kind, recognizing no resource address. */
const SIDEBAR_STUDIO_TAB_KIND = 'dsh-image-gen-studio'
/**
 * Runtime face of DSH 0.1.5's `sidebarRightTabs` service (stage one of a
 * right-sidebar tab type's registration). Kept local and duck-typed: hosts
 * without the service never reach this code (deferred inject).
 */
interface SidebarRightTabsFace {
  register(definition: {
    id: string
    kind: string
    priority?: string
    title: (address: string) => string
    guide?: ReadonlyArray<{ order: number; title: () => string; description?: () => string }>
  }): () => void
}

const DICT = {
  en: {
    title: 'Image Generation',
    description: 'Configure each provider key and model, then pick the default provider.',
    defaultProvider: 'Default provider',
    defaultProviderHint: 'Used by the Agent by default; the Studio and tool calls can switch per call.',
    settingsReadOnly: 'Settings come from a profile file and are read-only; edit that source to change them.',
    settingsLoading: 'Settings are loading; please wait.',
    settingsRemote: 'This connection cannot save settings to the host. Edit them from the local DSH page.',
    settingsUnavailable: 'The host has not provided image generation settings. Check that the plugin is enabled and review its load logs.',
    settingsIncompatible: 'The loaded settings library cannot save these settings. Update @deepseek-ai/schemastery in the plugin environment to 3.18.4 or a compatible 3.x version, then restart DSH.',
    providerGoogle: 'Google Gemini',
    providerOpenAI: 'OpenAI',
    providerOpenAICompat: 'OpenAI Compatible (relay)',
    addCompatChannel: 'Add OpenAI-compatible channel',
    channelName: 'Channel name',
    channelNameRequired: 'Enter a channel name.',
    removeChannel: 'Remove channel',
    removeChannelConfirm: 'Remove "{label}"? Its channel configuration will be deleted.',
    providerSeedream: 'ByteDance Seedream',
    providerDashScope: 'Aliyun DashScope (Wanx / Qwen)',
    providerXAI: 'xAI Grok Imagine',
    providerZhipu: 'Zhipu GLM-Image',
    providerComfyUI: 'Local ComfyUI',
    providerChatGPTSub: 'ChatGPT Subscription',
    providerGrokSub: 'Grok Subscription',
    providerGoogleSub: 'Google Subscription',
    subBadgeLoggedIn: 'Signed in',
    subBadgeLoggedOut: 'Signed out',
    subBadgeUnknown: 'Unknown',
    subSectionTitle: 'Subscription generation',
    subHint: 'Generates through a logged-in subscription account; no API key needed. Signing in never changes any API key or the default provider.',
    subProxyHint: 'If you need a proxy, enable TUN (virtual network adapter) mode before signing in. A system proxy alone may not cover DSH backend requests, causing sign-in to fail after browser authorization.',
    subAccountLabel: 'Account',
    subAccountEmail: 'Signed in: {email}',
    subAccountNone: 'Not signed in',
    subLogin: 'Sign in',
    subLoggingIn: 'Signing in…',
    subLogout: 'Sign out',
    subLoggingOut: 'Signing out…',
    subWaitingLogin: 'Authorization page opened; complete sign-in in your browser…',
    subLoginOk: 'Signed in',
    subModelLabel: 'Subscription model',
    subModelHint: 'Fixed by the subscription channel; not changeable.',
    subEditCapability: 'Subscription image editing is now supported: edit_image in chats, Studio and multi-model compare all accept reference images (up to 5).',
    subDefaultHint: 'Subscription providers support both text-to-image and image editing; edits use each channel\'s default parameters.',
    apiKeyLabel: '{provider} API Key',
    apiKeyPlaceholder: 'Leave empty to keep configured key',
    apiKeyHint: 'Securely saved as {key}; never read back in plaintext.',
    keyReadOnly: 'Key is supplied read-only by {source}; update it there.',
    credentialsUnavailable: 'Credentials service unavailable: API keys cannot be saved; please upgrade DSH to a stable release.',
    badgeUnavailable: 'Credentials unavailable',
    badgeChecking: 'Checking…',
    badgeConfigured: 'Key set',
    badgeMissing: 'Key missing',
    badgeUnknown: 'Unknown',
    comfyuiNoKey: 'No API key needed',
    testConnection: 'Test connection',
    testing: 'Testing…',
    testOk: 'Connection OK',
    testFailed: 'Connection failed',
    testUnauthorized: 'API key rejected',
    clearKey: 'Clear key',
    keyCleared: 'Key cleared',
    clearKeyFailed: 'Failed to clear key',
    saveKeyFailed: 'Failed to save the key',
    saveKeyFirst: 'Save the API key first, then fetch models or test the connection.',
    saveEndpointFirst: 'The endpoint address has not been saved. Click Save before fetching models or testing the connection.',
    endpointRequired: 'Enter and save an endpoint address before fetching models or testing the connection.',
    savedEndpointMissing: 'No saved endpoint address was found. Save it and try again.',
    clearKeyUnsupported: 'This DSH build cannot clear keys here; remove it from credential management instead.',
    endpoint: 'Endpoint / Base URL',
    reset: 'Reset',
    resetTitle: 'Reset to official default URL',
    endpointHintGoogle: 'Official Google endpoint or reverse proxy (full path).',
    googleProtocol: 'Request protocol',
    googleInteractions: 'Interactions (default)',
    googleNative: 'Native generateContent',
    saveGoogleProtocolFirst: 'Save the request protocol before fetching models or testing the connection.',
    endpointHintGoogleNative: 'API base URL (e.g. https://example.com/v1beta). Full Interactions or generateContent URLs also work.',
    endpointHintOpenAI: 'Official api.openai.com /v1 base URL; for relays use the "OpenAI-compatible" row below.',
    endpointHintOpenAICompat: 'OpenAI-compatible /v1 base URL of your relay or self-hosted service (required), e.g. https://your-relay.example.com/v1.',
    editFormat: 'Edit request format',
    editModel: 'Editing model (optional)',
    editModelHint: 'Leave empty to reuse the model above. SiliconFlow can use Qwen/Qwen-Image for generation and Qwen/Qwen-Image-Edit for editing.',
    editFormatSiliconFlow: 'SiliconFlow JSON (image string)',
    editFormatSiliconFlowHint: 'Edit dimensions follow the reference; size and quality fields are omitted. Qwen-Image-Edit supports one reference, Edit-2509 up to three. The plugin fills the image fields.',
    editFormatMultipart: 'Standard multipart (official OpenAI)',
    editFormatAutomatic: 'Automatic: official JSON contract',
    editFormatJsonImageUrlArray: 'JSON images array (SenseNova etc.)',
    editFormatFormReferenceImages: 'Multipart with a reference_images JSON array (base64)',
    editFormatHint: 'Recognized official SenseNova, Qwen and SiliconFlow endpoints automatically use their JSON edit contracts. Choose other relay formats according to their documentation. Text-to-image is unaffected.',
    editExtra: 'Extra JSON fields',
    editExtraPlaceholder: '{"watermark": false, "prompt_extend": true}',
    editExtraHint: 'Only used with the JSON format; merged into the request body last and may override defaults. Leave empty for none.',
    arkOutputFormat: 'Output format',
    arkOutputFormatPng: 'PNG (lossless, keeps an alpha channel)',
    arkOutputFormatJpeg: 'JPEG (Ark default, lossy)',
    arkOutputFormatHint: 'JPEG ringing around the subject turns into coloured fringing that is hard to remove when cutting the background out. Pick PNG if you plan to edit the result.',
    arkWatermark: 'AI generated watermark',
    arkWatermarkOn: 'Add (Ark default)',
    arkWatermarkOff: 'Do not add',
    arkWatermarkHint: 'Ark stamps an "AI generated" mark into the bottom-right corner by default. Turn it off for game assets or any post-processing.',
    arkBackground: 'Background',
    arkBackgroundOpaque: 'Opaque (Ark default)',
    arkBackgroundTransparent: 'Transparent',
    arkBackgroundHint: 'Image-to-image only, and every reference image must already carry an alpha channel; Ark rejects it for text-to-image, so it is sent on edits alone.',
    editExtraInvalid: 'Extra JSON fields must be a valid JSON object.',
    sizeTable: 'Custom resolution table (JSON)',
    sizeTableHint: 'Aspect ratio → tier → pixel size. Leave empty for defaults; e.g. {"16:9":{"2K":"2048x1152"}}.',
    sizeTableInvalid: 'Use a JSON object mapping ratios to numeric tiers (e.g. 2K) and nonempty size strings.',
    defaultQuality: 'Default generation quality',
    defaultQualityHint: 'Leave empty to omit quality. Independent of resolution; the upstream must support this value.',
    qualityOptions: 'Available generation qualities (comma-separated)',
    generateExtra: 'Generation extra fields (JSON)',
    generateExtraHint: 'Generation only. Merged last; can override size and quality. Use {"watermark":false} for SenseNova.',
    editSizeMode: 'JSON edit dimensions',
    editSizeAuto: 'Auto (SenseNova compatible)',
    editSizeSelected: 'Use selected resolution',
    endpointHintSeedream: 'Volcengine Ark compatible /api/v3 base URL.',
    endpointHintDashScope: 'Official Aliyun DashScope endpoint.',
    endpointHintXAI: 'Official xAI api.x.ai /v1 base URL.',
    endpointHintZhipu: 'Zhipu open.bigmodel.cn /api/paas/v4 base URL.',
    endpointHintComfyUI: 'A running ComfyUI server reachable by the DSH Host; the default points to port 8188 on this computer.',
    model: 'Model',
    defaultModel: 'Default model',
    availableModels: 'Models available in Studio',
    availableModelsHint: 'Selected models can be switched in Studio. A manually entered default is added automatically and cannot be removed.',
    defaultModelTag: 'Default',
    workflow: 'API Workflows',
    workflowImport: 'Import JSON file',
    workflowMissing: 'No workflow imported',
    workflowImported: 'Imported {name}',
    workflowHint: 'Export an API Format JSON from ComfyUI and place {{prompt}} in its prompt input; {{seed}} is available for a random seed. For image editing put {{image}} (exactly once) in the LoadImage image input. Import as many workflows as you need; the Agent can also pick one by name.',
    workflowTooLarge: 'Workflow files must be no larger than 5 MB.',
    workflowActiveTitle: 'Make this the active workflow',
    workflowRemove: 'Remove',
    workflowPresetPlaceholder: 'Preset prompt (optional)',
    workflowPresetTitle: 'Preset prompt: automatically prepended to the user prompt on every call of this workflow.',
    workflowNameRequired: 'Workflow names cannot be empty.',
    workflowDuplicateName: 'Workflow names must be unique.',
    timeout: 'Generation timeout (seconds)',
    timeoutHint: 'Covers submission, waiting, and image download; defaults to 300 seconds.',
    cloudTimeout: 'Cloud generation timeout (seconds)',
    cloudTimeoutHint: 'Shared by all API-key channels in the workbench, 5–3600 seconds; defaults to 150 seconds. Does not affect subscription channels or ComfyUI; applies to new requests.',
    workspaceSection: 'Workspace',
    saveToWorkspace: 'Save to workspace',
    saveToWorkspaceHint: 'Write each generated image as a file into the session workspace.',
    folder: 'Workspace folder',
    folderHint: 'Subdirectory of the session workspace; empty means the workspace root.',
    fetchModels: 'Fetch models',
    fetchingModels: 'Fetching…',
    fetchModelsHint: 'Click "Fetch models" to list image-capable models with the stored key; manual input still works.',
    modelsFound: '{n} image models found; open the model field to pick one',
    modelsNone: 'No image models found; type the model name manually',
    saving: 'Saving…',
    save: 'Save',
    saved: 'Saved',
    settingsWriteRejected: 'A setting could not be saved. Please check and try again.',
    savedToPath: 'Saved to',
    generating: 'Generating image…',
    loading: 'Loading image…',
    loadFailed: 'Failed to load image ({status})',
    generatedTitle: 'Generated image',
    resultShown: 'Image result is shown in the conversation',
    copyImg: 'Copy Image',
    download: 'Download Image',
    openNewTab: 'Open in new tab',
    copiedImage: 'Image copied',
    copyFailed: 'Copy failed',
    regenerate: 'Regenerate',
    regenerateTitle: 'Regenerate image',
    regenerateHint: 'Edit the prompt if needed. The new image replaces this view while the original remains available.',
    prompt: 'Prompt',
    cancel: 'Cancel',
    confirmRegenerate: 'Regenerate',
    regenerating: 'Regenerating…',
    regenerateFailed: 'Regeneration failed',
    regenerateSaveFailed: 'Regenerated, but saving to the gallery failed. Please retry.',
    versionPrevious: 'Previous version',
    versionNext: 'Next version',
    versionLabel: 'Image version {current}/{total}',
  },
} as const

type DictKey = keyof typeof DICT.en

const STYLE = `
.dsh-ig-card{list-style:none;border:0;background:none;padding:0}
.dsh-ig-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 0 6px}
.dsh-ig-head-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.dsh-ig-title{display:block;font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary,inherit)}
.dsh-ig-desc{display:block;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#7b818b)}
.dsh-ig-body{padding:0}
.dsh-ig-field{display:flex;flex-direction:column;gap:6px;padding:12px 0}
.dsh-ig-field + .dsh-ig-field{border-top:0.5px solid var(--dsw-alias-border-l2,#e8ebf0)}
.dsh-ig-label{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary,inherit)}
.dsh-ig-input{box-sizing:border-box;width:100%;height:34px;padding:0 12px;font-size:13px;border:0.5px solid var(--dsw-alias-border-l4,#d7dbe0);border-radius:var(--dsw-radius-md,6px);background:var(--dsw-alias-bg-layer-3,transparent);color:inherit;outline:none;transition:border-color .15s}
.dsh-ig-input:focus{border-color:var(--dsw-alias-brand-primary,#4c78ff)}
.dsh-ig-textarea{resize:vertical;min-height:56px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;line-height:1.5}
.dsh-ig-input-group{display:flex;gap:8px;align-items:center}
.dsh-ig-file-row{display:flex;align-items:center;gap:10px;min-width:0}
.dsh-ig-file-input{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;clip-path:inset(50%)}
.dsh-ig-file-button{appearance:none;flex:none;border:1px solid var(--dsw-alias-border-l2,#d7dbe0);border-radius:8px;padding:7px 12px;background:var(--dsw-alias-bg-layer-3,#f9fafb);color:var(--dsw-alias-label-secondary,inherit);font-size:13px;cursor:pointer;transition:background .15s,border-color .15s}
.dsh-ig-file-button:hover{background:var(--dsw-alias-bg-layer-2,#edf0f3);border-color:var(--dsw-alias-label-dimmed,#9ca3af)}
.dsh-ig-file-button:focus-within{outline:2px solid var(--dsw-alias-brand-primary,#4c78ff);outline-offset:2px}
.dsh-ig-file-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary,inherit);font-size:12px}
.dsh-ig-workflow-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.dsh-ig-workflow-row{display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid var(--dsw-alias-border-l2,#eee);border-radius:8px}
.dsh-ig-workflow-group{display:flex;flex-direction:column;gap:8px;margin-top:10px}
.dsh-ig-workflow-group-head{display:flex;align-items:center;gap:8px}
.dsh-ig-workflow-group-title{font-size:12.5px;font-weight:650;letter-spacing:.02em}
.dsh-ig-workflow-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.dsh-ig-workflow-chip{font-family:'JetBrains Mono',monospace;font-size:10.5px;padding:2px 7px;border-radius:999px;background:rgba(43,108,255,.08);color:#2B6CFF;border:1px solid rgba(43,108,255,.18)}
.dsh-ig-workflow-role{height:26px;border:1px solid var(--dsw-alias-border-l2,#eee);border-radius:6px;background:transparent;color:inherit;font-size:11.5px;padding:0 6px}
.dsh-ig-import-summary{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;background:rgba(0,224,210,.10);border:1px solid rgba(0,224,210,.35);font-size:12px}
.dsh-ig-workflow-group-empty{font-size:12px;color:var(--dsw-alias-label-tertiary,#717b90)}
.dsh-ig-workflow-main{display:flex;align-items:center;gap:8px}
.dsh-ig-workflow-active{display:inline-flex;align-items:center;cursor:pointer;flex:none}
.dsh-ig-workflow-active input[type=radio]{width:15px;height:15px;accent-color:var(--dsw-alias-brand-primary,#4c78ff);margin:0;cursor:pointer}
.dsh-ig-workflow-name{flex:1;min-width:0}
.dsh-ig-btn-reset{appearance:none;border:0.5px solid var(--dsw-alias-border-l4,#d7dbe0);border-radius:var(--dsw-radius-md,6px);padding:5px 12px;background:var(--dsw-alias-bg-layer-3,#f9fafb);color:var(--dsw-alias-label-secondary,inherit);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap;transition:background .15s,border-color .15s}
.dsh-ig-btn-reset:hover{background:var(--dsw-alias-bg-layer-2,#edf0f3);border-color:var(--dsw-alias-label-dimmed,#9ca3af)}
.dsh-ig-hint,.dsh-ig-status{margin:0;color:var(--dsw-alias-label-tertiary,#7b818b);font-size:12px;line-height:1.4}
.dsh-ig-hint-error{color:var(--dsw-alias-label-error,#d33)}
.dsh-ig-status-error{color:var(--dsw-alias-label-error,#d33);font-weight:500}
.dsh-ig-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l2,#eee)}
.dsh-ig-check-row{display:flex;align-items:center;gap:8px;cursor:pointer}
.dsh-ig-check-row input[type=checkbox]{width:15px;height:15px;accent-color:var(--dsw-alias-brand-primary,#4c78ff);margin:0}
.dsh-ig-model-picker{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px 12px;max-height:180px;overflow-y:auto;padding:2px 0}
.dsh-ig-model-picker .dsh-ig-check-row{min-width:0}
.dsh-ig-model-option{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
.dsh-ig-model-default{flex:none;color:var(--dsw-alias-label-tertiary,#7b818b);font-size:11px}
.dsh-ig-savedto{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#7b818b);word-break:break-all}
.dsh-ig-save{appearance:none;border:0;border-radius:var(--dsw-radius-md,6px);padding:5px 14px;background:var(--dsw-alias-label-primary,#111827);color:var(--dsw-alias-bg-layer-3,#fff);font:inherit;font-size:13px;font-weight:400;cursor:pointer;transition:opacity .15s}
.dsh-ig-save:disabled{opacity:.4;cursor:default}

/* Provider list: one expandable row per provider, each saving independently. */
.dsh-ig-providers{display:flex;flex-direction:column;margin-top:6px}
.dsh-ig-provider-row{border:0;background:none;padding:14px 0}
.dsh-ig-provider-row + .dsh-ig-provider-row{border-top:0.5px solid var(--dsw-alias-border-l2,#e8ebf0)}
.dsh-ig-provider-head-row{display:flex;align-items:center;gap:10px}
.dsh-ig-provider-head{flex:1;min-width:0;width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;gap:10px;padding:0}
.dsh-ig-channel-add{flex:none;width:30px;padding:4px 0;font-size:16px;line-height:20px}
.dsh-ig-provider-head:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4c78ff);outline-offset:2px;border-radius:var(--dsw-radius-sm,4px)}
.dsh-ig-provider-head:hover .dsh-ig-provider-name{color:var(--dsw-alias-label-secondary,inherit)}
.dsh-ig-provider-name{flex:1;min-width:0;font-size:13.5px;font-weight:550;color:var(--dsw-alias-label-primary,inherit)}
.dsh-ig-provider-chevron{flex:none;color:var(--dsw-alias-label-tertiary,#7b818b);transition:transform .16s;display:inline-flex;align-items:center}
.dsh-ig-provider-chevron-open{transform:rotate(180deg)}
.dsh-ig-provider-body{border-top:0;padding:8px 0 2px}
.dsh-ig-badge{flex:none;display:inline-flex;align-items:center;gap:5px;font-size:11.5px;line-height:1.6;padding:2px 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#d7dbe0);color:var(--dsw-alias-label-secondary,inherit);white-space:nowrap;max-width:60%;overflow:hidden;text-overflow:ellipsis}
.dsh-ig-badge-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.dsh-ig-badge-ok{border-color:rgba(34,197,94,.45);color:#15803d;background:rgba(34,197,94,.08)}
.dsh-ig-badge-missing{border-color:rgba(239,68,68,.4);color:#b91c1c;background:rgba(239,68,68,.06)}
.dsh-ig-badge-neutral{color:var(--dsw-alias-label-tertiary,#7b818b)}
.dsh-ig-badge-checking .dsh-ig-badge-dot{animation:dsh-ig-pulse 1s ease-in-out infinite}
@keyframes dsh-ig-pulse{50%{opacity:.25}}

/* Default provider radio pills. */
.dsh-ig-radios{display:flex;flex-wrap:wrap;gap:8px}
.dsh-ig-radio{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l2,#d7dbe0);border-radius:999px;padding:5px 12px;cursor:pointer;font-size:12.5px;color:var(--dsw-alias-label-secondary,inherit);transition:border-color .15s,background .15s}
.dsh-ig-radio:hover{border-color:var(--dsw-alias-label-dimmed,#9ca3af)}
.dsh-ig-radio-checked{border-color:var(--dsw-alias-brand-primary,#4c78ff);background:rgba(76,120,255,.08);color:var(--dsw-alias-label-primary,inherit)}
.dsh-ig-radio input[type=radio]{width:14px;height:14px;accent-color:var(--dsw-alias-brand-primary,#4c78ff);margin:0;cursor:pointer}

/* Row-level actions: test connection, clear key, save. */
.dsh-ig-row-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:14px;flex-wrap:wrap}
.dsh-ig-row-buttons{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsh-ig-btn-secondary{appearance:none;border:0.5px solid var(--dsw-alias-border-l4,#d7dbe0);border-radius:var(--dsw-radius-md,6px);padding:5px 14px;background:var(--dsw-alias-bg-layer-3,#f9fafb);color:var(--dsw-alias-label-secondary,inherit);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap;transition:background .15s,border-color .15s,opacity .15s}
.dsh-ig-btn-secondary:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,#edf0f3);border-color:var(--dsw-alias-label-dimmed,#9ca3af)}
.dsh-ig-btn-secondary:disabled{opacity:.45;cursor:default}
.dsh-ig-btn-danger{color:#b91c1c;border-color:rgba(239,68,68,.4)}
.dsh-ig-btn-danger:hover:not(:disabled){background:rgba(239,68,68,.08);border-color:rgba(239,68,68,.6)}

/* Workspace section within the settings card. */
.dsh-ig-section{display:flex;flex-direction:column;gap:6px;margin-top:20px;padding-top:14px;border-top:0.5px solid var(--dsw-alias-border-l2,#e8ebf0)}
.dsh-ig-section-title{font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary,inherit)}
.dsh-ig-status-readonly{color:var(--dsw-alias-label-tertiary,#7b818b);font-style:italic}

.dsh-ig-result{display:grid;gap:10px;max-width:520px}
.dsh-ig-promoted-results{display:grid;gap:16px}
.dsh-ig-result-title{font-size:14px;font-weight:600}
.dsh-ig-container{position:relative;display:inline-block;width:fit-content;max-width:100%;justify-self:start;border-radius:12px;overflow:hidden;line-height:0;isolation:isolate}
.dsh-ig-container:hover .dsh-ig-toolbar,.dsh-ig-container:focus-within .dsh-ig-toolbar{opacity:1;pointer-events:auto}
.dsh-ig-toolbar{position:absolute;top:8px;left:8px;display:flex;align-items:center;gap:5px;padding:3px 5px;border-radius:8px;background:rgba(0,0,0,0.65);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);opacity:0;pointer-events:none;transition:opacity .18s ease;z-index:2;line-height:1}
.dsh-ig-tool-btn{appearance:none;border:0;background:transparent;color:#fff;padding:5px;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:background .15s,color .15s}
.dsh-ig-tool-btn:hover{background:rgba(255,255,255,0.25)}
.dsh-ig-tool-btn-danger:hover{background:rgba(239,68,68,0.75)!important;color:#fff!important}
.dsh-ig-toast{position:absolute;top:100%;left:0;margin-top:5px;padding:3px 8px;border-radius:6px;background:rgba(0,0,0,0.85);color:#fff;font-size:11px;white-space:nowrap;pointer-events:none;z-index:4}
.dsh-ig-image{display:block;max-width:100%;max-height:520px;border-radius:12px;background:#f2f3f5;cursor:pointer}
.dsh-ig-version-nav{position:absolute;right:8px;bottom:8px;display:flex;align-items:center;gap:2px;padding:3px;border-radius:999px;background:rgba(15,23,42,.72);color:#fff;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);font-size:11px;line-height:1;z-index:2}
.dsh-ig-version-nav button{appearance:none;border:0;background:transparent;color:inherit;width:25px;height:25px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font-size:17px;line-height:1}
.dsh-ig-version-nav button:hover:not(:disabled){background:rgba(255,255,255,.2)}
.dsh-ig-version-nav button:disabled{opacity:.3;cursor:default}
.dsh-ig-version-count{min-width:34px;text-align:center;font-variant-numeric:tabular-nums}
.dsh-ig-regenerate-overlay{position:absolute;inset:0;background:rgba(15,23,42,0.52);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#fff;z-index:3;animation:dsh-ig-fade .18s ease-out;line-height:1.4;border-radius:12px}
.dsh-ig-regenerate-spinner{width:28px;height:28px;border:3px solid rgba(255,255,255,0.25);border-top-color:#fff;border-radius:50%;animation:dsh-ig-spin .8s linear infinite}
.dsh-ig-regenerate-overlay-text{font-size:12.5px;font-weight:550;color:#fff;letter-spacing:0.2px;text-shadow:0 1px 2px rgba(0,0,0,0.4)}
.dsh-ig-regenerate-overlay-cancel{appearance:none;border:1px solid rgba(255,255,255,0.4);border-radius:6px;background:rgba(255,255,255,0.15);color:#fff;padding:3px 12px;font-size:11.5px;cursor:pointer;transition:background .15s}
.dsh-ig-regenerate-overlay-cancel:hover{background:rgba(255,255,255,0.3)}
@keyframes dsh-ig-spin{to{transform:rotate(360deg)}}
.dsh-ig-regenerate-backdrop{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(11,17,29,.6);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);animation:dsh-ig-fade .15s ease-out}
.dsh-ig-regenerate-dialog{width:min(520px,100%);border:1px solid var(--dsw-alias-border-l2,#dfe3ea);border-radius:14px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#172033);box-shadow:0 24px 72px rgba(11,17,29,.28);padding:20px;box-sizing:border-box;line-height:1.4}
.dsh-ig-regenerate-dialog h3{margin:0;font-size:16px;font-weight:650}
.dsh-ig-regenerate-dialog p{margin:7px 0 16px;color:var(--dsw-alias-label-tertiary,#737d8f);font-size:12.5px;line-height:1.55}
.dsh-ig-regenerate-dialog label{display:grid;gap:7px;font-size:12.5px;font-weight:600}
.dsh-ig-regenerate-dialog textarea{box-sizing:border-box;width:100%;min-height:132px;resize:vertical;border:1px solid var(--dsw-alias-border-l2,#d7dce5);border-radius:9px;padding:11px 12px;background:var(--dsw-alias-bg-layer-2,#fff);color:inherit;font:inherit;font-size:13px;line-height:1.55;outline:none}
.dsh-ig-regenerate-dialog textarea:focus{border-color:var(--dsw-alias-brand-primary,#4c78ff);box-shadow:0 0 0 3px rgba(76,120,255,.12)}
.dsh-ig-regenerate-error{margin-top:10px!important;color:var(--dsw-alias-label-error,#d33)!important}
.dsh-ig-regenerate-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:16px}
.dsh-ig-regenerate-actions button{height:35px;padding:0 14px;border-radius:7px;font:inherit;font-size:13px;font-weight:550;cursor:pointer}
.dsh-ig-regenerate-cancel{border:1px solid var(--dsw-alias-border-l2,#d7dce5);background:transparent;color:inherit}
.dsh-ig-regenerate-confirm{border:1px solid var(--dsw-alias-brand-primary,#3569ed);background:var(--dsw-alias-brand-primary,#3569ed);color:#fff}
.dsh-ig-regenerate-actions button:disabled{opacity:.5;cursor:default}
@media(hover:none){.dsh-ig-container .dsh-ig-toolbar{opacity:1;pointer-events:auto}}
@keyframes dsh-ig-fade{from{opacity:0}to{opacity:1}}
.dsh-ig-error{color:var(--dsw-alias-label-error,#d33);font-size:13px}
.dsh-ig-loading{color:var(--dsw-alias-label-tertiary,#7b818b);font-size:13px}

/* Native Workspace Gallery & Studio View (Renders seamlessly inside DSH Session View) */
.dsh-ig-gallery-page{width:100%;height:100%;background:var(--dsw-alias-bg-layer-1,#ffffff);display:flex;flex-direction:column;overflow:hidden;flex:1}

/* 1. Top Navigation Tab Bar */
.dsh-ig-studio-tabs-bar{display:flex;align-items:center;gap:6px;padding:6px 24px;border-bottom:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#ffffff);flex-shrink:0}
.dsh-ig-studio-tab-btn{appearance:none;-webkit-appearance:none;border:0;background:transparent;display:inline-flex;align-items:center;gap:7px;padding:7px 14px;font-size:13px;font-weight:500;color:var(--dsw-alias-label-secondary,#64748b);cursor:pointer;border-radius:6px;transition:color .15s ease,background-color .15s ease}
.dsh-ig-studio-tab-btn:hover{color:var(--dsw-alias-label-primary,#0f172a);background:var(--dsw-alias-bg-layer-2,#f1f5f9)}
.dsh-ig-studio-tab-btn.is-active{color:var(--dsw-alias-brand-primary,#2563eb);font-weight:600;background:rgba(37,99,235,0.08)}

/* 2. Secondary Filter & Search Toolbar */
.dsh-ig-studio-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 24px;background:var(--dsw-alias-bg-layer-1,#ffffff);border-bottom:1px solid var(--dsw-alias-border-l2,#f1f5f9);flex-shrink:0;flex-wrap:wrap}
.dsh-ig-studio-toolbar-left{display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex:1;min-width:0}
.dsh-ig-studio-toolbar-right{display:flex;align-items:center;gap:10px;flex-shrink:0}

/* Modern Custom Select (Removes OS default arrows & ugly borders) */
.dsh-ig-studio-select{appearance:none;-webkit-appearance:none;-moz-appearance:none;height:32px;line-height:30px;padding:0 28px 0 12px;font-size:12.5px;color:var(--dsw-alias-label-primary,#334155);background-color:var(--dsw-alias-bg-layer-2,#ffffff);background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 9px center;border:1px solid var(--dsw-alias-border-l2,#e2e8f0);border-radius:6px;outline:none;cursor:pointer;box-sizing:border-box;transition:border-color .15s ease,box-shadow .15s ease,background-color .15s ease}
.dsh-ig-studio-select:hover{border-color:var(--dsw-alias-border-l1,#cbd5e1);background-color:var(--dsw-alias-bg-layer-1,#f8fafc)}
.dsh-ig-studio-select:focus{border-color:var(--dsw-alias-brand-primary,#3b82f6);box-shadow:0 0 0 2px rgba(59,130,246,0.15)}
.dsh-ig-studio-select-sort{font-weight:500}

/* Unified Search Input */
.dsh-ig-studio-search-wrap{position:relative;display:flex;align-items:center;min-width:190px;max-width:320px;flex:1}
.dsh-ig-studio-search-icon{position:absolute;left:10px;color:var(--dsw-alias-label-tertiary,#94a3b8);pointer-events:none}
.dsh-ig-studio-search-input{width:100%;height:32px;line-height:30px;padding:0 12px 0 32px;font-size:12.5px;border:1px solid var(--dsw-alias-border-l2,#e2e8f0);border-radius:6px;background-color:var(--dsw-alias-bg-layer-2,#ffffff);color:inherit;outline:none;box-sizing:border-box;transition:border-color .15s ease,box-shadow .15s ease}
.dsh-ig-studio-search-input:hover{border-color:var(--dsw-alias-border-l1,#cbd5e1)}
.dsh-ig-studio-search-input:focus{border-color:var(--dsw-alias-brand-primary,#3b82f6);box-shadow:0 0 0 2px rgba(59,130,246,0.15)}
.dsh-ig-studio-search-input::placeholder{color:var(--dsw-alias-label-tertiary,#94a3b8)}

/* 3. Grid & Responsive Cards */
.dsh-ig-gallery-page-body{flex:1;overflow-y:auto;padding:20px 24px}
.dsh-ig-gallery-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:18px}
.dsh-ig-gallery-card{background:var(--dsw-alias-bg-layer-2,#ffffff);border:1px solid var(--dsw-alias-border-l2,#e2e8f0);border-radius:10px;overflow:hidden;display:flex;flex-direction:column;cursor:pointer;transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}
.dsh-ig-gallery-card:hover{transform:translateY(-2px);box-shadow:0 10px 20px -5px rgba(0,0,0,0.06),0 4px 6px -2px rgba(0,0,0,0.03);border-color:var(--dsw-alias-border-l1,#cbd5e1)}
.dsh-ig-gallery-card-media{position:relative;width:100%;aspect-ratio:1/1;background:#f1f5f9;overflow:hidden;display:flex;align-items:center;justify-content:center}
.dsh-ig-gallery-card-img{width:100%;height:100%;object-fit:cover;transition:transform .2s ease}
.dsh-ig-gallery-card:hover .dsh-ig-gallery-card-img{transform:scale(1.03)}
.dsh-ig-gallery-card-loading{font-size:12px;color:#94a3b8}
.dsh-ig-gallery-card-error{font-size:12px;color:#ef4444;padding:8px;text-align:center}

/* Floating Action Toolbar on Card Hover */
.dsh-ig-gallery-card:hover .dsh-ig-card-toolbar{opacity:1;pointer-events:auto}
.dsh-ig-card-toolbar{position:absolute;top:6px;left:6px;display:flex;align-items:center;gap:3px;padding:3px 5px;border-radius:6px;background:rgba(15,23,42,0.72);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);opacity:0;pointer-events:none;transition:opacity .18s ease;z-index:10;line-height:1}

/* Card Bottom Metadata */
.dsh-ig-gallery-card-meta{padding:10px 12px;display:flex;flex-direction:column;gap:5px;background:var(--dsw-alias-bg-layer-2,#ffffff);flex:1}
.dsh-ig-card-badge-row{display:flex;align-items:center}
.dsh-ig-card-badge{display:inline-block;padding:2px 6px;border-radius:4px;background:var(--dsw-alias-bg-layer-3,#f1f5f9);color:var(--dsw-alias-label-secondary,#475569);font-size:11px;font-weight:500;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ig-gallery-card-prompt-line{font-size:12.5px;font-weight:500;color:var(--dsw-alias-label-primary,#1e293b);line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ig-card-footer-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:2px}
.dsh-ig-card-meta-text{font-size:11px;color:var(--dsw-alias-label-tertiary,#94a3b8);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-ig-card-fav-btn{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,#94a3b8);padding:2px;border-radius:4px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:color .15s,transform .15s;flex-shrink:0}
.dsh-ig-card-fav-btn:hover{color:#ef4444;transform:scale(1.15)}
.dsh-ig-card-fav-btn.is-favorited{color:#ef4444}

/* Placeholders for Upcoming Routes */
.dsh-ig-placeholder-view{display:flex;align-items:center;justify-content:center;min-height:360px;height:100%;padding:24px}
.dsh-ig-placeholder-card{max-width:500px;width:100%;text-align:center;padding:36px 28px;background:var(--dsw-alias-bg-layer-2,#ffffff);border:1px dashed var(--dsw-alias-border-l2,#e2e8f0);border-radius:14px;display:flex;flex-direction:column;align-items:center;gap:12px}
.dsh-ig-placeholder-icon{font-size:40px;line-height:1}
.dsh-ig-placeholder-header{display:flex;align-items:center;gap:8px;justify-content:center}
.dsh-ig-placeholder-title{font-size:16px;font-weight:600;color:var(--dsw-alias-label-primary,inherit);margin:0}
.dsh-ig-placeholder-badge{font-size:11px;font-weight:500;background:rgba(37,99,235,0.1);color:#2563eb;padding:2px 8px;border-radius:12px}
.dsh-ig-placeholder-desc{font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary,#64748b);margin:0}
.dsh-ig-placeholder-tip{margin-top:6px;padding:8px 12px;font-size:12px;background:var(--dsw-alias-bg-layer-3,#f8fafc);border-radius:8px;color:var(--dsw-alias-label-tertiary,#64748b);text-align:left}

/* Empty State */
.dsh-ig-gallery-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;min-height:360px;text-align:center;color:var(--dsw-alias-label-tertiary,#94a3b8)}
.dsh-ig-gallery-empty-icon{display:block;width:44px;height:44px;margin-bottom:10px;color:var(--dsw-alias-label-tertiary,#94a3b8);opacity:.7}
.dsh-ig-gallery-empty-title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary,inherit);margin-bottom:4px}
.dsh-ig-gallery-empty-desc{font-size:13px;max-width:360px;line-height:1.5}

/* Pure Centered Lightbox */
.dsh-ig-lightbox-backdrop{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.88);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;cursor:zoom-out;animation:dsh-ig-fade .15s ease-out}
.dsh-ig-lightbox-topbar{position:absolute;top:20px;left:24px;right:24px;display:flex;align-items:center;justify-content:space-between;z-index:10;pointer-events:none}
.dsh-ig-lightbox-meta{display:flex;align-items:center;gap:8px;pointer-events:auto}
.dsh-ig-tag{display:inline-block;padding:2px 6px;border-radius:4px;background:var(--dsw-alias-bg-layer-3,#edf0f3);color:var(--dsw-alias-label-secondary,inherit);font-weight:500;text-transform:uppercase;font-size:10px}
.dsh-ig-tag-model{background:rgba(76,120,255,0.1);color:#4c78ff}
.dsh-ig-lightbox-close-btn{appearance:none;border:0;background:rgba(255,255,255,0.15);color:#fff;border-radius:50%;width:34px;height:34px;font-size:16px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:background .15s;pointer-events:auto}
.dsh-ig-lightbox-close-btn:hover{background:rgba(255,255,255,0.3)}
.dsh-ig-lightbox-img-wrap{max-width:86vw;max-height:78vh;display:flex;align-items:center;justify-content:center;cursor:default}
.dsh-ig-lightbox-img{max-width:100%;max-height:78vh;object-fit:contain;border-radius:8px;box-shadow:0 24px 60px rgba(0,0,0,0.7);user-select:none}
.dsh-ig-lightbox-bottombar{position:absolute;bottom:24px;left:50%;transform:translateX(-50%);max-width:min(90vw,640px);background:rgba(20,22,26,0.85);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.15);border-radius:14px;padding:10px 16px;display:flex;flex-direction:column;gap:8px;color:#fff;box-shadow:0 16px 40px rgba(0,0,0,0.5);cursor:default}
.dsh-ig-lightbox-prompt-text{font-size:13px;line-height:1.4;color:rgba(255,255,255,0.92);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.dsh-ig-lightbox-counter{display:inline-flex;align-items:center;padding:2px 8px;border-radius:4px;background:rgba(255,255,255,0.15);color:#fff;font-size:11.5px;font-weight:500;font-variant-numeric:tabular-nums}
.dsh-ig-lightbox-nav-btn{position:fixed;top:50%;transform:translateY(-50%);width:44px;height:44px;border-radius:50%;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.12);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:100;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);transition:background-color .15s ease,transform .15s ease,opacity .15s ease;outline:none}
.dsh-ig-lightbox-nav-btn:hover:not(:disabled){background:rgba(255,255,255,0.28);transform:translateY(-50%) scale(1.08)}
.dsh-ig-lightbox-nav-btn:disabled{opacity:0.2;cursor:not-allowed;pointer-events:none}
.dsh-ig-lightbox-nav-prev{left:24px}
.dsh-ig-lightbox-nav-next{right:24px}
.dsh-ig-lightbox-loading{display:flex;align-items:center;justify-content:center;min-width:180px;min-height:180px}
.dsh-ig-lightbox-spinner{width:36px;height:36px;border:3px solid rgba(255,255,255,0.2);border-top-color:#fff;border-radius:50%;animation:dsh-ig-spin .8s linear infinite}
@keyframes dsh-ig-spin{to{transform:rotate(360deg)}}
.dsh-ig-lightbox-btn{appearance:none;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.08);color:#fff;border-radius:6px;padding:5px 10px;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;transition:background .15s,border-color .15s,color .15s}
.dsh-ig-lightbox-btn:hover{background:rgba(255,255,255,0.22)}
.dsh-ig-lightbox-btn-danger{border-color:rgba(239,68,68,0.4);color:#fca5a5}
.dsh-ig-lightbox-btn-danger:hover{background:rgba(239,68,68,0.35)!important;color:#fff!important;border-color:rgba(239,68,68,0.7)!important}
.dsh-ig-gallery-page-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#fff;padding:6px 14px;border-radius:8px;font-size:13px;z-index:99999;animation:dsh-ig-fade .15s}

/* Card selection and checkbox */
.dsh-ig-gallery-card.is-selected{box-shadow:0 0 0 2px var(--dsw-alias-brand-primary,#2563eb);border-color:transparent}
.dsh-ig-card-checkbox{position:absolute;top:8px;left:8px;width:22px;height:22px;border-radius:50%;border:1.5px solid rgba(255,255,255,0.7);background:rgba(0,0,0,0.35);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);color:#fff;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;z-index:5;opacity:0;transition:opacity .15s ease,background-color .15s ease,border-color .15s ease;padding:0;outline:none}
.dsh-ig-gallery-card:hover .dsh-ig-card-checkbox,.dsh-ig-gallery-card.is-manage-mode .dsh-ig-card-checkbox,.dsh-ig-card-checkbox.is-checked{opacity:1}
.dsh-ig-card-checkbox.is-checked{background:var(--dsw-alias-brand-primary,#2563eb);border-color:var(--dsw-alias-brand-primary,#2563eb)}

/* Studio button in toolbar */
.dsh-ig-studio-btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;box-sizing:border-box;border-radius:6px;border:1px solid var(--dsw-alias-border-subtle,rgba(0,0,0,0.12));background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,inherit);font-size:12.5px;font-weight:500;cursor:pointer;transition:border-color .15s,background .15s,color .15s}
.dsh-ig-studio-btn:hover{background:var(--dsw-alias-bg-layer-3,#f3f4f6);border-color:var(--dsw-alias-border-default,rgba(0,0,0,0.2))}
.dsh-ig-studio-btn.is-active{background:var(--dsw-alias-brand-primary,#2563eb);border-color:var(--dsw-alias-brand-primary,#2563eb);color:#fff}
.dsh-ig-studio-btn-danger{color:#ef4444;border-color:rgba(239,68,68,0.35);background:rgba(239,68,68,0.06)}
.dsh-ig-studio-btn-danger:hover{background:rgba(239,68,68,0.14);border-color:rgba(239,68,68,0.6);color:#dc2626}
.dsh-ig-studio-btn-danger.is-active{background:#dc2626;border-color:#dc2626;color:#fff}

/* Floating Batch Action Bar */
.dsh-ig-batch-bar{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:16px;background:rgba(20,24,32,0.92);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,0.18);border-radius:40px;padding:8px 16px;box-shadow:0 16px 40px rgba(0,0,0,0.5);z-index:99990;animation:dsh-ig-slide-up .2s cubic-bezier(0.16,1,0.3,1);color:#fff}
@keyframes dsh-ig-slide-up{from{transform:translate(-50%,20px);opacity:0}to{transform:translate(-50%,0);opacity:1}}
.dsh-ig-batch-bar-left{display:flex;align-items:center;gap:10px}
.dsh-ig-batch-bar-right{display:flex;align-items:center;gap:8px;border-left:1px solid rgba(255,255,255,0.15);padding-left:12px}
.dsh-ig-batch-counter{font-size:13px;font-weight:600;color:rgba(255,255,255,0.95);margin-right:4px}
.dsh-ig-batch-btn{appearance:none;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.08);color:#fff;border-radius:20px;padding:5px 12px;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;transition:background .15s,border-color .15s,color .15s}
.dsh-ig-batch-btn:hover:not(:disabled){background:rgba(255,255,255,0.2)}
.dsh-ig-batch-btn:disabled{opacity:0.4;cursor:not-allowed}
.dsh-ig-batch-btn.is-favorited{background:rgba(239,68,68,0.15);border-color:rgba(239,68,68,0.4);color:#fca5a5}
.dsh-ig-batch-btn.is-favorited:hover:not(:disabled){background:rgba(239,68,68,0.25)!important;border-color:rgba(239,68,68,0.6)!important;color:#fff!important}
.dsh-ig-batch-btn-download:hover:not(:disabled){background:rgba(59,130,246,0.2)!important;border-color:rgba(59,130,246,0.5)!important;color:#93c5fd!important}
.dsh-ig-batch-divider{width:1px;height:16px;background:rgba(255,255,255,0.18);margin:0 2px;display:inline-block}
.dsh-ig-batch-btn-danger{background:rgba(239,68,68,0.2);border-color:rgba(239,68,68,0.5);color:#fca5a5}
.dsh-ig-batch-btn-danger:hover:not(:disabled){background:rgba(239,68,68,0.4)!important;border-color:rgba(239,68,68,0.8)!important;color:#fff!important}
.dsh-ig-batch-btn-exit{border-color:transparent;background:transparent;color:rgba(255,255,255,0.7)}
.dsh-ig-batch-btn-exit:hover{background:rgba(255,255,255,0.1);color:#fff}

/* Batch Delete Confirmation Modal */
.dsh-ig-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);z-index:100005;display:flex;align-items:center;justify-content:center;padding:16px;animation:dsh-ig-fade .15s ease-out}
.dsh-ig-modal-box{width:100%;max-width:440px;background:var(--dsw-alias-bg-layer-1,#1c1e24);border:1px solid var(--dsw-alias-border-subtle,rgba(255,255,255,0.12));border-radius:12px;padding:22px;box-sizing:border-box;box-shadow:0 20px 50px rgba(0,0,0,0.45);color:var(--dsw-alias-label-primary,#fff);animation:dsh-ig-scale-up .15s ease-out}
@keyframes dsh-ig-scale-up{from{transform:scale(0.95);opacity:0}to{transform:scale(1);opacity:1}}
.dsh-ig-modal-header{display:flex;align-items:flex-start;gap:12px;margin-bottom:12px}
.dsh-ig-modal-icon-danger{width:36px;height:36px;border-radius:50%;background:rgba(239,68,68,0.12);color:#ef4444;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.dsh-ig-modal-title{font-size:16px;font-weight:600;line-height:1.4}
.dsh-ig-modal-body{margin-bottom:20px;padding-left:48px}
.dsh-ig-modal-desc{font-size:13.5px;color:var(--dsw-alias-label-secondary,rgba(255,255,255,0.7));margin:0 0 14px 0;line-height:1.5}
.dsh-ig-modal-checkbox-label{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--dsw-alias-label-primary,inherit);cursor:pointer;user-select:none}
.dsh-ig-modal-checkbox-label input{margin:0;cursor:pointer;width:15px;height:15px}
.dsh-ig-modal-footer{display:flex;align-items:center;justify-content:flex-end;gap:10px}
.dsh-ig-modal-btn{height:34px;padding:0 14px;border-radius:6px;font-size:13px;font-weight:500;cursor:pointer;transition:background .15s,border-color .15s,color .15s;outline:none}
.dsh-ig-modal-btn-cancel{background:transparent;border:1px solid var(--dsw-alias-border-subtle,rgba(255,255,255,0.2));color:var(--dsw-alias-label-primary,inherit)}
.dsh-ig-modal-btn-cancel:hover{background:var(--dsw-alias-bg-layer-3,rgba(255,255,255,0.08))}
.dsh-ig-modal-btn-danger{background:#dc2626;border:1px solid #dc2626;color:#fff}
.dsh-ig-modal-btn-danger:hover{background:#b91c1c;border-color:#b91c1c}
.dsh-ig-modal-btn-primary{background:linear-gradient(135deg,#3b82f6,#2563eb);border:1px solid #2563eb;color:#fff;display:inline-flex;align-items:center;gap:6px}
.dsh-ig-modal-btn-primary:hover:not(:disabled){background:linear-gradient(135deg,#2563eb,#1d4ed8)}
.dsh-ig-modal-btn-primary:disabled{opacity:0.5;cursor:not-allowed}
.dsh-ig-regenerate-modal-box{max-width:520px}
.dsh-ig-regenerate-modal-icon{width:36px;height:36px;border-radius:50%;background:rgba(59,130,246,0.15);color:#3b82f6;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.dsh-ig-regenerate-modal-title-wrap{display:flex;flex-direction:column;gap:4px}
.dsh-ig-regenerate-modal-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dsh-ig-regenerate-modal-textarea{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,0.25));border:1px solid var(--dsw-alias-border-subtle,rgba(255,255,255,0.15));border-radius:8px;padding:10px 12px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary,#fff);resize:vertical;font-family:inherit;outline:none;transition:border-color .15s,box-shadow .15s}
.dsh-ig-regenerate-modal-textarea:focus{border-color:#3b82f6;box-shadow:0 0 0 2px rgba(59,130,246,0.2)}
.dsh-ig-lightbox-btn-regenerate:hover{color:#60a5fa!important;border-color:rgba(96,165,250,0.5)!important;background:rgba(96,165,250,0.12)!important}
.dsh-ig-lightbox-generating-indicator{display:inline-flex;align-items:center;gap:8px;padding:4px 12px;background:rgba(37,99,235,0.2);border:1px solid rgba(59,130,246,0.5);border-radius:20px;font-size:12px;color:#93c5fd;animation:dsh-ig-fade .15s ease-out}
.dsh-ig-lightbox-spinner-sm{width:12px;height:12px;border:2px solid rgba(147,197,253,0.3);border-top-color:#93c5fd;border-radius:50%;animation:dsh-ig-spin .8s linear infinite;flex-shrink:0}
.dsh-ig-lightbox-abort-btn{appearance:none;background:transparent;border:0;color:#fca5a5;font-size:11.5px;cursor:pointer;padding:0 4px;margin-left:4px;text-decoration:underline;text-underline-offset:2px}
.dsh-ig-lightbox-abort-btn:hover{color:#ef4444}

/* Hide floating chat composer and width handles when the conversation-view
   gallery page is active. The right-sidebar variant (dsh-ig-page-in-sidebar)
   is excluded: the native conversation runs beside it and needs its composer
   and the column handles untouched. */
[data-conversation-scroll]:has(.dsh-ig-gallery-page:not(.dsh-ig-page-in-sidebar)) [data-composer-seat]{display:none!important}
:has(> [data-conversation-scroll]:has(.dsh-ig-gallery-page:not(.dsh-ig-page-in-sidebar))) > [class*="widthHandle"],
:has(.dsh-ig-gallery-page:not(.dsh-ig-page-in-sidebar)) [class*="widthHandle"],
.root:has(.dsh-ig-gallery-page:not(.dsh-ig-page-in-sidebar)) [class*="widthHandle"]{display:none!important}
`



/**
 * Required browser services. The settings form reader is deliberately absent:
 * DSH 0.1.7 serves it as `configForms` (keyed by the Loader entry id) while
 * 0.1.5/0.1.6 expose `settingsScope` (keyed by the legacy namespace), so it is
 * probed at runtime in `apply`. A static inject of either name would park this
 * fiber forever on hosts from the other generation — the issue #55 failure.
 */
export const inject = ['slots', 'connection', 'remote', 'locale']

/** Settings-form reader as shaped by DSH 0.1.7's `configForms` service. */
interface ConfigFormsApi {
  get<T>(id: string): SettingsScope<T>
}
/** Settings-form reader as shaped by DSH 0.1.5/0.1.6's `settingsScope` service. */
interface SettingsScopeApi {
  bind<T>(options: { namespace: string }): SettingsScope<T>
}

/** Host with neither settings generation: reads empty, writes refuse, never throws. */
function degradedScope<T>(): SettingsScope<T> {
  return {
    getSnapshot: () => ({ value: undefined, writable: false, status: 'unavailable' }),
    subscribe: () => () => {},
    set: async () => false,
  }
}

/** Mount the settings card, generated-image card, and native conversation gallery view. */
export function apply(ctx: Context): void {
  // Probe instead of inject (see `inject`): 0.1.7+ resolves `configForms`,
  // older hosts fall back to `settingsScope`, and `ctx.get` reads undefined for
  // a service the host never declared.
  const configForms = ctx.get('configForms') as ConfigFormsApi | undefined
  const settingsScopeApi = configForms === undefined
    ? ctx.get('settingsScope') as SettingsScopeApi | undefined
    : undefined
  const scope = configForms?.get<ImageSettings>(IMAGE_GENERATION_ENTRY_ID)
    ?? settingsScopeApi?.bind<ImageSettings>({ namespace: IMAGE_GENERATION_NAMESPACE })
    ?? degradedScope<ImageSettings>()
  const locale = ctx.get('locale') as LocaleService | undefined
  const promotion = { enabled: false }

  ;(ctx.inject as unknown as (services: string[], callback: (owner: Context) => void) => void)(
    ['sessions'],
    owner => {
      const sessions = owner.get('sessions') as CanvasSessions | undefined
      if (typeof sessions?.binding !== 'function' || typeof sessions.list?.subscribe !== 'function') return
      const selection = createCanvasSessionSelection()
      owner.effect(() => startConversationLandings(sessions, selection), 'dsh-image-gen: live canvas images')
      // Optional injection keeps old hosts working and also handles uiSession
      // becoming available after the session controller has already started.
      ;(owner.inject as unknown as (services: string[], callback: (uiOwner: Context) => void) => void)(['uiSession'], uiOwner => {
        const ui = uiOwner.get('uiSession') as { adapter?: { current?: CanvasSessionSelection } } | undefined
        const current = ui?.adapter?.current
        if (typeof current?.getSnapshot !== 'function' || typeof current.subscribe !== 'function') return
        uiOwner.effect(() => selection.bind(current), 'dsh-image-gen: current canvas session')
      })
    },
  )

  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-image-gen'
    style.textContent = `${STYLE}\n${STUDIO_STYLE}\n${INSPIRATION_STYLE}\n${TL_CSS}\n${TL_THEME_CSS}`
    document.head.appendChild(style)
    return () => {
      style.remove()
    }
  }, 'dsh-image-gen: styles')

  // One-time cleanup: the workflow canvas tab was removed; drop its orphaned
  // IndexedDB database. Best-effort only: a missing database succeeds
  // immediately, and failures (locked/blocked) are ignored.
  if (typeof indexedDB !== 'undefined') {
    const request = indexedDB.deleteDatabase('dsh_image_gen_canvas')
    request.onerror = () => {}
    request.onblocked = () => {}
  }

  const register = ctx.slots.register.bind(ctx.slots) as unknown as (options: object, component: unknown) => () => void

  ;(ctx.inject as unknown as (services: string[], callback: (owner: Context) => void) => void)(
    ['uiConversation'],
    (owner) => {
      const uiConversation = asModernUiConversation(owner.get('uiConversation'))
      if (uiConversation === undefined) {
        throw new Error('dsh-image-gen: uiConversation has an incompatible interface')
      }
      promotion.enabled = true
      const ownerRegister = owner.slots.register.bind(owner.slots) as unknown as (options: object, component: unknown) => () => void
      owner.effect(
      () => uiConversation.events.register(createImageResultDefinition()),
      'dsh-image-gen: promoted image result node',
      )
      ;(owner.slots.inject as any)('conversation.chat.node', () => ownerRegister({
        name: 'conversation.chat.node',
        key: IMAGE_RESULT_NODE_KIND,
        inject: () => ({ locale }),
      }, PromotedImageResultNode))
    },
  )

  // 1. Settings item
  // Credential badges stay fresh: relay host reference-updated events to the settings card.
  const credentialListeners = new Set<() => void>()
  const notifyCredentialsUpdated = (): void => { for (const listener of credentialListeners) listener() }
  ctx.effect(() => {
    const remote = ctx.get('remote') as { $on?: (event: 'credentials/reference-updated', listener: () => void) => () => void } | undefined
    if (typeof remote?.$on !== 'function') return () => {}
    return remote.$on('credentials/reference-updated', notifyCredentialsUpdated)
  }, 'dsh-image-gen: credential events')
  const credentialEvents: CredentialEvents = {
    listen(callback: () => void): () => void {
      credentialListeners.add(callback)
      return () => { credentialListeners.delete(callback) }
    },
  }
  // The card lives on this plugin's own page in the Plugins manager. DSH's
  // plugins page renders the keyed list slot 'plugins.bundle.config' inside a
  // bundle's detail page — keyed by the bundle's package name — so the card is
  // one click from the plugin row it configures, and the settings rail keeps no
  // extra row or tab. The page host renders it with view: 'page' and the card
  // draws its own title, form and save controls.
  //
  // The older per-plugin seat ('settings.plugin.item', hosts <=0.1.5) stays
  // registered so one build stays reachable on every host this plugin supports;
  // a host without that slot never mounts it.
  const injectSettingsItem = (owner: Context): void => {
    const ownerRegister = owner.slots.register.bind(owner.slots) as unknown as (options: object, component: unknown) => () => void
    const injectSettingsFace = (): SettingsFace => ({ scope, credentials: credentialsProxy, credentialsAvailable, locale, credentialEvents })
    ;(owner.slots.inject as (key: string, factory: () => () => void) => void)('plugins.bundle.config', () => ownerRegister({
      name: 'plugins.bundle.config',
      // Keyed slots select by bundle package name, and this plugin ships as the
      // 'dsh-image-gen' bundle.
      key: 'dsh-arya-image-gen',
      locale,
      inject: injectSettingsFace,
    }, ImageGenerationSettingsCard))
    ;(owner.slots.inject as (key: string, factory: () => () => void) => void)('settings.plugin.item', () => ownerRegister({
      name: 'settings.plugin.item',
      key: IMAGE_GENERATION_NAMESPACE,
      inject: injectSettingsFace,
    }, ImageGenerationSettingsCard))
  }
  // Credentials resolve through a mutable holder: hosts expose the service
  // synchronously (probed now) or later (deferred inject below). The card
  // mounts unconditionally — a missing service degrades only the key UI
  // instead of hiding the whole card (issue #32).
  const credentialsRef: { current: CredentialsRemote | undefined } = {
    current: asCredentialsRemote(ctx.get('remote.credentials')) ?? credentialsFromLegacyConnection(ctx.get('connection')),
  }
  /** Stable delegating remote so the host-cached inject face never goes stale. */
  const credentialsProxy: CredentialsRemote = {
    describe(refs) {
      const remote = credentialsRef.current
      return remote === undefined ? Promise.resolve({ ok: false }) : remote.describe(refs)
    },
    set(ref, value) {
      const remote = credentialsRef.current
      return remote === undefined
        ? Promise.resolve({ ok: false, error: { message: 'credentials service unavailable' } })
        : remote.set(ref, value)
    },
    get unset() {
      const remote = credentialsRef.current
      return remote?.unset?.bind(remote)
    },
  }
  /** False while the host core exposes no credentials service (preview cores). */
  const credentialsAvailable = (): boolean => credentialsRef.current !== undefined
  injectSettingsItem(ctx)
  // Preview cores can expose the credentials service after this plugin loads:
  // adopt it late and refresh every mounted card through the shared events.
  ctx.inject(['remote.credentials'], (remoteCtx) => {
    const credentials = asCredentialsRemote(remoteCtx.get('remote.credentials'))
    if (credentials === undefined) {
      console.warn('dsh-image-gen: remote.credentials resolved with an incompatible interface; key settings stay degraded')
      return
    }
    credentialsRef.current = credentials
    notifyCredentialsUpdated()
  })

  // 2. Tool result view card in chat stream
  ctx.slots.inject('tool.call.toolview', () => register({
    name: 'tool.call.toolview',
    key: 'generate_image',
    inject: (): ImageCardFace => ({ locale, promoted: promotion.enabled }),
  }, GeneratedImageCard))
  ctx.slots.inject('tool.call.toolview', () => register({
    name: 'tool.call.toolview',
    key: 'generate_images',
    inject: (): ImageCardFace => ({ locale, promoted: promotion.enabled }),
  }, GeneratedImagesCard))
  ctx.slots.inject('tool.call.toolview', () => register({
    name: 'tool.call.toolview',
    key: 'edit_image',
    inject: (): ImageCardFace => ({ locale, promoted: promotion.enabled }),
  }, GeneratedImageCard))

  // 3. Native conversation view tab (DSH official slot: 'conversation.view')
  ;(ctx.slots.inject as any)('conversation.view', () => register({
    name: 'conversation.view',
    id: 'gallery',
    order: 20,
    label: () => {
      const active = locale?.getSnapshot?.()?.active
      return 'Gallery'
    },
    inject: () => ({ locale, credentialEvents }),
  }, GalleryViewTab))

  // 4. Right-sidebar studio tab (DSH 0.1.5 official `sidebar.right.pane.tab`
  // seat): the native conversation keeps the main column while the workbench -
  // tldraw infinite canvas + generate form + recent list - docks beside it in
  // the old image-details seat. Two-stage registration, exactly as
  // ui-sidebar-documentpreview does it: the type into `sidebarRightTabs`, the
  // body into the keyed seat under the definition's id. Deferred injection
  // keeps pre-0.1.5 hosts booting: without the service the seat simply never
  // appears and the conversation-view gallery tab remains the only surface.
  ;(ctx.inject as unknown as (services: string[], callback: (owner: Context) => void) => void)(
    ['sidebarRightTabs'],
    (owner) => {
      const sidebarTabs = owner.get('sidebarRightTabs') as SidebarRightTabsFace
      const sidebarTitle = (): string => {
        const active = locale?.getSnapshot?.()?.active
        return 'Image Studio'
      }
      // Stage one - the page type. The guide entry is the only one registered
      // (the shipped guide declares none), so `defaultSeed` lands every new
      // sidebar straight onto the studio tab.
      owner.effect(() => sidebarTabs.register({
        id: SIDEBAR_STUDIO_TAB_ID,
        kind: SIDEBAR_STUDIO_TAB_KIND,
        priority: 'extension',
        title: () => sidebarTitle(),
        guide: [{ order: 100, title: () => sidebarTitle() }],
      }), 'dsh-image-gen: sidebar studio tab type')
      // Stage two - the body, keyed by the definition id.
      const ownerRegister = owner.slots.register.bind(owner.slots) as unknown as (options: object, component: unknown) => () => void
      ;(owner.slots.inject as (key: string, factory: () => () => void) => void)('sidebar.right.pane.tab', () => ownerRegister({
        name: 'sidebar.right.pane.tab',
        key: SIDEBAR_STUDIO_TAB_ID,
        inject: (): GalleryViewTabProps => ({
          locale,
          credentialEvents,
          inSidebar: true,
          defaultTab: 'studio',
          initialCanvasSurface: 'infinite',
        }),
      }, GalleryViewTab))
    },
  )
}

function asModernUiConversation(value: unknown): ModernUiConversation | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const events = (value as { events?: unknown }).events
  if (events === null || typeof events !== 'object') return undefined
  return typeof (events as { register?: unknown }).register === 'function'
    ? value as ModernUiConversation
    : undefined
}

function asCredentialsRemote(value: unknown): CredentialsRemote | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const candidate = value as Partial<CredentialsRemote>
  return typeof candidate.describe === 'function' && typeof candidate.set === 'function'
    ? candidate as CredentialsRemote
    : undefined
}

function credentialsFromLegacyConnection(value: unknown): CredentialsRemote | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const credentials = (value as { api?: { credentials?: Partial<LegacyCredentialsApi> } }).api?.credentials
  if (credentials === undefined || typeof credentials.describe !== 'function' || typeof credentials.set !== 'function') return undefined
  const legacy = credentials as LegacyCredentialsApi
  return {
    async describe(refs) {
      const response = await legacy.describe({ refs })
      return response.result.ok
        ? { ok: true, value: response.result.value.credentials }
        : { ok: false }
    },
    async set(ref, credentialValue) {
      const response = await legacy.set({ ref, value: credentialValue })
      return response.result.ok
        ? { ok: true }
        : { ok: false, error: response.result.error }
    },
  }
}

/** ComfyUI-only settings card: connection, workflows, server lifecycle, workspace. */
interface WorkflowDraft {
  name: string
  preset: string
}

/** Settings persisted by this card; the workbench and tools read the same fields. */
interface ImageSettings {
  comfyuiBaseURL?: string
  comfyuiWorkflows?: ComfyUIWorkflowEntry[]
  comfyuiActiveWorkflow?: string
  comfyuiActiveTextWorkflow?: string
  comfyuiActiveEditWorkflow?: string
  comfyuiWorkflowJson?: string
  comfyuiWorkflowName?: string
  comfyuiTimeoutMs?: number
  /** Optional request headers as a JSON object, e.g. a reverse-proxy token. */
  comfyuiHeadersJson?: string
  comfyuiPythonExe?: string
  comfyuiServerDir?: string
  comfyuiExtraArgs?: string
  comfyuiAutoStart?: boolean
  saveToWorkspace?: boolean
  workspaceFolder?: string
  /** Chromium path for HTML/SVG rendering; empty auto-detects. */
  renderBrowserPath?: string
  renderDefaultWidth?: number
  renderDefaultHeight?: number
  renderScale?: number
  renderBackground?: string
  renderSaveSource?: boolean
}

/** Mount the settings card, generated-image card, and native conversation gallery view. */
export function ImageGenerationSettingsCard(props: SettingsCardProps): JSX.Element {
  const { scope } = props
  const snapshot = useSettingsSnapshot(scope)
  const value = snapshot.value
  const writable = snapshot.writable !== false
  const disabled = !writable

  // Local editable copies; committed on blur or an explicit button.
  const [endpoint, setEndpoint] = useState('')
  const [timeoutSeconds, setTimeoutSeconds] = useState(300)
  const [headersJson, setHeadersJson] = useState('')
  const [pythonExe, setPythonExe] = useState('')
  const [serverDir, setServerDir] = useState('')
  const [extraArgs, setExtraArgs] = useState('')
  const [autoStart, setAutoStart] = useState(false)
  const [saveToWorkspace, setSaveToWorkspace] = useState(true)
  const [workspaceFolder, setWorkspaceFolder] = useState('dsh-arya-image-gen')
  const [browserPath, setBrowserPath] = useState('')
  const [renderWidth, setRenderWidth] = useState('1200')
  const [renderHeight, setRenderHeight] = useState('630')
  const [renderBackground, setRenderBackground] = useState('#ffffff')
  const [renderSaveSource, setRenderSaveSource] = useState(true)
  const [renderHealth, setRenderHealth] = useState<{ available: boolean; family?: string; version?: string } | null>(null)
  const [presets, setPresets] = useState<Record<string, string>>({})
  const [activeWorkflow, setActiveWorkflow] = useState('')
  const [editActiveWorkflow, setEditActiveWorkflow] = useState('')
  const [importSummary, setImportSummary] = useState<{ name: string; role: ComfyUIWorkflowRole; chips: string[]; warning?: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const [workflows, setWorkflows] = useState<ComfyUIWorkflowEntry[]>([])
  const [status, setStatus] = useState<ComfyUIServerStatus | null>(null)
  const [serverBusy, setServerBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [messageIsError, setMessageIsError] = useState(false)
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setEndpoint(value?.comfyuiBaseURL ?? DEFAULT_COMFYUI_BASE_URL)
    setTimeoutSeconds(Math.max(1, Math.round((value?.comfyuiTimeoutMs ?? DEFAULT_COMFYUI_TIMEOUT_MS) / 1000)))
    setHeadersJson(value?.comfyuiHeadersJson ?? '')
    setPythonExe(value?.comfyuiPythonExe ?? DEFAULT_COMFYUI_PYTHON_EXE)
    setServerDir(value?.comfyuiServerDir ?? DEFAULT_COMFYUI_SERVER_DIR)
    setExtraArgs(value?.comfyuiExtraArgs ?? DEFAULT_COMFYUI_EXTRA_ARGS)
    setAutoStart(value?.comfyuiAutoStart === true)
    setSaveToWorkspace(value?.saveToWorkspace !== false)
    setWorkspaceFolder(value?.workspaceFolder ?? 'dsh-arya-image-gen')
    setBrowserPath(value?.renderBrowserPath ?? '')
    setRenderWidth(String(value?.renderDefaultWidth ?? 1200))
    setRenderHeight(String(value?.renderDefaultHeight ?? 630))
    setRenderBackground(value?.renderBackground ?? '#ffffff')
    setRenderSaveSource(value?.renderSaveSource !== false)
    const entries = resolveComfyUIWorkflows(value ?? {})
    setWorkflows(entries)
    setPresets(Object.fromEntries(entries.map(entry => [entry.name, entry.presetPrompt ?? ''])))
    setActiveWorkflow(value?.comfyuiActiveTextWorkflow || (activeComfyUIWorkflow(value ?? {})?.name ?? ''))
    setEditActiveWorkflow(value?.comfyuiActiveEditWorkflow ?? '')
  }, [value?.comfyuiBaseURL, value?.comfyuiActiveWorkflow, value?.comfyuiWorkflows, value?.comfyuiWorkflowJson, value?.comfyuiTimeoutMs, value?.comfyuiHeadersJson, value?.comfyuiPythonExe, value?.comfyuiServerDir, value?.comfyuiExtraArgs, value?.comfyuiAutoStart, value?.saveToWorkspace, value?.workspaceFolder, value?.comfyuiActiveTextWorkflow, value?.comfyuiActiveEditWorkflow, value?.renderBrowserPath, value?.renderDefaultWidth, value?.renderDefaultHeight, value?.renderBackground, value?.renderSaveSource])

  // Probe the renderer once when the card opens; a missing browser is a
  // setting to fix, not an error to hide until the first render fails.
  useEffect(() => {
    let cancelled = false
    void fetch(RENDER_HEALTH_ROUTE, { credentials: 'same-origin' })
      .then(async response => response.ok ? await response.json() as { available: boolean; family?: string; version?: string } : null)
      .then(health => { if (!cancelled && health !== null) setRenderHealth(health) })
      .catch(() => { if (!cancelled) setRenderHealth(null) })
    return () => { cancelled = true }
  }, [])

  /** Persist one field; a failed write rolls the local copy back on the next snapshot. */
  const save = async (field: string, next: unknown): Promise<void> => {
    setMessage('')
    try {
      await writeSetting(scope, field, next, 'Setting was not saved. Please try again')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
      setMessageIsError(true)
    }
  }

  /** Commit the ComfyUI fields that are edited as free text. */
  const commitServerFields = (): void => {
    if (endpoint.trim() !== (value?.comfyuiBaseURL ?? DEFAULT_COMFYUI_BASE_URL)) void save('comfyuiBaseURL', endpoint.trim())
    const nextTimeout = Math.max(1, Math.min(3_600, Math.round(timeoutSeconds))) * 1000
    if (nextTimeout !== (value?.comfyuiTimeoutMs ?? DEFAULT_COMFYUI_TIMEOUT_MS)) void save('comfyuiTimeoutMs', nextTimeout)
    try {
      parseComfyUIHeaders(headersJson)
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
      setMessageIsError(true)
      return
    }
    if (headersJson.trim() !== (value?.comfyuiHeadersJson ?? '')) void save('comfyuiHeadersJson', headersJson.trim())
    if (pythonExe.trim() !== (value?.comfyuiPythonExe ?? DEFAULT_COMFYUI_PYTHON_EXE)) void save('comfyuiPythonExe', pythonExe.trim())
    if (serverDir.trim() !== (value?.comfyuiServerDir ?? DEFAULT_COMFYUI_SERVER_DIR)) void save('comfyuiServerDir', serverDir.trim())
    if (extraArgs.trim() !== (value?.comfyuiExtraArgs ?? DEFAULT_COMFYUI_EXTRA_ARGS)) void save('comfyuiExtraArgs', extraArgs.trim())
  }

  /** Load the live server status; called on mount, after an action, and on demand. */
  const refreshStatus = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(COMFYUI_SERVER_ROUTE, { credentials: 'same-origin' })
      const payload = await response.json() as { status?: ComfyUIServerStatus, error?: string }
      if (payload.status !== undefined) setStatus(payload.status)
      else if (payload.error !== undefined) { setMessage(payload.error); setMessageIsError(true) }
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
      setMessageIsError(true)
    }
  }, [])

  useEffect(() => { void refreshStatus() }, [refreshStatus])

  /** Run one server action against the local ComfyUI process manager. */
  const serverAction = async (action: 'start' | 'stop' | 'restart'): Promise<void> => {
    if (serverBusy) return
    setServerBusy(true)
    setMessage('')
    try {
      const response = await fetch(COMFYUI_SERVER_ROUTE, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const payload = await response.json() as { status?: ComfyUIServerStatus, error?: string }
      if (payload.status !== undefined) setStatus(payload.status)
      if (payload.error !== undefined) {
        setMessage(payload.error)
        setMessageIsError(true)
      } else {
        setMessageIsError(false)
        setMessage(`ComfyUI ${action === 'restart' ? 'restarted' : action === 'start' ? 'started' : 'stopped'}.`)
      }
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
      setMessageIsError(true)
    } finally {
      setServerBusy(false)
    }
  }

  /** Import one API-format workflow JSON file under a unique label. */
  const importWorkflow = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return
    setImporting(true)
    setMessage('')
    try {
      if (file.size > MAX_COMFYUI_WORKFLOW_BYTES) throw new Error('The workflow file must be 5 MB or smaller.')
      const text = await file.text()
      validateComfyUIWorkflowJson(text)
      const name = uniqueComfyUIWorkflowName(file.name.replace(/\.json$/i, ''), workflows.map(entry => entry.name))
      const capabilities = describeWorkflowJson(text)
      const next = [...workflows, { name, json: text }]
      await save('comfyuiWorkflows', next)

      // Say what the plugin understood, including whether a sibling already
      // covers the same role and size.
      const chips = [
        ...(capabilities.placeholders.width && capabilities.placeholders.height
          ? ['adjustable size']
          : capabilities.bakedSize === undefined ? [] : [`baked ${String(capabilities.bakedSize.width)}x${String(capabilities.bakedSize.height)}`]),
        ...(capabilities.placeholders.steps ? ['steps'] : []),
        ...(capabilities.placeholders.cfg ? ['cfg'] : []),
      ]
      const duplicate = workflows.some(entry => {
        if (resolveWorkflowRole(entry) !== capabilities.role) return false
        const other = describeWorkflowJson(entry.json)
        if (other.placeholders.width && capabilities.placeholders.width) return false
        return other.bakedSize?.width === capabilities.bakedSize?.width && other.bakedSize?.height === capabilities.bakedSize?.height
      })
      setImportSummary({
        name,
        role: capabilities.role,
        chips,
        ...(duplicate ? { warning: 'A workflow with the same role and size is already imported; one of them is probably redundant.' } : {}),
      })

      if (capabilities.role === 'image-to-image') {
        if (editActiveWorkflow.length === 0) { setEditActiveWorkflow(name); void save('comfyuiActiveEditWorkflow', name) }
      } else if (activeWorkflow.length === 0) {
        setActiveWorkflow(name)
        void save('comfyuiActiveTextWorkflow', name)
        void save('comfyuiActiveWorkflow', name)
      }
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
      setMessageIsError(true)
    } finally {
      setImporting(false)
    }
  }

  /** Pre-flight every workflow against the running ComfyUI. */
  const checkWorkflows = async (): Promise<void> => {
    setChecking(true)
    setMessage('')
    try {
      const response = await fetch(CHECK_WORKFLOWS_ROUTE, { credentials: 'same-origin' })
      const payload = await response.json() as { checks?: { name: string; ok: boolean; missingClasses: string[]; missingModels: string[]; error?: string }[]; error?: string }
      if (!response.ok || payload.checks === undefined) throw new Error(payload.error ?? `HTTP ${String(response.status)}`)
      const broken = payload.checks.filter(check => !check.ok)
      if (broken.length === 0) {
        setMessage(`All ${String(payload.checks.length)} workflows resolve against ComfyUI.`)
        setMessageIsError(false)
      } else {
        setMessage(broken.map(check => `${check.name}: ${[
          check.error ?? '',
          check.missingClasses.length > 0 ? `missing nodes ${check.missingClasses.join(', ')}` : '',
          check.missingModels.length > 0 ? `missing models ${check.missingModels.join(', ')}` : '',
        ].filter(Boolean).join('; ')}`).join(' · '))
        setMessageIsError(true)
      }
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
      setMessageIsError(true)
    } finally {
      setChecking(false)
    }
  }

  /** Persist the workflow list and keep the active selection valid. */
  const persistWorkflows = (next: ComfyUIWorkflowEntry[]): void => {
    setWorkflows(next)
    void save('comfyuiWorkflows', next)
    if (!next.some(entry => entry.name === activeWorkflow)) {
      const fallback = next[0]?.name ?? ''
      setActiveWorkflow(fallback)
      void save('comfyuiActiveWorkflow', fallback)
    }
  }

  const removeWorkflow = (name: string): void => {
    persistWorkflows(workflows.filter(entry => entry.name !== name))
  }

  /** Commit one workflow's preset prompt on blur. */
  const commitPreset = (name: string): void => {
    const text = (presets[name] ?? '').trim()
    if (text === (workflows.find(entry => entry.name === name)?.presetPrompt ?? '')) return
    persistWorkflows(workflows.map(entry => entry.name === name
      ? (text.length > 0 ? { ...entry, presetPrompt: text } : { name: entry.name, json: entry.json })
      : entry))
  }

  const selectActive = (name: string, role: ComfyUIWorkflowRole): void => {
    if (role === 'image-to-image') {
      setEditActiveWorkflow(name)
      void save('comfyuiActiveEditWorkflow', name)
      return
    }
    setActiveWorkflow(name)
    void save('comfyuiActiveTextWorkflow', name)
    // Keep the legacy single key in step for builds without per-role fields.
    void save('comfyuiActiveWorkflow', name)
  }

  /** Persist an explicit role, or clear it so detection decides again. */
  const setWorkflowRole = (name: string, role: ComfyUIWorkflowRole | 'auto'): void => {
    persistWorkflows(workflows.map(entry => {
      if (entry.name !== name) return entry
      const { role: _ignored, ...rest } = entry
      return role === 'auto' ? rest : { ...rest, role }
    }))
  }

  const remote = !isLocalComfyUIEndpoint(endpoint)
  const statusText = status === null ? 'Checking…'
    : status.up ? `Running · ${status.version ?? 'unknown version'}${status.device === undefined ? '' : ` · ${status.device}`}`
    : status.busy ? 'Starting or stopping…'
    : 'Not running'

  return (
    <li className="dsh-ig-card">
      <div className="dsh-ig-head">
        <span className="dsh-ig-head-text">
          <span className="dsh-ig-title">ComfyUI image generation</span>
          <span className="dsh-ig-desc">Local ComfyUI workflows power chat generation, the workbench, and the infinite canvas.</span>
        </span>
      </div>
      <div className="dsh-ig-body">
        {snapshot.status !== 'ready' ? <p className="dsh-ig-status dsh-ig-status-readonly" role="note">{snapshot.status === 'unavailable' ? 'Settings are unavailable on this host.' : 'Settings are read-only on this host.'}</p> : null}

        <div className="dsh-ig-section">
          <span className="dsh-ig-section-title">Connection</span>
          <label className="dsh-ig-field">
            <span className="dsh-ig-label">Endpoint</span>
            <input className="dsh-ig-input" value={endpoint} onChange={event => setEndpoint(event.target.value)} onBlur={commitServerFields} onKeyDown={event => { if (event.key === 'Enter') commitServerFields() }} placeholder={DEFAULT_COMFYUI_BASE_URL} disabled={disabled} />
            <span className="dsh-ig-hint">ComfyUI server the DSH host can reach. Local: port 8188 on this computer. Remote: use the server's LAN or public URL, for example http://192.168.1.20:8188 or https://comfy.example.com/.</span>
          </label>
          <label className="dsh-ig-field">
            <span className="dsh-ig-label">Request headers (optional)</span>
            <input className="dsh-ig-input" value={headersJson} onChange={event => setHeadersJson(event.target.value)} onBlur={commitServerFields} onKeyDown={event => { if (event.key === 'Enter') commitServerFields() }} placeholder={'{"Authorization": "Bearer <token>"}'} disabled={disabled} />
            <span className="dsh-ig-hint">JSON object sent with every ComfyUI request. Use it for a reverse proxy's token or Basic auth; leave blank for an open server.</span>
          </label>
          <label className="dsh-ig-field">
            <span className="dsh-ig-label">Generation timeout (seconds)</span>
            <input className="dsh-ig-input" type="number" min="1" max="3600" value={timeoutSeconds} onChange={event => setTimeoutSeconds(Number(event.target.value))} onBlur={commitServerFields} onKeyDown={event => { if (event.key === 'Enter') commitServerFields() }} disabled={disabled} />
            <span className="dsh-ig-hint">Covers submission, queuing, and image download; defaults to 300 seconds.</span>
          </label>
        </div>

        <div className="dsh-ig-section">
          <span className="dsh-ig-section-title">Server</span>
          <div className="dsh-ig-server-row">
            <span className={`dsh-ig-server-status ${status?.up === true ? 'is-up' : 'is-down'}`} role="status">
              <span className="dsh-ig-server-dot" aria-hidden="true" />
              {statusText}
            </span>
            <div className="dsh-ig-server-actions">
              {remote ? null : (
                <>
                  <button type="button" className="dsh-ig-btn-secondary" onClick={() => { void serverAction('start') }} disabled={!writable || serverBusy || status?.up === true}>Start</button>
                  <button type="button" className="dsh-ig-btn-secondary" onClick={() => { void serverAction('stop') }} disabled={!writable || serverBusy || status?.up !== true}>Stop</button>
                  <button type="button" className="dsh-ig-btn-secondary" onClick={() => { void serverAction('restart') }} disabled={!writable || serverBusy}>Restart</button>
                </>
              )}
              <button type="button" className="dsh-ig-btn-secondary" onClick={() => { void refreshStatus() }} disabled={serverBusy}>Refresh</button>
            </div>
          </div>
          {remote ? (
            <span className="dsh-ig-hint">Remote server: generation, editing, and status use this endpoint. Start / stop run on the server's own machine, so this card only probes it. On that machine, start ComfyUI with --listen 0.0.0.0, open the port in its firewall, and put HTTPS or a proxy token in Request headers when the proxy needs one.</span>
          ) : (
            <>
              <span className="dsh-ig-hint">Start launches main.py with the configured Python; Stop matches only ComfyUI's own process, never other listeners on the port.</span>
              <label className="dsh-ig-field">
                <span className="dsh-ig-label">Python executable</span>
                <input className="dsh-ig-input" value={pythonExe} onChange={event => setPythonExe(event.target.value)} onBlur={commitServerFields} onKeyDown={event => { if (event.key === 'Enter') commitServerFields() }} placeholder={'C:\\path\\to\\python.exe'} disabled={disabled} />
              </label>
              <label className="dsh-ig-field">
                <span className="dsh-ig-label">ComfyUI directory</span>
                <input className="dsh-ig-input" value={serverDir} onChange={event => setServerDir(event.target.value)} onBlur={commitServerFields} onKeyDown={event => { if (event.key === 'Enter') commitServerFields() }} placeholder={'C:\\path\\to\\ComfyUI'} disabled={disabled} />
                <span className="dsh-ig-hint">Directory that contains main.py; the server is launched from here.</span>
              </label>
              <label className="dsh-ig-field">
                <span className="dsh-ig-label">Extra main.py arguments</span>
                <input className="dsh-ig-input" value={extraArgs} onChange={event => setExtraArgs(event.target.value)} onBlur={commitServerFields} onKeyDown={event => { if (event.key === 'Enter') commitServerFields() }} placeholder={DEFAULT_COMFYUI_EXTRA_ARGS} disabled={disabled} />
              </label>
              <label className="dsh-ig-check-row">
                <input type="checkbox" checked={autoStart} onChange={event => { setAutoStart(event.target.checked); void save('comfyuiAutoStart', event.target.checked) }} disabled={disabled} />
                <span className="dsh-ig-label">Start ComfyUI automatically when the plugin loads</span>
              </label>
            </>
          )}
        </div>

        <div className="dsh-ig-section">
          <span className="dsh-ig-section-title">Workflows</span>
          <div className="dsh-ig-workflow-actions">
            <button type="button" className="dsh-ig-btn-secondary" onClick={() => { fileRef.current?.click() }} disabled={disabled || importing}>{importing ? 'Importing…' : 'Import workflow JSON'}</button>
            <input ref={fileRef} type="file" accept="application/json,.json" onChange={event => { void importWorkflow(event) }} hidden />
            <button type="button" className="dsh-ig-btn-secondary" onClick={() => { void checkWorkflows() }} disabled={checking || workflows.length === 0}>{checking ? 'Checking…' : 'Check against ComfyUI'}</button>
          </div>
          <span className="dsh-ig-hint">Export an API-format JSON from ComfyUI and put {"{{prompt}}"} in its prompt input; {"{{seed}}"} is available for a random seed. For image editing put {"{{image}}"} (exactly once) in the LoadImage image input. Add {"{{width}}"}, {"{{height}}"}, {"{{steps}}"} or {"{{cfg}}"} to numeric inputs to let calls adjust them.</span>

          {importSummary !== null && (
            <div className="dsh-ig-import-summary">
              <strong>{importSummary.name}</strong>
              <span>detected: {importSummary.role === 'image-to-image' ? 'image to image' : 'text to image'}</span>
              {importSummary.chips.map(chip => <span key={chip} className="dsh-ig-workflow-chip">{chip}</span>)}
              {importSummary.warning !== undefined && <span className="dsh-ig-status-error">{importSummary.warning}</span>}
            </div>
          )}

          {([
            { role: 'text-to-image' as const, title: 'Text to image', empty: 'No text-to-image workflow yet. Import one whose prompt input uses {{prompt}}.' },
            { role: 'image-to-image' as const, title: 'Image to image', empty: 'No image-to-image workflow yet. Add {{image}} to a LoadImage input; editing needs it.' },
          ]).map(section => {
            const entries = workflows.filter(entry => resolveWorkflowRole(entry) === section.role)
            const activeName = section.role === 'text-to-image' ? activeWorkflow : editActiveWorkflow
            return (
              <div className="dsh-ig-workflow-group" key={section.role}>
                <div className="dsh-ig-workflow-group-head">
                  <span className="dsh-ig-workflow-group-title">{section.title}</span>
                  <span className="dsh-ig-count-badge">{entries.length}</span>
                </div>
                {entries.length === 0 ? <span className="dsh-ig-workflow-group-empty">{section.empty}</span> : (
                  <div className="dsh-ig-workflow-list">
                    {entries.map(entry => {
                      const capabilities = describeWorkflowJson(entry.json)
                      return (
                        <div key={entry.name} className={`dsh-ig-workflow-row${entry.name === activeName ? ' is-active' : ''}`}>
                          <label className="dsh-ig-workflow-head">
                            <input type="radio" name={`dsh-ig-active-${section.role}`} checked={entry.name === activeName} onChange={() => selectActive(entry.name, section.role)} disabled={disabled} />
                            <span className="dsh-ig-workflow-name" title={entry.name}>{entry.name}</span>
                          </label>
                          <div className="dsh-ig-workflow-meta">
                            {capabilities.placeholders.width && capabilities.placeholders.height
                              ? <span className="dsh-ig-workflow-chip">adjustable size</span>
                              : capabilities.bakedSize === undefined
                                ? null
                                : <span className="dsh-ig-workflow-chip">baked {capabilities.bakedSize.width}x{capabilities.bakedSize.height}</span>}
                            {capabilities.placeholders.steps && <span className="dsh-ig-workflow-chip">steps</span>}
                            {capabilities.placeholders.cfg && <span className="dsh-ig-workflow-chip">cfg</span>}
                            <select className="dsh-ig-workflow-role" value={entry.role ?? 'auto'} onChange={event => setWorkflowRole(entry.name, event.target.value as ComfyUIWorkflowRole | 'auto')} disabled={disabled} aria-label={`Role for ${entry.name}`}>
                              <option value="auto">Auto role</option>
                              <option value="text-to-image">Text to image</option>
                              <option value="image-to-image">Image to image</option>
                            </select>
                          </div>
                          <input className="dsh-ig-input" value={presets[entry.name] ?? ''} placeholder="Preset prompt (optional)" onChange={event => setPresets(current => ({ ...current, [entry.name]: event.target.value }))} onBlur={() => commitPreset(entry.name)} onKeyDown={event => { if (event.key === 'Enter') commitPreset(entry.name) }} disabled={disabled} />
                          <button type="button" className="dsh-ig-btn-secondary dsh-ig-btn-danger" onClick={() => removeWorkflow(entry.name)} disabled={disabled}>Remove</button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="dsh-ig-section">
          <span className="dsh-ig-section-title">Workspace</span>
          <label className="dsh-ig-check-row">
            <input type="checkbox" checked={saveToWorkspace} onChange={event => { setSaveToWorkspace(event.target.checked); void save('saveToWorkspace', event.target.checked) }} disabled={disabled} />
            <span className="dsh-ig-label">Also save generated images into the session workspace</span>
          </label>
          {saveToWorkspace ? <label className="dsh-ig-field">
            <span className="dsh-ig-label">Workspace folder</span>
            <input className="dsh-ig-input" value={workspaceFolder} onChange={event => setWorkspaceFolder(event.target.value)} onBlur={() => { const next = workspaceFolder.trim(); if (next !== (value?.workspaceFolder ?? 'dsh-arya-image-gen')) void save('workspaceFolder', next) }} onKeyDown={event => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur() }} placeholder="dsh-arya-image-gen" disabled={disabled} />
          </label> : null}
        </div>

        <div className="dsh-ig-section">
          <span className="dsh-ig-section-title">HTML and SVG rendering</span>
          <label className="dsh-ig-field">
            <span className="dsh-ig-label">Chromium path (leave empty to auto-detect Chrome, Edge or Chromium)</span>
            <input
              className="dsh-ig-input"
              value={browserPath}
              onChange={event => setBrowserPath(event.target.value)}
              onBlur={() => { const next = browserPath.trim(); if (next !== (value?.renderBrowserPath ?? '')) void save('renderBrowserPath', next) }}
              onKeyDown={event => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur() }}
              placeholder="Auto-detect"
              disabled={disabled}
            />
          </label>
          <p className="dsh-ig-status" role="status">
            {renderHealth === null
              ? 'Renderer status unknown.'
              : renderHealth.available
                ? `Ready: ${(renderHealth.family ?? 'chromium')}${renderHealth.version === undefined ? '' : ` ${renderHealth.version}`}.`
                : 'No Chromium-family browser found. Install Chrome, Edge or Chromium, then reopen this card.'}
          </p>
          <label className="dsh-ig-field">
            <span className="dsh-ig-label">Default canvas width</span>
            <input className="dsh-ig-input" value={renderWidth} inputMode="numeric" onChange={event => setRenderWidth(event.target.value)} onBlur={() => { const next = Number(renderWidth); if (Number.isFinite(next) && next !== value?.renderDefaultWidth) void save('renderDefaultWidth', Math.round(next)) }} disabled={disabled} />
          </label>
          <label className="dsh-ig-field">
            <span className="dsh-ig-label">Default canvas height</span>
            <input className="dsh-ig-input" value={renderHeight} inputMode="numeric" onChange={event => setRenderHeight(event.target.value)} onBlur={() => { const next = Number(renderHeight); if (Number.isFinite(next) && next !== value?.renderDefaultHeight) void save('renderDefaultHeight', Math.round(next)) }} disabled={disabled} />
          </label>
          <label className="dsh-ig-field">
            <span className="dsh-ig-label">Background behind the page</span>
            <input className="dsh-ig-input" value={renderBackground} onChange={event => setRenderBackground(event.target.value)} onBlur={() => { const next = renderBackground.trim(); if (next !== (value?.renderBackground ?? '#ffffff')) void save('renderBackground', next) }} placeholder="#ffffff" disabled={disabled} />
          </label>
          <label className="dsh-ig-check-row">
            <input type="checkbox" checked={renderSaveSource} onChange={event => { setRenderSaveSource(event.target.checked); void save('renderSaveSource', event.target.checked) }} disabled={disabled} />
            <span className="dsh-ig-label">Save the .html or .svg source next to each rendered PNG</span>
          </label>
        </div>

        {message.length > 0 ? <p className={`dsh-ig-status${messageIsError ? ' dsh-ig-status-error' : ''}`} role="status">{message}</p> : null}
      </div>
    </li>
  )
}

/** Subscribe to one settings scope; re-renders whenever the host snapshot changes. */
function useSettingsSnapshot(scope: SettingsScope<ImageSettings>) {
  const [snapshot, setSnapshot] = useState(() => scope.getSnapshot())
  useEffect(() => scope.subscribe(() => { setSnapshot(scope.getSnapshot()) }), [scope])
  return snapshot
}

/** Poll the host job snapshot for one running tool call. */
function useJobSnapshot(callId: string): ComfyUIJobSnapshot | undefined {
  const [snapshot, setSnapshot] = useState<ComfyUIJobSnapshot | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    const jobId = progressJobIdForCall(callId)
    const tick = async (): Promise<void> => {
      try {
        const response = await fetch(`${COMFYUI_PROGRESS_ROUTE}/${jobId}?format=json`, { credentials: 'same-origin' })
        if (!response.ok) return
        const payload = await response.json() as { job?: ComfyUIJobSnapshot }
        if (!cancelled && payload.job !== undefined) setSnapshot(payload.job)
      } catch { /* progress is advisory; the tool result still arrives */ }
    }
    void tick()
    const timer = window.setInterval(() => { void tick() }, 700)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [callId])
  return snapshot
}

/** Inline progress surfaced in the tool card while ComfyUI is still working. */
function LiveGenerationCard(props: ImageCardProps) {
  const args = ((): { prompt?: string; workflow?: string } => {
    try { return JSON.parse((props.block as { argsRaw?: string }).argsRaw ?? '{}') as { prompt?: string; workflow?: string } } catch { return {} }
  })()
  const snapshot = useJobSnapshot(props.callId)
  const percent = snapshot !== undefined && snapshot.max > 0
    ? Math.min(100, Math.round((snapshot.value / snapshot.max) * 100))
    : snapshot?.phase === 'running' ? 100 : 0
  const elapsed = ((snapshot?.elapsedMs ?? 0) / 1000).toFixed(1)
  const phaseLabel = snapshot?.phase === 'running' ? 'Generating' : 'Queued'
  const detail = snapshot?.nodeLabel ?? (typeof args.prompt === 'string' && args.prompt.length > 0 ? args.prompt : 'Preparing workflow…')
  return (
    <div className="dsh-ig-progress" role="status" aria-live="polite">
      <div className="dsh-ig-progress-head">
        <span>{phaseLabel}</span>
        <span>{elapsed}s</span>
      </div>
      <div className="dsh-ig-progress-track">
        <div className="dsh-ig-progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <span className="dsh-ig-progress-node">{detail}</span>
      <span className="dsh-ig-hint">{typeof args.workflow === 'string' && args.workflow.length > 0 ? args.workflow : 'Workflow chosen in settings'}</span>
      {snapshot !== undefined && snapshot.previewVersion > 0 ? (
        <img className="dsh-ig-progress-preview" alt="Live ComfyUI preview" src={`${COMFYUI_PROGRESS_ROUTE}/${snapshot.jobId}/preview?v=${snapshot.previewVersion}`} />
      ) : null}
    </div>
  )
}

/** Keep the legacy Tool row for old DSH and hand modern results to the independent Chat node. */
export function GeneratedImageCard(props: ImageCardProps) {
  // While the call is still running, the card itself becomes the live progress view.
  if (props.phase !== 'result') return <LiveGenerationCard {...props} />
  const result = imageResultFromBlock(props.block)
  if (props.promoted && result !== undefined) return <PromotedResultNotice locale={props.locale} />
  return <ImageResultCard result={result} locale={props.locale} sessionId={(props as any).sessionId} />
}

/** Suppress the folded duplicate on modern hosts; render every image on legacy hosts. */
export function GeneratedImagesCard(props: ImageCardProps) {
  const block = props.block as unknown as {
    kind?: string
    meta?: unknown
    resultView?: { card?: string; meta?: unknown; content?: Array<{ type: string; text?: string; attachment?: ImageResultPresentation['attachment'] }> }
    content?: Array<{ type: string; text?: string; attachment?: ImageResultPresentation['attachment'] }>
  }
  let results = imageResultsFromMeta(block.meta ?? block.resultView?.meta)
  if (results.length === 0 && 'kind' in block) {
    const content = block.resultView?.card === 'generic' ? block.resultView.content : block.content
    results = (content ?? []).flatMap(item => item.type === 'image' && item.attachment !== undefined
      ? [{ attachment: item.attachment, prompt: 'Generated Image', provider: '', model: '', output: '' }]
      : [])
  }
  if (props.promoted && results.length > 0) return <PromotedResultNotice locale={props.locale} />
  if (results.length === 0) {
    if (!('kind' in block)) return <ImageResultCard locale={props.locale} />
    const content = block.content ?? block.resultView?.content ?? []
    return <div>{content.filter(item => item.type === 'text').map((item, index) => <p key={index}>{item.text}</p>)}</div>
  }
  return <div className="dsh-ig-promoted-results">
    {results.map((result, index) => <ImageResultCard key={`${result.attachment.attachmentId}:${index}`} result={result} locale={props.locale} sessionId={(props as any).sessionId} />)}
  </div>
}

/** Render modern image artifacts as final conversation output instead of Tool process content. */
export function PromotedImageResultNode(props: ImageResultNodeProps) {
  return <div className="dsh-ig-promoted-results">
    {props.node.data.results.map((result, index) =>
      <ImageResultCard key={`${result.attachment.attachmentId}:${index}`} result={result} locale={props.locale} sessionId={(props as any).sessionId} />)}
  </div>
}

function PromotedResultNotice({ locale }: { locale?: LocaleService | undefined }) {
  const lang = usePluginLanguage(locale)
  return <div className="dsh-ig-loading">{DICT.en.resultShown}</div>
}

function ImageResultCard({
  result,
  locale,
  sessionId,
}: {
  result?: ImageResultPresentation | undefined
  locale?: LocaleService | undefined
  sessionId?: string | undefined
}) {
  const attachment = result?.attachment
  const originId = attachment?.attachmentId
  const [revisionChain, setRevisionChain] = useState<ConversationImageRevisionChain>(() =>
    loadConversationImageRevisionChain(String(originId ?? ''))
  )
  const selectedRevision = revisionChain.revisions[revisionChain.currentIndex - 1]
  const activeAttachment = selectedRevision?.attachment ?? attachment
  const activeResult = selectedRevision !== undefined ? {
    prompt: selectedRevision.prompt,
    provider: selectedRevision.provider,
    model: selectedRevision.model,
    output: selectedRevision.output,
    createdAt: selectedRevision.createdAt,
    ...(result?.sourceAttachmentIds !== undefined && result.sourceAttachmentIds.length > 0
      ? { sourceAttachmentIds: result.sourceAttachmentIds }
      : {}),
  } : result
  const savedTo = result?.savedTo
  const [url, setUrl] = useState<string>()
  const [blob, setBlob] = useState<Blob>()
  const [error, setError] = useState<string>()
  const [previewOpen, setPreviewOpen] = useState(false)
  const [toast, setToast] = useState<string>()
  const [regenerateOpen, setRegenerateOpen] = useState(false)
  const [regeneratePrompt, setRegeneratePrompt] = useState('')
  const [regenerateError, setRegenerateError] = useState<string>()
  const [isRegenerating, setIsRegenerating] = useState(false)
  const regenerateControllerRef = useRef<AbortController>()
  const regenerateTextareaRef = useRef<HTMLTextAreaElement>(null)
  const lang = usePluginLanguage(locale)

  const t = (keyName: DictKey, params?: Record<string, string>): string => {
    const dict = DICT.en
    let text: string = dict[keyName] || keyName
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(`{${k}}`, v)
      }
    }
    return text
  }

  // Historical cards still populate the gallery. Canvas delivery subscribes
  // to live session events instead, so mounting old cards cannot replay images.
  useEffect(() => {
    if (result === undefined) return

    void saveGalleryItem({
      id: result.attachment.attachmentId,
      attachment: result.attachment,
      prompt: result.prompt,
      provider: result.provider as ImageProvider,
      ...(result.channel === undefined ? {} : { channel: result.channel }),
      model: result.model,
      output: result.output,
      ...(result.savedTo ? { savedTo: result.savedTo } : {}),
      ...(result.seed !== undefined ? { seed: result.seed } : {}),
      ...(result.queueMs !== undefined ? { queueMs: result.queueMs, execMs: result.execMs, totalMs: result.totalMs } : {}),
      ...(result.queueAhead !== undefined ? { queueAhead: result.queueAhead } : {}),
      ...(result.comfyVersion !== undefined ? { comfyVersion: result.comfyVersion } : {}),
      ...(result.sourceAttachmentIds !== undefined && result.sourceAttachmentIds.length > 0
        ? { sourceAttachmentIds: [...result.sourceAttachmentIds] }
        : {}),
      ...(sessionId ? { sessionId } : {}),
    })
  }, [result?.attachment.attachmentId])

  useEffect(() => {
    if (!originId) return
    regenerateControllerRef.current?.abort()
    regenerateControllerRef.current = undefined
    setIsRegenerating(false)
    setRegenerateOpen(false)
    setRevisionChain(loadConversationImageRevisionChain(String(originId)))
  }, [originId])

  useEffect(() => () => { regenerateControllerRef.current?.abort() }, [])

  useEffect(() => {
    if (!regenerateOpen || isRegenerating) return
    const frame = requestAnimationFrame(() => {
      regenerateTextareaRef.current?.focus()
      regenerateTextareaRef.current?.select()
    })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRegenerateOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [regenerateOpen, isRegenerating])

  useEffect(() => {
    if (!previewOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [previewOpen])

  const currentUrlRef = useRef<string | undefined>()

  useEffect(() => {
    return () => {
      if (currentUrlRef.current !== undefined) {
        URL.revokeObjectURL(currentUrlRef.current)
        currentUrlRef.current = undefined
      }
    }
  }, [])

  useEffect(() => {
    if (activeAttachment === undefined) return
    let canceled = false
    void fetchAttachmentBlob(activeAttachment).then(resBlob => {
      if (canceled) return
      setBlob(resBlob)
      setError(undefined)
      const nextUrl = URL.createObjectURL(resBlob)
      if (currentUrlRef.current !== undefined) {
        URL.revokeObjectURL(currentUrlRef.current)
      }
      currentUrlRef.current = nextUrl
      setUrl(nextUrl)
    }).catch(cause => {
      if (canceled) return
      setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => {
      canceled = true
    }
  }, [activeAttachment?.attachmentId])

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!blob) return
    const ok = await copyImageBlob(blob)
    setToast(ok ? t('copiedImage') : t('copyFailed'))
    setTimeout(() => { setToast(undefined) }, 2000)
  }

  const download = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = activeAttachment?.name || `dsh-image-${Date.now()}.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const openNewTab = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!url) return
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const openRegenerate = (event: React.MouseEvent) => {
    event.stopPropagation()
    if (activeResult === undefined || isRegenerating) return
    setRegeneratePrompt(activeResult.prompt)
    setRegenerateError(undefined)
    setRegenerateOpen(true)
  }

  const cancelRegenerate = () => {
    regenerateControllerRef.current?.abort()
    regenerateControllerRef.current = undefined
    setIsRegenerating(false)
    setRegenerateOpen(false)
    setRegenerateError(undefined)
  }

  const regenerate = async () => {
    if (activeResult === undefined || !originId || isRegenerating || regeneratePrompt.trim().length === 0) return
    setIsRegenerating(true)
    setRegenerateError(undefined)
    // Non-blocking: close dialog immediately so user can continue chatting/scrolling!
    setRegenerateOpen(false)
    const controller = new AbortController()
    regenerateControllerRef.current = controller
    try {
      const request = conversationRegenerateRequest(activeResult, regeneratePrompt)
      const response = await fetch(STUDIO_ROUTE, {
        method: 'POST',
        credentials: 'same-origin',
        signal: controller.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      })
      const payload = await response.json().catch(() => null) as StudioGenerateResponse | { error?: string } | null
      if (!response.ok || payload === null || !('attachment' in payload)) {
        throw new Error(payload && 'error' in payload && payload.error ? payload.error : t('regenerateFailed'))
      }
      const revision: ConversationImageRevision = {
        attachment: payload.attachment,
        prompt: payload.prompt,
        provider: payload.provider,
        model: payload.model,
        output: payload.output,
        createdAt: payload.createdAt,
      }
      const savedOk = await saveGalleryItem({
        id: String(revision.attachment.attachmentId),
        attachment: revision.attachment,
        prompt: revision.prompt,
        provider: revision.provider,
        model: revision.model,
        createdAt: revision.createdAt,
        output: revision.output,
        ...(savedTo ? { savedTo } : {}),
        ...(sessionId ? { sessionId } : {}),
      })
      const next = appendConversationImageRevision(String(originId), revision)
      setRevisionChain(next)
      setToast(savedOk ? t('regenerate') : t('regenerateSaveFailed'))
      setTimeout(() => { setToast(undefined) }, 2000)
    } catch (cause) {
      if (!controller.signal.aborted) {
        const errMsg = cause instanceof Error ? cause.message : String(cause)
        setError(errMsg)
        setToast(errMsg)
        setTimeout(() => { setToast(undefined) }, 3500)
      }
    } finally {
      if (regenerateControllerRef.current === controller) {
        regenerateControllerRef.current = undefined
        setIsRegenerating(false)
      }
    }
  }

  const selectVersion = (index: number) => {
    if (!originId || isRegenerating) return
    setRevisionChain(selectConversationImageRevision(String(originId), index))
  }

  const canRegenerate = activeResult !== undefined
    && activeResult.provider === 'comfyui'
    && activeResult.model.trim().length > 0
  const versionTotal = revisionChain.revisions.length + 1
  const versionCurrent = revisionChain.currentIndex + 1

  if (attachment === undefined) return <div className="dsh-ig-loading">{t('generating')}</div>
  return <section className="dsh-ig-result" aria-label={t('generatedTitle')}>
    <div className="dsh-ig-result-title">{t('generatedTitle')}</div>
    {savedTo !== undefined ? <div className="dsh-ig-savedto">{t('savedToPath')}: {savedTo}</div> : null}
    {error !== undefined ? <div className="dsh-ig-error">{error}</div> : null}
    {url === undefined && error === undefined ? <div className="dsh-ig-loading">{t('loading')}</div> : null}
    {url !== undefined ? <div className="dsh-ig-container">
      <img
        className="dsh-ig-image"
        src={url}
        alt={activeAttachment?.name ?? 'Generated image'}
        onClick={() => { if (!isRegenerating) setPreviewOpen(true) }}
      />
      {isRegenerating ? (
        <div className="dsh-ig-regenerate-overlay">
          <div className="dsh-ig-regenerate-spinner" />
          <span className="dsh-ig-regenerate-overlay-text">{t('regenerating')}</span>
          <button type="button" className="dsh-ig-regenerate-overlay-cancel" onClick={cancelRegenerate}>
            {t('cancel')}
          </button>
        </div>
      ) : null}
      <div className="dsh-ig-toolbar">
        {canRegenerate ? <button type="button" className="dsh-ig-tool-btn" disabled={isRegenerating} title={isRegenerating ? t('regenerating') : t('regenerate')} onClick={openRegenerate}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5"/></svg>
        </button> : null}
        <button type="button" className="dsh-ig-tool-btn" title={t('copyImg')} onClick={(e) => { void copy(e) }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
        <button type="button" className="dsh-ig-tool-btn" title={t('download')} onClick={download}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
        <button type="button" className="dsh-ig-tool-btn" title={t('openNewTab')} onClick={openNewTab}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </button>
        {toast ? <div className="dsh-ig-toast">{toast}</div> : null}
      </div>
      {versionTotal > 1 ? <div className="dsh-ig-version-nav" aria-label={t('versionLabel', { current: String(versionCurrent), total: String(versionTotal) })}>
        <button type="button" title={t('versionPrevious')} disabled={revisionChain.currentIndex === 0 || isRegenerating} onClick={(event) => { event.stopPropagation(); selectVersion(revisionChain.currentIndex - 1) }}>‹</button>
        <span className="dsh-ig-version-count">{versionCurrent}/{versionTotal}</span>
        <button type="button" title={t('versionNext')} disabled={revisionChain.currentIndex >= revisionChain.revisions.length || isRegenerating} onClick={(event) => { event.stopPropagation(); selectVersion(revisionChain.currentIndex + 1) }}>›</button>
      </div> : null}
    </div> : null}

    {previewOpen && url !== undefined ? <div className="dsh-ig-lightbox-backdrop" onClick={() => { setPreviewOpen(false) }}>
      <div className="dsh-ig-lightbox-img-wrap" onClick={(e) => { e.stopPropagation() }}>
        <img
          className="dsh-ig-lightbox-img"
          src={url}
          alt={activeAttachment?.name ?? 'Generated image preview'}
        />
      </div>
    </div> : null}
    {regenerateOpen && activeResult !== undefined ? <div className="dsh-ig-regenerate-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !isRegenerating) setRegenerateOpen(false)
    }}>
      <div className="dsh-ig-regenerate-dialog" role="dialog" aria-modal="true" aria-labelledby={`dsh-ig-regenerate-${String(originId)}`}>
        <h3 id={`dsh-ig-regenerate-${String(originId)}`}>{t('regenerateTitle')}</h3>
        <p>{t('regenerateHint')}</p>
        <label>
          <span>{t('prompt')}</span>
          <textarea
            ref={regenerateTextareaRef}
            value={regeneratePrompt}
            disabled={isRegenerating}
            onChange={(event) => setRegeneratePrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                void regenerate()
              }
            }}
          />
        </label>
        {regenerateError ? <p className="dsh-ig-regenerate-error" role="alert">{regenerateError}</p> : null}
        <div className="dsh-ig-regenerate-actions">
          <button type="button" className="dsh-ig-regenerate-cancel" onClick={cancelRegenerate}>{t('cancel')}</button>
          <button type="button" className="dsh-ig-regenerate-confirm" disabled={isRegenerating || regeneratePrompt.trim().length === 0} onClick={() => { void regenerate() }}>
            {t('confirmRegenerate')}
          </button>
        </div>
      </div>
    </div> : null}
  </section>
}

function usePluginLanguage(locale: LocaleService | undefined): 'en' | 'zh' {
  const [lang, setLang] = useState<'en' | 'zh'>(() => locale?.getSnapshot?.()?.active?.startsWith('en') ? 'en' : 'zh')
  useEffect(() => locale?.subscribe?.(() => {
    setLang(locale?.getSnapshot?.()?.active?.startsWith('en') ? 'en' : 'zh')
  }), [locale])
  return lang
}

function imageResultFromBlock(block: ToolCallBlock): ImageResultPresentation | undefined {
  const attachment = imageRef(block)
  if (attachment === undefined) return undefined
  const blockValue = block as unknown as {
    meta?: Record<string, unknown>
    resultView?: { meta?: Record<string, unknown> }
    call?: { args?: { prompt?: string; source_attachment_id?: string; source_attachment_ids?: string[] } }
  }
  const meta = blockValue.meta ?? blockValue.resultView?.meta
  const sourceIds = Array.isArray(blockValue.call?.args?.source_attachment_ids)
    ? blockValue.call?.args?.source_attachment_ids
    : typeof blockValue.call?.args?.source_attachment_id === 'string'
      ? [blockValue.call?.args?.source_attachment_id]
      : undefined
  return {
    attachment,
    prompt: typeof meta?.prompt === 'string' ? meta.prompt : blockValue.call?.args?.prompt ?? 'Generated Image',
    provider: typeof meta?.provider === 'string' ? meta.provider : 'google',
    model: typeof meta?.model === 'string' ? meta.model : '',
    output: typeof meta?.output === 'string' ? meta.output : '',
    ...(typeof meta?.savedTo === 'string' ? { savedTo: meta.savedTo } : {}),
    ...(typeof meta?.seed === 'number' ? { seed: meta.seed } : {}),
    ...(typeof meta?.queueMs === 'number' && typeof meta?.execMs === 'number' && typeof meta?.totalMs === 'number'
      ? { queueMs: meta.queueMs, execMs: meta.execMs, totalMs: meta.totalMs }
      : {}),
    ...(typeof meta?.queueAhead === 'number' ? { queueAhead: meta.queueAhead } : {}),
    ...(typeof meta?.comfyVersion === 'string' ? { comfyVersion: meta.comfyVersion } : {}),
    ...(sourceIds !== undefined && sourceIds.length > 0 ? { sourceAttachmentIds: sourceIds } : {}),
  }
}

