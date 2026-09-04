/**
 * The authored half of piece-over-piece hiding: what a piece hides on everything
 * worn under it, by region rather than by what happens to be buried in it.
 *
 * The fitter tags every vertex of a piece with the body region nearest it, and a
 * piece declares which regions it owns and over what band of heights. Wearing a belt
 * then drops the tunic's triangles under its strap whatever the pose - which burial
 * cannot do, because it sees one frame and two surfaces six millimetres apart at
 * bind pass through each other at a run.
 */

/** Which body region each of a piece's own vertices lies against, from the fitter. */
export type PieceRegions = Readonly<Record<string, readonly number[]>>

/**
 * The hiding piece's own top and bottom edge per azimuth about `centre`, in bind
 * pose. A belt strap conformed to a waist is tilted by nearly its own height, so the
 * heights it is behind at the front are not the ones it is behind at the hip: one
 * pair of heights either reaches past the leather or shrinks to the slab they share.
 */
export interface HideProfile {
  readonly centre: readonly number[]
  readonly bins: number
  readonly top: readonly number[]
  readonly bottom: readonly number[]
}

/**
 * What a piece hides on the pieces worn under it: nothing however it is layered,
 * whatever is buried in it, or exactly these vertices of exactly these pieces.
 */
export type PieceCover = boolean | Readonly<Record<string, readonly number[]>>

/** What a piece was tagged with, and what it claims from the pieces below it. */
export interface RegionHides {
  /** Its own name, so a piece worn over it can name what it hides on this one. */
  piece?: string
  regions?: PieceRegions
  hidesRegions?: readonly string[]
  hidesPieces?: PieceCover
  /** `[yMin, yMax]` of the fixed geometry doing the hiding, in bind pose. */
  hidesBand?: readonly [number, number]
  /** The same band followed around the ring, and preferred wherever it is carried. */
  hidesProfile?: HideProfile
}

/**
 * The vertices an upper piece names on this lower piece, or nothing when it names
 * none. A named footprint answers for that pair ahead of both other rules, because
 * it is the fitter's measurement of two bind poses: burial sees one frame of two
 * surfaces that cross at a run, and the region rule sees a band rather than a plate.
 * A pair the upper piece says nothing about falls through to those unchanged.
 */
export function hiddenByName(under: RegionHides, over: RegionHides): ReadonlySet<number> | null {
  const named = typeof over.hidesPieces === 'object' ? over.hidesPieces[under.piece ?? ''] : undefined
  return named ? new Set(named) : null
}

/**
 * The vertices of a lower piece an upper piece's hide rules claim: tagged with a
 * region it hides, and inside the band its own fixed geometry spans. Bind-pose Y,
 * because the tag is a bind-pose fact and the mask is built once, on wear.
 */
export function hiddenByRegion(
  positions: Float32Array,
  regions: PieceRegions,
  over: RegionHides,
): Set<number> {
  const hidden = new Set<number>()
  const profile = over.hidesProfile
  const band = over.hidesBand
  for (const region of over.hidesRegions ?? []) {
    for (const vertex of regions[region] ?? []) {
      const y = positions[vertex * 3 + 1]
      if (y === undefined) continue
      if (profile) {
        const dx = positions[vertex * 3]! - (profile.centre[0] ?? 0)
        const dz = positions[vertex * 3 + 2]! - (profile.centre[2] ?? 0)
        if (y < edgeAt(profile.bottom, dx, dz) || y > edgeAt(profile.top, dx, dz)) continue
      } else if (band && (y < band[0] || y > band[1])) continue
      hidden.add(vertex)
    }
  }
  return hidden
}

/**
 * One edge where a point sits around the ring, between the two bin centres it falls
 * between. The bins are read off the edge's own length rather than the declared
 * count, so a profile can never index past what it ships, and the last bin's
 * neighbour is the first: a waist is a loop.
 */
function edgeAt(edge: readonly number[], dx: number, dz: number): number {
  const bins = edge.length
  const at = ((Math.atan2(dz, dx) + Math.PI) / (2 * Math.PI)) * bins - 0.5
  const low = Math.floor(at)
  const first = edge[((low % bins) + bins) % bins]!
  const second = edge[(((low + 1) % bins) + bins) % bins]!
  return first + (second - first) * (at - low)
}

/** Whether both sides carry what the authored rule needs; burial answers when not. */
export function hidesByRegion(under: RegionHides, over: RegionHides): boolean {
  return under.regions !== undefined && (over.hidesRegions?.length ?? 0) > 0
}
