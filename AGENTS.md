# Agent notes - dsh-arya-image-gen

AryaCode fork of `shanliuling/dsh-image-gen`, reduced to a single provider: your
local ComfyUI server. A DeepSeek Harness plugin - it installs into any DSH web
profile, and AryaCode is one rebranded DSH build. `main`. Releases are versioned
per commit (`v0.20.0` and counting). The npm package is
`@aryacode/dsh-arya-image-gen` from 0.20.0; 0.19.2 and older are the unscoped
`dsh-arya-image-gen`. The plugin id, routes and settings namespace are
`dsh-image-gen` / `image-gen` and do **not** follow the package name.

## Commands

    pnpm install
    pnpm run typecheck      # tsc --noEmit
    pnpm test               # vitest run (36 specs under tests/)
    pnpm run build          # sync workflows -> tsc -> tsdown
    pnpm run pack:check     # pnpm pack --dry-run
    pnpm run test:package   # node scripts/check-package.mjs
    pnpm run sync:workflows # docs/workflows/*.json -> src/generated/
    node scripts/sync-market-index.mjs [--dry-run|--check]   # rewrite index.json

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
   write target), `arya-comfyui-workflows.zip`, `lib/`, `*.tgz`, `launch-dev.cmd`,
   `banner-build/` and the dev logs are all ignored. Keep them ignored.
5. **Conventional commits with the version in the subject.** `fix:` / `feat:` /
   `chore:` ending in `(vX.Y.Z)`, with the bump in the same commit. Release
   notes live under `docs/releases/`, and the matching `## X.Y.Z` section in
   `CHANGELOG.md` lands in the same commit: `release-plugin.mjs` reads that
   section for the release notes and `release.yml` cuts the GitHub Release from it.
6. **`index.json` at the repository root is the public index listing, and it is
   generated.** Users add it as an index source through jsDelivr, so a stale file
   is worse than none - the host shows `releases[0]` as the newest thing that
   exists. Regenerate it with `node scripts/sync-market-index.mjs` as part of a
   release (the market release step commits it: `git add index.json` is
   hard-coded to the root path). Never hand-edit its version list, and keep it
   out of `package.json` `files`: it is a repo artifact, not packed.
7. **No HTML/SVG renderer.** `render_html`, `render_svg`,
   `list_render_templates`, the render route, the Chromium driver and the Studio
   Render tab were removed on purpose (v0.19.0): a model with its own HTML and
   SVG ability reached for them and drifted, and a rasterized page proved
   nothing. Do not reintroduce them, and do not ship a browser dependency.
8. **The preset is one small row list plus a mask.** The Arya Image preset keeps
   the image tools and a core set, and its last row
   (`@aryacode/dsh-arya-image-gen/agent-toolset`) masks every other globally
   registered tool. A restriction can only name inherited globals, so a tool
   provided by the preset's own rows cannot be masked: to keep the session small,
   add a tool to `coreToolNames` in `src/agent-preset/definition.ts`, not to
   `presetToolRows`.
9. **Public surfaces say what the plugin is, not what it replaced.** No "fork
   of", no removed-provider history, no "coming soon" in `README.md`,
   `README.zh.md`, the settings page or the release notes. Provenance belongs in
   `NOTICE`, the licence footer and `docs/releases/`. A doc line that names a
   setting, a tool, a workflow or an install path must match the code, and if it
   describes something not yet published it says so plainly.
10. **Docs are English-only for now**, while the other two public AryaCode
    plugins ship `README.zh.md`. That is a known gap against the market's
    EN+ZH parity rule, recorded in `HANDOFF.md`; if you write the Chinese
    mirror, keep it in step with the English one in the same commit.

## Known rough edges

- `scripts/fixtures/package-settings.mjs` still asserts the removed
  multi-provider settings card (`Default model`, `Editing model`,
  `googleNative`, `openaiCompatEditFormat`), so `pnpm run test:package` fails
  until it is rewritten against the ComfyUI card. The other four CI checks pass.
- Docs are English-only (rule 10).
- No git tag exists below `v0.19.1`, so GitHub Releases start at the next
  version; older versions are documented through `docs/releases/` only.
- The GitHub repository settings are not files: About still points at the
  upstream project and Issues are disabled. Both need the owner.
- The fork relationship with `shanliuling/dsh-image-gen` is permanent. Upstream
  sync is manual and rare; treat this tree as its own project.

## Releasing

A version bump is not a release. Four things have to be true before an update
reaches a user: `npm view <name>@<version> version` prints it, the market
`catalog` branch lists it, the entry's `releases[0].sha256` is the hash npm
serves, and `check-catalogue-parity.mjs` exits 0. One command does all four,
from the market checkout's tooling:

    node ../dsh-arya-market/scripts/release-plugin.mjs --dir ../dsh-arya-image-gen

It regenerates `index.json`, commits it, tags the commit and pushes, then
proves those conditions. A hot-copy into a profile's `node_modules` is a debug
aid, never a release: no other machine and no update check can see it.
Publishing a version without cataloguing it is the worst state - the market
answers from `releases[0]`, so every user is told they are up to date on a
release that exists. Ask the owner once for the exact version; never hand-edit
`data/arya-plugins.json`.

Before running it: the bump, the `CHANGELOG.md` section, the note under
`docs/releases/` and `(vX.Y.Z)` in the commit subject all land together (rule
5), and the tree must be clean - a release is reproducible from a commit.
`.github/workflows/release.yml` turns the pushed tag into a GitHub Release
whose body is that version's `CHANGELOG.md` section; if `gh` is reachable from
your own machine, pass `--no-github` to `release-plugin.mjs` so the workflow
owns the release body and the changelog stays the single source.

A rename is a release, not an edit: the package name, `cordis.patch.yml`, the
`tsdown.config.ts` bundle ids, `ARYA_IMAGE_TOOLSET_MODULE`, the packaging
fixture and the index listing move in one commit, the old name is deprecated in
place (`npm deprecate <old> "renamed to <new>"`) and never unpublished, and the
docs state which name npm actually serves today.
