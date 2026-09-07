import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import * as THREE from 'three'
import { GLTFLoader, type GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { describe, expect, it, vi } from 'vitest'
import {
  validateWorldCharacterTemplate,
  WorldCharacter,
  WorldCharacterSource,
  WORLD_CHARACTER_URL,
  type WorldCharacterTemplate,
} from '../src/world/character'
import { createGaitParams, gaitParams } from '../src/render/procedural/gait'
import { buildRigGeometry } from '../src/render/procedural/geometry'
import fixture from '../src/render/procedural/fixtures/masculine.json'
import { createExplorer, SPRINT_SPEED, WALK_SPEED } from '../src/world/movement'

const BODY_PATH = join(import.meta.dirname, '..', 'public', 'bodies', 'masculine-v3', 'masculine-v3.glb')

function nodeTextureLoader(): GLTFLoader {
  const wrapping = new Map<number | undefined, THREE.Wrapping>([
    [33071, THREE.ClampToEdgeWrapping], [33648, THREE.MirroredRepeatWrapping], [10497, THREE.RepeatWrapping],
    [undefined, THREE.RepeatWrapping],
  ])
  const filters = new Map<number | undefined, THREE.TextureFilter>([
    [9728, THREE.NearestFilter], [9729, THREE.LinearFilter], [9984, THREE.NearestMipmapNearestFilter],
    [9985, THREE.LinearMipmapNearestFilter], [9986, THREE.NearestMipmapLinearFilter],
    [9987, THREE.LinearMipmapLinearFilter], [undefined, THREE.LinearMipmapLinearFilter],
  ])
  return new GLTFLoader().register((parser: GLTFParser) => ({
    name: 'ASHVEIL_node_character_image',
    loadTexture: (textureIndex: number) => {
      const textureDef = parser.json.textures?.[textureIndex]
      const sourceIndex = textureDef?.source
      const sourceDef = parser.json.images?.[sourceIndex]
      if (typeof sourceIndex !== 'number' || typeof sourceDef?.bufferView !== 'number'
        || (sourceDef.mimeType !== 'image/jpeg' && sourceDef.mimeType !== 'image/png')) return null
      return parser.getDependency('bufferView', sourceDef.bufferView)
        .then(async (bytes: ArrayBuffer) => {
          const { data, info } = await sharp(new Uint8Array(bytes)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
          const texture = new THREE.DataTexture(
            new Uint8Array(data.buffer, data.byteOffset, data.byteLength), info.width, info.height,
          )
          const sampler = parser.json.samplers?.[textureDef.sampler] ?? {}
          const wrapS = wrapping.get(sampler.wrapS)
          const wrapT = wrapping.get(sampler.wrapT)
          const magFilter = sampler.magFilter === undefined ? THREE.LinearFilter : filters.get(sampler.magFilter)
          const minFilter = filters.get(sampler.minFilter)
          if (wrapS === undefined || wrapT === undefined || magFilter === undefined || minFilter === undefined
            || (magFilter !== THREE.NearestFilter && magFilter !== THREE.LinearFilter)) {
            throw new Error(`Unsupported glTF sampler on character texture ${textureIndex}.`)
          }
          texture.name = textureDef.name || sourceDef.name || ''
          texture.flipY = false
          texture.wrapS = wrapS
          texture.wrapT = wrapT
          texture.magFilter = magFilter
          texture.minFilter = minFilter
          texture.generateMipmaps = minFilter !== THREE.NearestFilter && minFilter !== THREE.LinearFilter
          texture.needsUpdate = true
          parser.associations.set(texture, { textures: textureIndex })
          return texture
        })
    },
  }))
}

let loaded: Promise<WorldCharacterTemplate> | undefined
function actualCharacter(): Promise<WorldCharacterTemplate> {
  if (!loaded) {
    const file = readFileSync(BODY_PATH)
    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
    loaded = nodeTextureLoader().parseAsync(buffer, '').then((gltf) => validateWorldCharacterTemplate(gltf.scene))
  }
  return loaded
}

function skinned(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const meshes: THREE.SkinnedMesh[] = []
  root.traverse((object) => { if (object instanceof THREE.SkinnedMesh) meshes.push(object) })
  return meshes
}

function bone(root: THREE.Object3D, name: string): THREE.Bone {
  const found = root.getObjectByName(name)
  if (!(found instanceof THREE.Bone)) throw new Error(`Missing bone ${name}`)
  return found
}

describe('first-zone masculine character asset', () => {
  it('decodes and validates the real textured GLB without embedded animation clips', async () => {
    const file = readFileSync(BODY_PATH)
    let offset = 12
    let json: {
      animations?: unknown[]
      images?: { mimeType?: string }[]
      meshes?: { name?: string; primitives: { attributes: { POSITION: number } }[] }[]
      accessors?: { min?: number[] }[]
    } | undefined
    while (offset < file.length) {
      const length = file.readUInt32LE(offset)
      if (file.readUInt32LE(offset + 4) === 0x4e4f534a) {
        json = JSON.parse(file.subarray(offset + 8, offset + 8 + length).toString('utf8').trim())
      }
      offset += 8 + length
    }
    expect(json?.animations ?? []).toHaveLength(0)
    expect(json?.images).toEqual([expect.objectContaining({ mimeType: 'image/jpeg' })])
    const facialMinimumZ = json!.meshes!
      .filter((mesh) => mesh.name?.startsWith('Facial_Feature_'))
      .map((mesh) => json!.accessors![mesh.primitives[0]!.attributes.POSITION]!.min![2]!)
    expect(facialMinimumZ).toHaveLength(4)
    expect(facialMinimumZ.every((z) => z > 0)).toBe(true)

    const template = await actualCharacter()
    const meshes = skinned(template.scene)
    const bounds = new THREE.Box3().setFromObject(template.scene)
    expect(meshes).toHaveLength(6)
    expect(new Set(meshes.flatMap((mesh) => mesh.skeleton.bones.map((entry) => entry.name))).size).toBe(24)
    expect(bounds.min.y).toBeCloseTo(0, 4)
    expect(bounds.max.y - bounds.min.y).toBeCloseTo(1.8, 4)
    const map = (meshes[0]!.material as THREE.MeshStandardMaterial).map!
    expect(meshes.every((mesh) => mesh.material instanceof THREE.MeshPhysicalMaterial)).toBe(true)
    expect(map.image).toMatchObject({ width: 2048, height: 2048 })
    expect(map.colorSpace).toBe(THREE.SRGBColorSpace)
  })

  it('loads once concurrently, evicts a rejected request, and retries', async () => {
    const template = await actualCharacter()
    let resolve!: (value: { scene: THREE.Object3D }) => void
    let attempts = 0
    const loader = {
      loadAsync: vi.fn(() => {
        attempts += 1
        if (attempts === 1) return Promise.reject(new Error('network unavailable'))
        return new Promise<{ scene: THREE.Object3D }>((done) => { resolve = done })
      }),
    }
    const source = new WorldCharacterSource(loader)
    await expect(source.load()).rejects.toThrow(/Alderbank explorer/)
    const first = source.load()
    const concurrent = source.load()
    expect(first).toBe(concurrent)
    expect(loader.loadAsync).toHaveBeenLastCalledWith(WORLD_CHARACTER_URL)
    resolve({ scene: template.scene })
    await expect(first).resolves.toBeDefined()
    await source.load()
    expect(attempts).toBe(2)
  })

  it('clones skeletons and materials while retaining source-owned geometry and maps', async () => {
    const template = await actualCharacter()
    const explorer = createExplorer({ x: -70, z: -70 })
    const first = new WorldCharacter(template, explorer)
    const second = new WorldCharacter(template, explorer)
    const sourceMeshes = skinned(template.scene)
    const firstMeshes = skinned(first.root)
    const secondMeshes = skinned(second.root)
    expect(firstMeshes).toHaveLength(6)
    expect(firstMeshes[0]!.skeleton.bones[0]).not.toBe(secondMeshes[0]!.skeleton.bones[0])
    expect(firstMeshes[0]!.material).not.toBe(secondMeshes[0]!.material)
    expect(firstMeshes[0]!.material).not.toBe(sourceMeshes[0]!.material)
    expect(firstMeshes[0]!.geometry).toBe(sourceMeshes[0]!.geometry)
    expect((firstMeshes[0]!.material as THREE.MeshStandardMaterial).map)
      .toBe((sourceMeshes[0]!.material as THREE.MeshStandardMaterial).map)
    expect(firstMeshes.every((mesh) => !mesh.frustumCulled && mesh.castShadow && mesh.receiveShadow)).toBe(true)

    const texture = (sourceMeshes[0]!.material as THREE.MeshStandardMaterial).map!
    const disposeTexture = vi.spyOn(texture, 'dispose')
    first.dispose()
    expect(disposeTexture).not.toHaveBeenCalled()
    disposeTexture.mockRestore()
    second.dispose()
  })

  it('uses actual displacement for idle, running, faster running, and reset', async () => {
    const template = await actualCharacter()
    const start = createExplorer({ x: -70, z: -70 })
    const character = new WorldCharacter(template, start)
    const bindThigh = bone(template.scene, 'thigh_L').quaternion.clone()

    character.update(start, 0.1)
    expect(character.animationState).toEqual({ state: 'idle', speed: 0, time: 0.1 })

    const walked = { ...start, x: start.x + WALK_SPEED * 0.1 }
    character.update(walked, 0.1)
    expect(character.animationState.state).toBe('moving')
    expect(character.animationState.speed).toBeCloseTo(WALK_SPEED)
    expect(bone(character.root, 'thigh_L').quaternion.angleTo(bindThigh)).toBeGreaterThan(0.01)

    const sprinted = { ...walked, x: walked.x + SPRINT_SPEED * 0.1 }
    character.update(sprinted, 0.1)
    expect(character.animationState.speed).toBeCloseTo(SPRINT_SPEED)
    const geometry = buildRigGeometry(fixture.joints, 1, fixture.standingHeight, fixture.footprint)
    const running = createGaitParams()
    const faster = createGaitParams()
    gaitParams(geometry, WALK_SPEED, running)
    gaitParams(geometry, SPRINT_SPEED, faster)
    expect(running.runBlend).toBe(1)
    expect(faster.runBlend).toBe(1)
    expect(faster.frequency).toBeGreaterThan(running.frequency)

    const reset = { ...start, facing: 1.2 }
    character.reset(reset)
    expect(character.animationState).toEqual({ state: 'idle', speed: 0, time: 0 })
    expect(character.root.position.toArray()).toEqual([reset.x, reset.y, reset.z])
    expect(character.root.rotation.y).toBeCloseTo(reset.facing)
    character.dispose()
  })

  it('becomes idle when an attempted move realizes no displacement', async () => {
    const template = await actualCharacter()
    const start = createExplorer({ x: -70, z: -70 })
    const character = new WorldCharacter(template, start)
    character.update({ ...start, facing: 0.8 }, 0.1)
    expect(character.animationState.state).toBe('idle')
    expect(character.animationState.speed).toBe(0)
    character.dispose()
  })
})
