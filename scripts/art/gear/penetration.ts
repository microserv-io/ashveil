/**
 * How far a fitted piece is inside the body it is worn on, in one pose.
 *
 * The measurement is per piece vertex against the nearest body triangle, which is
 * the only definition that survives a piece hanging off the body (a cloak, a
 * pauldron): an inside/outside test on a closed mesh would call the whole skirt
 * "outside" and see nothing.
 *
 * The whole body is searched even where a worn slot hides it, and only the answer
 * is filtered: a chest piece sits over a hole in the visible body, so searching the
 * visible surface alone would sign a vertex resting on the chest by the armpit rim
 * five centimetres away and read a clean piece as buried. A vertex whose nearest
 * triangle is hidden is inside something nobody can see, and counts as clear.
 *
 * Everything runs on flat typed arrays, reused across poses, because the gate walks
 * two hundred poses of a seventeen-thousand-triangle body and a per-pose allocation
 * of that size is most of the run. The grid itself is `src/render/gearcover.ts`,
 * shared with the runtime query that hides one worn piece under another.
 */

import { boundsOf, buildTriangleGrid, depthBehindNearest } from '../../../src/render/gearcover'

/** How far from a piece vertex a body triangle can be and still be its nearest. */
export const REACH = 0.06

export interface SkinnedVertices {
  /** Rest positions, three per vertex. */
  readonly positions: Float32Array
  /** Four joint indices per vertex, into the skin's own joint order. */
  readonly joints: Uint16Array
  /** Four weights per vertex, matching `joints`. */
  readonly weights: Float32Array
}

export interface Penetration {
  /** Deepest any piece vertex sits inside the body, in metres. Zero when none does. */
  readonly maxDepth: number
  /** How many piece vertices are deeper inside than the slot's `clip.depth`. */
  readonly over: number
  readonly ownedOver?: number
  readonly fixedOver?: number
}

/** Linear-blend skinning, column-major matrices as glTF and Three.js both store them. */
export function skinVertices(mesh: SkinnedVertices, matrices: Float32Array, out: Float32Array): void {
  const count = mesh.positions.length / 3
  for (let vertex = 0; vertex < count; vertex++) {
    const px = mesh.positions[vertex * 3]!
    const py = mesh.positions[vertex * 3 + 1]!
    const pz = mesh.positions[vertex * 3 + 2]!
    let x = 0
    let y = 0
    let z = 0
    for (let lane = 0; lane < 4; lane++) {
      const weight = mesh.weights[vertex * 4 + lane]!
      if (weight === 0) continue
      const m = mesh.joints[vertex * 4 + lane]! * 16
      x += weight * (matrices[m]! * px + matrices[m + 4]! * py + matrices[m + 8]! * pz + matrices[m + 12]!)
      y += weight * (matrices[m + 1]! * px + matrices[m + 5]! * py + matrices[m + 9]! * pz + matrices[m + 13]!)
      z += weight * (matrices[m + 2]! * px + matrices[m + 6]! * py + matrices[m + 10]! * pz + matrices[m + 14]!)
    }
    out[vertex * 3] = x
    out[vertex * 3 + 1] = y
    out[vertex * 3 + 2] = z
  }
}

/**
 * Every piece vertex against the body it is worn on. `visible` is one flag per
 * triangle: a hidden triangle still answers "which way is out", it just cannot be
 * penetrated. `depth` is the threshold the slot's contract sets: anything deeper
 * than it counts against the gate. `exempt` flags piece vertices the caller has
 * ruled out of this pose entirely, and they are not searched at all.
 */
export function measurePenetration(
  body: Float32Array,
  triangles: Uint32Array,
  visible: Uint8Array,
  piece: Float32Array,
  depth: number,
  exempt: Uint8Array | null = null,
  partition: Uint8Array | null = null,
): Penetration {
  buildTriangleGrid(body, triangles, boundsOf(piece), REACH)
  let maxDepth = 0
  let over = 0
  let ownedOver = 0
  let fixedOver = 0

  for (let vertex = 0; vertex < piece.length / 3; vertex++) {
    if (exempt !== null && exempt[vertex] === 1) continue
    const found = depthBehindNearest(
      body, triangles, visible, piece[vertex * 3]!, piece[vertex * 3 + 1]!, piece[vertex * 3 + 2]!, REACH,
    )
    if (found <= 0) continue
    if (found > maxDepth) maxDepth = found
    if (found > depth) {
      over++
      if (partition !== null && partition[vertex] === 1) ownedOver++
      else fixedOver++
    }
  }
  return partition === null ? { maxDepth, over } : { maxDepth, over, ownedOver, fixedOver }
}
