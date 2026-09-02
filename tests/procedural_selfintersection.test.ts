import { describe, expect, it } from 'vitest'
import { POSE_CLIPS, SKILL_CLIPS, type PoseClipName } from '../src/render/procedural/clips'
import { createGaitState } from '../src/render/procedural/gait'
import {type RigGeometry } from '../src/render/procedural/geometry'
import { Joint } from '../src/render/procedural/joints'
import { createPose, resolvePositions } from '../src/render/procedural/pose'
import { writeClipPose } from '../src/render/procedural/poses'
import { quatLength } from '../src/render/procedural/quat'
import { createGaitDrive, gaitParams, writeLocomotion } from '../src/render/procedural/gait'
import { createGaitParams } from '../src/render/procedural/gait'
import { writeIdle } from '../src/render/procedural/stances'
import { LEFT, RIGHT } from '../src/render/procedural/joints'
import { HUMAN, MASCULINE } from './fixtures/bodies'
import { footContact } from './fixtures/motion'

/**
 * The guard that stops an authored pose reading as a hand inside a chest.
 *
 * A skill pose is hand and foot targets over phase, and the IK will happily solve
 * one that puts the arm through the ribs — from the review camera that reads as a
 * broken body long before it reads as a bad swing. So every skill is walked at 32
 * samples and measured against the body's own shape.
 */

const SAMPLES = 32
/**
 * The torso as a capsule from the pelvis to the chest. The radius is measured off
 * the rig rather than chosen: a body is roughly as deep through the ribs as it is
 * from its spine to its shoulder joint, less the arm hanging outside it.
 */
const TORSO_RADIUS = 0.6
/** A body standing on a fixture whose ankle is the ground floats within float error of it. */
const FLOOR_TOLERANCE = 2e-3

const state = createGaitState()
const pose = createPose()
const positions = new Float32Array(Joint.Count * 3)

const BODIES: readonly (readonly [string, RigGeometry])[] = [['human', HUMAN], ['masculine-v1', MASCULINE]]
/**
 * The arms, as segments rather than joints. Both ends of an upper arm can sit
 * outside the ribs with the bone itself straight through them — which is exactly
 * what a hand drawn across the far shoulder does, and what the review camera
 * shows as a shoulder folding into the chest.
 */
const LIMBS: readonly (readonly [string, Joint, Joint])[] = [
  ['left upper arm', Joint.ShoulderL, Joint.ElbowL],
  ['left forearm', Joint.ElbowL, Joint.HandL],
  ['right upper arm', Joint.ShoulderR, Joint.ElbowR],
  ['right forearm', Joint.ElbowR, Joint.HandR],
]
/** How many points along a limb are measured. The shoulder end is skipped: it is the torso. */
const ALONG = 6

function at(joint: Joint, lane: number): number {
  return positions[joint * 3 + lane]!
}

function torsoRadius(geometry: RigGeometry): number {
  return Math.abs(geometry.rest[Joint.ShoulderL * 3]!) * TORSO_RADIUS
}

/** How close a limb comes to the torso capsule anywhere along its length. */
function clearsTorso(from: Joint, to: Joint): number {
  let closest = Infinity
  for (let step = 1; step <= ALONG; step++) {
    const t = step / ALONG
    closest = Math.min(closest, distanceFromTorso(
      at(from, 0) + (at(to, 0) - at(from, 0)) * t,
      at(from, 1) + (at(to, 1) - at(from, 1)) * t,
      at(from, 2) + (at(to, 2) - at(from, 2)) * t,
    ))
  }
  return closest
}

/** Distance from a point to the pelvis-to-chest axis, capped to the torso's own height. */
function distanceFromTorso(x: number, y: number, z: number): number {
  const low = at(Joint.Pelvis, 1)
  const high = at(Joint.Chest, 1)
  const on = Math.min(high, Math.max(low, y))
  const t = high > low ? (on - low) / (high - low) : 0
  const axisX = at(Joint.Pelvis, 0) + (at(Joint.Chest, 0) - at(Joint.Pelvis, 0)) * t
  const axisZ = at(Joint.Pelvis, 2) + (at(Joint.Chest, 2) - at(Joint.Pelvis, 2)) * t
  return Math.hypot(x - axisX, y - on, z - axisZ)
}

/** The lowest a limb gets, measured along it rather than at its joints. */
function lowestPoint(from: Joint, to: Joint): number {
  return Math.min(at(from, 1), at(to, 1))
}

function write(geometry: RigGeometry, clip: PoseClipName, phase: number): void {
  writeClipPose(geometry, POSE_CLIPS[clip], phase, state, pose)
  resolvePositions(geometry, pose, positions)
}

describe.each(BODIES)('%s poses without passing through itself', (_name, geometry) => {
  for (const clip of [...SKILL_CLIPS, 'dead'] as PoseClipName[]) {
    it(`${clip} keeps its arms outside the torso and off the floor`, () => {
      const radius = torsoRadius(geometry)
      for (let sample = 0; sample <= SAMPLES; sample++) {
        const phase = sample / SAMPLES
        write(geometry, clip, phase)
        for (const [limb, from, to] of LIMBS) {
          expect(clearsTorso(from, to), `${clip} put the ${limb} in the torso at ${phase}`)
            .toBeGreaterThanOrEqual(radius)
          expect(lowestPoint(from, to), `${clip} put the ${limb} through the floor at ${phase}`)
            .toBeGreaterThanOrEqual(-FLOOR_TOLERANCE)
        }
      }
    })

    it(`${clip} keeps every joint finite and unit`, () => {
      for (let sample = 0; sample <= SAMPLES; sample++) {
        write(geometry, clip, sample / SAMPLES)
        for (let joint = 0; joint < Joint.Count; joint++) {
          expect(quatLength(pose.rotations, joint * 4), `${clip} joint ${joint}`).toBeCloseTo(1, 4)
        }
        for (let lane = 0; lane < 3; lane++) expect(Number.isFinite(pose.offset[lane]!)).toBe(true)
      }
    })
  }

  for (const clip of SKILL_CLIPS) {
    it(`${clip} keeps its feet on the ground`, () => {
      for (let sample = 0; sample <= SAMPLES; sample++) {
        const phase = sample / SAMPLES
        write(geometry, clip, phase)
        for (const [foot, knee] of [[Joint.FootL, Joint.KneeL], [Joint.FootR, Joint.KneeR]] as const) {
          expect(at(foot, 1), `${clip} lifted a foot to knee height at ${phase}`).toBeLessThan(at(knee, 1))
          expect(at(foot, 1), `${clip} put a foot through the floor at ${phase}`)
            .toBeGreaterThanOrEqual(-FLOOR_TOLERANCE)
        }
      }
    })
  }
})

/**
 * The toe is where a rig's foot ends, and it is measured off the mesh rather than
 * guessed (`scripts/extract-rig-geometry.mjs`). Nothing here has a toe joint to
 * bend, so any foot pitch swings the whole sole: tip it too far and the toe goes
 * through the floor, which is what the review page was showing in every state.
 */
describe.each(BODIES)('%s keeps its feet out of the floor', (_name, geometry) => {
  const params = createGaitParams()

  function lowest(): number {
    let low = Infinity
    for (const side of [LEFT, RIGHT]) {
      const contact = footContact(geometry, pose, side)
      low = Math.min(low, contact.heel[1]!, contact.toe[1]!)
    }
    return low
  }

  it('stands with both feet flat', () => {
    const drive = createGaitDrive()
    for (let sample = 0; sample <= SAMPLES; sample++) {
      drive.time = sample * 0.1
      writeIdle(geometry, drive, state, pose)
      expect(lowest(), `idle drove a foot through the floor at ${drive.time.toFixed(1)}s`)
        .toBeGreaterThanOrEqual(-FLOOR_TOLERANCE)
    }
  })

  for (const speed of [0.8, 1.6, 5.5]) {
    it(`keeps the toe above the ground at ${speed} m/s`, () => {
      gaitParams(geometry, speed, params)
      const drive = createGaitDrive()
      drive.speed = speed
      for (let sample = 0; sample <= 120; sample++) {
        drive.phase = sample / 120
        writeLocomotion(geometry, drive, state, pose)
        expect(lowest(), `${speed} m/s drove a foot through the floor at phase ${drive.phase.toFixed(2)}`)
          .toBeGreaterThanOrEqual(-FLOOR_TOLERANCE)
      }
    })
  }

  for (const clip of [...SKILL_CLIPS] as PoseClipName[]) {
    it(`${clip} keeps the toe above the ground`, () => {
      for (let sample = 0; sample <= SAMPLES; sample++) {
        writeClipPose(geometry, POSE_CLIPS[clip], sample / SAMPLES, state, pose)
        expect(lowest(), `${clip} drove a foot through the floor`).toBeGreaterThanOrEqual(-FLOOR_TOLERANCE)
      }
    })
  }
})
