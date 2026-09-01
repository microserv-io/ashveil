import { describe, expect, it } from 'vitest'
import { buildRigGeometry, KAYKIT_KNIGHT_JOINTS, resolvePositions } from '../src/render/procedural/geometry'
import {
  createGaitDrive,
  createGaitParams,
  createGaitState,
  gaitParams,
  strideFrequency,
  writeDash,
  writeIdle,
  writeLocomotion,
  type GaitDrive,
} from '../src/render/procedural/gait'
import { Joint } from '../src/render/procedural/joints'
import { createPose } from '../src/render/procedural/pose'

/**
 * The KayKit knight scaled to a 1.8 m humanoid, so the brief's walk and run speeds
 * mean what they say. Slice 2b scales each body's rest pose the same way.
 */
const HUMAN_SCALE = 1.2
const geometry = buildRigGeometry(KAYKIT_KNIGHT_JOINTS, HUMAN_SCALE)

const SPEEDS = [0.5, 1.5, 3, 6]
const SAMPLES = 720

const state = createGaitState()
const pose = createPose()
const positions = new Float32Array(Joint.Count * 3)
const params = createGaitParams()

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
      gaitParams(geometry, speed, params)
      const hip = geometry.legLength * 0.85
      expect(Math.hypot(params.halfStep, hip), `${speed} m/s`).toBeLessThan(geometry.legLength)
    }
  })
})

describe('the stance foot does not slide', () => {
  for (const speed of SPEEDS) {
    it(`holds still at ${speed} m/s`, () => {
      const frequency = strideFrequency(geometry, speed)
      gaitParams(geometry, speed, params)
      let minZ = Infinity
      let maxZ = -Infinity
      let minX = Infinity
      let maxX = -Infinity
      let maxLift = 0
      // Sample the left foot's stance window, one full cycle of it.
      for (let i = 0; i <= SAMPLES; i++) {
        const phase = (i / SAMPLES) * params.duty
        writeLocomotion(geometry, drive(speed, phase), state, pose)
        resolvePositions(geometry, pose, positions)
        const travelled = (phase / frequency) * speed
        const worldZ = travelled + positions[Joint.FootL * 3 + 2]!
        minZ = Math.min(minZ, worldZ)
        maxZ = Math.max(maxZ, worldZ)
        minX = Math.min(minX, positions[Joint.FootL * 3]!)
        maxX = Math.max(maxX, positions[Joint.FootL * 3]!)
        maxLift = Math.max(maxLift, Math.abs(positions[Joint.FootL * 3 + 1]! - geometry.ankleHeight))
      }
      expect(maxZ - minZ, 'forward drift per stride').toBeLessThan(0.005)
      expect(maxX - minX, 'lateral drift per stride').toBeLessThan(0.005)
      expect(maxLift, 'the planted ankle left the ground, so the IK is clamping').toBeLessThan(0.005)
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
