# Documentation map

Everything this plugin documents, in one place. Start here when you are not sure which page you need.

## By what you are trying to do

| I want to… | Read |
|---|---|
| install the plugin into a DSH profile | [../README.md](../README.md) — **Install** (npm, plugin index, checkout) |
| get ComfyUI itself running | [install-comfyui.md](install-comfyui.md) — desktop app, Windows portable builds, `comfy-cli`, manual install, where models go, troubleshooting |
| understand what a workflow may be asked to do | [comfyui-workflows.md](comfyui-workflows.md) — roles, `{{prompt}}` / `{{seed}}` / `{{image}}` / `{{width}}` / `{{height}}` / `{{steps}}` / `{{cfg}}`, the shipped pack, **Check against ComfyUI** |
| import my own graph | [comfyui-workflows.md](comfyui-workflows.md) — export **Save (API Format)** from ComfyUI, what the plugin fills in, what it refuses to run |
| keep a character, product or object consistent across images | [reference-images.md](reference-images.md) — `import_reference_image`, the identity rules, what gets refused |
| point the plugin at ComfyUI on another machine | [../README.md](../README.md) — **Remote ComfyUI**, and [../SECURITY.md](../SECURITY.md) for what that exposes |
| read what changed in a version | [../CHANGELOG.md](../CHANGELOG.md) (every version, newest first) and the long-form notes in [releases/](releases/) |
| report a bug or ask for a feature | [issues](https://github.com/KonnectSuite/dsh-arya-image-gen/issues) — the forms ask for host version, plugin version, endpoint and the redacted tool error |
| report a security problem | [../SECURITY.md](../SECURITY.md) — private vulnerability reporting, never a public issue |
| contribute code | [../CONTRIBUTING.md](../CONTRIBUTING.md) for the workflow, [../AGENTS.md](../AGENTS.md) for the rules the repository enforces |

## What lives where

| Path | Contents |
|---|---|
| `docs/workflows/` | The five shipped workflow JSONs — the prefill pack the plugin configures on a fresh install. Edit these, then `pnpm run sync:workflows`; `src/generated/default-workflows.ts` is generated and is never edited by hand. |
| `docs/assets/readme/` | The hero image and the screenshots the README uses. |
| `docs/releases/` | Long-form release notes, one file per version. `CHANGELOG.md` condenses them and links here. |
| `index.json` (repository root) | The plugin-index listing a user adds as an index source. Regenerate it with `node scripts/sync-market-index.mjs`. It is a repository artifact and is deliberately not packed into the npm tarball. |

## Not part of the plugin

- `docs/image-room-spec.md` — a gitignored working draft of a future image room. Not shipped, not linked from the README, not a promise.
- `banner-build/` — untracked scratch: the HTML the README hero was rendered from and the compose script. Nothing at runtime reads it.
- The sibling repository `arya-comfyui-workflows` — graphs users import by hand. Different file names, and no script syncs it with `docs/workflows/`, so a change here does not reach it.

## Reading order for a new user

[README.md](../README.md) → [install-comfyui.md](install-comfyui.md) if there is no server yet → the **First run** steps in the README → [comfyui-workflows.md](comfyui-workflows.md) → [reference-images.md](reference-images.md).
