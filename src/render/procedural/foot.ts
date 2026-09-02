import type { RigGeometry } from './geometry'

/**
 * The foot as a lever rather than a point.
 *
 * A planted ankle is not what a body actually stands on: it lands on the heel,
 * rolls flat, and leaves over the ball of the foot. That matters far beyond the
 * ankle, because a stance leg is a two-bone chain and the hip can only ride as
 * high as the chain can reach. Pinned to the ankle, a step of two thirds of a leg
 * drags the hips down 90 mm and the walk reads as a lunge; rolling over the heel
 * lifts the ankle and pulls it back under the hip, and the drop halves.
 *
 * The contact point still travels backward at exactly the actor's speed, so the
 * no-slide construction is untouched — it now holds at the heel and the ball,
 * which are the parts of the foot that are ever really planted.
 */

/** A foot is about this much of a body's height, heel to toe, and no more than this much of its leg. */
const FOOT_LENGTH = 0.152
const FOOT_PER_LEG = 0.36
/** Where the ankle stands along the foot, and where it breaks over at the toe. */
const HEEL_BEHIND = 0.25
const BALL_AHEAD = 0.45
/** How far the foot tips up onto its heel at footfall, and over its ball at toe-off. */
const HEEL_STRIKE = 30 * Math.PI / 180
const TOE_OFF = 30 * Math.PI / 180

function footLength(geometry: RigGeometry): number {
  return Math.min(FOOT_LENGTH * geometry.standingHeight, FOOT_PER_LEG * geometry.legLength)
}

/** How far behind the ankle the heel touches down. */
export function heelOffset(geometry: RigGeometry): number {
  return footLength(geometry) * HEEL_BEHIND
}

/** How far ahead of the ankle the foot breaks over at toe-off. */
export function ballOffset(geometry: RigGeometry): number {
  return footLength(geometry) * BALL_AHEAD
}

/**
 * Where the roll leaves the ankle at a stance excursion of `forward` — +1 with the
 * foot at its furthest ahead, -1 at its furthest behind — and how the foot is
 * pitched to put it there. Writes the ankle's rise into `out[0]` and its shift
 * along the stride into `out[1]`, both relative to a foot lying flat.
 *
 * Squared rather than linear so the foot spends the middle of stance flat, which
 * is where a foot actually is.
 */
export function footRoll(geometry: RigGeometry, forward: number, out: Float32Array): number {
  const pitch = forward > 0 ? -HEEL_STRIKE * forward * forward : TOE_OFF * forward * forward
  const lever = forward > 0 ? heelOffset(geometry) : -ballOffset(geometry)
  const rise = Math.cos(pitch) - 1
  const turn = Math.sin(pitch)
  out[0] = geometry.ankleHeight * rise - lever * turn
  out[1] = geometry.ankleHeight * turn + lever * rise
  return pitch
}
