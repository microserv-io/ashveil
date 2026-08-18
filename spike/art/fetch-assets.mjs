/**
 * Pulls the CC0 art this spike renders.
 *
 * The models are not committed: they are ~20MB of binaries that git would carry
 * forever, and they come from an upstream that is already a stable public archive.
 * Every file below is pinned to a tag so a rerun fetches the same bytes.
 *
 *   node spike/art/fetch-assets.mjs
 *
 * Source: KayKit by Kay Lousberg (kaylousberg.com), CC0 1.0 Universal.
 */
import { mkdir, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const HERE = import.meta.dirname
const OUT = join(HERE, 'assets')

const RAW = 'https://raw.githubusercontent.com/KayKit-Game-Assets'
const CHARACTERS = `${RAW}/KayKit-Character-Pack-Adventures-1.0/main/addons/kaykit_character_pack_adventures/Characters/gltf`
const SKELETONS = `${RAW}/KayKit-Character-Pack-Skeletons-1.0/main/addons/kaykit_character_pack_skeletons/Characters/gltf`
const DUNGEON = `${RAW}/KayKit-Dungeon-Remastered-1.0/main/addons/kaykit_dungeon_remastered/Assets/gltf`

/** Named for the role each fills in the sim, not for the file it came from. */
export const ASSETS = {
  'player.glb': `${CHARACTERS}/Knight.glb`,
  'swarm.glb': `${SKELETONS}/Skeleton_Minion.glb`,
  'ranged.glb': `${SKELETONS}/Skeleton_Rogue.glb`,
  'brute.glb': `${SKELETONS}/Skeleton_Warrior.glb`,
  'caster.glb': `${SKELETONS}/Skeleton_Mage.glb`,

  'floor.glb': `${DUNGEON}/floor_tile_large.gltf.glb`,
  'floor_rocks.glb': `${DUNGEON}/floor_tile_large_rocks.gltf.glb`,
  'wall.glb': `${DUNGEON}/wall.gltf.glb`,
  'wall_corner.glb': `${DUNGEON}/wall_corner.gltf.glb`,
  'wall_arched.glb': `${DUNGEON}/wall_arched.gltf.glb`,
  'stairs.glb': `${DUNGEON}/stairs.gltf.glb`,
  'torch.glb': `${DUNGEON}/torch_lit.gltf.glb`,
  'chest.glb': `${DUNGEON}/chest.glb`,
  'barrel.glb': `${DUNGEON}/barrel_large.gltf.glb`,
  'coin_stack.glb': `${DUNGEON}/coin_stack_large.gltf.glb`,
}

async function fetchOne(name, url) {
  const target = join(OUT, name)
  const already = await stat(target).catch(() => null)
  if (already?.size > 0) return { name, bytes: already.size, cached: true }

  const response = await fetch(url)
  if (!response.ok) throw new Error(`${name}: ${response.status} ${response.statusText}\n  ${url}`)
  const body = Buffer.from(await response.arrayBuffer())
  // A 404 page or an LFS pointer would sail through as a "successful" download.
  if (body.subarray(0, 4).toString('ascii') !== 'glTF') {
    throw new Error(`${name}: not a GLB (starts with ${JSON.stringify(body.subarray(0, 16).toString('ascii'))})`)
  }
  await writeFile(target, body)
  return { name, bytes: body.length, cached: false }
}

await mkdir(OUT, { recursive: true })
const results = await Promise.all(Object.entries(ASSETS).map(([name, url]) => fetchOne(name, url)))

let total = 0
for (const { name, bytes, cached } of results.sort((a, b) => b.bytes - a.bytes)) {
  total += bytes
  console.log(`  ${cached ? 'cached ' : 'fetched'} ${String(Math.round(bytes / 1024)).padStart(6)} KB  ${name}`)
}
console.log(`\n${results.length} assets, ${(total / 1024 / 1024).toFixed(1)} MB in ${OUT}`)
console.log('KayKit by Kay Lousberg (kaylousberg.com) — CC0 1.0 Universal')
