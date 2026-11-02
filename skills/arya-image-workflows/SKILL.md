---
name: arya-image-workflows
description: Choose the right ComfyUI workflow in Arya Image Gen instead of inheriting whatever was active. Use when a request implies a specific task or look - cutout, background removal, editing an existing image, a particular aspect ratio - or when generate_image/edit_image fails because a workflow cannot do what was asked.
---

# Choosing a workflow

**ComfyUI is the default route.** Use `generate_image`, `generate_images` and
`edit_image` for every image request unless the user asks for another route or
the picture is really a layout job — exact, legible text, tables, a poster whose
words must be perfect — in which case `render_html` beats a diffusion model. Do
not reach for HTML or SVG because they feel safer.

If a ComfyUI call fails with a connection error, the server is down or
unreachable: say so and offer to start it (Settings → Plugins → Arya Image Gen →
Server → **Start**; on the machine that runs it, a Windows scheduled task or the
Python path in that card). Do not silently produce the image another way.

The plugin already picks by role: generation resolves the active text-to-image
workflow, `edit_image` resolves the active image-to-image one. Role is not the
same as *intent*, though — two text-to-image workflows can differ in model, speed
and output, and only you can tell which the user asked for.

## Look before you pick

`list_workflows` reports every configured workflow with:

- `role` — text-to-image or image-to-image,
- `adjustable` — whether a call may set width, height, steps, cfg,
- `bakedSize` — the fixed size when it takes no size parameters,
- `active` — what that role would pick without being named.

Call it when the request names a task ("cut out the subject"), a size, or a
tradeoff ("fast draft"). Skip it for an ordinary prompt on the defaults.

## Matching intent

| the user asks for | pass |
|---|---|
| a picture from a description | nothing — the active text workflow is right |
| a specific aspect ratio or size | `width`/`height`, if that workflow is `adjustable`; otherwise name an adjustable workflow or say it is fixed |
| a cutout / transparent subject | the cutout workflow by name |
| background removal from their image | the remove-background workflow, with `edit_image` |
| "edit / restyle / change this photo" | `edit_image`; the edit workflow is chosen for you |
| "put this chair in my living room", "this product on that table" — a subject plus a scene | the compose workflow, with both references in order |
| speed over detail | the fastest workflow, named explicitly |

## Several references at once

A workflow that declares `{{images}}` takes any number of references, in the
order you pass them; a workflow with `{{image}}` takes exactly one and refuses
extras with a message that names the fix. Hand the compose workflow its images
in the order you describe them — subject first, scene second:

```
edit_image(workflow="Qwen Image 2.1 - compose (any number of references)",
           source_paths=["…/references/chair.jpg", "…/references/living-room.jpg"],
           prompt="Keep the chair's shape, fabric and colour from image 1 exactly; place it in the room of image 2 on the floor by the window, matching that room's light and shadow. Do not restyle the chair.")
```

Two or three references is the useful range; more inputs dilute the identity you
asked to keep, and the encoder stops at 16 slots.

## Rules

- **Name workflows that `list_workflows` reported.** A made-up name fails.
- **Never name a workflow from the other role.** `edit_image` needs one with an
  `{{image}}` input; naming a text workflow produces an error that names the
  right one.
- **Do not pass size parameters to a workflow that bakes size.** The error says
  so; either drop them or name an adjustable workflow.
- **Say which one you used** in your reply when it was not the default, and why —
  the user cannot see the choice otherwise.
- If no workflow matches what was asked (no cutout configured, say), say that and
  offer the closest alternative instead of silently producing something else.
