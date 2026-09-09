import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { GearWardrobe } from '../src/world/gear'
import {
  GEAR_DYE_CHANNELS,
  GearSetSource,
  VISUAL_GEAR_SLOTS,
  sha256Hex,
  validateGearSetManifest,
  validateGearSetTemplate,
  validateRawNodeHierarchy,
  validateSelfContainedGearDocument,
  type GearMaterial,
  type GearPartManifest,
  type GearSetId,
  type GearSetTemplate,
  type VisualGearSlot,
} from '../src/world/gear-source'

const BODY_HASH = 'd586edf0e2b2e86247932a9f9e62f514463d6daa05569228f9076edb9f67479c'
const HASH = 'a'.repeat(64)
const RAW_JOINTS = [
  'root.x', 'spine_01.x', 'spine_02.x', 'spine_03.x', 'neck.x', 'head.x',
  'shoulder.l', 'shoulder.r',
  'thigh_stretch.l', 'leg_stretch.l', 'foot.l', 'toes_01.l',
  'thigh_stretch.r', 'leg_stretch.r', 'foot.r', 'toes_01.r',
  ...Array.from({ length: 52 }, (_, index) => `joint_${index}`),
]
const RUNTIME_JOINTS = RAW_JOINTS.map((name) => THREE.PropertyBinding.sanitizeNodeName(name))
const BOUNDS = { min: [0, 0, 0] as const, max: [1, 1, 0] as const }

interface SyntheticSet {
  readonly template: GearSetTemplate
  readonly materials: readonly GearMaterial[]
}

function geometry(triangleCount = 1): THREE.BufferGeometry {
  const result = new THREE.BufferGeometry()
  result.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
  result.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3))
  result.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2))
  result.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Array.from({ length: 12 }, () => 0), 4))
  result.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4))
  result.setIndex(Array.from({ length: triangleCount }, () => [0, 1, 2]).flat())
  return result
}

function materials(): GearMaterial[] {
  return [
    Object.assign(new THREE.MeshStandardMaterial({ color: '#a06040' }), { name: 'Mage Cloth A' }),
    Object.assign(new THREE.MeshStandardMaterial({ color: '#805030' }), { name: 'Mage Cloth B' }),
    Object.assign(new THREE.MeshStandardMaterial({ color: '#d0b060' }), { name: 'Mage Trim' }),
    Object.assign(new THREE.MeshStandardMaterial({ color: '#40a0ff', emissive: '#102040' }), { name: 'Arcane Core' }),
  ]
}

function skeleton(): THREE.Skeleton {
  const bones = RUNTIME_JOINTS.map((name) => Object.assign(new THREE.Bone(), { name }))
  return new THREE.Skeleton(bones, bones.map(() => new THREE.Matrix4()))
}

function body(): { root: THREE.Group; mesh: THREE.SkinnedMesh } {
  const root = new THREE.Group()
  const rig = skeleton()
  const mesh = new THREE.SkinnedMesh(geometry(), new THREE.MeshStandardMaterial())
  mesh.name = 'ApprovedBody'
  mesh.bind(rig, new THREE.Matrix4())
  root.add(mesh, ...rig.bones)
  root.updateMatrixWorld(true)
  return { root, mesh }
}

function slotsFor(id: GearSetId): readonly VisualGearSlot[] {
  return id === 'starter-leather' ? ['chest', 'waist', 'legs', 'boots'] : VISUAL_GEAR_SLOTS
}

function syntheticSet(id: GearSetId, options: { badRigidRest?: boolean; collisionPart?: boolean; rigidOffset?: number } = {}): SyntheticSet {
  const scene = new THREE.Group()
  const rig = skeleton()
  scene.add(...rig.bones)
  const sourceMaterials = materials()
  const records: Array<{ slot: VisualGearSlot; parts: GearPartManifest[] }> = []
  let drawCalls = 0
  let triangles = 0
  let instanceMaterials = 0

  for (const slot of slotsFor(id)) {
    const partRecords: GearPartManifest[] = []
    const rigidJoints = slot === 'head' ? ['head.x'] : slot === 'shoulders' ? ['shoulder.l', 'shoulder.r'] : []
    const partCount = slot === 'chest' && id === 'arcane-mage-tier' ? 4 : Math.max(1, rigidJoints.length)
    for (let index = 0; index < partCount; index += 1) {
      const node = options.collisionPart && id === 'arcane-mage-tier' && slot === 'chest' && index === 1
        ? 'ArcaneMageRobeSkirt' : `${id}-${slot}-${index}`
      const joint = rigidJoints[index]
      const partMaterial = joint ? sourceMaterials[slot === 'shoulders' ? 2 : 3]
        : slot === 'chest' && index === 0 ? sourceMaterials : sourceMaterials[0]
      const partTriangles = Array.isArray(partMaterial) ? partMaterial.length : 1
      const part = joint
        ? new THREE.Mesh(geometry(partTriangles), partMaterial)
        : new THREE.SkinnedMesh(geometry(partTriangles), partMaterial)
      if (Array.isArray(partMaterial)) {
        partMaterial.forEach((_material, materialIndex) => part.geometry.addGroup(materialIndex * 3, 3, materialIndex))
      }
      part.name = node
      if (part instanceof THREE.SkinnedMesh) part.bind(rig, new THREE.Matrix4())
      if (joint) {
        const parent = rig.bones[RAW_JOINTS.indexOf(joint)]!
        if (slot === 'head' && options.rigidOffset) part.position.x = options.rigidOffset
        parent.add(part)
      } else scene.add(part)
      const partDrawCalls = Array.isArray(part.material) ? part.material.length : 1
      drawCalls += partDrawCalls
      triangles += partTriangles
      partRecords.push({
        node,
        deformation: joint ? { kind: 'rigid', joint } : { kind: 'skinned' },
        triangles: partTriangles,
        bounds: slot === 'head' && options.rigidOffset
          ? { min: [options.rigidOffset, 0, 0], max: [options.rigidOffset + 1, 1, 0] }
          : BOUNDS,
      })
    }
    instanceMaterials += new Set(partRecords.flatMap((_record, index) => {
      const part = scene.getObjectByName(partRecords[index]!.node) as THREE.Mesh
      return Array.isArray(part.material) ? part.material : [part.material]
    })).size
    records.push({ slot, parts: partRecords })
  }
  scene.updateMatrixWorld(true)
  const manifest = validateGearSetManifest({
    schema: 'ashveil.gear-set.v2',
    id,
    body: 'masculine-clean-v1',
    bodySha256: BODY_HASH,
    glb: { file: `${id}.glb`, bytes: 128, sha256: HASH },
    jointNames: RAW_JOINTS,
    inverseBindSha256: HASH,
    materials: [
      { name: 'Mage Cloth A', dye: 'primary' },
      { name: 'Mage Cloth B', dye: 'primary' },
      { name: 'Mage Trim', dye: 'trim' },
      { name: 'Arcane Core', dye: null },
    ],
    slots: records,
    budget: { triangles, sourceMaterials: 4, drawCalls, instanceMaterials },
  }, id)
  const template = validateGearSetTemplate({ scene, animations: [] }, manifest)
  if (options.badRigidRest) {
    template.parts.get('head')![0]!.root.parent!.position.x = 0.25
    scene.updateMatrixWorld(true)
  }
  return { template, materials: sourceMaterials }
}

function clonedMaterials(root: THREE.Object3D, id: GearSetId, slot: VisualGearSlot): GearMaterial[] {
  const result = new Set<GearMaterial>()
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.name.includes(`gear:${id}:${slot}`)) return
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material]
    meshMaterials.forEach((material) => result.add(material as GearMaterial))
  })
  return [...result]
}

describe('generic gear set manifest', () => {
  it('accepts the eight-slot multipart mage contract with repeated dye roles and a fixed material', () => {
    const mage = syntheticSet('arcane-mage-tier').template
    expect(mage.parts.size).toBe(VISUAL_GEAR_SLOTS.length)
    expect(mage.parts.get('shoulders')).toHaveLength(2)
    expect(mage.parts.get('chest')).toHaveLength(4)
    expect(mage.dyeMaterials.get('chest')?.get('primary')).toHaveLength(2)
    expect(mage.manifest.materials.find((material) => material.name === 'Arcane Core')?.dye).toBeNull()
  })

  it('rejects missing slots, runtime name collisions, and dishonest total budgets', () => {
    const source = syntheticSet('arcane-mage-tier').template
    const manifest = source.manifest
    expect(() => validateGearSetManifest({ ...manifest, slots: manifest.slots.slice(1) }, 'arcane-mage-tier')).toThrow(/incomplete/)
    const collision = manifest.slots.map((slot, slotIndex) => ({
      ...slot,
      parts: slot.parts.map((part, partIndex) => slotIndex === 1 && partIndex === 0 ? { ...part, node: 'part.x' }
        : slotIndex === 0 && partIndex === 0 ? { ...part, node: 'partx' } : part),
    }))
    expect(() => validateGearSetManifest({ ...manifest, slots: collision }, 'arcane-mage-tier')).toThrow(/collide/)
    expect(() => validateGearSetManifest({ ...manifest, budget: { ...manifest.budget, triangles: manifest.budget.triangles + 1 } })).toThrow(/budget/)
    const dishonestInstances = validateGearSetManifest({
      ...manifest,
      budget: { ...manifest.budget, instanceMaterials: manifest.budget.instanceMaterials + 1 },
    })
    expect(() => validateGearSetTemplate({ scene: source.scene, animations: [] }, dishonestInstances)).toThrow(/runtime budget/)
    expect(() => validateGearSetManifest({
      ...manifest,
      jointNames: manifest.jointNames.map((name, index) => index === 8 ? 'joint.x' : index === 9 ? 'jointx' : name),
    })).toThrow(/joint manifest/)
  })

  it('checks a same-length GLB corruption before invoking the parser', async () => {
    const source = syntheticSet('arcane-mage-tier').template.manifest
    const valid = new Uint8Array(128)
    const corrupt = new Uint8Array(valid)
    corrupt[64] = 1
    const manifest = { ...source, glb: { ...source.glb, sha256: sha256Hex(valid) } }
    const fetcher = vi.fn(async (url: string) => url.endsWith('.json')
      ? { ok: true, json: async () => manifest, arrayBuffer: async () => new ArrayBuffer(0) }
      : { ok: true, json: async () => ({}), arrayBuffer: async () => corrupt.buffer })
    const loader = { parseAsync: vi.fn() }
    const gearSource = new GearSetSource(loader, fetcher)
    await expect(gearSource.load('arcane-mage-tier')).rejects.toThrow(/SHA-256/)
    expect(loader.parseAsync).not.toHaveBeenCalled()
  })

  it('rejects ids outside the trusted catalog before fetching', async () => {
    const fetcher = vi.fn()
    const gearSource = new GearSetSource({ parseAsync: vi.fn() }, fetcher)
    await expect(gearSource.load('../untrusted' as GearSetId)).rejects.toThrow(/trusted catalog/)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects cyclic, multiply-parented, out-of-range, and externally referenced raw sources', () => {
    expect(() => validateRawNodeHierarchy([{ children: [1] }, { children: [0] }])).toThrow(/cycle/)
    expect(() => validateRawNodeHierarchy([{ children: [2] }, {}, {}])).not.toThrow()
    expect(() => validateRawNodeHierarchy([{ children: [2] }, { children: [2] }, {}])).toThrow(/more than one parent/)
    expect(() => validateRawNodeHierarchy([{ children: [1] }])).toThrow(/invalid child index/)
    expect(() => validateSelfContainedGearDocument({ buffers: [{ uri: 'gear.bin' }] })).toThrow(/binary chunk/)
    expect(() => validateSelfContainedGearDocument({ buffers: [{}], images: [{ uri: 'crystal.png' }] })).toThrow(/binary chunk/)
    expect(() => validateSelfContainedGearDocument({ buffers: [{}], images: [{ bufferView: 4 }] })).not.toThrow()
  })

  it('rejects material arrays without exact render groups and rejects morph targets', () => {
    const grouped = syntheticSet('arcane-mage-tier').template
    const chest = grouped.parts.get('chest')![0]!.meshes[0]!
    chest.geometry.clearGroups()
    expect(() => validateGearSetTemplate({ scene: grouped.scene, animations: [] }, grouped.manifest)).toThrow(/material groups/)

    const morphed = syntheticSet('arcane-mage-tier').template
    const mesh = morphed.parts.get('hands')![0]!.meshes[0]!
    mesh.geometry.morphAttributes.position = [mesh.geometry.getAttribute('position').clone()]
    expect(() => validateGearSetTemplate({ scene: morphed.scene, animations: [] }, morphed.manifest)).toThrow(/morph targets/)
  })
})

describe('per-character gear wardrobe', () => {
  it('supports full-set and mixed per-slot selection without losing dyes', () => {
    const approved = body()
    const starter = syntheticSet('starter-leather')
    const mage = syntheticSet('arcane-mage-tier')
    const wardrobe = new GearWardrobe(approved.root, BODY_HASH)
    wardrobe.addSet(starter.template)
    wardrobe.addSet(mage.template)
    wardrobe.equipSet('starter-leather')
    expect(wardrobe.appearanceState.selected).toMatchObject({
      head: null, shoulders: null, chest: 'starter-leather', hands: null,
      waist: 'starter-leather', legs: 'starter-leather', boots: 'starter-leather', back: null,
    })

    wardrobe.equipSet('arcane-mage-tier')
    expect(Object.values(wardrobe.appearanceState.selected).every((id) => id === 'arcane-mage-tier')).toBe(true)
    wardrobe.setDye('chest', 'primary', '#204080')
    wardrobe.select('chest', 'starter-leather')
    wardrobe.setDye('chest', 'primary', '#804020')
    wardrobe.select('chest', 'arcane-mage-tier')
    expect(wardrobe.appearanceState.dyes['arcane-mage-tier']?.chest?.primaryTint).toBe('#204080')
    expect(wardrobe.appearanceState.dyes['starter-leather']?.chest?.primaryTint).toBe('#804020')
    expect(wardrobe.appearanceState.selected.legs).toBe('arcane-mage-tier')
    const mageChest = clonedMaterials(approved.root, 'arcane-mage-tier', 'chest')
    expect(mageChest.filter((material) => ['Mage Cloth A', 'Mage Cloth B'].includes(material.name))
      .every((material) => material.color.equals(new THREE.Color('#204080')))).toBe(true)
    expect(mageChest.find((material) => material.name === 'Arcane Core')?.color.equals(new THREE.Color('#40a0ff'))).toBe(true)
    expect(mageChest.find((material) => material.name === 'Arcane Core')?.emissive.equals(new THREE.Color('#102040'))).toBe(true)
    wardrobe.setDye('chest', 'primary', null)
    expect(mageChest.find((material) => material.name === 'Mage Cloth A')?.color.equals(new THREE.Color('#a06040'))).toBe(true)
    wardrobe.equipSet('starter-leather')
    expect(wardrobe.appearanceState.selected).toEqual({
      head: null,
      shoulders: null,
      chest: 'starter-leather',
      hands: null,
      waist: 'starter-leather',
      legs: 'starter-leather',
      boots: 'starter-leather',
      back: null,
    })
  })

  it('updates every robe capsule for mixed leg and boot selections and disposes shadow materials', () => {
    const approved = body()
    const wardrobe = new GearWardrobe(approved.root, BODY_HASH)
    wardrobe.addSet(syntheticSet('starter-leather').template)
    const mage = syntheticSet('arcane-mage-tier', { collisionPart: true }).template
    wardrobe.addSet(mage)
    wardrobe.equipSet('arcane-mage-tier')

    const robeRoot = approved.root.getObjectByName('gear:arcane-mage-tier:chest:skinned:ArcaneMageRobeSkirt')!
    const robe = robeRoot.children.find((child): child is THREE.SkinnedMesh => child instanceof THREE.SkinnedMesh)!
    const sourceRobeGeometry = mage.parts.get('chest')?.[1]?.meshes[0]?.geometry
    expect(robe).toBeDefined()
    expect(robe.geometry).not.toBe(sourceRobeGeometry)
    expect(robe.geometry.getAttribute('gearCollisionScope').array)
      .toEqual(new Uint8Array(robe.geometry.getAttribute('position').count).fill(1))
    expect(robe.customDepthMaterial).toBeInstanceOf(THREE.MeshDepthMaterial)
    expect(robe.customDistanceMaterial).toBeInstanceOf(THREE.MeshDistanceMaterial)

    const material = (Array.isArray(robe.material) ? robe.material[0] : robe.material) as GearMaterial
    const shader = {
      uniforms: {},
      vertexShader: '#include <skinning_pars_vertex>\nvoid main(){\n#include <skinning_vertex>\n}',
      fragmentShader: '',
    }
    material.onBeforeCompile(shader as never, {} as THREE.WebGLRenderer)
    const collisionUniforms = shader.uniforms as Record<string, { value: Float32Array }>
    const starts = collisionUniforms.gearCapsuleStartRadii!.value
    const ends = collisionUniforms.gearCapsuleEndRadii!.value
    expect(starts).toEqual(new Float32Array([0.15, 0.15, 0.165, 0.165, 0.145, 0.145]))
    expect(ends).toEqual(new Float32Array([0.145, 0.145, 0.145, 0.145, 0.14, 0.14]))

    wardrobe.select('boots', null)
    expect(starts).toEqual(new Float32Array([0.15, 0.15, 0.145, 0.145, 0.085, 0.085]))
    expect(ends).toEqual(new Float32Array([0.145, 0.145, 0.13, 0.13, 0.075, 0.075]))
    wardrobe.select('legs', null)
    expect(starts).toEqual(new Float32Array([0.12, 0.12, 0.075, 0.075, 0.085, 0.085]))
    expect(ends).toEqual(new Float32Array([0.095, 0.095, 0.085, 0.085, 0.075, 0.075]))
    wardrobe.select('legs', 'starter-leather')
    expect(starts).toEqual(new Float32Array([0.13, 0.13, 0.09, 0.09, 0.085, 0.085]))
    expect(ends).toEqual(new Float32Array([0.11, 0.11, 0.095, 0.095, 0.075, 0.075]))
    wardrobe.select('boots', 'starter-leather')
    expect(starts).toEqual(new Float32Array([0.13, 0.13, 0.09, 0.09, 0.11, 0.11]))
    expect(ends).toEqual(new Float32Array([0.11, 0.11, 0.105, 0.105, 0.1, 0.1]))
    wardrobe.select('boots', 'arcane-mage-tier')
    expect(starts).toEqual(new Float32Array([0.13, 0.13, 0.165, 0.165, 0.145, 0.145]))
    expect(ends).toEqual(new Float32Array([0.11, 0.11, 0.145, 0.145, 0.14, 0.14]))

    const fittedRoot = approved.root.getObjectByName(
      'gear:arcane-mage-tier:chest:skinned:arcane-mage-tier-chest-0',
    )!
    const fitted = fittedRoot.children.find((child): child is THREE.SkinnedMesh => child instanceof THREE.SkinnedMesh)!
    const sourceFittedGeometry = mage.parts.get('chest')?.[0]?.meshes[0]?.geometry
    expect(Array.isArray(fitted.material) ? fitted.material.includes(material) : fitted.material === material).toBe(true)
    expect(fitted.geometry).not.toBe(sourceFittedGeometry)
    expect(fitted.geometry.getAttribute('gearCollisionScope').array)
      .toEqual(new Uint8Array(fitted.geometry.getAttribute('position').count))
    expect(shader.vertexShader).toContain('if (gearCollisionScope > 0.5')
    expect(shader.uniforms).not.toHaveProperty('gearCapsuleEnabled')
    const shadowShader = {
      uniforms: {},
      vertexShader: '#include <skinning_pars_vertex>\nvoid main(){\n#include <skinning_vertex>\n}',
      fragmentShader: '',
    }
    robe.customDepthMaterial!.onBeforeCompile(shadowShader as never, {} as THREE.WebGLRenderer)
    expect(shadowShader.vertexShader).toContain('if (gearCollisionScope > 0.5')
    expect(shadowShader.uniforms).not.toHaveProperty('gearCapsuleEnabled')

    const disposeDepth = vi.spyOn(robe.customDepthMaterial!, 'dispose')
    const disposeDistance = vi.spyOn(robe.customDistanceMaterial!, 'dispose')
    const disposeRobeGeometry = vi.spyOn(robe.geometry, 'dispose')
    const disposeFittedGeometry = vi.spyOn(fitted.geometry, 'dispose')
    const disposeSourceRobeGeometry = vi.spyOn(sourceRobeGeometry!, 'dispose')
    const disposeSourceFittedGeometry = vi.spyOn(sourceFittedGeometry!, 'dispose')
    wardrobe.dispose()
    expect(disposeDepth).toHaveBeenCalledOnce()
    expect(disposeDistance).toHaveBeenCalledOnce()
    expect(disposeRobeGeometry).toHaveBeenCalledOnce()
    expect(disposeFittedGeometry).toHaveBeenCalledOnce()
    expect(disposeSourceRobeGeometry).not.toHaveBeenCalled()
    expect(disposeSourceFittedGeometry).not.toHaveBeenCalled()
    expect(robe.geometry).toBe(sourceRobeGeometry)
    expect(fitted.geometry).toBe(sourceFittedGeometry)
    expect(robe.customDepthMaterial).toBeUndefined()
    expect(robe.customDistanceMaterial).toBeUndefined()
  })

  it('attaches both shoulder parts to their own bones and rejects unavailable selection atomically', () => {
    const approved = body()
    const wardrobe = new GearWardrobe(approved.root, BODY_HASH)
    wardrobe.addSet(syntheticSet('starter-leather').template)
    wardrobe.addSet(syntheticSet('arcane-mage-tier', { rigidOffset: 0.25 }).template)
    wardrobe.equipSet('arcane-mage-tier')
    const left = approved.mesh.skeleton.bones[RAW_JOINTS.indexOf('shoulder.l')]!
    const right = approved.mesh.skeleton.bones[RAW_JOINTS.indexOf('shoulder.r')]!
    expect(left.children.some((child) => child.name.includes('gear:arcane-mage-tier:shoulders'))).toBe(true)
    expect(right.children.some((child) => child.name.includes('gear:arcane-mage-tier:shoulders'))).toBe(true)
    const head = approved.mesh.skeleton.bones[RAW_JOINTS.indexOf('head.x')]!
    expect(head.children.find((child) => child.name.includes('gear:arcane-mage-tier:head'))?.position.x).toBeCloseTo(0.25)
    left.position.x = 2
    approved.root.updateMatrixWorld(true)
    expect(left.children.find((child) => child.name.includes('gear:'))!.getWorldPosition(new THREE.Vector3()).x).toBeCloseTo(2)

    const before = wardrobe.appearanceState
    expect(() => wardrobe.select('head', 'starter-leather')).toThrow(/no head appearance/)
    expect(wardrobe.appearanceState).toEqual(before)
    expect(() => wardrobe.equipSet('../untrusted' as GearSetId)).toThrow(/not loaded/)
    expect(wardrobe.appearanceState).toEqual(before)
  })

  it('removes staged roots after a rigid rest-space failure', () => {
    const approved = body()
    const wardrobe = new GearWardrobe(approved.root, BODY_HASH)
    wardrobe.addSet(syntheticSet('starter-leather').template)
    wardrobe.equipSet('starter-leather')
    const before = wardrobe.appearanceState
    const broken = syntheticSet('arcane-mage-tier', { badRigidRest: true, collisionPart: true }).template
    const reordered: GearSetTemplate = {
      ...broken,
      parts: new Map([
        ['chest', broken.parts.get('chest')!],
        ...[...broken.parts].filter(([slot]) => slot !== 'chest'),
      ]),
    }
    const dispose = vi.spyOn(THREE.MeshStandardMaterial.prototype, 'dispose')
    const disposeDepth = vi.spyOn(THREE.MeshDepthMaterial.prototype, 'dispose')
    const disposeDistance = vi.spyOn(THREE.MeshDistanceMaterial.prototype, 'dispose')
    expect(() => wardrobe.addSet(reordered)).toThrow(/rest space/)
    expect(dispose).toHaveBeenCalled()
    expect(disposeDepth).toHaveBeenCalled()
    expect(disposeDistance).toHaveBeenCalled()
    dispose.mockRestore()
    disposeDepth.mockRestore()
    disposeDistance.mockRestore()
    expect(wardrobe.setIds).toEqual(['starter-leather'])
    expect(wardrobe.appearanceState).toEqual(before)
    const leaked: THREE.Object3D[] = []
    approved.root.traverse((object) => { if (object.name.startsWith('gear:arcane-mage-tier')) leaked.push(object) })
    expect(leaked).toEqual([])
  })

  it('rejects a skinned part when the approved inverse binds differ', () => {
    const approved = body()
    approved.mesh.skeleton.boneInverses[0]!.elements[12] = 0.1
    const wardrobe = new GearWardrobe(approved.root, BODY_HASH)
    expect(() => wardrobe.addSet(syntheticSet('arcane-mage-tier').template)).toThrow(/inverse binds/)
    const leaked: THREE.Object3D[] = []
    approved.root.traverse((object) => { if (object.name.startsWith('gear:arcane-mage-tier')) leaked.push(object) })
    expect(leaked).toEqual([])
  })

  it('keeps cloned materials isolated and disposes no source geometry or materials', () => {
    const source = syntheticSet('arcane-mage-tier')
    const firstBody = body()
    const secondBody = body()
    const first = new GearWardrobe(firstBody.root, BODY_HASH)
    const second = new GearWardrobe(secondBody.root, BODY_HASH)
    first.addSet(source.template)
    second.addSet(source.template)
    first.equipSet('arcane-mage-tier')
    second.equipSet('arcane-mage-tier')
    const firstMaterial = clonedMaterials(firstBody.root, 'arcane-mage-tier', 'chest')[0]!
    const secondMaterial = clonedMaterials(secondBody.root, 'arcane-mage-tier', 'chest')[0]!
    expect(firstMaterial).not.toBe(secondMaterial)
    expect(firstMaterial).not.toBe(source.materials[0])
    const disposeClone = vi.spyOn(firstMaterial, 'dispose')
    const disposeSource = vi.spyOn(source.materials[0]!, 'dispose')
    let sourceGeometry: THREE.BufferGeometry | undefined
    source.template.parts.get('chest')?.[0]?.root.traverse((object) => {
      if (!sourceGeometry && object instanceof THREE.Mesh) sourceGeometry = object.geometry
    })
    const disposeGeometry = vi.spyOn(sourceGeometry!, 'dispose')
    first.dispose()
    expect(disposeClone).toHaveBeenCalledOnce()
    expect(disposeSource).not.toHaveBeenCalled()
    expect(disposeGeometry).not.toHaveBeenCalled()
    second.dispose()
  })

  it('exposes only the two retained dye channels', () => {
    expect(GEAR_DYE_CHANNELS).toEqual(['primary', 'trim'])
  })
})
