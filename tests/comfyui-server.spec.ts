import { describe, expect, it } from 'vitest'
import { ComfyUIServerManager, comfyUIServerConfigOf } from '../src/comfyui-server.js'
import { comfyUIEndpointURL, isLocalComfyUIEndpoint, parseComfyUIHeaders } from '../src/shared.js'
import { parseComfyUIExtraArgs } from '../src/config.js'

describe('comfyUIServerConfigOf', () => {
  it('leaves local launch paths unset by default', () => {
    const config = comfyUIServerConfigOf({})
    expect(config.baseURL).toBe('http://127.0.0.1:8188')
    expect(config.pythonExe).toBe('')
    expect(config.serverDir).toBe('')
    expect(parseComfyUIExtraArgs(config.extraArgs)).toContain('--disable-auto-launch')
  })

  it('honors explicit settings, including headers', () => {
    const config = comfyUIServerConfigOf({
      comfyuiBaseURL: 'http://127.0.0.1:9000',
      comfyuiPythonExe: 'D:\\py\\python.exe',
      comfyuiServerDir: 'D:\\ComfyUI',
      comfyuiExtraArgs: '--listen 0.0.0.0',
      comfyuiHeadersJson: '{"Authorization":"Bearer t"}',
    })
    expect(config.baseURL).toBe('http://127.0.0.1:9000')
    expect(config.pythonExe).toBe('D:\\py\\python.exe')
    expect(config.serverDir).toBe('D:\\ComfyUI')
    expect(parseComfyUIExtraArgs(config.extraArgs)).toEqual(['--listen', '0.0.0.0'])
    expect(config.headers).toEqual({ Authorization: 'Bearer t' })
  })
})

describe('remote endpoints', () => {
  it('classifies local and remote hosts', () => {
    expect(isLocalComfyUIEndpoint('http://127.0.0.1:8188')).toBe(true)
    expect(isLocalComfyUIEndpoint('http://localhost:8188/comfy')).toBe(true)
    expect(isLocalComfyUIEndpoint('http://192.168.1.20:8188')).toBe(false)
    expect(isLocalComfyUIEndpoint('https://comfy.example.com/')).toBe(false)
  })

  it('keeps a reverse-proxy subpath when resolving API paths', () => {
    expect(comfyUIEndpointURL('https://comfy.example.com/comfy', 'system_stats').href).toBe('https://comfy.example.com/comfy/system_stats')
    expect(comfyUIEndpointURL('http://127.0.0.1:8188/', '/prompt').href).toBe('http://127.0.0.1:8188/prompt')
  })

  it('refuses process control for a remote server', async () => {
    const manager = new ComfyUIServerManager(
      () => comfyUIServerConfigOf({ comfyuiBaseURL: 'http://192.168.1.20:8188' }),
      () => {},
    )
    await expect(manager.start()).rejects.toThrow(/remote/i)
    await expect(manager.stop()).rejects.toThrow(/remote/i)
  })
})

describe('parseComfyUIHeaders', () => {
  it('accepts an empty value and a JSON object', () => {
    expect(parseComfyUIHeaders('')).toEqual({})
    expect(parseComfyUIHeaders('{"X-Token":"a b","Authorization":"Basic x"}')).toEqual({ 'X-Token': 'a b', Authorization: 'Basic x' })
  })

  it('rejects malformed values', () => {
    expect(() => parseComfyUIHeaders('nope')).toThrow(/JSON object/)
    expect(() => parseComfyUIHeaders('[]')).toThrow(/JSON object/)
    expect(() => parseComfyUIHeaders('{"X":1}')).toThrow(/string/)
  })
})
