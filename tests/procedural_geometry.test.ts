import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {buildRigGeometry, KAYKIT_KNIGHT_GEOMETRY, KAYKIT_KNIGHT_JOINTS, KAYKIT_KNIGHT_STANDING_HEIGHT, restDirection, restPosition,  } from '../src/render/procedural/geometry'
import { Joint, JOINT_NAMES } from '../src/render/procedural/joints'
import { createPose, setJointAxisAngle, resolvePositions } from '../src/render/procedural/pose'
import { extractRigGeometry } from '../scripts/extract-rig-geometry.mjs'

const PLAYER = join(import.meta.dirname, '..', 'public', 'models', 'player.glb')
const scratch = new Float32Array(3)
const positions = new Float32Array(Joint.Count * 3)

describe('rig geometry', () => {
  it('carries a rest position for every required joint', () => {
    for (let joint = 0; joint < Joint.Count; joint++) {
      restPosition(KAYKIT_KNIGHT_GEOMETRY, joint, scratch)
      expect(Number.isFinite(scratch[0]! + scratch[1]! + scratch[2]!), JOINT_NAMES[joint]).toBe(true)
    }
  })

  it('derives limb lengths from the rest positions', () => {
    const g = KAYKIT_KNIGHT_GEOMETRY
    expect(g.thigh).toBeCloseTo(0.2271, 3)
    expect(g.shin).toBeCloseTo(0.1494, 3)
    expect(g.legLength).toBeCloseTo(g.thigh + g.shin, 6)
    expect(g.upperArm).toBeCloseTo(0.2415, 3)
    expect(g.foreArm).toBeCloseTo(0.3336, 3)
    expect(g.hipHeight).toBeCloseTo(0.5193, 3)
    expect(g.ankleHeight).toBeCloseTo(0.1452, 3)
    expect(g.hipWidth).toBeCloseTo(0.1709, 3)
  })

  /**
   * The knight is a chibi: a leg of 0.48 of its measured height would be longer
   * than everything above its hips, so the body's own frame is what caps it.
   */
  it('caps its nominal leg at the frame it hangs off', () => {
    const g = KAYKIT_KNIGHT_GEOMETRY
    expect(g.standingHeight).toBeCloseTo(2.3145, 3)
    expect(g.nominalLegLength).toBeLessThan(g.standingHeight * 0.48)
    expect(g.nominalLegLength).toBeCloseTo(g.legLength + (g.height - g.hipHeight), 6)
  })

  it('scales every length by the same factor', () => {
    const doubled = buildRigGeometry(KAYKIT_KNIGHT_JOINTS, 2, KAYKIT_KNIGHT_STANDING_HEIGHT)
    expect(doubled.legLength).toBeCloseTo(KAYKIT_KNIGHT_GEOMETRY.legLength * 2, 6)
    expect(doubled.nominalLegLength).toBeCloseTo(KAYKIT_KNIGHT_GEOMETRY.nominalLegLength * 2, 6)
    expect(doubled.hipHeight).toBeCloseTo(KAYKIT_KNIGHT_GEOMETRY.hipHeight * 2, 6)
    restPosition(doubled, Joint.Head, scratch)
    expect(scratch[1]).toBeCloseTo(KAYKIT_KNIGHT_GEOMETRY.height * 2, 5)
  })

  it('points each rest direction at its child, and leaves along their own bone', () => {
    restDirection(KAYKIT_KNIGHT_GEOMETRY, Joint.HipL, scratch)
    expect(scratch[1]).toBeLessThan(-0.99)
    restDirection(KAYKIT_KNIGHT_GEOMETRY, Joint.ShoulderL, scratch)
    expect(scratch[0]).toBeGreaterThan(0.99)
    restDirection(KAYKIT_KNIGHT_GEOMETRY, Joint.Head, scratch)
    expect(scratch[1]).toBeCloseTo(1, 6)
    restDirection(KAYKIT_KNIGHT_GEOMETRY, Joint.FootL, scratch)
    expect(scratch[2]).toBeCloseTo(1, 6)
  })
})

describe('forward kinematics from absolute rotations', () => {
  it('reproduces the rest pose when every rotation is identity', () => {
    const pose = createPose()
    resolvePositions(KAYKIT_KNIGHT_GEOMETRY, pose, positions)
    for (let joint = 0; joint < Joint.Count; joint++) {
      restPosition(KAYKIT_KNIGHT_GEOMETRY, joint, scratch)
      for (let axis = 0; axis < 3; axis++) {
        expect(positions[joint * 3 + axis], JOINT_NAMES[joint]).toBeCloseTo(scratch[axis]!, 6)
      }
    }
  })

  it('carries the root offset to every joint', () => {
    const pose = createPose()
    pose.offset[1] = -0.05
    resolvePositions(KAYKIT_KNIGHT_GEOMETRY, pose, positions)
    restPosition(KAYKIT_KNIGHT_GEOMETRY, Joint.FootR, scratch)
    expect(positions[Joint.FootR * 3 + 1]).toBeCloseTo(scratch[1]! - 0.05, 6)
  })

  it('swings a child when its parent rotates, without moving the parent', () => {
    const pose = createPose()
    setJointAxisAngle(pose, Joint.HipL, 1, 0, 0, Math.PI / 2)
    resolvePositions(KAYKIT_KNIGHT_GEOMETRY, pose, positions)
    restPosition(KAYKIT_KNIGHT_GEOMETRY, Joint.HipL, scratch)
    expect(positions[Joint.HipL * 3 + 1]).toBeCloseTo(scratch[1]!, 6)
    // A quarter turn about +X takes the thigh from pointing down to pointing back.
    expect(positions[Joint.KneeL * 3 + 2]).toBeCloseTo(scratch[2]! - KAYKIT_KNIGHT_GEOMETRY.thigh, 2)
    expect(Math.abs(positions[Joint.KneeL * 3 + 1]! - scratch[1]!)).toBeLessThan(0.02)
  })
})

describe('the committed KayKit fixture', () => {
  const fetched = existsSync(PLAYER)
  it.skipIf(!fetched)('matches the bind pose in player.glb', () => {
    const extracted = extractRigGeometry(readFileSync(PLAYER))
    const committed = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', 'src', 'render', 'procedural', 'fixtures', 'kaykit_knight.json'), 'utf8'),
    ) as { joints: Record<string, number[]>; standingHeight: number }
    expect(committed.joints).toEqual(extracted.joints)
    expect(committed.standingHeight).toEqual(extracted.standingHeight)
  })
})
