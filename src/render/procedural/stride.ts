import { clamp, hermite } from './curves'
import { footRoll } from './foot'
import type { GaitParams } from './gait'
import type { RigGeometry } from './geometry'
import { Joint, LEFT } from './joints'
import { writeLeg, type LimbScratch } from './limbs'
import type { Pose } from './pose'
import { stanceReach, swingReach } from './proportions'

/**
 * Where one foot goes over one stride. Stance is a straight line backward at the
 * actor's own speed — the no-slide rule the whole gait is built on — and swing is
 * the arc that carries it forward again.
 */

/** How much narrower the feet track under the body as it speeds up. */
const STANCE_NARROW = 0.15
/** Toes up through mid-swing, so a swinging foot clears the ground it crosses. */
const SWING_CLEARANCE = 0.25
/**
 * The swing leaves and lands at exactly the speed stance runs at. Anything less
 * and the foot changes pace on the frame it touches down, which is a hitch once a
 * stride; the cost is that the foot reaches past the step and comes back, which
 * is what a real one does.
 */
const RETRACT = 0.5

/** Writes one leg onto its stride, and answers how far forward of the hip it landed. */
export function writeStrideLeg(
  geometry: RigGeometry,
  params: GaitParams,
  scratch: LimbScratch,
  out: Pose,
  side: number,
  legPhase: number,
): number {
  const { duty, halfStep, runBlend, lift } = params
  const phase = legPhase - Math.floor(legPhase)
  let swing = 0
  let flat = 0
  if (phase < duty) {
    // Stance: straight back at the actor's own speed, which is the no-slide rule.
    flat = 1 - 2 * (phase / duty)
  } else {
    // A foot that lands still is already travelling backwards: stance leaves at
    // the body's own speed, so the swing arrives at that slope rather than easing
    // to a stop and being yanked into the stride on the next frame.
    const s = (phase - duty) / (1 - duty)
    swing = Math.sin(Math.PI * s)
    const slope = -RETRACT * 2 * (1 - duty) / Math.max(0.05, duty)
    flat = hermite(-1, 1, slope, slope, s)
  }
  // The roll follows where the foot is along the stride rather than which half of
  // the cycle it is in, so nothing changes rate at the handover.
  const pitch = footRoll(geometry, clamp(flat, -1, 1), ROLL) - SWING_CLEARANCE * swing
  scratch.target[0] = side * geometry.hipWidth * (1 - STANCE_NARROW * runBlend)
  // Squared, so the foot settles onto the ground instead of arriving with the
  // whole descent still in it and stopping dead the frame it lands.
  scratch.target[1] = geometry.ankleHeight + ROLL[0]! + lift * swing * swing
  scratch.target[2] = halfStep * flat + ROLL[1]!
  if (phase >= duty) liftToReach(geometry, scratch, side, swing)
  writeLeg(geometry, scratch, out, side, pitch)
  return halfStep * flat
}

const ROLL = new Float32Array(2)

/**
 * Raises a swinging foot until its own leg can reach it. The hip rides high at
 * mid-stance, which is exactly when the other foot is furthest forward, so the
 * arc the lift alone describes runs the chain into full extension and the knee
 * snaps straight. A foot that lifts as far as the leg needs cannot.
 */
function liftToReach(geometry: RigGeometry, scratch: LimbScratch, side: number, swing: number): void {
  const hip = side === LEFT ? Joint.HipL : Joint.HipR
  // Eased over the swing so the foot leaves and lands where stance left it.
  const reach = stanceReach(geometry) + (swingReach(geometry) - stanceReach(geometry)) * swing
  const dx = scratch.target[0]! - scratch.positions[hip * 3]!
  const dz = scratch.target[2]! - scratch.positions[hip * 3 + 2]!
  const flat = Math.hypot(dx, dz)
  if (flat >= reach) return
  const drop = Math.sqrt(reach * reach - flat * flat)
  // Faded out with the swing that needs it. Held to the end, this lifts the foot a
  // centimetre above where the stride wants it and then lets go on the frame the
  // foot lands: a corner in the one path a walk is built on, once a stride.
  const wanted = scratch.positions[hip * 3 + 1]! - drop
  if (wanted > scratch.target[1]!) scratch.target[1]! += (wanted - scratch.target[1]!) * swing
}
