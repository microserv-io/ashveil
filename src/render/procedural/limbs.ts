import { resolvePositions, restDirection, type RigGeometry } from './geometry'
import { createTwoBoneChain, solveTwoBone, type TwoBoneChain } from './ik'
import { Joint, LEFT, RIGHT } from './joints'
import { copyJointFrom, setJointAxisAngle, type Pose } from './pose'
import { quatFromAxisAngle, quatMultiply } from './quat'

/**
 * Per-body scratch shared by everything that writes a pose. One of these lives as
 * long as the body, which is what keeps the frame path free of allocation.
 */
export interface LimbScratch {
  readonly leg: TwoBoneChain
  readonly arm: TwoBoneChain
  /** Body-frame joint positions under the pose written so far. */
  readonly positions: Float32Array
  /** Where the next foot goes, in the body frame. */
  readonly target: Float32Array
  readonly quat: Float32Array
  readonly spare: Float32Array
}

export function createLimbScratch(): LimbScratch {
  return {
    leg: createTwoBoneChain(),
    arm: createTwoBoneChain(),
    positions: new Float32Array(Joint.Count * 3),
    target: new Float32Array(3),
    quat: new Float32Array(4),
    spare: new Float32Array(4),
  }
}

/** The knee leads forward and the elbow trails back, which is what makes a body read as a body. */
const KNEE_POLE_SIDE = 0.15
const ELBOW_POLE_SIDE = 0.35
/** Hip height while a body simply stands on its feet, as a fraction of leg length. */
const STANCE_HIP = 0.94

/** Root offset that stands the skeleton on its feet with a knee it can still bend. */
export function stanceOffset(geometry: RigGeometry): number {
  return geometry.ankleHeight + geometry.legLength * STANCE_HIP - geometry.hipHeight
}

/** Both feet flat under the hips: the base every rooted pose stands on. */
export function plantFeet(geometry: RigGeometry, scratch: LimbScratch, out: Pose): void {
  resolveTorso(geometry, out, scratch)
  plantLeg(geometry, scratch, out, LEFT)
  plantLeg(geometry, scratch, out, RIGHT)
}

/** One foot flat under its own hip, wherever the torso above it went. */
export function plantLeg(geometry: RigGeometry, scratch: LimbScratch, out: Pose, side: number): void {
  scratch.target[0] = side * geometry.hipWidth
  scratch.target[1] = geometry.ankleHeight
  scratch.target[2] = 0
  writeLeg(geometry, scratch, out, side, 0)
}

/**
 * Torso and hips must be written before the limbs: the legs and arms hang off
 * wherever the pelvis and chest actually ended up, and this is what tells them.
 */
export function resolveTorso(geometry: RigGeometry, pose: Pose, scratch: LimbScratch): void {
  resolvePositions(geometry, pose, scratch.positions)
}

/** Yaw about +Y, then pitch about +X, then roll about +Z, composed into one joint. */
export function writeTorso(out: Pose, joint: Joint, pitch: number, yaw: number, roll: number, scratch: LimbScratch): void {
  quatFromAxisAngle(scratch.quat, 0, 0, 1, 0, yaw)
  quatFromAxisAngle(scratch.spare, 0, 1, 0, 0, pitch)
  quatMultiply(scratch.quat, 0, scratch.spare, 0, scratch.quat, 0)
  quatFromAxisAngle(scratch.spare, 0, 0, 0, 1, roll)
  quatMultiply(scratch.quat, 0, scratch.spare, 0, out.rotations, joint * 4)
}

/** Solves one leg onto `scratch.target` and pitches the foot. */
export function writeLeg(geometry: RigGeometry, scratch: LimbScratch, out: Pose, side: number, footPitch: number): void {
  const hip = side === LEFT ? Joint.HipL : Joint.HipR
  const knee = side === LEFT ? Joint.KneeL : Joint.KneeR
  const foot = side === LEFT ? Joint.FootL : Joint.FootR
  const chain = scratch.leg
  chain.upperLength = geometry.thigh
  chain.lowerLength = geometry.shin
  restDirection(geometry, hip, chain.restUpper)
  restDirection(geometry, knee, chain.restLower)
  for (let axis = 0; axis < 3; axis++) {
    chain.root[axis] = scratch.positions[hip * 3 + axis]!
    chain.target[axis] = scratch.target[axis]!
  }
  chain.pole[0] = side * KNEE_POLE_SIDE
  chain.pole[1] = 0
  chain.pole[2] = 1
  solveTwoBone(chain, out.rotations, hip * 4, knee * 4)
  setJointAxisAngle(out, foot, 1, 0, 0, footPitch)
}

/**
 * Solves one arm onto a hand target given relative to that shoulder, so callers
 * never have to know where the shoulder drifted to. The hand follows the forearm.
 */
export function writeArm(
  geometry: RigGeometry,
  scratch: LimbScratch,
  out: Pose,
  side: number,
  dx: number,
  dy: number,
  dz: number,
): void {
  const shoulder = side === LEFT ? Joint.ShoulderL : Joint.ShoulderR
  const elbow = side === LEFT ? Joint.ElbowL : Joint.ElbowR
  const hand = side === LEFT ? Joint.HandL : Joint.HandR
  const chain = scratch.arm
  chain.upperLength = geometry.upperArm
  chain.lowerLength = geometry.foreArm
  restDirection(geometry, shoulder, chain.restUpper)
  restDirection(geometry, elbow, chain.restLower)
  for (let axis = 0; axis < 3; axis++) chain.root[axis] = scratch.positions[shoulder * 3 + axis]!
  chain.target[0] = chain.root[0]! + dx
  chain.target[1] = chain.root[1]! + dy
  chain.target[2] = chain.root[2]! + dz
  chain.pole[0] = side * ELBOW_POLE_SIDE
  chain.pole[1] = 0
  chain.pole[2] = -1
  solveTwoBone(chain, out.rotations, shoulder * 4, elbow * 4)
  copyJointFrom(out, hand, elbow)
}
