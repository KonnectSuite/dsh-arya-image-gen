# HTML/SVG rendering design notes

## Why a browser

The alternative was a pure-JS pipeline (satori to SVG, resvg to PNG). It avoids
an external binary but only supports a CSS subset, needs native or WASM builds,
and would still render differently from what a user sees in a browser. The
installed Chromium gives full CSS and SVG fidelity with **zero native
dependencies**: the renderer spawns a process instead of shipping one.

Cost: a Chromium-family browser must exist. `render/resolveBrowser` covers the
usual install paths per platform, `DSH_RENDER_BROWSER`, and an explicit setting.

## One-shot rendering

`--headless=new --screenshot=<path> --window-size=W,H --force-device-scale-factor=S`
writes a PNG at an exact viewport. That is the whole protocol: no CDP session,
no port, no attach/detach, no cleanup beyond a temp directory. The trade-off is
that the canvas is fixed — measuring content height needs CDP and is deferred.

## Safety

Rendering untrusted HTML is the sharp edge. Four layers, cheapest first:

1. Markup sanitizer removes `script`/`iframe`/`object`/`embed`, inline `on*`
   handlers, `@import`, and remote `src`/`href`/`url()`.
2. Injected CSP: `default-src 'none'` with `data:`/`file:` for images, styles and
   fonts.
3. Browser launched with `--host-resolver-rules=MAP * ~NOTFOUND`, so even a
   resource the sanitizer missed cannot resolve.
4. A throwaway `--user-data-dir` under the render's temp directory.

`--blink-settings=scriptEnabled=false` is **not** used: Edge exits 0 and writes
no screenshot with it. CSP plus the sanitizer carry that job instead.

## Integration

Rendering reuses the image pipeline rather than duplicating it:

```
render_html / render_svg ──► renderToPng ──► saveGenerated ──► attachment + workspace file
Studio → Render ───────────► renderFromStudio ─┘
```

`saveGenerated` was extracted from `index.ts` so tools and renders share the
attachment store, workspace folder, provenance line and save-failure behaviour.
A rendered PNG is therefore indistinguishable downstream from a generated one.

## Providers

`IMAGE_PROVIDERS` is `comfyui | html | svg`. `STUDIO_PROVIDERS` stays
`comfyui` because the Studio workflow machines (ratios, presets, editing
support) are ComfyUI concepts; the render surface is its own tab.

## Deferred

- CDP session for auto-height, element capture and PDF.
- A theme-token endpoint so templates can pull brand values instead of inlining.
- A renderer pill in the composer.
