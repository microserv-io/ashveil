import { describe, expect, it } from 'vitest'
import { createGaitDrive, createGaitParams, createGaitState, gaitParams, writeLocomotion } from '../src/render/procedural/gait'
import { resolvePositions, type RigGeometry } from '../src/render/procedural/geometry'
import { Joint } from '../src/render/procedural/joints'
import { createPose } from '../src/render/procedural/pose'
import { quatRotate } from '../src/render/procedural/quat'
import { CHIBI as chibi, HUMAN as human, HUMAN_LEG_RATIO, KNIGHT as knight } from './fixtures/bodies'

const WALK = 1.6
const RUN = 5.5
const SAMPLES = 720
const DEGREES = 180 / Math.PI

const state = createGaitState()
const pose = createPose()
const positions = new Float32Array(Joint.Count * 3)
const params = createGaitParams()
const axis = new Float32Array(3)

function kneeBend(): number {
  const hip = Joint.HipL * 3
  const knee = Joint.KneeL * 3
  const foot = Joint.FootL * 3
  const upperX = positions[hip]! - positions[knee]!
  const upperY = positions[hip + 1]! - positions[knee + 1]!
  const upperZ = positions[hip + 2]! - positions[knee + 2]!
  const lowerX = positions[foot]! - positions[knee]!
  const lowerY = positions[foot + 1]! - positions[knee + 1]!
  const lowerZ = positions[foot + 2]! - positions[knee + 2]!
  const cosine = (upperX * lowerX + upperY * lowerY + upperZ * lowerZ) /
    (Math.hypot(upperX, upperY, upperZ) * Math.hypot(lowerX, lowerY, lowerZ))
  return Math.PI - Math.acos(Math.max(-1, Math.min(1, cosine)))
}

/** Absolute pitch of a joint in the body frame: how far its up axis tipped forward. */
function pitch(joint: Joint): number {
  quatRotate(pose.rotations, joint * 4, 0, 1, 0, axis)
  return Math.asin(Math.max(-1, Math.min(1, axis[2]!)))
}

interface Walked {
  /** Knee bend through the middle half of stance, where the body rides over the foot. */
  readonly stanceKnee: number
  /** Knee bend anywhere in stance, including the footfall the other leg forces. */
  readonly peakKnee: number
  readonly pelvisBob: number
  readonly headBob: number
  readonly chestPitch: number
  readonly headPitch: number
}

function walk(geometry: RigGeometry, speed: number): Walked {
  gaitParams(geometry, speed, params)
  const drive = createGaitDrive()
  drive.speed = speed
  let stanceKnee = 0
  let peakKnee = 0
  let pelvisLow = Infinity
  let pelvisHigh = -Infinity
  let headLow = Infinity
  let headHigh = -Infinity
  let chestLow = Infinity
  let chestHigh = -Infinity
  let headPitch = 0
  for (let sample = 0; sample <= SAMPLES; sample++) {
    drive.phase = sample / SAMPLES
    writeLocomotion(geometry, drive, state, pose)
    resolvePositions(geometry, pose, positions)
    if (drive.phase < params.duty) {
      peakKnee = Math.max(peakKnee, kneeBend())
      const midStance = drive.phase > params.duty * 0.25 && drive.phase < params.duty * 0.75
      if (midStance) stanceKnee = Math.max(stanceKnee, kneeBend())
    }
    pelvisLow = Math.min(pelvisLow, positions[Joint.Pelvis * 3 + 1]!)
    pelvisHigh = Math.max(pelvisHigh, positions[Joint.Pelvis * 3 + 1]!)
    headLow = Math.min(headLow, positions[Joint.Head * 3 + 1]!)
    headHigh = Math.max(headHigh, positions[Joint.Head * 3 + 1]!)
    chestLow = Math.min(chestLow, pitch(Joint.Chest))
    chestHigh = Math.max(chestHigh, pitch(Joint.Chest))
    headPitch = Math.max(headPitch, Math.abs(pitch(Joint.Head)))
  }
  return {
    stanceKnee: stanceKnee * DEGREES,
    peakKnee: peakKnee * DEGREES,
    pelvisBob: pelvisHigh - pelvisLow,
    headBob: headHigh - headLow,
    chestPitch: (chestHigh - chestLow) * DEGREES,
    headPitch: headPitch * DEGREES,
  }
}

describe('a human body walks and runs at human numbers', () => {
  it('walks at 1.6 m/s with the cadence and step of a person', () => {
    gaitParams(human, WALK, params)
    expect(params.frequency, 'gait cycles per second').toBeGreaterThan(0.9)
    expect(params.frequency).toBeLessThan(1.1)
    expect(params.halfStep, 'half the distance a planted foot travels').toBeGreaterThan(0.33)
    expect(params.halfStep).toBeLessThan(0.42)
    expect(params.duty, 'a walk keeps both feet down for part of the cycle').toBeGreaterThanOrEqual(0.52)
    const measured = walk(human, WALK)
    expect(measured.stanceKnee, 'a standing walk, not a squat').toBeLessThanOrEqual(20)
    // The other leg is still down at footfall and holds the hip low, so this knee
    // takes the landing. Without a rolling foot there is nowhere else for it to go.
    expect(measured.peakKnee, 'a knee that catches the step, not a squat').toBeLessThan(30)
  })

  it('runs at 5.5 m/s with the cadence of a person', () => {
    gaitParams(human, RUN, params)
    expect(params.frequency).toBeGreaterThan(1.5)
    expect(params.frequency).toBeLessThan(1.9)
  })
})

describe('a short-legged placeholder keeps up without sliding', () => {
  it('walks the knight at a cadence a body could hold', () => {
    gaitParams(knight, WALK, params)
    expect(params.frequency, 'the legs may whirr, but not blur').toBeLessThan(6)
    expect(params.duty).toBeGreaterThanOrEqual(0.52)
    expect(walk(knight, WALK).stanceKnee).toBeLessThan(25)
    expect(walk(knight, WALK).peakKnee).toBeLessThan(35)
  })
})

describe('the torso carries the bob without nodding', () => {
  for (const [name, speed, budget] of [['walk', WALK, 4], ['run', RUN, 8]] as const) {
    it(`keeps the ${name} torso within ${budget} degrees and the head level`, () => {
      for (const [body, geometry] of [['human', human], ['knight', knight]] as const) {
        const measured = walk(geometry, speed)
        expect(measured.chestPitch, `${body} chest pitch swing`).toBeLessThanOrEqual(budget)
        expect(measured.headPitch, `${body} head is not level`).toBeLessThanOrEqual(3)
        expect(measured.headBob, `${body} head bobs more than its hips`).toBeLessThanOrEqual(measured.pelvisBob)
      }
    })
  }
})

describe('gait proportions', () => {
  it('uses the same human-scale gait fit for human and chibi bodies', () => {
    expect(human.nominalLegLength).toBeCloseTo(chibi.nominalLegLength, 6)
    expect(human.legLength / human.standingHeight).toBeCloseTo(HUMAN_LEG_RATIO, 6)
    expect(chibi.legLength / chibi.standingHeight).toBeCloseTo(0.17, 6)
  })

  it('quickens the shorter real legs when stride reaches their limit', () => {
    gaitParams(human, WALK, params)
    const humanCadence = params.frequency
    gaitParams(chibi, WALK, params)
    expect(params.frequency).toBeGreaterThan(humanCadence)
  })

  for (const [name, geometry] of [['human', human], ['chibi', chibi], ['knight', knight]] as const) {
    it(`${name} keeps its stance foot planted`, () => {
      gaitParams(geometry, WALK, params)
      const drive = createGaitDrive()
      drive.speed = WALK
      let worldLow = Infinity
      let worldHigh = -Infinity
      let lift = 0
      for (let sample = 0; sample <= SAMPLES; sample++) {
        drive.phase = sample / SAMPLES * params.duty
        writeLocomotion(geometry, drive, state, pose)
        resolvePositions(geometry, pose, positions)
        const travelled = drive.phase / params.frequency * WALK
        const world = travelled + positions[Joint.FootL * 3 + 2]!
        worldLow = Math.min(worldLow, world)
        worldHigh = Math.max(worldHigh, world)
        lift = Math.max(lift, Math.abs(positions[Joint.FootL * 3 + 1]! - geometry.ankleHeight))
      }
      expect(worldHigh - worldLow).toBeLessThan(0.005)
      expect(lift).toBeLessThan(0.005)
    })

    it(`${name} closes its gait loop`, () => {
      const drive = createGaitDrive()
      drive.speed = WALK
      writeLocomotion(geometry, drive, state, pose)
      const startRotations = new Float32Array(pose.rotations)
      const startOffset = new Float32Array(pose.offset)
      drive.phase = 1
      writeLocomotion(geometry, drive, state, pose)
      for (let lane = 0; lane < startRotations.length; lane++) {
        expect(pose.rotations[lane]).toBeCloseTo(startRotations[lane]!, 6)
      }
      for (let lane = 0; lane < 3; lane++) expect(pose.offset[lane]).toBeCloseTo(startOffset[lane]!, 6)
    })
  }
})
