import { describe, expect, it } from 'vitest'
import { Joint, JOINT_NAMES, JOINT_PARENT } from '../src/render/procedural/joints'
import {
  blendPose,
  copyPose,
  createPose,
  jointQuat,
  multiplyJoint,
  resetPose,
  setJointAxisAngle,
  setJointQuat,
} from '../src/render/procedural/pose'
import { quatLength, quatRotate, rotationBetween } from '../src/render/procedural/quat'

const scratch = new Float32Array(4)
const vec = new Float32Array(3)

function quatOf(pose: ReturnType<typeof createPose>, joint: Joint): number[] {
  jointQuat(pose, joint, scratch)
  return [...scratch]
}

describe('joint contract', () => {
  it('names every joint exactly once', () => {
    expect(JOINT_NAMES).toHaveLength(Joint.Count)
    expect(new Set(JOINT_NAMES).size).toBe(Joint.Count)
  })

  it('parents every joint above the root, and the root to itself', () => {
    expect(JOINT_PARENT).toHaveLength(Joint.Count)
    expect(JOINT_PARENT[Joint.Root]).toBe(Joint.Root)
    for (let joint = 1; joint < Joint.Count; joint++) {
      expect(JOINT_PARENT[joint]).toBeLessThan(joint)
    }
  })
})

describe('quaternion helpers', () => {
  it('rotates a vector about an axis', () => {
    rotationBetween(1, 0, 0, 0, 0, 1, scratch, 0)
    quatRotate(scratch, 0, 1, 0, 0, vec)
    expect(vec[0]).toBeCloseTo(0, 6)
    expect(vec[1]).toBeCloseTo(0, 6)
    expect(vec[2]).toBeCloseTo(1, 6)
  })

  it('handles the antiparallel case without NaN', () => {
    rotationBetween(0, 1, 0, 0, -1, 0, scratch, 0)
    expect(quatLength(scratch, 0)).toBeCloseTo(1, 6)
    quatRotate(scratch, 0, 0, 1, 0, vec)
    expect(vec[1]).toBeCloseTo(-1, 6)
  })

  it('returns identity for parallel directions', () => {
    rotationBetween(0, 0, 2, 0, 0, 5, scratch, 0)
    expect([...scratch]).toEqual([0, 0, 0, 1])
  })

  it('never produces NaN for a zero-length input', () => {
    rotationBetween(0, 0, 0, 0, 0, 1, scratch, 0)
    expect(Number.isFinite(quatLength(scratch, 0))).toBe(true)
  })
})

describe('pose', () => {
  it('starts as identity rotations with no root offset', () => {
    const pose = createPose()
    expect(pose.rotations).toHaveLength(Joint.Count * 4)
    for (let joint = 0; joint < Joint.Count; joint++) {
      expect(quatOf(pose, joint)).toEqual([0, 0, 0, 1])
    }
    expect([...pose.offset]).toEqual([0, 0, 0])
    expect(pose.yaw[0]).toBe(0)
  })

  it('resets in place without replacing its buffers', () => {
    const pose = createPose()
    const rotations = pose.rotations
    setJointAxisAngle(pose, Joint.Chest, 0, 1, 0, 0.5)
    pose.offset[1] = 3
    pose.yaw[0] = 1
    resetPose(pose)
    expect(pose.rotations).toBe(rotations)
    expect(quatOf(pose, Joint.Chest)).toEqual([0, 0, 0, 1])
    expect(pose.offset[1]).toBe(0)
    expect(pose.yaw[0]).toBe(0)
  })

  it('multiplies an additive layer onto a joint', () => {
    const pose = createPose()
    setJointAxisAngle(pose, Joint.Head, 0, 1, 0, 0.3)
    multiplyJoint(pose, Joint.Head, 0, Math.sin(0.1), 0, Math.cos(0.1))
    jointQuat(pose, Joint.Head, scratch)
    expect(quatLength(scratch, 0)).toBeCloseTo(1, 6)
    expect(2 * Math.atan2(scratch[1]!, scratch[3]!)).toBeCloseTo(0.5, 6)
  })

  it('blends between two poses without allocating a third', () => {
    const a = createPose()
    const b = createPose()
    const out = createPose()
    setJointAxisAngle(a, Joint.Spine, 0, 1, 0, 0)
    setJointAxisAngle(b, Joint.Spine, 0, 1, 0, 1)
    b.offset[1] = 2
    b.yaw[0] = 4
    const buffer = out.rotations
    blendPose(a, b, 0.5, out)
    expect(out.rotations).toBe(buffer)
    jointQuat(out, Joint.Spine, scratch)
    expect(2 * Math.atan2(scratch[1]!, scratch[3]!)).toBeCloseTo(0.5, 3)
    expect(out.offset[1]).toBeCloseTo(1, 6)
    expect(out.yaw[0]).toBeCloseTo(2, 6)
  })

  it('copies one pose over another', () => {
    const a = createPose()
    const b = createPose()
    setJointQuat(a, Joint.FootR, 0, 0, 1, 0)
    a.offset[2] = 7
    copyPose(a, b)
    expect(quatOf(b, Joint.FootR)).toEqual([0, 0, 1, 0])
    expect(b.offset[2]).toBe(7)
  })
})
