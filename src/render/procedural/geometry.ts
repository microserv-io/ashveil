import fixture from './fixtures/kaykit_knight.json'
import { Joint, JOINT_NAMES, JOINT_PARENT } from './joints'
import type { Pose } from './pose'
import { quatRotate } from './quat'

/** Rest positions keyed by the names in `JOINT_NAMES`. */
export type JointTable = Readonly<Record<string, readonly number[]>>

/**
 * A skeleton's rest shape in the body frame, plus the lengths the gait and the IK
 * derive from it. Built once at bind time; never mutated on the frame path.
 *
 * Lengths are in the same unit as `RigInput.speed`, so a skeleton's model-space
 * rest pose is scaled into sim units before one is built. Get that wrong and the
 * feet slide by exactly the scale error.
 */
export interface RigGeometry {
  /** `Joint.Count * 3`, body frame, ground at y = 0. */
  readonly rest: Float32Array
  /** `Joint.Count * 3` unit vectors: the canonical identity direction per joint. */
  readonly direction: Float32Array
  readonly thigh: number
  readonly shin: number
  /** Thigh plus shin: the leg's reach with the knee locked. */
  readonly legLength: number
  /** The leg a person this tall would have: what `gait.ts` fits its scales against. */
  readonly nominalLegLength: number
  readonly upperArm: number
  readonly foreArm: number
  readonly armLength: number
  /** Rest height of the hip joint above the ground. */
  readonly hipHeight: number
  /** Rest height of the ankle, which is where a planted foot sits. */
  readonly ankleHeight: number
  /** Lateral distance from the centre line to a hip. */
  readonly hipWidth: number
  /** Rest height of the topmost required joint. */
  readonly height: number
  /** Measured height from the ground to the top of the body's mesh. */
  readonly standingHeight: number
}

/**
 * Leaf joints have no child to point at, so their canonical direction is stated:
 * the head continues up the spine, a hand along its forearm, and a foot points
 * forward so that identity is a foot flat on the ground.
 */
const LEAF_DIRECTION: Partial<Record<Joint, readonly [number, number, number]>> = {
  [Joint.Head]: [0, 1, 0],
  [Joint.FootL]: [0, 0, 1],
  [Joint.FootR]: [0, 0, 1],
}

/** The child each joint's canonical direction points at, where it has one. */
const PRIMARY_CHILD: Partial<Record<Joint, Joint>> = {
  [Joint.Root]: Joint.Pelvis, [Joint.Pelvis]: Joint.Spine, [Joint.Spine]: Joint.Chest,
  [Joint.Chest]: Joint.Head,
  [Joint.ShoulderL]: Joint.ElbowL, [Joint.ElbowL]: Joint.HandL,
  [Joint.ShoulderR]: Joint.ElbowR, [Joint.ElbowR]: Joint.HandR,
  [Joint.HipL]: Joint.KneeL, [Joint.KneeL]: Joint.FootL,
  [Joint.HipR]: Joint.KneeR, [Joint.KneeR]: Joint.FootR,
}

export function buildRigGeometry(table: JointTable, scale = 1, measuredStandingHeight?: number): RigGeometry {
  const rest = new Float32Array(Joint.Count * 3)
  for (let joint = 0; joint < Joint.Count; joint++) {
    const name = JOINT_NAMES[joint]!
    const position = table[name]
    if (!position || position.length !== 3) throw new Error(`rig geometry is missing joint "${name}"`)
    for (let axis = 0; axis < 3; axis++) rest[joint * 3 + axis] = position[axis]! * scale
  }

  const direction = new Float32Array(Joint.Count * 3)
  for (let joint = 0; joint < Joint.Count; joint++) {
    const child = PRIMARY_CHILD[joint as Joint]
    const leaf = LEAF_DIRECTION[joint as Joint]
    if (child === undefined) {
      const fallback = leaf ?? unitParentDirection(direction, joint)
      direction[joint * 3] = fallback[0]!
      direction[joint * 3 + 1] = fallback[1]!
      direction[joint * 3 + 2] = fallback[2]!
      continue
    }
    const dx = rest[child * 3]! - rest[joint * 3]!
    const dy = rest[child * 3 + 1]! - rest[joint * 3 + 1]!
    const dz = rest[child * 3 + 2]! - rest[joint * 3 + 2]!
    const length = Math.hypot(dx, dy, dz)
    if (length < 1e-9) throw new Error(`rig geometry has a zero-length bone at "${JOINT_NAMES[joint]}"`)
    direction[joint * 3] = dx / length
    direction[joint * 3 + 1] = dy / length
    direction[joint * 3 + 2] = dz / length
  }

  const thigh = boneLength(rest, Joint.HipL, Joint.KneeL)
  const shin = boneLength(rest, Joint.KneeL, Joint.FootL)
  const upperArm = boneLength(rest, Joint.ShoulderL, Joint.ElbowL)
  const foreArm = boneLength(rest, Joint.ElbowL, Joint.HandL)
  const standingHeight = measuredStandingHeight === undefined
    ? rest[Joint.Head * 3 + 1]!
    : measuredStandingHeight * scale
  // A person's leg is 48% of their height, but standing height is measured off the
  // mesh, so a helmet or a chibi's head counts towards it. Capping at the body's own
  // legs plus torso stops an oversized head claiming a leg longer than its frame.
  const torso = rest[Joint.Head * 3 + 1]! - rest[Joint.HipL * 3 + 1]!
  const legLength = thigh + shin
  const nominalLegLength = Math.min(0.48 * standingHeight, legLength + torso)
  return {
    rest,
    direction,
    thigh,
    shin,
    legLength,
    nominalLegLength,
    upperArm,
    foreArm,
    armLength: upperArm + foreArm,
    hipHeight: rest[Joint.HipL * 3 + 1]!,
    ankleHeight: rest[Joint.FootL * 3 + 1]!,
    hipWidth: Math.abs(rest[Joint.HipL * 3]!),
    height: rest[Joint.Head * 3 + 1]!,
    standingHeight,
  }
}

export function restPosition(geometry: RigGeometry, joint: Joint, out: Float32Array): void {
  out[0] = geometry.rest[joint * 3]!
  out[1] = geometry.rest[joint * 3 + 1]!
  out[2] = geometry.rest[joint * 3 + 2]!
}

export function restDirection(geometry: RigGeometry, joint: Joint, out: Float32Array): void {
  out[0] = geometry.direction[joint * 3]!
  out[1] = geometry.direction[joint * 3 + 1]!
  out[2] = geometry.direction[joint * 3 + 2]!
}

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

function boneLength(rest: Float32Array, from: Joint, to: Joint): number {
  return Math.hypot(
    rest[to * 3]! - rest[from * 3]!,
    rest[to * 3 + 1]! - rest[from * 3 + 1]!,
    rest[to * 3 + 2]! - rest[from * 3 + 2]!,
  )
}

function unitParentDirection(direction: Float32Array, joint: Joint): readonly number[] {
  const parent = JOINT_PARENT[joint]!
  return [direction[parent * 3]!, direction[parent * 3 + 1]!, direction[parent * 3 + 2]!]
}

const ROTATED = new Float32Array(3)

/** The KayKit knight's bind pose, in model units. See `scripts/extract-rig-geometry.mjs`. */
export const KAYKIT_KNIGHT_JOINTS: JointTable = fixture.joints
export const KAYKIT_KNIGHT_STANDING_HEIGHT = fixture.standingHeight
export const KAYKIT_KNIGHT_GEOMETRY: RigGeometry = buildRigGeometry(
  KAYKIT_KNIGHT_JOINTS,
  1,
  KAYKIT_KNIGHT_STANDING_HEIGHT,
)
