---
name: install-arya-image-gen
description: Install, configure, verify, or remove the dsh-arya-image-gen Bundle (ComfyUI-only image generation) in a DeepSeek Harness Web profile. Use when a user wants local ComfyUI image generation in DSH, cannot find the image settings card, needs to import a ComfyUI API workflow, or needs help starting the ComfyUI server.
---

# Install Arya Image Gen

1. Confirm `dsh` runs and record `dsh --version`.
2. Ask which Web profile to change if the user did not name one. Default to `web` only when that profile already exists.
3. Install the pinned package or repository spec the user provides:

   ```sh
   dsh plugin --profile <profile> add dsh-arya-image-gen
   ```

4. If pnpm blocks the Git dependency's `prepare` script, explain that the allowance executes repository code during installation. Add only the exact package key pnpm reports to the profile's `pnpm-workspace.yaml`, then retry after the user approves.
5. Verify `dsh --profile <profile> --dump-config` contains the `dsh-arya-image-gen` layer and `image-gen` row.
6. Start the profile. If its port is already in use, identify the existing DSH process before stopping anything.
7. Open the Plugins panel from the left sidebar, click Arya Image Gen under Installed, and on the plugin page:
   - Set the ComfyUI endpoint (default `http://127.0.0.1:8188`).
   - Import a ComfyUI API-format workflow JSON containing `{{prompt}}` (and `{{image}}` for editing).
   - Import the workflows, then mark the active one.
   - Use Start / Stop / Restart to control the local ComfyUI process, or configure the Python path, ComfyUI directory, extra arguments, and auto-start.
8. Test with a simple prompt. Confirm one `generate_image` call succeeds and its image renders in the conversation.

For removal, run `dsh plugin --profile <profile> remove dsh-arya-image-gen`. Do not delete the user's ComfyUI installation or gallery data unless they explicitly request it.
