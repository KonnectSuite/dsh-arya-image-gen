/** Real profile/settings integration for the packed tarball: the installed card
 * writes through the host's settings service, and nothing here talks to ComfyUI. */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire, registerHooks } from 'node:module'
import React from 'react'
import { act, create } from 'react-test-renderer'
import { boot, initProfile, readProfilePatches } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings from '@deepseek-ai/dsh-settings'

const home = dirname(fileURLToPath(import.meta.url))
const version = process.argv[2]
const legacy = version === '3.18.2'
const pluginURL = import.meta.resolve('@aryacode/dsh-arya-image-gen')
if (legacy) {
  // Simulate a profile resolving an older schemastery copy. The actual
  // published 3.18.2 is loaded only by the installed plugin; the host stays 0.2.
  registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/schemastery' && context.parentURL === pluginURL) {
      return nextResolve('schemastery-legacy', context)
    }
    return nextResolve(specifier, context)
  } })
}
const plugin = await import('@aryacode/dsh-arya-image-gen')
// The package rename must not move anything the user owns: the host registers
// this bundle under its plugin id, and that id is the settings namespace and the
// route prefix. A renamed tarball that changed it would silently orphan the
// saved settings, workflows, and gallery of every existing install.
assert.equal(plugin.name, 'dsh-image-gen', 'The host plugin id must survive the package rename')
assert.equal(typeof plugin.apply, 'function', 'The installed bundle must expose a host entry')
// The Arya Image agent preset mounts this subpath by module id; a broken export
// would surface only as a failed session create, so check it while packed.
const toolset = await import('@aryacode/dsh-arya-image-gen/agent-toolset')
assert.equal(typeof toolset.apply, 'function', 'The agent-toolset subpath must expose its host entry')
assert.deepEqual(toolset.inject, ['tools'], 'The agent-toolset subpath must inject only tools')

const profileDir = join(home, `profile-${version}`)
initProfile(profileDir, ['test-settings-bundle'])
const bundle = join(profileDir, 'node_modules', 'test-settings-bundle')
await mkdir(bundle, { recursive: true })
await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: 'test-settings-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
await writeFile(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
  { id: 'config-editor', name: 'cordis:editor' },
  { id: 'settings', name: 'cordis:settings' },
  { id: 'image-gen', name: 'cordis:image', config: { comfyuiBaseURL: 'http://127.0.0.1:8188', saveToWorkspace: true } },
] }]))
await writeFile(join(profileDir, 'cordis.yml'), '[]\n')
const profile = {
  name: 'test', startedBundles: ['test-settings-bundle'], dir: profileDir,
  patchPath: join(profileDir, 'cordis.patch.yml'), installAnchor: join(home, 'package.json'),
  cwd: home, home, overlays: [], telemetryDisabledEnv: undefined,
}
const SERVER_ROUTE = '/plugins/dsh-image-gen/comfyui-server'
const DOWN = {
  up: false, managed: false, pids: [], baseUrl: 'http://127.0.0.1:8188', busy: false,
  launchMode: 'auto', effectiveLaunch: 'external', taskName: 'ComfyUI',
  launchHint: 'No scheduled task named ComfyUI was found on this machine.',
}
const UP = { ...DOWN, up: true, version: '0.3.40', device: 'cuda:0 (NVIDIA GeForce RTX 4090)' }
let serverPayload = { status: DOWN }
let routes, registeredRoutes, registeredTools, serverRequests

async function start() {
  routes = new Map()
  registeredRoutes = new Set()
  registeredTools = new Set()
  serverRequests = []
  return boot('test', join(profileDir, 'cordis.yml'), readProfilePatches('test', profile), ctx => {
    ctx.provide('profileContext', profile)
    ctx.provide('appReady', { onReady: listener => { listener(); return () => {} } })
    // Only the image transport and the ComfyUI process manager are inert. The
    // Loader, ConfigEditor and Settings services, schema resolution, tool
    // registration, route registration, disk writes and restart are real.
    ctx.provide('tools', { register: tool => { registeredTools.add(tool.name); return () => registeredTools.delete(tool.name) } })
    ctx.provide('credentials', { resolve: async () => undefined })
    ctx.provide('attachments', { imageLimits: { maxImageBytes: 10_000_000, mediaTypes: ['image/png'] } })
    ctx.provide('webServer', { register: route => {
      registeredRoutes.add(route.path)
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    } })
    Object.assign(ctx.loader.builtins, { editor: ConfigEditor, settings: Settings, image: plugin })
  })
}

const require = createRequire(import.meta.url)
const source = await readFile(join(dirname(fileURLToPath(pluginURL)), 'client.js'), 'utf8')
let client, loaderId
const browser = new EventTarget()
browser.__ModuleLoader__ = { load: entry => { loaderId = entry.id; client = entry.factory(require) } }
new Function('window', source)(browser)
assert.equal(loaderId, '@aryacode/dsh-arya-image-gen', 'The browser bundle must mount under the renamed package id')
assert.equal(typeof client.ImageGenerationSettingsCard, 'function', 'The installed browser bundle must export the settings card')

function text(node) {
  if (Array.isArray(node)) return node.map(text).join('')
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  return typeof node === 'object' ? text(node.children) : String(node)
}
async function waitFor(check) {
  const deadline = Date.now() + 10_000
  while (!check()) {
    assert.ok(Date.now() < deadline, 'The actual card did not settle')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  }
}
function health(ctx) {
  let result
  const route = routes.get('/plugins/dsh-image-gen/settings-health')
  assert.ok(route, 'The installed plugin must register diagnostics')
  route.handler({ method: 'GET' }, { setHeader() {}, end: body => { result = JSON.parse(body) } })
  return result
}
// Exercise real effects and hooks. Only the browser transport is replaced: the
// status payload never comes from a live ComfyUI, and no image API exists here.
globalThis.fetch = async (url, options) => {
  const path = new URL(url, 'http://profile.invalid').pathname
  assert.equal(path, SERVER_ROUTE, 'The test must not call ComfyUI, an image API, or a login API')
  const method = options?.method ?? 'GET'
  if (method === 'POST') {
    serverRequests.push(JSON.parse(options.body))
    return new Response(JSON.stringify({ status: { ...DOWN, busy: false }, error: 'The scheduled task named "ComfyUI" was not found on this machine.' }))
  }
  assert.equal(method, 'GET')
  return new Response(JSON.stringify(serverPayload))
}

const renderers = new Set()
async function card(ctx) {
  const read = () => {
    const section = ctx.settings.describe().find(row => row.ns === 'image-gen')
    return { value: section?.value, writable: true, status: section ? 'ready' : 'unavailable', mode: 'host' }
  }
  let snapshot = read()
  const listeners = new Set()
  const props = {
    scope: {
      getSnapshot: () => snapshot,
      subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
      set: async (field, value) => {
        await ctx.settings.mutate('image-gen', [{ op: 'set', path: [field], value }])
        snapshot = read()
        for (const listener of listeners) listener()
        return true
      },
    },
    credentials: { describe: async () => ({ ok: true, value: {} }), set: async () => { throw new Error('This test must not save credentials') } },
    credentialsAvailable: () => true,
    locale: { getSnapshot: () => ({ active: 'en' }) },
  }
  let renderer
  await act(async () => { renderer = create(React.createElement(client.ImageGenerationSettingsCard, props)) })
  renderers.add(renderer)
  const saved = () => ctx.settings.describe().find(row => row.ns === 'image-gen')?.value ?? {}
  /** The card's fields are labelled <span>s inside a <label>; the label owns the input. */
  const field = label => {
    const owner = renderer.root.findAll(node => node.type === 'label' && text(node).startsWith(label))
      .find(node => node.findAllByType('input').length > 0 || node.findAllByType('select').length > 0)
    assert.ok(owner, `Missing field "${label}"; rendered labels: ${JSON.stringify(renderer.root.findAll(node => node.type === 'label').map(node => text(node).slice(0, 40)))}`)
    return owner.findAllByType('input')[0] ?? owner.findAllByType('select')[0]
  }
  const checkbox = label => {
    const owner = renderer.root.findAll(node => node.type === 'label' && text(node).includes(label)
      && node.findAllByType('input').some(input => input.props.type === 'checkbox'))[0]
    assert.ok(owner, `Missing checkbox "${label}"`)
    return owner.findAllByType('input').find(input => input.props.type === 'checkbox')
  }
  const edit = async (element, value) => { await act(async () => { element.props.onChange({ target: { value } }) }) }
  const toggle = async (element, next) => { await act(async () => { element.props.onChange({ target: { checked: next } }) }) }
  const blur = async element => { await act(async () => { element.props.onBlur?.({ target: element }) }) }
  const click = async element => { await act(async () => { element.props.onClick() }) }
  // The status <p> carries "dsh-ig-status dsh-ig-status-error" when the message is an error.
  const errors = () => renderer.root.findAll(node => String(node.props?.className ?? '').includes('dsh-ig-status-error'))
  const body = () => text(renderer.root.findAll(node => node.props?.className === 'dsh-ig-body')[0])
  const close = async () => { await act(async () => { renderer.unmount() }); renderers.delete(renderer) }
  return { renderer, saved, field, checkbox, edit, toggle, blur, click, errors, body, close }
}

let ctx
try {
  ctx = await start()
  assert.deepEqual(health(ctx), { settings: 'live', liveSchema: !legacy })
  // The renamed tarball must still register the routes the client calls and the
  // eight model-facing tools; the Arya Image preset reads the same names.
  for (const path of [SERVER_ROUTE, '/plugins/dsh-image-gen/settings-health', '/plugins/dsh-image-gen/studio', '/plugins/dsh-image-gen/canvas-state']) {
    assert.ok(registeredRoutes.has(path), `The installed plugin did not register ${path}`)
  }
  assert.deepEqual([...registeredTools].sort(), ['canvas_state', 'edit_image', 'find_inspiration', 'generate_image', 'generate_images', 'import_reference_image', 'list_workflows', 'view_canvas'].sort())

  const form = await card(ctx)
  for (const section of ['Connection', 'Server', 'Workflows', 'Workspace']) {
    assert.ok(form.body().includes(section), `The card must show a ${section} section`)
  }
  await waitFor(() => form.body().includes('Not running'))

  if (legacy) {
    // The volatile() marker degrades to a plain schema, so the host refuses the
    // write. What matters is that the card says so instead of faking a save.
    const endpoint = form.field('Endpoint')
    await form.edit(endpoint, 'http://legacy.example:8188')
    await form.blur(endpoint)
    await waitFor(() => form.errors().length > 0)
    // An <input> holds its value in props, not in text, so check the field itself.
    assert.equal(endpoint.props.value, 'http://legacy.example:8188', 'The typed value stays visible so the user can fix it')
    assert.ok(!(await readFile(profile.patchPath, 'utf8')).includes('legacy.example'), 'An incompatible schema must not write settings')
    await assert.rejects(ctx.settings.mutate('image-gen', [{ op: 'set', path: ['comfyuiBaseURL'], value: 'http://x.example' }]), /no volatile fields/)
    console.log('PASS: installed bundle + published schemastery 3.18.2 reports the failure in the card and writes nothing')
    await form.close()
  } else {
    // Every text field commits on blur through a fire-and-forget write, so each
    // assertion waits for the host write to land instead of assuming it.
    const endpoint = form.field('Endpoint')
    await form.edit(endpoint, 'http://127.0.0.1:18188')
    await form.blur(endpoint)
    await waitFor(() => form.saved().comfyuiBaseURL === 'http://127.0.0.1:18188')
    assert.ok(form.body().includes('No scheduled task named ComfyUI'), 'The card shows why Start would fail before it is pressed')

    const timeout = form.field('Generation timeout')
    await form.edit(timeout, '42')
    await form.blur(timeout)
    await waitFor(() => form.saved().comfyuiTimeoutMs === 42_000)

    const headers = form.field('Request headers')
    await form.edit(headers, '{oops')
    await form.blur(headers)
    await waitFor(() => form.errors().length > 0)
    assert.ok(form.body().includes('JSON object'), 'The error names the fix, not just the failure')
    assert.ok(!String(form.saved().comfyuiHeadersJson ?? '').includes('oops'), 'A rejected header edit must not be saved')
    await form.edit(headers, '{"Authorization": "Bearer test-token"}')
    await form.blur(headers)
    await waitFor(() => form.saved().comfyuiHeadersJson === '{"Authorization": "Bearer test-token"}')

    await form.toggle(form.checkbox('Start ComfyUI automatically'), true)
    await waitFor(() => form.saved().comfyuiAutoStart === true)
    await form.edit(form.field('Launch method'), 'process')
    await waitFor(() => form.saved().comfyuiLaunchMode === 'process')

    // A failed start reports the server's reason instead of a fake success.
    const startButton = form.renderer.root.findAll(node => node.type === 'button' && text(node) === 'Start')[0]
    assert.ok(startButton, 'A down local server must offer Start')
    await form.click(startButton)
    await waitFor(() => form.errors().length > 0)
    assert.deepEqual(serverRequests, [{ action: 'start' }])
    assert.ok(form.body().includes('scheduled task named "ComfyUI" was not found'), 'The card surfaces the server\'s reason')

    // A remote endpoint is generation-only: process controls belong to that machine.
    const remoteEndpoint = form.field('Endpoint')
    await form.edit(remoteEndpoint, 'http://192.168.1.20:8188')
    await form.blur(remoteEndpoint)
    await waitFor(() => form.saved().comfyuiBaseURL === 'http://192.168.1.20:8188')
    await waitFor(() => form.body().includes('Remote server:'))
    assert.equal(form.renderer.root.findAll(node => node.type === 'button' && text(node) === 'Start').length, 0, 'A remote endpoint must not offer local Start')
    serverPayload = { status: UP }
    await form.click(form.renderer.root.findAll(node => node.type === 'button' && text(node) === 'Refresh')[0])
    await waitFor(() => form.body().includes('Running · 0.3.40'))
    assert.ok(form.body().includes('cuda:0 (NVIDIA GeForce RTX 4090)'), 'The card surfaces the device ComfyUI reported')

    // The shipped workflow pack must be inside the tarball: with nothing
    // configured the card falls back to it, so a missing pack shows empty groups.
    const textRadios = form.renderer.root.findAll(node => node.type === 'input' && node.props.name === 'dsh-ig-active-text-to-image')
    const editRadios = form.renderer.root.findAll(node => node.type === 'input' && node.props.name === 'dsh-ig-active-image-to-image')
    assert.ok(textRadios.length >= 2 && editRadios.length >= 1, `Shipped workflows missing: ${textRadios.length} text, ${editRadios.length} edit`)
    // .parent of the radio is its header row, so climb to the card's workflow row
    // that also owns the preset input.
    const rowOf = node => { let current = node; while (current && !String(current.props?.className ?? '').includes('dsh-ig-workflow-row')) current = current.parent; return current }
    const secondRow = rowOf(textRadios[1])
    assert.ok(secondRow, 'Each workflow radio must sit inside a .dsh-ig-workflow-row')
    const secondName = text(secondRow.findAll(node => node.props?.className === 'dsh-ig-workflow-name')[0])
    assert.ok(secondName, 'The workflow row must show the workflow name')
    await act(async () => { textRadios[1].props.onChange() })
    await waitFor(() => form.saved().comfyuiActiveTextWorkflow === secondName)
    const preset = secondRow.findAll(node => node.type === 'input' && node.props.placeholder === 'Preset prompt (optional)')[0]
    await form.edit(preset, 'cinematic, 35mm')
    await form.blur(preset)
    await waitFor(() => (form.saved().comfyuiWorkflows ?? []).some(entry => entry.name === secondName && entry.presetPrompt === 'cinematic, 35mm'))

    await form.toggle(form.checkbox('Also save generated images'), false)
    await waitFor(() => form.saved().saveToWorkspace === false)
    assert.equal(form.renderer.root.findAll(node => node.type === 'label' && text(node).startsWith('Workspace folder')).length, 0, 'The folder row follows the checkbox')
    await form.close()

    // A remote endpoint hides the local process controls, so a fresh card reads
    // the shared fields from props and the local-only ones from the host.
    const refreshed = await card(ctx)
    assert.equal(refreshed.field('Endpoint').props.value, 'http://192.168.1.20:8188')
    assert.equal(refreshed.field('Generation timeout').props.value, 42)
    assert.equal(refreshed.field('Request headers').props.value, '{"Authorization": "Bearer test-token"}')
    assert.equal(refreshed.saved().comfyuiLaunchMode, 'process')
    assert.equal(refreshed.saved().comfyuiAutoStart, true)
    assert.equal(refreshed.checkbox('Also save generated images').props.checked, false)
    assert.equal(refreshed.renderer.root.findAll(node => node.type === 'button' && text(node) === 'Start').length, 0, 'A remote endpoint stays generation-only')
    assert.ok((await readFile(profile.patchPath, 'utf8')).includes('192.168.1.20'), 'The write reached the real profile patch file')

    // Pointing the same card back at localhost restores the process controls
    // with the values saved earlier instead of resetting them.
    const local = refreshed.field('Endpoint')
    await refreshed.edit(local, 'http://127.0.0.1:18188')
    await refreshed.blur(local)
    await waitFor(() => refreshed.saved().comfyuiBaseURL === 'http://127.0.0.1:18188')
    await waitFor(() => refreshed.body().includes('Running · 0.3.40'))
    assert.equal(refreshed.field('Launch method').props.value, 'process')
    assert.equal(refreshed.checkbox('Start ComfyUI automatically').props.checked, true)
    await refreshed.close()

    await ctx.fiber.dispose()
    ctx = await start()
    const restarted = await card(ctx)
    assert.equal(restarted.field('Endpoint').props.value, 'http://127.0.0.1:18188')
    assert.equal(restarted.field('Generation timeout').props.value, 42)
    assert.equal(restarted.saved().comfyuiLaunchMode, 'process')
    assert.ok((restarted.saved().comfyuiWorkflows ?? []).some(entry => entry.presetPrompt === 'cinematic, 35mm'))
    assert.equal(restarted.saved().saveToWorkspace, false)
    await restarted.close()
    console.log('PASS: installed ComfyUI card persists endpoint, timeout, headers, launch mode, active workflow, preset, and workspace through real DSH settings, a fresh form, and host restart')
  }
} finally {
  for (const renderer of renderers) await act(async () => { renderer.unmount() })
  await ctx?.fiber.dispose()
}
// The browser bundle owns process-irrelevant cache timers. The profile has
// been disposed; finish this isolated test worker without waiting for them.
process.exit(0)
