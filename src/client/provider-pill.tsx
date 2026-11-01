/**
 * Composer tool-row pill: switch the active ComfyUI workflow without leaving
 * the chat. Registered into the official 'conversation.input.right' slot; the
 * write path is the same `comfyuiActiveWorkflow` settings field the settings
 * card uses, so the two views can never disagree.
 */
import { Fragment, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_COMFYUI_WORKFLOW_LABEL,
  activeComfyUIWorkflow,
  resolveComfyUIWorkflows,
  type ComfyUIWorkflowEntry,
} from '../shared.js'
import type { SettingsScope } from './index.js'
import type { LocaleService } from './gallery-view.js'
import { writeSetting } from './settings-write.js'

/** Settings fields the pill reads; a structural subset of the full settings shape. */
export interface PillSettings {
  comfyuiWorkflows?: readonly ComfyUIWorkflowEntry[]
  comfyuiActiveWorkflow?: string
  comfyuiWorkflowJson?: string
  comfyuiWorkflowName?: string
  /** Opt-in toggle persisted by the settings card; the pill stays hidden until enabled. */
  showProviderPill?: boolean
}

/** Business face injected at registration time by the client entry. */
export interface ProviderPillFace {
  scope: SettingsScope<PillSettings>
  locale?: LocaleService | undefined
}

const PILL_TEXT = {
  pillLabel: 'Image',
  menuTitle: 'Workflow',
  noWorkflow: 'No workflow imported',
  readOnly: 'Image settings are read-only; switch them in the config source',
  switchFailed: 'Switch failed',
  writeRejected: 'Setting was not saved. Please try again',
  oneOption: 'Only one workflow is imported',
} as const

/** Subscribe to the settings snapshot the pill renders from. */
function usePillSettings(scope: SettingsScope<PillSettings>): { value: PillSettings; writable: boolean } {
  const [snapshot, setSnapshot] = useState(() => scope.getSnapshot())
  useEffect(() => scope.subscribe(() => { setSnapshot(scope.getSnapshot()) }), [scope])
  return { value: snapshot.value ?? {}, writable: snapshot.writable !== false }
}

export function ImageProviderPill(props: ProviderPillFace): JSX.Element | null {
  const { scope } = props
  const { value, writable } = usePillSettings(scope)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const workflows = resolveComfyUIWorkflows(value)
  const active = activeComfyUIWorkflow(value)
  const activeName = active?.name ?? DEFAULT_COMFYUI_WORKFLOW_LABEL

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (value.showProviderPill !== true) return null

  const choose = (name: string): void => {
    setOpen(false)
    if (name === activeName) return
    setError('')
    void writeSetting(scope, 'comfyuiActiveWorkflow', name, PILL_TEXT.writeRejected).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
    })
  }

  const dotClass = workflows.length === 0 ? 'dsh-ig-pill-dot-missing' : 'dsh-ig-pill-dot-ok'

  return (
    <div className="dsh-ig-pill-root" ref={rootRef}>
      <button
        type="button"
        className="dsh-ig-pill"
        aria-haspopup="menu"
        aria-expanded={open}
        title={workflows.length === 0 ? PILL_TEXT.noWorkflow : `${PILL_TEXT.menuTitle}: ${activeName}`}
        onClick={() => { setOpen(current => !current) }}
      >
        <span className={`dsh-ig-pill-dot ${dotClass}`} aria-hidden="true" />
        <span className="dsh-ig-pill-label">{PILL_TEXT.pillLabel}</span>
        <span className="dsh-ig-pill-value">{workflows.length === 0 ? PILL_TEXT.noWorkflow : activeName}</span>
        <span className={`dsh-ig-pill-chevron ${open ? 'dsh-ig-pill-chevron-open' : ''}`} aria-hidden="true">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6l4 4 4-4" /></svg>
        </span>
      </button>
      {open ? (
        <div className="dsh-ig-pill-menu" role="menu" aria-label={PILL_TEXT.menuTitle}>
          <div className="dsh-ig-pill-menu-title">{PILL_TEXT.menuTitle}</div>
          {workflows.length === 0 ? <div className="dsh-ig-pill-empty">{PILL_TEXT.noWorkflow}</div> : (
            <Fragment>
              {workflows.map(workflow => (
                <button
                  key={workflow.name}
                  type="button"
                  role="menuitemradio"
                  aria-checked={workflow.name === activeName}
                  className="dsh-ig-pill-option"
                  onClick={() => { choose(workflow.name) }}
                >
                  <span className={workflow.name === activeName ? 'dsh-ig-pill-check' : 'dsh-ig-pill-check-placeholder'} aria-hidden="true">
                    {workflow.name === activeName ? '✓' : ''}
                  </span>
                  <span className="dsh-ig-pill-option-text">
                    <span className="dsh-ig-pill-option-name">{workflow.name}</span>
                    {workflow.presetPrompt !== undefined && workflow.presetPrompt.trim().length > 0 ? <span className="dsh-ig-pill-option-sub">{workflow.presetPrompt.trim()}</span> : null}
                  </span>
                </button>
              ))}
            </Fragment>
          )}
          {error.length > 0 ? <div className="dsh-ig-pill-error" role="status">{error}</div> : null}
          {!writable ? <div className="dsh-ig-pill-error" role="status">{PILL_TEXT.readOnly}</div> : null}
          {workflows.length === 1 ? <div className="dsh-ig-pill-empty">{PILL_TEXT.oneOption}</div> : null}
        </div>
      ) : null}
    </div>
  )
}

export const PROVIDER_PILL_STYLE = `
.dsh-ig-pill-root{position:relative;display:inline-flex;align-items:center;flex:none}
.dsh-ig-pill{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,#e3e6eb);border-radius:999px;background:var(--dsw-alias-bg-layer-3,#f6f7f9);color:var(--dsw-alias-label-secondary,#4b5563);font:inherit;font-size:12px;cursor:pointer;transition:background .15s,border-color .15s}
.dsh-ig-pill:hover{border-color:var(--dsw-alias-label-dimmed,#9ca3af);background:var(--dsw-alias-bg-layer-2,#eef0f3)}
.dsh-ig-pill-dot{width:6px;height:6px;border-radius:50%;flex:none}
.dsh-ig-pill-dot-ok{background:#22c55e}
.dsh-ig-pill-dot-missing{background:#9ca3af}
.dsh-ig-pill-label{font-weight:600;color:var(--dsw-alias-label-primary,#111827)}
.dsh-ig-pill-value{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ig-pill-chevron{display:inline-flex;align-items:center;transition:transform .16s}
.dsh-ig-pill-chevron-open{transform:rotate(180deg)}
.dsh-ig-pill-menu{position:absolute;bottom:calc(100% + 6px);left:0;z-index:40;min-width:240px;max-width:320px;max-height:320px;overflow-y:auto;padding:6px;border:1px solid var(--dsw-alias-border-l2,#e3e6eb);border-radius:12px;background:var(--dsw-alias-bg-layer-3,#fff);box-shadow:0 10px 30px rgba(15,23,42,.16)}
.dsh-ig-pill-menu-title{padding:4px 8px 6px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#6b7280)}
.dsh-ig-pill-option{display:flex;align-items:center;gap:8px;width:100%;padding:7px 8px;border:0;border-radius:8px;background:none;font:inherit;text-align:left;cursor:pointer}
.dsh-ig-pill-option:hover{background:var(--dsw-alias-bg-layer-2,#eef0f3)}
.dsh-ig-pill-check{flex:none;width:14px;color:var(--dsw-alias-brand-primary,#4c78ff);font-size:11px}
.dsh-ig-pill-check-placeholder{flex:none;width:14px}
.dsh-ig-pill-option-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.dsh-ig-pill-option-name{font-size:12.5px;font-weight:500;color:var(--dsw-alias-label-primary,#111827);line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ig-pill-option-sub{font-size:11px;color:var(--dsw-alias-label-tertiary,#6b7280);line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ig-pill-empty{padding:6px 8px;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#6b7280);line-height:1.4}
.dsh-ig-pill-error{margin-top:4px;padding:6px 8px;border-radius:8px;background:rgba(239,68,68,.08);color:#ef4444;font-size:11.5px;line-height:1.4;word-break:break-all}
`
