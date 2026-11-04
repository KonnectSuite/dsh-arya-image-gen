# Hero banner

The README hero is a normal HTML page rasterized by a headless Chrome or Edge.
It used to go through this plugin's own `render_html` tool; that tool was
removed in v0.19.0, so the render step is a browser call now and nothing here
depends on the plugin building first.

- `hero.html` — the source. `{{AVATAR}}` is replaced with a data URL of the
  AryaCode companion art, and the brand fonts are declared in an injected
  `@font-face` block before rendering (the plugin used to inject them).
- `banner.png` — the 2400x1250 render.
- `../docs/assets/readme/hero-arya-wide.webp` — the copy the README loads.
- `../docs/assets/readme/hero-arya-wide.png` — the same PNG, for anything that
  wants the uncompressed version.
- `banner.html`, `compose_banner.py`, `_preview.png` — the older Pillow route.
  Superseded by `hero.html`; kept as scratch, not a deliverable.

## Rebuild

From the plugin root, with Chrome or Edge installed:

```powershell
$dir = "banner-build"
$hero = Get-Content -Raw "$dir\hero.html"
$avatar = [Convert]::ToBase64String([IO.File]::ReadAllBytes(
  "C:\Users\KNPhu\AryaCode\KonnectSuite\aryacode-brand-kit\companion\greeting\static\512.png"))
$fonts = @'
<style>
@font-face{font-family:Sora;src:url("file:///C:/Users/KNPhu/AryaCode/KonnectSuite/aryacode-brand-kit/sources/fonts/Sora-Variable.ttf") format("truetype");font-weight:100 900}
@font-face{font-family:"JetBrains Mono";src:url("file:///C:/Users/KNPhu/AryaCode/KonnectSuite/aryacode-brand-kit/sources/fonts/JetBrainsMono-Variable.ttf") format("truetype");font-weight:100 800}
</style>
'@
$out = $hero.Replace('{{AVATAR}}', "data:image/png;base64,$avatar").Replace('</head>', "$fonts</head>")
[IO.File]::WriteAllText("$dir\_render.html", $out, [Text.UTF8Encoding]::new($false))

& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu `
  --hide-scrollbars --user-data-dir="$env:TEMP\ds-banner-profile" `
  --force-device-scale-factor=1 --window-size=2400,1250 `
  --screenshot="$dir\banner.png" "file:///$((Resolve-Path "$dir\_render.html").Path -replace '\\','/')"
```

Then refresh the WebP with any Pillow install:

```powershell
python -c "from PIL import Image; Image.open('banner-build/banner.png').convert('RGB').save('docs/assets/readme/hero-arya-wide.webp','WEBP',quality=92,method=6)"
```

Copy `banner.png` over `docs/assets/readme/hero-arya-wide.png` in the same pass,
and delete `_render.html` afterwards: it holds the avatar data URL.

The page is 2400x1250 with `--window-size` matching, so the screenshot is the
whole canvas: no auto-height, no scrollbars. Sora and JetBrains Mono come from
the brand kit rather than the plugin, which no longer ships font files.
