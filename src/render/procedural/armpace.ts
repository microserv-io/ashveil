import { clamp, lerp } from './curves'
import type { RigGeometry } from './geometry'

/**
 * What an arm is doing at a given pace, as one set of numbers.
 *
 * A walk and a run were once two authored arm styles crossed over between — a
 * bent arm crossing the body and a square-elbow pump — and blending two absolute
 * poses against each other threw the hands outward through the middle of the
 * speed range and changed the shape of the path they took from stride to stride.
 * Every quantity here is instead one monotonic function of how far along from
 * walking to running the body is, and `arms.ts` drives a single swing off them.
 */

/** The hanging arm, from a walk to a run: how far off the body, and how bent. */
const OUT_WALK = 10 * Math.PI / 180
const OUT_RUN = 7 * Math.PI / 180
const BEND_WALK = 15 * Math.PI / 180
const BEND_RUN = 88 * Math.PI / 180

/** Stride fractions the swing is fitted to: a longer arm swings less of an angle. */
const SWING_WALK = 0.22
const SWING_RUN = 0.4
const SWING_CAP_WALK = 29 * Math.PI / 180
const SWING_CAP_RUN = 44 * Math.PI / 180
/** Below these a stride reads as a body being dragged along by its legs. */
const SWING_FLOOR_WALK = 22 * Math.PI / 180
const SWING_FLOOR_RUN = 33 * Math.PI / 180
/** How far the hand comes in across the body at the front of its swing. */
const CROSS_WALK = 10 * Math.PI / 180
const CROSS_RUN = 6 * Math.PI / 180

/**
 * Everything an arm does at one pace. Each is monotonic in the walk-to-run blend,
 * so nothing about the arm changes direction as the body speeds up.
 */
export interface ArmPace {
  /** Angle at the elbow: a walk keeps a little, a run keeps a right angle. */
  readonly bend: number
  /** How far the hanging upper arm clears the torso. A run brings the elbows in. */
  readonly out: number
  /** Half the fore-and-aft angle the shoulder sweeps. */
  readonly swing: number
  /** How far the hand comes in across the body at the front of the swing. */
  readonly cross: number
}

export function armPace(geometry: RigGeometry, runBlend: number): ArmPace {
  const blend = clamp(runBlend, 0, 1)
  const fitted = geometry.armLength > 0
    ? lerp(SWING_WALK, SWING_RUN, blend) * geometry.nominalLegLength / geometry.armLength
    : 0
  return {
    bend: lerp(BEND_WALK, BEND_RUN, blend),
    out: lerp(OUT_WALK, OUT_RUN, blend),
    swing: clamp(fitted, lerp(SWING_FLOOR_WALK, SWING_FLOOR_RUN, blend), lerp(SWING_CAP_WALK, SWING_CAP_RUN, blend)),
    cross: lerp(CROSS_WALK, CROSS_RUN, blend),
  }
}
