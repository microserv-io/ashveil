import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { describe, expect, it, vi } from 'vitest'
import { loadModels } from '../src/render/models'
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
  it('loads the shared masculine-v3 body once for every actor role', async () => {
    const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync')
      .mockResolvedValue({ scene: new THREE.Group() } as never)

    try {
      await loadModels()
      expect(load.mock.calls.filter(([path]) => path === '/bodies/masculine-v3/masculine-v3.glb')).toHaveLength(1)
    } finally {
      load.mockRestore()
    }
  })

  it('keeps every semantic bone name through Three.js property binding', () => {
    const semanticNames = [
      ...Object.values(MASCULINE_PROFILE.bones),
      ...Object.values(MASCULINE_PROFILE.optional),
    ]
    // The browser loader renames dotted node names through this sanitizer.
    expect(semanticNames.map(THREE.PropertyBinding.sanitizeNodeName)).toEqual(semanticNames)
  })

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

  it('moves the root by the pose offset and restores the bind pose', () => {
    const body = loadGlbSkeleton(MASCULINE)
    const skeleton = bindSkeleton(body, MASCULINE_PROFILE)
    const pose = createPose()
    const restPelvis = worldOf(body, 'pelvis')

    pose.offset[1] = -0.2
    skeleton.apply(pose)
    expect(worldOf(body, 'pelvis').y).toBeCloseTo(restPelvis.y - 0.2, 5)

    skeleton.restore()
    expect(worldOf(body, 'pelvis').distanceTo(restPelvis)).toBeLessThan(1e-9)
  })

  it('names the profile and semantic joint when a required bone is missing', () => {
    const body = loadGlbSkeleton(MASCULINE)
    const broken = {
      ...MASCULINE_PROFILE,
      bones: { ...MASCULINE_PROFILE.bones, 'knee.l': 'missing_shin' },
    }
    expect(() => bindSkeleton(body, broken)).toThrow(/humanoid\.v1[\s\S]*knee\.l/)
  })
})
