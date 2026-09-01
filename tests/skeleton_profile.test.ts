import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { JOINT_NAMES, OPTIONAL_JOINT_NAMES } from '../src/render/procedural/joints'
import { KAYKIT_PROFILE } from '../src/render/profiles/kaykit'
import { KAYKIT_JOINTS, KAYKIT_OPTIONAL_JOINTS } from '../scripts/extract-rig-geometry.mjs'

const RIG: string[] = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'src', 'render', 'profiles', 'kaykit.json'), 'utf8'),
).bones

/**
 * The profile is the only thing standing between a semantic joint and a bone name,
 * so a typo in it is a limb that never moves. Every claim it makes is checked
 * against the rig manifest rather than against another copy of the same guess.
 */
describe('KayKit skeleton profile', () => {
  it('resolves every required joint to a bone the rig actually has', () => {
    for (const joint of JOINT_NAMES) {
      const bone = KAYKIT_PROFILE.bones[joint]
      expect(bone, `no bone mapped for required joint "${joint}"`).toBeTypeOf('string')
      expect(RIG, `joint "${joint}" maps to "${bone}", which is not a KayKit bone`).toContain(bone)
    }
    expect(Object.keys(KAYKIT_PROFILE.bones).sort()).toEqual([...JOINT_NAMES].sort())
  })

  it('never requires an optional joint', () => {
    for (const [joint, bone] of Object.entries(KAYKIT_PROFILE.optional)) {
      expect(OPTIONAL_JOINT_NAMES).toContain(joint)
      expect(RIG).toContain(bone)
      expect(JOINT_NAMES).not.toContain(joint)
    }
    // The kit has no clavicles or neck; a profile claiming them would be inventing bones.
    expect(Object.keys(KAYKIT_PROFILE.optional).sort()).toEqual(['toes.l', 'toes.r', 'wrist.l', 'wrist.r'])
  })

  it('binds one bone per joint', () => {
    const bones = Object.values(KAYKIT_PROFILE.bones)
    expect(new Set(bones).size).toBe(bones.length)
  })

  /**
   * The fixture geometry and the live binding must read the same rig: if they drift,
   * the generator solves against one skeleton and writes onto another.
   */
  it('agrees with the extractor that built the committed fixture', () => {
    expect(KAYKIT_PROFILE.bones).toEqual(KAYKIT_JOINTS)
    expect(KAYKIT_PROFILE.optional).toEqual(KAYKIT_OPTIONAL_JOINTS)
  })
})
