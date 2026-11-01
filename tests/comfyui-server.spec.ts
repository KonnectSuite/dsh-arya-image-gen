import { describe, expect, it } from 'vitest'
import { comfyUIServerConfigOf } from '../src/comfyui-server.js'
import { parseComfyUIExtraArgs } from '../src/config.js'

describe('comfyUIServerConfigOf', () => {
  it('fills defaults for an empty config', () => {
    const config = comfyUIServerConfigOf({})
    expect(config.baseURL).toBe('http://127.0.0.1:8188')
    expect(config.pythonExe.toLowerCase()).toContain('python.exe')
    expect(config.serverDir.toLowerCase()).toContain('comfyui')
    expect(parseComfyUIExtraArgs(config.extraArgs)).toContain('--disable-auto-launch')
  })

  it('honors explicit settings', () => {
    const config = comfyUIServerConfigOf({
      comfyuiBaseURL: 'http://127.0.0.1:9000',
      comfyuiPythonExe: 'D:\\py\\python.exe',
      comfyuiServerDir: 'D:\\ComfyUI',
      comfyuiExtraArgs: '--listen 0.0.0.0',
    })
    expect(config.baseURL).toBe('http://127.0.0.1:9000')
    expect(config.pythonExe).toBe('D:\\py\\python.exe')
    expect(config.serverDir).toBe('D:\\ComfyUI')
    expect(parseComfyUIExtraArgs(config.extraArgs)).toEqual(['--listen', '0.0.0.0'])
  })
})
