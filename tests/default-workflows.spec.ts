/**
 * The prefilled workflows are generated from `docs/workflows/*.json`.
 *
 * If someone edits a pack file without re-running
 * `node scripts/sync-default-workflows.mjs`, a fresh install would prefill a
 * stale workflow. This fails instead.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { SHIPPED_WORKFLOWS } from '../src/generated/default-workflows.js'
import { DEFAULT_WORKFLOWS } from '../src/config.js'
import { resolveWorkflowRole } from '../src/shared.js'

const packDir = path.resolve('docs/workflows')
const files = readdirSync(packDir).filter(name => name.endsWith('.json')).sort()

describe('prefilled workflows', () => {
  it('cover every file in the pack', () => {
    expect(SHIPPED_WORKFLOWS.map(entry => entry.file)).toEqual(files)
  })

  it('match the pack byte for byte after parsing', () => {
    for (const entry of SHIPPED_WORKFLOWS) {
      const source = JSON.parse(readFileSync(path.join(packDir, entry.file), 'utf8').replace(/^\uFEFF/, '')) as unknown
      expect(JSON.parse(entry.json)).toEqual(source)
    }
  })

  it('carry a readable name and a detected role', () => {
    for (const entry of SHIPPED_WORKFLOWS) {
      expect(entry.name.length).toBeGreaterThan(0)
      expect(entry.name).not.toMatch(/\.json$/)
      expect(['text-to-image', 'image-to-image']).toContain(resolveWorkflowRole({ name: entry.name, json: entry.json }))
    }
  })

  it('are what a fresh configuration starts from', () => {
    expect(DEFAULT_WORKFLOWS).toHaveLength(SHIPPED_WORKFLOWS.length)
    expect(DEFAULT_WORKFLOWS.map(entry => entry.name)).toEqual(SHIPPED_WORKFLOWS.map(entry => entry.name))
  })

  it('give a fresh install both roles', () => {
    const roles = DEFAULT_WORKFLOWS.map(entry => resolveWorkflowRole(entry))
    expect(roles).toContain('text-to-image')
    expect(roles).toContain('image-to-image')
  })
})
