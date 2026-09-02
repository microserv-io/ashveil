import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

interface KayKitManifest {
  bones: string[]
  clips: string[]
}

interface GltfJson {
  nodes: { name?: string }[]
  skins: { joints: number[] }[]
  animations: { name?: string }[]
}

const ROOT = join(import.meta.dirname, '..')
const PLAYER = join(ROOT, 'public', 'models', 'player.glb')
const MANIFEST = JSON.parse(
  readFileSync(join(ROOT, 'src', 'render', 'profiles', 'kaykit.json'), 'utf8'),
) as KayKitManifest

describe('KayKit profile manifest', () => {
  it('lists the expected rig and shared clip inventory', () => {
    expect(MANIFEST.bones).toHaveLength(41)
    expect(MANIFEST.clips).toHaveLength(76)
    expect(new Set(MANIFEST.bones).size).toBe(41)
    expect(new Set(MANIFEST.clips).size).toBe(76)
  })

  const assetTest = existsSync(PLAYER)
    ? 'matches the fetched player.glb'
    : 'matches the fetched player.glb (skipped: public/models/player.glb not fetched)'

  it.skipIf(!existsSync(PLAYER))(assetTest, () => {
    const gltf = readGltfJson(readFileSync(PLAYER))
    const jointIndices = new Set(gltf.skins.flatMap((skin) => skin.joints))
    const bones = [...jointIndices].map((index) => gltf.nodes[index]?.name ?? '').sort()
    const clips = gltf.animations.map((animation) => animation.name ?? '').sort()

    expect(bones).toEqual(MANIFEST.bones)
    expect(clips).toEqual(MANIFEST.clips)
  })
})

function readGltfJson(body: Buffer): GltfJson {
  let offset = 12
  while (offset < body.length) {
    const length = body.readUInt32LE(offset)
    const type = body.readUInt32LE(offset + 4)
    if (type === 0x4e4f534a) {
      return JSON.parse(body.subarray(offset + 8, offset + 8 + length).toString('utf8').trim()) as GltfJson
    }
    offset += 8 + length
  }
  throw new Error('player.glb has no JSON chunk')
}
