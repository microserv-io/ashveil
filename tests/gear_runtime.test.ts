import { join } from 'node:path'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { readGlb, loadGlbSkeleton, type GlbSkinnedMesh } from '../scripts/art/glb'
import {
  applyBodyMasks,
  GEAR_SLOTS,
  removePiece,
  skinnedMeshesOf,
  viewMaterialsWith,
  wearPiece,
  type BodyMasks,
  type GearSlot,
} from '../src/render/gear'

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
    const mesh = new THREE.SkinnedMesh(geometryOf(source), new THREE.MeshStandardMaterial())
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
  const mesh = new THREE.SkinnedMesh(geometryOf(glb.meshes[0]!), new THREE.MeshStandardMaterial())
  mesh.name = 'proxy'
  scene.add(mesh)
  mesh.bind(new THREE.Skeleton(bones))
  return scene
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

function masksFor(slot: GearSlot, vertices: number[]): BodyMasks {
  return { slots: { [slot]: { [BODY_MESH]: vertices } } }
}

function indexCount(mesh: THREE.SkinnedMesh): number {
  return mesh.geometry.getIndex()!.count
}

describe('wearing a piece on a fitted body', () => {
  it('binds the piece to the body’s own Skeleton object', () => {
    const body = buildBody()
    const worn = wearPiece(body.root, { slot: 'chest', scene: buildPiece(), covers: ['chest'] })

    expect(worn.mesh.skeleton).toBe(body.meshes[0]!.skeleton)
    expect(worn.mesh.parent).toBe(body.meshes[0]!.parent)
    expect(worn.mesh.bindMatrix.equals(body.meshes[0]!.bindMatrix)).toBe(true)
  })

  it('shares the piece geometry and clones only its material', () => {
    const body = buildBody()
    const source = buildPiece()
    const piece = skinnedMeshesOf(source)[0]!
    const worn = wearPiece(body.root, { slot: 'chest', scene: source, covers: ['chest'] })

    expect(worn.mesh.geometry).toBe(piece.geometry)
    expect(worn.material).not.toBe(piece.material)
  })

  it('names the bone when the piece’s joints are out of order', () => {
    const body = buildBody()
    expect(() => wearPiece(body.root, { slot: 'chest', scene: buildPiece(true), covers: ['chest'] }))
      .toThrow(/chest bone 1 is "spine", the body has "pelvis"/)
  })

  it('refuses a piece that arrives as several meshes', () => {
    const body = buildBody()
    const scene = buildPiece()
    scene.add(skinnedMeshesOf(buildPiece())[0]!)
    expect(() => wearPiece(body.root, { slot: 'chest', scene, covers: ['chest'] }))
      .toThrow(/chest piece is 2 meshes/)
  })

  it('adds exactly one draw call per worn piece and takes it back off', () => {
    const body = buildBody()
    const before = skinnedMeshesOf(body.root).length

    const chest = wearPiece(body.root, { slot: 'chest', scene: buildPiece(), covers: ['chest'] })
    expect(skinnedMeshesOf(body.root)).toHaveLength(before + 1)
    const legs = wearPiece(body.root, { slot: 'legs', scene: buildPiece(), covers: ['legs'] })
    expect(skinnedMeshesOf(body.root)).toHaveLength(before + 2)

    removePiece(body.root, chest)
    removePiece(body.root, legs)
    expect(skinnedMeshesOf(body.root)).toHaveLength(before)
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

    applyBodyMasks(body.root, masksFor('chest', masked), new Set<GearSlot>(['chest']))
    expect(indexCount(mesh)).toBe(original - expected)
  })

  it('restores the original index when the slot comes off', () => {
    const body = buildBody()
    const mesh = body.meshes.find((entry) => entry.name === BODY_MESH)!
    const original = mesh.geometry
    const masks = masksFor('chest', maskBand(body, 0.4, 1.1))

    applyBodyMasks(body.root, masks, new Set<GearSlot>(['chest']))
    applyBodyMasks(body.root, masks, new Set<GearSlot>())
    expect(mesh.geometry).toBe(original)
    expect(indexCount(mesh)).toBe(original.getIndex()!.count)
  })

  it('shares every attribute with the unmasked geometry', () => {
    const body = buildBody()
    const mesh = body.meshes.find((entry) => entry.name === BODY_MESH)!
    const original = mesh.geometry

    applyBodyMasks(body.root, masksFor('chest', maskBand(body, 0.4, 1.1)), new Set<GearSlot>(['chest']))
    expect(mesh.geometry).not.toBe(original)
    for (const name of ['position', 'normal', 'skinIndex', 'skinWeight']) {
      expect(mesh.geometry.getAttribute(name), name).toBe(original.getAttribute(name))
    }
  })

  it('leaves a mesh no worn slot covers untouched', () => {
    const body = buildBody()
    const head = body.meshes.find((entry) => entry.name === 'Head')!
    const original = head.geometry

    applyBodyMasks(body.root, masksFor('chest', maskBand(body, 0.4, 1.1)), new Set<GearSlot>(['chest']))
    expect(head.geometry).toBe(original)
  })

  /** A multi-material mesh draws its groups: leave those behind and it draws garbage. */
  it('moves the groups along with the triangles it drops', () => {
    const body = buildBody()
    const mesh = body.meshes.find((entry) => entry.name === BODY_MESH)!
    const whole = indexCount(mesh)
    const split = Math.floor(whole / 6) * 3
    mesh.geometry.addGroup(0, split, 0)
    mesh.geometry.addGroup(split, whole - split, 1)

    applyBodyMasks(body.root, masksFor('chest', maskBand(body, 0.4, 1.1)), new Set<GearSlot>(['chest']))
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

  function fakeView(materials: THREE.MeshStandardMaterial[]): View {
    return {
      materials,
      baseColours: materials.map((material) => material.color.clone()),
      baseTransparent: materials.map((material) => material.transparent),
    } as View
  }

  it('replaces the gear entries rather than growing the arrays on a re-wear', () => {
    const body = buildBody()
    const view = fakeView([new THREE.MeshStandardMaterial()])
    const chest = wearPiece(body.root, { slot: 'chest', scene: buildPiece(), covers: ['chest'] })

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
