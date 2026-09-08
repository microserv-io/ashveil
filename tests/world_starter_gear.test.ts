import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { GLTFLoader, type GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { ApprovedWorldCharacter } from '../src/world/approved-character'
import { validateApprovedCharacterTemplate, validateApprovedManifest } from '../src/world/approved-character-source'
import { createExplorer } from '../src/world/movement'
import { StarterGear } from '../src/world/starter-gear'
import {
  STARTER_GEAR_SLOTS,
  StarterGearSource,
  validateStarterGearManifest,
  validateStarterGearTemplate,
  type StarterGearManifest,
  type StarterGearMaterial,
  type StarterGearMesh,
  type StarterGearSlot,
  type StarterGearTemplate,
} from '../src/world/starter-gear-source'

const HASH = 'a'.repeat(64)
const BODY_HASH = 'b'.repeat(64)
const JOINTS = Array.from({ length: 68 }, (_, index) => `joint-${index}`)
const SLOT_MESHES: Record<StarterGearSlot, string> = {
  chest: 'StarterLeatherChest',
  legs: 'StarterLeatherLegs',
  boots: 'StarterLeatherBoots',
  waist: 'StarterLeatherWaist',
}
const ROOT = join(import.meta.dirname, '..')
const MANIFEST_SCRIPT = join(ROOT, 'scripts', 'art', 'gear', 'update_starter_gear_manifest.mjs')

function manifest(includeWaist = false, chestTrim = false): StarterGearManifest {
  const slots = includeWaist ? STARTER_GEAR_SLOTS : STARTER_GEAR_SLOTS.filter((slot) => slot !== 'waist')
  return {
    schema: 'ashveil.starter-gear.v1',
    body: 'masculine-clean-v1',
    bodySha256: BODY_HASH,
    glb: { file: 'starter-leather.glb', bytes: 128, sha256: HASH },
    jointNames: JOINTS,
    inverseBindSha256: HASH,
    slots: slots.map((slot) => ({
      slot,
      mesh: SLOT_MESHES[slot],
      triangles: 1,
      bounds: { min: [0, 0, 0], max: [1, 1, 0] },
    })),
    budget: { triangles: slots.length, materials: slots.length + Number(chestTrim) },
  }
}

function skeleton(names: readonly string[] = JOINTS): THREE.Skeleton {
  const bones = names.map((name) => Object.assign(new THREE.Bone(), { name }))
  return new THREE.Skeleton(bones, bones.map(() => new THREE.Matrix4()))
}

function geometry(): THREE.BufferGeometry {
  const result = new THREE.BufferGeometry()
  result.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
  result.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3))
  result.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2))
  result.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4))
  result.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4))
  result.setIndex([0, 1, 2])
  return result
}

function material(name = ''): THREE.MeshStandardMaterial {
  const result = new THREE.MeshStandardMaterial({ color: 0xffffff })
  result.name = name
  return result
}

function skinned(name: string, rig = skeleton(), meshMaterial: StarterGearMaterial | StarterGearMaterial[] = material()): StarterGearMesh {
  const meshGeometry = geometry()
  if (Array.isArray(meshMaterial)) {
    for (let index = 0; index < meshMaterial.length; index += 1) meshGeometry.addGroup(0, 3, index)
  }
  const mesh = new THREE.SkinnedMesh(meshGeometry, meshMaterial)
  mesh.name = name
  mesh.bind(rig, new THREE.Matrix4())
  return mesh
}

function template(options: { includeWaist?: boolean; chestTrim?: boolean } = {}): StarterGearTemplate {
  const includeWaist = options.includeWaist ?? false
  const chestTrim = options.chestTrim ?? false
  const slots = includeWaist ? STARTER_GEAR_SLOTS : STARTER_GEAR_SLOTS.filter((slot) => slot !== 'waist')
  const scene = new THREE.Group()
  for (const slot of slots) {
    const primary = material(slot === 'chest' ? 'Starter Leather' : 'Starter Dark Leather')
    const mesh = skinned(SLOT_MESHES[slot], skeleton(), slot === 'chest' && chestTrim
      ? [primary, material('Starter Trim')]
      : primary)
    scene.add(mesh)
  }
  return validateStarterGearTemplate(
    { scene, animations: [] },
    validateStarterGearManifest(manifest(includeWaist, chestTrim)),
  )
}

function body(): { root: THREE.Group; mesh: THREE.SkinnedMesh } {
  const root = new THREE.Group()
  const mesh = skinned('ApprovedBody')
  root.add(mesh, mesh.skeleton.bones[0]!)
  root.updateMatrixWorld(true)
  return { root, mesh }
}

function instanceSlotMesh(root: THREE.Object3D, slot: StarterGearSlot): StarterGearMesh {
  const slotRoot = root.getObjectByName(SLOT_MESHES[slot])
  let mesh: StarterGearMesh | undefined
  slotRoot?.traverse((object) => { if (!mesh && object instanceof THREE.SkinnedMesh) mesh = object as StarterGearMesh })
  if (!mesh) throw new Error(`Instance slot has no skinned mesh: ${slot}.`)
  return mesh
}

function assetLoader(): GLTFLoader {
  return new GLTFLoader().register((parser: GLTFParser) => ({
    name: 'ASHVEIL_test_embedded_gear_image',
    loadTexture: (textureIndex: number) => {
      const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
      texture.needsUpdate = true
      parser.associations.set(texture, { textures: textureIndex })
      return Promise.resolve(texture)
    },
  }))
}

function glbSkinData(file: Buffer): { inverseBindHashes: string[]; jointNames: string[] } {
  let offset = 12
  let json: {
    accessors: { bufferView: number; byteOffset?: number; count: number }[]
    bufferViews: { byteOffset?: number }[]
    nodes: { name?: string }[]
    skins: { inverseBindMatrices: number; joints: number[] }[]
  } | undefined
  let binary: Buffer | undefined
  while (offset < file.length) {
    const length = file.readUInt32LE(offset)
    const type = file.toString('ascii', offset + 4, offset + 8)
    const chunk = file.subarray(offset + 8, offset + 8 + length)
    if (type === 'JSON') json = JSON.parse(chunk.toString('utf8').trim())
    if (type === 'BIN\0') binary = chunk
    offset += 8 + length
  }
  if (!json || !binary) throw new Error('Starter gear GLB is missing JSON or binary data.')
  const inverseBindHashes = [...new Set(json.skins.map((skin) => {
    const accessor = json!.accessors[skin.inverseBindMatrices]!
    const view = json!.bufferViews[accessor.bufferView]!
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
    const bytes = binary!.subarray(start, start + accessor.count * 16 * 4)
    return createHash('sha256').update(bytes).digest('hex')
  }))]
  const jointNames = json.skins[0]?.joints.map((node) => json!.nodes[node]?.name ?? '') ?? []
  return { inverseBindHashes, jointNames }
}

describe('starter gear asset contract', () => {
  it('pins and loads the shipped gear against the approved character', async () => {
    const directory = join(ROOT, 'public', 'gear', 'starter-leather')
    const file = readFileSync(join(directory, 'starter-leather.glb'))
    const gearManifest = validateStarterGearManifest(JSON.parse(readFileSync(join(directory, 'starter-leather.manifest.json'), 'utf8')))
    expect(file.byteLength).toBe(gearManifest.glb.bytes)
    expect(createHash('sha256').update(file).digest('hex')).toBe(gearManifest.glb.sha256)
    const skinData = glbSkinData(file)
    expect(skinData.inverseBindHashes).toEqual([gearManifest.inverseBindSha256])
    expect(skinData.jointNames).toEqual(gearManifest.jointNames)
    const gearData = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
    const gearTemplate = validateStarterGearTemplate(await assetLoader().parseAsync(gearData, ''), gearManifest)

    const bodyDirectory = join(ROOT, 'public', 'bodies', 'masculine-clean-v1')
    const bodyFile = readFileSync(join(bodyDirectory, 'masculine-clean-v1.glb'))
    const bodyManifest = validateApprovedManifest(JSON.parse(readFileSync(join(bodyDirectory, 'masculine-clean-v1.manifest.json'), 'utf8')))
    expect(gearManifest.bodySha256).toBe(bodyManifest.glb.sha256)
    const bodyData = bodyFile.buffer.slice(bodyFile.byteOffset, bodyFile.byteOffset + bodyFile.byteLength)
    const bodyGltf = await assetLoader().parseAsync(bodyData, '')
    const bodyTemplate = validateApprovedCharacterTemplate(bodyGltf, bodyManifest)
    const character = new ApprovedWorldCharacter(bodyTemplate, createExplorer({ x: 0, z: 0 }), gearTemplate)
    expect(character.gearAppearance).toEqual({
      chest: { equipped: true, primaryTint: null, trimTint: null },
      legs: { equipped: true, primaryTint: null, trimTint: null },
      boots: { equipped: true, primaryTint: null, trimTint: null },
      waist: { equipped: gearTemplate.meshes.has('waist'), primaryTint: null, trimTint: null },
    })
    character.dispose()
  }, 30_000)

  it('accepts the legacy three slots and optional waist while rejecting incomplete or over-budget manifests', () => {
    expect(validateStarterGearManifest(manifest()).slots.map((slot) => slot.slot)).toEqual(['chest', 'legs', 'boots'])
    expect(validateStarterGearManifest(manifest(true)).slots.map((slot) => slot.slot)).toEqual(STARTER_GEAR_SLOTS)
    expect(() => validateStarterGearManifest({ ...manifest(), slots: manifest().slots.slice(1) })).toThrow(/slot is incomplete/)
    expect(() => validateStarterGearManifest({ ...manifest(), budget: { triangles: 30_001, materials: 3 } })).toThrow(/budget/)
  })

  it('accepts semantic primary and trim primitives with arbitrary manifest mesh names', () => {
    const source = template({ includeWaist: true, chestTrim: true })
    source.meshes.get('chest')![0]!.name = 'StarterLeatherChestSurface'
    const renamedManifest = validateStarterGearManifest({
      ...source.manifest,
      slots: source.manifest.slots.map((record) => record.slot === 'chest'
        ? { ...record, mesh: 'StarterLeatherChestSurface' }
        : record),
    })
    const fitted = validateStarterGearTemplate({ scene: source.scene, animations: [] }, renamedManifest)
    expect(fitted.meshes.get('chest')?.[0]?.material).toHaveLength(2)
    expect([...fitted.dyeChannels.get('chest')!]).toEqual(['primary', 'trim'])
    expect([...fitted.dyeChannels.get('waist')!]).toEqual(['primary'])

    const unsupported = template()
    const chestMaterial = unsupported.meshes.get('chest')![0]!.material as StarterGearMaterial
    chestMaterial.name = 'Leather-ish'
    expect(() => validateStarterGearTemplate({ scene: unsupported.scene, animations: [] }, unsupported.manifest)).toThrow(/material name/)
  })

  it('checks raw exported skin weights without rewriting the manifest', () => {
    const manifestPath = join(ROOT, 'public', 'gear', 'starter-leather', 'starter-leather.manifest.json')
    const before = readFileSync(manifestPath)
    const check = spawnSync(process.execPath, [MANIFEST_SCRIPT, '--check'], { encoding: 'utf8' })
    expect(check.status, check.stderr).toBe(0)
    expect(readFileSync(manifestPath)).toEqual(before)

    const validation = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { validateRawSkinAttributes } from ${JSON.stringify(pathToFileURL(MANIFEST_SCRIPT).href)}
      const document = {
        accessors: [
          { bufferView: 0, componentType: 5121, count: 1, type: 'VEC4' },
          { bufferView: 1, componentType: 5126, count: 1, type: 'VEC4' },
        ],
        bufferViews: [
          { buffer: 0, byteOffset: 0, byteLength: 4 },
          { buffer: 0, byteOffset: 4, byteLength: 16 },
        ],
      }
      const binary = Buffer.alloc(20)
      const primitive = { attributes: { JOINTS_0: 0, WEIGHTS_0: 1 } }
      let rejected = false
      try { validateRawSkinAttributes(document, binary, primitive, 68, 1) }
      catch (error) { rejected = /non-unit raw skin weights/.test(String(error)) }
      if (!rejected) process.exit(2)
      binary.writeFloatLE(1, 4)
      validateRawSkinAttributes(document, binary, primitive, 68, 1)
    `], { encoding: 'utf8' })
    expect(validation.status, validation.stderr).toBe(0)
    expect(readFileSync(manifestPath)).toEqual(before)
  })

  it('rejects malformed weights, joint indices, and joint order', () => {
    const invalidWeights = template()
    invalidWeights.meshes.get('chest')![0]!.geometry.getAttribute('skinWeight').setX(0, Number.NaN)
    expect(() => validateStarterGearTemplate({ scene: invalidWeights.scene, animations: [] }, invalidWeights.manifest)).toThrow(/skin indices or weights/)

    const invalidIndices = template()
    invalidIndices.meshes.get('legs')![0]!.geometry.getAttribute('skinIndex').setX(0, 68)
    expect(() => validateStarterGearTemplate({ scene: invalidIndices.scene, animations: [] }, invalidIndices.manifest)).toThrow(/skin indices or weights/)

    const invalidOrder = template()
    invalidOrder.meshes.get('boots')![0]!.skeleton.bones[0]!.name = 'wrong'
    expect(() => validateStarterGearTemplate({ scene: invalidOrder.scene, animations: [] }, invalidOrder.manifest)).toThrow(/joint order/)
  })

  it('evicts a failed load and shares the successful retry', async () => {
    let fails = true
    const parsed = template()
    const fetcher = vi.fn(async (url: string) => {
      if (fails) throw new Error('offline')
      return url.endsWith('.json')
        ? { ok: true, json: async () => manifest(), arrayBuffer: async () => new ArrayBuffer(0) }
        : { ok: true, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(128) }
    })
    const loader = { parseAsync: vi.fn(async () => ({ scene: parsed.scene, animations: [] })) }
    const source = new StarterGearSource(loader, fetcher)
    await expect(source.load()).rejects.toThrow(/starter leather gear/)
    fails = false
    const loaded = source.load()
    expect(source.load()).toBe(loaded)
    await expect(loaded).resolves.toMatchObject({ manifest: parsed.manifest })
    expect(loader.parseAsync).toHaveBeenCalledOnce()
  })
})

describe('starter gear character instance', () => {
  it('loads the three-piece migration state without inventing an equipped waist', () => {
    const approved = body()
    const gear = new StarterGear(approved.root, BODY_HASH, template())
    expect(gear.appearanceState.waist).toEqual({ equipped: false, primaryTint: null, trimTint: null })
    expect(() => gear.setEquipped('waist', true)).toThrow(/Unknown starter gear slot/)
    gear.dispose()
  })

  it('rejects body, skeleton, inverse-bind, and bind-space mismatches', () => {
    expect(() => new StarterGear(body().root, HASH, template())).toThrow(/different approved body/)

    const wrongJoint = template()
    wrongJoint.meshes.get('chest')![0]!.skeleton.bones[0]!.name = 'wrong'
    expect(() => new StarterGear(body().root, BODY_HASH, wrongJoint)).toThrow(/approved skeleton/)

    const wrongInverse = template()
    wrongInverse.meshes.get('legs')![0]!.skeleton.boneInverses[0]!.elements[12] = 1
    expect(() => new StarterGear(body().root, BODY_HASH, wrongInverse)).toThrow(/inverse binds/)

    const wrongBind = template()
    wrongBind.meshes.get('boots')![0]!.bindMatrix.makeTranslation(1, 0, 0)
    wrongBind.meshes.get('boots')![0]!.bindMatrixInverse.copy(wrongBind.meshes.get('boots')![0]!.bindMatrix).invert()
    expect(() => new StarterGear(body().root, BODY_HASH, wrongBind)).toThrow(/bind space/)
  })

  it('supports all sixteen equipment combinations and keeps waist independent', () => {
    const approved = body()
    const gear = new StarterGear(approved.root, BODY_HASH, template({ includeWaist: true }))
    for (let mask = 0; mask < 16; mask += 1) {
      STARTER_GEAR_SLOTS.forEach((slot, index) => gear.setEquipped(slot, (mask & (1 << index)) !== 0))
      expect(STARTER_GEAR_SLOTS.map((slot) => gear.appearanceState[slot].equipped)).toEqual(
        STARTER_GEAR_SLOTS.map((_slot, index) => (mask & (1 << index)) !== 0),
      )
    }
    gear.setEquipped('chest', true)
    gear.setEquipped('legs', true)
    gear.setEquipped('waist', false)
    expect(gear.appearanceState.chest.equipped).toBe(true)
    expect(gear.appearanceState.legs.equipped).toBe(true)
    expect(gear.appearanceState.waist.equipped).toBe(false)
  })

  it('keeps visibility and material ownership separate between character instances', () => {
    const source = template()
    const firstBody = body()
    const secondBody = body()
    const first = new StarterGear(firstBody.root, BODY_HASH, source)
    const second = new StarterGear(secondBody.root, BODY_HASH, source)
    const firstChest = instanceSlotMesh(firstBody.root, 'chest')
    const secondChest = instanceSlotMesh(secondBody.root, 'chest')
    first.setEquipped('chest', false)
    expect(first.appearanceState.chest.equipped).toBe(false)
    expect(second.appearanceState.chest.equipped).toBe(true)
    expect(firstChest.material).not.toBe(secondChest.material)
    expect(firstChest.material).not.toBe(source.meshes.get('chest')![0]!.material)
    first.dispose()
    second.dispose()
  })

  it('keeps dyes separate from equipment and other character instances, then restores authored defaults', () => {
    const source = template({ includeWaist: true, chestTrim: true })
    const sourceMaterials = source.meshes.get('chest')![0]!.material as StarterGearMaterial[]
    sourceMaterials.find((entry) => entry.name === 'Starter Leather')!.color.set('#c08040')
    sourceMaterials.find((entry) => entry.name === 'Starter Trim')!.color.set('#8090a0')
    const firstBody = body()
    const secondBody = body()
    const first = new StarterGear(firstBody.root, BODY_HASH, source)
    const second = new StarterGear(secondBody.root, BODY_HASH, source)
    const firstChest = instanceSlotMesh(firstBody.root, 'chest')
    const secondChest = instanceSlotMesh(secondBody.root, 'chest')
    const firstMaterials = firstChest.material as StarterGearMaterial[]
    const secondMaterials = secondChest.material as StarterGearMaterial[]
    const firstPrimary = firstMaterials.find((entry) => entry.name === 'Starter Leather')!
    const firstTrim = firstMaterials.find((entry) => entry.name === 'Starter Trim')!
    const authoredPrimary = firstPrimary.color.clone()
    const authoredTrim = firstTrim.color.clone()
    const initialAppearance = first.appearanceState
    expect(first.appearanceState).toBe(initialAppearance)

    first.setDye('chest', 'primary', '#804020')
    expect(first.appearanceState).not.toBe(initialAppearance)
    first.setDye('chest', 'trim', '#204080')
    first.setEquipped('chest', false)
    expect(first.appearanceState.chest).toEqual({ equipped: false, primaryTint: '#804020', trimTint: '#204080' })
    expect(second.appearanceState.chest).toEqual({ equipped: true, primaryTint: null, trimTint: null })
    expect(firstPrimary.color.equals(new THREE.Color('#804020'))).toBe(true)
    expect(firstTrim.color.equals(new THREE.Color('#204080'))).toBe(true)
    expect(secondMaterials[0]!.color.equals(authoredPrimary)).toBe(true)

    first.clearDyes('chest')
    expect(first.appearanceState.chest).toEqual({ equipped: false, primaryTint: null, trimTint: null })
    expect(firstPrimary.color.equals(authoredPrimary)).toBe(true)
    expect(firstTrim.color.equals(authoredTrim)).toBe(true)
    expect(() => first.setDye('legs', 'trim', '#ffffff')).toThrow(/no trim dye channel/)
    expect(() => first.setDye('legs', 'primary', 'red')).toThrow(/Invalid starter gear dye tint/)
    first.dispose()
    second.dispose()
  })

  it('shares the approved skeleton, deforms with it, and disposes only instance materials', () => {
    const approved = body()
    const source = template()
    const sourceGeometry = source.meshes.get('chest')![0]!.geometry
    const disposeGeometry = vi.spyOn(sourceGeometry, 'dispose')
    const gear = new StarterGear(approved.root, BODY_HASH, source)
    const chest = instanceSlotMesh(approved.root, 'chest')
    const disposeMaterial = vi.spyOn(chest.material as THREE.Material, 'dispose')
    expect(chest.skeleton).toBe(approved.mesh.skeleton)
    expect(chest.parent?.parent).toBe(approved.mesh.parent)

    approved.mesh.skeleton.bones[0]!.position.x = 2
    approved.root.updateMatrixWorld(true)
    approved.mesh.skeleton.update()
    expect(chest.applyBoneTransform(1, new THREE.Vector3(1, 0, 0)).x).toBeCloseTo(3)

    gear.dispose()
    expect(disposeMaterial).toHaveBeenCalledOnce()
    expect(disposeGeometry).not.toHaveBeenCalled()
    expect(chest.parent).toBeNull()
  })
})
