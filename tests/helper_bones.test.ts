import { join } from 'node:path'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { restDirection } from '../src/render/procedural/geometry'
import { Joint } from '../src/render/procedural/joints'
import { createPose, setJointAxisAngle } from '../src/render/procedural/pose'
import { MASCULINE_PROFILE } from '../src/render/profiles/masculine'
import { bindSkeleton } from '../src/render/semanticskeleton'
import { loadGlbSkeleton } from './fixtures/glbskeleton'

const MASCULINE = join(import.meta.dirname, '..', 'public', 'bodies', 'masculine-v2', 'masculine-v2.glb')

function boneOf(body: THREE.Object3D, name: string): THREE.Bone {
  const bone = body.getObjectByName(name)
  if (!bone) throw new Error(`no bone named ${name}`)
  return bone as THREE.Bone
}

function angleOf(bone: THREE.Bone): number {
  return 2 * Math.acos(Math.min(1, Math.abs(bone.quaternion.w)))
}

/**
 * A helper bone is never in a pose. The shoulder helper must turn by half of what
 * the upper arm turns relative to the clavicle, and the twist helper by half of
 * the forearm's turn about the upper arm's axis: that is what lets the deltoid
 * cap follow the arm at half rate instead of folding at the joint.
 */
describe('helper bones on the fitted masculine body', () => {
  it('turns the shoulder helper by half the arm raise, about the same axis', () => {
    const body = loadGlbSkeleton(MASCULINE)
    const skeleton = bindSkeleton(body, MASCULINE_PROFILE)
    const pose = createPose()
    skeleton.apply(pose)
    expect(angleOf(boneOf(body, 'shoulder_helper_L'))).toBeLessThan(1e-6)

    // Positive about +Z carries the left arm's +X toward +Y: a raise. Rotations
    // are absolute, so the forearm and hand get the same turn to stay rigid with it.
    setJointAxisAngle(pose, Joint.ShoulderL, 0, 0, 1, Math.PI / 2)
    setJointAxisAngle(pose, Joint.ElbowL, 0, 0, 1, Math.PI / 2)
    setJointAxisAngle(pose, Joint.HandL, 0, 0, 1, Math.PI / 2)
    skeleton.apply(pose)

    const helper = boneOf(body, 'shoulder_helper_L')
    expect(angleOf(helper)).toBeCloseTo(Math.PI / 4, 5)
    const axis = new THREE.Vector3(helper.quaternion.x, helper.quaternion.y, helper.quaternion.z).normalize()
    expect(Math.abs(axis.z)).toBeCloseTo(1, 5)
    expect(angleOf(boneOf(body, 'shoulder_helper_R')), 'the other arm did not move').toBeLessThan(1e-6)
    expect(angleOf(boneOf(body, 'twist_upper_arm_L')), 'a raise carries no twist').toBeLessThan(1e-6)
  })

  it('turns the twist helper by half the forearm twist about the upper arm axis', () => {
    const body = loadGlbSkeleton(MASCULINE)
    const skeleton = bindSkeleton(body, MASCULINE_PROFILE)
    const pose = createPose()
    const axis = new Float32Array(3)
    restDirection(skeleton.geometry, Joint.ShoulderL, axis)

    setJointAxisAngle(pose, Joint.ElbowL, axis[0]!, axis[1]!, axis[2]!, Math.PI / 3)
    skeleton.apply(pose)

    expect(angleOf(boneOf(body, 'twist_upper_arm_L'))).toBeCloseTo(Math.PI / 6, 5)
    expect(angleOf(boneOf(body, 'shoulder_helper_L')), 'the shoulder helper ignores the forearm').toBeLessThan(1e-6)
  })

  it('leaves the helpers at rest for a profile that does not name them, and restores them', () => {
    const body = loadGlbSkeleton(MASCULINE)
    const { helpers: _ignored, ...withoutHelpers } = MASCULINE_PROFILE
    const skeleton = bindSkeleton(body, withoutHelpers)
    const pose = createPose()
    setJointAxisAngle(pose, Joint.ShoulderL, 0, 0, 1, Math.PI / 2)
    skeleton.apply(pose)
    expect(angleOf(boneOf(body, 'shoulder_helper_L'))).toBeLessThan(1e-6)

    const drivenBody = loadGlbSkeleton(MASCULINE)
    const driven = bindSkeleton(drivenBody, MASCULINE_PROFILE)
    driven.apply(pose)
    expect(angleOf(boneOf(drivenBody, 'shoulder_helper_L'))).toBeGreaterThan(0.1)
    driven.restore()
    expect(angleOf(boneOf(drivenBody, 'shoulder_helper_L'))).toBeLessThan(1e-6)
  })
})
