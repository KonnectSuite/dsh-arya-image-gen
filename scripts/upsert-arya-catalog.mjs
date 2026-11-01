/**
 * Upsert one release of this plugin into the Arya market catalog.
 *
 * The catalog is data/arya-plugins.json on the `catalog` branch of
 * KonnectSuite/dsh-arya-market; the app reads that branch directly, so an
 * entry appears without an app update.
 *
 * Usage:
 *   node scripts/upsert-arya-catalog.mjs --market <catalog-checkout> --version 0.11.1 [--dry-run] [--set-default]
 *
 * The tarball is taken from the npm registry packument, downloaded, and hashed;
 * an existing version is never rewritten with different bytes.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
function option(name, fallback) {
  const index = args.indexOf(`--${name}`)
  if (index === -1) return fallback
  return args[index + 1]
}

function compareVersions(left, right) {
  const parse = value => String(value).split('-')[0].split('.').map(Number)
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0)
  }
  return 0
}

const marketDir = option('market', '')
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const version = option('version', pkg.version)
const dryRun = args.includes('--dry-run')
const registry = option('registry', 'https://registry.npmjs.org').replace(/\/$/, '')
if (marketDir === '' || version === '') {
  console.error('usage: node scripts/upsert-arya-catalog.mjs --market <dir> [--version x.y.z] [--dry-run]')
  process.exit(2)
}

const catalogPath = join(marketDir, 'data', 'arya-plugins.json')
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))

const packument = await fetch(`${registry}/${encodeURIComponent(pkg.name)}`, { headers: { accept: 'application/json' } }).then(async response => {
  if (!response.ok) throw new Error(`registry lookup failed: HTTP ${response.status}`)
  return response.json()
})
const published = packument.versions?.[version]
if (published === undefined) throw new Error(`${pkg.name}@${version} is not on ${registry}; publish it first`)
const tarball = published.dist?.tarball
if (typeof tarball !== 'string') throw new Error('registry packument has no tarball URL')
const releasedAt = packument.time?.[version] ?? new Date().toISOString()

const archive = Buffer.from(await (await fetch(tarball)).arrayBuffer())
const sha256 = createHash('sha256').update(archive).digest('hex')

const existing = catalog.plugins.find(plugin => plugin.name === pkg.name)
const release = { version, tarball, sha256, releasedAt }

if (existing !== undefined) {
  const same = existing.releases.find(entry => entry.version === version)
  if (same !== undefined) {
    if (same.sha256 !== sha256) throw new Error(`${pkg.name}@${version} is already listed with different bytes; bump the version`)
    console.log(`${pkg.name}@${version} already listed; nothing to do`)
    process.exit(0)
  }
}

const entry = existing ?? {
  name: pkg.name,
  owner: 'KonnectSuite',
  url: pkg.repository?.url?.replace(/^git\+/, '').replace(/\.git$/, '') ?? 'https://github.com/KonnectSuite/dsh-arya-image-gen',
  category: 'arya',
  description: {
    en: option('description-en', pkg.description ?? pkg.name),
    zh: option('description-zh', pkg.description ?? pkg.name),
  },
  added: new Date().toISOString().slice(0, 10),
  install: '',
  arya: true,
  releases: [],
}

entry.releases = [release, ...entry.releases]
if (existing === undefined || compareVersions(version, existing.version) >= 0 || args.includes('--set-default')) {
  entry.version = version
  entry.tarball = tarball
} else {
  console.log(`${version} is older than the listed default ${existing.version}; keeping the default and adding the release`)
}
if (existing === undefined) catalog.plugins.push(entry)

catalog.updated = new Date().toISOString()
catalog.count = catalog.plugins.length

if (dryRun) {
  console.log(JSON.stringify({ entry, count: catalog.count }, null, 1))
  process.exit(0)
}
writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n')
console.log(`listed ${pkg.name}@${version} (${sha256.slice(0, 12)}…); catalog count ${catalog.count}`)
