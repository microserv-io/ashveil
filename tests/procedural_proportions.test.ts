import { describe, expect, it } from 'vitest'
import { createGaitDrive, createGaitParams, createGaitState, gaitParams, writeLocomotion } from '../src/render/procedural/gait'
import {type RigGeometry } from '../src/render/procedural/geometry'
import { Joint, LEFT, RIGHT } from '../src/render/procedural/joints'
import { createPose, resolvePositions } from '../src/render/procedural/pose'
import { quatRotate } from '../src/render/procedural/quat'
import { writeIdle } from '../src/render/procedural/stances'
import { footContact } from './fixtures/motion'
import {
  CHIBI as chibi,
  HUMAN as human,
  HUMAN_LEG_RATIO,
  MASCULINE as masculine,
} from './fixtures/bodies'

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
    expect(measured.stanceKnee, 'a standing walk, not a squat').toBeLessThanOrEqual(26)
    // The peak is at toe-off, where the heel has left the ground and the knee
    // folds to let it: a real one folds about this far there.
    expect(measured.peakKnee, 'a knee that folds at toe-off, not a squat').toBeLessThan(45)
  })

  it('runs at 5.5 m/s with the cadence of a person', () => {
    gaitParams(human, RUN, params)
    expect(params.frequency).toBeGreaterThan(1.5)
    expect(params.frequency).toBeLessThan(1.9)
  })
})

/**
 * How far the planted contact travels through stance, in world space. A rolling
 * foot pivots on its heel while it is ahead of the hip and on its ball once it is
 * behind, so each is measured over the window it is actually standing on.
 */
function contactSlide(geometry: RigGeometry, speed: number): { heel: number; toe: number; lift: number } {
  gaitParams(geometry, speed, params)
  const drive = createGaitDrive()
  drive.speed = speed
  const bounds = { heel: [Infinity, -Infinity], toe: [Infinity, -Infinity] }
  let lift = 0
  for (let sample = 0; sample <= SAMPLES; sample++) {
    drive.phase = (sample / SAMPLES) * params.duty
    writeLocomotion(geometry, drive, state, pose)
    const contact = footContact(geometry, pose, LEFT)
    const travelled = (drive.phase / params.frequency) * speed
    const planted = contact.pitch <= 0 ? contact.heel : contact.toe
    const seen = contact.pitch <= 0 ? bounds.heel : bounds.toe
    seen[0] = Math.min(seen[0]!, travelled + planted[2]!)
    seen[1] = Math.max(seen[1]!, travelled + planted[2]!)
    lift = Math.max(lift, Math.abs(planted[1]!))
  }
  return {
    heel: bounds.heel[1]! - bounds.heel[0]!,
    toe: bounds.toe[1]! - bounds.toe[0]!,
    lift,
  }
}

describe('a body at rest stands on its legs', () => {
  for (const [name, geometry] of [['human', human], ['masculine-v3', masculine]] as const) {
    it(`stands the ${name} idle on straight knees`, () => {
      const drive = createGaitDrive()
      let worst = 0
      for (let sample = 0; sample <= 40; sample++) {
        drive.time = sample * 0.25
        writeIdle(geometry, drive, state, pose)
        resolvePositions(geometry, pose, positions)
        worst = Math.max(worst, kneeBend() * DEGREES)
      }
      expect(worst, 'idle is a held squat').toBeLessThan(3)
    })
  }
})

describe('the hips stay up through the stride', () => {
  // A person's hips rise and fall about 45 to 50 mm over a walk cycle. Pinned to
  // the ankle this was 90 on the human and 98 on the Tripo body and the walk read
  // as a lunge. What is left is the anatomy: masculine-v3's hip-to-ankle leg is
  // 0.43 of its height where a person's is 0.48, so the same step asks more of it.
  for (const [name, geometry] of [['human', human], ['masculine-v3', masculine]] as const) {
    it(`keeps the ${name} walk bob under 50 mm`, () => {
      const measured = walk(geometry, WALK)
      expect(measured.pelvisBob).toBeLessThanOrEqual(0.055)
      expect(measured.stanceKnee, 'a walk, not a squat').toBeLessThanOrEqual(28)
    })
  }
})

/**
 * How far forward the chest is pitched, averaged over a stride. Read off the pose
 * rather than off the shoulders, so a rig whose chest is authored leaning does not
 * count its own rest shape as a lean.
 */
function torsoLean(geometry: RigGeometry, speed: number): number {
  const drive = createGaitDrive()
  drive.speed = speed
  let total = 0
  for (let sample = 0; sample < SAMPLES; sample++) {
    drive.phase = sample / SAMPLES
    writeLocomotion(geometry, drive, state, pose)
    total += pitch(Joint.Chest)
  }
  return (total / SAMPLES) * DEGREES
}

/** How far the lower of a foot's two contacts is off the ground. */
function clearance(geometry: RigGeometry, side: number): number {
  const contact = footContact(geometry, pose, side)
  return Math.min(contact.heel[1]!, contact.toe[1]!)
}

describe('a walk reads as a walk', () => {
  for (const [name, geometry] of [['human', human], ['masculine-v3', masculine]] as const) {
    it(`swings the ${name} knee well past the knee it stands on`, () => {
      gaitParams(geometry, WALK, params)
      const drive = createGaitDrive()
      drive.speed = WALK
      let stance = 0
      let swing = 0
      for (let sample = 0; sample <= SAMPLES; sample++) {
        drive.phase = sample / SAMPLES
        writeLocomotion(geometry, drive, state, pose)
        resolvePositions(geometry, pose, positions)
        const bend = kneeBend() * DEGREES
        if (drive.phase > params.duty * 0.25 && drive.phase < params.duty * 0.75) stance = Math.max(stance, bend)
        if (drive.phase > params.duty) swing = Math.max(swing, bend)
      }
      expect(swing, 'the swing knee barely bends').toBeGreaterThan(stance * 2)
    })

    it(`shifts the ${name} hips over the leg that is carrying`, () => {
      const drive = createGaitDrive()
      drive.speed = WALK
      let low = Infinity
      let high = -Infinity
      for (let sample = 0; sample <= SAMPLES; sample++) {
        drive.phase = sample / SAMPLES
        writeLocomotion(geometry, drive, state, pose)
        low = Math.min(low, pose.offset[0]!)
        high = Math.max(high, pose.offset[0]!)
      }
      expect(high, 'the hips do not shift onto the stance leg').toBeGreaterThanOrEqual(0.02)
      expect(high).toBeLessThanOrEqual(0.04)
      expect(high + low, 'the sway is one-sided').toBeCloseTo(0, 3)
    })

    it(`turns the ${name} pelvis with the stride and counters it with the chest`, () => {
      const drive = createGaitDrive()
      drive.speed = WALK
      let pelvis = 0
      let chest = 0
      for (let sample = 0; sample <= SAMPLES; sample++) {
        drive.phase = sample / SAMPLES
        writeLocomotion(geometry, drive, state, pose)
        quatRotate(pose.rotations, Joint.Pelvis * 4, 0, 0, 1, axis)
        pelvis = Math.max(pelvis, Math.abs(Math.asin(Math.max(-1, Math.min(1, axis[0]!)))))
        quatRotate(pose.rotations, Joint.Chest * 4, 0, 0, 1, axis)
        chest = Math.max(chest, Math.abs(Math.asin(Math.max(-1, Math.min(1, axis[0]!)))))
      }
      expect(pelvis * DEGREES).toBeGreaterThanOrEqual(6)
      expect(pelvis * DEGREES).toBeLessThanOrEqual(10)
      expect(chest, 'the chest turns with the hips instead of against them').toBeLessThan(pelvis * 0.8)
    })

    it(`lets the ${name} head follow the chest a little`, () => {
      const drive = createGaitDrive()
      drive.speed = WALK
      let nod = 0
      for (let sample = 0; sample <= SAMPLES; sample++) {
        drive.phase = sample / SAMPLES
        writeLocomotion(geometry, drive, state, pose)
        nod = Math.max(nod, Math.abs(pitch(Joint.Head)))
      }
      expect(nod * DEGREES, 'the head is locked level like a doll').toBeGreaterThan(0.2)
      expect(nod * DEGREES, 'the head nods with every step').toBeLessThanOrEqual(2.001)
    })
  }
})

describe('a human body runs like a person', () => {
  it('rides on a stance knee between 25 and 35 degrees', () => {
    const measured = walk(human, RUN)
    expect(measured.stanceKnee).toBeGreaterThanOrEqual(25)
    expect(measured.stanceKnee).toBeLessThanOrEqual(35)
  })

  it('leans the torso forward, further than a walk does', () => {
    const lean = torsoLean(human, RUN)
    expect(lean).toBeGreaterThanOrEqual(8)
    expect(lean).toBeLessThanOrEqual(15)
    expect(lean).toBeGreaterThan(torsoLean(human, WALK) + 5)
  })

  it('leaves the ground', () => {
    gaitParams(human, RUN, params)
    expect(params.duty, 'both feet are down for part of the cycle').toBeLessThan(0.5)
    let flight = 0
    const drive = createGaitDrive()
    drive.speed = RUN
    for (let sample = 0; sample < SAMPLES; sample++) {
      drive.phase = sample / SAMPLES
      writeLocomotion(human, drive, state, pose)
      resolvePositions(human, pose, positions)
      // The ankle rises with the roll, so the ground clearance is the contact's.
      if (Math.min(clearance(human, LEFT), clearance(human, RIGHT)) > 0.02) flight++
    }
    expect(flight / SAMPLES, 'fraction of the cycle with both feet in the air').toBeGreaterThan(0.15)
  })

  it('lifts the swing thigh and tucks the heel under it', () => {
    gaitParams(human, RUN, params)
    const drive = createGaitDrive()
    drive.speed = RUN
    let thigh = 0
    let tucked = false
    for (let sample = 0; sample <= SAMPLES; sample++) {
      drive.phase = sample / SAMPLES
      const legPhase = drive.phase
      if (legPhase < params.duty) continue
      writeLocomotion(human, drive, state, pose)
      resolvePositions(human, pose, positions)
      const forward = positions[Joint.KneeL * 3 + 2]! - positions[Joint.HipL * 3 + 2]!
      const down = positions[Joint.HipL * 3 + 1]! - positions[Joint.KneeL * 3 + 1]!
      const lifted = Math.atan2(forward, down) * DEGREES
      if (lifted > thigh) {
        thigh = lifted
        tucked = positions[Joint.FootL * 3 + 2]! < positions[Joint.KneeL * 3 + 2]!
      }
    }
    expect(thigh, 'the swing thigh never came up').toBeGreaterThanOrEqual(45)
    expect(tucked, 'the heel trails the knee at the top of the swing').toBe(true)
  })
})

describe('the torso carries the bob without nodding', () => {
  for (const [name, speed, budget] of [['walk', WALK, 4], ['run', RUN, 8]] as const) {
    it(`keeps the ${name} torso within ${budget} degrees and the head level`, () => {
      for (const [body, geometry] of [['human', human], ['masculine-v3', masculine]] as const) {
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

  for (const [name, geometry] of [
    ['human', human], ['chibi', chibi], ['masculine-v3', masculine],
  ] as const) {
    it(`${name} keeps its planted contact still`, () => {
      const slide = contactSlide(geometry, WALK)
      expect(slide.heel, 'the heel slid while it was planted').toBeLessThan(0.005)
      expect(slide.toe, 'the toe slid while it was planted').toBeLessThan(0.005)
      // The sole is not a plane: a long-footed body's rolling contact rides a few
      // millimetres as the pivot moves from heel to toe, a fifth of a pixel at the
      // gameplay camera. Sliding, above, stays at five.
      expect(slide.lift, `the planted contact left the ground (${JSON.stringify(slide)})`).toBeLessThan(0.008)
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
