import type { SkillId } from '../../sim/types'
import { Joint } from './joints'
import { compilePoseClip, type PoseClip, type PoseClipSource } from './posekeys'

/**
 * The pose tables. Data, not logic: a new skill is a new row here, and nothing in
 * `posekeys.ts` changes. See that file for what a key may state and what it inherits.
 *
 * Every skill is three keys and a return: neutral, the drawn-back anticipation at
 * the end of windup, the strike on the turn, and the way back to the carry. The
 * generator maps `phase.windup` onto the first half and `phase.recovery` onto the
 * second, so the anticipation lasts exactly as long as the sim's wind-up tell and
 * the strike lands on the frame the damage does.
 *
 * Hands are targets rather than angles, so they follow a path a viewer can read
 * and `tests/procedural_selfintersection.test.ts` can measure against the torso.
 * Rotations are absolute (`joints.ts`), so an unstated head stays level and
 * facing the target however far the chest twists under it.
 *
 * Dash is a held pose rather than a keyframed one, so it lives in `stances.ts`.
 * Every other skill needs a row, and the type says so: add a `SkillId` and this
 * table stops compiling until it has a pose.
 */
export type PoseClipName = Exclude<SkillId, 'dash'> | 'dead'

export const POSE_SOURCES: Readonly<Record<PoseClipName, PoseClipSource>> = {
  /** A horizontal sweep: coiled over the left shoulder, thrown out to the right. */
  cleave: {
    planted: true,
    keys: [
      { at: 0, footL: [0, -0.94, 0] },
      {
        // The hand goes out and up before it goes across, so its path stays
        // outside the chest instead of taking the short line through it.
        at: 0.2,
        torso: [{ joint: Joint.Chest, yaw: 0.2 }, { joint: Joint.Spine, yaw: 0.1 }],
        handR: [-0.5, -0.4, -0.05],
        poleR: [-0.6, 0.6, -0.5],
        handL: [0.22, -0.78, 0.16],
        footL: [0, -0.94, 0],
      },
      {
        at: 0.42,
        torso: [
          { joint: Joint.Chest, yaw: 0.44, pitch: -0.1 },
          { joint: Joint.Spine, yaw: 0.22, pitch: -0.06 },
          { joint: Joint.Pelvis, yaw: 0.1 },
        ],
        handR: [0.34, 0.16, -0.24],
        handL: [0.28, -0.62, 0.22],
        // Elbow up and out rather than tucked behind the ribs: it is the elbow
        // that makes a coiled arm read as coiled from above.
        poleR: [-0.5, 1, -0.3],
        footL: [0, -0.94, 0],
      },
      {
        at: 0.5,
        ease: 0.35,
        torso: [
          { joint: Joint.Chest, yaw: -0.48, pitch: 0.14 },
          { joint: Joint.Spine, yaw: -0.24, pitch: 0.08 },
          { joint: Joint.Pelvis, yaw: -0.12 },
        ],
        handR: [-0.5, -0.12, 0.62],
        handL: [0.34, -0.5, 0.3],
        // The left foot steps into the swing and comes back with it.
        footL: [0.02, -0.9, 0.2],
        offset: [0, -0.04, 0.02],
      },
      { at: 1, ease: 1.6, footL: [0, -0.94, 0] },
    ],
  },
  /** A thrust: the hand is cocked at the hip, then driven out at chest height. */
  firebolt: {
    planted: true,
    keys: [
      { at: 0 },
      {
        at: 0.42,
        torso: [
          { joint: Joint.Chest, pitch: -0.12, yaw: -0.16 },
          { joint: Joint.Spine, pitch: -0.06, yaw: -0.08 },
        ],
        handR: [-0.3, -0.72, -0.34],
        handL: [0.24, -0.66, 0.1],
        offset: [0, -0.02, -0.06],
      },
      {
        at: 0.5,
        ease: 0.35,
        torso: [
          { joint: Joint.Chest, pitch: 0.2, yaw: 0.12 },
          { joint: Joint.Spine, pitch: 0.1, yaw: 0.06 },
        ],
        handR: [-0.16, 0.1, 0.8],
        handL: [0.3, -0.3, 0.42],
        offset: [0, -0.02, 0.05],
      },
      { at: 1, ease: 1.6 },
    ],
  },
  /** Both hands overhead, then slammed down and out as the body drops onto it. */
  frost_nova: {
    planted: true,
    keys: [
      { at: 0 },
      {
        at: 0.42,
        torso: [
          { joint: Joint.Chest, pitch: -0.16 },
          { joint: Joint.Spine, pitch: -0.08 },
          { joint: Joint.Head, pitch: -0.2 },
        ],
        handL: [0.3, 0.62, 0.05],
        handR: [-0.3, 0.62, 0.05],
        offset: [0, -0.05, 0],
      },
      {
        at: 0.5,
        ease: 0.3,
        torso: [
          { joint: Joint.Chest, pitch: 0.34 },
          { joint: Joint.Spine, pitch: 0.18 },
          { joint: Joint.Head, pitch: 0.3 },
        ],
        handL: [0.52, -0.86, 0.3],
        handR: [-0.52, -0.86, 0.3],
        offset: [0, -0.14, 0.02],
      },
      { at: 1, ease: 1.6 },
    ],
  },
  /** A lunge: the head and shoulders go first and the hands claw after them. */
  monster_bite: {
    planted: true,
    keys: [
      { at: 0 },
      {
        at: 0.34,
        torso: [
          { joint: Joint.Chest, pitch: -0.26 },
          { joint: Joint.Spine, pitch: -0.12 },
          { joint: Joint.Head, pitch: -0.3 },
        ],
        handL: [0.32, -0.6, -0.3],
        handR: [-0.32, -0.6, -0.3],
        offset: [0, -0.04, -0.05],
      },
      {
        at: 0.5,
        ease: 0.3,
        torso: [
          { joint: Joint.Chest, pitch: 0.5 },
          { joint: Joint.Spine, pitch: 0.26 },
          { joint: Joint.Head, pitch: 0.42 },
        ],
        handL: [0.36, -0.32, 0.62],
        handR: [-0.36, -0.32, 0.62],
        offset: [0, -0.06, 0.12],
      },
      { at: 1, ease: 1.6 },
    ],
  },
  /** Firebolt with both hands: cocked at the hips, thrust out together. */
  monster_bolt: {
    planted: true,
    keys: [
      { at: 0 },
      {
        at: 0.42,
        torso: [{ joint: Joint.Chest, pitch: -0.14 }, { joint: Joint.Spine, pitch: -0.07 }],
        handL: [0.3, -0.72, -0.3],
        handR: [-0.3, -0.72, -0.3],
        offset: [0, -0.02, -0.06],
      },
      {
        at: 0.5,
        ease: 0.35,
        torso: [{ joint: Joint.Chest, pitch: 0.22 }, { joint: Joint.Spine, pitch: 0.11 }],
        handL: [0.2, 0.08, 0.78],
        handR: [-0.2, 0.08, 0.78],
        offset: [0, -0.02, 0.05],
      },
      { at: 1, ease: 1.6 },
    ],
  },
  /** Frost nova's slam with a longer wind-up: the arms hang overhead a beat first. */
  monster_slam: {
    planted: true,
    keys: [
      { at: 0 },
      {
        at: 0.28,
        torso: [{ joint: Joint.Chest, pitch: -0.2 }, { joint: Joint.Head, pitch: -0.24 }],
        handL: [0.26, 0.6, 0.02],
        handR: [-0.26, 0.6, 0.02],
        offset: [0, -0.04, 0],
      },
      {
        at: 0.46,
        torso: [
          { joint: Joint.Chest, pitch: -0.24 },
          { joint: Joint.Spine, pitch: -0.1 },
          { joint: Joint.Head, pitch: -0.26 },
        ],
        handL: [0.22, 0.68, -0.06],
        handR: [-0.22, 0.68, -0.06],
        offset: [0, -0.06, -0.02],
      },
      {
        at: 0.5,
        ease: 0.25,
        torso: [
          { joint: Joint.Chest, pitch: 0.44 },
          { joint: Joint.Spine, pitch: 0.24 },
          { joint: Joint.Head, pitch: 0.36 },
        ],
        handL: [0.5, -0.88, 0.34],
        handR: [-0.5, -0.88, 0.34],
        offset: [0, -0.18, 0.04],
      },
      { at: 1, ease: 1.6 },
    ],
  },
  /** Buckles at the knees, then rolls onto its right side and stays there. */
  dead: {
    planted: false,
    keys: [
      { at: 0 },
      {
        at: 0.4,
        ease: 0.7,
        torso: [
          { joint: Joint.Pelvis, roll: 0.42 },
          { joint: Joint.Spine, roll: 0.44, pitch: 0.24 },
          { joint: Joint.Chest, roll: 0.46, pitch: 0.3 },
          { joint: Joint.Head, roll: 0.3, pitch: 0.34 },
        ],
        offset: [0, -0.3, 0.04],
        footL: [-0.16, -0.6, 0.34],
        footR: [-0.16, -0.6, 0.34],
        handL: [0.3, -0.6, 0.34],
        handR: [-0.3, -0.6, 0.34],
      },
      {
        at: 1,
        ease: 1.4,
        torso: [
          { joint: Joint.Pelvis, roll: 1.3 },
          { joint: Joint.Spine, roll: 1.3, pitch: 0.2 },
          { joint: Joint.Chest, roll: 1.3, pitch: 0.24 },
          { joint: Joint.Head, roll: 1.1, pitch: 0.3 },
        ],
        offset: [0, -0.62, 0.1],
        footL: [-0.46, 0.02, 0.44],
        footR: [-0.46, 0.02, 0.44],
        handL: [0.2, -0.2, 0.62],
        handR: [-0.5, -0.12, 0.4],
      },
    ],
  },
}

export const POSE_CLIPS = Object.fromEntries(
  Object.entries(POSE_SOURCES).map(([name, source]) => [name, compilePoseClip(source)]),
) as Readonly<Record<PoseClipName, PoseClip>>

export const SKILL_CLIPS: readonly PoseClipName[] = (Object.keys(POSE_SOURCES) as PoseClipName[]).filter(
  (name) => name !== 'dead',
)

/**
 * How long a body takes to reach the ground. The death fade starts at 55 percent
 * of 1.6 s, so anything longer would fade out a body still on its feet.
 */
export const DEATH_SETTLE = 0.7
