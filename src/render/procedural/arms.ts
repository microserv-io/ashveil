import type { ArmCarryPose } from '../profiles/profile'
import { clamp, lerp } from './curves'
import { restDirection, type RigGeometry } from './geometry'
import { Joint, LEFT } from './joints'
import type { LimbScratch } from './limbs'
import { copyJointFrom, setJointQuat, type Pose } from './pose'
import { quatFromAxisAngle, quatMultiply, rotationBetween } from './quat'

/**
 * Where an empty hand is carried, and how it swings from there. A rig is authored
 * in an A- or T-pose, so identity leaves the arms out to the sides: the carry is
 * computed from the rest directions rather than read off them, and a profile only
 * states one when it has a weapon carry measured off a clip.
 */

/** How far a hanging arm clears the torso, what the elbow keeps, and what a run keeps. */
const CARRY_OUT = 10 * Math.PI / 180
const CARRY_BEND = 15 * Math.PI / 180
const RUN_BEND = 88 * Math.PI / 180

/** Stride fractions the swing is fitted to: a longer arm swings less of an angle. */
const SWING_WALK = 0.22
const SWING_RUN = 0.4
const SWING_CAP_WALK = 29 * Math.PI / 180
const SWING_CAP_RUN = 44 * Math.PI / 180
/** Below these a stride reads as a body being dragged along by its legs. */
const SWING_FLOOR_WALK = 22 * Math.PI / 180
const SWING_FLOOR_RUN = 33 * Math.PI / 180
/** An empty arm goes further forward than back, and crosses in front of the body. */
const SWING_ASYMMETRY = 0.1
const SWING_INWARD = 0.18


/** Module-level because writing an arm is on the frame path and must not allocate. */
const REST = new Float32Array(3)
const UPPER = new Float32Array(3)
const LOWER = new Float32Array(3)
export function armSwingAmplitude(geometry: RigGeometry, runBlend: number): number {
  if (geometry.armLength <= 0) return 0
  const fitted = lerp(SWING_WALK, SWING_RUN, runBlend) * geometry.nominalLegLength / geometry.armLength
  const floor = lerp(SWING_FLOOR_WALK, SWING_FLOOR_RUN, runBlend)
  return clamp(fitted, floor, lerp(SWING_CAP_WALK, SWING_CAP_RUN, runBlend))
}

/**
 * The hand's resting place relative to its own shoulder, in arm lengths: the carry
 * written as a target, so a keyframed pose returns where locomotion holds it.
 */
export const CARRY_HAND: readonly [number, number, number] = carryHand()

/** One arm: the carry, then the swing on it. `carry` is a profile's measured pose. */
export function writeCarriedArm(
  geometry: RigGeometry,
  scratch: LimbScratch,
  out: Pose,
  side: number,
  swing: number,
  runBlend: number,
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
    writeHangingArm(geometry, out, side, runBlend)
  }

  // A measured weapon carry swings as it was measured; an empty hand goes further
  // forward than back and crosses in front of the body on the way.
  const shaped = carry ? swing * carry.swingScale! : swing * (swing < 0 ? 1 + SWING_ASYMMETRY : 1 - SWING_ASYMMETRY)
  quatFromAxisAngle(scratch.quat, 0, 1, 0, 0, shaped)
  if (!carry) {
    quatFromAxisAngle(scratch.spare, 0, 0, 1, 0, side * SWING_INWARD * Math.max(0, -shaped))
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
export function writeHangingArm(geometry: RigGeometry, out: Pose, side: number, runBlend: number): void {
  const shoulder = side === LEFT ? Joint.ShoulderL : Joint.ShoulderR
  const elbow = side === LEFT ? Joint.ElbowL : Joint.ElbowR
  hangDirections(side, lerp(CARRY_BEND, RUN_BEND, runBlend))
  restDirection(geometry, shoulder, REST)
  rotationBetween(REST[0]!, REST[1]!, REST[2]!, UPPER[0]!, UPPER[1]!, UPPER[2]!, out.rotations, shoulder * 4)
  restDirection(geometry, elbow, REST)
  rotationBetween(REST[0]!, REST[1]!, REST[2]!, LOWER[0]!, LOWER[1]!, LOWER[2]!, out.rotations, elbow * 4)
}

/** Upper arm down and out, forearm bent forward from there. */
function hangDirections(side: number, bend: number): void {
  UPPER[0] = side * Math.sin(CARRY_OUT)
  UPPER[1] = -Math.cos(CARRY_OUT)
  UPPER[2] = 0
  // Negative pitch about +X carries the hand forward, which is the way an elbow bends.
  LOWER[0] = UPPER[0]!
  LOWER[1] = UPPER[1]! * Math.cos(bend)
  LOWER[2] = -UPPER[1]! * Math.sin(bend)
}

/** Where the hang leaves the hand, in arm lengths, for equal bones. */
function carryHand(): readonly [number, number, number] {
  hangDirections(LEFT, CARRY_BEND)
  return [
    (UPPER[0]! + LOWER[0]!) * 0.5,
    (UPPER[1]! + LOWER[1]!) * 0.5,
    (UPPER[2]! + LOWER[2]!) * 0.5,
  ]
}
