/**
 * Pulls the CC0 dungeon art the game renders, into `public/models/`.
 *
 * The models are not committed: they are ~20MB of binaries that git would carry
 * forever, and they come from an upstream that is already a stable public archive.
 *
 *   npm run assets
 *
 * Source: KayKit by Kay Lousberg (kaylousberg.com), CC0 1.0 Universal.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const OUT = join(import.meta.dirname, '..', 'public', 'models')

const RAW = 'https://raw.githubusercontent.com/KayKit-Game-Assets'
export const KAYKIT_REVISIONS = {
  dungeon: 'b0ca9bd96a8072ab36a3a5464f00ed1e06a16d07',
}

export const ASSET_SHA256 = {
  'floor.glb': '5b6bbbc683f6729d094732056f157a928435de97ec3cf94c341c7465907fe17b',
  'floor_rocks.glb': 'fb06b1e9ca7a5d14f6757119490c4b3c077a30e31ef580da6925b6657f14c14d',
  'wall.glb': 'f2f343a7bdf2d45947e3f354494e16095a923485e05637e3804e3b81ce11d921',
  'portal.glb': '5ba16e5d919aaa8958435c4b73c1f8a94c98febeacf716faa1359f24e6b27d70',
  'loot_normal.glb': '3052015d7cd670c170742317fd9c728e5643221450857abbae9eefe6dbc66092',
  'loot_magic.glb': 'f72fd2201cd42ad399928a0b7bcc34d5b0e6d0624aeaf824fef81852109955f8',
  'loot_rare.glb': '04708d5f88ed59d361c8a6cec1efe8b7028dbc641dfae0a1467f272e14a94b6e',
  'orb.glb': '32759c64c6e8fe5634753134748f4b759b698aafb1245b8ed9fe62afe390faa5',
}

const DUNGEON = `${RAW}/KayKit-Dungeon-Remastered-1.0/${KAYKIT_REVISIONS.dungeon}/addons/kaykit_dungeon_remastered/Assets/gltf`

/** Named for the role each fills in the sim, not for the file it came from. */
export const ASSETS = {
  'floor.glb': { url: `${DUNGEON}/floor_tile_large.gltf.glb`, sha256: ASSET_SHA256['floor.glb'] },
  'floor_rocks.glb': { url: `${DUNGEON}/floor_tile_large_rocks.gltf.glb`, sha256: ASSET_SHA256['floor_rocks.glb'] },
  'wall.glb': { url: `${DUNGEON}/wall.gltf.glb`, sha256: ASSET_SHA256['wall.glb'] },
  'portal.glb': { url: `${DUNGEON}/stairs.gltf.glb`, sha256: ASSET_SHA256['portal.glb'] },

  // Ground items read their rarity from the container they land in.
  'loot_normal.glb': { url: `${DUNGEON}/box_small.gltf.glb`, sha256: ASSET_SHA256['loot_normal.glb'] },
  'loot_magic.glb': { url: `${DUNGEON}/chest.glb`, sha256: ASSET_SHA256['loot_magic.glb'] },
  'loot_rare.glb': { url: `${DUNGEON}/chest_gold.glb`, sha256: ASSET_SHA256['loot_rare.glb'] },
  'orb.glb': { url: `${DUNGEON}/bottle_A_green.gltf.glb`, sha256: ASSET_SHA256['orb.glb'] },
}

export function validateAssetMetadata(name, source) {
  if (source.url.includes('/TODO_') || source.sha256.startsWith('TODO_')) {
    throw new Error(`${name}: fill the TODO commit SHA and SHA-256 before fetching assets`)
  }
  if (!/\/[0-9a-f]{40}\//.test(source.url)) throw new Error(`${name}: URL is not pinned to a 40-character commit SHA`)
  if (!/^[0-9a-f]{64}$/.test(source.sha256)) throw new Error(`${name}: SHA-256 must be 64 lowercase hex characters`)
}

export function verifyAssetBody(name, body, expectedSha256) {
  if (body.subarray(0, 4).toString('ascii') !== 'glTF') {
    throw new Error(`${name}: not a GLB (starts with ${JSON.stringify(body.subarray(0, 16).toString('ascii'))})`)
  }
  const actualSha256 = createHash('sha256').update(body).digest('hex')
  if (actualSha256 !== expectedSha256) {
    throw new Error(`${name}: SHA-256 mismatch, expected ${expectedSha256}, got ${actualSha256}`)
  }
}

async function fetchOne(name, source) {
  validateAssetMetadata(name, source)
  const target = join(OUT, name)
  const cachedBody = await readFile(target).catch(() => null)
  if (cachedBody?.length) {
    verifyAssetBody(name, cachedBody, source.sha256)
    return { name, bytes: cachedBody.length, cached: true }
  }

  const response = await fetch(source.url)
  if (!response.ok) throw new Error(`${name}: ${response.status} ${response.statusText}\n  ${source.url}`)
  const body = Buffer.from(await response.arrayBuffer())
  verifyAssetBody(name, body, source.sha256)
  await writeFile(target, body)
  return { name, bytes: body.length, cached: false }
}

async function fetchAll() {
  await mkdir(OUT, { recursive: true })
  const results = await Promise.all(Object.entries(ASSETS).map(([name, source]) => fetchOne(name, source)))

  let total = 0
  for (const { name, bytes, cached } of results.sort((a, b) => b.bytes - a.bytes)) {
    total += bytes
    console.log(`  ${cached ? 'cached ' : 'fetched'} ${String(Math.round(bytes / 1024)).padStart(6)} KB  ${name}`)
  }
  console.log(`\n${results.length} assets, ${(total / 1024 / 1024).toFixed(1)} MB in ${OUT}`)
  console.log('KayKit by Kay Lousberg (kaylousberg.com) — CC0 1.0 Universal')
}

// Importing this for its ASSETS table must not download 18MB as a side effect.
if (import.meta.filename === process.argv[1]) await fetchAll()
