import { join } from 'node:path'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { POSE_CLIPS } from '../src/render/procedural/clips'
import { createGaitDrive, createGaitState, writeLocomotion } from '../src/render/procedural/gait'
import { writeShoulderGirdle } from '../src/render/procedural/girdle'
import { Joint, LEFT, OptionalJoint, RIGHT } from '../src/render/procedural/joints'
import { createPose, resolvePositions } from '../src/render/procedural/pose'
import { writeClipPose } from '../src/render/procedural/poses'
import { quatRotate } from '../src/render/procedural/quat'
import { ProceduralDriver } from '../src/render/proceduraldriver'
import { HUMANOID_V1_PROFILE } from '../src/render/profiles/humanoid_v1'
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

  it('lifts both clavicles when frost nova takes the hands overhead', () => {
    writeClipPose(MASCULINE, POSE_CLIPS.frost_nova, 0.42, state, pose)
    writeShoulderGirdle(MASCULINE, pose)
    for (const [clavicle, side] of [[OptionalJoint.ClavicleL, LEFT], [OptionalJoint.ClavicleR, RIGHT]] as const) {
      // Ten degrees or more of lift, which is where the spec starts.
      expect(elevation(clavicle, side), 'a clavicle stayed down while the arm went up').toBeGreaterThan(0.17)
    }
  })

  it('leaves the clavicles alone while the arms hang', () => {
    writeClipPose(MASCULINE, POSE_CLIPS.frost_nova, 0, state, pose)
    writeShoulderGirdle(MASCULINE, pose)
    for (const [clavicle, side] of [[OptionalJoint.ClavicleL, LEFT], [OptionalJoint.ClavicleR, RIGHT]] as const) {
      expect(Math.abs(elevation(clavicle, side)), 'a hanging arm lifted its shoulder').toBeLessThan(0.05)
    }
  })

  it('moves the real shoulder bone on masculine-v1', () => {
    const body = loadGlbSkeleton(join(import.meta.dirname, '..', 'public', 'bodies', 'masculine-v1.glb'))
    const driver = new ProceduralDriver()
    driver.bind(body, HUMANOID_V1_PROFILE)
    const { rigInput: input } = createRigInputOwner()
    const seen: THREE.Vector3[] = []
    for (let frame = 1; frame <= 60; frame++) {
      input.state = 'moving'
      input.speed = 1.6
      input.time = frame * DT
      input.seed = 3
      driver.update(input, DT)
      body.updateMatrixWorld(true)
      seen.push(body.getObjectByName('upper_arm.R')!.getWorldPosition(new THREE.Vector3()))
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
