import fixture from '../procedural/fixtures/kaykit_knight.json'
import type { SkeletonProfile } from './profile'

/**
 * KayKit ships one 41-bone rig for every character in both packs, so this single
 * profile drives the knight and every monster. Only deform bones are mapped: the
 * kit's IK and roll controls (`IK-foot.l`, `control-heel-roll.r`, …) are authoring
 * aids that drive nothing at runtime, and writing to one would be a silent no-op.
 *
 * `kaykit.json` is the inventory this is checked against, and
 * `scripts/extract-rig-geometry.mjs` carries the same table for the offline
 * fixture; `tests/skeleton_profile.test.ts` holds the two together.
 */
export const KAYKIT_PROFILE: SkeletonProfile = {
  name: 'kaykit',
  standingHeight: fixture.standingHeight,
  armCarry: {
    right: {
      shoulder: quaternion(fixture.armCarry.right.shoulder),
      elbow: quaternion(fixture.armCarry.right.elbow),
      swingScale: fixture.armCarry.right.swingScale,
    },
  },
  bones: {
    root: 'root',
    pelvis: 'hips',
    spine: 'spine',
    chest: 'chest',
    head: 'head',
    'shoulder.l': 'upperarm.l',
    'elbow.l': 'lowerarm.l',
    'hand.l': 'hand.l',
    'shoulder.r': 'upperarm.r',
    'elbow.r': 'lowerarm.r',
    'hand.r': 'hand.r',
    'hip.l': 'upperleg.l',
    'knee.l': 'lowerleg.l',
    'foot.l': 'foot.l',
    'hip.r': 'upperleg.r',
    'knee.r': 'lowerleg.r',
    'foot.r': 'foot.r',
  },
  optional: {
    'toes.l': 'toes.l',
    'toes.r': 'toes.r',
    'wrist.l': 'wrist.l',
    'wrist.r': 'wrist.r',
  },
}

function quaternion(values: readonly number[]): readonly [number, number, number, number] {
  if (values.length !== 4) throw new Error('arm carry rotation must be a quaternion')
  return [values[0]!, values[1]!, values[2]!, values[3]!]
}
