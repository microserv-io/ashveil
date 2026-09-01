import type { SkillId } from '../../sim/types'
import { Joint } from './joints'
import { compilePoseClip, type PoseClip, type PoseClipSource } from './poses'

/**
 * The pose tables. Data, not logic: a new skill is a new row here, and nothing in
 * `poses.ts` changes. See that file for what a key may state and what it inherits.
 *
 * Dash is a held pose rather than a keyframed one, so it lives in `gait.ts`. Every
 * other skill needs a row, and the type says so: add a `SkillId` and this table
 * stops compiling until it has a pose.
 */
export type PoseClipName = Exclude<SkillId, 'dash'> | 'dead'

export const POSE_SOURCES: Readonly<Record<PoseClipName, PoseClipSource>> = {
  cleave: {
    planted: true,
    keys: [
      { at: 0 },
      {
        at: 0.35,
        torso: [{ joint: Joint.Chest, yaw: 0.42 }, { joint: Joint.Spine, yaw: 0.2 }, { joint: Joint.Head, yaw: -0.2 }],
        handR: [-0.42, -0.28, -0.5],
        handL: [0.3, -0.5, -0.2],
      },
      {
        at: 0.5,
        ease: 0.4,
        torso: [
          { joint: Joint.Chest, yaw: -0.5, pitch: 0.18 },
          { joint: Joint.Spine, yaw: -0.24, pitch: 0.12 },
          { joint: Joint.Head, yaw: 0.24 },
        ],
        handR: [0.62, -0.18, 0.55],
        handL: [0.4, -0.5, 0.15],
      },
      { at: 1, ease: 1.6 },
    ],
  },
  firebolt: {
    planted: true,
    keys: [
      { at: 0 },
      {
        at: 0.35,
        torso: [{ joint: Joint.Chest, pitch: -0.14 }, { joint: Joint.Spine, pitch: -0.08 }],
        handR: [-0.24, -0.14, -0.32],
      },
      {
        at: 0.5,
        ease: 0.4,
        torso: [{ joint: Joint.Chest, pitch: 0.26 }, { joint: Joint.Spine, pitch: 0.12 }],
        handR: [0.04, 0.16, 0.84],
        handL: [0.34, -0.42, 0.24],
      },
      { at: 1, ease: 1.6 },
    ],
  },
  frost_nova: {
    planted: true,
    keys: [
      { at: 0 },
      {
        at: 0.35,
        torso: [{ joint: Joint.Chest, pitch: -0.18 }, { joint: Joint.Head, pitch: -0.2 }],
        handL: [0.28, 0.32, -0.12],
        handR: [-0.28, 0.32, -0.12],
      },
      {
        at: 0.5,
        ease: 0.35,
        torso: [{ joint: Joint.Chest, pitch: 0.42 }, { joint: Joint.Spine, pitch: 0.24 }, { joint: Joint.Head, pitch: 0.26 }],
        handL: [0.76, -0.5, 0.4],
        handR: [-0.76, -0.5, 0.4],
        offset: [0, -0.1, 0],
      },
      { at: 1, ease: 1.6 },
    ],
  },
  monster_bite: {
    planted: true,
    keys: [
      { at: 0 },
      {
        at: 0.32,
        torso: [{ joint: Joint.Chest, pitch: -0.22 }, { joint: Joint.Head, pitch: -0.28 }],
        handL: [0.34, -0.44, -0.24],
        handR: [-0.34, -0.44, -0.24],
      },
      {
        at: 0.5,
        ease: 0.3,
        torso: [
          { joint: Joint.Chest, pitch: 0.55 },
          { joint: Joint.Spine, pitch: 0.28 },
          { joint: Joint.Head, pitch: 0.4 },
        ],
        handL: [0.44, -0.36, 0.6],
        handR: [-0.44, -0.36, 0.6],
        offset: [0, -0.06, 0.1],
      },
      { at: 1, ease: 1.6 },
    ],
  },
  monster_bolt: {
    planted: true,
    keys: [
      { at: 0 },
      {
        at: 0.35,
        torso: [{ joint: Joint.Chest, pitch: -0.16 }],
        handL: [0.16, 0.12, -0.14],
        handR: [-0.16, 0.12, -0.14],
      },
      {
        at: 0.5,
        ease: 0.4,
        torso: [{ joint: Joint.Chest, pitch: 0.3 }, { joint: Joint.Spine, pitch: 0.14 }],
        handL: [0.3, 0.1, 0.84],
        handR: [-0.3, 0.1, 0.84],
      },
      { at: 1, ease: 1.6 },
    ],
  },
  monster_slam: {
    planted: true,
    keys: [
      { at: 0 },
      {
        at: 0.34,
        torso: [{ joint: Joint.Chest, pitch: -0.24 }, { joint: Joint.Head, pitch: -0.22 }],
        handL: [0.22, 0.52, -0.08],
        handR: [-0.22, 0.52, -0.08],
      },
      {
        at: 0.5,
        ease: 0.3,
        torso: [
          { joint: Joint.Chest, pitch: 0.62 },
          { joint: Joint.Spine, pitch: 0.34 },
          { joint: Joint.Head, pitch: 0.4 },
        ],
        handL: [0.36, -0.62, 0.6],
        handR: [-0.36, -0.62, 0.6],
        offset: [0, -0.14, 0.04],
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

