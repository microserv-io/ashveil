import { clamp } from './curves'
import { restDirection, type RigGeometry } from './geometry'
import { Joint, LEFT, OptionalJoint, RIGHT } from './joints'
import { multiplyJoint, setExtraQuat, type Pose } from './pose'
import { quatFromAxisAngle, quatMultiply, quatRotate } from './quat'

/**
 * The shoulder girdle: the half of an arm's movement that is not the arm.
 *
 * A rig's upper arm hangs off a clavicle, and nothing was driving it — so the arm
 * swung under a shoulder that never moved, which reads as a doll's arm rotating
 * in its socket rather than a body reaching. The clavicle rides forward with the
 * arm, lifts when the arm goes above horizontal, and the chest leans a little
 * into whichever arm is doing the reaching.
 *
 * Written as a layer over whatever state produced the pose, so it applies to a
 * walk, a stance and a skill alike. A family without clavicles resolves none of
 * this and the binding drops it silently.
 */

/** How far the shoulder travels fore and aft with the arm it carries. */
const PROTRACT = 7 * Math.PI / 180
/** How far it lifts when the arm goes overhead, and how quickly it gets there. */
const ELEVATE = 24 * Math.PI / 180
const ELEVATE_REACH = 1.8
/** How far the chest turns into a reaching arm. */
const CHEST_LEAN = 6 * Math.PI / 180

export function writeShoulderGirdle(geometry: RigGeometry, pose: Pose): void {
  const forward = armDirection(geometry, pose, RIGHT, RIGHT_ARM) - armDirection(geometry, pose, LEFT, LEFT_ARM)
  quatFromAxisAngle(TURN, 0, 0, 1, 0, CHEST_LEAN * clamp(forward * 0.5, -1, 1))
  multiplyJoint(pose, Joint.Chest, TURN[0]!, TURN[1]!, TURN[2]!, TURN[3]!)

  writeClavicle(pose, LEFT, OptionalJoint.ClavicleL, LEFT_ARM)
  writeClavicle(pose, RIGHT, OptionalJoint.ClavicleR, RIGHT_ARM)
}

/** Where this arm points now, kept for the girdle to answer. Returns its forward lean. */
function armDirection(geometry: RigGeometry, pose: Pose, side: number, out: Float32Array): number {
  const shoulder = side === LEFT ? Joint.ShoulderL : Joint.ShoulderR
  restDirection(geometry, shoulder, REST)
  quatRotate(pose.rotations, shoulder * 4, REST[0]!, REST[1]!, REST[2]!, out)
  return out[2]!
}

function writeClavicle(pose: Pose, side: number, joint: OptionalJoint, arm: Float32Array): void {
  // Forward with the arm, and lifting only once the arm is above horizontal.
  quatFromAxisAngle(TURN, 0, 0, 1, 0, -side * PROTRACT * clamp(arm[2]!, -1, 1))
  quatFromAxisAngle(SPARE, 0, 0, 0, 1, side * ELEVATE * clamp(arm[1]! * ELEVATE_REACH, 0, 1))
  quatMultiply(TURN, 0, SPARE, 0, TURN, 0)
  // Under the chest it hangs from, so a turning torso carries the shoulders with it.
  quatMultiply(pose.rotations, Joint.Chest * 4, TURN, 0, SPARE, 0)
  setExtraQuat(pose, joint, SPARE, 0)
}

/** Module-level because the girdle is written once per body per frame. */
const REST = new Float32Array(3)
const LEFT_ARM = new Float32Array(3)
const RIGHT_ARM = new Float32Array(3)
const TURN = new Float32Array(4)
const SPARE = new Float32Array(4)
