import * as THREE from 'three'
import type { ActorView } from './actorview'
import { bindDrapes, unbindDrapes, type DrapeChain, type DrapeDefinition } from './drapebones'
import { applyPieceMasks, baseGeometryOf, maskedGeometry } from './gearcover'
import type { RegionHides } from './gearregions'
import { isBodyMaterial, type BodyMaterial } from './look'

export { resetWornPieces, updateWornPieces } from './drapestep'
export type { DrapeChain, DrapeDefinition } from './drapebones'
export type { PieceRegions, RegionHides } from './gearregions'

/**
 * Gear on a fitted body: a second skinned mesh driven by the body's own bones, and
 * the body triangles it hides.
 *
 * A piece is fitted to the canonical body and exported against the body's joint
 * list, so wearing one is a rebind rather than a re-skin. Everything here runs on
 * attach: the frame path sees one more draw call, and for a piece with hanging
 * cloth the chain `drapestep.ts` swings.
 */

export const GEAR_SLOTS = ['feet', 'legs', 'waist', 'chest', 'back', 'hands', 'shoulders', 'head'] as const

export type GearSlot = (typeof GEAR_SLOTS)[number]

/**
 * Fixed-overlap precedence between slots. A higher layer may hide buried triangles
 * of lower fixed geometry; fitting clearance and moving-cloth collision are separate.
 */
export const SLOT_LAYERS: Readonly<Record<GearSlot, number>> = {
  legs: 1, hands: 1, feet: 2, chest: 2, waist: 4, back: 5, head: 6, shoulders: 6,
}

/**
 * How far off the skin the fitter stood each slot, from the same contract. Only a
 * drape reads it, to know how far off a limb to hold cloth that is swinging free.
 */
export const SLOT_CLEARANCES: Readonly<Record<GearSlot, number>> = {
  legs: 0.008, hands: 0.003, feet: 0.014, chest: 0.012, head: 0.016, shoulders: 0.016, waist: 0.02, back: 0.026,
}

/** What a drape keeps between itself and a limb, over what the fitter already left. */
export const DRAPE_MARGIN = 0.01

/** The body vertices one piece hides, per skinned mesh node name. */
export type GearHides = Readonly<Record<string, readonly number[]>>

/** A loaded piece GLB, before it is bound to any particular body. */
export interface GearPieceSource extends RegionHides {
  slot: GearSlot
  scene: THREE.Object3D
  /** The slot regions this piece spans, for reference; masking is `hides`. */
  covers: readonly GearSlot[]
  /** Measured off the fitted piece by the fitter, never derived from the slot. */
  hides: GearHides
  /** The hanging cloth this piece carries, if any: one chain per manifest entry. */
  drapes?: readonly DrapeDefinition[]
  /**
   * Whether this piece hides the pieces it is worn over. Moving drape triangles are
   * excluded separately, so fixed geometry covers unless the piece opts out.
   */
  hidesPieces?: boolean
}

export interface WornPiece extends RegionHides {
  slot: GearSlot
  covers: readonly GearSlot[]
  hides: GearHides
  mesh: THREE.SkinnedMesh
  material: BodyMaterial
  /** Stepped by `updateWornPieces` once the body's own pose is written. */
  drapes: readonly DrapeChain[]
  hidesPieces: boolean
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
  const rig = host.parent ?? body
  const drapes = bindDrapes(source.slot, piece.skeleton, host.skeleton, source.drapes ?? [], rig,
    SLOT_CLEARANCES[source.slot] + DRAPE_MARGIN)

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
  rig.add(mesh)
  mesh.bind(drapes.skeleton, host.bindMatrix)
  return {
    slot: source.slot,
    covers: source.covers,
    hides: source.hides,
    mesh,
    material,
    drapes: drapes.chains,
    hidesPieces: source.hidesPieces ?? true,
    regions: source.regions,
    hidesRegions: source.hidesRegions,
    hidesBand: source.hidesBand,
  }
}

export function removePiece(_body: THREE.Object3D, worn: WornPiece): void {
  unbindDrapes(worn.drapes)
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
  applyPieceMasks(worn.map((piece) => ({
    ...piece,
    layer: SLOT_LAYERS[piece.slot],
    drapeJoints: drapeJointsOf(piece),
  })))
}

/** Where the drape bones start in a worn piece's skin, or nothing when it has none. */
function drapeJointsOf(piece: WornPiece): number | undefined {
  const chained = piece.drapes.reduce((total, chain) => total + chain.bones.length, 0)
  return chained === 0 ? undefined : piece.mesh.skeleton.bones.length - chained
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
