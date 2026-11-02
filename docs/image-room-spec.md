# Image Room - design and implementation spec

Status: draft for review. Scope: v1 (ComfyUI only). No source changes accompany this document.

## 1. What this is

A full-page, workspace-free **Image Room**: a ChatGPT-Images-like surface where a conversation
about a picture and the picture itself live together. One composer, one thread, one result grid,
one focused viewer.

Three properties distinguish it from the existing Gallery/Studio tabs:

1. **Chat-first.** The primary input is a sentence, answered by an image-focused agent that can
   refine a prompt, ask one question, or generate.
2. **Room-scoped.** A room is a thread with its own default workflow, aspect ratio and batch size.
   It is not attached to a DSH conversation or workspace folder.
3. **Image-only.** The agent sees an image-room system prompt and an image tool allowlist. It does
   not become a general chat surface.

## 2. Non-goals for v1

- Subscription providers (openai/google/grok channels) - ComfyUI only.
- Mobile/narrow layout below 720 px (rail collapses, no further guarantee).
- Server-side room storage or cross-device sync.
- Video/animation outputs (`inline-playback` equivalent).
- Sharing rooms by URL.
- Region-mask inpainting beyond a prompt hint (see 6.5, deferred to v2).

## 3. Reference model - what we observed

Static evidence from the ChatGPT desktop app (OpenAI.Codex 26.1027.3384), whose
`resources/app.asar` (sha256 `6fbedf05...`) ships the whole ChatGPT web client under `webview/`:

| OpenAI chunk | Role we mirror |
| --- | --- |
| `images-*` | the Images surface page |
| `generated-image-gallery-*` | result grid in a thread |
| `generated-image-tile/row/placeholder/source/output-visibility` | item rendering, skeleton, provenance |
| `chatgpt-image-lightbox-*` | focused viewer |
| `chatgpt-image-comparison-*` | before/after compare |
| `local-generated-image-side-panel-*`, `image-edit-toolbar-*`, `native-image-markup-draft-*` | side panel, region select |
| `chatgpt-image-share-*`, `copy-generated-image-to-clipboard-*` | share/copy |
| `local-image-generation-progress-*`, `image-loading-state-*` | progress and loading |

Evidence: REA `analyze_javascript_application` on 15 chunks, evidence `ev_5708af04...`
(parent `ev_90610a28...`), 69,815 AST nodes, 0 parse failures.

Documented behaviour (OpenAI Help Center "Images in ChatGPT", ChatGPT Learn "Image generation"):
sidebar `Images` destination, `Create Image`, Templates, editor with **Select / Aspect ratio /
Undo / Redo / Cancel / Save**, image controls **Copy / Save / Share**, viewer with **Focused view**
and **Canvas view**, **Comment**, **Multi-select**.

Live layout measurements (ChatGPT desktop, 1920x1032 window):

- left rail ~56 px, icon-only, `Images` is a top-level entry;
- result/template grid: 5 columns, ~272 px cards, ~14 px gutter, 12 px radius, 4:5 tiles;
- label chip bottom-left of each card;
- one floating composer over the grid: attach, model chip, mic, send.

What we deliberately do **not** copy: OpenAI assets, branding, exact copy, proprietary CSS.

## 4. Information architecture

```
/dsh-image-gen/room            (full-page view)
  |- rail: rooms list, New room, settings entry
  |- thread: turns, result grid, progress
  |- composer: prompt, reference, workflow, batch, ratio, send
  |- viewer overlay: focused image + actions + editor
  `- empty state: template grid from the inspiration catalog
```

Entry points:

1. Left rail entry `Images` (icon) in the DSH shell, when a shell slot permits it.
2. Command: `open image room`.
3. From the existing Gallery tab: "Open in Room" on any item.

Phase 0 must settle how the full-page view is mounted (see 12.1).

## 5. Screen specifications

### 5.1 Rail (264 px)

- `New room` button, accent filled, full width.
- Room rows: 40 px thumbnail (last result), title (1 line, ellipsis), relative time.
- Active row: 8% surface tint, 2 px left accent bar.
- Footer: provider chip (`ComfyUI`), workflow default, settings gear.
- Empty: single line, `No rooms yet`.

### 5.2 Thread

- Max content width 820 px, centered, 24 px vertical rhythm.
- User turn: right-aligned bubble, 0.88 max width, prompt text only, `Edit` affordance on hover.
- Agent turn: left-aligned, no bubble; short text (2-3 lines), then the result grid.
- Tool step row (when the agent calls a tool): 24 px row, icon + `Generating 4 images...` + duration
  after completion, muted; collapses on scroll like ChatGPT's "Worked for 1m 39s".
- Result grid: 1 item = full width max 520 px; 2 items = 2 columns; 3-4 = 2x2. Gutter 12 px,
  radius 12 px, aspect from the generated image.
- Tile hover: actions appear bottom-right (`Copy`, `Save`, `Edit`, `More`), 28 px icon buttons on a
  translucent bar.
- Skeleton tile: 12 px radius surface at 40% opacity with a soft shimmer, plus a status line
  `Step 3/12 - sampling` when ComfyUI progress is known.

### 5.3 Composer

- Pinned to the bottom of the thread column, 16 px inset.
- Row 1: textarea, auto-grow 1..6 lines, placeholder `Describe the image...`.
- Row 2: `+` attach reference, workflow chip, batch stepper (1-4), aspect chip, send button.
- Enter sends, Shift+Enter newline, Esc cancels a running generation.
- While running: send becomes stop, composer stays editable (queue the next prompt, do not auto-send).
- Reference attachments render as 56 px chips above the textarea with an x.

### 5.4 Focused viewer (overlay)

- Backdrop 88% opaque, click-outside and Esc close; focus trapped.
- Image centered, max 76vh, drag to pan when zoomed, `+`/`-`/`0` zoom, arrow keys prev/next.
- Top bar: room title, index `2 of 4`, close.
- Bottom action bar: `Copy`, `Save`, `Download`, `Share`, `Edit`, `Variations`, `Compare`, `Delete`.
- `Compare`: split slider against the source image of the current turn (only when the turn has a
  `sourceItemId`).
- `Variations`: re-runs the same prompt and seed-offset, appends a new turn.
- `Edit`: enters editor mode (5.5).

### 5.5 Editor mode

- Entered from a tile or the viewer. Image fills the pane, side column 320 px with:
  - `Select` toggle (brush over the image; brush size 8-96 px),
  - `Prompt` textarea,
  - `Aspect ratio` chips,
  - `Undo` / `Redo` / `Cancel` / `Generate`,
- Region semantics v1: the selection rectangle(s) are sent as a prompt hint
  (`"Change only the highlighted area: ..."`), not as a ComfyUI mask. A v2 masks through a
  `MaskComposite` node when the workflow declares one.
- Undo/redo stack is in-memory per edit session (max 50 steps).

### 5.6 Empty state

- Title `Create an image`, subtitle one line.
- Template grid: reuse `src/inspiration/data/*.json`, 5 columns, same card metrics, category chips
  on top, click fills the composer (does not auto-send).
- Recent rooms row under the grid when `rooms.length > 0`.

## 6. States and transitions

| State | Trigger | UI |
| --- | --- | --- |
| `idle` | room opened | composer enabled, thread as stored |
| `queued` | send while another turn runs | turn card at 60% with `Queued` |
| `running` | POST accepted | skeleton tiles, stop button |
| `partial` | some items failed | successful tiles stay, one error tile per failure |
| `done` | all items resolved | grid complete, tool row shows duration |
| `error` | request failed | one error tile, retry button, prompt preserved |
| `cancelled` | user pressed stop | aborted turn stays with `Cancelled`, retry available |

Rules:

- A room allows one in-flight turn; extra sends queue (max 3) and show as chips under the composer.
- Reload with an in-flight turn: mark it `interrupted` and offer retry (browser fetch cannot resume).
- Failed items never delete the turn.

## 7. Data model

IndexedDB `dsh_image_gen_db`, version 5 (from 4). Additive only; existing stores untouched.

```ts
interface RoomRecord {
  id: string                 // crypto.randomUUID()
  title: string              // first prompt, 60 chars, editable
  createdAt: number
  updatedAt: number
  lastItemId?: string        // thumbnail source
  workflow?: string          // default workflow name for this room
  count: number              // default batch size
  archived?: boolean
}

interface RoomTurnRecord {
  id: string
  roomId: string
  index: number              // monotonically increasing per room
  kind: 'generate' | 'edit'
  prompt: string
  referenceIds?: string[]    // attachment ids used as reference
  createdAt: number
  status: 'queued' | 'running' | 'done' | 'partial' | 'error' | 'cancelled' | 'interrupted'
  workflow?: string
  count: number
  aspectRatio?: string
  elapsedMs?: number
  error?: string
  sourceTurnId?: string
  sourceItemId?: string
  items: RoomItemRecord[]
}

interface RoomItemRecord {
  id: string                 // equals the gallery item id when saved
  attachment?: ImageAttachmentRef
  seed?: number
  output?: string
  savedTo?: string
  status: 'pending' | 'done' | 'error'
  error?: string
}
```

Stores: `rooms` (keyPath `id`, index `updatedAt`), `room_turns` (keyPath `id`, index
`[roomId, index]`). Every completed item is also written to the existing `gallery_history` store
with `roomId` and `turnId` added to `GalleryItem`, so Gallery, Favorites and the canvas keep working.

## 8. Host API

No new host route is required for v1. The room POSTs the existing contract:

```
POST /plugins/dsh-image-gen/studio
{
  mode: 'generate' | 'edit',
  provider: 'comfyui',
  model: <workflow name>,
  prompt: string,
  count: 1..4,
  reference?: StudioReference,
  references?: StudioReference[]
}
-> 200 StudioGenerateResponse { items[], failedCount, errors[], elapsedMs }
```

`GET /plugins/dsh-image-gen/studio` supplies `providers[].modelOptions` for the workflow chip and
`activeWorkflow` for the room default.

Streaming: the route already heartbeats newlines while the workflow runs. v1 parses the final JSON
only; the skeleton/progress state is time-based (`Step n` text is a v1.1 improvement that needs the
ComfyUI websocket progress in the host).

Save to workspace: reuse `src/workspace-save.ts` through `createImageRoomSave` (thin wrapper), writing
to `<workspace>/image-room/<room-slug>/<timestamp>-<index>.png`.

## 9. Agent profile

The room is chat-first, so a model turn precedes generation. Plan of record (A1):

- Host registers a prompt section `dsh-image-gen:image-room`, order 58, containing: the room's job
  (turn the user's intent into an image), the workflow inventory, the aspect/batch limits, the
  rule to call a tool rather than describe an image, and the rule to keep replies to one or two
  sentences.
- The room creates one DSH session per room (`metadata: { kind: 'image-room', roomId }`), so history,
  streaming and tool cards come from the harness rather than being reimplemented.
- Tool allowlist for that session: `generate_image`, `generate_images`, `edit_image`, plus the canvas
  tools only if the room surfaces the canvas.

Fallback (A2), used if the host does not expose session creation to plugins: the room's chat is a
prompt-only composer - `Generate` calls the studio route directly, and an `Enhance` button asks the
model to rewrite the prompt, with no tool loop. Phase 1 ships A2-compatible UI, Phase 2 adds A1.

## 10. Design tokens

| Token | Value |
| --- | --- |
| rail width | 264 px |
| thread max width | 820 px |
| tile gutter | 12 px |
| tile radius | 12 px |
| tile hover bar height | 32 px |
| composer radius | 24 px |
| control height | 32 px |
| label chip | 12 px font, 4/10 px padding, 6 px radius, 60% black on image |
| grid gap (templates) | 14 px |
| template columns | 5 at >=1440 px, 4 at >=1120, 3 at >=880, 2 below |

Colors come from the host theme variables already used by `studio-style.ts`; no new palette.

## 11. Interaction and keyboard

- `Cmd/Ctrl+Enter` generate, `Enter` send, `Shift+Enter` newline.
- `Esc` closes viewer, then cancels generation.
- `Cmd/Ctrl+K` room switcher.
- `J`/`K` or arrows move selection in the viewer; `Cmd/Ctrl+C` copies the current image.
- `Delete` removes the selected tile after a confirm.
- Multi-select: `Shift`+click tiles, then `Comment` opens one textarea for the selection; sending
  produces one edit turn carrying all selected ids as references.

## 12. Risks and open items

12.1 **Full-page seam.** The plugin currently registers only `conversation.view`
(`src/client/index.tsx:842`) and `sidebar.right.pane.tab` (`:881`). The installed DSH client
packages do not publish a `page`/`route` slot key. Phase 0 proves one of: a shell slot for a
top-level page, a client route API, or a full-viewport overlay mounted from a slot with its own
`history` entry.

12.2 **Session creation from a plugin** for the A1 agent. Needs verification in the host API.

12.3 **Progress granularity.** ComfyUI websocket progress is not exposed through the current route;
v1 shows elapsed time and an indeterminate shimmer.

12.4 **Reference images.** `StudioReference` exists; the room's drag-drop must encode through the
same path as Studio so ComfyUI `LoadImage` keeps working.

12.5 **Localization.** All strings go through the `COPY` table pattern already used in
`studio-view.tsx:61`; English first, no hardcoded strings in components.

## 13. Acceptance criteria (v1)

1. A room can be created, titled from its first prompt, renamed and deleted; state survives reload.
2. Sending a prompt with count 1-4 renders N tiles, each resolving or failing independently.
3. Cancel leaves a `cancelled` turn and never loses the prompt.
4. Clicking a tile opens the viewer; `Save` writes a file under `image-room/<room>/`.
5. Variations produce a new turn linked to the source turn.
6. Templates fill the composer without generating.
7. Gallery tab shows room images with their room id, and deleting a tile in the room tombstones it.
8. Keyboard-only operation: create room, generate, open viewer, close viewer.
9. No regression: existing Gallery, Studio, Inspiration, canvas and tool cards behave identically.
10. `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## 14. Delivery phases

| Phase | Deliverable | Gate |
| --- | --- | --- |
| 0 | seam spike: full-page mount + URL + back navigation | works in the running GUI |
| 1 | store v5 + room shell + rail + read-only history | rooms persist |
| 2 | composer + generate via studio route + result grid | one real ComfyUI run |
| 3 | focused viewer + copy/save/download/delete | actions verified |
| 4 | variations + compare | linked turns |
| 5 | editor mode (region hint + aspect) | edit turn lands |
| 6 | templates empty state + recent rooms | catalog reuse |
| 7 | agent profile A1 (session per room) | chat turn with tool call |
