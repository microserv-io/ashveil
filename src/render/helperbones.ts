import * as THREE from 'three'
import { Joint } from './procedural/joints'
import { quatConjugate, quatIdentity, quatMultiply, quatNlerp, quatSet } from './procedural/quat'
import type { SkeletonProfile } from './profiles/profile'

/**
 * A helper bone is not a joint: nothing in a pose names it. A shoulder helper
 * turns by half of what its upper arm turns relative to the clavicle, and a
 * twist helper by half of the forearm's turn about the upper arm's own axis.
 * Both are read straight off the world rotations the pose just produced, so the
 * generator never knows they exist and a body without them poses the same.
 */
const HELPER_SHARE = 0.5

export interface HelperDrive {
  /** Bone index of each helper, or -1: shoulder L, shoulder R, twist L, twist R. */
  readonly slots: Int32Array
  /** Upper arm, clavicle and forearm bone indices per side: [upper, clavicle, forearm] x L, R. */
  readonly arms: Int32Array
  /** The upper arm's bind direction per side, in the arm's own rest frame. */
  readonly axes: Float32Array
  readonly driven: Uint8Array
}

const HELPER_KEYS = ['shoulder.l', 'shoulder.r', 'twist.l', 'twist.r'] as const

export function resolveHelpers(
  bones: readonly THREE.Bone[],
  profile: SkeletonProfile,
  jointBone: Int32Array,
  restLocalQuat: Float32Array,
  table: Record<string, number[]>,
): HelperDrive {
  const slots = new Int32Array(4).fill(-1)
  const driven = new Uint8Array(bones.length)
  const arms = new Int32Array(6)
  const axes = new Float32Array(6)
  const named = new Map<string, number>()
  bones.forEach((bone, at) => named.set(THREE.PropertyBinding.sanitizeNodeName(bone.name), at))

  HELPER_KEYS.forEach((key, slot) => {
    const wanted = profile.helpers?.[key]
    if (wanted === undefined) return
    const at = named.get(THREE.PropertyBinding.sanitizeNodeName(wanted))
    if (at === undefined) throw new Error(`profile "${profile.name}" names helper "${wanted}" for ${key}, which the skeleton lacks`)
    const rest = restLocalQuat.subarray(at * 4, at * 4 + 4)
    if (Math.abs(rest[3]!) < 1 - 1e-4) {
      throw new Error(`helper "${wanted}" does not rest axis-aligned; the fitter's axis rule was not applied`)
    }
    slots[slot] = at
    driven[at] = 1
  })

  for (let side = 0; side < 2; side++) {
    const suffix = side === 0 ? '.l' : '.r'
    const upper = side === 0 ? jointBone[Joint.ShoulderL]! : jointBone[Joint.ShoulderR]!
    const forearm = side === 0 ? jointBone[Joint.ElbowL]! : jointBone[Joint.ElbowR]!
    const clavicleName = profile.optional[`clavicle${suffix}`]
    const clavicle = clavicleName === undefined ? undefined : named.get(THREE.PropertyBinding.sanitizeNodeName(clavicleName))
    const above = bones[upper]!.parent
    arms[side * 3] = upper
    arms[side * 3 + 1] = clavicle ?? (above instanceof THREE.Bone ? bones.indexOf(above) : -1)
    arms[side * 3 + 2] = forearm
    const shoulder = table[`shoulder${suffix}`]
    const elbow = table[`elbow${suffix}`]
    if (shoulder && elbow) {
      const dx = elbow[0]! - shoulder[0]!
      const dy = elbow[1]! - shoulder[1]!
      const dz = elbow[2]! - shoulder[2]!
      const length = Math.hypot(dx, dy, dz) || 1
      axes[side * 3] = dx / length
      axes[side * 3 + 1] = dy / length
      axes[side * 3 + 2] = dz / length
    }
  }
  return { slots, arms, axes, driven }
}

export function driveHelpers(helpers: HelperDrive, bones: readonly THREE.Bone[], world: Float32Array): void {
  for (let side = 0; side < 2; side++) {
    const upper = helpers.arms[side * 3]!
    const clavicle = helpers.arms[side * 3 + 1]!
    const forearm = helpers.arms[side * 3 + 2]!

    const shoulder = helpers.slots[side]!
    if (shoulder >= 0 && clavicle >= 0) {
      // The upper arm's turn relative to the clavicle, halved; with identity rests
      // the helper's local rotation is exactly that half turn.
      quatConjugate(world, clavicle * 4, HELPER_SCRATCH, 0)
      quatMultiply(HELPER_SCRATCH, 0, world, upper * 4, HELPER_SCRATCH, 4)
      quatNlerp(IDENTITY, 0, HELPER_SCRATCH, 4, HELPER_SHARE, HELPER_SCRATCH, 8)
      bones[shoulder]!.quaternion.set(HELPER_SCRATCH[8]!, HELPER_SCRATCH[9]!, HELPER_SCRATCH[10]!, HELPER_SCRATCH[11]!)
      quatMultiply(world, clavicle * 4, HELPER_SCRATCH, 8, world, shoulder * 4)
    }

    const twist = helpers.slots[2 + side]!
    if (twist >= 0) {
      // The forearm's turn relative to the upper arm, keeping only the part about
      // the upper arm's own axis, halved.
      quatConjugate(world, upper * 4, HELPER_SCRATCH, 0)
      quatMultiply(HELPER_SCRATCH, 0, world, forearm * 4, HELPER_SCRATCH, 4)
      const ax = helpers.axes[side * 3]!
      const ay = helpers.axes[side * 3 + 1]!
      const az = helpers.axes[side * 3 + 2]!
      const along = HELPER_SCRATCH[4]! * ax + HELPER_SCRATCH[5]! * ay + HELPER_SCRATCH[6]! * az
      const w = HELPER_SCRATCH[7]!
      const length = Math.hypot(along, w)
      if (length < 1e-6) quatIdentity(HELPER_SCRATCH, 12)
      else quatSet(HELPER_SCRATCH, 12, (along * ax) / length, (along * ay) / length, (along * az) / length, w / length)
      quatNlerp(IDENTITY, 0, HELPER_SCRATCH, 12, HELPER_SHARE, HELPER_SCRATCH, 8)
      bones[twist]!.quaternion.set(HELPER_SCRATCH[8]!, HELPER_SCRATCH[9]!, HELPER_SCRATCH[10]!, HELPER_SCRATCH[11]!)
      quatMultiply(world, upper * 4, HELPER_SCRATCH, 8, world, twist * 4)
    }
  }
}

const IDENTITY = new Float32Array([0, 0, 0, 1])
const HELPER_SCRATCH = new Float32Array(16)
