/**
 * Render surface: author HTML or SVG, render it to PNG, and see the result
 * beside the code.
 *
 * It lives next to Studio/Gallery as a tab because it shares their output: a
 * rendered PNG is an ordinary attachment, so the result rail, download and
 * canvas all behave the same.
 *
 * @module dsh-arya-image-gen/client/render-view
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Braces, Code2, Image as ImageIcon, Play, RefreshCw } from 'lucide-react'
import { IMAGE_ROUTE, RENDER_ROUTE, type RenderConfigResponse, type StudioRenderResponse } from '../shared.js'

/** Default markup shown the first time the surface opens. */
const STARTER_HTML = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body{margin:0;display:flex;align-items:center;justify-content:center;height:100%;
      background:linear-gradient(96deg,#1B49D6,#2B6CFF 46%,#00C9BE);color:#fff;
      font-family:Sora,sans-serif;font-size:64px;font-weight:800;letter-spacing:-2px}
  </style>
</head>
<body>Hello from HTML</body>
</html>`

const STARTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2B6CFF"/>
      <stop offset="1" stop-color="#00E0D2"/>
    </linearGradient>
  </defs>
  <rect width="400" height="400" rx="48" fill="url(#g)"/>
  <circle cx="200" cy="170" r="70" fill="#fff" fill-opacity="0.92"/>
  <rect x="120" y="280" width="160" height="22" rx="11" fill="#fff" fill-opacity="0.92"/>
</svg>`

/** One render shown in the result rail. */
interface RenderResult {
  key: string
  url: string
  response: StudioRenderResponse
}

/** Props injected by the gallery shell. */
export interface RenderViewProps {
  workspace?: { path: string } | undefined
}

const CSS = `
.dsh-ig-render{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,420px);grid-template-rows:minmax(0,1fr);gap:12px;height:100%;min-height:0;padding:12px;box-sizing:border-box}
.dsh-ig-render-pane{border:1px solid var(--dsw-alias-border-l2,#e3e9f2);border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fff);display:flex;flex-direction:column;min-height:0;overflow:hidden}
.dsh-ig-render-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l2,#e3e9f2);font-size:12.5px;font-weight:600}
.dsh-ig-render-head .spacer{flex:1}
.dsh-ig-render-body{padding:12px;display:flex;flex-direction:column;gap:10px;min-height:0;overflow:auto}
.dsh-ig-render-chips{display:flex;flex-wrap:wrap;gap:6px}
.dsh-ig-render-chip{border:1px solid var(--dsw-alias-border-l2,#e3e9f2);background:transparent;border-radius:999px;padding:5px 11px;font-size:12px;cursor:pointer}
.dsh-ig-render-chip.is-active{background:var(--dsw-alias-brand-primary-new-color,#2f64f5);border-color:transparent;color:#fff}
.dsh-ig-render textarea{width:100%;min-height:220px;flex:1;resize:vertical;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:12.5px;line-height:1.55;border:1px solid var(--dsw-alias-border-l2,#e3e9f2);border-radius:8px;padding:10px;background:var(--dsw-alias-bg-layer-2,#fafbfe);color:inherit}
.dsh-ig-render-fields{display:flex;flex-wrap:wrap;gap:8px}
.dsh-ig-render-field{display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--dsw-alias-label-secondary,#5a6478)}
.dsh-ig-render-field input,.dsh-ig-render-field select{height:28px;width:96px;border:1px solid var(--dsw-alias-border-l2,#e3e9f2);border-radius:6px;padding:0 8px;background:transparent;color:inherit;font-size:12px}
.dsh-ig-render-slots{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.dsh-ig-render-slots label{display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--dsw-alias-label-secondary,#5a6478)}
.dsh-ig-render-slots input{height:28px;border:1px solid var(--dsw-alias-border-l2,#e3e9f2);border-radius:6px;padding:0 8px;background:transparent;color:inherit;font-size:12px}
.dsh-ig-render-actions{display:flex;align-items:center;gap:8px}
.dsh-ig-render-actions button{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#e3e9f2);background:transparent;cursor:pointer;font-size:12.5px;font-weight:600}
.dsh-ig-render-actions button.is-primary{background:var(--dsw-alias-brand-primary-new-color,#2f64f5);border-color:transparent;color:#fff}
.dsh-ig-render-actions button:disabled{opacity:.55;cursor:not-allowed}
.dsh-ig-render-error{font-size:12px;color:#b63737}
.dsh-ig-render-preview{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:12px;background:repeating-conic-gradient(#f2f4f8 0% 25%,#fff 0% 50%) 50%/16px 16px}
.dsh-ig-render-preview img{max-width:100%;max-height:100%;object-fit:contain;border-radius:6px;box-shadow:0 8px 24px rgba(20,32,60,.14)}
.dsh-ig-render-empty{font-size:12.5px;color:var(--dsw-alias-label-tertiary,#717b90);text-align:center;padding:24px}
.dsh-ig-render-meta{display:flex;flex-wrap:wrap;gap:10px;padding:8px 12px;border-top:1px solid var(--dsw-alias-border-l2,#e3e9f2);font-size:11.5px;color:var(--dsw-alias-label-secondary,#5a6478)}
.dsh-ig-render-rail{display:flex;gap:8px;padding:8px 12px;border-top:1px solid var(--dsw-alias-border-l2,#e3e9f2);overflow-x:auto}
.dsh-ig-render-rail img{height:54px;border-radius:6px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2,#e3e9f2)}
.dsh-ig-render-health{padding:8px 12px;font-size:11.5px;color:var(--dsw-alias-label-secondary,#5a6478);border-bottom:1px solid var(--dsw-alias-border-l2,#e3e9f2)}
`

export function RenderView({ workspace }: RenderViewProps): JSX.Element {
  const [config, setConfig] = useState<RenderConfigResponse | null>(null)
  const [kind, setKind] = useState<'html' | 'svg'>('html')
  const [template, setTemplate] = useState('')
  const [markup, setMarkup] = useState(STARTER_HTML)
  const [slots, setSlots] = useState<Record<string, string>>({})
  const [width, setWidth] = useState('1200')
  const [height, setHeight] = useState('630')
  const [scale, setScale] = useState('1')
  const [background, setBackground] = useState('#ffffff')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState<RenderResult[]>([])
  const [activeKey, setActiveKey] = useState('')
  const urlsRef = useRef<string[]>([])

  useEffect(() => () => { for (const url of urlsRef.current) URL.revokeObjectURL(url) }, [])

  useEffect(() => {
    let cancelled = false
    void fetch(RENDER_ROUTE, { method: 'GET' })
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
        return await response.json() as RenderConfigResponse
      })
      .then(payload => {
        if (cancelled) return
        setConfig(payload)
        setWidth(String(payload.defaults.width))
        setHeight(String(payload.defaults.height))
        setScale(String(payload.defaults.scale))
        setBackground(payload.defaults.background)
      })
      .catch(() => { if (!cancelled) setConfig(null) })
    return () => { cancelled = true }
  }, [])

  const activeTemplate = useMemo(
    () => config?.templates.find(entry => entry.id === template),
    [config, template],
  )

  const applyKind = useCallback((next: 'html' | 'svg') => {
    setKind(next)
    setTemplate('')
    setMarkup(next === 'html' ? STARTER_HTML : STARTER_SVG)
  }, [])

  const render = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const body = template === ''
        ? { kind, markup, width: Number(width), height: Number(height), scale: Number(scale), background }
        : { kind: 'html' as const, template, data: slots }
      const response = await fetch(RENDER_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, ...(workspace === undefined ? {} : { workspaceRoot: workspace.path }) }),
      })
      const payload = await response.json() as StudioRenderResponse | { error?: string }
      if (!response.ok || 'error' in payload) throw new Error('error' in payload && payload.error ? payload.error : 'Render failed')
      const result = payload as StudioRenderResponse
      const blobResponse = await fetch(IMAGE_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ attachment: result.attachment }),
      })
      if (!blobResponse.ok) throw new Error(`HTTP ${String(blobResponse.status)}`)
      const url = URL.createObjectURL(await blobResponse.blob())
      urlsRef.current.push(url)
      const key = `${result.attachment.attachmentId}:${String(Date.now())}`
      setResults(previous => [{ key, url, response: result }, ...previous].slice(0, 12))
      setActiveKey(key)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [background, busy, height, kind, markup, scale, slots, template, width, workspace])

  const active = results.find(entry => entry.key === activeKey) ?? results[0]

  return (
    <div className="dsh-ig-render">
      <style>{CSS}</style>

      <div className="dsh-ig-render-pane">
        <div className="dsh-ig-render-head">
          <Code2 size={14} />
          <span>Render source</span>
          <span className="spacer" />
          <div className="dsh-ig-render-chips">
            <button type="button" className={`dsh-ig-render-chip ${kind === 'html' && template === '' ? 'is-active' : ''}`} onClick={() => applyKind('html')}>HTML</button>
            <button type="button" className={`dsh-ig-render-chip ${kind === 'svg' && template === '' ? 'is-active' : ''}`} onClick={() => applyKind('svg')}>SVG</button>
          </div>
        </div>
        <div className="dsh-ig-render-body">
          {config !== null && config.templates.length > 0 && (
            <div className="dsh-ig-render-chips">
              <button type="button" className={`dsh-ig-render-chip ${template === '' ? 'is-active' : ''}`} onClick={() => setTemplate('')}>Custom</button>
              {config.templates.map(entry => (
                <button
                  key={entry.id}
                  type="button"
                  className={`dsh-ig-render-chip ${template === entry.id ? 'is-active' : ''}`}
                  title={entry.description}
                  onClick={() => {
                    setTemplate(entry.id)
                    setKind('html')
                    setWidth(String(entry.width))
                    setHeight(String(entry.height))
                    setSlots(Object.fromEntries(entry.slots.map(slot => [slot, slots[slot] ?? ''])))
                  }}
                >{entry.label}</button>
              ))}
            </div>
          )}

          {template === '' ? (
            <textarea value={markup} spellCheck={false} onChange={event => setMarkup(event.target.value)} aria-label="Markup" />
          ) : (
            <>
              <textarea value={markupPreview(activeTemplate, slots)} readOnly aria-label="Template preview" style={{ minHeight: 140, opacity: 0.75 }} />
              <div className="dsh-ig-render-slots">
                {(activeTemplate?.slots ?? []).map(slot => (
                  <label key={slot}>
                    {slot}
                    <input value={slots[slot] ?? ''} onChange={event => setSlots({ ...slots, [slot]: event.target.value })} />
                  </label>
                ))}
              </div>
            </>
          )}

          {template === '' && (
            <div className="dsh-ig-render-fields">
              <label className="dsh-ig-render-field">Width<input value={width} onChange={event => setWidth(event.target.value)} inputMode="numeric" /></label>
              <label className="dsh-ig-render-field">Height<input value={height} onChange={event => setHeight(event.target.value)} inputMode="numeric" /></label>
              <label className="dsh-ig-render-field">Scale<input value={scale} onChange={event => setScale(event.target.value)} inputMode="decimal" /></label>
              <label className="dsh-ig-render-field">Background<input value={background} onChange={event => setBackground(event.target.value)} /></label>
            </div>
          )}

          <div className="dsh-ig-render-actions">
            <button type="button" className="is-primary" disabled={busy} onClick={() => void render()}>
              {busy ? <RefreshCw size={14} className="is-spinning" /> : <Play size={14} />}
              {busy ? 'Rendering…' : 'Render PNG'}
            </button>
          </div>
          {error !== '' && <div className="dsh-ig-render-error">{error}</div>}
        </div>
      </div>

      <div className="dsh-ig-render-pane">
        <div className="dsh-ig-render-head">
          {config?.health.available === true ? <ImageIcon size={14} /> : <Braces size={14} />}
          <span>Preview</span>
        </div>
        {config?.health.available === false && (
          <div className="dsh-ig-render-health">
            No Chromium-family browser found. Install Chrome, Edge or Chromium, or set the browser path in Settings &gt; Plugins &gt; Arya Image Gen.
          </div>
        )}
        <div className="dsh-ig-render-preview">
          {active === undefined
            ? <div className="dsh-ig-render-empty">Render HTML or SVG to see the PNG here.</div>
            : <img src={active.url} alt="Rendered output" />}
        </div>
        {active !== undefined && (
          <div className="dsh-ig-render-meta">
            <span>{active.response.width} × {active.response.height}</span>
            <span>{Math.round(active.response.elapsedMs)} ms</span>
            <span>{active.response.model}</span>
            {active.response.savedTo !== undefined && <span title={active.response.savedTo}>saved</span>}
          </div>
        )}
        {results.length > 0 && (
          <div className="dsh-ig-render-rail">
            {results.map(entry => (
              <img key={entry.key} src={entry.url} alt="Recent render" onClick={() => setActiveKey(entry.key)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Show the template's markup with the current slot values, for orientation. */
function markupPreview(template: RenderConfigResponse['templates'][number] | undefined, slots: Record<string, string>): string {
  if (template === undefined) return ''
  return template.slots.map(slot => `${slot}: ${slots[slot] ?? ''}`).join('\n')
}
