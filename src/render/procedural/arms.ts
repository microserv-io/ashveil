import type { ArmCarryPose } from '../profiles/profile'
import { lerp } from './curves'
import type { RigGeometry } from './geometry'
import { Joint, LEFT } from './joints'
import { writeArm, type LimbScratch } from './limbs'
import { copyJointFrom, setJointQuat, type Pose } from './pose'
import { quatFromAxisAngle, quatMultiply } from './quat'

const SWING_WALK = 0.22
const SWING_RUN = 0.4
const SWING_CAP_WALK = 20 * Math.PI / 180
const SWING_CAP_RUN = 35 * Math.PI / 180
/** A relaxed arm hangs at this much of its length, tucked closer as the body runs. */
const HANG = 0.84
const OUT = 0.22
const TUCK = 0.12

export function armSwingAmplitude(geometry: RigGeometry, runBlend: number): number {
  if (geometry.armLength <= 0) return 0
  const fitted = lerp(SWING_WALK, SWING_RUN, runBlend) * geometry.nominalLegLength / geometry.armLength
  return Math.min(fitted, lerp(SWING_CAP_WALK, SWING_CAP_RUN, runBlend))
}

/** An arm hanging by the body's side, given a hand target relative to the shoulder. */
export function writeHangingArm(
  geometry: RigGeometry,
  scratch: LimbScratch,
  out: Pose,
  side: number,
  swing: number,
  runBlend: number,
): void {
  const hang = geometry.armLength * (HANG - TUCK * runBlend)
  writeArm(geometry, scratch, out, side, side * hang * OUT, -hang, swing)
}

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
  writeHangingArm(geometry, scratch, out, side, 0, runBlend)
  if (carry) {
    // Spread onto the frame path allocates an arguments array; these are per-frame.
    setJointQuat(out, shoulder, carry.shoulder[0], carry.shoulder[1], carry.shoulder[2], carry.shoulder[3])
    setJointQuat(out, elbow, carry.elbow[0], carry.elbow[1], carry.elbow[2], carry.elbow[3])
  }

  quatFromAxisAngle(scratch.quat, 0, 1, 0, 0, swing * (carry?.swingScale ?? 1))
  quatMultiply(scratch.quat, 0, out.rotations, shoulder * 4, out.rotations, shoulder * 4)
  quatMultiply(scratch.quat, 0, out.rotations, elbow * 4, out.rotations, elbow * 4)
  copyJointFrom(out, hand, elbow)
}
