import type { ArmCarryPose } from '../profiles/profile'
import type { ArmPace } from './armpace'
import { clamp } from './curves'
import { restDirection, type RigGeometry } from './geometry'
import { Joint, LEFT } from './joints'
import type { LimbScratch } from './limbs'
import { copyJointFrom, setJointQuat, type Pose } from './pose'
import { quatFromAxisAngle, quatMultiply, rotationBetween } from './quat'

/**
 * Where an empty hand is carried, and how it swings from there. One arm, one
 * swing generator, all the way from a stroll to a sprint: what changes with speed
 * is the numbers in `armpace.ts`, never which pose is being blended into which.
 *
 * A rig is authored in an A- or T-pose, so identity leaves the arms out to the
 * sides. The carry is computed from the rest directions rather than read off
 * them, and a profile only states one when it has a weapon carry measured off a
 * clip.
 */

/** An empty arm goes this much further forward than it goes back. */
const SWING_ASYMMETRY = 0.1
/** The hang the resting hand target is taken from. See `armpace.ts`. */
const REST_OUT = 10 * Math.PI / 180
const REST_BEND = 15 * Math.PI / 180

/** Module-level because writing an arm is on the frame path and must not allocate. */
const REST = new Float32Array(3)
const UPPER = new Float32Array(3)
const LOWER = new Float32Array(3)

/**
 * The hand's resting place relative to its own shoulder, in arm lengths: the carry
 * written as a target, so a keyframed pose returns where locomotion holds it.
 */
export const CARRY_HAND: readonly [number, number, number] = carryHand()

/**
 * One arm at one instant. `drive` is where the foot on this side is along its own
 * stride, from -1 with the arm fully forward to +1 with it fully back, so the arm
 * answers the stride rather than a wave fitted alongside it. `carry` is a
 * profile's measured weapon pose, which swings as it was measured.
 */
export function writeCarriedArm(
  geometry: RigGeometry,
  scratch: LimbScratch,
  out: Pose,
  side: number,
  drive: number,
  pace: ArmPace,
  carry?: ArmCarryPose,
): void {
  const shoulder = side === LEFT ? Joint.ShoulderL : Joint.ShoulderR
  const elbow = side === LEFT ? Joint.ElbowL : Joint.ElbowR
  const hand = side === LEFT ? Joint.HandL : Joint.HandR
  if (carry) {
    // Spread onto the frame path allocates an arguments array; these are per-frame.
    setJointQuat(out, shoulder, carry.shoulder[0], carry.shoulder[1], carry.shoulder[2], carry.shoulder[3])
    setJointQuat(out, elbow, carry.elbow[0], carry.elbow[1], carry.elbow[2], carry.elbow[3])
  } else {
    writeHangingArm(geometry, out, side, pace)
  }

  const reach = clamp(drive, -1, 1)
  // Smooth in the drive rather than a forward branch and a back one: a swing that
  // changes its rule as it passes through the middle has a corner there, twice a
  // stride, and a corner is what the eye reads as the path breaking.
  const swept = carry
    ? pace.swing * reach * carry.swingScale!
    : pace.swing * reach * (1 - SWING_ASYMMETRY * reach)
  quatFromAxisAngle(scratch.quat, 0, 1, 0, 0, swept)
  if (!carry) {
    // In across the body as the hand comes forward, out to the side as it goes
    // back — never past the shoulder either way.
    quatFromAxisAngle(scratch.spare, 0, 0, 1, 0, -side * pace.cross * (1 - reach) * 0.5)
    quatMultiply(scratch.spare, 0, scratch.quat, 0, scratch.quat, 0)
  }
  quatMultiply(scratch.quat, 0, out.rotations, shoulder * 4, out.rotations, shoulder * 4)
  quatMultiply(scratch.quat, 0, out.rotations, elbow * 4, out.rotations, elbow * 4)
  copyJointFrom(out, hand, elbow)
}

/**
 * The arm hanging at the body's side. Written as two absolute rotations rather
 * than solved onto a hand target: a chain this near full extension is where IK is
 * least stable.
 */
export function writeHangingArm(geometry: RigGeometry, out: Pose, side: number, pace: ArmPace): void {
  const shoulder = side === LEFT ? Joint.ShoulderL : Joint.ShoulderR
  const elbow = side === LEFT ? Joint.ElbowL : Joint.ElbowR
  hangDirections(side, pace.out, pace.bend)
  restDirection(geometry, shoulder, REST)
  rotationBetween(REST[0]!, REST[1]!, REST[2]!, UPPER[0]!, UPPER[1]!, UPPER[2]!, out.rotations, shoulder * 4)
  restDirection(geometry, elbow, REST)
  rotationBetween(REST[0]!, REST[1]!, REST[2]!, LOWER[0]!, LOWER[1]!, LOWER[2]!, out.rotations, elbow * 4)
}

/** Upper arm down and out, forearm bent forward from there. */
function hangDirections(side: number, out: number, bend: number): void {
  UPPER[0] = side * Math.sin(out)
  UPPER[1] = -Math.cos(out)
  UPPER[2] = 0
  // Negative pitch about +X carries the hand forward, which is the way an elbow bends.
  LOWER[0] = UPPER[0]!
  LOWER[1] = UPPER[1]! * Math.cos(bend)
  LOWER[2] = -UPPER[1]! * Math.sin(bend)
}

/** Where the hang leaves the hand, in arm lengths, for equal bones. */
function carryHand(): readonly [number, number, number] {
  hangDirections(LEFT, REST_OUT, REST_BEND)
  return [
    (UPPER[0]! + LOWER[0]!) * 0.5,
    (UPPER[1]! + LOWER[1]!) * 0.5,
    (UPPER[2]! + LOWER[2]!) * 0.5,
  ]
}
