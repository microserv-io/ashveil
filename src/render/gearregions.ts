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

/** What a piece was tagged with, and what it claims from the pieces below it. */
export interface RegionHides {
  regions?: PieceRegions
  hidesRegions?: readonly string[]
  /** `[yMin, yMax]` of the fixed geometry doing the hiding, in bind pose. */
  hidesBand?: readonly [number, number]
}

/**
 * The vertices of a lower piece an upper piece's hide rules claim: tagged with a
 * region it hides, and inside the band its own fixed geometry spans. Bind-pose Y,
 * because the tag is a bind-pose fact and the mask is built once, on wear.
 */
export function hiddenByRegion(
  positions: Float32Array,
  regions: PieceRegions,
  hides: readonly string[],
  band: readonly [number, number] | undefined,
): Set<number> {
  const hidden = new Set<number>()
  for (const region of hides) {
    for (const vertex of regions[region] ?? []) {
      const y = positions[vertex * 3 + 1]
      if (y === undefined) continue
      if (band && (y < band[0] || y > band[1])) continue
      hidden.add(vertex)
    }
  }
  return hidden
}

/** Whether both sides carry what the authored rule needs; burial answers when not. */
export function hidesByRegion(under: RegionHides, over: RegionHides): boolean {
  return under.regions !== undefined && (over.hidesRegions?.length ?? 0) > 0
}
