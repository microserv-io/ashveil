import fixture from '../procedural/fixtures/humanoid_v1_masculine.json'
import type { SkeletonProfile } from './profile'

export const HUMANOID_V1_PROFILE: SkeletonProfile = {
  name: 'humanoid.v1',
  standingHeight: fixture.standingHeight,
  armCarry: {
    left: {
      shoulder: quaternion(fixture.armCarry.left.shoulder),
      elbow: quaternion(fixture.armCarry.left.elbow),
    },
    right: {
      shoulder: quaternion(fixture.armCarry.right.shoulder),
      elbow: quaternion(fixture.armCarry.right.elbow),
    },
  },
  bones: {
    root: 'root',
    pelvis: 'pelvis',
    spine: 'spine',
    chest: 'chest',
    head: 'head',
    'shoulder.l': 'upper_arm.L',
    'elbow.l': 'forearm.L',
    'hand.l': 'hand.L',
    'shoulder.r': 'upper_arm.R',
    'elbow.r': 'forearm.R',
    'hand.r': 'hand.R',
    'hip.l': 'thigh.L',
    'knee.l': 'shin.L',
    'foot.l': 'foot.L',
    'hip.r': 'thigh.R',
    'knee.r': 'shin.R',
    'foot.r': 'foot.R',
  },
  optional: {
    neck: 'neck',
    'clavicle.l': 'clavicle.L',
    'clavicle.r': 'clavicle.R',
  },
}

function quaternion(values: readonly number[]): readonly [number, number, number, number] {
  if (values.length !== 4) throw new Error('arm carry rotation must be a quaternion')
  return [values[0]!, values[1]!, values[2]!, values[3]!]
}
