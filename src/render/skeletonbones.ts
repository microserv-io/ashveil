import * as THREE from 'three'
import { Joint, JOINT_NAMES, OPTIONAL_JOINT_NAMES, OptionalJoint } from './procedural/joints'
import type { SkeletonProfile } from './profiles/profile'

/** Which bone is which joint, both ways round, plus the optional ones a family has. */
export interface BoneIndex {
  readonly jointBone: Int32Array
  readonly boneJoint: Int32Array
  readonly boneExtra: Int32Array
}

/**
 * Resolves a profile's bone names against a real skeleton.
 *
 * `GLTFLoader` strips the characters `PropertyBinding` reserves, so the rig on the
 * page calls the left shoulder `upperarml` while the glTF and the profile call it
 * `upperarm.l`. Both sides are sanitised so a profile can be written against the
 * names the artist chose.
 */
export function resolveBones(bones: readonly THREE.Bone[], profile: SkeletonProfile): BoneIndex {
  const named = new Map<string, number>()
  bones.forEach((bone, at) => named.set(THREE.PropertyBinding.sanitizeNodeName(bone.name), at))

  const jointBone = new Int32Array(Joint.Count)
  const boneJoint = new Int32Array(bones.length).fill(-1)
  for (let joint = 0; joint < Joint.Count; joint++) {
    const name = JOINT_NAMES[joint]!
    const wanted = profile.bones[name]
    const found = wanted === undefined ? -1 : named.get(THREE.PropertyBinding.sanitizeNodeName(wanted)) ?? -1
    if (found === -1) {
      throw new Error(`profile "${profile.name}" cannot bind joint "${name}": no bone named "${wanted ?? '(unmapped)'}"`)
    }
    jointBone[joint] = found
    boneJoint[found] = joint
  }

  // Optional joints are never required: a family that has none poses correctly
  // without them, and a pose that says nothing about one leaves it to its parent.
  const boneExtra = new Int32Array(bones.length).fill(-1)
  for (let extra = 0; extra < OptionalJoint.Count; extra++) {
    const wanted = profile.optional[OPTIONAL_JOINT_NAMES[extra]!]
    if (wanted === undefined) continue
    const found = named.get(THREE.PropertyBinding.sanitizeNodeName(wanted))
    if (found !== undefined && boneJoint[found]! < 0) boneExtra[found] = extra
  }

  return { jointBone, boneJoint, boneExtra }
}
