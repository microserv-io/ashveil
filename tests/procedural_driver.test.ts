import { existsSync } from 'node:fs'
import { join } from 'node:path'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { ProceduralDriver } from '../src/render/proceduraldriver'
import { KAYKIT_PROFILE } from '../src/render/profiles/kaykit'
import { RIG_CLIPS, type RigState } from '../src/render/rig'
import { createRigInputOwner } from '../src/render/riginput'
import { loadGlbSkeleton } from './fixtures/glbskeleton'

const PLAYER = join(import.meta.dirname, '..', 'public', 'models', 'player.glb')
const DT = 1 / 60
const DRIVEN = Object.values(KAYKIT_PROFILE.bones)

function knight(): { body: THREE.Object3D; driver: ProceduralDriver } {
  const body = loadGlbSkeleton(PLAYER)
  body.scale.setScalar(0.85)
  const driver = new ProceduralDriver()
  driver.bind(body, KAYKIT_PROFILE)
  return { body, driver }
}

function drive(driver: ProceduralDriver, state: RigState, frames: number, from = 0, speed = 3): number {
  const input = createRigInputOwner().rigInput
  let time = from
  for (let frame = 0; frame < frames; frame++) {
    time += DT
    input.state = state
    input.speed = state === 'moving' ? speed : 0
    input.dashing = state === 'dash'
    input.time = time
    input.seed = 11
    driver.update(input, DT)
  }
  return time
}

function poseOf(body: THREE.Object3D): number[] {
  return DRIVEN.flatMap((name) => {
    const bone = body.getObjectByName(name)!
    return [...bone.quaternion.toArray(), ...bone.position.toArray()]
  })
}

describe.skipIf(!existsSync(PLAYER))('procedural motion driver', () => {
  it('poses every rig state with finite, normalised rotations', () => {
    for (const state of Object.keys(RIG_CLIPS) as RigState[]) {
      const { body, driver } = knight()
      drive(driver, state, 40)
      for (const name of DRIVEN) {
        const bone = body.getObjectByName(name)!
        const length = Math.hypot(bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w)
        expect(Number.isFinite(length), `${state}: ${name} is not finite`).toBe(true)
        expect(length, `${state}: ${name} is not a unit quaternion`).toBeCloseTo(1, 5)
        expect(Number.isFinite(bone.position.length()), `${state}: ${name} moved to a non-finite position`).toBe(true)
      }
      driver.dispose()
    }
  })

  /**
   * A pooled body arrives mid-run with the last owner's dash offset still on its
   * root and the last owner's gait phase still in the generator. Both have to go,
   * or a recycled monster is born leaning.
   */
  it('leaves no stale root offset or gait history when a body is recycled', () => {
    const { body, driver } = knight()
    const bind = poseOf(body)

    drive(driver, 'dash', 30)
    expect(poseOf(body)).not.toEqual(bind)

    driver.reset()
    expect(poseOf(body)).toEqual(bind)

    // A recycled body must then walk the same run a fresh one would, from any time.
    drive(driver, 'moving', 25, 900)
    const recycled = poseOf(body)

    const fresh = knight()
    drive(fresh.driver, 'moving', 25, 900)
    expect(recycled).toEqual(poseOf(fresh.body))
  })

  it('refuses to pose before it is bound', () => {
    const driver = new ProceduralDriver()
    expect(() => drive(driver, 'idle', 1)).toThrow(/bind/)
  })
})
