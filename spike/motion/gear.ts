import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { GEAR_SLOTS, type DrapeDefinition, type GearHides, type GearSlot } from '../../src/render/gear'
import { stylise } from '../../src/render/look'

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
  /**
   * A second fitting of a slot already listed, on the page only to be looked at
   * beside the one that ships. It is off by default and out of "Wear all", so the
   * outfit stays one piece per slot, and it is judged by eye rather than by gates.
   */
  readonly compare?: boolean
}

export const REVIEW_GEAR: readonly ReviewGearPiece[] = [
  { slot: 'feet', piece: 'warden-boots', path: gearPath('warden-boots') },
  { slot: 'legs', piece: 'warden-trousers', path: gearPath('warden-trousers') },
  { slot: 'hands', piece: 'warden-gloves', path: gearPath('warden-gloves') },
  { slot: 'chest', piece: 'warden-tunic', path: gearPath('warden-tunic') },
  { slot: 'head', piece: 'warden-hood', path: gearPath('warden-hood') },
  { slot: 'waist', piece: 'warden-belt', path: gearPath('warden-belt') },
  { slot: 'shoulders', piece: 'warden-pauldrons', path: gearPath('warden-pauldrons') },
  { slot: 'waist', piece: 'warden-belt-ring', path: gearPath('warden-belt-ring'), compare: true },
  { slot: 'feet', piece: 'warden-boots-full', path: gearPath('warden-boots-full'), compare: true },
  { slot: 'legs', piece: 'warden-trousers-full', path: gearPath('warden-trousers-full'), compare: true },
  { slot: 'hands', piece: 'warden-gloves-full', path: gearPath('warden-gloves-full'), compare: true },
  { slot: 'chest', piece: 'warden-tunic-full', path: gearPath('warden-tunic-full'), compare: true },
  { slot: 'head', piece: 'warden-hood-full', path: gearPath('warden-hood-full'), compare: true },
  { slot: 'shoulders', piece: 'warden-pauldrons-full', path: gearPath('warden-pauldrons-full'), compare: true },
]

/** A piece with its manifest read: what to bind, and the body it hides. */
export interface LoadedGearPiece {
  readonly scene: THREE.Object3D
  readonly covers: readonly GearSlot[]
  readonly hides: GearHides
  readonly drapes: readonly DrapeDefinition[]
  readonly hidesPieces: boolean | undefined
}

/** Where `npm run art:gear` puts a piece, and so where the page fetches it. */
export function gearPath(piece: string): string {
  return `/gear/${piece}/${piece}.glb`
}

export function gearManifestPath(piece: string): string {
  return `/gear/${piece}/${piece}.manifest.json`
}

/** What a piece hides is the fitter's answer, read off the manifest, never retyped here. */
export async function loadGearManifest(piece: string): Promise<Omit<LoadedGearPiece, 'scene'>> {
  const url = gearManifestPath(piece)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`gear: ${url} answered ${response.status}`)
  const manifest = (await response.json()) as {
    covers?: unknown; hides?: unknown; drapes?: unknown; hidesPieces?: unknown
  }
  if (!Array.isArray(manifest.covers)) throw new Error(`gear: ${url} has no "covers" array`)
  for (const slot of manifest.covers) {
    if (!GEAR_SLOTS.includes(slot as GearSlot)) throw new Error(`gear: ${url} names unknown covered slot "${slot}"`)
  }
  const hides = manifest.hides
  if (!hides || typeof hides !== 'object' || Array.isArray(hides)) {
    throw new Error(`gear: ${url} has no "hides" object`)
  }
  for (const [mesh, indices] of Object.entries(hides)) {
    if (!Array.isArray(indices)) throw new Error(`gear: ${url} hides "${mesh}" is not an array`)
  }
  return {
    covers: manifest.covers as GearSlot[],
    hides: hides as GearHides,
    drapes: drapesOf(manifest.drapes, url),
    hidesPieces: typeof manifest.hidesPieces === 'boolean' ? manifest.hidesPieces : undefined,
  }
}

/** A piece with no hanging cloth has no `drapes` at all, and that is the common case. */
function drapesOf(drapes: unknown, url: string): readonly DrapeDefinition[] {
  if (drapes === undefined) return []
  if (!Array.isArray(drapes)) throw new Error(`gear: ${url} has a "drapes" that is not an array`)
  for (const drape of drapes as DrapeDefinition[]) {
    if (!drape.attachBone || !Array.isArray(drape.bones) || !Array.isArray(drape.toward)) {
      throw new Error(`gear: ${url} drape "${drape.name}" is missing an attach bone, its bones or its toward`)
    }
  }
  return drapes as DrapeDefinition[]
}

/**
 * One piece that will not load must not take the page with it. A refit in flight has
 * deleted the GLB, or a failed gate never wrote one, and the manifest fetch comes
 * back as the dev server's index.html; the panel greys that piece out and the rest of
 * the review still works.
 */
export async function loadReviewGear(
  pieces: readonly ReviewGearPiece[] = REVIEW_GEAR,
): Promise<Map<string, LoadedGearPiece>> {
  const loader = new GLTFLoader()
  const loaded = await Promise.all(pieces.map(async (entry) => {
    try {
      const [gltf, manifest] = await Promise.all([loader.loadAsync(entry.path), loadGearManifest(entry.piece)])
      // Converted once here, so every actor wearing the piece clones one toon material.
      return [entry.piece, { scene: stylise(gltf.scene), ...manifest }] as const
    } catch (error) {
      console.warn(`gear: ${entry.piece} did not load, wearing it is off`, error)
      return null
    }
  }))
  return new Map(loaded.filter((entry): entry is NonNullable<typeof entry> => entry !== null))
}
