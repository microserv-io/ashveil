import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  GEAR_SLOTS, type DrapeDefinition, type GearHides, type GearSlot, type HideProfile,
  type PieceCover, type PieceRegions,
} from '../../src/render/gear'
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
  { slot: 'shoulders', piece: 'warden-pauldrons-socket', path: gearPath('warden-pauldrons-socket'), compare: true },
  { slot: 'shoulders', piece: 'warden-pauldrons-socket-stiff', path: gearPath('warden-pauldrons-socket-stiff'), compare: true },
]

/**
 * Where the fitter turned each side of a paired piece. A pose authored on top of a
 * fitted one has to turn about the same point the fitter did, or the flags the page
 * prints do not reproduce the pose the page is showing.
 */
export interface PieceCrests {
  readonly L: readonly number[]
  readonly R: readonly number[]
  /**
   * The `--orient` and `--offset` each side was fitted with. Per side, because two
   * halves of one source are not the mirrors of each other they were drawn as, and a
   * pair may be authored as two poses.
   */
  readonly orient: Readonly<Record<'L' | 'R', readonly number[]>>
  readonly offset: Readonly<Record<'L' | 'R', readonly number[]>>
}

/** A piece with its manifest read: what to bind, and the body it hides. */
export interface LoadedGearPiece {
  readonly scene: THREE.Object3D
  readonly covers: readonly GearSlot[]
  readonly hides: GearHides
  readonly drapes: readonly DrapeDefinition[]
  readonly hidesPieces: PieceCover | undefined
  readonly regions: PieceRegions | undefined
  readonly hidesRegions: readonly string[] | undefined
  readonly hidesBand: readonly [number, number] | undefined
  readonly hidesProfile: HideProfile | undefined
  readonly crests: PieceCrests | undefined
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
    regions?: unknown; hidesRegions?: unknown; hidesBand?: unknown; hidesProfile?: unknown
    alignment?: unknown
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
    hidesPieces: coverOf(manifest.hidesPieces, url),
    regions: regionsOf(manifest.regions, url),
    hidesRegions: hiddenRegionsOf(manifest.hidesRegions, url),
    hidesBand: bandOf(manifest.hidesBand, url),
    hidesProfile: profileOf(manifest.hidesProfile, url),
    crests: crestsOf(manifest.alignment),
  }
}

/**
 * A piece fitted before the crest was written down, or fitted by a registration
 * rather than by hand, cannot be re-posed: the page would have nothing to turn
 * about and no numbers to say the result in.
 */
function crestsOf(alignment: unknown): PieceCrests | undefined {
  if (!alignment || typeof alignment !== 'object' || Array.isArray(alignment)) return undefined
  const sides = alignment as Record<string, Record<string, unknown> | undefined>
  const triple = (side: string, name: string): readonly number[] | null => {
    const values = sides[side]?.[name]
    return Array.isArray(values) && values.length === 3 && values.every((each) => typeof each === 'number')
      ? (values as number[])
      : null
  }
  const [left, right] = [triple('L', 'crest'), triple('R', 'crest')]
  const [yawL, yawR] = [triple('L', 'orient'), triple('R', 'orient')]
  const [offL, offR] = [triple('L', 'offset'), triple('R', 'offset')]
  if (!left || !right || !yawL || !yawR || !offL || !offR) return undefined
  return { L: left, R: right, orient: { L: yawL, R: yawR }, offset: { L: offL, R: offR } }
}

/**
 * What a piece hides on the pieces beneath it: a flat yes or no, or the vertices the
 * fitter measured under it, per piece it was fitted over.
 */
function coverOf(cover: unknown, url: string): PieceCover | undefined {
  if (typeof cover === 'boolean' || cover === undefined) return cover
  if (!cover || typeof cover !== 'object' || Array.isArray(cover)) {
    throw new Error(`gear: ${url} has a "hidesPieces" that is neither a flag nor an object`)
  }
  for (const [piece, indices] of Object.entries(cover)) {
    if (!Array.isArray(indices)) throw new Error(`gear: ${url} hidesPieces "${piece}" is not an array`)
  }
  return cover as PieceCover
}

/** A piece fitted before region tags existed has none, and falls back to burial. */
function regionsOf(regions: unknown, url: string): PieceRegions | undefined {
  if (regions === undefined) return undefined
  if (!regions || typeof regions !== 'object' || Array.isArray(regions)) {
    throw new Error(`gear: ${url} has a "regions" that is not an object`)
  }
  for (const [region, indices] of Object.entries(regions)) {
    if (!GEAR_SLOTS.includes(region as GearSlot)) throw new Error(`gear: ${url} tags unknown region "${region}"`)
    if (!Array.isArray(indices)) throw new Error(`gear: ${url} regions "${region}" is not an array`)
  }
  return regions as PieceRegions
}

function hiddenRegionsOf(regions: unknown, url: string): readonly string[] | undefined {
  if (regions === undefined) return undefined
  if (!Array.isArray(regions)) throw new Error(`gear: ${url} has a "hidesRegions" that is not an array`)
  for (const region of regions) {
    if (!GEAR_SLOTS.includes(region as GearSlot)) throw new Error(`gear: ${url} hides unknown region "${region}"`)
  }
  return regions as string[]
}

function bandOf(band: unknown, url: string): readonly [number, number] | undefined {
  if (band === undefined) return undefined
  if (!Array.isArray(band) || band.length !== 2 || band.some((edge) => typeof edge !== 'number')) {
    throw new Error(`gear: ${url} has a "hidesBand" that is not two numbers`)
  }
  return band as [number, number]
}

/** A piece fitted before the edges were measured hides over its flat band instead. */
function profileOf(profile: unknown, url: string): HideProfile | undefined {
  if (profile === undefined) return undefined
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new Error(`gear: ${url} has a "hidesProfile" that is not an object`)
  }
  const { centre, bins, top, bottom } = profile as Record<string, unknown>
  const numbers = (value: unknown, least: number) =>
    Array.isArray(value) && value.length >= least && value.every((each) => typeof each === 'number')
  if (!numbers(centre, 3) || typeof bins !== 'number' || !numbers(top, 3) || !numbers(bottom, 3)) {
    throw new Error(`gear: ${url} has a "hidesProfile" that is not a centre, a bin count and two edges`)
  }
  if ((top as number[]).length !== (bottom as number[]).length) {
    throw new Error(`gear: ${url} has a "hidesProfile" whose edges are different lengths`)
  }
  return profile as HideProfile
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
