import { quatIdentity, rotationBetween } from './quat'

/**
 * One two-bone chain to solve: a leg, an arm, or a quadruped's foreleg. The caller
 * owns it for the life of the body and rewrites its fields each frame, so solving
 * allocates nothing.
 *
 * Everything is in the body frame (see `joints.ts`). `restUpper` and `restLower`
 * are the canonical rest directions of the two bones, so the solved quaternions
 * come out in the canonical frame and can be written straight into a `Pose`.
 */
export interface TwoBoneChain {
  /** Where the chain hangs from: hip, or shoulder. */
  readonly root: Float32Array
  /** Where the end effector should land: ankle, or wrist. */
  readonly target: Float32Array
  /** The middle joint bends toward this direction: knee forward, elbow back. */
  readonly pole: Float32Array
  readonly restUpper: Float32Array
  readonly restLower: Float32Array
  upperLength: number
  lowerLength: number
}

export function createTwoBoneChain(): TwoBoneChain {
  return {
    root: new Float32Array(3),
    target: new Float32Array(3),
    pole: new Float32Array(3),
    restUpper: new Float32Array(3),
    restLower: new Float32Array(3),
    upperLength: 1,
    lowerLength: 1,
  }
}

const EPSILON = 1e-6

/**
 * Analytic two-bone IK. Writes the upper bone's rotation at `upperOffset` and the
 * lower bone's at `lowerOffset` in `out`, both absolute in the body frame.
 *
 * The chain always keeps its bone lengths: an out-of-reach target straightens it
 * along the line to the target rather than stretching, and a target inside the
 * fold limit opens to the tightest angle the bones allow. Degenerate inputs — a
 * target on the root, a pole parallel to the chain — resolve to a defined pose,
 * because a foot target can legitimately pass through its own hip mid-stride and
 * a NaN there propagates into every bone matrix for the rest of the run.
 */
export function solveTwoBone(chain: TwoBoneChain, out: Float32Array, upperOffset: number, lowerOffset: number): void {
  const upper = chain.upperLength
  const lower = chain.lowerLength
  let dx = chain.target[0]! - chain.root[0]!
  let dy = chain.target[1]! - chain.root[1]!
  let dz = chain.target[2]! - chain.root[2]!
  let distance = Math.hypot(dx, dy, dz)

  if (distance < EPSILON) {
    // No direction to aim at; the folded rest pose is as good an answer as any.
    quatIdentity(out, upperOffset)
    quatIdentity(out, lowerOffset)
    return
  }

  const ux = dx / distance
  const uy = dy / distance
  const uz = dz / distance
  const reach = upper + lower
  const fold = Math.abs(upper - lower) + EPSILON
  distance = Math.min(Math.max(distance, fold), reach)

  const cosine = Math.min(1, Math.max(-1, (upper * upper + distance * distance - lower * lower) / (2 * upper * distance)))
  const angle = Math.acos(cosine)

  // The bend plane: the pole with its component along the chain removed.
  const alongPole = chain.pole[0]! * ux + chain.pole[1]! * uy + chain.pole[2]! * uz
  let vx = chain.pole[0]! - ux * alongPole
  let vy = chain.pole[1]! - uy * alongPole
  let vz = chain.pole[2]! - uz * alongPole
  let vl = Math.hypot(vx, vy, vz)
  if (vl < EPSILON) {
    // A pole parallel to the chain names no plane, so any perpendicular will do.
    const sideways = Math.abs(ux) < 0.9
    const px = sideways ? 1 : 0
    const py = sideways ? 0 : 1
    vx = uy * 0 - uz * py
    vy = uz * px - ux * 0
    vz = ux * py - uy * px
    vl = Math.hypot(vx, vy, vz)
  }
  vx /= vl
  vy /= vl
  vz /= vl

  const cosBend = Math.cos(angle)
  const sinBend = Math.sin(angle)
  const upperX = ux * cosBend + vx * sinBend
  const upperY = uy * cosBend + vy * sinBend
  const upperZ = uz * cosBend + vz * sinBend

  dx = ux * distance - upperX * upper
  dy = uy * distance - upperY * upper
  dz = uz * distance - upperZ * upper

  rotationBetween(chain.restUpper[0]!, chain.restUpper[1]!, chain.restUpper[2]!, upperX, upperY, upperZ, out, upperOffset)
  rotationBetween(chain.restLower[0]!, chain.restLower[1]!, chain.restLower[2]!, dx, dy, dz, out, lowerOffset)
}
