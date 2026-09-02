import { describe, expect, it } from 'vitest'
import {
  buildRigGeometry,
  KAYKIT_KNIGHT_JOINTS,
  KAYKIT_KNIGHT_STANDING_HEIGHT,
  resolvePositions,
} from '../src/render/procedural/geometry'
import {
  createGaitDrive,
  createGaitParams,
  createGaitState,
  gaitParams,
  strideFrequency,
  writeLocomotion,
  type GaitDrive,
} from '../src/render/procedural/gait'
import { writeDash, writeIdle } from '../src/render/procedural/stances'
import { Joint, LEFT } from '../src/render/procedural/joints'
import { createPose } from '../src/render/procedural/pose'
import { footContact } from './fixtures/motion'

/**
 * The KayKit knight at a scale that gives it a half-metre leg, which is as close
 * to a person as a chibi gets. It is still a chibi: `procedural_proportions` is
 * where human numbers are pinned, and this file asks whether the loop closes and
 * the feet stay put on a body whose step its legs cannot reach.
 */
const KNIGHT_SCALE = 1.2
const geometry = buildRigGeometry(KAYKIT_KNIGHT_JOINTS, KNIGHT_SCALE, KAYKIT_KNIGHT_STANDING_HEIGHT)

const SPEEDS = [0.5, 1.5, 3, 6]
const SAMPLES = 720

const state = createGaitState()
const pose = createPose()
const positions = new Float32Array(Joint.Count * 3)
const params = createGaitParams()

/** How far a limb is stretched, from its root joint to the joint two bones down. */
function span(from: Joint, to: Joint): number {
  return Math.hypot(
    positions[to * 3]! - positions[from * 3]!,
    positions[to * 3 + 1]! - positions[from * 3 + 1]!,
    positions[to * 3 + 2]! - positions[from * 3 + 2]!,
  )
}

function drive(speed: number, phase: number): GaitDrive {
  const value = createGaitDrive()
  value.speed = speed
  value.phase = phase
  value.time = 0
  value.seed = 0
  return value
}

describe('gait parameters', () => {
  it('quickens and shortens its stance as speed rises', () => {
    let previousFrequency = 0
    let previousDuty = 1
    for (const speed of SPEEDS) {
      gaitParams(geometry, speed, params)
      expect(params.frequency, `${speed} m/s`).toBeGreaterThan(previousFrequency)
      expect(params.duty, `${speed} m/s`).toBeLessThanOrEqual(previousDuty)
      previousFrequency = params.frequency
      previousDuty = params.duty
    }
    gaitParams(geometry, SPEEDS[0]!, params)
    const walking = params.duty
    gaitParams(geometry, SPEEDS.at(-1)!, params)
    expect(params.duty, 'a run must leave the ground; a walk must not').toBeLessThan(walking - 0.2)
  })

  it('stands still at zero speed', () => {
    gaitParams(geometry, 0, params)
    expect(params.frequency).toBe(0)
  })

  it('keeps the step within the leg it has', () => {
    for (const speed of [...SPEEDS, 20]) {
      let reach = 0
      for (let i = 0; i <= 120; i++) {
        writeLocomotion(geometry, drive(speed, i / 120), state, pose)
        resolvePositions(geometry, pose, positions)
        reach = Math.max(reach, span(Joint.HipL, Joint.FootL), span(Joint.HipR, Joint.FootR))
      }
      expect(reach, `${speed} m/s asks for more leg than it has`).toBeLessThanOrEqual(geometry.legLength)
    }
  })
})

/**
 * The stance foot rolls over its heel and then its ball, so the ankle moves and
 * the thing that must hold still is whichever contact is on the ground.
 */
describe('the planted contact does not slide', () => {
  for (const speed of SPEEDS) {
    it(`holds still at ${speed} m/s`, () => {
      const frequency = strideFrequency(geometry, speed)
      gaitParams(geometry, speed, params)
      const seen = { heel: [Infinity, -Infinity], ball: [Infinity, -Infinity] }
      let maxLift = 0
      let maxDrift = 0
      // Sample the left foot's stance window, one full cycle of it.
      for (let i = 0; i <= SAMPLES; i++) {
        const phase = (i / SAMPLES) * params.duty
        writeLocomotion(geometry, drive(speed, phase), state, pose)
        const contact = footContact(geometry, pose, LEFT)
        const planted = contact.pitch <= 0 ? contact.heel : contact.ball
        const window = contact.pitch <= 0 ? seen.heel : seen.ball
        const worldZ = (phase / frequency) * speed + planted[2]!
        window[0] = Math.min(window[0]!, worldZ)
        window[1] = Math.max(window[1]!, worldZ)
        maxDrift = Math.max(maxDrift, Math.abs(planted[0]! - LEFT * geometry.hipWidth))
        maxLift = Math.max(maxLift, Math.abs(planted[1]!))
      }
      expect(seen.heel[1]! - seen.heel[0]!, 'the heel drifted while planted').toBeLessThan(0.005)
      expect(seen.ball[1]! - seen.ball[0]!, 'the ball drifted while planted').toBeLessThan(0.005)
      expect(maxLift, 'the planted contact left the ground, so the IK is clamping').toBeLessThan(0.005)
      expect(maxDrift, 'the foot wandered sideways').toBeLessThan(geometry.hipWidth * 0.2)
    })
  }
})

describe('the gait loop closes', () => {
  for (const speed of SPEEDS) {
    it(`repeats exactly after one stride at ${speed} m/s`, () => {
      writeLocomotion(geometry, drive(speed, 0), state, pose)
      const start = new Float32Array(pose.rotations)
      const startOffset = new Float32Array(pose.offset)
      writeLocomotion(geometry, drive(speed, 1), state, pose)
      for (let i = 0; i < start.length; i++) expect(pose.rotations[i]).toBeCloseTo(start[i]!, 6)
      for (let i = 0; i < 3; i++) expect(pose.offset[i]).toBeCloseTo(startOffset[i]!, 6)
    })
  }

  it('accumulates no root translation over a stride', () => {
    let sumX = 0
    let sumZ = 0
    for (let i = 0; i < SAMPLES; i++) {
      writeLocomotion(geometry, drive(1.5, i / SAMPLES), state, pose)
      sumX += pose.offset[0]!
      sumZ += pose.offset[2]!
    }
    expect(Math.abs(sumX / SAMPLES)).toBeLessThan(1e-4)
    expect(Math.abs(sumZ / SAMPLES)).toBeLessThan(1e-4)
  })
})

describe('the other locomotion poses', () => {
  it('breathes while idle without moving its feet', () => {
    const first = createGaitDrive()
    first.time = 0
    writeIdle(geometry, first, state, pose)
    resolvePositions(geometry, pose, positions)
    const footZ = positions[Joint.FootL * 3 + 2]!
    let moved = 0
    let chestMoved = 0
    const chest = new Float32Array(pose.rotations.subarray(Joint.Chest * 4, Joint.Chest * 4 + 4))
    for (let i = 1; i <= 200; i++) {
      const later = createGaitDrive()
      later.time = i * 0.05
      writeIdle(geometry, later, state, pose)
      resolvePositions(geometry, pose, positions)
      moved = Math.max(moved, Math.abs(positions[Joint.FootL * 3 + 2]! - footZ))
      for (let j = 0; j < 4; j++) {
        chestMoved = Math.max(chestMoved, Math.abs(pose.rotations[Joint.Chest * 4 + j]! - chest[j]!))
      }
    }
    expect(moved, 'idle feet must stay planted').toBeLessThan(1e-4)
    expect(chestMoved, 'idle must breathe, not freeze').toBeGreaterThan(1e-4)
  })

  it('leans forward with its legs trailing in a dash', () => {
    writeDash(geometry, createGaitDrive(), state, pose)
    resolvePositions(geometry, pose, positions)
    expect(positions[Joint.Chest * 3 + 2], 'the chest leads').toBeGreaterThan(0.05)
    expect(positions[Joint.FootL * 3 + 2], 'the feet trail').toBeLessThan(0)
    expect(positions[Joint.FootL * 3 + 1]).toBeGreaterThan(geometry.ankleHeight)
  })
})
