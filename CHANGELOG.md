# Changelog

All published versions of Arya Image Gen, newest first. Long-form release notes for every version live in [`docs/releases/`](docs/releases/); the date in each heading is that version's npm publish date (UTC) from the registry packument, except 0.8.6, which predates npm publishing. A version that is committed and versioned but not yet on npm says so in its heading instead of carrying a date.

## 0.20.2 — 2026-11-22

**Fixed — the installed package stopped telling users to install the retired name.** `README.md` is in `files`, and npm renders a package page from the copy inside the tarball. 0.20.0 and 0.20.1 were packed before the README rewrite landed, so the page for `@aryacode/dsh-arya-image-gen` still read `dsh plugin --profile web add dsh-arya-image-gen` and pointed its badge at the deprecated name — an install line that now prints a deprecation notice. No runtime code changed between 0.20.1 and 0.20.2; this version exists so the archive carries the install instructions that work. Long-form: [`docs/releases/v0.20.2.md`](docs/releases/v0.20.2.md).

**Fixed — `scripts/sync-market-index.mjs` reads the registry packument, not `npm view`.** The CLI answers with an abbreviated document: an array-wrapped summary whose `versions` is a flat list of version strings, with the per-version manifests dropped. Iterating it yields array indexes, so the generator died on `npm has no publish time for @aryacode/dsh-arya-image-gen@0` and the listing would have drifted exactly like the `0.15.0` copy this script replaced. It fetches `https://registry.npmjs.org/<name>` over HTTPS, the only source that carries both the publish time and the `engines.dsh` range each version declared. `index.json` regenerated against it: one entry `@aryacode/dsh-arya-image-gen`, two versions, `engines.dsh >=0.1.7 <1`.

Tests: 422 passed, 1 skipped. `pnpm run test:package` passes both schemastery branches against the packed tarball.

## 0.20.1 — 2026-11-22

**Fixed — the archive now ships the icon the manifest advertises.** `package.json` maps `exports["./icon"]` to `icon.svg`, but `icon.svg` was missing from `files`, so the 0.20.0 tarball had no icon to serve. It is packed from 0.20.1, the same way `@aryacode/dsh-plugin-arya-computer-use` ships its own.

**Changed — the archive stopped carrying the documentation screenshots.** 0.20.0 packed `docs/assets/readme/*.webp`: 18 MB of README pictures that only GitHub and jsDelivr render, which made the installed package 20 MB. The 0.20.1 archive is 1.7 MB over 84 files — the built bundles and their types, the three skills, the five shipped workflow JSONs, `icon.svg`, `README.md`, `LICENSE`, `NOTICE`, `cordis.patch.yml`. Nothing at runtime reads `docs/`: the prefill pack is compiled into `src/generated/default-workflows.ts` by `pnpm run sync:workflows`, so the screenshots were dead weight in every install.

**Changed — the plugin-index entry follows the renamed package.** `scripts/sync-market-index.mjs` keys the listing off `package.json`, so `index.json` now carries one entry named `@aryacode/dsh-arya-image-gen` and lists the versions npm serves under that name (0.20.0 up). The pre-rename versions are not under it, and the script refuses to list versions the registry does not serve; 0.11.0–0.19.2 stay installable by their own name.

Tests: 422 passed, 1 skipped. `pnpm run test:package` passes both schemastery branches against the packed, renamed tarball.

## 0.20.0 — 2026-11-22

**Changed — the package is now `@aryacode/dsh-arya-image-gen`.** The npm name moved from the unscoped `dsh-arya-image-gen` to the scoped first-party name, so the install line, the tarball and the catalogue entry all read the same thing. Nothing about the running plugin moves: the plugin id stays `dsh-image-gen` (`src/index.ts:43`), so do its settings namespace, its HTTP routes under `/plugins/dsh-image-gen/`, its workspace folder and its caches. Remove the old package, add the new one, and your endpoint, imported workflows, gallery and saved images come across unchanged. Releases up to 0.19.2 stay installable under `dsh-arya-image-gen`; that name is never pulled down. Long-form: [`docs/releases/v0.20.0.md`](docs/releases/v0.20.0.md).

**Added.**

- [`CHANGELOG.md`](CHANGELOG.md) — this file: every published version from 0.8.6 and 0.11.0 forward, newest first, condensed from the 28 long-form notes in `docs/releases/`, dated from the npm packument. It is what `release-plugin.mjs` reads for release notes and what `.github/workflows/release.yml` cuts a GitHub Release from.
- `index.json` at the repository root — the plugin-index listing a user adds as an index source on any DSH build (`https://cdn.jsdelivr.net/gh/KonnectSuite/dsh-arya-image-gen@latest/index.json`), listing the stable versions npm serves under the entry's name with their real publish times and per-version host requirements: 28 of them under the unscoped name when it was written, and from 0.20.1 under `@aryacode/dsh-arya-image-gen`, because the generator follows `package.json`. The copy this replaces lived at `docs/market/index.json` and still said `0.15.0`.
- `scripts/sync-market-index.mjs` — regenerates that listing from npm (`--dry-run`, `--check`), so it cannot silently drift again. Not in `package.json` `files`: it is a repository artifact, never packed.
- `icon.svg` — the Plugin Manager mark, in the same family as the other AryaCode plugins.
- `.github/ISSUE_TEMPLATE/bug_report.yml`, `feature_request.yml`, `config.yml`, `PULL_REQUEST_TEMPLATE.md` — the bug form asks for the host version, plugin version, OS, endpoint, workflow name and the redacted tool error.
- `.github/workflows/release.yml` — a `vX.Y.Z` tag becomes a GitHub Release whose body is that version's `CHANGELOG.md` section. It publishes nothing to npm: publishing is the market release step, run from the owner's machine.
- `docs/index.md` — a map of the documentation by task, and what is deliberately not part of the plugin.
- `HANDOFF.md` — the state of the repository: what is done, what is verified, what is outstanding.

**Changed — the public documentation was rewritten to describe this plugin.**

- `README.md` follows the public-plugin reading order: what it does → requirements → install → where it appears → first run → settings → workflows → server control → removing it → troubleshooting → licence. It states the requirements before the install commands, names every setting the settings page shows, and says what to do when the common failures happen. Every install route is written for a plain DeepSeek Harness web profile; AryaCode is named as a rebranded DSH build, not as the target.
- `SECURITY.md` no longer claims the plugin stores API keys for Google Gemini, OpenAI or ByteDance Ark — it never did. It describes the surface that exists: no credentials, one configurable request-header token, the DSH routes the plugin registers, what a remote ComfyUI endpoint exposes, and why an imported workflow graph is a program.
- `CONTRIBUTING.md` no longer points contributors at `src/google.ts` or `src/openai-compatible.ts`. It maps the tree as it is, states the rules that actually bite, and lists the five commands CI runs.
- `docs/comfyui-workflows.md` said four workflows ship; five do. `docs/install-comfyui.md` credited the plugin's server control with an optional `comfy-mcp` engine that does not exist in this plugin; it now says what the buttons actually run.

**Removed.** `docs/arya-catalog.workflow.yml` and `scripts/upsert-arya-catalog.mjs` — a GitHub workflow that was never enabled and a script nothing called, describing a publishing path that contradicts the real one (the market catalogue reconciles itself against npm every 15 minutes). `docs/market/index.json`, superseded by the root listing. The zero-byte `Connection` file that was tracked by accident.

**Known gap.** The documentation is English-only. The other two public AryaCode plugins ship a `README.zh.md` and the market rules ask for English/Chinese parity; this one does not yet, and its in-product strings have been English-only since the fork.

## 0.19.2 — 2026-11-09

**Changed.** The Arya Image preset pays only for the tools it uses. The full standard row list introduced in 0.19.1 is cut back to the image tools plus a small core set.

- Preset rows are now: the persona, `agent-instructions`, `time-context`, both shell rows (one disabled), `tool-fs`, `tool-fs-search`, `tool-jobs`, the compaction group, `tool-ask-user`, `tool-web`, `present`, and the tool mask.
- The session's tool list is 23 tools: the eight image tools, `read`, `write`, `edit`, `glob`, `grep`, `read_image`, `working_directory`, `pwsh` (or `bash`), `job_list`, `job_output`, `job_kill`, `web_search`, `web_fetch`, `ask_user_question` and `present`.
- A last row, `dsh-arya-image-gen/agent-toolset`, masks every global tool the allow list does not name. Rows alone cannot do that: a tool registered by the preset's own rows lives in the agent scope and is exempt from a restriction, while the host registers other bundles, MCP servers and computer use globally. `working_directory` is not a row of this preset — the host mounts it globally — so the mask is what keeps it.
- The mask fails open: it drops names the host does not register (read out of the registry's own refusal) and leaves the session untouched if the restriction is refused outright, because a session that loses its tools is worse than one that pays for a few extra schemas.
- The persona now says the session has no skills, subagents, goals, plan mode, scheduling or todo list, instead of claiming the full DSH tool set; the two shipped skills still load in other presets.

**Removed.** `src/agent-preset/plan-section.ts` went with the plan-mode row, and the definition builder no longer takes `profileContext`.

Tests: 422 passed, 1 skipped.

## 0.19.1 — 2026-11-06

**Changed.** The Arya Image preset row list became the shipped DSH standard row set, minus the AryaCode `arya-review-skills` provider this plugin does not ship; the conditional plugin-manager row follows `profileContext`, and the market row stays disabled.

**Added.** A billion-context stand-down for the compaction rows.

- Detection requires both signals: bili's `biliBasicCompactionPolicy` gate service **and** its `__BILI_DSH_COMPACTION_VERDICT__ === 'active'` process verdict. When both are present, `compaction-basic` and `command-compact` mount disabled while the tool-result pruner and every other row stay mounted.
- Bili's kill switches, an absent bili, or a timeout keep the stock rows and change nothing.
- The check runs at definition time on purpose: bili's `internal/config` overlay cannot reach a preset registered through `agentPresets.register()`.

Tests: 421 passed, 1 skipped; a live bili profile confirmed the helper returns true with bili active and false with `BILLION_CONTEXT_PLUGIN=0`.

## 0.19.0 — 2026-11-04

**Breaking.** The HTML and SVG render tools are gone: `render_html`, `render_svg` and `list_render_templates`, together with everything that served them. Eleven image tools became eight.

- Routes removed: `/plugins/dsh-image-gen/render` and `/plugins/dsh-image-gen/render-health`. Modules removed: `src/render-tools.ts`, `src/render-route.ts`, `src/render-service.ts` and `src/render/` (browser discovery, sanitizer, templates, web-page guard, PNG encoder).
- UI removed: the Studio Render tab and its view, and the "HTML and SVG rendering" settings section with its renderer health line. Settings removed: `renderBrowserPath`, `renderDefaultWidth`, `renderDefaultHeight`, `renderScale`, `renderBackground`, `renderTimeoutMs`, `renderSaveSource` — an old profile that still carries them boots unchanged, the keys are simply ignored.
- Also removed: `assets/fonts/` (Sora and JetBrains Mono) and `docs/assets/render/`, the `html-to-png` and `svg-to-png` skills, and `docs/rendering.md` and `docs/render-plan.md`.
- Why: a model that writes HTML and SVG itself does not need a second, weaker route to a picture, and rasterizing a page produces a PNG that looks like evidence while proving nothing. 0.18.13 spent a release teaching the tools what they are not for; the honest fix was to take them out of the prompt.

**Changed.**

- `ImageProvider` is `comfyui` only — the `html` and `svg` provider ids, display names, default models and base URLs are gone.
- The Arya Image persona and the `arya-image-workflows` and `arya-image-references` skills no longer route a layout request to a renderer and say plainly that a diffusion model cannot guarantee lettering.
- The README hero is re-rendered from `banner-build/hero.html` with headless Chrome, since the plugin no longer renders; the three sources are now the shipped workflow roles (text to image, edit and restyle, cutout) and the tool count reads eight. The Studio tab strip is Gallery · Studio · Inspiration · Favorites.

Tests: `tests/render.spec.ts` and `tests/web-page-guard.spec.ts` deleted with the code they covered; tool-name and tool-registration assertions in `tests/agent-preset.spec.ts` and `tests/index-unsupported-settings.spec.ts` expect the eight-tool set; 382 tests pass (383 with one live-ComfyUI test skipped) across 36 spec files. Upgrade: nothing to migrate — images made by the old tools are ordinary attachments and stay in the gallery.

## 0.18.13 — 2026-11-02

**Fixed.** The render tools now say what they are not for. Benchmarking a website went wrong because `render_html` looks like a page previewer: a model asked to "verify the site" reached for it instead of running the dev server, and the PNG looked like evidence and proved nothing.

- `render_html`'s description states the boundary — one isolated document with none of a project's stylesheets, scripts, routes or dev server, so it cannot verify a website, an app or a live page, which needs the project running in a browser; `render_svg` says the same in one clause.
- A guard on the result: when the markup reads like a page (`<script>` tags, a linked stylesheet, `nav`/`header`/`main`/`footer`, or asset paths that resolve only inside the project) the tool result carries a warning naming what was stripped and pointing at the browser route. It is advisory only, so a card that embeds a local logo still renders.
- The `html-to-png` skill gained a "When NOT to use it" section, `svg-to-png` the same one-line limit, and `docs/rendering.md` states it beside the comparison table.

Tests: `tests/web-page-guard.spec.ts` — a self-contained card passes while script tags, linked stylesheets, page landmarks and relative asset paths each flag with their own reason; 413 tests pass. The note is explicit that this does not stop a model that ignores the description and the warning.

## 0.18.12 — 2026-11-02

**Changed.** ComfyUI is the default route. The persona and the `arya-image-workflows` skill now say `generate_image`, `generate_images` and `edit_image` are the route for every image request, that `render_html` and `render_svg` are for pictures whose point is exact legible text and layout or for when the user asks, and that a ComfyUI connection error means the server looks down — offer Settings → Plugins → Arya Image Gen → Server → Start instead of quietly drawing it another way.

**Added.** A **Launch method** setting for the ComfyUI server controls, default **Automatic**.

- Automatic: use the scheduled task named below if it exists, otherwise the Python route, stopped by matching `schtasks /end` and then the port backstop. Scheduled task: `schtasks /run /tn <name>` / `schtasks /end`, plus killing whatever still holds the port. Python process: spawn `main.py` with the configured interpreter, and kill ComfyUI's own `main.py` process.
- A tray or service install (for example `C:\Users\KNPhu\ComfyUI-Service`) needs no paths at all; the card then reads `Auto: using scheduled task "ComfyUI" (Running).`
- Hardening: a task still reading `Running` after a stop is ended before the next run (`schtasks /run` refuses otherwise); a process holding the port without answering is killed before launching, so a restart cannot fail to bind on a zombie; the start window is 180 s and a timeout reports the task state as well as the log tail.

Evidence: with zero configuration the status route returned `launchMode: auto, effectiveLaunch: scheduled-task, taskName: ComfyUI, taskState: Running`, and `POST action=restart` came back OK in 123 s with server 0.37.4 back up.

## 0.18.11 — 2026-11-02

**Added.** Multi-reference composition: a workflow can declare `{{images}}` instead of a single `{{image}}`, written `"images.image_1": ["{{images}}", 0]`.

- For N supplied references the plugin drops that link, creates N `LoadImage` nodes with fresh ids and wires them to `images.image_1 … image_N` in call order, so "image 1 is the subject, image 2 is the scene" holds. `edit_image(source_paths=[…])`, `source_image_ids` and inline attachments all feed it in order, and Studio passes every uploaded reference instead of only the first; the encoder's own ceiling is 16 slots.
- A workflow with a single `{{image}}` still takes exactly one, and now says so with the fix: use a workflow that declares `{{images}}` for multi-reference composition.
- New workflow `qwen-image-compose.json`: the same Qwen Image 2.1 graph as the edit workflow with the encoder's image input made dynamic, labelled "Qwen Image 2.1 - compose (any number of references)", image-to-image by role so `list_workflows` reports it and an edit call can name it.
- `docs/comfyui-workflows.md` gained the compose row and the `{{images}}` rule, and the `arya-image-workflows` skill a "several references at once" section noting two or three is the useful range.

Tests: `tests/live-compose.spec.ts` (opt-in, `COMFY_LIVE=1`) uploaded two real PNGs and produced an image in 16.5 s; unit tests cover order, ids, empty input, 17 refused, a single-image workflow refusing extras, and a marker on an unnumbered key.

## 0.18.10 — 2026-11-02

**Fixed.** The Arya Image preset now has a real tool list. It mounted three rows and relied on masking inherited tools, but a restriction can only name what the host registers globally, so the mask kept the eleven image tools, dropped every host tool as unknown for that scope, and the session started with no `read`, no `pwsh` and no `web_search`.

- The definition is now Arya Standard's row list minus skills, goals, plan mode and delegation, plus the web rows: persona, `agent-instructions`, `time-context`, `tool-bash`/`tool-pwsh` (disabled by platform), `tool-fs`, `tool-fs-search`, `tool-jobs`, `tool-web { fetch: true, searchTimeoutMs: 60000 }`, `tool-ask-user`, `present`.
- The mask row and the `ctx.tools.get()` presence filter are removed: the shipped and AryaCode presets declare their rows and mount no mask at all.

Evidence: a fresh Arya Image session reports `ask_user_question, canvas_state, edit, edit_image, find_inspiration, generate_image, generate_images, glob, grep, import_reference_image, job_kill, job_list, job_output, list_render_templates, list_workflows, present, pwsh, read, read_image, render_html, render_svg, view_canvas, web_fetch, web_search, working_directory, write`, so the reference loop (web_search → web_fetch → import_reference_image → edit_image) runs inside the preset.

## 0.18.9 — 2026-11-02

**Added.** `import_reference_image` downloads one public image URL into `<workspace>/<folder>/references/` and returns the path `edit_image` takes as `source_path`.

- Deliberately strict: http/https only, no credentials in the URL, every resolved address must be public (loopback, private, link-local and CGNAT refused, including after a redirect), at most four redirects, PNG/JPEG/WebP decided by magic bytes rather than `content-type`, a 16 MB cap enforced while streaming, the file contained inside the workspace, and pixel dimensions read from the header so the model can judge the reference.
- New `arya-image-references` skill, the same rule in two sentences in the preset persona, and `docs/reference-images.md` for the loop, guarantees, source-quality rules and failure messages.

**Fixed.** The tool mask filtered its allow list with `ctx.tools.get(name)`, which answers from the global view only — once presets moved their tools onto the agent plane that lookup reported the host's own tools as absent, so the mask stripped them and kept only the image tools. The mask now submits the full list and drops exactly the names `restrict()` calls unknown, retrying once.

## 0.18.8 — 2026-11-02

**Added.** A generation status dock above the composer. The "Generating image" panel used to live only inside the tool card and disappeared when the host folded the call into its "calling tools" row.

- The panel renders in `conversation.input.dock`, a list slot outside the conversation stream, showing phase, elapsed seconds, the step progress bar, the running node, the workflow and a thumbnail.
- A live canvas replaces the empty box: ComfyUI's latent preview when the sampler emits one, otherwise an animated shimmer with the `value/max` step badge. The inline card keeps its own progress with the same fallback and the same "Preparing / Queued / Generating image" phases.
- `src/client/generation-activity.ts` is a framework-free store the card publishes into and the dock subscribes to, keyed by tool-call id and session, so two sessions never show each other's job.

**Fixed.** A stylesheet typo (`.n.dsh-ig-progress` instead of `.dsh-ig-progress`) had left the inline panel without layout, border or background.

Evidence: on the dev profile the dock read `Generating image 4.8s` with node `VAEDecode` and workflow `Qwen_Image_2_1_Turbo_Wide_1344x768.json` while the stream was thinking, and disappeared on its own when the result arrived.

## 0.18.7 — 2026-11-02

**Fixed.** The Arya Image preset is no longer reported broken, so the picker lists it. Registration worked in 0.18.6, but the host reported `arya-image-toolset (dsh-arya-image-gen/agent-toolset): cannot get property "tools" without inject`.

- A preset row runs in a scoped context where only declared services are visible, and the Loader reads `inject` from the module, not from a property on the exported `apply` function — so the mask row had no `ctx.tools`, failed to activate, and the host marked the whole preset broken, which the client hides.
- `src/agent-preset/toolset.ts` now declares `export const inject = ['tools']` (the function property stays for a direct `ctx.plugin()` mount); `src/agent-preset/register.ts` reads the registry's own list after registering and warns when the host reports this preset broken.

Evidence: on the dev profile the picker lists Arya Image at order 2.5 and the registry reports it with no `broken` field; `tests/agent-preset.spec.ts` pins the named `inject` export and the `tools` service declaration.

## 0.18.6 — 2026-11-02

**Fixed.** The Arya Image preset now actually registers; until now it never reached the host's registry, so the picker never listed it.

- The plugin registered it with `ctx.inject(['agentPresets'], …)` from inside its own `apply()`. That callback starts a plugin of its own *after* the entry has already applied, so the registration can land after the Loader settles, and a preset list the client has already read never gains the entry.
- Registration now uses the pattern the AryaCode presets use (`dsh-aryacode-polish/presets/arya-standard/plugin.js`): a mount point of its own exported with `inject = ['agentPresets']`, mounted with `ctx.plugin()`, the service read through `ctx.get()`, and a composition without the registry still boots without it.
- Diagnosing it: the mount logs `arya-image-preset: mount point active` and then `arya-image-preset: registered arya-image (Arya Image)`. The first line without the second means the registry rejected the definition and logged the reason; no line at all means the Loader never reached the mount.

The definition itself is unchanged: id `arya-image`, order 2.5, the image persona, the tool-ask-user and present rows, and the tool mask.

## 0.18.5 — 2026-11-02

**Removed.** The composer pill — the workflow switcher beside the chat input — is deleted, not hidden. It was a second place to pick a workflow and it duplicated the two that already work: the settings card, which lists every imported workflow per role and marks the active one, and `list_workflows` plus the `arya-image-workflows` skill, which is how the agent already chose.

- `src/client/provider-pill.tsx` and its stylesheet are gone, along with the `conversation.input.right` slot registration in `src/client/index.tsx`.
- The `showProviderPill` setting is gone: config field, schema entry, and the **Interface** section of the settings card that held the toggle.
- The two `conversation.input.right` assertions in `tests/client-compat.spec.ts` and the line in `docs/render-plan.md` that listed a renderer pill as deferred are gone.

Upgrade note: a profile that already carries `showProviderPill: true` keeps the key, and it is inert — the schema tolerates unknown keys, nothing reads it, and the pill no longer exists to be shown.

## 0.18.4 — 2026-11-02

**Changed.** The Arya Image preset was registering but sat last in the picker (order 6), below the fold of a list that already held seven entries, so it looked missing.

- Preset order is now 2.5, directly after Arya Standard.
- Registration is logged: `arya-image-preset: registered arya-image (Arya Image)` on success, and the existing warning with the reason on failure, so a missing preset is diagnosable from the log instead of guessed at.

The composer pill remains opt-in (`showProviderPill`, default off) at Settings → Plugins → Arya Image Gen → Interface → "Show the workflow switcher beside the chat input"; the agent selects by role, so the pill is not required for anything the model does.

## 0.18.3 — 2026-11-01

**Added.** The agent can choose the workflow instead of inheriting the last active one.

- `list_workflows` lists every configured workflow with its role, which parameters a call may set, the size it bakes, and which one each role picks by default.
- The `arya-image-workflows` skill covers how to match a request to a workflow and the mistakes to avoid: naming a workflow from the other role, or passing a size to a workflow that bakes it.

**Fixed.** An install with no configured workflows now falls back to the shipped pack instead of reporting "No workflow imported" forever, so an old profile that saved an empty list — or one installed at 0.13.0, before the pack existed — starts working without an import step.

Per-role auto-selection is unchanged: `generate_image` still resolves the active text-to-image workflow and `edit_image` the active image-to-image one, and the composer pill stays a human convenience off by default (`showProviderPill`).

## 0.18.2 — 2026-11-01

**Added.** A fresh install can generate immediately, and the plugin can pre-flight its own workflows.

- The four shipped Qwen Image 2.1 workflows are the configuration default, so a new profile lists create (adjustable size), cutout, edit and remove background without importing anything. They come from `docs/workflows/`, embedded at build time by `scripts/sync-default-workflows.mjs`; `tests/default-workflows.spec.ts` fails if the embedded copy drifts from the pack.
- A button in the Workflows card pre-flights every configured workflow against the running server's `object_info` and names the missing node classes or model files. This is the plugin-native equivalent of the Comfy MCP server's `validate_workflow`, and it works on templated workflows by checking classes and loader file names — the two things that survive placeholder substitution.
- `GET /plugins/dsh-image-gen/check-workflows` exposes the same report. The check needs the server up: with ComfyUI down it returns an error rather than a verdict.

Evidence: all four prefilled workflows report clean against ComfyUI 0.37.4 — classes and models both — and 384 tests pass. Existing installations keep their own list; the prefill applies only where nothing is configured yet.

## 0.18.1 — 2026-11-01

**Added.** `docs/workflows/` with four API-format workflows and a zip, shipped inside the npm tarball: `qwen-image-create.json` (text to image, `{{width}}`/`{{height}}`), `qwen-image-cutout.json` (RGBA cutout), `qwen-image-edit.json` and `qwen-image-remove-bg.json` (both image to image). They import as-is.

**Changed.** A workflow that declares `{{width}}`/`{{height}}` no longer fails when a call omits them: the size falls back to 1024×1024, so `generate_image` keeps working from a plain prompt. Sampling placeholders stay mandatory, because a guessed step count or cfg silently changes the picture.

The pack maps one-to-one onto the roles 0.18.0 introduced: one create workflow with adjustable size replaces the square/portrait/wide exports, and one edit workflow drives `edit_image`.

## 0.18.0 — 2026-11-01

**Added.** Workflow roles and adjustable generation parameters; six workflow files become two, and a call can set the size.

- **Role sections** in the Workflows card — Text to image and Image to image, detected from the JSON (`{{image}}` marks an edit workflow) with a per-row override. A per-role active workflow: generation uses the active text workflow, `edit_image` the active edit workflow; the legacy single key still seeds the text slot, so existing configs keep working.
- **Numeric placeholders** `{{width}}`, `{{height}}`, `{{steps}}`, `{{cfg}}`, injected as real numbers with bounds 64–8192, 1–150 and 0–30. `generate_image`, `generate_images` and `edit_image` accept `width`, `height`, `steps` and `cfg` when the chosen workflow declares them.
- **Studio**: size presets (Square 1024, Portrait 768×1344, Wide 1344×768) plus width/height fields, and a Sampling section for steps/cfg, shown only for workflows that expose them. The import summary reports the detected role, capability chips, and a warning when an existing workflow already covers the same role and size.
- `docs/comfyui-workflows.md` explains the placeholders and the conversion of a size-baked workflow into a templated one.

**Messages over guesses.** A parameter the workflow bakes is an error that names the fix, not a silent fallback; a declared placeholder without a value is an error too; naming a workflow from the wrong role explains which one the call needed. Nothing is rewritten on migration — roles are detected on load and the old active workflow keeps driving generation.

## 0.17.1 — 2026-11-01

**Changed.** Documentation and artwork only; no code changes.

- The README hero is rebuilt from `banner-build/hero.html` by the plugin's own `render_html` path at 2400x1250. It shows the three sources (ComfyUI, HTML, SVG), the author → render → PNG → chat/canvas/gallery pipeline, the four surfaces, and the powered-by strip with Chromium beside ComfyUI Local/Remote.
- The hero art is reproducible: the source page, the PNG and a rebuild note are committed under `banner-build/` (repository only — the npm tarball ships the WebP under `docs/assets/readme/`).

Everything from 0.17.0 is unchanged: `render_html`, `render_svg`, `list_render_templates`, six templates, the Studio render surface, the rendering settings card, two skills, and `docs/rendering.md`. (Those render tools were removed in 0.19.0.)

## 0.17.0 — 2026-11-01

**Added.** Images from three sources: ComfyUI diffusion, HTML rendering and SVG rasterization. (All of the tools below were removed in 0.19.0.)

- `render_html` renders a document to PNG with a Chromium-family browser, accepting inline HTML, a workspace file, or a built-in template plus slot values; `render_svg` rasterizes SVG at any size, defaulting to the SVG's own width/height or viewBox; `list_render_templates` lists the template catalog with ids, canvas sizes and slot names.
- Six brand templates: `og-card`, `social-square`, `banner`, `feature-grid`, `stat-card`, `comparison`. A **Studio → Render** surface: template picker, code editor, slot fields, size/scale/background, preview and a session result rail. A settings-card section with browser path, default canvas, background, save-source toggle and a renderer health line.
- Sora and JetBrains Mono ship with the package so rendered text matches the brand, and two skills ship: `html-to-png` and `svg-to-png`.

**How it works.** A render writes a temporary page and runs the installed browser with `--headless=new --screenshot` at an exact viewport and device scale factor; the PNG then goes through the same attach → workspace-save → gallery path as a generated image, with no native dependency added. Markup is sanitized (script/iframe/object removed, inline handlers stripped, remote URLs blanked), the page carries a `default-src 'none'` CSP, and DNS resolves to nothing for the duration. `--blink-settings=scriptEnabled=false` was deliberately left out: it makes Edge exit 0 while writing no screenshot at all.

**Limitations.** A Chromium-family browser must exist on the machine; the canvas is explicit — no auto-height or full-page capture; no JavaScript, no network, no external fonts. `docs/render-plan.md` records the design decisions and the deferred work.

## 0.16.0 — 2026-11-01

**Added.** An agent preset, **Arya Image** (`arya-image`), registered by the bundle. It keeps the core DSH working set and this plugin's six tools, and masks the tools every other mounted bundle registers.

- The mask row (`dsh-arya-image-gen/agent-toolset`) applies `ctx.tools.restrict({ allow })` in the preset's own scope, so the other bundles' schemas are not sent on every request.
- An `agentPreset` config field (default `true`) stops registering the preset.

**How it works.** The image tools come from this bundle's host row, so they are host-wide registrations; the preset whitelists them rather than re-mounting the plugin, which would double-register its routes and tools. `ask_user_question` and `present` are mounted as preset rows because the base bundle does not provide them. The allow list is filtered against the live registry before `restrict()` is called, because that call refuses names the host does not register, and any failure leaves the session unmasked rather than without tools.

**Limitations.** Presets are not sandboxes: masked tools remain executable on the host. A preset edited in the Web editor replaces the whole row list, and later plugin updates do not merge into the edited copy. The preset is chosen per session; existing sessions keep the one they recorded.

## 0.15.0 — 2026-11-01

**Added.** Live progress in the chat card.

- While `generate_image` or `edit_image` runs, its keyed tool card renders the live job: phase, elapsed time, current node, step bar, active workflow, and a preview thumbnail when ComfyUI emits frames. The card becomes the normal image result when the tool settles — no extra row and no duplicated image.
- The host registers chat tool jobs under a deterministic id derived from the tool call id, so the card can follow its own generation even with several calls in one turn.

**How it works.** The plugin already owns the chat card through the keyed `tool.call.toolview` slot. The running phase (`phase: 'start'` with `callId`) was previously ignored; it now polls `/plugins/dsh-image-gen/progress/<jobId>` and renders the same data as the Studio panel.

**Limitations.** A tool card replaced by progress is not an assistant message, so side-channel chatter still cannot be injected mid-call; previews require ComfyUI to emit latent frames; hidden model reasoning is still not exposed.

## 0.14.0 — 2026-11-01

**Added.** Generation insight: telemetry and live progress.

- Result provenance in the tool output, image card, Studio item and gallery record: workflow, pixel dimensions, seed, queue wait, execution time, total time, queue position, and ComfyUI version.
- Live job telemetry from ComfyUI's WebSocket: queue position, current node (read from the workflow's `class_type`), step `value/max`, elapsed time, and the latest latent preview frame when the server emits one.
- `GET /plugins/dsh-image-gen/progress/<jobId>` snapshot, SSE stream, preview image, and `POST .../cancel`. A Studio progress panel with a step bar, node label, elapsed timer, optional preview thumbnail, and a Cancel button that removes the prompt from ComfyUI's queue (`/queue` delete plus `/interrupt` when the job is executing).

**Changed.** The Studio request carries a client-generated `jobId`, and the ComfyUI submission uses it as `client_id` so progress events and the WebSocket match the job. Studio generations report the timings they measured, and `output` lines now include size, seed, queue, run and version.

**Limitations.** Progress is best-effort: a blocked WebSocket upgrade (common behind header-authenticated proxies) falls back to elapsed time only, and generation is unaffected. Preview frames appear only when ComfyUI is configured to emit them.

## 0.13.0 — 2026-11-01

**Changed.** Mode-first Studio: the Studio no longer asks which workflow to run, the mode decides.

- **Text to image** runs the active/default workflow automatically; **Image to image** runs an edit-capable workflow automatically. The workflow picker moved into a collapsed **advanced** row, and opening it overrides the choice for the session.
- Image to image is disabled when no edit-capable workflow is imported, with the reason on the button and in the panel; generation is disabled, with an explicit message, when no workflows are imported at all.
- Silent refreshes reconcile by workflow name instead of provider/channel, so a removed workflow no longer leaves a stale selection.
- Server: a Studio request with no imported workflows now fails, before any profile lookup, with "No ComfyUI workflows are imported. Import an API-format workflow JSON…".

## 0.12.2 — 2026-11-01

**Fixed.** Tolerant workflow names. `generate_image`, `edit_image` and `generate_images` accept a workflow name written with or without the `.json` extension and with different letter case.

- Imported labels drop the file extension, so a tool call that used the exported file name previously failed with "No ComfyUI workflow named …".
- Tests cover the suffix and casing variants.

## 0.12.1 — 2026-11-01

**Fixed.** Prompt-context compatibility: every agent turn failed on AryaCode 0.2 while the plugin was enabled, with `This turn failed: unknown prompt variable "{{image}}" in context "dsh-image-gen:image-defaults"`.

- AryaCode 0.2 interpolates `{{name}}` variables in system-prompt context text, and an unknown variable aborts the turn; the image-tools context described the workflow image placeholder with literal double braces.
- The system-prompt context never contains literal double braces now, and dynamic values interpolated into context — active workflow name, canvas text and prompts — are escaped, so user-drawn text such as `{{x}}` cannot break a turn.

Tests cover both contexts.

## 0.12.0 — 2026-11-01

**Added.** Remote ComfyUI support.

- Any reachable `http(s)` endpoint: generation, editing and status use it without a local installation.
- A `Request headers` setting (a JSON object) applied to every ComfyUI request, for reverse-proxy tokens, Basic auth or API gateways. Reverse-proxy subpaths work because API paths resolve relative to the configured endpoint, so `https://example.com/comfy/` is valid.
- Connection errors are actionable: they name the URL and give a remote-server checklist (listen address, firewall, credentials, TLS).

**Changed.** For a non-local endpoint the settings card hides Start/Stop/Restart and the Python/ComfyUI path fields and only probes status; local launch fields default to empty instead of one developer's Comfy-Desktop path; auto-start is skipped for remote endpoints. Existing local setups keep working — if Start now asks for paths, set the Python executable and ComfyUI directory once.

## 0.11.1 — 2026-11-01

**Added.** The bundle declared `dsh.engines.dsh`, so a plugin index can state a host requirement instead of "Host requirement unknown", and the first self-registered market index (`docs/market/index.json`) was published so the bundle could be installed from an index source rather than only by package name. The README gained the steps for adding that index in **Discover**. No long-form release note shipped with this version; the change is the manifest and the index.

## 0.11.0 — 2026-11-01

**Breaking.** Arya Image Gen is a fork of dsh-image-gen rebuilt around a local ComfyUI server, and the cloud providers are gone.

- Removed providers: Gemini, OpenAI, OpenAI-compatible relays, Seedream, DashScope, xAI Grok, Zhipu GLM. Removed subscription sign-in channels: ChatGPT, Grok, Google. The API-key settings, the test-connection route and the credential UI are gone, because ComfyUI needs no key.
- `generate_image`, `generate_images` and `edit_image` now take a `workflow` argument instead of provider, aspect-ratio and size options. Studio emits one profile per imported workflow, and the ratio, quality and watermark pickers are gone. Comparison mode compares workflows instead of providers.
- Every user-facing string, document and bundled inspiration entry is English.

**Added.** ComfyUI server controls in the settings card: Start, Stop, Restart, Refresh, live status with version/GPU/VRAM, a configurable Python path, ComfyUI directory, extra `main.py` arguments, and optional auto-start, behind the `POST /plugins/dsh-image-gen/comfyui-server` route (`status`, `start`, `stop`, `restart`). Studio, canvas and batch generation run through ComfyUI workflows, including edit-only workflows detected by their `{{image}}` input, and a chat composer pill switches the active workflow.

**Upgrading.** Settings carried over from upstream keep their old fields inert, and workflows must be imported again. Stop never kills other processes on the ComfyUI port — it matches ComfyUI's own `main.py` command line.

## 0.8.6 — 2026-10-08

**Fixed.** Settings on modern DSH hosts, where saving did nothing and the card reported the wrong reason.

- The `@deepseek-ai/schemastery` compatibility range is pinned to `>=3.18.4 <4` while still accepting later compatible 3.x releases.
- The plugin detects the volatile fields modern DSH needs from the schema it actually loaded. When the capability is missing it shows an explicit update prompt and blocks an invalid save, and the server logs the reason.
- The settings card distinguishes loading, a remote connection that cannot be saved, settings unavailable, read-only configuration, and incompatible dependencies, instead of one blanket "config file is read-only" message. A card that stayed disabled when the settings updated between first render and subscription is fixed.
- The old DSH settings-registration path is kept, and verification is split between Windows and Linux standalone installers.

**Update note.** Restart DSH and refresh the page after updating. Existing installs still need the actually-resolved `@deepseek-ai/schemastery` to satisfy `>=3.18.4 <4` — updating the plugin and its declared range does not replace an old dependency copy already installed.

Evidence: the report reproduces #71's old-schema save failure, and the standalone installer shows DSH 0.2.0-rc.2 with schemastery 3.18.4 saving settings and keeping them across a form reopen and a host restart, while schemastery 3.18.2 shows the explicit incompatibility prompt and blocks writes. The #68 blank-card and #70 unclickable symptoms were not reproduced in the reporter's environment, so those are not claimed resolved. Related issues: #68, #70, #71.

Note: 0.8.6 was never published to npm — it predates this package's npm history, which starts at 0.11.0. The heading date is the commit that shipped the release (2026-10-08).
