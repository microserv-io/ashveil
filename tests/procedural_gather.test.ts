import { describe, expect, it } from 'vitest'
import { createGaitState } from '../src/render/procedural/gait'
import { Joint } from '../src/render/procedural/joints'
import { createPose, resolvePositions, type Pose } from '../src/render/procedural/pose'
import { compilePoseClip, type PoseClipSource } from '../src/render/procedural/posekeys'
import { writeClipPose } from '../src/render/procedural/poses'
import { quatAngleBetween } from '../src/render/procedural/quat'
import { DT } from '../src/sim/types'
import { MASCULINE } from './fixtures/bodies'

const PHASE = 0.25
const SOURCE: PoseClipSource = {
  planted: true,
  gather: { radius: 0.12, period: 0.7, until: 0.42 },
  keys: [
    { at: 0, handL: [0.1, -0.6, 0.35], handR: [-0.1, -0.6, 0.35] },
    { at: 1, handL: [0.1, -0.6, 0.35], handR: [-0.1, -0.6, 0.35] },
  ],
}
const CLIP = compilePoseClip(SOURCE)
const state = createGaitState()

function sample(phase: number, time: number): Pose {
  const pose = createPose()
  writeClipPose(MASCULINE, CLIP, phase, state, pose, time)
  return pose
}

function handPositions(pose: Pose): Float32Array {
  const positions = new Float32Array(Joint.Count * 3)
  resolvePositions(MASCULINE, pose, positions)
  return positions
}

function distance(a: Float32Array, b: Float32Array, joint: Joint): number {
  const at = joint * 3
  return Math.hypot(a[at]! - b[at]!, a[at + 1]! - b[at + 1]!, a[at + 2]! - b[at + 2]!)
}

describe('time-driven hand gather', () => {
  it('keeps rolling at its own rate while the wind-up phase holds', () => {
    const atStart = handPositions(sample(PHASE, 0))
    const atQuarterTurn = handPositions(sample(PHASE, SOURCE.gather!.period / 4))
    const minimumTravel = SOURCE.gather!.radius * MASCULINE.armLength * 0.5

    expect(distance(atStart, atQuarterTurn, Joint.HandL)).toBeGreaterThanOrEqual(minimumTravel)
    expect(distance(atStart, atQuarterTurn, Joint.HandR)).toBeGreaterThanOrEqual(minimumTravel)
  })

  it('does not roll at the beginning or after the gather ends', () => {
    for (const phase of [0, SOURCE.gather!.until, 0.7, 1]) {
      const atStart = sample(phase, 0)
      const later = sample(phase, SOURCE.gather!.period / 3)
      for (let rotation = 0; rotation < atStart.rotations.length; rotation++) {
        expect(Math.abs(atStart.rotations[rotation]! - later.rotations[rotation]!)).toBeLessThanOrEqual(1e-6)
      }
    }
  })

  it('moves every joint continuously at 60 Hz', () => {
    let before = sample(PHASE, 0)
    for (let time = DT; time <= SOURCE.gather!.period; time += DT) {
      const after = sample(PHASE, time)
      for (let joint = 0; joint < Joint.Count; joint++) {
        expect(quatAngleBetween(before.rotations, joint * 4, after.rotations, joint * 4)).toBeLessThan(0.25)
      }
      before = after
    }
  })

  it('rolls the hands in opposite directions around the ball', () => {
    const atStart = handPositions(sample(PHASE, 0))
    const atQuarterTurn = handPositions(sample(PHASE, SOURCE.gather!.period / 4))
    const leftDisplacement = atQuarterTurn[Joint.HandL * 3 + 2]! - atStart[Joint.HandL * 3 + 2]!
    const rightDisplacement = atQuarterTurn[Joint.HandR * 3 + 2]! - atStart[Joint.HandR * 3 + 2]!

    expect(leftDisplacement * rightDisplacement).toBeLessThan(0)
  })
})
