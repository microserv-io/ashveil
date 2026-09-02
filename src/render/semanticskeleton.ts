import * as THREE from 'three'
import { buildRigGeometry, type JointTable, type RigGeometry } from './procedural/geometry'
import { Joint, JOINT_NAMES } from './procedural/joints'
import { resolveBones } from './skeletonbones'
import type { Pose } from './procedural/pose'
import { quatConjugate, quatMultiply, quatRotate } from './procedural/quat'
import { driveHelpers, resolveHelpers } from './helperbones'
import type { SkeletonProfile } from './profiles/profile'

/**
 * The bridge between a body-frame `Pose` and a real Three.js skeleton.
 *
 * Everything expensive happens once, at bind: resolving names to bones, measuring
 * the rest shape into sim metres, and deriving the per-joint axis correction. What
 * is left on the frame path is a couple of quaternion products per bone.
 */
export interface SemanticSkeleton {
  /** The rest shape the pose generator solves against, in sim metres. */
  readonly geometry: RigGeometry
  /** Writes a body-frame pose onto the bones. Allocates nothing. */
  apply(pose: Pose): void
  /** Puts every driven bone back where the model was authored. */
  restore(): void
}

export function bindSkeleton(body: THREE.Object3D, profile: SkeletonProfile): SemanticSkeleton {
  body.updateWorldMatrix(true, true)

  // `traverse` is depth-first, so a bone's parent always lands at a lower index and
  // one forward pass resolves the whole hierarchy.
  const bones: THREE.Bone[] = []
  body.traverse((child) => {
    if (child instanceof THREE.Bone) bones.push(child)
  })

  const { jointBone, boneJoint, boneExtra } = resolveBones(bones, profile)

  const parent = new Int32Array(bones.length)
  const restLocalQuat = new Float32Array(bones.length * 4)
  const restLocalPos = new Float32Array(bones.length * 3)
  /**
   * The bone's rest orientation in the body frame. A pose rotation is absolute
   * about the body's axes (`procedural/joints.ts`), so it acts on a bone already
   * turned into its rest orientation: `boneWorld = q * correction`. The bone's own
   * local axes never appear anywhere else, which is why nothing under
   * `procedural/` has to know what they are.
   */
  const correction = new Float32Array(bones.length * 4)
  /** The rest orientation of whatever holds a bone that no other bone holds. */
  const anchor = new Float32Array(bones.length * 4)

  const bodyQuat = new THREE.Quaternion()
  const bodyScale = new THREE.Vector3()
  body.getWorldQuaternion(bodyQuat).invert()
  const scale = body.getWorldScale(bodyScale).x
  const toBody = new THREE.Matrix4().copy(body.matrixWorld).invert()

  const rotation = new THREE.Quaternion()
  const position = new THREE.Vector3()
  const slot = new Map<THREE.Object3D, number>(bones.map((bone, at) => [bone as THREE.Object3D, at]))
  const table: Record<string, number[]> = {}

  bones.forEach((bone, at) => {
    const above = bone.parent
    parent[at] = above && slot.has(above) ? slot.get(above)! : -1

    writeQuat(restLocalQuat, at * 4, bone.quaternion)
    restLocalPos[at * 3] = bone.position.x
    restLocalPos[at * 3 + 1] = bone.position.y
    restLocalPos[at * 3 + 2] = bone.position.z

    writeQuat(correction, at * 4, bone.getWorldQuaternion(rotation).premultiply(bodyQuat))
    quatConjugate(restLocalQuat, at * 4, SCRATCH, 0)
    quatMultiply(correction, at * 4, SCRATCH, 0, anchor, at * 4)

    const joint = boneJoint[at]!
    if (joint < 0) return
    bone.getWorldPosition(position).applyMatrix4(toBody)
    table[JOINT_NAMES[joint]!] = [position.x, position.y, position.z]
  })

  const geometry = buildRigGeometry(table as JointTable, scale, profile.standingHeight, profile.footprint)
  const world = new Float32Array(bones.length * 4)
  const rootBone = jointBone[Joint.Root]!
  const helpers = resolveHelpers(bones, profile, jointBone, restLocalQuat, table)

  function apply(pose: Pose): void {
    for (let at = 0; at < bones.length; at++) {
      const extra = boneExtra[at]!
      const driven = extra >= 0 && pose.written[extra] === 1
      const joint = boneJoint[at]!
      const above = parent[at]!
      const frame = above >= 0 ? world : anchor
      const frameAt = above >= 0 ? above * 4 : at * 4

      if (joint >= 0) quatMultiply(pose.rotations, joint * 4, correction, at * 4, world, at * 4)
      else if (driven) quatMultiply(pose.extras, extra * 4, correction, at * 4, world, at * 4)
      else quatMultiply(frame, frameAt, restLocalQuat, at * 4, world, at * 4)
      if (joint < 0 && !driven) continue

      quatConjugate(frame, frameAt, SCRATCH, 0)
      quatMultiply(SCRATCH, 0, world, at * 4, SCRATCH, 4)
      bones[at]!.quaternion.set(SCRATCH[4]!, SCRATCH[5]!, SCRATCH[6]!, SCRATCH[7]!)
    }
    driveHelpers(helpers, bones, world)

    // The offset is a body-frame displacement in sim metres; a bone's position is in
    // model units, in whatever frame holds it.
    const above = parent[rootBone]!
    quatConjugate(above >= 0 ? world : anchor, above >= 0 ? above * 4 : rootBone * 4, SCRATCH, 0)
    quatRotate(SCRATCH, 0, pose.offset[0]! / scale, pose.offset[1]! / scale, pose.offset[2]! / scale, VECTOR)
    bones[rootBone]!.position.set(
      restLocalPos[rootBone * 3]! + VECTOR[0]!,
      restLocalPos[rootBone * 3 + 1]! + VECTOR[1]!,
      restLocalPos[rootBone * 3 + 2]! + VECTOR[2]!,
    )
    if (body.rotation.y !== pose.yaw[0]!) body.rotation.y = pose.yaw[0]!
  }

  function restore(): void {
    for (let at = 0; at < bones.length; at++) {
      if (boneJoint[at]! < 0 && boneExtra[at]! < 0 && !helpers.driven[at]) continue
      const bone = bones[at]!
      bone.quaternion.set(
        restLocalQuat[at * 4]!,
        restLocalQuat[at * 4 + 1]!,
        restLocalQuat[at * 4 + 2]!,
        restLocalQuat[at * 4 + 3]!,
      )
    }
    bones[rootBone]!.position.set(
      restLocalPos[rootBone * 3]!,
      restLocalPos[rootBone * 3 + 1]!,
      restLocalPos[rootBone * 3 + 2]!,
    )
    if (body.rotation.y !== 0) body.rotation.y = 0
  }

  return { geometry, apply, restore }
}

function writeQuat(out: Float32Array, at: number, quaternion: THREE.Quaternion): void {
  out[at] = quaternion.x
  out[at + 1] = quaternion.y
  out[at + 2] = quaternion.z
  out[at + 3] = quaternion.w
}

/** Module-level because `apply` runs once per body per frame and must not allocate. */
const SCRATCH = new Float32Array(8)
const VECTOR = new Float32Array(3)
