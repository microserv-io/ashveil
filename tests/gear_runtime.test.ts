import { join } from 'node:path'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { runInNewContext } from 'node:vm'
import { setFlagsFromString } from 'node:v8'
import { readGlb, loadGlbSkeleton, type GlbSkinnedMesh } from '../scripts/art/glb'
import {
  applyBodyMasks,
  GEAR_SLOTS,
  removePiece,
  resetWornPieces,
  skinnedMeshesOf,
  updateWornPieces,
  viewMaterialsWith,
  wearPiece,
  type DrapeDefinition,
  type WornPiece,
} from '../src/render/gear'
import type { RigInput } from '../src/render/riginput'
import { bindDrapeSurface, MAX_DRAPE_SUPPORTS_PER_SEGMENT, MAX_DRAPE_SUPPORT_TERMS } from '../src/render/drapesurface'

/**
 * The runtime half of gear, on the real body rather than a shape invented here.
 *
 * The piece is built from the body's own attributes because that is the one thing
 * a Node test can be sure matches what the fitter exports: the same joint list,
 * the same order, the same influence layout.
 */

const MASCULINE = join(import.meta.dirname, '..', 'public', 'bodies', 'masculine-v3', 'masculine-v3.glb')
const BODY_MESH = 'Body'

interface TestBody {
  readonly root: THREE.Object3D
  readonly meshes: readonly THREE.SkinnedMesh[]
  readonly source: readonly GlbSkinnedMesh[]
}

function geometryOf(mesh: GlbSkinnedMesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3))
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(mesh.joints, 4))
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(mesh.weights, 4))
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1))
  return geometry
}

function buildBody(): TestBody {
  const glb = readGlb(MASCULINE)
  const tree = loadGlbSkeleton(MASCULINE)
  const bones = glb.skin.jointNames.map((name) => tree.getObjectByName(name) as THREE.Bone)
  const inverses = bones.map((_, at) => new THREE.Matrix4().fromArray(glb.skin.inverseBinds, at * 16))
  const skeleton = new THREE.Skeleton(bones, inverses)

  const root = new THREE.Group()
  root.add(tree)
  const meshes = glb.meshes.map((source) => {
    const mesh = new THREE.SkinnedMesh(geometryOf(source), new THREE.MeshToonMaterial())
    mesh.name = source.name
    root.add(mesh)
    mesh.bind(skeleton)
    return mesh
  })
  return { root, meshes, source: glb.meshes }
}

/** A piece the fitter could have produced: the body's own shell, on its own skeleton. */
function buildPiece(reorder = false): THREE.Object3D {
  const glb = readGlb(MASCULINE)
  const tree = loadGlbSkeleton(MASCULINE)
  const names = [...glb.skin.jointNames]
  if (reorder) [names[1], names[2]] = [names[2]!, names[1]!]
  const bones = names.map((name) => tree.getObjectByName(name) as THREE.Bone)

  const scene = new THREE.Group()
  scene.add(tree)
  // A piece reaches wearPiece stylised, the way the loader hands it over.
  const mesh = new THREE.SkinnedMesh(geometryOf(glb.meshes[0]!), new THREE.MeshToonMaterial())
  mesh.name = 'proxy'
  scene.add(mesh)
  mesh.bind(new THREE.Skeleton(bones))
  return scene
}

/** A sash the fitter could have hung off the pelvis: two bones, hanging straight down. */
const SASH: DrapeDefinition = {
  name: 'sash',
  attachBone: 'pelvis',
  bones: ['drape_sash_1', 'drape_sash_2'],
  segmentLength: 0.12,
  toward: [0, 0, 1],
}

const SURFACE_SASH: DrapeDefinition = {
  ...SASH,
  supports: [{
    segment: 0,
    terms: [{ joint: 'drape_sash_1', weight: 1, position: [0, 1, 2] }],
  }],
  colliders: [{ from: 'pelvis', to: 'chest', radius: 0.5 }],
}

/**
 * The same proxy piece with a drape chain appended to its skin, which is what the
 * fitter exports for a piece with hanging cloth: the body's joints in the body's
 * order, then the chain, parented under the bone it hangs from.
 */
function buildDrapedPiece(drape: DrapeDefinition = SASH): THREE.Object3D {
  const glb = readGlb(MASCULINE)
  const tree = loadGlbSkeleton(MASCULINE)
  const bones = glb.skin.jointNames.map((name) => tree.getObjectByName(name) as THREE.Bone)
  let above = tree.getObjectByName(drape.attachBone) as THREE.Object3D
  const extras = drape.bones.map((name, at) => {
    const bone = new THREE.Bone()
    bone.name = name
    bone.position.set(0, at === 0 ? 0 : -drape.segmentLength, 0)
    above.add(bone)
    above = bone
    return bone
  })
  tree.updateMatrixWorld(true)

  const scene = new THREE.Group()
  scene.add(tree)
  const mesh = new THREE.SkinnedMesh(geometryOf(glb.meshes[0]!), new THREE.MeshToonMaterial())
  mesh.name = 'proxy'
  scene.add(mesh)
  mesh.bind(new THREE.Skeleton([...bones, ...extras]))
  return scene
}

function wearDrape(body: TestBody, drapes: readonly DrapeDefinition[] = [SASH]): WornPiece {
  return wearPiece(body.root, {
    slot: 'waist', scene: buildDrapedPiece(drapes[0] ?? SASH), covers: ['waist'], hides: {}, drapes,
  })
}

function rigInput(time: number): RigInput {
  return {
    state: 'moving', speed: 3, dashing: false, facingDelta: 0, phase: null, hitAge: null,
    ailments: [], time, seed: 1, castLeft: 0, recovering: false,
  }
}

/** Every vertex of the body mesh whose y sits in a band, standing in for a fitted region. */
function maskBand(body: TestBody, low: number, high: number): number[] {
  const positions = body.source.find((mesh) => mesh.name === BODY_MESH)!.positions
  const masked: number[] = []
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    const y = positions[vertex * 3 + 1]!
    if (y >= low && y <= high) masked.push(vertex)
  }
  return masked
}

/** Masking reads nothing off a worn piece but its `hides`, so a stand-in needs no mesh. */
function masksFor(vertices: number[], mesh = BODY_MESH): Pick<WornPiece, 'hides'>[] {
  return [{ hides: { [mesh]: vertices } }]
}

function indexCount(mesh: THREE.SkinnedMesh): number {
  return mesh.geometry.getIndex()!.count
}

describe('wearing a piece on a fitted body', () => {
  it('binds the piece to the body’s own Skeleton object', () => {
    const body = buildBody()
    const worn = wearPiece(body.root, { slot: 'chest', scene: buildPiece(), covers: ['chest'], hides: {} })

    expect(worn.mesh.skeleton).toBe(body.meshes[0]!.skeleton)
    expect(worn.mesh.parent).toBe(body.meshes[0]!.parent)
    expect(worn.mesh.bindMatrix.equals(body.meshes[0]!.bindMatrix)).toBe(true)
  })

  it('shares the piece geometry and clones only its material', () => {
    const body = buildBody()
    const source = buildPiece()
    const piece = skinnedMeshesOf(source)[0]!
    const worn = wearPiece(body.root, { slot: 'chest', scene: source, covers: ['chest'], hides: {} })

    expect(worn.mesh.geometry).toBe(piece.geometry)
    expect(worn.material).not.toBe(piece.material)
  })

  it('names the bone when the piece’s joints are out of order', () => {
    const body = buildBody()
    expect(() => wearPiece(body.root, { slot: 'chest', scene: buildPiece(true), covers: ['chest'], hides: {} }))
      .toThrow(/chest bone 1 is "spine", the body has "pelvis"/)
  })

  it('refuses a piece that arrives as several meshes', () => {
    const body = buildBody()
    const scene = buildPiece()
    scene.add(skinnedMeshesOf(buildPiece())[0]!)
    expect(() => wearPiece(body.root, { slot: 'chest', scene, covers: ['chest'], hides: {} }))
      .toThrow(/chest piece is 2 meshes/)
  })

  it('adds exactly one draw call per worn piece and takes it back off', () => {
    const body = buildBody()
    const before = skinnedMeshesOf(body.root).length

    const chest = wearPiece(body.root, { slot: 'chest', scene: buildPiece(), covers: ['chest'], hides: {} })
    expect(skinnedMeshesOf(body.root)).toHaveLength(before + 1)
    const legs = wearPiece(body.root, { slot: 'legs', scene: buildPiece(), covers: ['legs'], hides: {} })
    expect(skinnedMeshesOf(body.root)).toHaveLength(before + 2)

    removePiece(body.root, chest)
    removePiece(body.root, legs)
    expect(skinnedMeshesOf(body.root)).toHaveLength(before)
  })
})

/**
 * Hanging cloth rides its own bones, so the piece cannot be bound to the body's
 * `Skeleton` any more: it gets one of its own, the body's bones plus the chain.
 * The body's skeleton is shared by every mesh on that body and by nothing else,
 * and a piece that grew it would drag the chain onto the bare skin as well.
 */
describe('wearing a piece with a drape', () => {
  it('enforces the bounded support and LBS-term budgets at bind time', () => {
    const body = buildBody()
    const skeleton = body.meshes[0]!.skeleton
    const term = { joint: 'pelvis', weight: 1, position: [0, 1, 0] }
    expect(() => bindDrapeSurface([{
      segment: 0,
      terms: Array.from({ length: MAX_DRAPE_SUPPORT_TERMS + 1 }, () => term),
    }], skeleton)).toThrow(/skin terms/)
    expect(() => bindDrapeSurface(Array.from({ length: MAX_DRAPE_SUPPORTS_PER_SEGMENT + 1 }, () => ({
      segment: 0, terms: [term],
    })), skeleton)).toThrow(/exceeds .* supports/)
    expect(() => bindDrapeSurface([{ segment: 2, terms: [term] }], skeleton, 2))
      .toThrow(/support segment is out of range/)
  })

  it('binds to a skeleton of the body’s bones plus the chain’s, leaving the body’s alone', () => {
    const body = buildBody()
    const skeleton = body.meshes[0]!.skeleton
    const bones = skeleton.bones.length
    const worn = wearDrape(body)

    expect(worn.mesh.skeleton).not.toBe(skeleton)
    expect(worn.mesh.skeleton.bones).toHaveLength(bones + SASH.bones.length)
    expect(worn.mesh.skeleton.bones.slice(0, bones)).toEqual(skeleton.bones)
    expect(worn.mesh.skeleton.bones.slice(bones).map((bone) => bone.name)).toEqual([...SASH.bones])
    expect(skeleton.bones).toHaveLength(bones)
  })

  it('hangs the chain off the body’s own attach bone and takes it back off', () => {
    const body = buildBody()
    const skeleton = body.meshes[0]!.skeleton
    const attach = skeleton.bones.find((bone) => bone.name === SASH.attachBone)!
    const children = attach.children.length

    const worn = wearDrape(body)
    expect(attach.children).toHaveLength(children + 1)
    expect(worn.drapes).toHaveLength(1)
    expect(worn.drapes[0]!.bones.map((bone) => bone.name)).toEqual([...SASH.bones])
    expect(worn.drapes[0]!.bones[0]!.parent).toBe(attach)
    expect(worn.drapes[0]!.bones[1]!.parent).toBe(worn.drapes[0]!.bones[0])

    removePiece(body.root, worn)
    expect(attach.children).toHaveLength(children)
    expect(skeleton.bones).toHaveLength(body.meshes[0]!.skeleton.bones.length)
  })

  /** The chain's inverse binds are the piece's; the body's have to survive untouched. */
  it('keeps the body’s inverse binds and takes the chain’s from the piece', () => {
    const body = buildBody()
    const skeleton = body.meshes[0]!.skeleton
    const worn = wearDrape(body)
    const inverses = worn.mesh.skeleton.boneInverses

    expect(inverses).toHaveLength(skeleton.bones.length + SASH.bones.length)
    expect(inverses.slice(0, skeleton.bones.length)).toEqual(skeleton.boneInverses)
  })

  it('refuses an extra joint no drape declares', () => {
    const body = buildBody()
    expect(() => wearPiece(body.root, {
      slot: 'waist', scene: buildDrapedPiece(), covers: ['waist'], hides: {}, drapes: [],
    })).toThrow(/waist carries an undeclared extra joint "drape_sash_1"/)
  })

  it('refuses drape declarations the piece cannot safely drive', () => {
    const body = buildBody()
    expect(() => wearPiece(body.root, {
      slot: 'waist', scene: buildPiece(), covers: ['waist'], hides: {}, drapes: [SASH],
    })).toThrow(/declares drapes but its piece carries no drape joints/)

    const tooMany = {
      ...SASH,
      bones: Array.from({ length: 7 }, (_, at) => `drape_sash_${at + 1}`),
    }
    expect(() => wearPiece(body.root, {
      slot: 'waist', scene: buildDrapedPiece(tooMany), covers: ['waist'], hides: {}, drapes: [tooMany],
    })).toThrow(/has 7 segments, expected 1-6/)
  })

  it('swings the chain when the body it hangs on moves, and puts it back on reset', () => {
    const body = buildBody()
    const worn = wearDrape(body)
    const rest = worn.drapes[0]!.bones.map((bone) => bone.quaternion.clone())

    for (let frame = 1; frame <= 60; frame++) {
      body.root.position.z = 0.5 * 4 * (frame / 60) * (frame / 60)
      body.root.updateMatrixWorld(true)
      updateWornPieces([worn], rigInput(frame / 60), 1 / 60)
    }
    const swung = worn.drapes[0]!.state.swing
    expect(Math.abs(swung[0]!), 'the chain has to have moved off the vertical').toBeGreaterThan(0.05)

    resetWornPieces([worn])
    expect([...swung]).toEqual([0, 0])
    worn.drapes[0]!.bones.forEach((bone, at) => {
      expect(bone.quaternion.angleTo(rest[at]!), `bone ${at}`).toBeLessThan(1e-5)
    })
  })

  it('solves fitted cloth surfaces without pushing their invisible centerlines', () => {
    const body = buildBody()
    const worn = wearDrape(body, [SURFACE_SASH])

    for (let frame = 1; frame <= 120; frame++) {
      body.root.updateMatrixWorld(true)
      updateWornPieces([worn], rigInput(frame / 60), 1 / 60)
    }

    expect(Math.max(...worn.drapes[0]!.state.swing.map(Math.abs))).toBeLessThan(1e-4)
    expect(Math.max(...worn.drapes[0]!.state.side.map(Math.abs))).toBeLessThan(1e-4)
  })

  /** Sim time, never the render delta: two clients at different frame rates must agree. */
  it('steps on the sim time it is given and not on the delta', () => {
    const sample = (delta: number): number => {
      const body = buildBody()
      const worn = wearDrape(body)
      for (let frame = 1; frame <= 60; frame++) {
        body.root.position.z = frame / 60
        body.root.updateMatrixWorld(true)
        updateWornPieces([worn], rigInput(frame / 60), delta)
      }
      return worn.drapes[0]!.state.swing[0]!
    }
    expect(sample(1 / 60)).toBe(sample(1 / 240))
  })

  /**
   * A cape is a sheet, not a solid. Letting it hide the tunic under it cut the
   * tunic's whole back away and then swung off to show the hole through the cape's
   * own lining, which read as a field of shards from behind.
   */
  it('hides nothing below it until the fitter says it may', () => {
    const body = buildBody()
    expect(wearDrape(body).hidesPieces, 'a drape keeps its hands off what is under it').toBe(false)

    const plain = wearPiece(body.root, { slot: 'chest', scene: buildPiece(), covers: ['chest'], hides: {} })
    expect(plain.hidesPieces, 'a piece that cannot move still hides').toBe(true)

    const told = wearPiece(body.root, {
      slot: 'legs', scene: buildDrapedPiece(), covers: ['legs'], hides: {}, drapes: [SASH], hidesPieces: true,
    })
    expect(told.hidesPieces, 'and the fitter can say otherwise').toBe(true)
  })

  it('leaves a piece with no drape bound to the body’s own skeleton', () => {
    const body = buildBody()
    const worn = wearPiece(body.root, { slot: 'chest', scene: buildPiece(), covers: ['chest'], hides: {} })
    expect(worn.mesh.skeleton).toBe(body.meshes[0]!.skeleton)
    expect(worn.drapes).toEqual([])
    updateWornPieces([worn], rigInput(1), 1 / 60)
  })

  it('allocates no growing heap while updating a bound chain', () => {
    setFlagsFromString('--expose_gc')
    const collect = runInNewContext('gc') as () => void
    const body = buildBody()
    const worn = wearDrape(body)
    const input = rigInput(0) as { time: number }
    const walk = (steps: number): void => {
      for (let frame = 0; frame < steps; frame++) {
        input.time += 1 / 60
        updateWornPieces([worn], input as RigInput, 1 / 60)
      }
    }
    walk(2_000)
    collect()
    const before = process.memoryUsage().heapUsed
    walk(20_000)
    collect()
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(256 * 1024)
  })
})

describe('masking the body under a worn slot', () => {
  it('drops exactly the triangles whose three vertices are masked', () => {
    const body = buildBody()
    const mesh = body.meshes.find((entry) => entry.name === BODY_MESH)!
    const original = indexCount(mesh)
    const masked = maskBand(body, 0.4, 1.1)
    const hidden = new Set(masked)

    const indices = body.source.find((entry) => entry.name === BODY_MESH)!.indices
    let expected = 0
    for (let at = 0; at < indices.length; at += 3) {
      if (hidden.has(indices[at]!) && hidden.has(indices[at + 1]!) && hidden.has(indices[at + 2]!)) expected += 3
    }
    expect(expected, 'the band must actually cover whole triangles').toBeGreaterThan(0)

    applyBodyMasks(body.root, masksFor(masked))
    expect(indexCount(mesh)).toBe(original - expected)
  })

  it('restores the original index when the slot comes off', () => {
    const body = buildBody()
    const mesh = body.meshes.find((entry) => entry.name === BODY_MESH)!
    const original = mesh.geometry
    const masks = masksFor(maskBand(body, 0.4, 1.1))

    applyBodyMasks(body.root, masks)
    applyBodyMasks(body.root, [])
    expect(mesh.geometry).toBe(original)
    expect(indexCount(mesh)).toBe(original.getIndex()!.count)
  })

  it('shares every attribute with the unmasked geometry', () => {
    const body = buildBody()
    const mesh = body.meshes.find((entry) => entry.name === BODY_MESH)!
    const original = mesh.geometry

    applyBodyMasks(body.root, masksFor(maskBand(body, 0.4, 1.1)))
    expect(mesh.geometry).not.toBe(original)
    for (const name of ['position', 'normal', 'skinIndex', 'skinWeight']) {
      expect(mesh.geometry.getAttribute(name), name).toBe(original.getAttribute(name))
    }
  })

  it('leaves a mesh no worn piece hides untouched', () => {
    const body = buildBody()
    const head = body.meshes.find((entry) => entry.name === 'Head')!
    const original = head.geometry

    applyBodyMasks(body.root, masksFor(maskBand(body, 0.4, 1.1)))
    expect(head.geometry).toBe(original)
  })

  /** Two pieces over one mesh hide the union, not whichever was applied last. */
  it('takes the union of what every worn piece hides', () => {
    const body = buildBody()
    const mesh = body.meshes.find((entry) => entry.name === BODY_MESH)!
    const lower = maskBand(body, 0.4, 0.75)
    const upper = maskBand(body, 0.75, 1.1)

    applyBodyMasks(body.root, [...masksFor(lower), ...masksFor(upper)])
    const together = indexCount(mesh)
    applyBodyMasks(body.root, masksFor(upper))
    expect(together).toBeLessThan(indexCount(mesh))
  })

  /** The rim rule: one or two hidden corners is a rim triangle, and it stays drawn. */
  it('keeps a triangle only some of whose vertices are hidden', () => {
    const body = buildBody()
    const mesh = body.meshes.find((entry) => entry.name === BODY_MESH)!
    const indices = body.source.find((entry) => entry.name === BODY_MESH)!.indices
    const first = [indices[0]!, indices[1]!]
    const whole = indexCount(mesh)

    applyBodyMasks(body.root, masksFor(first))
    expect(indexCount(mesh)).toBe(whole)
  })

  /** A multi-material mesh draws its groups: leave those behind and it draws garbage. */
  it('moves the groups along with the triangles it drops', () => {
    const body = buildBody()
    const mesh = body.meshes.find((entry) => entry.name === BODY_MESH)!
    const whole = indexCount(mesh)
    const split = Math.floor(whole / 6) * 3
    mesh.geometry.addGroup(0, split, 0)
    mesh.geometry.addGroup(split, whole - split, 1)

    applyBodyMasks(body.root, masksFor(maskBand(body, 0.4, 1.1)))
    const groups = mesh.geometry.groups
    expect(groups.map((group) => group.materialIndex)).toEqual([0, 1])
    expect(groups[0]!.start).toBe(0)
    expect(groups[1]!.start).toBe(groups[0]!.count)
    expect(groups[0]!.count + groups[1]!.count).toBe(indexCount(mesh))
    expect(indexCount(mesh), 'the band must actually drop triangles').toBeLessThan(whole)
  })
})

describe('handing the worn materials to the view', () => {
  type View = Parameters<typeof viewMaterialsWith>[0]

  function fakeView(materials: THREE.MeshToonMaterial[]): View {
    return {
      materials,
      baseColours: materials.map((material) => material.color.clone()),
      baseTransparent: materials.map((material) => material.transparent),
    } as unknown as View
  }

  it('replaces the gear entries rather than growing the arrays on a re-wear', () => {
    const body = buildBody()
    const view = fakeView([new THREE.MeshToonMaterial()])
    const chest = wearPiece(body.root, { slot: 'chest', scene: buildPiece(), covers: ['chest'], hides: {} })

    viewMaterialsWith(view, 1, [chest])
    viewMaterialsWith(view, 1, [chest])
    expect(view.materials).toEqual([view.materials[0], chest.material])
    expect(view.baseColours).toHaveLength(2)
    expect(view.baseTransparent).toHaveLength(2)

    viewMaterialsWith(view, 1, [])
    expect(view.materials).toHaveLength(1)
    expect(view.baseColours).toHaveLength(1)
  })
})

describe('the slot list', () => {
  it('is the eight fitted slots, weapons excluded', () => {
    expect(GEAR_SLOTS).toEqual(['feet', 'legs', 'waist', 'chest', 'back', 'hands', 'shoulders', 'head'])
  })
})
