<!-- What changed, and why. Link the issue it closes when there is one. -->

## What changed

## Why

## Checklist

- [ ] The commit subject is a conventional commit (`fix:` / `feat:` / `chore:`) ending in `(vX.Y.Z)`, and the `package.json` version bump is in that same commit
- [ ] A release note for this version is added under `docs/releases/vX.Y.Z.md`
- [ ] `pnpm sync:workflows` was re-run after any change to `docs/workflows/*.json`: `src/generated/default-workflows.ts` is generated from that pack, and `tests/default-workflows.spec.ts` fails when it is stale
- [ ] Nothing under `src/generated/**` was hand-edited
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm pack:check` and `pnpm test:package` all pass
- [ ] No HTML/SVG renderer, render route, Chromium driver or browser dependency comes back: `render_html`, `render_svg`, `list_render_templates` and the Studio Render tab were removed on purpose in v0.19.0
- [ ] User-facing strings stay English-only for now - no second locale is introduced here
- [ ] `docs/image-room-spec.md` (a gitignored working draft) and `banner-build/` (untracked scratch) are not part of the plugin and are not committed
- [ ] A tool that must stay out of the Arya Image session was added to `coreToolNames` in `src/agent-preset/definition.ts`, not to `presetToolRows` - the mask can only name inherited globals
- [ ] Nothing was published and no market file was touched: publishing and cataloguing happen from the owner's machine through `node ../dsh-arya-market/scripts/release-plugin.mjs`

## How it was tested

<!-- The command, the ComfyUI endpoint and the workflow it ran against, and the result. "It builds" is not evidence that a generation works. -->
