# Agent notes - dsh-arya-image-gen

AryaCode fork of `shanliuling/dsh-image-gen`, reduced to a single provider: your
local ComfyUI server. A DeepSeek Harness plugin. `main`. Releases are versioned
per commit (`v0.19.0` and counting).

## Commands

    pnpm install
    pnpm run typecheck      # tsc --noEmit
    pnpm test               # vitest run (36 specs under tests/)
    pnpm run build          # sync workflows -> tsc -> tsdown
    pnpm run pack:check     # pnpm pack --dry-run
    pnpm run test:package   # node scripts/check-package.mjs

`.github/workflows/ci.yml` runs typecheck, test, build, pack:check and
test:package on ubuntu and windows, node 24, pnpm 11.7.0. The engine floor in
`package.json` is `^22.19.0 || >=24.0.0`; `prepare` runs the build, so a bare
`pnpm install` builds too.

## Rules

1. **`src/generated/default-workflows.ts` is generated.** It comes from
   `docs/workflows/*.json` via `scripts/sync-default-workflows.mjs`, which
   `pnpm run build` runs. Never edit it by hand, and never edit it without
   editing the JSON: `tests/default-workflows.spec.ts` fails when it is stale.
2. **`docs/workflows/*.json` is the prefill pack, not the published pack.** The
   sibling repo `arya-comfyui-workflows` distributes API-format JSONs that users
   import by hand; the file names differ and no script syncs the two. Do not
   assume a change in one reaches the other.
3. **`docs/image-room-spec.md` is deliberately gitignored** - a working draft,
   not part of the plugin. Do not commit it.
4. **Generated output stays out of git**: `dsh-arya-image-gen/` (the plugin's
   write target), `arya-comfyui-workflows.zip`, `lib/`, `*.tgz`, `launch-dev.cmd`
   and the dev logs are all ignored. Keep them ignored.
5. **Conventional commits with the version in the subject.** `fix:` / `feat:` /
   `chore:` ending in `(vX.Y.Z)`, with the bump in the same commit. Release
   notes live under `docs/releases/`.
6. `banner-build/` is untracked scratch (`_preview.png`, `banner.html`,
   `compose_banner.py`). Do not commit it unless it is deliberately adopted.
7. **No HTML/SVG renderer.** `render_html`, `render_svg`,
   `list_render_templates`, the render route, the Chromium driver and the Studio
   Render tab were removed on purpose (v0.19.0): a model with its own HTML and
   SVG ability reached for them and drifted, and a rasterized page proved
   nothing. Do not reintroduce them, and do not ship a browser dependency.

## Known rough edges

- `Connection` (zero bytes) and `dsh-image-gen/image-e538a244.png` are tracked
  and are not source. Remove them when convenient; do not add more like them.
- The fork relationship with `shanliuling/dsh-image-gen` is permanent. Upstream
  sync is manual and rare; treat this tree as its own project.
