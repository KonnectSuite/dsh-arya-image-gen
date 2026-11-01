---
name: arya-image-workflows
description: Choose the right ComfyUI workflow in Arya Image Gen instead of inheriting whatever was active. Use when a request implies a specific task or look - cutout, background removal, editing an existing image, a particular aspect ratio - or when generate_image/edit_image fails because a workflow cannot do what was asked.
---

# Choosing a workflow

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
| speed over detail | the fastest workflow, named explicitly |

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
