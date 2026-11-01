# ComfyUI workflows: roles, placeholders and sizes

The Workflows card groups imports by what they do, and a workflow can expose
the settings a call is allowed to change. Both exist for one reason: you should
not need a separate JSON per size.

## Roles

Every workflow is **Text to image** or **Image to image**.

- A workflow whose JSON contains `{{image}}` needs a source image, so it is
  image-to-image. Everything else is text to image.
- Each group keeps its own active workflow: generation uses the active text
  workflow, `edit_image` uses the active edit workflow. You no longer switch a
  single radio before editing.
- The role is detected on import and can be overridden with **Auto role** in
  the row if a graph is unusual.

The old single `comfyuiActiveWorkflow` still seeds the text slot, so existing
configs keep generating after the upgrade.

## Placeholders

Substitution happens before the workflow is sent to ComfyUI.

| placeholder | type | range | typical target |
|---|---|---|---|
| `{{prompt}}` | text | — | `CLIPTextEncode.text` (required) |
| `{{seed}}` | integer | 32-bit | `KSampler.seed` |
| `{{image}}` | file name | — | `LoadImage.image` (at most one) |
| `{{width}}` | integer | 64–8192 | `EmptyLatentImage.width` |
| `{{height}}` | integer | 64–8192 | `EmptyLatentImage.height` |
| `{{steps}}` | integer | 1–150 | `KSampler.steps` |
| `{{cfg}}` | number | 0–30 | `KSampler.cfg` |

Rules that matter:

- A **numeric** placeholder must be the *entire* value of its field
  (`"width": "{{width}}"`). It is injected as a real number. Putting it inside a
  longer string is rejected at import, naming the node and input.
- If a workflow declares a numeric placeholder, every call must supply that
  value. Omitting it is an error, never a silent default.
- Asking for a value the workflow bakes is also an error — the message names the
  placeholder to add.
- `{{prompt}}` and `{{seed}}` may appear inside longer strings, as before.

## One workflow instead of three

A typical Qwen Turbo export ships as three files that differ only by canvas:

| file | width × height |
|---|---|
| `Turbo_Square_1024` | 1024 × 1024 |
| `Turbo_Portrait_768x1344S` | 768 × 1344 |
| `Turbo_Wide_1344x768` | 1344 × 768 |

Open one of them in a JSON editor, find the `EmptyLatentImage` node, and
replace the two numbers:

```json
"5": {
  "class_type": "EmptyLatentImage",
  "inputs": { "width": "{{width}}", "height": "{{height}}", "batch_size": 1 }
}
```

Import that single file. It now renders any size:

```json
{ "template": "turbo", "prompt": "a sunlit cat", "width": 1344, "height": 768 }
```

…from the chat tools, or with the **Size** presets in the Studio workbench
(Square 1024, Portrait 768×1344, Wide 1344×768, or any width/height you type).
Then remove the two variants you no longer need.

Do the same for `steps` / `cfg` if you want the agent to tune sampling.

## What to keep

- **One text-to-image workflow** with `{{width}}`/`{{height}}` (and optionally
  `{{steps}}`/`{{cfg}}`) replaces the whole size family.
- **One image-to-image workflow** for edits — `{{image}}` is what makes editing
  possible at all.
- Keep a separate graph only when it is genuinely different: an RGBA cutout, a
  background remover, a different model. If two files produce the same kind of
  output at the same size, one of them is redundant and the import summary says
  so.

## Reading the import summary

After an import the card reports what it understood:

- the detected role,
- `adjustable size`, `steps`, `cfg` when placeholders exist,
- `baked 1024×1344` when nothing is adjustable,
- a warning when a workflow with the same role and size is already imported.

## Error messages you may see

| message | meaning |
|---|---|
| “This workflow bakes width” | the call asked for a size the JSON hard-codes; add `{{width}}` or pick another workflow |
| “This workflow declares {{width}}” | the placeholder exists but the call supplied no value |
| “must be the whole value of a numeric input” | the placeholder was embedded in a string |
| “that workflow is text-to-image; this call needs image-to-image” | a named `workflow` argument does not match the tool |
