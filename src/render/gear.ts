import * as THREE from 'three'
import type { ActorView } from './actorview'

/**
 * Gear on a fitted body: a second skinned mesh driven by the body's own `Skeleton`,
 * and the body triangles it hides.
 *
 * A piece is fitted to the canonical body and exported against the body's joint
 * list, so wearing one is a rebind rather than a re-skin. Everything here runs on
 * attach: the frame path sees one more draw call and nothing else.
 */

export const GEAR_SLOTS = ['feet', 'legs', 'waist', 'chest', 'back', 'hands', 'shoulders', 'head'] as const

export type GearSlot = (typeof GEAR_SLOTS)[number]

/** Which body vertices a slot covers, per skinned mesh node name. */
export interface BodyMasks {
  slots: Partial<Record<GearSlot, Record<string, number[]>>>
}

/** A loaded piece GLB, before it is bound to any particular body. */
export interface GearPieceSource {
  slot: GearSlot
  scene: THREE.Object3D
  /** The slot regions this piece hides; a sleeve covers more than its own slot. */
  covers: readonly GearSlot[]
}

export interface WornPiece {
  slot: GearSlot
  covers: readonly GearSlot[]
  mesh: THREE.SkinnedMesh
  material: THREE.MeshStandardMaterial
}

/** What to hide with a set of pieces on: every region any of them covers. */
export function coveredSlots(worn: readonly WornPiece[]): Set<GearSlot> {
  return new Set(worn.flatMap((piece) => [...piece.covers]))
}

export async function loadBodyMasks(url: string): Promise<BodyMasks> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`gear: ${url} answered ${response.status}`)
  const raw = (await response.json()) as { slots?: unknown }
  if (!raw || typeof raw !== 'object' || !raw.slots || typeof raw.slots !== 'object') {
    throw new Error(`gear: ${url} has no "slots" object`)
  }
  for (const [slot, meshes] of Object.entries(raw.slots as Record<string, unknown>)) {
    if (!GEAR_SLOTS.includes(slot as GearSlot)) throw new Error(`gear: ${url} names unknown slot "${slot}"`)
    if (!meshes || typeof meshes !== 'object') throw new Error(`gear: ${url} slot "${slot}" is not an object`)
  }
  return raw as BodyMasks
}

export function skinnedMeshesOf(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const meshes: THREE.SkinnedMesh[] = []
  root.traverse((child) => {
    if (child instanceof THREE.SkinnedMesh) meshes.push(child)
  })
  return meshes
}

/**
 * Geometry is shared across every actor wearing the piece; only the material is
 * cloned, because hit flash and death fade tint per actor.
 */
export function wearPiece(body: THREE.Object3D, source: GearPieceSource): WornPiece {
  const host = skinnedMeshesOf(body)[0]
  if (!host) throw new Error(`gear: ${source.slot} has no body skinned mesh to bind against`)
  const meshes = skinnedMeshesOf(source.scene)
  const piece = meshes[0]
  if (!piece) throw new Error(`gear: ${source.slot} piece has no skinned mesh`)
  // The fitter gates a piece down to one mesh, pairs included; wearing the first of
  // several would silently drop the rest of the piece.
  if (meshes.length > 1) throw new Error(`gear: ${source.slot} piece is ${meshes.length} meshes, expected one`)
  matchBones(source.slot, piece.skeleton, host.skeleton)

  const material = (piece.material as THREE.MeshStandardMaterial).clone()
  const mesh = new THREE.SkinnedMesh(piece.geometry, material)
  mesh.name = piece.name
  mesh.castShadow = host.castShadow
  mesh.receiveShadow = host.receiveShadow
  mesh.frustumCulled = host.frustumCulled
  mesh.bindMode = host.bindMode
  // A sibling, so the piece carries the same world transform the bind matrix assumes.
  ;(host.parent ?? body).add(mesh)
  mesh.bind(host.skeleton, host.bindMatrix)
  return { slot: source.slot, covers: source.covers, mesh, material }
}

export function removePiece(_body: THREE.Object3D, worn: WornPiece): void {
  worn.mesh.removeFromParent()
  worn.material.dispose()
}

/**
 * Hides the body under the worn slots by dropping the triangles whose three
 * vertices are all masked. The attributes are the originals, shared by reference:
 * only the index differs, so a masked body costs one small buffer and no re-skin.
 * Nothing built here may ever be disposed: disposing a geometry frees the buffers
 * of its attributes, and these are the unmasked body's.
 */
export function applyBodyMasks(body: THREE.Object3D, masks: BodyMasks, worn: ReadonlySet<GearSlot>): void {
  for (const mesh of skinnedMeshesOf(body)) {
    const base = BASE_GEOMETRY.get(mesh) ?? mesh.geometry
    BASE_GEOMETRY.set(mesh, base)
    const hidden = maskedVertices(masks, worn, mesh.name)
    mesh.geometry = hidden === null ? base : withoutMaskedTriangles(base, hidden)
  }
}

/**
 * Hit flash and death fade walk `ActorView.materials` by index, so worn materials
 * ride the same arrays or the gear stays lit while the body underneath fades.
 * `bodyMaterials` is the count the view was built with; everything past it is gear.
 */
export function viewMaterialsWith(view: ActorView, bodyMaterials: number, worn: readonly WornPiece[]): void {
  view.materials.length = bodyMaterials
  view.baseColours.length = bodyMaterials
  view.baseTransparent.length = bodyMaterials
  for (const piece of worn) {
    view.materials.push(piece.material)
    view.baseColours.push(piece.material.color.clone())
    view.baseTransparent.push(piece.material.transparent)
  }
}

/** The unmasked geometry, so taking a piece off restores the body it covered. */
const BASE_GEOMETRY = new WeakMap<THREE.SkinnedMesh, THREE.BufferGeometry>()

function maskedVertices(masks: BodyMasks, worn: ReadonlySet<GearSlot>, mesh: string): Set<number> | null {
  const hidden = new Set<number>()
  for (const slot of worn) {
    for (const vertex of masks.slots[slot]?.[mesh] ?? []) hidden.add(vertex)
  }
  return hidden.size === 0 ? null : hidden
}

function withoutMaskedTriangles(base: THREE.BufferGeometry, hidden: ReadonlySet<number>): THREE.BufferGeometry {
  const index = base.getIndex()
  if (!index) return base
  const kept: number[] = []
  // A multi-material mesh draws its groups, not its index, so dropping triangles
  // without moving the group boundaries with them would draw the wrong ones.
  const ranges = base.groups.length > 0 ? base.groups : [{ start: 0, count: index.count, materialIndex: 0 }]
  const regrouped = ranges.map((range) => {
    const from = kept.length
    const until = Math.min(index.count, range.start + range.count)
    for (let at = range.start; at + 2 < until; at += 3) {
      const a = index.getX(at)
      const b = index.getX(at + 1)
      const c = index.getX(at + 2)
      if (hidden.has(a) && hidden.has(b) && hidden.has(c)) continue
      kept.push(a, b, c)
    }
    return { start: from, count: kept.length - from, materialIndex: range.materialIndex ?? 0 }
  })
  if (kept.length === index.count) return base

  const geometry = new THREE.BufferGeometry()
  for (const [name, attribute] of Object.entries(base.attributes)) {
    geometry.setAttribute(name, attribute as THREE.BufferAttribute)
  }
  geometry.setIndex(kept)
  if (base.groups.length > 0) {
    for (const group of regrouped) geometry.addGroup(group.start, group.count, group.materialIndex)
  }
  // The masked body is a subset, so the original bounds still contain it.
  geometry.boundingBox = base.boundingBox
  geometry.boundingSphere = base.boundingSphere
  return geometry
}

function matchBones(slot: GearSlot, piece: THREE.Skeleton, body: THREE.Skeleton): void {
  if (piece.bones.length !== body.bones.length) {
    throw new Error(
      `gear: ${slot} carries ${piece.bones.length} bones, the body has ${body.bones.length}. Refit the piece.`,
    )
  }
  for (let at = 0; at < body.bones.length; at++) {
    const mine = piece.bones[at]!.name
    const theirs = body.bones[at]!.name
    if (mine !== theirs) {
      throw new Error(`gear: ${slot} bone ${at} is "${mine}", the body has "${theirs}". Refit the piece.`)
    }
  }
}
