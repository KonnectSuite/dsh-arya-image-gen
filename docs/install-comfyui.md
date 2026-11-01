# Installing ComfyUI for Arya Image Gen

This plugin is a client: it needs a ComfyUI that you run. This page covers
getting one, then connecting it, with a bias toward the paths that actually work
for a local install on Windows, macOS and Linux.

Source: the official ComfyUI guide,
[Comfy-Org/ComfyUI#installing](https://github.com/Comfy-Org/ComfyUI#installing).
Commands and version floors below were taken from it and trimmed to what this
plugin needs; when the two disagree, the official page wins.

## Pick a route

| route | best for | notes |
|---|---|---|
| **Desktop app** | most people on Windows/macOS | https://comfy.org/download — bundles Python, torch and the frontend |
| **Windows portable** | a self-contained Windows folder, NVIDIA/AMD/Intel GPU or CPU | unzip and run; not recommended for regular users |
| **comfy-cli** | scripted or repeatable installs, any OS | `pip install comfy-cli` then `comfy install` |
| **Manual** | custom torch builds, unusual GPUs | needs Python 3.13 (3.12 if a custom node complains) |

For Arya Image Gen all four are equivalent — the plugin only needs an HTTP
endpoint (`http://127.0.0.1:8188` by default) and, for the bundled workflows, the
Qwen Image 2.1 model files.

## Desktop app (Windows, macOS)

Download from https://comfy.org/download and run it. ComfyUI starts on
`127.0.0.1:8188`, which is exactly what this plugin defaults to.

## Windows portable

1. Download the build for your GPU:
   [NVIDIA](https://github.com/comfyanonymous/ComfyUI/releases/latest/download/ComfyUI_windows_portable_nvidia.7z) ·
   [AMD](https://github.com/comfyanonymous/ComfyUI/releases/latest/download/ComfyUI_windows_portable_amd.7z) ·
   [Intel](https://github.com/comfyanonymous/ComfyUI/releases/latest/download/ComfyUI_windows_portable_intel.7z) ·
   [NVIDIA cu126 build for 10-series and older](https://github.com/comfyanonymous/ComfyUI/releases/latest/download/ComfyUI_windows_portable_nvidia_cu126.7z)
2. Extract with 7-Zip (or Explorer) and run the launcher.
3. If it will not start, update the NVIDIA driver first — the portable ships
   Python 3.13 with a recent CUDA build.
4. If extraction is blocked: right-click the file → Properties → Unblock.

Models go under `ComfyUI\models\` in the matching subfolder (see
[Where models go](#where-models-go)).

## comfy-cli

```bash
pip install "comfy-cli>=1.14.0"
comfy install
comfy launch
```

This is also the engine behind the optional **comfy-mcp** server, so a machine
set up this way can add MCP later without a second install.

## Manual install

```bash
git clone https://github.com/comfyanonymous/ComfyUI
cd ComfyUI
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python main.py
```

Install PyTorch **before** the requirements when your GPU needs a specific
build:

| hardware | command |
|---|---|
| NVIDIA (20-series and newer) | `pip install torch torchvision torchaudio --extra-index-url https://download.pytorch.org/whl/cu130` |
| NVIDIA nightly | `pip install --pre torch torchvision torchaudio --index-url https://download.pytorch.org/whl/nightly/cu132` |
| AMD, Linux | `pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/rocm7.2` |
| AMD, Windows (ROCm 10.0) | `pip install --index-url https://stable.repo.amd.com/rocm/whl-next/ "torch[device-all]==2.13.0+rocm10.0.0" "torchvision[device-all]==0.28.0+rocm10.0.0" "torchaudio==2.11.0.2+rocm10.0.0"` |
| Intel Arc (XPU) | `pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/xpu` |
| Apple silicon | PyTorch nightly per Apple's Metal guide, then the same manual steps |

`Torch not compiled with CUDA enabled` means the wrong wheel: `pip uninstall torch`
and reinstall with the command for your card.

Python: 3.13 is well supported. 3.14 works but some custom nodes break; 3.12 is
the fallback when a node's dependencies refuse a newer interpreter.

## Where models go

The bundled Qwen Image 2.1 workflows expect these files:

| file | folder |
|---|---|
| `qwen_image_2.1_turbo_int8_convrot.safetensors` | `models/diffusion_models/` |
| `qwen3vl_8b_w4a8.safetensors` | `models/text_encoders/` |
| `qwen_image_2.1_vae_bf16.safetensors` | `models/vae/` |

Classic checkpoints go in `models/checkpoints/`, LoRAs in `models/loras/`,
upscalers in `models/upscale_models/`. If you already keep models for another UI,
point ComfyUI at them with `extra_model_paths.yaml` (copy
`extra_model_paths.yaml.example`, rename it, edit the paths) instead of
duplicating hundreds of gigabytes.

## Run it

```bash
python main.py
# or, with the manager for installing custom nodes:
python main.py --enable-manager
```

Open `http://127.0.0.1:8188`. To expose it to another machine, do not just add
`--listen 0.0.0.0` — ComfyUI has no authentication. Use a reverse proxy with TLS
and a token (the plugin's **Request headers** setting carries it), or a private
network such as Tailscale.

## Connect Arya Image Gen

1. **Settings → Plugins → Arya Image Gen**, set the endpoint. Default
   `http://127.0.0.1:8188`; for `--listen` on another host use that host's URL and
   add headers if a proxy needs them.
2. Start / Stop / Restart in the same card drives a **local** server that
   comfy-cli-style launching owns; a server you started yourself is probed, not
   killed.
3. The four shipped workflows are already configured (or prefill on a fresh
   install). Press **Check against ComfyUI** — it reports missing node classes and
   model files by name before a generation fails.
4. First generation: ask for an image with no size (defaults 1024x1024), then one
   at another size, then an edit.

## Hardware, honestly

The plugin's bundled workflows are tuned for Qwen Image 2.1 Turbo (int8) on a
consumer GPU.

- **24 GB+ VRAM**: local generation is a good default, video included.
- **8–24 GB**: images are comfortable; video is slow or will not fit.
- **under 8 GB**: expect OOM on the bundled workflows; use a smaller model or
  Comfy Cloud.

Model choice should follow the templates rather than a habit — check
https://comfy.org/workflows for what is current for your card.

## Troubleshooting

| symptom | cause | fix |
|---|---|---|
| generation fails with a connection error | ComfyUI is not running, or the endpoint is wrong | start it, then re-check the URL |
| `Check against ComfyUI` names a missing node class | the install (or a custom node pack) is older than the workflow | update ComfyUI, or install the pack it names |
| it names a missing model | the safetensors file is absent or in the wrong folder | put it in the folder from [Where models go](#where-models-go) |
| generation hangs then fails | the workflow needs more VRAM than is free | close other GPU users, or reduce the size |
| everything works but output looks off at non-square sizes | an old workflow without `{{resolution}}` | re-import the shipped create workflow |
