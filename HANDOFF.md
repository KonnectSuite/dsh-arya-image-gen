# Arya Image Gen — Handoff Notes (2026-11-21 ~19:50)

Repo: `C:\Users\KNPhu\AryaCode\KonnectSuite\dsh-arya-image-gen` (git `main`). The public-docs
overhaul is ONE commit, the one whose subject ends `(v0.20.0)`; `git log -1 --format='%H %s'`
prints it. It is **not pushed** — this session's sandbox has no network and no npm auth.
Before this work HEAD was `d1739da5a92e97e2b44ee4a74e30bb804bb08823` (2026-11-09), and the
only tag in the repository is `v0.19.1`.

Bundle: `@aryacode/dsh-arya-image-gen` **0.20.0** — version committed, **not published**.
Tarball built from this tree: `aryacode-dsh-arya-image-gen-0.20.0.tgz`,
sha256 `c2b3b5d8df00a31e3317a1c7666f870455e3ad46108c1d1f84a9fbf2afbe8b14`,
19,962,092 bytes (under the market's 64 MiB cap). npm today still serves the **unscoped**
`dsh-arya-image-gen`, newest **0.19.2**; the scoped name 404s until the release runs.

## Goal (evolution)

User asked (m00001): "redo the public docs for @dsh-arya-image-gen/ … make sure we follow the
DSH plugin strategy for public plugins for install. I want an over hall of the docs so it's
professional and detailed. make sure other users can download it to there deepseek harness not
limited to AryaCide." `dsh-arya-computer-use/` and `dsh-engineering/` were named as the two
repos already done, to be used as references.

Plan-mode exploration then three decisions from the user (m00181): lead with the **scoped**
name `@aryacode/dsh-arya-image-gen` (so the rename is part of this release, not a later one);
docs stay **English-only for now** (no `README.zh.md` in this pass — a recorded deviation from
the market's EN+ZH parity rule); the extra surfaces are in scope (CHANGELOG, HANDOFF, issue and
PR templates, release workflow, `icon.svg`, root `index.json` + generator).
User steered twice on staffing: "please let the last subagent finsih then conitnue by yourself"
(m00363/m00364) — do not re-spawn the failed `.github` subagent — then "please continue"
(m00406, m00660). So: one CHANGELOG subagent wrote `CHANGELOG.md` and `.github/*`; everything
else in this file is lead-authored and reviewed.

## Hard constraints (from `dsh-arya-market/AGENTS-PLUGINS.md` and both AGENTS files)

- **Four gates**: documented → verified on a Dev host → approved → published. A version bump is
  not a release. Publishing and cataloguing happen on the owner's machine via
  `node ../dsh-arya-market/scripts/release-plugin.mjs --dir ../dsh-arya-image-gen`.
- **Gate-1 README order** is binding: what it does → requirements → install → where it appears →
  first run → settings → remove → troubleshooting → licence.
- `index.json` at the **repository root** is the listing a user adds as an index source
  (`https://cdn.jsdelivr.net/gh/KonnectSuite/dsh-arya-image-gen@latest/index.json`). The host
  reads `releases[0]` as "the newest thing that exists", so a stale listing is worse than none.
  It is generated, committed by the release step, and deliberately **not** in `package.json`
  `files`. Never hand-edit its version list; never hand-edit the market's `data/arya-plugins.json`.
- `dsh.engines.dsh` must be declared or the market prints "Host requirement unknown". Declared:
  `>=0.1.7 <1`.
- Retire = `npm deprecate`, **never** unpublish.
- Public surfaces state what the plugin **is**, never what it replaced (AGENTS rule 9).
  Provenance lives in `NOTICE`, the licence footer and `docs/releases/`.
- The rename moves the **package** and nothing else: plugin id `dsh-image-gen`
  (`src/index.ts:43`), settings namespace `image-gen`, routes `/plugins/dsh-image-gen/*`
  (`src/shared.ts`), default workspace folder `dsh-arya-image-gen` (`src/config.ts:38`).
  Settings, imported workflows and the gallery carry across; both names in one profile at once
  is a broken install, and the README says so.

## File status

- `README.md` ✅ rewritten (278 lines) in Gate-1 order. Hero
  `docs/assets/readme/hero-arya-wide.webp`; the npm badge and the npm link point at
  `dsh-arya-image-gen` because that is the name npm serves today; the install section leads
  with the command that works now and states the rename as "changes at 0.20.0 … the scoped name
  does not resolve on npm until the 0.20.0 release is out". Added the sections the old README
  never had: Requirements before Install, Where it appears, First run, Settings table,
  Removing it (every trace), Troubleshooting table.
- `README.zh.md` ✖ not written — user chose English-only this pass; recorded as AGENTS rule 10
  and as a known gap below.
- `CHANGELOG.md` ✅ new, newest-first, 28 stable versions reconstructed from npm publish times;
  the `## 0.20.0 — not yet published` section sits above `## 0.19.2 — 2026-11-09` and says so in
  the heading (the intro explains that convention).
- `docs/index.md` ✅ new: a map by task (install / ComfyUI install / workflows / own graph /
  reference images / remote ComfyUI / changelog / issues / security / contributing), a
  "what lives where" table, and a "not part of the plugin" list.
- `docs/releases/v0.20.0.md` ✅ new long-form note: why the scoped name, what moves and what does
  not (with line refs), the release command, the docs inventory, the known gaps.
- `index.json` (root) ✅ new: one entry, name kept **unscoped** `dsh-arya-image-gen` because that
  is the package npm serves — a scoped entry listing another package's versions would be a lie —
  28 stable versions with real `publishTimestamp` values and per-version `engines`
  (0.11.0 predates the declaration, so it carries none), newest `0.19.2`
  (`1794242093` = 2026-11-09T16:34:53Z), `icon: "icon.svg"`.
  `scripts/sync-market-index.mjs` flips the entry name to `package.json`'s name at release time.
- `scripts/sync-market-index.mjs` ✅ new: rebuilds that file from `npm view <name> --json`
  (`shell:true` on Windows — npm is a `.cmd` shim and EINVALs otherwise), refuses when the
  packument has no `time`/`versions`, skips prereleases and the `0.0.0-stage` placeholder,
  sorts ascending by publish time, `--dry-run`, `--check` (exit 1 on drift).
- `icon.svg` ✅ new 64×64 mark in the family palette (dark rounded square, picture frame, pink
  dot, mountain, teal baseline) — the same convention as `dsh-arya-computer-use/icon.svg`, not
  the brand-kit mascot. Wired through `package.json` `exports["./icon"]` + `files`, with **no**
  top-level `icon` field (that is how the sibling plugin does it).
- `SECURITY.md` ✅ rewritten: private vulnerability reporting, "no credential store — the only
  secret is a user-typed request header, stored in plain text in the profile config", an imported
  workflow graph is a program, the 12 same-origin routes, remote-ComfyUI guidance, the stop path
  only targets a Python `main.py` on the configured port, `import_reference_image` guards.
- `CONTRIBUTING.md` ✅ rewritten: the five commands, a tree map, "rules that actually bite",
  review expectations. The claim that the market check runs in CI was removed — it does not,
  because the scoped package is not on npm yet and `--check` would fail today.
- `AGENTS.md` ✅ rewritten to ten rules (+ CHANGELOG-in-the-same-commit, + root `index.json` is
  generated, + public surfaces say what it is, + English-only is a known gap) and a Releasing
  section that documents `release-plugin.mjs --dir`, the clean-tree rule, `--no-github`, and
  "a rename is a release".
- `.github/ISSUE_TEMPLATE/{bug_report.yml,feature_request.yml,config.yml}` +
  `.github/PULL_REQUEST_TEMPLATE.md` ✅ new (subagent-written, lead-reviewed). The feature
  template's "this fork / upstream / removed renderer" framing was rewritten to state the shape
  of the plugin instead (rule 9). `bug_report.yml` asks for the dumped config layer and gates a
  no-secrets checkbox; its "Settings → Arya Image Gen → Connection" wording matches the real
  card sections, which are **Connection / Server / Workflows / Workspace**
  (`src/client/index.tsx:1254,1273,1335,1401`).
- `.github/workflows/release.yml` ✅ new (108 lines, subagent-written, lead-reviewed): a pushed
  `v*` tag is checked against `package.json` **and** against the newest `## X.Y.Z` heading in
  `CHANGELOG.md`, that section is cut into the release body, and `gh release create --verify-tag
  --latest` (or `edit --latest` on a re-run) publishes it. `permissions: contents: write`, no
  `id-token`, no npm publish — publishing stays with `release-plugin.mjs`.
- `.github/workflows/ci.yml` unchanged (matrix ubuntu+windows, node 24, pnpm 11.7.0, install →
  typecheck → test → build → pack:check → test:package).
- Deleted: `docs/arya-catalog.workflow.yml`, `scripts/upsert-arya-catalog.mjs`,
  `docs/market/index.json` (stale: it still said `0.15.0`), and the zero-byte tracked `Connection`
  file. The first two described a publishing path that contradicts the real one — the market
  catalogue reconciles itself against npm every 15 minutes — and the README had claimed
  `.github/workflows/arya-catalog.yml` automated the catalog, which was never true.
- `.gitignore` gained `banner-build/`.
- Rename touchpoints (applied earlier in this session, all reviewed): `package.json` name and
  version, `cordis.patch.yml:3`, `tsdown.config.ts:12,14,29,52` (bundle ids and the
  `__ModuleLoader__.load({ id: … })` call), `src/agent-preset/definition.ts:49`
  `ARYA_IMAGE_TOOLSET_MODULE`, `tests/agent-preset.spec.ts:65`,
  `scripts/check-package.mjs:37,52`, `scripts/fixtures/package-settings.mjs:16,27,36`,
  seven `@module` doc tags, `skills/install-arya-image-gen/SKILL.md`.

## Done & verified (this tree, this session)

- `pnpm run typecheck` → clean.
- `pnpm test` → **Test Files 35 passed | 1 skipped (36); Tests 422 passed | 1 skipped (423)**;
  the live-ComfyUI case in `tests/workflow-pack.spec.ts` ran (2008 ms), so a ComfyUI server was
  reachable. Vitest needs one escalated retry (`danger-full-access`): under `workspace-write`,
  vite's `optimizeSafeRealPathSync`/`windowsSafeRealPathSync` does a `spawn` and EPERMs on the
  named-pipe boundary. That is a sandbox boundary, not a test failure.
- `pnpm run build` → clean (the `import.meta` notice from tsdown is pre-existing noise).
- `pnpm run pack:check` → clean; `pnpm pack` → the digest recorded at the top.
- Every install path, setting name, tool name, route and workflow name in the docs was checked
  against the source, and two false doc claims were fixed: `docs/comfyui-workflows.md` said
  "four workflows" (there are five) and `docs/install-comfyui.md` credited the plugin with a
  `comfy-mcp` engine it does not have.

## Remaining

1. **The release is the owner's action** and needs npm auth plus network:
   `node ../dsh-arya-market/scripts/release-plugin.mjs --dir ../dsh-arya-image-gen`, then
   `npm deprecate dsh-arya-image-gen "renamed to @aryacode/dsh-arya-image-gen"`. Until then the
   README's 0.20.0 language is the only thing describing a package that does not exist yet, and
   it says so plainly.
2. **GitHub repository settings are not files.** About still points at
   `shanliuling/dsh-image-gen#readme`; Issues are disabled (`has_issues=false`), so the new issue
   templates do nothing until Issues is switched on; topics should be
   `deepseek-harness`, `dsh-plugin`, `comfyui`, `image-generation`. All owner-only.
3. **`pnpm run test:package` fails, and CI runs it.** `scripts/fixtures/package-settings.mjs`
   still asserts the removed multi-provider card (`Default model`, `Editing model`,
   `googleNative`, `openaiCompatEditFormat`, lines 129-130, 158-167, 179). Rewrite it against the
   ComfyUI card before merging anything that must be green.
4. **Docs are English-only** while the two sibling public plugins ship `README.zh.md`. Writing
   the mirror is the largest remaining docs gap.
5. **GitHub Releases start at 0.20.0.** No tag exists below `v0.19.1`, and `release.yml` refuses
   a tag older than the newest CHANGELOG heading, so back-filling `v0.11.0…v0.19.2` would fail;
   those versions are documented by `docs/releases/` and `CHANGELOG.md` instead.
6. **Market-drift guard is deferred to the release.** Once the scoped package is on npm, add a CI
   step running `node scripts/sync-market-index.mjs --check`, and a test asserting the newest
   `index.json` version matches `package.json`. Both were skipped deliberately: the listing's
   newest is 0.19.2 (published) while `package.json` says 0.20.0 (unreleased), so either check
   would fail today.

Context management: blocks b2–b18 hold the exploration and decisions; the plan of record is in
b8. Nothing here needs a subagent — the user asked the lead to finish alone.
