# Contributing

Thanks for reading this before sending a patch. This is a small plugin with an unusually specific shape — one image provider (your ComfyUI server), no renderer, a preset that deliberately shrinks a session — and most of the rules below exist because someone learned the hard way.

## Before you write anything

- Check [the issue list](https://github.com/KonnectSuite/dsh-arya-image-gen/issues) and the [changelog](CHANGELOG.md) first. A feature that was removed on purpose is listed under **Removed** with the reason; the renderer is the biggest one of those.
- Open an issue before doing anything large. A pull request that changes the shape of the plugin — a second provider, a new tool, a new settings page — will be discussed at length, and the answer may be no.
- Bug reports need the DSH version, the plugin version, the endpoint and workflow involved, and the complete redacted tool error. The plugin's issue form asks for exactly that.

## The commands

```sh
pnpm install          # also builds: prepare runs the build
pnpm run typecheck    # tsc --noEmit
pnpm test             # vitest run
pnpm run build        # sync the generated workflow pack, then tsc + tsdown
pnpm run pack:check   # npm pack dry run
pnpm run test:package # install the real tarball in a temp dir and boot it against DSH
```

CI runs all five checks on Ubuntu and Windows, Node 24, pnpm 11.7.0. If `pnpm test` is slow, run the file you touched: `pnpm vitest run tests/workflow-roles.spec.ts`.

## How the tree is laid out

| Path | What lives there |
|---|---|
| `src/index.ts` | DSH registration: tools, routes, preset, skills. The wiring, not the logic. |
| `src/shared.ts` | Route constants, the tool-name list, defaults, the workflow JSON types. |
| `src/config.ts` | The settings schema. Every field here is a row on the plugin's settings page. |
| `src/comfyui.ts`, `src/comfyui-server.ts` | Talking to a running server; starting and stopping a local one. |
| `src/workflows.ts`, `src/generated/` | Placeholder templating and role detection; `src/generated/default-workflows.ts` is **generated** — see rule 1 in [`AGENTS.md`](AGENTS.md). |
| `src/agent-preset/` | The Arya Image session preset and its tool mask. |
| `src/client/` | Browser: settings card, Studio, gallery, inspiration, comparison. `src/client/tl/` is the tldraw canvas. |
| `docs/workflows/` | The prefill pack the plugin ships. The sibling repository `arya-comfyui-workflows` holds the pack users import by hand; the file names differ and no script syncs the two. |
| `tests/` | Vitest specs, plus `scripts/fixtures/` for the package-level checks. |

## Rules that actually bite

1. **Never edit `src/generated/default-workflows.ts` by hand.** Edit `docs/workflows/*.json` and run `pnpm run sync:workflows`. `tests/default-workflows.spec.ts` fails when the two drift, which is the point.
2. **No HTML/SVG renderer, and no browser dependency to add one.** `render_html`, `render_svg`, `list_render_templates`, the render route, the Chromium driver and the Studio Render tab were removed in v0.19.0: a model that can already write HTML and SVG reached for them and drifted, and a rasterized page proved nothing about the image. Do not reintroduce them.
3. **A preset row can only mask tools it inherited.** To keep an image session small, add the tool to `coreToolNames` in `src/agent-preset/definition.ts`, not to `presetToolRows`.
4. **User-facing strings are English in code, and the public docs are English plus Chinese.** `README.zh.md` is kept in step with `README.md` by hand; a change to one needs the other in the same pull request.
5. **`docs/image-room-spec.md` is gitignored on purpose** — a working draft, not part of the plugin. `banner-build/` is untracked scratch. Neither belongs in a commit.
6. **Conventional commits with the version in the subject**: `fix: … (v0.20.1)`, with the `package.json` bump in the same commit and the release note in `CHANGELOG.md`. A version bump that is not a release is worse than no bump: a market answers from the newest entry it can find.

## What a change to the docs needs

Docs are a product surface here, not a changelog for us. If you change a setting, a tool, a workflow placeholder or an install path, the same pull request updates `README.md`, `README.zh.md`, the matching file under `docs/`, and the `CHANGELOG.md` entry. The market listing at the repository root (`index.json`) is regenerated as part of a release with `node scripts/sync-market-index.mjs`; pass `--check` to report drift from npm without writing it.

## Review

Expect questions about the user-visible effect before questions about style. The things a reviewer will check: does the settings page still explain itself with its defaults, does an error say what happened and what to do next, does a new tool earn its tokens in every session that mounts it, and does the changelog entry make sense to someone who was not here.
