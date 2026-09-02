import type { RigGeometry } from './geometry'
import { Joint, JOINT_PARENT } from './joints'
import { quatFromAxisAngle, quatIdentity, quatMultiply, quatNlerp, quatRotate, quatSet } from './quat'

/**
 * A full-body pose: one body-frame quaternion per semantic joint (see the frame
 * contract in `joints.ts`), plus the visual root offset and yaw.
 *
 * Every field is a preallocated typed array and every helper writes into one, so
 * a pose can be produced and blended on the frame path without allocating.
 */
export interface Pose {
  /** `Joint.Count * 4`, xyzw, absolute in the body frame. */
  readonly rotations: Float32Array
  /** Visual root offset in body-frame units. A gait loop accumulates zero of it. */
  readonly offset: Float32Array
  /** Extra yaw about +Y, on top of the actor's own facing. */
  readonly yaw: Float32Array
}

export function createPose(): Pose {
  const pose: Pose = {
    rotations: new Float32Array(Joint.Count * 4),
    offset: new Float32Array(3),
    yaw: new Float32Array(1),
  }
  resetPose(pose)
  return pose
}

export function resetPose(pose: Pose): void {
  for (let joint = 0; joint < Joint.Count; joint++) quatIdentity(pose.rotations, joint * 4)
  pose.offset[0] = 0
  pose.offset[1] = 0
  pose.offset[2] = 0
  pose.yaw[0] = 0
}

export function setJointQuat(pose: Pose, joint: Joint, x: number, y: number, z: number, w: number): void {
  quatSet(pose.rotations, joint * 4, x, y, z, w)
}

export function setJointAxisAngle(pose: Pose, joint: Joint, ax: number, ay: number, az: number, angle: number): void {
  quatFromAxisAngle(pose.rotations, joint * 4, ax, ay, az, angle)
}

/** Applies `q` on top of what the joint already holds: the additive-layer primitive. */
export function multiplyJoint(pose: Pose, joint: Joint, x: number, y: number, z: number, w: number): void {
  const scratch = ADDITIVE
  quatSet(scratch, 0, x, y, z, w)
  quatMultiply(scratch, 0, pose.rotations, joint * 4, pose.rotations, joint * 4)
}

export function copyJointFrom(pose: Pose, joint: Joint, source: Joint): void {
  const rotations = pose.rotations
  const from = source * 4
  const to = joint * 4
  rotations[to] = rotations[from]!
  rotations[to + 1] = rotations[from + 1]!
  rotations[to + 2] = rotations[from + 2]!
  rotations[to + 3] = rotations[from + 3]!
}

/** Reads a joint's rotation into the first four elements of `out`. */
export function jointQuat(pose: Pose, joint: Joint, out: Float32Array): void {
  const base = joint * 4
  out[0] = pose.rotations[base]!
  out[1] = pose.rotations[base + 1]!
  out[2] = pose.rotations[base + 2]!
  out[3] = pose.rotations[base + 3]!
}

export function copyPose(from: Pose, out: Pose): void {
  out.rotations.set(from.rotations)
  out.offset.set(from.offset)
  out.yaw[0] = from.yaw[0]!
}

export function blendPose(from: Pose, to: Pose, t: number, out: Pose): void {
  for (let joint = 0; joint < Joint.Count; joint++) {
    quatNlerp(from.rotations, joint * 4, to.rotations, joint * 4, t, out.rotations, joint * 4)
  }
  for (let axis = 0; axis < 3; axis++) {
    out.offset[axis] = from.offset[axis]! + (to.offset[axis]! - from.offset[axis]!) * t
  }
  out.yaw[0] = from.yaw[0]! + (to.yaw[0]! - from.yaw[0]!) * t
}

/** Module-level because `multiplyJoint` is on the frame path and must not allocate. */
const ADDITIVE = new Float32Array(4)

/**
 * Body-frame position of every joint under a pose, into `out` (`Joint.Count * 3`).
 * Rotations are absolute, so one forward pass suffices: a joint sits at its parent's
 * posed position plus the parent's rotation applied to their rest offset. `pose.yaw`
 * is deliberately not applied — the host owns the body's world facing.
 */
export function resolvePositions(geometry: RigGeometry, pose: Pose, out: Float32Array): void {
  const rest = geometry.rest
  out[0] = rest[0]! + pose.offset[0]!
  out[1] = rest[1]! + pose.offset[1]!
  out[2] = rest[2]! + pose.offset[2]!
  for (let joint = 1; joint < Joint.Count; joint++) {
    const parent = JOINT_PARENT[joint]!
    quatRotate(
      pose.rotations,
      parent * 4,
      rest[joint * 3]! - rest[parent * 3]!,
      rest[joint * 3 + 1]! - rest[parent * 3 + 1]!,
      rest[joint * 3 + 2]! - rest[parent * 3 + 2]!,
      ROTATED,
    )
    out[joint * 3] = out[parent * 3]! + ROTATED[0]!
    out[joint * 3 + 1] = out[parent * 3 + 1]! + ROTATED[1]!
    out[joint * 3 + 2] = out[parent * 3 + 2]! + ROTATED[2]!
  }
}

const ROTATED = new Float32Array(3)
