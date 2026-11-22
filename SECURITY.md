# Security Policy

## Reporting a problem

Report it privately through [GitHub private vulnerability reporting](https://github.com/KonnectSuite/dsh-arya-image-gen/security/advisories/new) on this repository. Do not open a public issue: an issue that quotes a working endpoint, a header, or a saved configuration is itself the disclosure.

Tell us the DSH version, the plugin version, how your ComfyUI endpoint is reachable (loopback, LAN, VPN, reverse proxy), and what you saw. Only the latest published version is supported; a fix ships in the next release rather than on a fixed date.

## What this plugin can hold

There is no credential store and no key field. ComfyUI on a local endpoint authenticates nothing, and this plugin asks for nothing: no sign-in, no provider key, no subscription.

The one secret it can hold is a **request header you choose to type** — an `Authorization` token for a reverse-proxied ComfyUI. That value is stored like every other plugin setting: in the profile's configuration file on disk, in plain text, readable by anything that can read your DSH home directory. Do not add a token for an endpoint that other people can reach, and do not reuse a token that grants anything else.

Settings also record the endpoint URL and any workflow JSON you import. A workflow is a program: importing a graph runs it on your ComfyUI server, and a custom node in that graph can run arbitrary code on the machine hosting ComfyUI. Import graphs from sources you trust, the same way you would install a Python package.

## Network surface

The plugin opens no listening port. It registers routes on the DSH host's own web server, all under `/plugins/dsh-image-gen/` (image, import, delete, studio, inspiration, save-workspace, comfyui-server, progress, settings-health, canvas-state, canvas-asset, check-workflows). Those routes are same-origin and the browser calls them with `credentials: 'same-origin'`; generated and uploaded images go through the DSH Attachment service, which validates media type and size on the way in and on the way out. Anyone who can reach your DSH host's port can already reach everything those routes can do — the plugin does not widen who can get in, and it is not a substitute for keeping that port private.

Outbound, the plugin talks to one place: the ComfyUI endpoint you configured. Your prompts, reference images and workflow JSON go there. If that endpoint is someone else's server, treat it as untrusted infrastructure: it sees your prompts and can return any image, including one with text the model then reads.

## Remote ComfyUI, deliberately

Pointing the plugin at ComfyUI on another machine is supported, and ComfyUI itself has no authentication. That is the risk you accept:

- Bind it to a VPN interface or a tunnel (Tailscale, WireGuard, an SSH tunnel), not to a public address. `--listen 0.0.0.0` on a machine with a public interface exposes an unauthenticated code-execution surface.
- If you do put it behind a reverse proxy, enforce authentication and TLS there, and keep the origin bound to loopback.
- Self-signed certificates are rejected by the DSH host. Use a trusted certificate, or plain HTTP inside a VPN.

## Server control

The Start / Stop / Restart buttons act on a local ComfyUI this plugin did not create, and the stop path targets only a Python process whose command line runs ComfyUI's `main.py` on the configured port. A different listener on that port — a container, a proxy, another application — is never touched. Against a remote endpoint the buttons are hidden, because they would act on the wrong machine.

## Reference images fetched from the web

`import_reference_image` downloads one public image into the session workspace so the agent can edit a real subject. It refuses URLs that resolve to private or loopback addresses, refuses anything that is not a real PNG, JPEG, WebP or GIF, refuses URLs carrying credentials, and caps the download. An image that lands in the workspace is model-readable: text drawn inside a fetched picture is untrusted content, exactly like text scraped from a web page. The plugin's own rules tell the agent not to reproduce a living private person's likeness or pass off a competitor's mark, but that is policy, not a technical block.

## Out of scope

ComfyUI itself, its custom nodes, and the model files you download are not this project's supply chain. A vulnerability in a custom node belongs to that node's repository; tell us as well if it changes what this plugin can safely do.
