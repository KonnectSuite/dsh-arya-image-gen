#!/usr/bin/env node
// Regenerate index.json — the plugin-index listing this repository self-registers.
//
// The README tells a user on any DeepSeek Harness to add this file as an index
// source (jsDelivr serves it from the repository root), so it is a public
// listing of every version npm serves for this package. It is deliberately NOT
// in package.json "files": it is a repository artifact, never packed. It is
// regenerated here because nothing else ever touched it — the copy this script
// replaced had drifted to 0.15.0 while npm was serving 0.19.2, and a stale
// listing is worse than none: a market shows releases[0] as the newest thing
// that exists.
//
// publishTimestamp and engines.dsh are read per version from npm's own packument.
// 0.11.0 shipped before the manifest declared a host requirement, so it gets no
// engines row rather than a range it never declared.
//
//   node scripts/sync-market-index.mjs            rewrite index.json
//   node scripts/sync-market-index.mjs --dry-run  report what would change
//   node scripts/sync-market-index.mjs --check    exit 1 when index.json is stale
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const flags = new Set(process.argv.slice(2))
for (const flag of flags) {
  if (flag !== '--dry-run' && flag !== '--check') {
    console.error(`unknown flag ${flag} (expected --dry-run or --check)`)
    process.exit(2)
  }
}
const dryRun = flags.has('--dry-run')
const checkOnly = flags.has('--check')

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const indexFile = join(root, 'index.json')
const index = JSON.parse(readFileSync(indexFile, 'utf8'))

// The registry's full packument, read over HTTPS. `npm view <name> --json` is
// the wrong tool here even though it looks right: the CLI answers with an
// abbreviated document — an array-wrapped summary whose "versions" is a flat
// list of version strings and whose per-version manifests are dropped. Iterating
// it yields array indexes ("0", "1", …), so the publish-time lookup below misses
// and every per-version host requirement is unavailable. The scoped name keeps
// its slash: the registry routes @scope/name directly.
const packumentUrl = `https://registry.npmjs.org/${pkg.name}`
let packument
try {
  const response = await fetch(packumentUrl, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) {
    console.error(
      `${packumentUrl} answered ${response.status} — is the registry unreachable, or is ${pkg.name} not published yet?`,
    )
    process.exit(1)
  }
  packument = await response.json()
} catch (error) {
  console.error(`cannot read ${packumentUrl}: ${error.message}`)
  process.exit(1)
}
if (!packument?.time || !packument?.versions || Array.isArray(packument.versions)) {
  console.error(
    `${packumentUrl} returned no usable packument (time + per-version manifests) — is the registry answering with an abbreviated document?`,
  )
  process.exit(1)
}

const time = packument.time
const versions = Object.entries(packument.versions)
  // Prereleases and the deprecated 0.0.0-stage placeholder are not offered.
  .filter(([version]) => !version.includes('-'))
  .map(([version, manifest]) => {
    const at = time[version]
    if (!at) {
      console.error(`npm has no publish time for ${pkg.name}@${version}`)
      process.exit(1)
    }
    // The host requirement has lived in two places across this package's
    // history: engines.dsh up to 0.19.x, dsh.engines.dsh from then on.
    const dsh = manifest.engines?.dsh ?? manifest.dsh?.engines?.dsh
    return {
      version,
      publishTimestamp: Math.floor(Date.parse(at) / 1000),
      source: { type: 'npm' },
      ...(dsh ? { engines: { dsh } } : {}),
    }
  })
  .sort((a, b) => a.publishTimestamp - b.publishTimestamp)

if (versions.length === 0) {
  console.error(`npm serves no stable versions of ${pkg.name} yet — index.json must stay at the last listing that resolves`)
  process.exit(1)
}

// One entry per repository. The 0.20.0 rename to @aryacode/dsh-arya-image-gen
// made a different npm package with its own version history, so the entry
// follows package.json's name rather than being matched by it: the display
// fields carry over and the version list is rebuilt from the new package.
let plugin = index.plugins.find(row => row.name === pkg.name)
if (!plugin) {
  if (index.plugins.length !== 1) {
    console.error(`index.json holds ${index.plugins.length} entries; refusing to guess which one this repository owns`)
    process.exit(1)
  }
  console.log(`renaming the index entry ${index.plugins[0].name} -> ${pkg.name}`)
  plugin = index.plugins[0]
  plugin.name = pkg.name
}
plugin.versions = versions

const next = JSON.stringify(index, null, 2) + '\n'
const current = readFileSync(indexFile, 'utf8')
const newest = versions.at(-1)
const latest = packument['dist-tags']?.latest

if (checkOnly) {
  if (next !== current) {
    console.error(
      `index.json is stale for ${pkg.name}: npm newest is ${newest.version}` +
        (typeof latest === 'string' ? ` (dist-tags.latest ${latest})` : '') +
        `, the file lists ${JSON.parse(current).plugins.find(r => r.name === pkg.name)?.versions?.at(-1)?.version ?? 'nothing'}.` +
        ' Run `node scripts/sync-market-index.mjs` and commit the result.',
    )
    process.exit(1)
  }
  console.log(`index.json matches npm: ${versions.length} versions of ${pkg.name}, newest ${newest.version}`)
} else if (dryRun) {
  console.log(next === current ? `index.json already matches npm (${versions.length} versions, newest ${newest.version})` : next)
} else {
  // No byte-order mark: hosts read this file, and a BOM breaks a strict JSON parse.
  writeFileSync(indexFile, next)
  console.log(`${pkg.name}: ${versions.length} versions, newest ${newest.version} (${newest.publishTimestamp})`)
}
