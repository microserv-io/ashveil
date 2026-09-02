import { lerp, smoothstep } from './curves'
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
  let pitch = 0
  let forward = 0
  if (phase < duty) {
    // Stance: straight back at the actor's own speed, which is the no-slide rule.
    forward = 1 - 2 * (phase / duty)
    pitch = footRoll(geometry, forward, ROLL)
    scratch.target[1] = geometry.ankleHeight + ROLL[0]!
    scratch.target[2] = halfStep * forward + ROLL[1]!
  } else {
    // Swing leaves the ground where the toe-off left it and lands where the heel
    // strike wants it, so the foot never jumps at either handover.
    const s = (phase - duty) / (1 - duty)
    const eased = smoothstep(0, 1, s)
    swing = Math.sin(Math.PI * s)
    const off = footRoll(geometry, -1, ROLL)
    const offRise = ROLL[0]!
    const offAlong = -halfStep + ROLL[1]!
    const strike = footRoll(geometry, 1, ROLL)
    forward = -1 + 2 * eased
    pitch = lerp(off, strike, eased) - SWING_CLEARANCE * swing
    scratch.target[1] = geometry.ankleHeight + lerp(offRise, ROLL[0]!, eased) + lift * swing
    scratch.target[2] = lerp(offAlong, halfStep + ROLL[1]!, eased)
  }
  scratch.target[0] = side * geometry.hipWidth * (1 - STANCE_NARROW * runBlend)
  if (phase >= duty) liftToReach(geometry, scratch, side, swing)
  writeLeg(geometry, scratch, out, side, pitch)
  return forward * halfStep
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
  scratch.target[1] = Math.max(scratch.target[1]!, scratch.positions[hip * 3 + 1]! - drop)
}
