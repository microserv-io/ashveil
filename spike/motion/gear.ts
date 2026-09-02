import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { GEAR_SLOTS, loadBodyMasks, type BodyMasks, type GearSlot } from '../../src/render/gear'

/**
 * The pieces the review page can put on the body.
 *
 * Anything listed here is a fitted piece under `public/gear` that passed every
 * gate, so the page can wear it without asking questions. The proxy fixtures under
 * `tests/fixtures/gear` are test data and deliberately absent: they exist to prove
 * the fitter reproduces, not to be looked at.
 */
export interface ReviewGearPiece {
  readonly slot: GearSlot
  readonly piece: string
  readonly path: string
}

export const REVIEW_GEAR: readonly ReviewGearPiece[] = []

/** A piece with its manifest read: what to bind, and which regions it hides. */
export interface LoadedGearPiece {
  readonly scene: THREE.Object3D
  readonly covers: readonly GearSlot[]
}

/** Where `npm run art:gear` puts a piece, and so where the page fetches it. */
export function gearPath(piece: string): string {
  return `/gear/${piece}/${piece}.glb`
}

export function gearManifestPath(piece: string): string {
  return `/gear/${piece}/${piece}.manifest.json`
}

/** What a piece hides is the fitter's answer, read off the manifest, never retyped here. */
export async function loadGearCovers(piece: string): Promise<readonly GearSlot[]> {
  const url = gearManifestPath(piece)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`gear: ${url} answered ${response.status}`)
  const manifest = (await response.json()) as { covers?: unknown }
  if (!Array.isArray(manifest.covers)) throw new Error(`gear: ${url} has no "covers" array`)
  for (const slot of manifest.covers) {
    if (!GEAR_SLOTS.includes(slot as GearSlot)) throw new Error(`gear: ${url} names unknown covered slot "${slot}"`)
  }
  return manifest.covers as GearSlot[]
}

export const MASCULINE_V3_MASKS = '/bodies/masculine-v3/masculine-v3.masks.json'

export async function loadReviewGear(
  pieces: readonly ReviewGearPiece[] = REVIEW_GEAR,
): Promise<Map<string, LoadedGearPiece>> {
  const loader = new GLTFLoader()
  const loaded = await Promise.all(pieces.map(async (entry) => {
    const [gltf, covers] = await Promise.all([loader.loadAsync(entry.path), loadGearCovers(entry.piece)])
    return [entry.piece, { scene: gltf.scene, covers }] as const
  }))
  return new Map(loaded)
}

/**
 * The sidecar only exists once the body has been refitted with the masks stage, and
 * a review page that will not load without it is a page nobody can use meanwhile.
 * Without masks a piece simply sits on top of the body it covers.
 */
export async function loadReviewMasks(url = MASCULINE_V3_MASKS): Promise<BodyMasks | null> {
  try {
    return await loadBodyMasks(url)
  } catch {
    return null
  }
}
