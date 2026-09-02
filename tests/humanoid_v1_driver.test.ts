import { join } from 'node:path'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createGaitDrive, createGaitParams, createGaitState, gaitParams, writeLocomotion } from '../src/render/procedural/gait'
import fixture from '../src/render/procedural/fixtures/masculine.json'
import {buildRigGeometry } from '../src/render/procedural/geometry'
import { Joint } from '../src/render/procedural/joints'
import { createPose, resolvePositions } from '../src/render/procedural/pose'
import { ProceduralDriver } from '../src/render/proceduraldriver'
import { MASCULINE_PROFILE } from '../src/render/profiles/masculine'
import { RIG_CLIPS, type RigState } from '../src/render/rig'
import { createRigInputOwner } from '../src/render/riginput'
import { loadGlbSkeleton } from './fixtures/glbskeleton'

const MASCULINE = join(import.meta.dirname, '..', 'public', 'bodies', 'masculine-v2', 'masculine-v2.glb')
const WALK = 1.6
const DT = 1 / 60
const DEGREES = 180 / Math.PI
const DRIVEN = Object.values(MASCULINE_PROFILE.bones)

function masculine(): { body: THREE.Object3D; driver: ProceduralDriver } {
  const body = loadGlbSkeleton(MASCULINE)
  const driver = new ProceduralDriver()
  driver.bind(body, MASCULINE_PROFILE)
  return { body, driver }
}

function drive(driver: ProceduralDriver, state: RigState): void {
  const input = createRigInputOwner().rigInput
  for (let frame = 1; frame <= 40; frame++) {
    input.state = state
    input.speed = state === 'moving' ? WALK : 0
    input.dashing = state === 'dash'
    input.time = frame * DT
    input.seed = 11
    driver.update(input, DT)
  }
}

function kneeBend(positions: Float32Array): number {
  const hip = Joint.HipL * 3
  const knee = Joint.KneeL * 3
  const foot = Joint.FootL * 3
  const upper = new THREE.Vector3(
    positions[hip]! - positions[knee]!,
    positions[hip + 1]! - positions[knee + 1]!,
    positions[hip + 2]! - positions[knee + 2]!,
  )
  const lower = new THREE.Vector3(
    positions[foot]! - positions[knee]!,
    positions[foot + 1]! - positions[knee + 1]!,
    positions[foot + 2]! - positions[knee + 2]!,
  )
  return (Math.PI - upper.angleTo(lower)) * DEGREES
}

describe('humanoid.v1 procedural driver', () => {
  it('produces finite quaternions for every RigState on the real body', () => {
    for (const state of Object.keys(RIG_CLIPS) as RigState[]) {
      const { body, driver } = masculine()
      drive(driver, state)
      for (const name of DRIVEN) {
        const bone = body.getObjectByName(name)!
        const length = bone.quaternion.length()
        expect(Number.isFinite(length), `${state}: ${name} is not finite`).toBe(true)
        expect(length, `${state}: ${name} is not a unit quaternion`).toBeCloseTo(1, 5)
      }
      driver.dispose()
    }
  })

  it('walks at 1.6 m/s with human cadence and stance knees', () => {
    const geometry = buildRigGeometry(fixture.joints, 1, fixture.standingHeight)
    const params = createGaitParams()
    gaitParams(geometry, WALK, params)
    expect(params.frequency).toBeGreaterThan(0.9)
    expect(params.frequency).toBeLessThan(1.2)

    const gait = createGaitState()
    const pose = createPose()
    const drive = createGaitDrive()
    const positions = new Float32Array(Joint.Count * 3)
    drive.speed = WALK
    let stanceKnee = 0
    for (let sample = 0; sample <= 720; sample++) {
      drive.phase = sample / 720
      writeLocomotion(geometry, drive, gait, pose)
      resolvePositions(geometry, pose, positions)
      if (drive.phase > params.duty * 0.25 && drive.phase < params.duty * 0.75) {
        stanceKnee = Math.max(stanceKnee, kneeBend(positions))
      }
    }
    expect(stanceKnee, 'a walk, not a squat').toBeLessThan(25)
  })
})
