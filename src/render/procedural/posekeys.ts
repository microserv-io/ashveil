import { CARRY_HAND } from './arms'
import { Joint } from './joints'
import { KNEE_POLE_SIDE, STANCE_HIP } from './limbs'
import { quatFromAxisAngle, quatIdentity, quatMultiply } from './quat'

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
  /** Where the elbow leads. Without one it trails back and out, which is a body at rest. */
  readonly poleL?: Vec3
  readonly poleR?: Vec3
  readonly footL?: Vec3
  readonly footR?: Vec3
  /** Where the knee leads. Without one it bends forward, the way a standing leg does. */
  readonly kneeL?: Vec3
  readonly kneeR?: Vec3
  readonly offset?: Vec3
}

export interface PoseClipSource {
  /** True keeps a foot flat under its own hip unless a key states where it steps. */
  readonly planted: boolean
  readonly loop?: boolean
  readonly keys: readonly PoseKey[]
}

const ZERO: Vec3 = [0, 0, 0]
/** The elbow's resting lead: back and a little outward, the way an arm hangs. */
const ELBOW_REST: Vec3 = [0.35, 0, -1]
/** The hand's resting place beside the body: the carry locomotion holds it in. */
const HAND_REST: Vec3 = CARRY_HAND
/** The foot's resting place under the hip, in leg lengths: on the ground it stands on. */
const FOOT_REST: Vec3 = [0, -STANCE_HIP, 0]
/** The knee's resting lead: forward, a little outward. */
const KNEE_REST: Vec3 = [KNEE_POLE_SIDE, 0, 1]
/** The clip is stored compiled: quaternions and targets, ready to interpolate. */
export interface PoseClip {
  readonly planted: boolean
  readonly loop: boolean
  /** Sides some key states a foot for. A planted clip leaves the others where they stand. */
  readonly steps: readonly [boolean, boolean]
  readonly times: Float32Array
  /** `keys * Joint.Count * 4`. */
  readonly rotations: Float32Array
  readonly eases: Float32Array
  /** `keys * 3` per side. */
  readonly hands: Float32Array
  readonly poles: Float32Array
  readonly feet: Float32Array
  readonly kneePoles: Float32Array
  readonly offsets: Float32Array
}

export function compilePoseClip(source: PoseClipSource): PoseClip {
  const count = source.keys.length
  const clip: PoseClip = {
    planted: source.planted,
    loop: source.loop ?? false,
    steps: [source.keys.some((key) => key.footL), source.keys.some((key) => key.footR)],
    times: new Float32Array(count),
    rotations: new Float32Array(count * Joint.Count * 4),
    eases: new Float32Array(count),
    hands: new Float32Array(count * 6),
    poles: new Float32Array(count * 6),
    feet: new Float32Array(count * 6),
    kneePoles: new Float32Array(count * 6),
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
    writeSided(clip.poles, index, key.poleL, key.poleR, ELBOW_REST)
    writeSided(clip.feet, index, key.footL, key.footR, FOOT_REST)
    writeSided(clip.kneePoles, index, key.kneeL, key.kneeR, KNEE_REST)
    const offset = key.offset ?? ZERO
    for (let axis = 0; axis < 3; axis++) clip.offsets[index * 3 + axis] = offset[axis]!
  })
  return clip
}

/** A key states each side outright; only the fallback is mirrored across the body. */
function writeSided(into: Float32Array, index: number, left: Vec3 | undefined, right: Vec3 | undefined, rest: Vec3): void {
  for (let axis = 0; axis < 3; axis++) {
    const mirror = axis === 0 ? -1 : 1
    into[index * 6 + axis] = left ? left[axis]! : rest[axis]!
    into[index * 6 + 3 + axis] = right ? right[axis]! : rest[axis]! * mirror
  }
}
