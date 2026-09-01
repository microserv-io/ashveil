import type { SkillId } from '../../sim/types'
import { clamp, smoothstep } from './curves'
import type { RigGeometry } from './geometry'
import { Joint, LEFT, RIGHT } from './joints'
import { plantFeet, resolveTorso, stanceOffset, writeArm, writeLeg, type LimbScratch } from './limbs'
import { resetPose, type Pose } from './pose'
import { quatFromAxisAngle, quatIdentity, quatMultiply, quatNlerp } from './quat'

/**
 * Keyframed poses, authored as data in the repo's data-as-code style: a new skill
 * is a new row, not new logic.
 *
 * A key states only what it changes. Torso joints are angles about the body-frame
 * axes; hands are targets relative to their own shoulder in arm lengths; feet are
 * targets relative to their own hip in leg lengths; the root offset is in leg
 * lengths. Everything unstated falls back to a body standing on its feet with its
 * arms hanging, so a placeholder cannot render as a bind pose by omission.
 */
export interface TorsoTurn {
  readonly joint: Joint
  /** Pitch about +X leans forward, yaw about +Y turns left, roll about +Z leans right. */
  readonly pitch?: number
  readonly yaw?: number
  readonly roll?: number
}

export type Vec3 = readonly [number, number, number]

export interface PoseKey {
  readonly at: number
  /** Shapes the approach to this key: below 1 snaps into it, above 1 eases in. */
  readonly ease?: number
  readonly torso?: readonly TorsoTurn[]
  readonly handL?: Vec3
  readonly handR?: Vec3
  readonly footL?: Vec3
  readonly footR?: Vec3
  readonly offset?: Vec3
}

export interface PoseClipSource {
  /** True keeps both feet flat on the ground and ignores any foot key. */
  readonly planted: boolean
  readonly keys: readonly PoseKey[]
}

const ZERO: Vec3 = [0, 0, 0]
/** The hand's resting place beside the body, in arm lengths from its shoulder. */
const HAND_REST: Vec3 = [0.185, -0.84, 0]
/** The foot's resting place under the hip, in leg lengths. Only used unplanted. */
const FOOT_REST: Vec3 = [0, -0.94, 0]

/**
 * Dash is a held pose rather than a keyframed one, so it lives in `gait.ts`.
 * Every other skill needs a row here, and the type says so: add a `SkillId` and
 * this table stops compiling until it has a pose.
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

/** The clip is stored compiled: quaternions and targets, ready to interpolate. */
export interface PoseClip {
  readonly planted: boolean
  readonly times: Float32Array
  /** `keys * Joint.Count * 4`. */
  readonly rotations: Float32Array
  readonly eases: Float32Array
  /** `keys * 3` per side. */
  readonly hands: Float32Array
  readonly feet: Float32Array
  readonly offsets: Float32Array
}

export function compilePoseClip(source: PoseClipSource): PoseClip {
  const count = source.keys.length
  const clip: PoseClip = {
    planted: source.planted,
    times: new Float32Array(count),
    rotations: new Float32Array(count * Joint.Count * 4),
    eases: new Float32Array(count),
    hands: new Float32Array(count * 6),
    feet: new Float32Array(count * 6),
    offsets: new Float32Array(count * 3),
  }
  const turn = new Float32Array(4)
  const spare = new Float32Array(4)
  source.keys.forEach((key, index) => {
    clip.times[index] = key.at
    clip.eases[index] = key.ease ?? 1
    for (let joint = 0; joint < Joint.Count; joint++) {
      quatIdentity(clip.rotations, (index * Joint.Count + joint) * 4)
    }
    for (const spin of key.torso ?? []) {
      const base = (index * Joint.Count + spin.joint) * 4
      quatFromAxisAngle(turn, 0, 0, 1, 0, spin.yaw ?? 0)
      quatFromAxisAngle(spare, 0, 1, 0, 0, spin.pitch ?? 0)
      quatMultiply(turn, 0, spare, 0, turn, 0)
      quatFromAxisAngle(spare, 0, 0, 0, 1, spin.roll ?? 0)
      quatMultiply(turn, 0, spare, 0, clip.rotations, base)
    }
    writeSided(clip.hands, index, key.handL, key.handR, HAND_REST)
    writeSided(clip.feet, index, key.footL, key.footR, FOOT_REST)
    const offset = key.offset ?? ZERO
    for (let axis = 0; axis < 3; axis++) clip.offsets[index * 3 + axis] = offset[axis]!
  })
  return clip
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

/** Writes the clip at a normalised phase. Out of range holds the nearest end. */
export function writeClipPose(
  geometry: RigGeometry,
  clip: PoseClip,
  phase: number,
  scratch: LimbScratch,
  out: Pose,
): void {
  resetPose(out)
  const count = clip.times.length
  const at = clamp(phase, 0, 1)
  let index = count - 2
  for (let i = 0; i < count - 1; i++) {
    if (at <= clip.times[i + 1]!) {
      index = i
      break
    }
  }
  const from = clip.times[index]!
  const span = clip.times[index + 1]! - from
  const raw = span > 0 ? clamp((at - from) / span, 0, 1) : 1
  const t = Math.pow(smoothstep(0, 1, raw), clip.eases[index + 1]!)

  const a = index * Joint.Count * 4
  const b = (index + 1) * Joint.Count * 4
  for (let joint = 0; joint < Joint.Count; joint++) {
    quatNlerp(clip.rotations, a + joint * 4, clip.rotations, b + joint * 4, t, out.rotations, joint * 4)
  }
  for (let axis = 0; axis < 3; axis++) {
    const value = mix(clip.offsets, index * 3 + axis, (index + 1) * 3 + axis, t)
    out.offset[axis] = value * geometry.legLength
  }
  out.offset[1]! += stanceOffset(geometry)

  if (clip.planted) {
    plantFeet(geometry, scratch, out)
  } else {
    resolveTorso(geometry, out, scratch)
    writeClipLeg(geometry, clip, index, t, scratch, out, LEFT, 0)
    writeClipLeg(geometry, clip, index, t, scratch, out, RIGHT, 3)
  }
  writeClipArm(geometry, clip, index, t, scratch, out, LEFT, 0)
  writeClipArm(geometry, clip, index, t, scratch, out, RIGHT, 3)
}

/** A key states each side outright; only the fallback is mirrored across the body. */
function writeSided(into: Float32Array, index: number, left: Vec3 | undefined, right: Vec3 | undefined, rest: Vec3): void {
  for (let axis = 0; axis < 3; axis++) {
    const mirror = axis === 0 ? -1 : 1
    into[index * 6 + axis] = left ? left[axis]! : rest[axis]!
    into[index * 6 + 3 + axis] = right ? right[axis]! : rest[axis]! * mirror
  }
}

function mix(values: Float32Array, from: number, to: number, t: number): number {
  return values[from]! + (values[to]! - values[from]!) * t
}

function writeClipLeg(
  geometry: RigGeometry,
  clip: PoseClip,
  index: number,
  t: number,
  scratch: LimbScratch,
  out: Pose,
  side: number,
  lane: number,
): void {
  const hip = side === LEFT ? Joint.HipL : Joint.HipR
  for (let axis = 0; axis < 3; axis++) {
    const offset = mix(clip.feet, index * 6 + lane + axis, (index + 1) * 6 + lane + axis, t)
    scratch.target[axis] = scratch.positions[hip * 3 + axis]! + offset * geometry.legLength
  }
  writeLeg(geometry, scratch, out, side, 0)
}

function writeClipArm(
  geometry: RigGeometry,
  clip: PoseClip,
  index: number,
  t: number,
  scratch: LimbScratch,
  out: Pose,
  side: number,
  lane: number,
): void {
  const reach = geometry.armLength
  writeArm(
    geometry,
    scratch,
    out,
    side,
    mix(clip.hands, index * 6 + lane, (index + 1) * 6 + lane, t) * reach,
    mix(clip.hands, index * 6 + lane + 1, (index + 1) * 6 + lane + 1, t) * reach,
    mix(clip.hands, index * 6 + lane + 2, (index + 1) * 6 + lane + 2, t) * reach,
  )
}
