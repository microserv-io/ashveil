import { clamp, ease, mix } from './curves'
import { gatherOffset } from './gather'
import type { RigGeometry } from './geometry'
import { Joint, LEFT, RIGHT } from './joints'
import { plantLeg, resolveTorso, stanceOffset, writeArm, writeLeg, type LimbScratch } from './limbs'
import { resetPose, type Pose } from './pose'
import { quatNlerp } from './quat'
import type { PoseClip } from './posekeys'

/**
 * Playing a compiled pose clip onto a body: interpolate the keys either side of
 * the phase, then solve the limbs onto the targets that come out. The format the
 * keys are written in lives in `posekeys.ts`.
 */
/** Writes the clip at a normalised phase. Out of range holds the nearest end. */
export function writeClipPose(
  geometry: RigGeometry,
  clip: PoseClip,
  phase: number,
  scratch: LimbScratch,
  out: Pose,
  time = 0,
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
  const t = ease(raw, clip.eases[index + 1]!)

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

  resolveTorso(geometry, out, scratch)
  writeClipFoot(geometry, clip, index, t, scratch, out, LEFT, 0)
  writeClipFoot(geometry, clip, index, t, scratch, out, RIGHT, 3)
  writeClipArm(geometry, clip, at, time, index, t, scratch, out, LEFT, 0)
  writeClipArm(geometry, clip, at, time, index, t, scratch, out, RIGHT, 3)
}

/** A stated foot is solved onto its target; an unstated one stands where it is. */
function writeClipFoot(
  geometry: RigGeometry,
  clip: PoseClip,
  index: number,
  t: number,
  scratch: LimbScratch,
  out: Pose,
  side: number,
  lane: number,
): void {
  if (clip.planted && !clip.steps[side === LEFT ? 0 : 1]!) return plantLeg(geometry, scratch, out, side)
  writeClipLeg(geometry, clip, index, t, scratch, out, side, lane)
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
    KNEE_POLE[axis] = mix(clip.kneePoles, index * 6 + lane + axis, (index + 1) * 6 + lane + axis, t)
  }
  writeLeg(geometry, scratch, out, side, 0, KNEE_POLE)
}

function writeClipArm(
  geometry: RigGeometry,
  clip: PoseClip,
  phase: number,
  time: number,
  index: number,
  t: number,
  scratch: LimbScratch,
  out: Pose,
  side: number,
  lane: number,
): void {
  const reach = geometry.armLength
  let handY = mix(clip.hands, index * 6 + lane + 1, (index + 1) * 6 + lane + 1, t)
  let handZ = mix(clip.hands, index * 6 + lane + 2, (index + 1) * 6 + lane + 2, t)
  if (clip.gather !== null) {
    gatherOffset(clip.gather, phase, time, side, GATHER_OFFSET)
    handY += GATHER_OFFSET[0]!
    handZ += GATHER_OFFSET[1]!
  }
  for (let axis = 0; axis < 3; axis++) {
    POLE[axis] = mix(clip.poles, index * 6 + lane + axis, (index + 1) * 6 + lane + axis, t)
  }
  writeArm(
    geometry,
    scratch,
    out,
    side,
    mix(clip.hands, index * 6 + lane, (index + 1) * 6 + lane, t) * reach,
    handY * reach,
    handZ * reach,
    POLE,
  )
}

/** Module-level because writing a clip pose is on the frame path and must not allocate. */
const POLE = new Float32Array(3)
const KNEE_POLE = new Float32Array(3)
const GATHER_OFFSET = new Float32Array(2)
