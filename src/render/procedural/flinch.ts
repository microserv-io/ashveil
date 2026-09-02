import { HIT_FLASH_DURATION } from '../../sim/types'
import { clamp } from './curves'
import { Joint } from './joints'
import { multiplyJoint, type Pose } from './pose'
import { quatFromAxisAngle } from './quat'

/**
 * The hit reaction, as a layer rather than a state: a body that is walking or
 * mid-swing when it is hit keeps doing that, with a recoil laid over the top. The
 * sim decides nothing here — `hitAge` is read straight off the same flash timer
 * the material tint uses, so the flinch and the flash end together.
 */
const CHEST_RECOIL = 0.3
const SPINE_RECOIL = 0.15
const HEAD_RECOIL = 0.42
/** Every body twists a little differently, so a struck pack does not move as one. */
const TWIST = 0.35
const GOLDEN = 0.6180339887498949

export function applyFlinch(pose: Pose, hitAge: number | null, seed: number): void {
  if (hitAge === null || hitAge >= HIT_FLASH_DURATION || hitAge < 0) return
  // Snaps in and eases out, which is what a body struck hard actually does.
  const remaining = 1 - clamp(hitAge / HIT_FLASH_DURATION, 0, 1)
  const weight = remaining * remaining
  const twist = (fract(seed * GOLDEN) * 2 - 1) * TWIST

  recoil(pose, Joint.Spine, SPINE_RECOIL * weight, twist * weight * 0.4)
  recoil(pose, Joint.Chest, CHEST_RECOIL * weight, twist * weight)
  recoil(pose, Joint.Head, HEAD_RECOIL * weight, twist * weight * 1.4)
}

const LAYER = new Float32Array(4)

/** Pitches the joint back and twists it, on top of whatever the base pose said. */
function recoil(pose: Pose, joint: Joint, pitch: number, twist: number): void {
  quatFromAxisAngle(LAYER, 0, -1, twist, 0, pitch)
  multiplyJoint(pose, joint, LAYER[0]!, LAYER[1]!, LAYER[2]!, LAYER[3]!)
}

function fract(value: number): number {
  return value - Math.floor(value)
}
