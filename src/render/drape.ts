import { collide, type DrapeColliders } from './drapecollide'

/**
 * Hanging cloth as a chain of damped pendulums.
 *
 * A sash, a pauldron drape or a cloak is skinned to its own short chain of bones
 * under the body bone it hangs from, and it swings because that bone moves: the
 * only input is where the chain's root went since the last step. No `three` and no
 * wall clock, so the same maths runs in the browser, in Node and inside the
 * fitter's clip gate, and the same inputs give the same swing.
 *
 * Angles are measured from the chain's own rest line — straight down at bind, and
 * carried by the bone it hangs from after that — and they accumulate down the
 * chain, because a limit has to hold for the whole chain rather than per joint. The
 * restoring pull still acts on each segment's angle *relative* to the one above it,
 * which is what makes a chain whip rather than swing as one plank.
 */

export const DRAPE = {
  /** Metres per second squared: the root motion is measured in the same metres. */
  gravity: 9.81,
  /** Underdamped, so cloth swings a few times, and settled inside a couple of seconds. */
  damping: 3.2,
  /**
   * How hard the air pushes back, per metre per second. Without it a steady walk
   * accelerates nothing and the cloak hangs dead straight.
   */
  drag: 1.2,
  /** The cone: how far the chain may swing into the body, away from it, and across. */
  towardLimit: (5 * Math.PI) / 180,
  awayLimit: (60 * Math.PI) / 180,
  sideLimit: (35 * Math.PI) / 180,
  /** One pole on the root acceleration, seconds: one jittery frame is not a gust. */
  smoothing: 0.08,
  /** A pendulum this stiff diverges on a long frame, so long frames are substepped. */
  maxStep: 1 / 120,
} as const

export interface DrapeParams {
  readonly segments: number
  /** One bone's length, in the metres the root motion is measured in. */
  readonly segmentLength: number
  /** The same length in rig units, which is the frame the limb capsules are in. */
  readonly reach: number
  /** How far off a limb the cloth is held: the slot's own clearance and a little. */
  readonly clearance: number
}

export interface DrapeState {
  /** Per segment, from the rest line and counting the segments above. Positive is away. */
  readonly swing: Float32Array
  readonly swingRate: Float32Array
  /** Per segment, across the swing, and accumulated the same way. */
  readonly side: Float32Array
  readonly sideRate: Float32Array
  /** The root's last position, its last rig-frame velocity, then its smoothed acceleration. */
  readonly root: Float32Array
  /** False until a position has been seen: attaching a piece must not kick the chain. */
  tracked: boolean
}

/** Where the chain hangs from, as the caller measured it this step. */
export interface DrapeRoot {
  /** Position in a frame that does not turn with the body, so that turning is motion. */
  x: number
  y: number
  z: number
  /** The same point in the rig frame, which is the frame the limb capsules are in. */
  localX: number
  localY: number
  localZ: number
  /** Rig-frame velocity the position does not carry: the clip gate's forward travel. */
  vx: number
  vy: number
  vz: number
  /** The rig frame's yaw within the frame `x, y, z` are given in. */
  yaw: number
  /**
   * Rig-frame unit directions: where the chain hangs at rest, and where its tip moves
   * for a positive swing (away from the body) and a positive side angle. All three
   * follow the bone the chain hangs from, so they arrive per step.
   */
  readonly rest: Float32Array
  readonly away: Float32Array
  readonly side: Float32Array
}

export function createDrapeState(segments: number): DrapeState {
  return {
    swing: new Float32Array(segments),
    swingRate: new Float32Array(segments),
    side: new Float32Array(segments),
    sideRate: new Float32Array(segments),
    root: new Float32Array(9),
    tracked: false,
  }
}

/** A drape hanging off a body facing +Z: away is behind it, side is to its left. */
export function createDrapeRoot(): DrapeRoot {
  const rest = new Float32Array([0, -1, 0])
  const away = new Float32Array([0, 0, -1])
  return {
    x: 0, y: 0, z: 0, localX: 0, localY: 0, localZ: 0, vx: 0, vy: 0, vz: 0, yaw: 0,
    rest, away, side: new Float32Array([1, 0, 0]),
  }
}

/** Hanging still again, with no memory of where the root used to be. */
export function resetDrapeState(state: DrapeState): void {
  state.swing.fill(0)
  state.swingRate.fill(0)
  state.side.fill(0)
  state.sideRate.fill(0)
  state.root.fill(0)
  state.tracked = false
}

/** `dt` is a sim-time delta; a step of zero tracks the root without kicking the chain. */
export function stepDrape(
  state: DrapeState, params: DrapeParams, root: DrapeRoot, dt: number, limbs: DrapeColliders | null = null,
): void {
  trackRoot(state, root, dt)
  if (dt <= 0) return
  // What the cloth is pulled by: gravity, less the acceleration of the pivot it hangs
  // from and the air it is dragged through. A rod lines up with this, so a shoulder
  // that rolls forward lets its cloak swing back toward the vertical.
  const pullX = -(state.root[6]! + DRAPE.drag * state.root[3]!)
  const pullY = -DRAPE.gravity - (state.root[7]! + DRAPE.drag * state.root[4]!)
  const pullZ = -(state.root[8]! + DRAPE.drag * state.root[5]!)
  const along = pullX * root.rest[0]! + pullY * root.rest[1]! + pullZ * root.rest[2]!
  const away = pullX * root.away[0]! + pullY * root.away[1]! + pullZ * root.away[2]!
  const sideways = pullX * root.side[0]! + pullY * root.side[1]! + pullZ * root.side[2]!
  const steps = Math.max(1, Math.ceil(dt / DRAPE.maxStep))
  const step = dt / steps
  for (let taken = 0; taken < steps; taken++) {
    integrate(state.swing, state.swingRate, params, away, along, step, -DRAPE.towardLimit, DRAPE.awayLimit)
    integrate(state.side, state.sideRate, params, sideways, along, step, -DRAPE.sideLimit, DRAPE.sideLimit)
    if (limbs !== null && limbs.count > 0) collide(state, params, root, limbs, DRAPE)
  }
}

/**
 * A damped pendulum per segment: the torque is the pull's component along the way
 * the tip moves, which for an angle off the rest line is `across * cos - along *
 * sin`. The parent's angle is already in `angles[at]` — they are absolute — so the
 * pull acts on the whole chain, while damping and the parent's own angular
 * acceleration act on the relative angle, which is the joint that actually bends.
 */
function integrate(
  angles: Float32Array, rates: Float32Array, params: DrapeParams,
  across: number, along: number, dt: number, low: number, high: number,
): void {
  const length = params.segmentLength
  let parentRate = 0
  let parentAccel = 0
  for (let at = 0; at < params.segments; at++) {
    const rate = rates[at]!
    const angle = angles[at]!
    const torque = (across * Math.cos(angle) - along * Math.sin(angle)) / length
    const accel = parentAccel + torque - DRAPE.damping * (rate - parentRate)
    let next = rate + accel * dt
    let turned = angle + next * dt
    // A clamped segment has hit the body or turned further than cloth folds; letting
    // it keep its velocity would park it against the limit and shake there.
    if (turned > high) {
      turned = high
      next = 0
    } else if (turned < low) {
      turned = low
      next = 0
    }
    angles[at] = turned
    rates[at] = next
    parentRate = rate
    parentAccel = accel
  }
}

/**
 * Root velocity from successive positions, and a smoothed acceleration from that.
 * The velocity is rotated into the rig frame before it is differenced, so a body
 * turning on the spot reads as the sideways acceleration it really is.
 */
function trackRoot(state: DrapeState, root: DrapeRoot, dt: number): void {
  const memory = state.root
  if (!state.tracked || dt <= 0) {
    memory[0] = root.x
    memory[1] = root.y
    memory[2] = root.z
    if (!state.tracked) memory.fill(0, 3)
    state.tracked = true
    return
  }

  const worldX = (root.x - memory[0]!) / dt
  const worldY = (root.y - memory[1]!) / dt
  const worldZ = (root.z - memory[2]!) / dt
  const cos = Math.cos(root.yaw)
  const sin = Math.sin(root.yaw)
  const velocityX = worldX * cos - worldZ * sin + root.vx
  const velocityY = worldY + root.vy
  const velocityZ = worldX * sin + worldZ * cos + root.vz

  const blend = dt / (DRAPE.smoothing + dt)
  memory[6] = memory[6]! + ((velocityX - memory[3]!) / dt - memory[6]!) * blend
  memory[7] = memory[7]! + ((velocityY - memory[4]!) / dt - memory[7]!) * blend
  memory[8] = memory[8]! + ((velocityZ - memory[5]!) / dt - memory[8]!) * blend
  memory[0] = root.x
  memory[1] = root.y
  memory[2] = root.z
  memory[3] = velocityX
  memory[4] = velocityY
  memory[5] = velocityZ
}
