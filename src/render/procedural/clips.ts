import type { SkillId } from '../../sim/types'
import { CARRY_HAND } from './arms'
import { Joint, LEFT, RIGHT } from './joints'
import { STANCE_HIP } from './limbs'
import { compilePoseClip, type PoseClip, type PoseClipSource, type Vec3 } from './posekeys'

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

/**
 * The strike lands on the turn: phase 0.5 is the last frame of the wind-up, which
 * is the frame the sim's damage lands on, so the pose arrives with the hit.
 *
 * The two halves run at whatever rate the skill's own timings set — a 0.3 s
 * wind-up and a 0.12 s recovery are the same clip at two speeds — so a key inside
 * one half is authored against that half's frame budget, and a swing authored in
 * the last few percent of a wind-up has one frame to travel in. Each row therefore
 * states its own anticipation time rather than sharing one:
 * `tests/procedural_continuity.test.ts` walks every skill at its real timings and
 * fails if any joint moves more than a quarter radian in a frame.
 */
const STRIKE = 0.5
/** A stated foot is measured from its own hip, so the ground is one stance leg below it. */
const GROUND = -STANCE_HIP
/**
 * A skill whose recovery is long enough to travel in lands its strike just past
 * the hit rather than on it: the wind-up alone cannot carry both arms from
 * overhead to the floor without skipping frames. A short recovery — firebolt's
 * 0.12 s, cleave's 0.14 — has no room, so those land on the turn.
 */
const LATE_STRIKE = 0.5 + 0.5 * 0.32
/** Anticipation, then acceleration into the hit: a strike is not a slow push. */
const STRIKE_EASE = 1

/**
 * Where a skill leaves the hand when its recovery runs out. Not the carry: a
 * firebolt recovers in 0.12 s, and asking the arm to travel out and all the way
 * back inside seven frames is what makes a strike read as a flicker. The clip
 * comes back to a guard and the generator's own state blend takes it from there.
 */
function relax(strike: Vec3, side: number): Vec3 {
  return [
    (strike[0] + side * CARRY_HAND[0]!) * 0.5,
    (strike[1] + CARRY_HAND[1]!) * 0.5,
    (strike[2] + CARRY_HAND[2]!) * 0.5,
  ]
}

const CLEAVE_R: Vec3 = [-0.42, -0.4, 0.4]
const CLEAVE_L: Vec3 = [0.34, -0.5, 0.3]
const FIREBOLT_R: Vec3 = [-0.2, -0.24, 0.62]
const FIREBOLT_L: Vec3 = [0.28, -0.5, 0.3]
const FROST_R: Vec3 = [-0.58, -0.44, 0.34]
const FROST_L: Vec3 = [0.58, -0.44, 0.34]
const BITE_R: Vec3 = [-0.36, -0.32, 0.62]
const BITE_L: Vec3 = [0.36, -0.32, 0.62]
const BOLT_R: Vec3 = [-0.2, 0.08, 0.78]
const BOLT_L: Vec3 = [0.2, 0.08, 0.78]
const SLAM_R: Vec3 = [-0.48, -0.8, 0.34]
const SLAM_L: Vec3 = [0.48, -0.8, 0.34]

export const POSE_SOURCES: Readonly<Record<PoseClipName, PoseClipSource>> = {
  /**
   * A diagonal chop. The cast is 0.36 s end to end — thirteen frames of wind-up —
   * so the arm lifts once and comes down once: a coil across the far shoulder and
   * a sweep back out is twice the travel those frames can carry.
   */
  cleave: {
    planted: true,
    keys: [
      { at: 0, footL: [0, GROUND, 0] },
      {
        // One pose in the wind-up, not two: thirteen frames is not enough to hold
        // a lift and a coil and still swing.
        at: 0.34,
        torso: [
          { joint: Joint.Chest, yaw: 0.4, pitch: -0.1 },
          { joint: Joint.Spine, yaw: 0.2, pitch: -0.05 },
          { joint: Joint.Pelvis, yaw: 0.1 },
        ],
        handR: [-0.48, -0.5, -0.22],
        handL: [0.28, -0.64, 0.22],
        poleR: [-0.5, -0.45, -0.75],
        footL: [0, GROUND, 0],
      },
      {
        // The hit lands here, and the recovery runs 1.6 times faster than the
        // wind-up: a key on the turn keeps each half of the sweep inside one rate.
        at: 0.5,
        torso: [
          { joint: Joint.Chest, yaw: -0.15, pitch: 0.06 },
          { joint: Joint.Spine, yaw: -0.07, pitch: 0.03 },
          { joint: Joint.Pelvis, yaw: -0.04 },
        ],
        handR: [-0.47, -0.42, 0.2],
        handL: [0.3, -0.6, 0.24],
        poleR: [-0.6, -0.35, -0.72],
        footL: [0.013, GROUND + 0.026, 0.13],
        offset: [0, -0.026, 0.013],
      },
      {
        at: LATE_STRIKE,
        ease: STRIKE_EASE,
        torso: [
          { joint: Joint.Chest, yaw: -0.44, pitch: 0.14 },
          { joint: Joint.Spine, yaw: -0.22, pitch: 0.08 },
          { joint: Joint.Pelvis, yaw: -0.12 },
        ],
        handR: CLEAVE_R,
        handL: CLEAVE_L,
        poleR: [-0.6, -0.3, -0.75],
        // The left foot steps into the swing and comes back with it.
        footL: [0.02, GROUND + 0.04, 0.2],
        offset: [0, -0.04, 0.02],
      },
      { at: 1, ease: 1.2, footL: [0, GROUND, 0], handR: relax(CLEAVE_R, RIGHT), handL: relax(CLEAVE_L, LEFT) },
    ],
  },
  /** A thrust: the hand is cocked at the hip, then driven out at chest height. */
  firebolt: {
    planted: true,
    keys: [
      { at: 0 },
      {
        at: 0.18,
        torso: [
          { joint: Joint.Chest, pitch: -0.12, yaw: -0.16 },
          { joint: Joint.Spine, pitch: -0.06, yaw: -0.08 },
        ],
        handR: [-0.3, -0.7, -0.16],
        handL: [0.24, -0.72, 0.16],
        offset: [0, -0.02, -0.06],
      },
      {
        at: STRIKE,
        ease: STRIKE_EASE,
        torso: [
          { joint: Joint.Chest, pitch: 0.2, yaw: 0.12 },
          { joint: Joint.Spine, pitch: 0.1, yaw: 0.06 },
        ],
        handR: FIREBOLT_R,
        handL: FIREBOLT_L,
        offset: [0, -0.02, 0.05],
      },
      { at: 1, ease: 1.2, handR: relax(FIREBOLT_R, RIGHT), handL: relax(FIREBOLT_L, LEFT) },
    ],
  },
  /** Both hands overhead, then slammed down and out as the body drops onto it. */
  frost_nova: {
    planted: true,
    keys: [
      { at: 0 },
      {
        at: 0.18,
        torso: [{ joint: Joint.Chest, pitch: -0.08 }, { joint: Joint.Head, pitch: -0.1 }],
        handL: [0.46, -0.4, 0.16],
        handR: [-0.46, -0.4, 0.16],
      },
      {
        at: 0.3,
        torso: [{ joint: Joint.Chest, pitch: -0.12 }, { joint: Joint.Head, pitch: -0.14 }],
        handL: [0.5, 0.1, 0.1],
        handR: [-0.5, 0.1, 0.1],
      },
      {
        at: 0.36,
        torso: [
          { joint: Joint.Chest, pitch: -0.16 },
          { joint: Joint.Spine, pitch: -0.08 },
          { joint: Joint.Head, pitch: -0.2 },
        ],
        handL: [0.34, 0.5, 0.02],
        handR: [-0.34, 0.5, 0.02],
        offset: [0, -0.05, 0],
      },
      {
        at: 0.5,
        torso: [{ joint: Joint.Chest, pitch: 0.1 }, { joint: Joint.Head, pitch: 0.12 }],
        handL: [0.56, 0.04, 0.2],
        handR: [-0.56, 0.04, 0.2],
        offset: [0, -0.09, 0],
      },
      {
        at: LATE_STRIKE,
        ease: STRIKE_EASE,
        torso: [
          { joint: Joint.Chest, pitch: 0.34 },
          { joint: Joint.Spine, pitch: 0.18 },
          { joint: Joint.Head, pitch: 0.3 },
        ],
        handL: FROST_L,
        handR: FROST_R,
        offset: [0, -0.14, 0.02],
      },
      { at: 1, ease: 1.2, handR: relax(FROST_R, RIGHT), handL: relax(FROST_L, LEFT) },
    ],
  },
  /** A lunge: the head and shoulders go first and the hands claw after them. */
  monster_bite: {
    planted: true,
    keys: [
      { at: 0 },
      {
        at: 0.16,
        torso: [
          { joint: Joint.Chest, pitch: -0.26 },
          { joint: Joint.Spine, pitch: -0.12 },
          { joint: Joint.Head, pitch: -0.3 },
        ],
        handL: [0.28, -0.78, -0.12],
        handR: [-0.28, -0.78, -0.12],
        offset: [0, -0.04, -0.05],
      },
      {
        at: LATE_STRIKE,
        ease: STRIKE_EASE,
        torso: [
          { joint: Joint.Chest, pitch: 0.5 },
          { joint: Joint.Spine, pitch: 0.26 },
          { joint: Joint.Head, pitch: 0.42 },
        ],
        handL: BITE_L,
        handR: BITE_R,
        offset: [0, -0.06, 0.12],
      },
      { at: 1, ease: 1.2, handR: relax(BITE_R, RIGHT), handL: relax(BITE_L, LEFT) },
    ],
  },
  /** Firebolt with both hands: cocked at the hips, thrust out together. */
  monster_bolt: {
    planted: true,
    keys: [
      { at: 0 },
      {
        at: 0.16,
        torso: [{ joint: Joint.Chest, pitch: -0.14 }, { joint: Joint.Spine, pitch: -0.07 }],
        handL: [0.3, -0.72, -0.3],
        handR: [-0.3, -0.72, -0.3],
        offset: [0, -0.02, -0.06],
      },
      {
        at: LATE_STRIKE,
        ease: STRIKE_EASE,
        torso: [{ joint: Joint.Chest, pitch: 0.22 }, { joint: Joint.Spine, pitch: 0.11 }],
        handL: BOLT_L,
        handR: BOLT_R,
        offset: [0, -0.02, 0.05],
      },
      { at: 1, ease: 1.2, handR: relax(BOLT_R, RIGHT), handL: relax(BOLT_L, LEFT) },
    ],
  },
  /** Frost nova's slam with a longer wind-up: the arms hang overhead a beat first. */
  monster_slam: {
    planted: true,
    keys: [
      { at: 0 },
      {
        at: 0.15,
        torso: [{ joint: Joint.Chest, pitch: -0.1 }],
        handL: [0.46, -0.4, 0.14],
        handR: [-0.46, -0.4, 0.14],
      },
      {
        at: 0.2,
        torso: [{ joint: Joint.Chest, pitch: -0.2 }, { joint: Joint.Head, pitch: -0.24 }],
        handL: [0.5, 0.14, 0.08],
        handR: [-0.5, 0.14, 0.08],
        offset: [0, -0.04, 0],
      },
      {
        at: 0.3,
        torso: [
          { joint: Joint.Chest, pitch: -0.24 },
          { joint: Joint.Spine, pitch: -0.1 },
          { joint: Joint.Head, pitch: -0.26 },
        ],
        handL: [0.26, 0.6, -0.02],
        handR: [-0.26, 0.6, -0.02],
        offset: [0, -0.06, -0.02],
      },
      {
        at: 0.5,
        torso: [{ joint: Joint.Chest, pitch: 0.12 }, { joint: Joint.Head, pitch: 0.14 }],
        handL: [0.56, 0.08, 0.22],
        handR: [-0.56, 0.08, 0.22],
        offset: [0, -0.1, 0],
      },
      {
        at: LATE_STRIKE,
        ease: STRIKE_EASE,
        torso: [
          { joint: Joint.Chest, pitch: 0.44 },
          { joint: Joint.Spine, pitch: 0.24 },
          { joint: Joint.Head, pitch: 0.36 },
        ],
        handL: SLAM_L,
        handR: SLAM_R,
        offset: [0, -0.18, 0.04],
      },
      { at: 1, ease: 1.2, handR: relax(SLAM_R, RIGHT), handL: relax(SLAM_L, LEFT) },
    ],
  },
  /** Buckles at the knees, then rolls onto its right side and stays there. */
  dead: {
    planted: false,
    keys: [
      { at: 0 },
      {
        // The knees give and the body starts back; the arms come up to nothing.
        at: 0.3,
        ease: 0.8,
        torso: [
          { joint: Joint.Pelvis, pitch: -0.3 },
          { joint: Joint.Spine, pitch: -0.12 },
          { joint: Joint.Chest, pitch: -0.1 },
          { joint: Joint.Head, pitch: -0.25 },
        ],
        offset: [0, -0.22, -0.06],
        footL: [0.08, -0.75, 0.06],
        footR: [-0.08, -0.75, 0.06],
        handL: [0.55, -0.25, 0.35],
        handR: [-0.55, -0.25, 0.35],
      },
      {
        // Hips reach the ground; the legs fold up in front, the arms fly out.
        at: 0.62,
        ease: 0.7,
        torso: [
          { joint: Joint.Pelvis, pitch: -1.15 },
          { joint: Joint.Spine, pitch: -1.3 },
          { joint: Joint.Chest, pitch: -1.35 },
          { joint: Joint.Head, pitch: -1.15 },
        ],
        offset: [0, -0.97, -0.25],
        footL: [0.12, 0.05, 0.84],
        footR: [-0.12, 0.05, 0.84],
        kneeL: [0.2, 1, 0.3],
        kneeR: [-0.2, 1, 0.3],
        handL: [0.75, 0.02, 0.32],
        handR: [-0.75, 0.02, 0.32],
        poleL: [0.3, 0.6, -0.4],
        poleR: [-0.3, 0.6, -0.4],
      },
      {
        // Settled on its back, flat to the ground, knees a little up, head down.
        at: 1,
        ease: 1.4,
        torso: [
          { joint: Joint.Pelvis, pitch: -1.5 },
          { joint: Joint.Spine, pitch: -1.55 },
          { joint: Joint.Chest, pitch: -1.55 },
          { joint: Joint.Head, pitch: -1.4 },
        ],
        offset: [0, -0.99, -0.3],
        footL: [0.14, 0.02, 0.95],
        footR: [-0.14, 0.02, 0.95],
        kneeL: [0.2, 1, 0.3],
        kneeR: [-0.2, 1, 0.3],
        handL: [0.85, -0.02, 0.25],
        handR: [-0.85, -0.02, 0.25],
        poleL: [0.3, 0.5, -0.5],
        poleR: [-0.3, 0.5, -0.5],
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
