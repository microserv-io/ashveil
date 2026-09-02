import { describe, expect, it } from 'vitest'
import { HIT_FLASH_DURATION } from '../src/sim/types'
import { applyFlinch } from '../src/render/procedural/flinch'
import { Joint } from '../src/render/procedural/joints'
import { createPose, setJointAxisAngle } from '../src/render/procedural/pose'
import { quatAngleBetween, quatLength } from '../src/render/procedural/quat'

function base(): Float32Array {
  const pose = createPose()
  setJointAxisAngle(pose, Joint.Chest, 0, 1, 0, 0.3)
  setJointAxisAngle(pose, Joint.KneeL, 1, 0, 0, 0.6)
  return new Float32Array(pose.rotations)
}

function flinched(age: number | null, seed = 3): Float32Array {
  const pose = createPose()
  pose.rotations.set(base())
  applyFlinch(pose, age, seed)
  return new Float32Array(pose.rotations)
}

function moved(rotations: Float32Array, joint: Joint): number {
  return quatAngleBetween(base(), joint * 4, rotations, joint * 4)
}

describe('the hit flinch layer', () => {
  it('recoils the chest and head at the moment of the hit', () => {
    const struck = flinched(0)
    expect(moved(struck, Joint.Chest)).toBeGreaterThan(0.1)
    expect(moved(struck, Joint.Head)).toBeGreaterThan(0.1)
  })

  it('leaves the legs to the base pose', () => {
    const struck = flinched(0)
    expect(moved(struck, Joint.KneeL)).toBe(0)
    expect(moved(struck, Joint.FootR)).toBe(0)
  })

  it('decays to nothing by the end of the flash, without snapping off', () => {
    expect(moved(flinched(HIT_FLASH_DURATION), Joint.Chest)).toBeCloseTo(0, 5)
    // The last sample before the flash ends has to already be near zero, or the
    // recoil would vanish in one frame instead of fading.
    expect(moved(flinched(HIT_FLASH_DURATION * 0.99), Joint.Chest)).toBeLessThan(0.01)
    expect(moved(flinched(HIT_FLASH_DURATION * 0.99), Joint.Head)).toBeLessThan(0.01)
  })

  it('does nothing at all without a hit, or after one is over', () => {
    for (const age of [null, HIT_FLASH_DURATION * 2, 10]) {
      const untouched = flinched(age)
      for (let i = 0; i < untouched.length; i++) expect(untouched[i]).toBe(base()[i])
    }
  })

  it('fades on every frame it is alive', () => {
    let previous = Infinity
    for (let i = 0; i < 20; i++) {
      const amount = moved(flinched((i / 20) * HIT_FLASH_DURATION), Joint.Chest)
      expect(amount, `sample ${i} did not decay`).toBeLessThan(previous)
      previous = amount
    }
  })

  it('keeps every rotation a unit quaternion', () => {
    const struck = flinched(HIT_FLASH_DURATION * 0.3)
    for (let joint = 0; joint < Joint.Count; joint++) {
      expect(quatLength(struck, joint * 4)).toBeCloseTo(1, 5)
    }
  })

  it('varies with the body so a struck pack does not twitch as one', () => {
    expect([...flinched(0, 1)]).not.toEqual([...flinched(0, 2)])
  })
})
