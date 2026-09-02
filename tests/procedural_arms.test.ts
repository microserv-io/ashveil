import { describe, expect, it } from 'vitest'
import { createGaitDrive, createGaitState, writeLocomotion } from '../src/render/procedural/gait'
import {type RigGeometry } from '../src/render/procedural/geometry'
import { Joint } from '../src/render/procedural/joints'
import { createPose, resolvePositions } from '../src/render/procedural/pose'
import { writeIdle } from '../src/render/procedural/stances'
import { MASCULINE_PROFILE } from '../src/render/profiles/masculine'
import { KAYKIT_PROFILE } from '../src/render/profiles/kaykit'
import type { ArmCarry } from '../src/render/profiles/profile'
import { CHIBI, HUMAN, MASCULINE } from './fixtures/bodies'

const DEGREES = 180 / Math.PI
const RUN = 5.5
const state = createGaitState()
const pose = createPose()
const positions = new Float32Array(Joint.Count * 3)

function idle(geometry: RigGeometry, carry = MASCULINE_PROFILE.armCarry): void {
  const drive = createGaitDrive()
  writeIdle(geometry, drive, state, pose, carry)
  resolvePositions(geometry, pose, positions)
}

function axis(joint: Joint, lane: number): number {
  return positions[joint * 3 + lane]!
}

/** The angle the forearm has turned away from straight, in degrees. */
function elbowBend(): number {
  const upper = [
    axis(Joint.ElbowR, 0) - axis(Joint.ShoulderR, 0),
    axis(Joint.ElbowR, 1) - axis(Joint.ShoulderR, 1),
    axis(Joint.ElbowR, 2) - axis(Joint.ShoulderR, 2),
  ]
  const lower = [
    axis(Joint.HandR, 0) - axis(Joint.ElbowR, 0),
    axis(Joint.HandR, 1) - axis(Joint.ElbowR, 1),
    axis(Joint.HandR, 2) - axis(Joint.ElbowR, 2),
  ]
  const dot = upper[0]! * lower[0]! + upper[1]! * lower[1]! + upper[2]! * lower[2]!
  const cosine = dot / (Math.hypot(...upper) * Math.hypot(...lower))
  return Math.acos(Math.max(-1, Math.min(1, cosine))) * DEGREES
}

describe('a weaponless body hangs its arms at its sides', () => {
  it('drops the masculine-v2 hand beside its own hip', () => {
    idle(MASCULINE)
    const hand = axis(Joint.HandR, 1)
    const hip = axis(Joint.HipR, 1)
    const shoulder = axis(Joint.ShoulderR, 1)
    // The rig's arm is 35 mm short of reaching the hip joint even bolt straight,
    // so hanging is asserted against what the arm can actually reach.
    expect(hand - hip, 'the hand rides above the hip').toBeLessThan(0.05)
    expect(shoulder - hand, 'the arm is not hanging').toBeGreaterThan(MASCULINE.armLength * 0.9)
    expect(
      Math.abs(axis(Joint.HandR, 0) - axis(Joint.HipR, 0)),
      'the arm sticks out sideways',
    ).toBeLessThan(0.15)
  })

  it('keeps a slight bend in the idle elbow', () => {
    idle(MASCULINE)
    expect(elbowBend()).toBeGreaterThan(5)
    expect(elbowBend()).toBeLessThan(25)
  })

  it('leaves a measured weapon carry alone', () => {
    const carry = KAYKIT_PROFILE.armCarry?.right
    expect(carry).toBeDefined()
    const drive = createGaitDrive()
    writeLocomotion(HUMAN, drive, state, pose, KAYKIT_PROFILE.armCarry)
    for (let lane = 0; lane < 4; lane++) {
      expect(pose.rotations[Joint.ShoulderR * 4 + lane]).toBeCloseTo(carry!.shoulder[lane]!, 6)
    }
  })
})

/** Half the peak-to-peak fore-and-aft angle the upper arm sweeps over one stride. */
function armSwing(geometry: RigGeometry, speed: number, carry?: ArmCarry): number {
  const drive = createGaitDrive()
  drive.speed = speed
  let low = Infinity
  let high = -Infinity
  for (let sample = 0; sample <= 360; sample++) {
    drive.phase = sample / 360
    writeLocomotion(geometry, drive, state, pose, carry)
    resolvePositions(geometry, pose, positions)
    const pitch = Math.atan2(
      axis(Joint.ElbowR, 2) - axis(Joint.ShoulderR, 2),
      axis(Joint.ShoulderR, 1) - axis(Joint.ElbowR, 1),
    )
    low = Math.min(low, pitch)
    high = Math.max(high, pitch)
  }
  return (high - low) * 0.5 * DEGREES
}

describe('a running body pumps its arms', () => {
  it('bends the human elbow to a right angle at a run', () => {
    const drive = createGaitDrive()
    drive.speed = RUN
    drive.phase = 0
    writeLocomotion(HUMAN, drive, state, pose)
    resolvePositions(HUMAN, pose, positions)
    expect(elbowBend()).toBeGreaterThan(80)
    expect(elbowBend()).toBeLessThan(100)
  })

  it('swings the human arm 30 to 45 degrees from the shoulder', () => {
    const swing = armSwing(HUMAN, RUN)
    expect(swing).toBeGreaterThan(30)
    expect(swing).toBeLessThan(45)
  })

  it('keeps the walk swing readable', () => {
    expect(armSwing(HUMAN, 1.6)).toBeGreaterThanOrEqual(20)
    expect(armSwing(HUMAN, 1.6)).toBeLessThanOrEqual(30)
    expect(armSwing(MASCULINE, 1.6)).toBeGreaterThanOrEqual(20)
    expect(armSwing(MASCULINE, 1.6)).toBeLessThanOrEqual(30)
  })

  it('swings an empty arm further forward than back', () => {
    const drive = createGaitDrive()
    drive.speed = 1.6
    let forward = 0
    let back = 0
    for (let sample = 0; sample <= 360; sample++) {
      drive.phase = sample / 360
      writeLocomotion(MASCULINE, drive, state, pose)
      resolvePositions(MASCULINE, pose, positions)
      const reach = axis(Joint.ElbowR, 2) - axis(Joint.ShoulderR, 2)
      forward = Math.max(forward, reach)
      back = Math.max(back, -reach)
    }
    // Ten percent, which is what stops the swing reading as a pendulum.
    expect(forward / back).toBeGreaterThan(1.05)
    expect(forward / back).toBeLessThan(1.3)
  })

  it('carries an empty hand across the body as it comes forward', () => {
    const drive = createGaitDrive()
    drive.speed = 1.6
    let widest = 0
    let crossed = 0
    for (let sample = 0; sample <= 360; sample++) {
      drive.phase = sample / 360
      writeLocomotion(MASCULINE, drive, state, pose)
      resolvePositions(MASCULINE, pose, positions)
      const out = Math.abs(axis(Joint.HandR, 0)) - Math.abs(axis(Joint.ShoulderR, 0))
      const ahead = axis(Joint.HandR, 2) - axis(Joint.ShoulderR, 2)
      if (ahead > 0.05) crossed = Math.min(crossed, out)
      widest = Math.max(widest, out)
    }
    expect(crossed, 'the hand swings beside the body rather than across it').toBeLessThan(widest)
  })

  it('caps the long-armed chibi so its hands do not windmill', () => {
    expect(armSwing(CHIBI, 1.6)).toBeLessThanOrEqual(30)
    expect(armSwing(CHIBI, RUN)).toBeLessThanOrEqual(44.001)
  })

  it('halves the swing of the arm holding a weapon', () => {
    const empty = armSwing(CHIBI, RUN)
    const sword = armSwing(CHIBI, RUN, KAYKIT_PROFILE.armCarry)
    expect(sword).toBeCloseTo(empty * 0.5, 0)
  })

  it('swings each arm against the leg on its own side', () => {
    const drive = createGaitDrive()
    drive.speed = RUN
    drive.phase = 0.02
    writeLocomotion(HUMAN, drive, state, pose)
    resolvePositions(HUMAN, pose, positions)
    const rightFoot = axis(Joint.FootR, 2) - axis(Joint.HipR, 2)
    const rightHand = axis(Joint.HandR, 2) - axis(Joint.ShoulderR, 2)
    expect(rightFoot * rightHand, 'the right hand leads with the right foot').toBeLessThan(0)
  })
})
