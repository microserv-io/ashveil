import * as THREE from 'three'
import type { ActorView } from './actorview'
import { applyPieceMasks, baseGeometryOf, maskedGeometry } from './gearcover'
import { isBodyMaterial, type BodyMaterial } from './look'

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

/**
 * What a slot is worn over. A higher layer stands further off the skin and hides
 * the pieces below it; `tests/art_contracts.test.ts` holds this to the contract's
 * own `layer`, which is what the fitter's clearances are ordered by.
 */
export const SLOT_LAYERS: Readonly<Record<GearSlot, number>> = {
  legs: 1, hands: 1, feet: 2, chest: 2, head: 3, shoulders: 3, waist: 4, back: 5,
}

/** The body vertices one piece hides, per skinned mesh node name. */
export type GearHides = Readonly<Record<string, readonly number[]>>

/** A loaded piece GLB, before it is bound to any particular body. */
export interface GearPieceSource {
  slot: GearSlot
  scene: THREE.Object3D
  /** The slot regions this piece spans, for reference; masking is `hides`. */
  covers: readonly GearSlot[]
  /** Measured off the fitted piece by the fitter, never derived from the slot. */
  hides: GearHides
}

export interface WornPiece {
  slot: GearSlot
  covers: readonly GearSlot[]
  hides: GearHides
  mesh: THREE.SkinnedMesh
  material: BodyMaterial
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
 * cloned, because hit flash and death fade tint per actor. The piece arrives already
 * stylised, so gear shades on the body's own ramp and compiles to the one program;
 * converting here instead would give each actor's piece a material the loader never
 * shared, and a piece that slipped through raw would light differently from the skin
 * under it without anything saying so.
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

  const shading = piece.material as THREE.Material
  if (!isBodyMaterial(shading)) {
    throw new Error(`gear: ${source.slot} was not stylised; load the piece through look.stylise`)
  }
  const material = shading.clone()
  const mesh = new THREE.SkinnedMesh(piece.geometry, material)
  mesh.name = piece.name
  mesh.castShadow = host.castShadow
  mesh.receiveShadow = host.receiveShadow
  mesh.frustumCulled = host.frustumCulled
  mesh.bindMode = host.bindMode
  // A sibling, so the piece carries the same world transform the bind matrix assumes.
  ;(host.parent ?? body).add(mesh)
  mesh.bind(host.skeleton, host.bindMatrix)
  return { slot: source.slot, covers: source.covers, hides: source.hides, mesh, material }
}

export function removePiece(_body: THREE.Object3D, worn: WornPiece): void {
  worn.mesh.removeFromParent()
  worn.material.dispose()
}

/**
 * Hides the body under the worn pieces by dropping the triangles whose three
 * vertices are all hidden. A triangle with one or two hidden vertices is a rim
 * triangle and stays drawn. The attributes are the originals, shared by reference:
 * only the index differs, so a masked body costs one small buffer and no re-skin.
 * Nothing built here may ever be disposed: disposing a geometry frees the buffers
 * of its attributes, and these are the unmasked body's.
 */
export function applyBodyMasks(body: THREE.Object3D, worn: readonly Pick<WornPiece, 'hides'>[]): void {
  for (const mesh of skinnedMeshesOf(body)) {
    const base = baseGeometryOf(mesh)
    const hidden = hiddenVertices(worn, mesh.name)
    mesh.geometry = hidden === null ? base : maskedGeometry(base, hidden)
  }
}

/**
 * Hides each worn piece under the pieces worn over it. The body's mask is measured
 * by the fitter and shipped; this one cannot be, because which pieces are worn
 * together is only known here.
 */
export function applyGearMasks(worn: readonly WornPiece[]): void {
  applyPieceMasks(worn.map((piece) => ({ layer: SLOT_LAYERS[piece.slot], mesh: piece.mesh })))
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

/** The union of what every worn piece hides on one mesh, or null for nothing at all. */
function hiddenVertices(worn: readonly Pick<WornPiece, 'hides'>[], mesh: string): Set<number> | null {
  const hidden = new Set<number>()
  for (const piece of worn) {
    for (const vertex of piece.hides[mesh] ?? []) hidden.add(vertex)
  }
  return hidden.size === 0 ? null : hidden
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
