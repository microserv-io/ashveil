import { join } from 'node:path'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { armPace, type ArmPace } from '../src/render/procedural/armpace'
import { writeCarriedArm } from '../src/render/procedural/arms'
import { footRoll, heelOffset, toeOffset } from '../src/render/procedural/foot'
import { createGaitState } from '../src/render/procedural/gait'
import type { RigGeometry } from '../src/render/procedural/geometry'
import { Joint, LEFT, RIGHT } from '../src/render/procedural/joints'
import { plantFeet, writeTorso } from '../src/render/procedural/limbs'
import { createPose, resetPose, resolvePositions, setJointAxisAngle, type Pose } from '../src/render/procedural/pose'
import { quatRotate } from '../src/render/procedural/quat'
import { MASCULINE_PROFILE } from '../src/render/profiles/masculine'
import { bindSkeleton } from '../src/render/semanticskeleton'
import { HUMAN, MASCULINE } from './fixtures/bodies'
import { loadGlbSkeleton } from './fixtures/glbskeleton'

/**
 * What a positive number does to a body, measured off the body rather than argued
 * from a quaternion. The same table is written at the top of `joints.ts`; this is
 * what holds it to the truth.
 *
 * Every assertion here is a landmark moving in the body frame: a hand going
 * forward, a heel coming off the floor. Signs are where this pipeline has gone
 * wrong most often — an arm crossing outward instead of in, a pelvis leading the
 * wrong leg — and each of those was invisible in the maths and obvious the moment
 * something measured where the hand actually went.
 */

/** Enough movement to be unambiguous, small enough to stay in the linear part of it. */
const TURN = 0.3
const SWING = 0.6
/** Anything smaller than this is the pose not answering at all. */
const CLEAR = 0.01

const state = createGaitState()
const pose = createPose()
const positions = new Float32Array(Joint.Count * 3)
const rotated = new Float32Array(3)

/** A body standing on its feet, which every case starts from. */
function stand(geometry: RigGeometry): void {
  resetPose(pose)
  plantFeet(geometry, state, pose)
}

function place(geometry: RigGeometry, joint: Joint): [number, number, number] {
  resolvePositions(geometry, pose, positions)
  return [positions[joint * 3]!, positions[joint * 3 + 1]!, positions[joint * 3 + 2]!]
}

/** Where the heel sits under the foot's own rotation, which is what a roll lifts. */
function heel(geometry: RigGeometry, foot: Joint): number {
  resolvePositions(geometry, pose, positions)
  quatRotate(pose.rotations, foot * 4, 0, -geometry.ankleHeight, -heelOffset(geometry), rotated)
  return positions[foot * 3 + 1]! + rotated[1]!
}

function arm(geometry: RigGeometry, side: number, swing: number, pace: ArmPace): [number, number, number] {
  stand(geometry)
  writeCarriedArm(geometry, state, pose, side, swing, pace)
  return place(geometry, side === LEFT ? Joint.HandL : Joint.HandR)
}

describe.each([['human', HUMAN], ['masculine-v3', MASCULINE]] as const)('%s: what a positive number does', (_body, geometry) => {
  const pace = armPace(geometry, 0)

  describe.each([['left', LEFT] as const, ['right', RIGHT] as const])('the %s arm', (_side, side) => {
    const outward = side === LEFT ? 1 : -1

    it('swings the hand forward', () => {
      const rest = arm(geometry, side, 0, pace)
      const swung = arm(geometry, side, SWING, pace)
      expect(swung[2] - rest[2], 'a positive swing put the hand behind the body').toBeGreaterThan(CLEAR)
      const back = arm(geometry, side, -SWING, pace)
      expect(back[2] - rest[2], 'a negative swing put the hand in front of the body').toBeLessThan(-CLEAR)
    })

    it('abducts the hand away from the centre line', () => {
      const rest = arm(geometry, side, 0, pace)
      const wide = arm(geometry, side, 0, { ...pace, out: pace.out + TURN })
      expect((wide[0] - rest[0]) * outward, 'a positive abduction pulled the arm in').toBeGreaterThan(CLEAR)
    })

    it('crosses the hand towards the centre line', () => {
      const forward = arm(geometry, side, 1, pace)
      const crossed = arm(geometry, side, 1, { ...pace, cross: pace.cross + TURN })
      expect((crossed[0] - forward[0]) * outward, 'a positive crossing swung the arm out').toBeLessThan(-CLEAR)
    })

    it('bends the elbow so the hand comes up and forward', () => {
      const rest = arm(geometry, side, 0, pace)
      const bent = arm(geometry, side, 0, { ...pace, bend: pace.bend + 0.5 })
      expect(bent[1] - rest[1], 'a positive bend dropped the hand').toBeGreaterThan(CLEAR)
      expect(bent[2] - rest[2], 'a positive bend put the hand behind the body').toBeGreaterThan(CLEAR)
    })
  })

  it('swings a leg back about +X, so flexion is negative', () => {
    stand(geometry)
    const planted = place(geometry, Joint.FootL)
    stand(geometry)
    setJointAxisAngle(pose, Joint.HipL, 1, 0, 0, TURN)
    const back = place(geometry, Joint.FootL)
    expect(back[2] - planted[2], 'a positive turn at the hip put the foot in front').toBeLessThan(-CLEAR)
    stand(geometry)
    setJointAxisAngle(pose, Joint.HipL, 1, 0, 0, -TURN)
    const forward = place(geometry, Joint.FootL)
    expect(forward[2] - planted[2], 'hip flexion is not a negative turn about +X').toBeGreaterThan(CLEAR)
  })

  it('folds the knee so the foot goes back and up', () => {
    stand(geometry)
    const planted = place(geometry, Joint.FootL)
    stand(geometry)
    setJointAxisAngle(pose, Joint.KneeL, 1, 0, 0, TURN)
    const folded = place(geometry, Joint.FootL)
    expect(folded[2] - planted[2], 'a positive knee bend kicked the foot forward').toBeLessThan(-CLEAR)
    expect(folded[1] - planted[1], 'a positive knee bend drove the foot down').toBeGreaterThan(0)
  })

  it('turns the body to its left about +Y, so the left hip goes back', () => {
    stand(geometry)
    const left = place(geometry, Joint.HipL)
    const right = place(geometry, Joint.HipR)
    stand(geometry)
    writeTorso(pose, Joint.Pelvis, 0, TURN, 0, state)
    const turned = place(geometry, Joint.HipL)
    const other = place(geometry, Joint.HipR)
    expect(turned[2] - left[2], 'a positive pelvis yaw carried the left hip forward').toBeLessThan(-CLEAR * 0.5)
    expect(other[2] - right[2], 'a positive pelvis yaw did not carry the right hip forward').toBeGreaterThan(CLEAR * 0.5)
  })

  it('tips the head forward on a positive chest pitch', () => {
    stand(geometry)
    const level = place(geometry, Joint.Head)
    stand(geometry)
    writeTorso(pose, Joint.Chest, TURN, 0, 0, state)
    const tipped = place(geometry, Joint.Head)
    expect(tipped[2] - level[2], 'a positive chest pitch leaned the body backwards').toBeGreaterThan(CLEAR)
  })

  it('lifts the heel on a positive foot roll', () => {
    stand(geometry)
    const flat = heel(geometry, Joint.FootL)
    stand(geometry)
    setJointAxisAngle(pose, Joint.FootL, 1, 0, 0, TURN)
    expect(heel(geometry, Joint.FootL) - flat, 'a positive foot pitch drove the heel down').toBeGreaterThan(CLEAR)
  })

  it('rolls onto the heel ahead of the hip and the toe behind it', () => {
    const roll = new Float32Array(2)
    const ahead = footRoll(geometry, 1, roll)
    expect(ahead, 'the foot ahead of the hip is not tipped onto its heel').toBeLessThan(0)
    expect(roll[0], 'the heel strike did not lift the ankle').toBeGreaterThan(0)
    const behind = footRoll(geometry, -1, roll)
    expect(behind, 'the foot behind the hip is not tipped over its toe').toBeGreaterThan(0)
    expect(roll[0], 'the toe-off did not lift the ankle').toBeGreaterThan(0)
    expect(toeOffset(geometry), 'the toe is not ahead of the ankle').toBeGreaterThan(0)
  })

  it('carries the whole body forward on a positive root offset', () => {
    stand(geometry)
    const home = place(geometry, Joint.Pelvis)
    resetPose(pose)
    pose.offset[2] = 0.1
    plantFeet(geometry, state, pose)
    const moved = place(geometry, Joint.Pelvis)
    expect(moved[2] - home[2], 'a positive root offset moved the body backwards').toBeCloseTo(0.1, 6)
  })
})

/**
 * The same signs once the pose is on a real skeleton: the binding turns absolute
 * body-frame rotations into bone-local ones, and a mirrored axis correction there
 * would flip a sign without any of the above noticing.
 */
describe('masculine-v3 through the binding', () => {
  const MASCULINE_GLB = join(import.meta.dirname, '..', 'public', 'bodies', 'masculine-v3', 'masculine-v3.glb')

  function bound(): { body: THREE.Object3D; apply: (pose: Pose) => void } {
    const body = loadGlbSkeleton(MASCULINE_GLB)
    const skeleton = bindSkeleton(body, MASCULINE_PROFILE)
    return { body, apply: (pose: Pose) => skeleton.apply(pose) }
  }

  function world(body: THREE.Object3D, bone: string): THREE.Vector3 {
    body.updateMatrixWorld(true)
    return body.getObjectByName(bone)!.getWorldPosition(new THREE.Vector3())
  }

  it('swings a hand forward in world space on a positive swing', () => {
    const { body, apply } = bound()
    const pace = armPace(MASCULINE, 0)
    stand(MASCULINE)
    writeCarriedArm(MASCULINE, state, pose, RIGHT, 0, pace)
    apply(pose)
    const rest = world(body, 'hand_R')
    stand(MASCULINE)
    writeCarriedArm(MASCULINE, state, pose, RIGHT, SWING, pace)
    apply(pose)
    expect(world(body, 'hand_R').z - rest.z, 'the binding swung the hand the other way').toBeGreaterThan(CLEAR)
  })

  it('tips the head forward in world space on a positive chest pitch', () => {
    const { body, apply } = bound()
    stand(MASCULINE)
    apply(pose)
    const level = world(body, 'head')
    stand(MASCULINE)
    writeTorso(pose, Joint.Chest, TURN, 0, 0, state)
    apply(pose)
    expect(world(body, 'head').z - level.z, 'the binding tipped the head backwards').toBeGreaterThan(CLEAR)
  })

  it('carries the body forward in world space on a positive root offset', () => {
    const { body, apply } = bound()
    stand(MASCULINE)
    apply(pose)
    const home = world(body, 'pelvis')
    resetPose(pose)
    pose.offset[2] = 0.1
    plantFeet(MASCULINE, state, pose)
    apply(pose)
    expect(world(body, 'pelvis').z - home.z, 'the binding moved the body backwards').toBeCloseTo(0.1, 3)
  })
})
