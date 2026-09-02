import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractRigGeometry } from '../scripts/extract-rig-geometry.mjs'
import masculine from '../src/render/procedural/fixtures/masculine.json'
import { buildRigGeometry, restDirection, restPosition } from '../src/render/procedural/geometry'
import { Joint, JOINT_NAMES } from '../src/render/procedural/joints'
import { createPose, setJointAxisAngle, resolvePositions } from '../src/render/procedural/pose'
import { MASCULINE_PROFILE } from '../src/render/profiles/masculine'
import { MASCULINE as geometry } from './fixtures/bodies'

const MANIFEST = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'public', 'bodies', 'masculine-v3', 'masculine-v3.manifest.json'), 'utf8'))
const BODY = readFileSync(join(import.meta.dirname, '..', 'public', 'bodies', 'masculine-v3', 'masculine-v3.glb'))
const scratch = new Float32Array(3)
const positions = new Float32Array(Joint.Count * 3)

describe('rig geometry', () => {
  it('carries a rest position for every required joint', () => {
    for (let joint = 0; joint < Joint.Count; joint++) {
      restPosition(geometry, joint, scratch)
      expect(Number.isFinite(scratch[0]! + scratch[1]! + scratch[2]!), JOINT_NAMES[joint]).toBe(true)
    }
  })

  it('keeps the committed masculine fixture aligned with its source GLB', () => {
    const extracted = extractRigGeometry(BODY, MASCULINE_PROFILE.bones, MASCULINE_PROFILE.optional)
    const committed = {
      standingHeight: masculine.standingHeight,
      footprint: masculine.footprint,
      joints: masculine.joints,
      optional: masculine.optional,
    }

    // The footprint is the fitter's reading off the sole, recorded in the manifest;
    // the extractor follows bone dominance and loses the heel on a rig whose ankle
    // sits a fifth of the way along the foot.
    expect(committed).toEqual({
      standingHeight: extracted.standingHeight,
      footprint: MANIFEST.footprint,
      joints: extracted.joints,
      optional: extracted.optional,
    })
  })

  it('scales every length by the same factor', () => {
    const doubled = buildRigGeometry(masculine.joints, 2, masculine.standingHeight, masculine.footprint)
    expect(doubled.legLength).toBeCloseTo(geometry.legLength * 2, 6)
    expect(doubled.nominalLegLength).toBeCloseTo(geometry.nominalLegLength * 2, 6)
    expect(doubled.hipHeight).toBeCloseTo(geometry.hipHeight * 2, 6)
    restPosition(doubled, Joint.Head, scratch)
    expect(scratch[1]).toBeCloseTo(geometry.height * 2, 5)
  })

  it('gives leaf joints their canonical directions', () => {
    restDirection(geometry, Joint.Head, scratch)
    expect(scratch[1]).toBeCloseTo(1, 6)
    restDirection(geometry, Joint.FootL, scratch)
    expect(scratch[2]).toBeCloseTo(1, 6)
  })
})

describe('forward kinematics from absolute rotations', () => {
  it('reproduces the rest pose when every rotation is identity', () => {
    const pose = createPose()
    resolvePositions(geometry, pose, positions)
    for (let joint = 0; joint < Joint.Count; joint++) {
      restPosition(geometry, joint, scratch)
      for (let axis = 0; axis < 3; axis++) {
        expect(positions[joint * 3 + axis], JOINT_NAMES[joint]).toBeCloseTo(scratch[axis]!, 6)
      }
    }
  })

  it('carries the root offset to every joint', () => {
    const pose = createPose()
    pose.offset[1] = -0.05
    resolvePositions(geometry, pose, positions)
    restPosition(geometry, Joint.FootR, scratch)
    expect(positions[Joint.FootR * 3 + 1]).toBeCloseTo(scratch[1]! - 0.05, 6)
  })

  it('swings a child when its parent rotates, without moving the parent', () => {
    const pose = createPose()
    const direction = new Float32Array(3)
    restDirection(geometry, Joint.HipL, direction)
    setJointAxisAngle(pose, Joint.HipL, 1, 0, 0, Math.PI / 2)
    resolvePositions(geometry, pose, positions)
    restPosition(geometry, Joint.HipL, scratch)
    expect(positions[Joint.HipL * 3 + 1]).toBeCloseTo(scratch[1]!, 6)
    // A quarter turn about +X takes the thigh from pointing down to pointing back.
    expect(positions[Joint.KneeL * 3]).toBeCloseTo(scratch[0]! + direction[0]! * geometry.thigh, 5)
    expect(positions[Joint.KneeL * 3 + 1]).toBeCloseTo(scratch[1]! - direction[2]! * geometry.thigh, 5)
    expect(positions[Joint.KneeL * 3 + 2]).toBeCloseTo(scratch[2]! + direction[1]! * geometry.thigh, 5)
  })
})
