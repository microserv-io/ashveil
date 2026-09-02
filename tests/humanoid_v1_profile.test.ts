import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { JOINT_NAMES } from '../src/render/procedural/joints'
import { HUMANOID_V1_PROFILE } from '../src/render/profiles/humanoid_v1'
import { loadGlbSkeleton } from './fixtures/glbskeleton'

const MASCULINE = join(import.meta.dirname, '..', 'public', 'bodies', 'masculine-v1.glb')

describe('humanoid.v1 skeleton profile', () => {
  it('resolves every required joint against the committed body', () => {
    expect(existsSync(MASCULINE), 'the review body must be committed under public/bodies').toBe(true)
    const body = loadGlbSkeleton(MASCULINE)

    expect(Object.keys(HUMANOID_V1_PROFILE.bones).sort()).toEqual([...JOINT_NAMES].sort())
    for (const joint of JOINT_NAMES) {
      const bone = HUMANOID_V1_PROFILE.bones[joint]
      expect(bone, `no bone mapped for required joint "${joint}"`).toBeTypeOf('string')
      expect(body.getObjectByName(bone!), `joint "${joint}" maps to missing bone "${bone}"`).toBeDefined()
    }
  })

  it('maps the optional neck and clavicles with an identity arm carry', () => {
    const body = loadGlbSkeleton(MASCULINE)
    expect(HUMANOID_V1_PROFILE.optional).toEqual({
      neck: 'neck',
      'clavicle.l': 'clavicle.L',
      'clavicle.r': 'clavicle.R',
    })
    for (const bone of Object.values(HUMANOID_V1_PROFILE.optional)) {
      expect(body.getObjectByName(bone)).toBeDefined()
    }
    expect(HUMANOID_V1_PROFILE.armCarry).toEqual({
      left: { shoulder: [0, 0, 0, 1], elbow: [0, 0, 0, 1] },
      right: { shoulder: [0, 0, 0, 1], elbow: [0, 0, 0, 1] },
    })
  })
})
