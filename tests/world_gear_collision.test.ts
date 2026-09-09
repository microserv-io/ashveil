import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  GEAR_COLLISION_PROFILES,
  capsuleCollisionVertexShader,
  gearCollisionEnvelope,
  gearCollisionProfile,
  installCapsuleCollisionShader,
  resolveCapsuleCollision,
  validateGearCollisionProfile,
  type PosedCollisionCapsule,
} from '../src/world/gear-collision'

const BODY_SHA256 = 'd586edf0e2b2e86247932a9f9e62f514463d6daa05569228f9076edb9f67479c'
const BASE_SHADER = `
#include <skinning_pars_vertex>
void main() {
  #include <skinning_vertex>
}`

function capsule(overrides: Partial<PosedCollisionCapsule> = {}): PosedCollisionCapsule {
  return {
    start: [0, 0, 0], end: [0, 1, 0], restStart: [0, 0, 0], restEnd: [0, 1, 0],
    startRadius: 0.2, endRadius: 0.2,
    ...overrides,
  }
}

describe('gear capsule collision', () => {
  it('registers only the exact approved body, set, and handmade robe root', () => {
    expect(GEAR_COLLISION_PROFILES).toHaveLength(1)
    const profile = gearCollisionProfile(BODY_SHA256, 'arcane-mage-tier', 'ArcaneMageRobeSkirt')!
    expect(profile.capsules.map((entry) => [entry.startJoint, entry.endJoint])).toEqual([
      ['thigh_stretch.l', 'leg_stretch.l'], ['thigh_stretch.r', 'leg_stretch.r'],
      ['leg_stretch.l', 'foot.l'], ['leg_stretch.r', 'foot.r'],
      ['foot.l', 'toes_01.l'], ['foot.r', 'toes_01.r'],
    ])
    expect(gearCollisionProfile('0'.repeat(64), 'arcane-mage-tier', 'ArcaneMageRobeSkirt')).toBeUndefined()
    expect(gearCollisionProfile(BODY_SHA256, 'starter-leather', 'ArcaneMageRobeSkirt')).toBeUndefined()
    expect(gearCollisionProfile(BODY_SHA256, 'arcane-mage-tier', 'ArcaneMageBack')).toBeUndefined()
    expect(() => validateGearCollisionProfile({ ...profile, zeroAboveY: profile.fullStrengthBelowY }))
      .toThrow(/profile is invalid/)
    expect(() => validateGearCollisionProfile({ ...profile, fullStrengthBelowY: Number.NaN }))
      .toThrow(/profile is invalid/)
    expect(() => validateGearCollisionProfile({ ...profile, zeroAboveY: Number.NaN }))
      .toThrow(/profile is invalid/)
    expect(() => validateGearCollisionProfile({
      ...profile,
      capsules: profile.capsules.map((entry, index) => index === 0
        ? { ...entry, bodyEnvelope: { startRadius: -1, endRadius: 0.1 } } : entry),
    })).toThrow(/invalid radii/)
  })

  it('takes the conservative maximum of body, selected legs, and selected boots', () => {
    const calf = GEAR_COLLISION_PROFILES[0]!.capsules[2]!
    const body = gearCollisionEnvelope(calf, null, null)
    const starter = gearCollisionEnvelope(calf, 'starter-leather', 'starter-leather')
    const mixed = gearCollisionEnvelope(calf, 'arcane-mage-tier', 'starter-leather')
    const mage = gearCollisionEnvelope(calf, 'arcane-mage-tier', 'arcane-mage-tier')
    expect(body.endRadius).toBeLessThan(starter.endRadius)
    expect(mixed).toEqual({ startRadius: 0.145, endRadius: 0.13 })
    expect(mage.startRadius).toBeGreaterThan(mixed.startRadius)
  })

  it('adds one outward envelope change while preserving authored layer spacing', () => {
    const outward = capsule({ start: [0.1, 0, 0], end: [0.1, 1, 0] })
    const inner = resolveCapsuleCollision(
      [0.3, 0.5, 0], [0.3, 0.5, 0], [0, 0, 0], [0, 0, 0], [0.3, 0.5, 0],
      0.5, [outward], 0.7, 0.9,
    )
    const outer = resolveCapsuleCollision(
      [0.34, 0.5, 0], [0.34, 0.5, 0], [0, 0, 0], [0, 0, 0], [0.34, 0.5, 0],
      0.5, [outward], 0.7, 0.9,
    )
    expect(inner[0]).toBeCloseTo(0.4)
    expect(outer[0]).toBeCloseTo(0.44)
    expect(outer[0] - inner[0]).toBeCloseTo(0.04)

    const inward = capsule({ start: [-0.1, 0, 0], end: [-0.1, 1, 0] })
    expect(resolveCapsuleCollision(
      [0.3, 0.5, 0], [0.3, 0.5, 0], [0, 0, 0], [0, 0, 0], [0.3, 0.5, 0],
      0.5, [inward], 0.7, 0.9,
    )).toEqual([0.3, 0.5, 0])
  })

  it('is rest-pose neutral, feathers at the waist, and stays finite on the root axis', () => {
    const still = capsule()
    expect(resolveCapsuleCollision(
      [0.3, 0.5, 0], [0.3, 0.5, 0], [0, 0, 0], [0, 0, 0], [0.3, 0.5, 0],
      0.5, [still], 0.7, 0.9,
    )).toEqual([0.3, 0.5, 0])
    const authoredInsideEnvelope = capsule({ startRadius: 0.5, endRadius: 0.5 })
    expect(resolveCapsuleCollision(
      [0.04, 0.5, 0], [0.04, 0.5, 0], [0, 0, 0], [0, 0, 0], [0.04, 0.5, 0],
      0.5, [authoredInsideEnvelope], 0.7, 0.9,
    )).toEqual([0.04, 0.5, 0])
    const outward = capsule({ start: [0.1, 0, 0], end: [0.1, 1, 0] })
    expect(resolveCapsuleCollision(
      [0.3, 0.8, 0], [0.3, 0.8, 0], [0, 0, 0], [0, 0, 0], [0.3, 0.8, 0],
      0.8, [outward], 0.7, 0.9,
    )[0]).toBeCloseTo(0.35)
    expect(resolveCapsuleCollision(
      [0.3, 0.9, 0], [0.3, 0.9, 0], [0, 0, 0], [0, 0, 0], [0.3, 0.9, 0],
      0.9, [outward], 0.7, 0.9,
    )).toEqual([0.3, 0.9, 0])
    const axis = resolveCapsuleCollision(
      [0, 0.5, 0], [0, 0.5, 0], [0, 0, 0], [0, 0, 0], [0, 0.5, 0],
      0.5, [outward], 0.7, 0.9,
    )
    expect(axis.every(Number.isFinite)).toBe(true)
  })

  it('patches skinning while preserving standard material channels and a prior hook', () => {
    const map = new THREE.Texture()
    const material = new THREE.MeshStandardMaterial({
      color: '#4b4678', emissive: '#2040ff', emissiveIntensity: 3, map,
    })
    let previousCompileCalled = false
    material.onBeforeCompile = (shader) => {
      previousCompileCalled = true
      shader.vertexShader = `// previous\n${shader.vertexShader}`
    }
    material.customProgramCacheKey = () => 'previous-key'
    const original = {
      color: material.color.clone(), emissive: material.emissive.clone(),
      emissiveIntensity: material.emissiveIntensity, map: material.map,
    }
    const profile = GEAR_COLLISION_PROFILES[0]!
    const radii = new Float32Array(6).fill(0.1)
    installCapsuleCollisionShader(material, {
      startJoints: new Float32Array([0, 1, 2, 3, 4, 5]),
      endJoints: new Float32Array([1, 2, 3, 4, 5, 6]),
      startRest: Array.from({ length: 6 }, () => new THREE.Vector3()),
      endRest: Array.from({ length: 6 }, () => new THREE.Vector3(0, 1, 0)),
      startRadii: radii, endRadii: new Float32Array(radii),
      rootJoint: 0, rootRest: new THREE.Vector3(),
      fullStrengthBelowY: profile.fullStrengthBelowY,
      zeroAboveY: profile.zeroAboveY,
    }, profile.key)
    const shader = { uniforms: {}, vertexShader: BASE_SHADER, fragmentShader: 'unchanged' }
    material.onBeforeCompile(shader as never, {} as THREE.WebGLRenderer)
    expect(previousCompileCalled).toBe(true)
    expect(shader.vertexShader).toContain('// previous')
    expect(shader.vertexShader).toContain('gearOutwardChange')
    expect(shader.vertexShader).toContain('attribute float gearCollisionScope')
    expect(shader.vertexShader).toContain('uniform float gearCapsuleStartJoints[6]')
    expect(shader.vertexShader).toContain('gearTaperedCapsuleSupport')
    expect(shader.fragmentShader).toBe('unchanged')
    expect(Object.keys(shader.uniforms)).toEqual(expect.arrayContaining([
      'gearCapsuleStartJoints', 'gearCapsuleEndJoints', 'gearCapsuleStartRadii', 'gearCapsuleEndRadii',
      'gearCapsuleRootJoint', 'gearCapsuleRootRest',
    ]))
    expect(material.customProgramCacheKey()).toContain('previous-key|ashveil-gear-capsules-v4')
    expect(material.color.equals(original.color)).toBe(true)
    expect(material.emissive.equals(original.emissive)).toBe(true)
    expect(material.emissiveIntensity).toBe(original.emissiveIntensity)
    expect(material.map).toBe(original.map)
  })

  it('fails closed if shader skinning seams or the capsule count are invalid', () => {
    expect(() => capsuleCollisionVertexShader('#include <skinning_vertex>')).toThrow(/shader chunks/)
    expect(() => capsuleCollisionVertexShader('#include <skinning_pars_vertex>')).toThrow(/shader chunks/)
    expect(() => capsuleCollisionVertexShader(BASE_SHADER, 0)).toThrow(/positive capsule count/)
  })
})
