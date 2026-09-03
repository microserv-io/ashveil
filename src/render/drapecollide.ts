import type { DrapeParams, DrapeRoot, DrapeState } from './drape'

/**
 * Pushing a drape out of the limbs it hangs beside.
 *
 * A cone limit cannot do this job. It stops cloth swinging into the body, but the
 * failures the clip gate reports are the other way round: a walking thigh swings
 * into cloth hanging exactly where it was fitted, and the only thing that can move
 * the cloth is the thigh. So the body is a handful of capsules, and every step ends
 * by turning the chain back out of them.
 *
 * Three-free and allocation-free like the pendulum it serves, and it takes the cone
 * rather than reading it, so nothing here has to import the module that calls it.
 */

/** The cone a pushed segment still has to stay inside. */
export interface DrapeCone {
  readonly towardLimit: number
  readonly awayLimit: number
  readonly sideLimit: number
}

/**
 * The limbs a drape is pushed off, as a capsule between two of the body's bones.
 * The names are the family contract's, so any body in the family resolves them; a
 * body missing one simply has no capsule there.
 *
 * The radii are stated rather than derived. `RigGeometry` carries every limb's
 * length and no limb's thickness, and a radius invented from a length would be a
 * guess wearing a measurement's clothes; these were read off masculine-v3.
 */
export const DRAPE_LIMBS: readonly { readonly from: string; readonly to: string; readonly radius: number }[] = [
  { from: 'pelvis', to: 'chest', radius: 0.15 },
  { from: 'thigh_L', to: 'shin_L', radius: 0.085 },
  { from: 'thigh_R', to: 'shin_R', radius: 0.085 },
  { from: 'shin_L', to: 'foot_L', radius: 0.06 },
  { from: 'shin_R', to: 'foot_R', radius: 0.06 },
  { from: 'upper_arm_L', to: 'forearm_L', radius: 0.05 },
  { from: 'upper_arm_R', to: 'forearm_R', radius: 0.05 },
]

/** Both ends of a capsule in the rig frame, then its radius. */
export const CAPSULE = 7

export interface DrapeColliders {
  readonly capsules: Float32Array
  count: number
}

export const EMPTY_DRAPE_COLLIDERS: DrapeColliders = { capsules: new Float32Array(0), count: 0 }

export function createDrapeColliders(capacity: number): DrapeColliders {
  return { capsules: new Float32Array(capacity * CAPSULE), count: 0 }
}


/**
 * Turns the chain back out of any limb it is inside. Each segment's midpoint and
 * tip is measured against every capsule, and a point within the clearance is turned
 * along the shortest way out — the angle that moves it that far at its own distance
 * from the pivot, split between the two axes it can turn on. The children follow,
 * the way a parent's rotation always carries them, and the cone limits still bound
 * the result: they are the backstop, not the answer.
 */
export function collide(
  state: DrapeState, params: DrapeParams, root: DrapeRoot, limbs: DrapeColliders, cone: DrapeCone,
): void {
  let headX = root.localX
  let headY = root.localY
  let headZ = root.localZ
  for (let at = 0; at < params.segments; at++) {
    for (let sample = 1; sample <= SAMPLES; sample++) {
      const reach = (params.reach * sample) / SAMPLES
      // Twice over the capsules: a push clear of a swinging arm can put the cloth
      // inside the torso, and one pass in a fixed order would leave it there.
      for (let relax = 0; relax < RELAX; relax++) {
        aim(state, at, root)
        push(state, params, limbs, cone, at, reach,
          headX + AIM[0]! * reach, headY + AIM[1]! * reach, headZ + AIM[2]! * reach)
      }
    }
    aim(state, at, root)
    headX += AIM[0]! * params.reach
    headY += AIM[1]! * params.reach
    headZ += AIM[2]! * params.reach
  }
}

function push(
  state: DrapeState, params: DrapeParams, limbs: DrapeColliders, cone: DrapeCone,
  at: number, reach: number, px: number, py: number, pz: number,
): void {
  for (let limb = 0; limb < limbs.count; limb++) {
    const o = limb * CAPSULE
    const distance = depth(limbs, o, px, py, pz)
    const want = limbs.capsules[o + 6]! + params.clearance
    if (distance >= want) continue

    // Dead on the bone's axis there is no shortest way out, so any way out will do.
    const scale = distance < EPSILON ? 0 : 1 / distance
    const ex = scale === 0 ? SWING_TANGENT[0]! : NEAR[0]! * scale
    const ey = scale === 0 ? SWING_TANGENT[1]! : NEAR[1]! * scale
    const ez = scale === 0 ? SWING_TANGENT[2]! : NEAR[2]! * scale
    const angle = (want - distance) / reach
    turn(state.swing, state.swingRate, params.segments, at,
      angle * (ex * SWING_TANGENT[0]! + ey * SWING_TANGENT[1]! + ez * SWING_TANGENT[2]!),
      -cone.towardLimit, cone.awayLimit)
    turn(state.side, state.sideRate, params.segments, at,
      angle * (ex * SIDE_TANGENT[0]! + ey * SIDE_TANGENT[1]! + ez * SIDE_TANGENT[2]!),
      -cone.sideLimit, cone.sideLimit)
  }
}

/** How far a point is from a capsule's axis, with the nearest point left in NEAR. */
function depth(limbs: DrapeColliders, o: number, px: number, py: number, pz: number): number {
  const abx = limbs.capsules[o + 3]! - limbs.capsules[o]!
  const aby = limbs.capsules[o + 4]! - limbs.capsules[o + 1]!
  const abz = limbs.capsules[o + 5]! - limbs.capsules[o + 2]!
  const span = abx * abx + aby * aby + abz * abz
  const along = span < EPSILON ? 0
    : ((px - limbs.capsules[o]!) * abx + (py - limbs.capsules[o + 1]!) * aby
      + (pz - limbs.capsules[o + 2]!) * abz) / span
  const t = along < 0 ? 0 : along > 1 ? 1 : along
  NEAR[0] = px - (limbs.capsules[o]! + abx * t)
  NEAR[1] = py - (limbs.capsules[o + 1]! + aby * t)
  NEAR[2] = pz - (limbs.capsules[o + 2]! + abz * t)
  return Math.hypot(NEAR[0]!, NEAR[1]!, NEAR[2]!)
}

/** Where a segment points, and the two directions its tip moves as its angles grow. */
function aim(state: DrapeState, at: number, root: DrapeRoot): void {
  const swing = Math.cos(state.swing[at]!)
  const swung = Math.sin(state.swing[at]!)
  const side = Math.cos(state.side[at]!)
  const sided = Math.sin(state.side[at]!)
  for (let axis = 0; axis < 3; axis++) {
    const rest = root.rest[axis]!
    const away = root.away[axis]!
    const across = root.side[axis]!
    AIM[axis] = rest * swing * side + away * swung * side + across * sided
    SWING_TANGENT[axis] = away * swing - rest * swung
    SIDE_TANGENT[axis] = across * side - (rest * swing + away * swung) * sided
  }
}

/** A segment turns and its children come with it; the cone still bounds them all. */
function turn(
  angles: Float32Array, rates: Float32Array, segments: number, at: number, delta: number, low: number, high: number,
): void {
  if (delta === 0) return
  for (let below = at; below < segments; below++) {
    const turned = angles[below]! + delta
    angles[below] = turned > high ? high : turned < low ? low : turned
  }
  // Whatever was carrying the cloth into the limb was spent arriving there.
  if (rates[at]! * delta < 0) rates[at] = 0
}

/** How many points along a segment are tested: its middle and its tip. */
const SAMPLES = 2
/** How many times the capsules are walked per point, so their pushes agree. */
const RELAX = 2
const EPSILON = 1e-9

/** Module-level: `collide` runs once per chain per substep and must not allocate. */
const AIM = new Float32Array(3)
const SWING_TANGENT = new Float32Array(3)
const SIDE_TANGENT = new Float32Array(3)
const NEAR = new Float32Array(3)
