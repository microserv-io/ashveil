import { heelOffset, toeOffset } from '../../src/render/procedural/foot'
import {type RigGeometry } from '../../src/render/procedural/geometry'
import { resolvePositions } from '../../src/render/procedural/pose'
import { Joint, LEFT } from '../../src/render/procedural/joints'
import type { Pose } from '../../src/render/procedural/pose'
import { quatRotate } from '../../src/render/procedural/quat'

/**
 * What a posed body is standing on, read back out of the pose by forward
 * kinematics. A stance foot rolls, so the ankle moves through stance and the
 * thing that must hold still is the contact under it.
 */
export interface Contact {
  /** Where the heel is, in the body frame. */
  readonly heel: Float32Array
  /** Where the foot breaks over at toe-off. */
  readonly toe: Float32Array
  /** How far the foot is tipped: negative up onto the heel, positive over the ball. */
  readonly pitch: number
}

const UP = new Float32Array(3)
const OFFSET = new Float32Array(3)

export function footContact(geometry: RigGeometry, pose: Pose, side: number): Contact {
  const positions = new Float32Array(Joint.Count * 3)
  resolvePositions(geometry, pose, positions)
  const foot = side === LEFT ? Joint.FootL : Joint.FootR
  quatRotate(pose.rotations, foot * 4, 0, 1, 0, UP)
  return {
    heel: contact(geometry, pose, positions, foot, -heelOffset(geometry)),
    toe: contact(geometry, pose, positions, foot, toeOffset(geometry)),
    pitch: Math.atan2(UP[2]!, UP[1]!),
  }
}

function contact(
  geometry: RigGeometry,
  pose: Pose,
  positions: Float32Array,
  foot: Joint,
  lever: number,
): Float32Array {
  quatRotate(pose.rotations, foot * 4, 0, -geometry.ankleHeight, lever, OFFSET)
  return new Float32Array([
    positions[foot * 3]! + OFFSET[0]!,
    positions[foot * 3 + 1]! + OFFSET[1]!,
    positions[foot * 3 + 2]! + OFFSET[2]!,
  ])
}
