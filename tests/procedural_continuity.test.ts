import { describe, expect, it } from 'vitest'
import { POSE_CLIPS, SKILL_CLIPS, type PoseClipName } from '../src/render/procedural/clips'
import { createGaitState } from '../src/render/procedural/gait'
import type { RigGeometry } from '../src/render/procedural/geometry'
import { Joint, JOINT_NAMES } from '../src/render/procedural/joints'
import { createPose } from '../src/render/procedural/pose'
import { writeClipPose } from '../src/render/procedural/poses'
import { quatAngleBetween } from '../src/render/procedural/quat'
import { skill } from '../src/sim/skills'
import { DT, type SkillId } from '../src/sim/types'
import { HUMAN, MASCULINE } from './fixtures/bodies'

/**
 * A skill is played at the speed the sim casts it, not at the speed it was
 * authored. A wind-up of 0.3 s and a recovery of 0.12 s are the same clip at two
 * different rates, so a strike authored in the last few percent of the wind-up
 * lands in one frame and reads as a teleport rather than a swing.
 *
 * This walks each skill frame by frame at its own timings and measures the worst
 * per-frame joint movement, across the wind-up to recovery boundary included.
 */

/**
 * What a joint may turn in one frame at 60 Hz and still read as motion rather
 * than a cut. The forearm and the hand get a looser bound than the rest: a pose
 * rotation is absolute in the body frame (`joints.ts`), so a forearm carries its
 * own bend *and* the whole swing of the upper arm above it, and a strike that
 * moves the shoulder at the limit necessarily moves the elbow at twice it.
 */
const FRAME_LIMIT = 0.25
const ARM_LIMIT = 0.7
const CARRIED: readonly Joint[] = [Joint.ElbowL, Joint.ElbowR, Joint.HandL, Joint.HandR]

const state = createGaitState()
const before = createPose()
const after = createPose()

/** The generator's own mapping: wind-up fills the first half, recovery the second. */
function castPhase(windup: number | null, recovery: number | null): number {
  return windup === null ? 0.5 + recovery! * 0.5 : windup * 0.5
}

interface Jump {
  readonly worst: number
  readonly joint: number
  readonly at: string
  readonly worstArm: number
  readonly armJoint: number
  readonly armAt: string
}

function play(geometry: RigGeometry, name: PoseClipName, windup: number, recovery: number): Jump {
  const clip = POSE_CLIPS[name]
  const phases: number[] = []
  for (let t = 0; t < windup; t += DT) phases.push(castPhase(Math.min(1, t / windup), null))
  for (let t = 0; t <= recovery; t += DT) phases.push(castPhase(null, Math.min(1, t / recovery)))
  let worst = 0
  let joint = 0
  let at = ''
  let worstArm = 0
  let armJoint = 0
  let armAt = ''
  writeClipPose(geometry, clip, phases[0]!, state, before)
  for (let step = 1; step < phases.length; step++) {
    writeClipPose(geometry, clip, phases[step]!, state, after)
    for (let index = 0; index < Joint.Count; index++) {
      const moved = quatAngleBetween(before.rotations, index * 4, after.rotations, index * 4)
      if (CARRIED.includes(index)) {
        if (moved > worstArm) {
          worstArm = moved
          armJoint = index
          armAt = phases[step]!.toFixed(3)
        }
      } else if (moved > worst) {
        worst = moved
        joint = index
        at = phases[step]!.toFixed(3)
      }
    }
    before.rotations.set(after.rotations)
  }
  return { worst, joint, at, worstArm, armJoint, armAt }
}

describe.each([['human', HUMAN], ['masculine-v1', MASCULINE]] as const)(
  '%s plays a skill at the speed the sim casts it',
  (_body, geometry) => {
    for (const name of SKILL_CLIPS) {
      it(`${name} never jumps a joint in one frame`, () => {
        const timings = skill(name as SkillId)
        const jump = play(geometry, name, timings.windup, timings.recovery)
        expect(
          jump.worst,
          `${name} moved ${JOINT_NAMES[jump.joint]} ${jump.worst.toFixed(3)} rad in one frame at phase ${jump.at}`,
        ).toBeLessThan(FRAME_LIMIT)
        expect(
          jump.worstArm,
          `${name} moved ${JOINT_NAMES[jump.armJoint]} ${jump.worstArm.toFixed(3)} rad in one frame at phase ${jump.armAt}`,
        ).toBeLessThan(ARM_LIMIT)
      })
    }
  },
)
