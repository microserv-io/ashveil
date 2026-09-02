import fixture from '../procedural/fixtures/humanoid_v1_masculine.json'
import type { SkeletonProfile } from './profile'

/**
 * The Tripo humanoid rig. It carries no weapon and states no `armCarry`: an
 * A-pose rest is not a carry, so the empty-hand one is computed from the rest
 * directions in `procedural/arms.ts`.
 */
export const HUMANOID_V1_PROFILE: SkeletonProfile = {
  name: 'humanoid.v1',
  standingHeight: fixture.standingHeight,
  footprint: fixture.footprint,
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
