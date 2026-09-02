import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { restDirection } from '../src/render/procedural/geometry'
import { Joint } from '../src/render/procedural/joints'
import { createPose, setJointAxisAngle } from '../src/render/procedural/pose'
import { MASCULINE_PROFILE } from '../src/render/profiles/masculine'
import { bindSkeleton } from '../src/render/semanticskeleton'
import { loadGlbSkeleton } from './fixtures/glbskeleton'

const MASCULINE = join(import.meta.dirname, '..', 'public', 'bodies', 'masculine-v3', 'masculine-v3.glb')
const FIXTURE = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'src', 'render', 'procedural', 'fixtures', 'masculine.json'), 'utf8'))
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
    // The extractor's own reading of this GLB, not a number typed in.
    const ankle = FIXTURE.joints['foot.l'] as [number, number, number]
    expect(rest.x, 'ankle x').toBeCloseTo(ankle[0], 4)
    expect(rest.y, 'ankle y').toBeCloseTo(ankle[1], 4)
    expect(rest.z, 'ankle z').toBeCloseTo(ankle[2], 4)

    setJointAxisAngle(pose, Joint.KneeL, 1, 0, 0, Math.PI / 2)
    skeleton.apply(pose)
    const bent = worldOf(body, 'foot_L')
    const knee = worldOf(body, 'shin_L')
    // Where a shin of this length lands when it folds a quarter turn about +X.
    const direction = new Float32Array(3)
    restDirection(skeleton.geometry, Joint.KneeL, direction)
    const expected = knee.clone().add(
      new THREE.Vector3(direction[0]!, direction[1]!, direction[2]!)
        .applyAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)
        .multiplyScalar(skeleton.geometry.shin),
    )
    expect(bent.x, 'bent ankle x').toBeCloseTo(expected.x, 4)
    expect(bent.y, 'bent ankle y').toBeCloseTo(expected.y, 4)
    expect(bent.z, 'bent ankle z').toBeCloseTo(expected.z, 4)
    expect(bent.y, 'the foot swings back and up').toBeGreaterThan(knee.y - 0.05)
    expect(bent.distanceTo(knee)).toBeCloseTo(skeleton.geometry.shin, 5)
  })
})
