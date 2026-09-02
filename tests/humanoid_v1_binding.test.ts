import { join } from 'node:path'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { Joint } from '../src/render/procedural/joints'
import { createPose, setJointAxisAngle } from '../src/render/procedural/pose'
import { MASCULINE_PROFILE } from '../src/render/profiles/masculine'
import { bindSkeleton } from '../src/render/semanticskeleton'
import { loadGlbSkeleton } from './fixtures/glbskeleton'

const MASCULINE = join(import.meta.dirname, '..', 'public', 'bodies', 'masculine-v2', 'masculine-v2.glb')
const DRIVEN = Object.values(MASCULINE_PROFILE.bones)

function boneOf(body: THREE.Object3D, name: string): THREE.Bone {
  const bone = body.getObjectByName(name)
  if (!bone) throw new Error(`no bone named ${name}`)
  return bone as THREE.Bone
}

function worldOf(body: THREE.Object3D, name: string): THREE.Vector3 {
  body.updateMatrixWorld(true)
  return boneOf(body, name).getWorldPosition(new THREE.Vector3())
}

describe('humanoid.v1 semantic skeleton binding', () => {
  it('leaves the real body in its bind pose under identity', () => {
    const body = loadGlbSkeleton(MASCULINE)
    const before = DRIVEN.map((name) => boneOf(body, name).quaternion.clone())
    const rootBefore = boneOf(body, 'root').position.clone()

    bindSkeleton(body, MASCULINE_PROFILE).apply(createPose())

    DRIVEN.forEach((name, at) => {
      expect(boneOf(body, name).quaternion.angleTo(before[at]!), `${name} left its bind pose`).toBeLessThan(0.001)
    })
    expect(boneOf(body, 'root').position.distanceTo(rootBefore)).toBeLessThan(1e-9)
  })

  it('puts the foot at the real rest and 90-degree knee-bend positions', () => {
    const body = loadGlbSkeleton(MASCULINE)
    const skeleton = bindSkeleton(body, MASCULINE_PROFILE)
    const pose = createPose()

    skeleton.apply(pose)
    const rest = worldOf(body, 'foot_L')
    expect(rest.toArray()).toEqual([
      expect.closeTo(0.194607, 5),
      expect.closeTo(0.112667, 5),
      expect.closeTo(-0.054018, 5),
    ])

    setJointAxisAngle(pose, Joint.KneeL, 1, 0, 0, Math.PI / 2)
    skeleton.apply(pose)
    const bent = worldOf(body, 'foot_L')
    expect(bent.toArray()).toEqual([
      expect.closeTo(0.194607, 5),
      expect.closeTo(0.525527, 5),
      expect.closeTo(-0.452539, 5),
    ])
    expect(bent.distanceTo(worldOf(body, 'shin_L'))).toBeCloseTo(skeleton.geometry.shin, 5)
  })
})
