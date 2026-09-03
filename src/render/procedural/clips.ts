import type { SkillId } from '../../sim/types'
import { CARRY_HAND } from './arms'
import { Joint, LEFT, RIGHT } from './joints'
import { STANCE_HIP } from './limbs'
import { compilePoseClip, type PoseClip, type PoseClipSource, type PoseKey, type Vec3 } from './posekeys'

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
/** Motions no sim skill drives yet. Each states the timings its gates walk it at. */
export type MotionName =
  | 'cast'
  | 'channel'
  | 'execute_overhead'
  | 'execute_thrust'
  | 'swing_one_hand'
  | 'swing_two_hand'
  | 'bow_draw'
  | 'stagger'

export type PoseClipName = Exclude<SkillId, 'dash'> | 'dead' | MotionName

export interface MotionTimings {
  readonly windup: number
  readonly recovery: number
}

export const MOTION_TIMINGS: Readonly<Record<MotionName, MotionTimings>> = {
  cast: { windup: 0.3, recovery: 0.18 },
  channel: { windup: 0.25, recovery: 0.25 },
  execute_overhead: { windup: 0.52, recovery: 0.4 },
  execute_thrust: { windup: 0.36, recovery: 0.34 },
  swing_one_hand: { windup: 0.36, recovery: 0.24 },
  swing_two_hand: { windup: 0.54, recovery: 0.32 },
  bow_draw: { windup: 0.5, recovery: 0.26 },
  stagger: { windup: 0.2, recovery: 0.36 },
}

export const MOTION_CLIPS: readonly MotionName[] = Object.keys(MOTION_TIMINGS) as MotionName[]

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
const DRAW_BACK_L: Vec3 = [CARRY_HAND[0], CARRY_HAND[1], CARRY_HAND[2] - 0.02]
const DRAW_BACK_R: Vec3 = [-CARRY_HAND[0], CARRY_HAND[1], CARRY_HAND[2] - 0.02]

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
const BITE_R: Vec3 = [-0.36, -0.32, 0.62]
const BITE_L: Vec3 = [0.36, -0.32, 0.62]
const BOLT_R: Vec3 = [-0.2, 0.08, 0.78]
const BOLT_L: Vec3 = [0.2, 0.08, 0.78]
const SLAM_R: Vec3 = [-0.48, -0.8, 0.34]
const SLAM_L: Vec3 = [0.48, -0.8, 0.34]
const CAST_R: Vec3 = [0.06, -0.3, 0.74]
const CAST_L: Vec3 = [-0.06, -0.3, 0.74]
/** The ball held at the right of the waist: the right hand outside it, the left crossed over it. */
const CAST_BALL: PoseKey = {
  at: 0.16,
  torso: [
    { joint: Joint.Chest, yaw: -0.2, pitch: 0.1 },
    { joint: Joint.Spine, yaw: -0.1, pitch: 0.04 },
    { joint: Joint.Head, pitch: 0.12 },
  ],
  handR: [-0.07, -0.67, 0.41],
  handL: [-0.27, -0.67, 0.41],
  poleR: [-0.8, -0.3, -0.5],
  poleL: [0.8, -0.2, -0.5],
  offset: [0, -0.02, 0],
}
/**
 * Every spell: both hands roll a ball at the right of the waist through the
 * wind-up, then drive it out together on the turn. The roll is time-driven rather
 * than phase-driven so a three-second cast keeps moving instead of stretching.
 */
const CAST: PoseClipSource = {
  planted: true,
  gather: { radius: 0.1, period: 0.7, until: 0.4 },
  keys: [
    { at: 0, handL: DRAW_BACK_L, handR: DRAW_BACK_R },
    CAST_BALL,
    { ...CAST_BALL, at: 0.34 },
    {
      at: STRIKE,
      ease: STRIKE_EASE,
      torso: [
        { joint: Joint.Chest, yaw: 0.1, pitch: 0.18 },
        { joint: Joint.Spine, yaw: 0.05, pitch: 0.08 },
      ],
      handR: CAST_R,
      handL: CAST_L,
      poleR: [-0.6, -0.4, -0.7],
      poleL: [0.6, -0.4, -0.7],
      offset: [0, -0.02, 0.05],
    },
    { at: 1, ease: 1.2, handR: relax(CAST_R, RIGHT), handL: relax(CAST_L, LEFT) },
  ],
}
const CHANNEL_L: Vec3 = [-0.06, -0.42, 0.62]
const CHANNEL_R: Vec3 = [0.06, -0.42, 0.62]
const CHANNEL_REST: PoseKey = {
  at: 0,
  torso: [{ joint: Joint.Chest, pitch: 0.08 }, { joint: Joint.Spine, pitch: 0.03 }],
  handL: CHANNEL_L,
  handR: CHANNEL_R,
  poleL: [0.5, -0.5, -0.7],
  poleR: [-0.5, -0.5, -0.7],
  offset: [0, -0.02, 0.02],
}
const EXECUTE_OVERHEAD_L: Vec3 = [-0.08, -0.5, 0.62]
const EXECUTE_OVERHEAD_R: Vec3 = [0.08, -0.5, 0.62]
const EXECUTE_THRUST_R: Vec3 = [0.02, -0.3, 0.8]
const EXECUTE_THRUST_L: Vec3 = [0.34, -0.62, 0.06]
const SWING_ONE_R: Vec3 = [0.06, -0.34, 0.66]
const SWING_ONE_L: Vec3 = [0.3, -0.62, 0.1]
const SWING_ONE_THROUGH_R: Vec3 = [0.3, -0.42, 0.5]
const SWING_TWO_L: Vec3 = [0.02, -0.66, 0.42]
const SWING_TWO_R: Vec3 = [0.14, -0.62, 0.5]
const BOW_L: Vec3 = [-0.06, -0.02, 0.9]
const BOW_R: Vec3 = [-0.24, -0.07, 0.1]
const BOW_RELEASE_R: Vec3 = [-0.26, -0.04, 0]
const STAGGER_GUARD_L: Vec3 = [0.17, -0.58, 0.34]
const STAGGER_GUARD_R: Vec3 = [-0.17, -0.58, 0.34]

export const POSE_SOURCES: Readonly<Record<PoseClipName, PoseClipSource>> = {
  /**
   * A diagonal chop. The cast is 0.36 s end to end — thirteen frames of wind-up —
   * so the arm lifts once and comes down once: a coil across the far shoulder and
   * a sweep back out is twice the travel those frames can carry.
   */
  cleave: {
    planted: true,
    keys: [
      { at: 0, footL: [0, GROUND, 0], handL: DRAW_BACK_L, handR: DRAW_BACK_R },
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
  firebolt: CAST,
  frost_nova: CAST,
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
  cast: CAST,
  /** A held two-hand beam whose breathing pulse loops without a seam. */
  channel: {
    planted: true,
    loop: true,
    keys: [
      CHANNEL_REST,
      {
        at: 0.5,
        torso: [
          { joint: Joint.Chest, pitch: 0.14 },
          { joint: Joint.Spine, pitch: 0.06 },
          { joint: Joint.Head, pitch: 0.06 },
        ],
        handL: [-0.04, -0.38, 0.7],
        handR: [0.04, -0.38, 0.7],
        poleL: [0.5, -0.5, -0.7],
        poleR: [-0.5, -0.5, -0.7],
        offset: [0, -0.035, 0.05],
      },
      { ...CHANNEL_REST, at: 1 },
    ],
  },
  /** A cast follow-up that lifts both hands overhead before slamming down. */
  execute_overhead: {
    planted: true,
    keys: [
      {
        at: 0,
        handR: relax(CAST_R, RIGHT),
        handL: relax(CAST_L, LEFT),
        poleL: [0.8, 0, 0.5],
        poleR: [-0.8, 0, 0.5],
      },
      {
        at: 0.14,
        torso: [{ joint: Joint.Chest, pitch: -0.06 }],
        handL: [-0.06, -0.4, 0.36],
        handR: [0.06, -0.4, 0.36],
        poleL: [0.8, 0, 0.5],
        poleR: [-0.8, 0, 0.5],
        offset: [0, -0.01, -0.01],
      },
      {
        at: 0.26,
        torso: [
          { joint: Joint.Chest, pitch: -0.14 },
          { joint: Joint.Spine, pitch: -0.05 },
          { joint: Joint.Head, pitch: -0.075 },
        ],
        handL: [-0.15, 0.09, 0.19],
        handR: [0.15, 0.09, 0.19],
        poleL: [0.8, 0, 0.5],
        poleR: [-0.8, 0, 0.5],
        offset: [0, -0.02, -0.025],
      },
      {
        at: 0.38,
        torso: [
          { joint: Joint.Chest, pitch: -0.22 },
          { joint: Joint.Spine, pitch: -0.1 },
          { joint: Joint.Head, pitch: -0.15 },
        ],
        handL: [-0.16, 0.42, -0.06],
        handR: [0.16, 0.42, -0.06],
        poleL: [0.8, 0, 0.5],
        poleR: [-0.8, 0, 0.5],
        offset: [0, -0.03, -0.04],
      },
      {
        at: 0.5,
        torso: [{ joint: Joint.Chest, pitch: 0.1 }, { joint: Joint.Head, pitch: 0.08 }],
        handL: [-0.08, 0.26, 0.42],
        handR: [0.08, 0.26, 0.42],
        poleL: [0.8, 0, 0.5],
        poleR: [-0.8, 0, 0.5],
        offset: [0, -0.06, 0],
      },
      {
        at: 0.7,
        ease: STRIKE_EASE,
        torso: [
          { joint: Joint.Chest, pitch: 0.42 },
          { joint: Joint.Spine, pitch: 0.22 },
          { joint: Joint.Head, pitch: 0.26 },
        ],
        handL: EXECUTE_OVERHEAD_L,
        handR: EXECUTE_OVERHEAD_R,
        poleL: [0.8, 0, 0.5],
        poleR: [-0.8, 0, 0.5],
        offset: [0, -0.14, 0.06],
      },
      {
        at: 1,
        ease: 1.2,
        handR: relax(EXECUTE_OVERHEAD_R, RIGHT),
        handL: relax(EXECUTE_OVERHEAD_L, LEFT),
      },
    ],
  },
  /** A cast follow-up that coils at the hip and lunges through the centre line. */
  execute_thrust: {
    planted: true,
    keys: [
      { at: 0, footL: [0, GROUND, 0], handR: relax(CAST_R, RIGHT), handL: relax(CAST_L, LEFT) },
      {
        at: 0.28,
        torso: [
          { joint: Joint.Chest, yaw: -0.35, pitch: -0.06 },
          { joint: Joint.Spine, yaw: -0.18, pitch: -0.03 },
          { joint: Joint.Pelvis, yaw: -0.1 },
        ],
        handR: [-0.36, -0.62, -0.28],
        poleR: [-0.6, -0.3, -0.75],
        handL: [0.3, -0.6, 0],
        footL: [0, GROUND + 0.03, 0],
        offset: [0, -0.03, -0.06],
      },
      {
        at: STRIKE,
        torso: [
          { joint: Joint.Chest, yaw: 0.1, pitch: 0.12 },
          { joint: Joint.Spine, yaw: 0.05, pitch: 0.06 },
        ],
        handR: [-0.18, -0.4, 0.42],
        poleR: [-0.55, -0.35, -0.7],
        handL: [0.28, -0.6, 0.14],
        footL: [0.01, GROUND + 0.04, 0.14],
        offset: [0, -0.04, 0.03],
      },
      {
        at: LATE_STRIKE,
        ease: STRIKE_EASE,
        torso: [
          { joint: Joint.Chest, yaw: 0.42, pitch: 0.24 },
          { joint: Joint.Spine, yaw: 0.2, pitch: 0.12 },
          { joint: Joint.Pelvis, yaw: 0.12 },
          { joint: Joint.Head, pitch: 0.1 },
        ],
        handR: EXECUTE_THRUST_R,
        poleR: [-0.5, -0.4, -0.7],
        handL: EXECUTE_THRUST_L,
        footL: [0.02, GROUND + 0.07, 0.2],
        offset: [0, -0.07, 0.05],
      },
      {
        at: 1,
        ease: 1.2,
        footL: [0, GROUND, 0],
        handR: relax(EXECUTE_THRUST_R, RIGHT),
        handL: relax(EXECUTE_THRUST_L, LEFT),
      },
    ],
  },
  /** A flat one-hand slash, unlike cleave's stepped diagonal chop. */
  swing_one_hand: {
    planted: true,
    keys: [
      { at: 0, handL: DRAW_BACK_L, handR: DRAW_BACK_R },
      {
        at: 0.2,
        torso: [
          { joint: Joint.Chest, yaw: -0.42, pitch: -0.04 },
          { joint: Joint.Spine, yaw: -0.2 },
          { joint: Joint.Pelvis, yaw: -0.1 },
        ],
        handR: [-0.58, -0.5, -0.15],
        poleR: [-0.5, -0.5, -0.7],
        handL: [0.2, -0.55, 0.3],
        offset: [0, -0.02, -0.03],
      },
      {
        at: STRIKE,
        ease: STRIKE_EASE,
        torso: [
          { joint: Joint.Chest, yaw: 0.3, pitch: 0.1 },
          { joint: Joint.Spine, yaw: 0.15, pitch: 0.05 },
          { joint: Joint.Pelvis, yaw: 0.08 },
        ],
        handR: SWING_ONE_R,
        poleR: [-0.6, -0.4, -0.6],
        handL: SWING_ONE_L,
        offset: [0, -0.03, 0.04],
      },
      {
        at: 0.68,
        torso: [
          { joint: Joint.Chest, yaw: 0.5, pitch: 0.08 },
          { joint: Joint.Spine, yaw: 0.25, pitch: 0.04 },
          { joint: Joint.Pelvis, yaw: 0.12 },
        ],
        handR: SWING_ONE_THROUGH_R,
        poleR: [-0.6, -0.4, -0.6],
        handL: SWING_ONE_L,
        offset: [0, -0.03, 0.03],
      },
      {
        at: 1,
        ease: 1.2,
        handR: relax(SWING_ONE_THROUGH_R, RIGHT),
        handL: relax(SWING_ONE_L, LEFT),
      },
    ],
  },
  /**
   * A heavy two-hand chop: gathered at the right hip, raised over the right
   * shoulder, through on the turn, down low on the left. The grip stays ahead of
   * the body all the way up: a hand passing through its own shoulder flips the arm.
   */
  swing_two_hand: {
    planted: true,
    keys: [
      {
        at: 0,
        handL: DRAW_BACK_L,
        handR: DRAW_BACK_R,
        poleL: [0.8, 0.1, -0.6],
        poleR: [-0.8, 0.1, -0.6],
      },
      {
        at: 0.12,
        torso: [
          { joint: Joint.Chest, yaw: -0.2, pitch: 0.06 },
          { joint: Joint.Spine, yaw: -0.1, pitch: 0.02 },
        ],
        handR: [0.14, -0.52, 0.42],
        handL: [-0.26, -0.52, 0.48],
        poleR: [-1, 0.1, -0.2],
        poleL: [1, 0.1, -0.2],
        offset: [0, -0.02, -0.02],
      },
      {
        at: 0.34,
        torso: [
          { joint: Joint.Chest, yaw: -0.36, pitch: -0.16 },
          { joint: Joint.Spine, yaw: -0.18, pitch: -0.06 },
          { joint: Joint.Pelvis, yaw: -0.1 },
          { joint: Joint.Head, pitch: -0.1 },
        ],
        handR: [0.18, 0.42, 0.38],
        handL: [-0.28, 0.34, 0.42],
        poleR: [-0.7, 0.2, 0.7],
        poleL: [0.7, 0.2, 0.7],
        offset: [0, -0.04, -0.04],
      },
      {
        at: STRIKE,
        torso: [
          { joint: Joint.Chest, yaw: 0.06, pitch: 0.14 },
          { joint: Joint.Spine, yaw: 0.02, pitch: 0.06 },
          { joint: Joint.Head, pitch: 0.1 },
        ],
        handR: [0.16, 0.1, 0.62],
        handL: [-0.16, 0.06, 0.58],
        poleR: [-0.6, -0.4, 0.6],
        poleL: [0.6, -0.4, 0.6],
        offset: [0, -0.07, 0],
      },
      {
        at: LATE_STRIKE,
        ease: STRIKE_EASE,
        torso: [
          { joint: Joint.Chest, yaw: 0.4, pitch: 0.36 },
          { joint: Joint.Spine, yaw: 0.2, pitch: 0.18 },
          { joint: Joint.Pelvis, yaw: 0.12 },
          { joint: Joint.Head, pitch: 0.2 },
        ],
        handR: SWING_TWO_R,
        handL: SWING_TWO_L,
        poleR: [-0.8, -0.6, 0.1],
        poleL: [0.8, -0.6, 0.1],
        offset: [0, -0.14, 0.05],
      },
      { at: 1, ease: 1.2, handR: relax(SWING_TWO_R, RIGHT), handL: relax(SWING_TWO_L, LEFT) },
    ],
  },
  /** A side-on bow draw that anchors at the cheek, releases, then relaxes. */
  bow_draw: {
    planted: true,
    keys: [
      { at: 0, handL: DRAW_BACK_L, handR: DRAW_BACK_R },
      {
        at: 0.14,
        torso: [{ joint: Joint.Chest, yaw: -0.2 }, { joint: Joint.Spine, yaw: -0.1 }],
        handL: [0.02, -0.45, 0.42],
        handR: [-0.1, -0.45, 0.3],
        poleL: [0.3, -0.8, -0.4],
        poleR: [-0.7, -0.3, -0.6],
        offset: [0, -0.01, -0.01],
      },
      {
        at: STRIKE,
        torso: [
          { joint: Joint.Chest, yaw: -0.5, pitch: 0.02 },
          { joint: Joint.Spine, yaw: -0.25 },
          { joint: Joint.Pelvis, yaw: -0.15 },
        ],
        handL: BOW_L,
        handR: BOW_R,
        poleL: [0.3, -0.8, -0.4],
        poleR: [0, 1, -0.5],
        offset: [0, -0.02, 0],
      },
      {
        at: 0.64,
        ease: STRIKE_EASE,
        torso: [
          { joint: Joint.Chest, yaw: -0.52, pitch: 0.02 },
          { joint: Joint.Spine, yaw: -0.26 },
          { joint: Joint.Pelvis, yaw: -0.15 },
        ],
        handL: BOW_L,
        handR: BOW_RELEASE_R,
        poleL: [0.3, -0.8, -0.4],
        poleR: [0, 1, -0.5],
        offset: [0, -0.02, 0],
      },
      {
        // A settle between release and guard: one long swing home skips frames.
        at: 0.8,
        ease: 1.2,
        torso: [
          { joint: Joint.Chest, yaw: -0.26, pitch: 0.01 },
          { joint: Joint.Spine, yaw: -0.13 },
          { joint: Joint.Pelvis, yaw: -0.08 },
        ],
        handL: [-0.02, -0.24, 0.72],
        handR: [-0.28, -0.18, 0.04],
        poleL: [0.3, -0.6, -0.6],
        poleR: [-0.2, 0.5, -0.7],
        offset: [0, -0.01, 0],
      },
      { at: 1, ease: 1.2, handR: relax(BOW_RELEASE_R, RIGHT), handL: relax(BOW_L, LEFT) },
    ],
  },
  /** A full-body knockback that recoils harder than the additive flinch layer. */
  stagger: {
    planted: true,
    keys: [
      { at: 0, footR: [0, GROUND, 0], handL: DRAW_BACK_L, handR: DRAW_BACK_R },
      {
        at: STRIKE,
        ease: 0.85,
        torso: [
          { joint: Joint.Pelvis, pitch: -0.12 },
          { joint: Joint.Spine, pitch: -0.22 },
          { joint: Joint.Chest, pitch: -0.42 },
          { joint: Joint.Head, pitch: -0.4 },
        ],
        handL: [0.3, -0.45, 0.36],
        handR: [-0.3, -0.45, 0.36],
        poleL: [0.6, -0.4, -0.6],
        poleR: [-0.6, -0.4, -0.6],
        footR: [-0.02, GROUND + 0.06, -0.14],
        offset: [0, -0.06, -0.12],
      },
      {
        at: 0.72,
        torso: [
          { joint: Joint.Pelvis, pitch: -0.04 },
          { joint: Joint.Spine, pitch: -0.06 },
          { joint: Joint.Chest, pitch: -0.1 },
          { joint: Joint.Head, pitch: -0.06 },
        ],
        handL: [0.26, -0.45, 0.36],
        handR: [-0.26, -0.45, 0.36],
        poleL: [0.6, -0.4, -0.6],
        poleR: [-0.6, -0.4, -0.6],
        footR: [-0.01, GROUND + 0.04, -0.1],
        offset: [0, -0.04, -0.08],
      },
      {
        at: 1,
        ease: 1.2,
        footR: [0, GROUND, 0],
        handL: STAGGER_GUARD_L,
        handR: STAGGER_GUARD_R,
      },
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
  (name) => name !== 'dead' && !(name in MOTION_TIMINGS),
)

/**
 * How long a body takes to reach the ground. The death fade starts at 55 percent
 * of 1.6 s, so anything longer would fade out a body still on its feet.
 */
export const DEATH_SETTLE = 0.7
