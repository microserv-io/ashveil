import { join } from 'node:path'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { POSE_CLIPS } from '../src/render/procedural/clips'
import { restDirection } from '../src/render/procedural/geometry'
import { createGaitDrive, createGaitState, writeLocomotion } from '../src/render/procedural/gait'
import { writeShoulderGirdle } from '../src/render/procedural/girdle'
import { Joint, LEFT, OptionalJoint, RIGHT } from '../src/render/procedural/joints'
import { createPose, resolvePositions, setJointAxisAngle } from '../src/render/procedural/pose'
import { writeClipPose } from '../src/render/procedural/poses'
import { quatRotate } from '../src/render/procedural/quat'
import { ProceduralDriver } from '../src/render/proceduraldriver'
import { MASCULINE_PROFILE } from '../src/render/profiles/masculine'
import { KAYKIT_PROFILE } from '../src/render/profiles/kaykit'
import { createRigInputOwner } from '../src/render/riginput'
import { DT } from '../src/sim/types'
import { KNIGHT, MASCULINE } from './fixtures/bodies'
import { loadGlbSkeleton } from './fixtures/glbskeleton'

/**
 * An arm swings from a shoulder, and the shoulder has to go with it. Without the
 * clavicle the upper arm pivots under a frozen shoulder, which reads as a doll's
 * arm turning in its socket.
 */

const state = createGaitState()
const pose = createPose()
const axis = new Float32Array(3)

/** How far a clavicle has turned forward, along the side it is on. */
function protraction(joint: OptionalJoint, side: number): number {
  quatRotate(pose.extras, joint * 4, side, 0, 0, axis)
  return axis[2]!
}

/** How far it has lifted. */
function elevation(joint: OptionalJoint, side: number): number {
  quatRotate(pose.extras, joint * 4, side, 0, 0, axis)
  return axis[1]!
}

describe('the shoulder girdle follows the arm', () => {
  it('turns each clavicle with the arm on its own side through a walk', () => {
    const drive = createGaitDrive()
    drive.speed = 1.6
    const positions = new Float32Array(Joint.Count * 3)
    for (const [clavicle, side, shoulder, elbow] of [
      [OptionalJoint.ClavicleL, LEFT, Joint.ShoulderL, Joint.ElbowL],
      [OptionalJoint.ClavicleR, RIGHT, Joint.ShoulderR, Joint.ElbowR],
    ] as const) {
      let together = 0
      let swept = 0
      for (let sample = 0; sample < 36; sample++) {
        drive.phase = sample / 36
        writeLocomotion(MASCULINE, drive, state, pose)
        writeShoulderGirdle(MASCULINE, pose)
        resolvePositions(MASCULINE, pose, positions)
        const arm = positions[elbow * 3 + 2]! - positions[shoulder * 3 + 2]!
        const shoulderForward = protraction(clavicle, side)
        together += arm * shoulderForward
        swept = Math.max(swept, Math.abs(shoulderForward))
      }
      expect(together, 'the shoulder turns against its own arm').toBeGreaterThan(0)
      expect(swept, 'the shoulder barely moved').toBeGreaterThan(0.02)
    }
  })

  it('lifts the clavicle ten to twenty-five degrees when the arm points straight up', () => {
    const fresh = createPose()
    const rest = new Float32Array(3)
    restDirection(MASCULINE, Joint.ShoulderL, rest)
    // The turn that carries the arm's rest direction onto +Y: about the axis
    // perpendicular to both, by the angle between them.
    const dot = Math.max(-1, Math.min(1, rest[1]!))
    const angle = Math.acos(dot)
    const ax = rest[1]! * 0 - rest[2]! * 1
    const ay = rest[2]! * 0 - rest[0]! * 0
    const az = rest[0]! * 1 - rest[1]! * 0
    const length = Math.hypot(ax, ay, az) || 1
    for (const joint of [Joint.ShoulderL, Joint.ElbowL, Joint.HandL]) {
      setJointAxisAngle(fresh, joint, ax / length, ay / length, az / length, angle)
    }
    writeShoulderGirdle(MASCULINE, fresh)
    quatRotate(fresh.extras, OptionalJoint.ClavicleL * 4, LEFT, 0, 0, axis)
    expect(axis[1]!, 'the clavicle did not lift for a vertical arm').toBeGreaterThan(Math.sin(10 * Math.PI / 180))
    expect(axis[1]!, 'the clavicle lifted more than a shoulder can').toBeLessThan(Math.sin(25 * Math.PI / 180))
  })

  it('lifts both clavicles when frost nova takes the hands overhead', () => {
    // The windup's peak, wherever this body's arm reaches it: a shorter or lower
    // arm gets there at a different phase, and the lift is what is being tested.
    const peak = { [OptionalJoint.ClavicleL]: 0, [OptionalJoint.ClavicleR]: 0 } as Record<number, number>
    for (let phase = 0.25; phase <= 0.75; phase += 0.025) {
      writeClipPose(MASCULINE, POSE_CLIPS.frost_nova, phase, state, pose)
      writeShoulderGirdle(MASCULINE, pose)
      for (const [clavicle, side] of [[OptionalJoint.ClavicleL, LEFT], [OptionalJoint.ClavicleR, RIGHT]] as const) {
        peak[clavicle] = Math.max(peak[clavicle]!, elevation(clavicle, side))
      }
    }
    for (const clavicle of [OptionalJoint.ClavicleL, OptionalJoint.ClavicleR]) {
      // Frost nova takes the hands to about fifty-five degrees, not straight up, so
      // the lift is well under way here; the straight-up case is asserted below.
      expect(peak[clavicle], 'a clavicle stayed down while the arm went up').toBeGreaterThan(0.1)
    }
  })

  it('leaves the clavicles alone while the arms hang', () => {
    writeClipPose(MASCULINE, POSE_CLIPS.frost_nova, 0, state, pose)
    writeShoulderGirdle(MASCULINE, pose)
    for (const [clavicle, side] of [[OptionalJoint.ClavicleL, LEFT], [OptionalJoint.ClavicleR, RIGHT]] as const) {
      expect(Math.abs(elevation(clavicle, side)), 'a hanging arm lifted its shoulder').toBeLessThan(0.05)
    }
  })

  it('moves the real shoulder bone on masculine-v3', () => {
    const body = loadGlbSkeleton(join(import.meta.dirname, '..', 'public', 'bodies', 'masculine-v3', 'masculine-v3.glb'))
    const driver = new ProceduralDriver()
    driver.bind(body, MASCULINE_PROFILE)
    const { rigInput: input } = createRigInputOwner()
    const seen: THREE.Vector3[] = []
    for (let frame = 1; frame <= 60; frame++) {
      input.state = 'moving'
      input.speed = 1.6
      input.time = frame * DT
      input.seed = 3
      driver.update(input, DT)
      body.updateMatrixWorld(true)
      seen.push(body.getObjectByName('upper_arm_R')!.getWorldPosition(new THREE.Vector3()))
    }
    const moved = Math.max(...seen.map((point) => point.distanceTo(seen[0]!)))
    expect(moved, 'the shoulder joint never moved through a whole stride').toBeGreaterThan(0.004)
    driver.dispose()
  })

  it('skips the joint silently on a family that has none', () => {
    const drive = createGaitDrive()
    drive.speed = 1.6
    writeLocomotion(KNIGHT, drive, state, pose)
    writeShoulderGirdle(KNIGHT, pose)
    // The pose still says it; the knight's profile maps no clavicle, so the
    // binding never asks for one.
    expect(KAYKIT_PROFILE.optional['clavicle.l']).toBeUndefined()
    const body = loadGlbSkeleton(join(import.meta.dirname, '..', 'public', 'models', 'player.glb'))
    const driver = new ProceduralDriver()
    expect(() => driver.bind(body, KAYKIT_PROFILE)).not.toThrow()
    driver.dispose()
  })
})
